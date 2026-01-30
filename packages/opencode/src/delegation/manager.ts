import { Delegation } from "./types"
import { Store } from "./store"
import { generateDelegationId } from "./id"
import { DelegationRunner } from "./runner"
import { Session } from "../session"
import { Storage } from "../storage/storage"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create({ service: "delegation.manager" })

// Track active delegations globally for concurrency cap
const activeDelegations = new Map<string, Set<string>>() // sessionID -> Set<delegationID>

// Track batch completion status: batchId -> { parentSessionID, total, completed, failed, notified, results }
const activeBatches = new Map<
  string,
  {
    parentSessionID: string
    total: number
    completed: number
    failed: number
    notified: boolean
    results: Map<string, { status: "completed" | "failed"; result?: string; error?: string; description: string }>
  }
>()

/**
 * High-level delegation management API.
 * Handles delegation lifecycle: creation, status tracking, and listing.
 */
export namespace DelegationManager {
  /**
   * Input for starting a new delegation.
   */
  export interface StartInput {
    sessionID: string // Parent session ID
    parentMessageID: string // Message containing the task tool call
    parentPartID: string // The ToolPart ID (callID) for streaming updates
    parentCallID: string // The callID to find parent ToolPart
    description: string // Task description
    agent: string // Agent type
    prompt: string // The prompt for the child session
    batchId?: string // Optional batch ID for grouping delegations
  }

  /**
   * Start a new delegation.
   *
   * Creates a delegation record in queued state, spawns a fire-and-forget runner,
   * and returns the delegation ID immediately.
   *
   * The delegation will be executed asynchronously by the runner.
   */
  export async function start(input: StartInput): Promise<string> {
    // A) Guard: Validate parent session exists
    try {
      await Session.get(input.sessionID)
    } catch (error) {
      if (error instanceof Storage.NotFoundError) {
        throw new Error(`Parent session ${input.sessionID} not found. Cannot create delegation.`)
      }
      throw error
    }

    // B) Get config for concurrency cap
    const config = await Config.get()
    const maxConcurrent = config.delegation?.maxConcurrent ?? 5

    // C) Initialize active set BEFORE any further async work
    if (!activeDelegations.has(input.sessionID)) {
      activeDelegations.set(input.sessionID, new Set())
    }
    const activeSet = activeDelegations.get(input.sessionID)!

    // Check concurrency cap
    if (activeSet.size >= maxConcurrent) {
      throw new Error(
        `Concurrency limit reached: ${activeSet.size}/${maxConcurrent} delegations running. Wait for some to complete.`,
      )
    }

    // D) Generate readable delegation ID with collision retry
    let id: string
    let retries = 0
    const maxRetries = 5

    while (retries < maxRetries) {
      id = generateDelegationId()
      const existing = await Store.get(input.sessionID, id)
      if (!existing) break // ID is available

      retries++
      log.warn("Delegation ID collision, retrying", { id, attempt: retries })
    }

    if (retries >= maxRetries) {
      throw new Error(`Failed to generate unique delegation ID after ${maxRetries} attempts. Please try again.`)
    }

    // E) Create delegation record in queued state
    const delegation: Delegation.DelegationQueued = {
      id: id!,
      status: "queued",
      sessionID: input.sessionID,
      parentSessionID: input.sessionID,
      parentMessageID: input.parentMessageID,
      parentPartID: input.parentPartID,
      parentCallID: input.parentCallID,
      description: input.description,
      agent: input.agent,
      prompt: input.prompt,
      createdAt: Date.now(),
      batchId: input.batchId,
    }

    // F) Store the delegation
    await Store.create(delegation)

    // G) Register with batch if batchId provided
    if (input.batchId) {
      registerBatch(input.batchId, input.sessionID, id!, input.description)
    }

    // H) Track active delegation for concurrency (add to existing set)
    activeSet.add(id!)

    // Re-check concurrency after insertion to catch races
    if (activeSet.size > maxConcurrent) {
      // Clean up - always remove from active set, attempt storage cleanup
      try {
        await Store.remove(input.sessionID, id!)
      } catch (err) {
        log.warn("Failed to remove orphaned delegation from storage", { id: id!, error: err })
      } finally {
        activeSet.delete(id!)
        if (activeSet.size === 0) {
          activeDelegations.delete(input.sessionID)
        }
      }
      throw new Error(
        `Concurrency limit reached after insertion: ${activeSet.size}/${maxConcurrent} delegations running.`,
      )
    }

    // I) Spawn fire-and-forget runner (no await)
    DelegationRunner.run(delegation)
      .catch((error) => {
        log.error("Runner failed", { delegationId: id, error })
      })
      .finally(() => {
        // Remove from active tracking
        const set = activeDelegations.get(input.sessionID)
        if (set) {
          set.delete(id!)
          if (set.size === 0) {
            activeDelegations.delete(input.sessionID)
          }
        }
      })

    // J) Return the delegation ID immediately
    return id!
  }

  /**
   * Get delegation status by ID.
   * Returns undefined if delegation not found.
   */
  export async function get(sessionID: string, id: string): Promise<Delegation.Info | undefined> {
    return Store.get(sessionID, id)
  }

  /**
   * List all delegations for a session.
   * Returns empty array if session has no delegations.
   */
  export async function list(sessionID: string): Promise<Delegation.Info[]> {
    return Store.list(sessionID)
  }

  /**
   * Register a delegation with a batch.
   * Creates the batch if it doesn't exist, increments total count.
   */
  export function registerBatch(batchId: string, parentSessionID: string, delegationId: string, description: string) {
    let batch = activeBatches.get(batchId)
    if (!batch) {
      batch = {
        parentSessionID,
        total: 0,
        completed: 0,
        failed: 0,
        notified: false,
        results: new Map(),
      }
      activeBatches.set(batchId, batch)
    }
    batch.total++
    batch.results.set(delegationId, { status: "completed", description }) // Placeholder until completion
  }

  /**
   * Mark a task in a batch as completed.
   */
  export function markTaskComplete(batchId: string, delegationId: string, result: string) {
    const batch = activeBatches.get(batchId)
    if (!batch) return
    batch.completed++
    const existing = batch.results.get(delegationId)
    if (existing) {
      existing.status = "completed"
      existing.result = result
    }
  }

  /**
   * Mark a task in a batch as failed.
   */
  export function markTaskFailed(batchId: string, delegationId: string, error: string) {
    const batch = activeBatches.get(batchId)
    if (!batch) return
    batch.failed++
    const existing = batch.results.get(delegationId)
    if (existing) {
      existing.status = "failed"
      existing.error = error
    }
  }

  /**
   * Check if a batch is complete (all tasks finished).
   */
  export function isBatchComplete(batchId: string): boolean {
    const batch = activeBatches.get(batchId)
    if (!batch) return false
    return batch.completed + batch.failed >= batch.total
  }

  /**
   * Get batch results for notification.
   */
  export function getBatchResults(batchId: string) {
    const batch = activeBatches.get(batchId)
    if (!batch) return null
    return {
      batchId,
      parentSessionID: batch.parentSessionID,
      results: Array.from(batch.results.entries()).map(([id, data]) => ({
        id,
        ...data,
      })),
    }
  }

  /**
   * Mark a batch as notified (prevents duplicate notifications).
   */
  export function markBatchNotified(batchId: string) {
    const batch = activeBatches.get(batchId)
    if (batch) {
      batch.notified = true
    }
  }

  /**
   * Check if a batch has been notified.
   */
  export function isBatchNotified(batchId: string): boolean {
    const batch = activeBatches.get(batchId)
    return batch?.notified ?? false
  }

  /**
   * Clean up a batch from tracking.
   */
  export function cleanupBatch(batchId: string) {
    activeBatches.delete(batchId)
  }
}
