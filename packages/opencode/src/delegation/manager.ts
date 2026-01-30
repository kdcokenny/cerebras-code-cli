import { DelegationStore } from "./store"
import type { DelegationInfo } from "./types"
import { DelegationRunner } from "./runner"

/**
 * DelegationManager - Main entry point for starting and tracking delegations
 *
 * This module provides the high-level API for delegation lifecycle:
 * - start(): Creates delegation and spawns background runner
 * - getRunningCount(): Returns count of active delegations
 */
export namespace DelegationManager {
  /**
   * Start a new delegation. Creates the delegation record, resets the wake latch,
   * spawns the runner in the background, and returns immediately with the delegation ID.
   */
  export async function start(opts: {
    description: string
    prompt: string
    agent: string
    parentSessionId: string
    parentMessageId: string
    parentCallID: string
  }): Promise<string> {
    // Guard: Validate required fields
    if (!opts.description || !opts.prompt || !opts.agent) {
      throw new Error("Missing required fields: description, prompt, and agent must be provided")
    }
    if (!opts.parentSessionId || !opts.parentMessageId || !opts.parentCallID) {
      throw new Error("Missing required parent context: sessionId, messageId, and callID must be provided")
    }

    // Create delegation in queued state
    const delegation: DelegationInfo = await DelegationStore.create({
      description: opts.description,
      prompt: opts.prompt,
      agent: opts.agent,
      parentSessionId: opts.parentSessionId,
      parentMessageId: opts.parentMessageId,
      parentCallID: opts.parentCallID,
    })

    // Reset wake latch to ensure notifications work correctly
    await DelegationStore.resetWakeLatch(opts.parentSessionId)

    // Spawn runner in background - fire and forget
    // Type assertion: DelegationStore.create() always returns queued status
    DelegationRunner.run(delegation as DelegationInfo & { status: "queued" }).catch((error: unknown) => {
      // Log error but don't block - runner handles its own error transitions
      console.error(`[DelegationManager] Runner failed for ${delegation.id}:`, error)
    })

    // Return ID immediately - caller doesn't wait for completion
    return delegation.id
  }

  /**
   * Get the count of running delegations for a session.
   * Used by notification logic to decide noReply.
   */
  export async function getRunningCount(parentSessionId: string): Promise<number> {
    if (!parentSessionId) {
      throw new Error("parentSessionId is required")
    }

    return await DelegationStore.getActiveCount(parentSessionId)
  }
}
