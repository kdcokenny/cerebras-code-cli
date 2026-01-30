import { Storage } from "../storage/storage"
import { Delegation } from "./types"

/**
 * Store namespace for delegation persistence operations.
 * Uses Storage API with key structure: ["delegation", sessionID, delegationId]
 */
export namespace Store {
  /**
   * Create a new delegation in queued state.
   */
  export async function create(delegation: Delegation.DelegationQueued): Promise<void> {
    await Storage.write(["delegation", delegation.sessionID, delegation.id], delegation)
  }

  /**
   * Get a delegation by ID.
   * Returns undefined if not found.
   */
  export async function get(sessionID: string, id: string): Promise<Delegation.Info | undefined> {
    try {
      return await Storage.read<Delegation.Info>(["delegation", sessionID, id])
    } catch (e) {
      if (e instanceof Storage.NotFoundError) {
        return undefined
      }
      throw e
    }
  }

  /**
   * List all delegations for a session.
   * Returns empty array if session has no delegations.
   */
  export async function list(sessionID: string): Promise<Delegation.Info[]> {
    const result: Delegation.Info[] = []
    const items = await Storage.list(["delegation", sessionID])
    for (const item of items) {
      try {
        const delegation = await Storage.read<Delegation.Info>(item)
        result.push(delegation)
      } catch (e) {
        // Skip if read fails (e.g., file was deleted concurrently)
        if (!(e instanceof Storage.NotFoundError)) {
          throw e
        }
      }
    }
    return result
  }

  /**
   * List ALL delegations across all sessions.
   * Used for orphan cleanup and system maintenance.
   */
  export async function listAll(): Promise<Delegation.Info[]> {
    const result: Delegation.Info[] = []
    const sessions = await Storage.list(["delegation"])
    for (const sessionPath of sessions) {
      const items = await Storage.list(sessionPath)
      for (const item of items) {
        try {
          const delegation = await Storage.read<Delegation.Info>(item)
          result.push(delegation)
        } catch (e) {
          // Skip if read fails
          if (!(e instanceof Storage.NotFoundError)) {
            throw e
          }
        }
      }
    }
    return result
  }

  /**
   * Update a delegation (for state transitions).
   */
  export async function update(delegation: Delegation.Info): Promise<void> {
    await Storage.write(["delegation", delegation.sessionID, delegation.id], delegation)
  }

  /**
   * Remove a delegation from storage.
   */
  export async function remove(sessionID: string, id: string): Promise<void> {
    await Storage.remove(["delegation", sessionID, id])
  }
}
