import { test, expect, describe } from "bun:test"
import { PermissionNext } from "../../src/permission/next"

describe("PermissionNext", () => {
  describe("expand", () => {
    test("expands ~/ to home directory", () => {
      const result = PermissionNext.expand("~/Documents")
      expect(result).toContain("/Documents")
      expect(result).not.toContain("~")
    })

    test("expands $HOME/ to home directory", () => {
      const result = PermissionNext.expand("$HOME/Downloads")
      expect(result).toContain("/Downloads")
      expect(result).not.toContain("$HOME")
    })

    test("returns regular paths unchanged", () => {
      expect(PermissionNext.expand("/usr/bin")).toBe("/usr/bin")
      expect(PermissionNext.expand("relative/path")).toBe("relative/path")
    })
  })

  describe("fromConfig", () => {
    test("converts string permission to ruleset with wildcard", () => {
      const ruleset = PermissionNext.fromConfig({ bash: "allow" })
      expect(ruleset).toHaveLength(1)
      expect(ruleset[0]).toMatchObject({ permission: "bash", pattern: "*", action: "allow" })
    })

    test("converts object permission to ruleset", () => {
      const ruleset = PermissionNext.fromConfig({
        bash: { "npm *": "allow", "rm -rf *": "deny", "*": "ask" },
      })
      expect(ruleset).toHaveLength(3)
      expect(ruleset.find((r) => r.pattern === "npm *")?.action).toBe("allow")
      expect(ruleset.find((r) => r.pattern === "rm -rf *")?.action).toBe("deny")
      expect(ruleset.find((r) => r.pattern === "*")?.action).toBe("ask")
    })

    test("expands home directory patterns", () => {
      const ruleset = PermissionNext.fromConfig({
        bash: { "~/Downloads/*": "allow" },
      })
      expect(ruleset[0].pattern).toContain("/Downloads/*")
      expect(ruleset[0].pattern).not.toContain("~")
    })
  })

  describe("merge", () => {
    test("flattens multiple rulesets", () => {
      const r1 = [{ permission: "bash", pattern: "*", action: "ask" as const }]
      const r2 = [{ permission: "edit", pattern: "*.ts", action: "allow" as const }]
      const merged = PermissionNext.merge(r1, r2)
      expect(merged).toHaveLength(2)
    })

    test("later rules take precedence via findLast", () => {
      const r1 = [{ permission: "bash", pattern: "*", action: "deny" as const }]
      const r2 = [{ permission: "bash", pattern: "*", action: "allow" as const }]
      const merged = PermissionNext.merge(r1, r2)
      // The last rule should be the one that wins in evaluate
      expect(merged[merged.length - 1].action).toBe("allow")
    })
  })

  describe("evaluate", () => {
    test("returns matching rule using findLast", () => {
      const ruleset = [
        { permission: "bash", pattern: "*", action: "ask" as const },
        { permission: "bash", pattern: "npm *", action: "allow" as const },
      ]
      const rule = PermissionNext.evaluate("bash", "npm install", ruleset)
      expect(rule?.action).toBe("allow")
    })

    test("returns undefined when no match", () => {
      const rule = PermissionNext.evaluate("bash", "unknown", [])
      expect(rule).toBeUndefined()
    })

    test("matches permission type with wildcard", () => {
      const ruleset = [{ permission: "*", pattern: "*", action: "deny" as const }]
      const rule = PermissionNext.evaluate("bash", "any", ruleset)
      expect(rule?.action).toBe("deny")
    })
  })

  describe("disabled", () => {
    test("returns tools blocked by deny+* rules", () => {
      const ruleset = [
        { permission: "edit", pattern: "*", action: "deny" as const },
        { permission: "bash", pattern: "*", action: "allow" as const },
      ]
      const disabled = PermissionNext.disabled(["edit", "write", "patch", "bash"], ruleset)
      expect(disabled.has("edit")).toBe(true)
      expect(disabled.has("write")).toBe(true) // maps to edit permission
      expect(disabled.has("patch")).toBe(true) // maps to edit permission
      expect(disabled.has("bash")).toBe(false)
    })

    test("does not disable tools with specific pattern denies", () => {
      const ruleset = [{ permission: "bash", pattern: "rm *", action: "deny" as const }]
      const disabled = PermissionNext.disabled(["bash"], ruleset)
      expect(disabled.has("bash")).toBe(false) // not a wildcard deny
    })
  })

  describe("error classes", () => {
    test("RejectedError has correct message", () => {
      const error = new PermissionNext.RejectedError("test reason")
      expect(error.message).toContain("test reason")
    })

    test("CorrectedError includes feedback", () => {
      const error = new PermissionNext.CorrectedError("try again with X")
      expect(error.message).toContain("try again with X")
    })

    test("DeniedError includes blocking rule", () => {
      const rule = { permission: "bash", pattern: "*", action: "deny" as const }
      const error = new PermissionNext.DeniedError(rule)
      expect(error.rule).toEqual(rule)
    })
  })
})
