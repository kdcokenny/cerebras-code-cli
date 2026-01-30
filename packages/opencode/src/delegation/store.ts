import { Storage } from "../storage/storage"
import type { DelegationInfo, DelegationState } from "./types"
import { generateReadableId } from "./id"

// In-memory wake latch - synchronous check-and-set
const wakeLatch = new Map<string, boolean>()

/**
 * DelegationStore - CRUD operations and state transitions for delegations
 *
 * Storage schema:
 * - Delegation: ['delegation', parentSessionId, delegationId]
 */
export namespace DelegationStore {
  /**
   * Create a new delegation
   * Initial state: queued
   */
  export async function create(input: {
    description: string
    prompt: string
    agent: string
    parentSessionId: string
    parentMessageId: string
    parentCallID: string
  }): Promise<DelegationInfo> {
    const id = generateReadableId()

    // Fail-loud on collision
    const existing = await get(input.parentSessionId, id)
    if (existing) {
      throw new Error(`Delegation ID collision: ${id} already exists. Please retry.`)
    }

    const delegation: DelegationInfo = {
      id,
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      parentSessionId: input.parentSessionId,
      parentMessageId: input.parentMessageId,
      parentCallID: input.parentCallID,
      status: "queued",
      queuedAt: Date.now(),
    }

    await Storage.write(["delegation", input.parentSessionId, id], delegation)
    return delegation
  }

  /**
   * Get a single delegation by ID
   * Returns null if not found
   */
  export async function get(parentSessionId: string, delegationId: string): Promise<DelegationInfo | null> {
    try {
      return await Storage.read<DelegationInfo>(["delegation", parentSessionId, delegationId])
    } catch (error) {
      if (error instanceof Storage.NotFoundError) {
        return null
      }
      throw error
    }
  }

  /**
   * List all delegations for a session
   * Returns empty array if none found
   */
  export async function list(parentSessionId: string): Promise<DelegationInfo[]> {
    const keys = await Storage.list(["delegation", parentSessionId])

    const delegations = await Promise.all(
      keys.map(async (key) => {
        try {
          return await Storage.read<DelegationInfo>(key)
        } catch (error) {
          if (error instanceof Storage.NotFoundError) {
            return null
          }
          throw error
        }
      }),
    )

    return delegations.filter((d): d is DelegationInfo => d !== null)
  }

  /**
   * Mark delegation as running
   * Validates transition from queued → running
   */
  export async function markRunning(
    parentSessionId: string,
    delegationId: string,
    childSessionId: string,
  ): Promise<Extract<DelegationInfo, { status: "running" }>> {
    const current = await get(parentSessionId, delegationId)
    if (!current) {
      throw new Error(`Delegation ${delegationId} not found`)
    }
    if (current.status !== "queued") {
      throw new Error(`Cannot mark ${delegationId} as running: current status is ${current.status}, expected queued`)
    }

    const updated: Extract<DelegationInfo, { status: "running" }> = {
      ...current,
      status: "running",
      startedAt: Date.now(),
      childSessionId,
    }

    await Storage.write(["delegation", parentSessionId, delegationId], updated)
    return updated
  }

  /**
   * Mark delegation as completed
   * Validates transition from running → completed
   */
  export async function markCompleted(
    parentSessionId: string,
    delegationId: string,
    result: string,
  ): Promise<Extract<DelegationInfo, { status: "completed" }>> {
    const current = await get(parentSessionId, delegationId)
    if (!current) {
      throw new Error(`Delegation ${delegationId} not found`)
    }
    if (current.status !== "running") {
      throw new Error(`Cannot mark ${delegationId} as completed: current status is ${current.status}, expected running`)
    }

    const updated: Extract<DelegationInfo, { status: "completed" }> = {
      ...current,
      status: "completed",
      completedAt: Date.now(),
      result,
    }

    await Storage.write(["delegation", parentSessionId, delegationId], updated)
    return updated
  }

  /**
   * Mark delegation as failed
   * Validates transition from queued or running → failed
   */
  export async function markFailed(
    parentSessionId: string,
    delegationId: string,
    error: { message: string; code?: string },
  ): Promise<Extract<DelegationInfo, { status: "failed" }>> {
    const current = await get(parentSessionId, delegationId)
    if (!current) {
      throw new Error(`Delegation ${delegationId} not found`)
    }
    // Can fail from queued OR running
    if (current.status !== "queued" && current.status !== "running") {
      throw new Error(
        `Cannot mark ${delegationId} as failed: current status is ${current.status}, expected queued or running`,
      )
    }

    const updated: Extract<DelegationInfo, { status: "failed" }> = {
      ...current,
      status: "failed",
      // Use existing startedAt if running, otherwise use now
      startedAt: "startedAt" in current ? current.startedAt : Date.now(),
      failedAt: Date.now(),
      error,
      childSessionId: "childSessionId" in current ? current.childSessionId : undefined,
    }

    await Storage.write(["delegation", parentSessionId, delegationId], updated)
    return updated
  }

  /**
   * Get count of active delegations (queued or running)
   */
  export async function getActiveCount(parentSessionId: string): Promise<number> {
    const delegations = await list(parentSessionId)
    return delegations.filter((d) => d.status === "queued" || d.status === "running").length
  }

  /**
   * Try to set wake latch
   * Returns true if this call set it (was false, now true)
   * Returns false if already set
   * Synchronous check-and-set - atomic in JS event loop
   */
  export function trySetWakeLatch(parentSessionId: string): boolean {
    // Synchronous check-and-set - atomic in JS event loop
    if (wakeLatch.get(parentSessionId)) {
      return false // Already set
    }
    wakeLatch.set(parentSessionId, true)
    return true
  }

  /**
   * Reset wake latch to false
   */
  export function resetWakeLatch(parentSessionId: string): void {
    wakeLatch.delete(parentSessionId)
  }
}
