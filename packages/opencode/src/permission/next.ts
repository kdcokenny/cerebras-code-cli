import z from "zod"
import os from "os"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Wildcard } from "../util/wildcard"
import { Storage } from "../storage/storage"
import { Config } from "../config/config"

export namespace PermissionNext {
  const log = Log.create({ service: "permission-next" })

  // Schemas
  export const Action = z.enum(["allow", "deny", "ask"])
  export type Action = z.infer<typeof Action>

  export const Rule = z.object({
    permission: z.string(),
    pattern: z.string(),
    action: Action,
  })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array()
  export type Ruleset = z.infer<typeof Ruleset>

  export const Request = z.object({
    id: Identifier.schema("permission"),
    sessionID: Identifier.schema("session"),
    permission: z.string(),
    patterns: z.string().array(),
    metadata: z.record(z.string(), z.any()),
    always: z.string().array(),
    tool: z
      .object({
        messageID: z.string(),
        callID: z.string(),
      })
      .optional(),
  })
  export type Request = z.infer<typeof Request>

  export const Reply = z.enum(["once", "always", "reject"])
  export type Reply = z.infer<typeof Reply>

  // Events
  export const Event = {
    Asked: Bus.event("permission.asked", Request),
    Replied: Bus.event(
      "permission.replied",
      z.object({
        requestID: z.string(),
        response: Reply,
      }),
    ),
  }

  // Error Classes
  export class RejectedError extends Error {
    constructor(reason?: string) {
      super(reason ?? "Permission request was rejected by the user")
    }
  }

  export class CorrectedError extends Error {
    constructor(feedback: string) {
      super(`Corrected by user: ${feedback}`)
    }
  }

  export class DeniedError extends Error {
    constructor(public readonly rule: Rule) {
      super(`Permission denied by rule: ${rule.permission} ${rule.pattern} -> ${rule.action}`)
    }
  }

  // State Management
  const state = Instance.state(() => {
    const pending: Record<
      string,
      {
        info: Request
        resolve: () => void
        reject: (e: any) => void
      }
    > = {}

    return { pending }
  })

  // Helper: Expand ~/ and $HOME/ patterns
  export function expand(pattern: string): string {
    if (pattern.startsWith("~/")) {
      return os.homedir() + pattern.slice(1)
    }
    if (pattern.startsWith("$HOME/")) {
      // "$HOME/" is 6 chars, skip it and add "/" + remainder
      return os.homedir() + "/" + pattern.slice(6)
    }
    return pattern
  }

  // Convert Config.Permission to Ruleset
  export function fromConfig(permission: Config.Info["permission"]): Ruleset {
    if (!permission) return []

    const rules: Ruleset = []

    for (const [permissionKey, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        // Simple case: edit: "allow"
        rules.push({
          permission: permissionKey,
          pattern: "*",
          action: value as Action,
        })
      } else if (typeof value === "object" && value !== null) {
        // Complex case: bash: { "npm *": "allow", "*": "deny" }
        for (const [pattern, action] of Object.entries(value)) {
          rules.push({
            permission: permissionKey,
            pattern: expand(pattern),
            action: action as Action,
          })
        }
      }
    }

    return rules
  }

  // Merge multiple rulesets
  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

  // Evaluate permission against rulesets
  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule | undefined {
    const merged = merge(...rulesets)

    // Use findLast to get the last matching rule (most specific)
    return merged.findLast((rule) => {
      const permissionMatch = Wildcard.match(permission, rule.permission)
      const patternMatch = Wildcard.match(pattern, rule.pattern)
      return permissionMatch && patternMatch
    })
  }

  // Get tools disabled by deny+* rules
  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const disabledTools = new Set<string>()

    // Map of edit-related tools to their permission
    const editTools = ["edit", "write", "patch", "multiedit"]

    for (const tool of tools) {
      let permission = tool

      // Map edit-related tools to "edit" permission
      if (editTools.includes(tool)) {
        permission = "edit"
      }

      // Check if there's a deny rule with "*" pattern for this permission
      const rule = evaluate(permission, "*", ruleset)
      if (rule && rule.action === "deny") {
        disabledTools.add(tool)
      }
    }

    return disabledTools
  }

  // Request permission
  export async function ask(input: {
    permission: Request["permission"]
    patterns: Request["patterns"]
    sessionID: Request["sessionID"]
    metadata: Request["metadata"]
    always?: Request["always"]
    tool?: Request["tool"]
  }): Promise<void> {
    const { pending } = state()

    log.info("asking", {
      sessionID: input.sessionID,
      permission: input.permission,
      patterns: input.patterns,
    })

    // Get config-based ruleset
    const config = await Config.get()
    const configRuleset = fromConfig(config.permission)

    // Check if already covered by approved rules
    const alwaysPatterns = input.always ?? []
    const alwaysRuleset: Ruleset = alwaysPatterns.map((pattern) => ({
      permission: input.permission,
      pattern,
      action: "allow" as const,
    }))

    // Evaluate each pattern
    for (const pattern of input.patterns) {
      const rule = evaluate(input.permission, pattern, configRuleset, alwaysRuleset)

      if (rule) {
        if (rule.action === "allow") {
          continue // This pattern is allowed, check next
        }
        if (rule.action === "deny") {
          throw new DeniedError(rule)
        }
      }
    }

    // Check all patterns are covered
    const allCovered = input.patterns.every((pattern) => {
      const rule = evaluate(input.permission, pattern, configRuleset, alwaysRuleset)
      return rule && rule.action === "allow"
    })

    if (allCovered) {
      return // All patterns allowed, no need to ask
    }

    // Create request
    const info: Request = {
      id: Identifier.ascending("permission"),
      sessionID: input.sessionID,
      permission: input.permission,
      patterns: input.patterns,
      metadata: input.metadata,
      always: alwaysPatterns,
      tool: input.tool,
    }

    // Trigger plugin hook
    const pluginResult = await Plugin.trigger("permission.ask", info, {
      status: "ask" as Action,
    }).then((x) => x.status)

    if (pluginResult === "deny") {
      throw new RejectedError("Permission denied by plugin")
    }
    if (pluginResult === "allow") {
      return
    }

    // Add to pending and wait for user response
    return new Promise<void>((resolve, reject) => {
      pending[info.id] = {
        info,
        resolve,
        reject,
      }
      Bus.publish(Event.Asked, info)
    })
  }

  // Respond to permission request
  export async function reply(input: { requestID: string; response: Reply }): Promise<void> {
    log.info("reply", input)

    const { pending } = state()
    const match = pending[input.requestID]

    if (!match) {
      log.warn("No pending request found", { requestID: input.requestID })
      return
    }

    delete pending[input.requestID]

    Bus.publish(Event.Replied, {
      requestID: input.requestID,
      response: input.response,
    })

    if (input.response === "reject") {
      match.reject(new RejectedError("User rejected permission request"))
      return
    }

    match.resolve()

    if (input.response === "always") {
      // Persist the approved patterns
      const currentRuleset = await recall()
      const newRules: Ruleset = match.info.patterns.map((pattern) => ({
        permission: match.info.permission,
        pattern,
        action: "allow" as const,
      }))
      await persist(merge(currentRuleset, newRules))
    }
  }

  // List pending requests
  export async function list(): Promise<Request[]> {
    const { pending } = state()
    return Object.values(pending).map((p) => p.info)
  }

  // Versioned storage schema
  const StorageSchema = z.object({
    version: z.literal(1),
    rules: Ruleset,
  })
  type StorageSchema = z.infer<typeof StorageSchema>

  // Persist ruleset to storage
  export async function persist(ruleset: Ruleset): Promise<void> {
    const projectID = Instance.project.id
    const data: StorageSchema = {
      version: 1,
      rules: ruleset,
    }

    await Storage.write(["permission", "ruleset", projectID], data)
    log.info("persisted ruleset", { projectID, count: ruleset.length })
  }

  // Recall ruleset from storage
  export async function recall(): Promise<Ruleset> {
    const projectID = Instance.project.id

    try {
      const data = await Storage.read<StorageSchema>(["permission", "ruleset", projectID])

      // Validate and migrate if needed
      const parsed = StorageSchema.safeParse(data)

      if (!parsed.success) {
        // Attempt migration from legacy format (pre-v1)
        const migrated = migrateLegacyData(data)
        if (migrated) {
          log.info("Migrated legacy ruleset data", { projectID })
          return migrated
        }

        log.warn("Invalid ruleset schema, returning empty", { projectID })
        return []
      }

      // Check version for future migrations
      if (parsed.data.version === 1) {
        return parsed.data.rules
      }

      // Future migration placeholder: handle v2+ here
      // if (parsed.data.version === 2) {
      //   return migrateV2ToV1(parsed.data)
      // }

      log.warn("Unknown ruleset version", { version: (data as any).version })
      return []
    } catch (e) {
      if (e instanceof Storage.NotFoundError) {
        log.info("No existing ruleset found", { projectID })
        return []
      }
      throw e
    }
  }

  // Migrate legacy data (pre-versioned) to current format
  function migrateLegacyData(data: unknown): Ruleset | null {
    // If data is directly a Ruleset array (pre-v1 format)
    const legacyParse = Ruleset.safeParse(data)
    if (legacyParse.success) {
      return legacyParse.data
    }
    return null
  }
}
