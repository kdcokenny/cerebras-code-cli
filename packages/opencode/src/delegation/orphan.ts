import { Storage } from "../storage/storage"
import { DelegationStore } from "./store"
import type { DelegationInfo, DelegationQueued, DelegationRunning } from "./types"
import { Log } from "../util/log"

const log = Log.create({ service: "delegation-orphan" })

/**
 * Scans all delegations across all sessions and marks any "queued" or "running"
 * delegations as "failed" with error code "ORPHANED".
 *
 * This should be called once on system startup to clean up delegations
 * that were interrupted by process exit.
 */
export async function cleanupOrphanedDelegations(): Promise<{ cleaned: number }> {
  let cleaned = 0

  try {
    // Get all delegation keys across all sessions
    const keys = await Storage.list(["delegation"])

    log.info("Starting orphan cleanup", { totalDelegations: keys.length })

    // Process each delegation
    for (const key of keys) {
      try {
        // Read delegation state
        const delegation = await Storage.read<DelegationInfo>(key)

        // Check if delegation needs cleanup
        if (delegation.status === "queued" || delegation.status === "running") {
          // Extract parentSessionId and delegationId from key
          // Key format: ['delegation', parentSessionId, delegationId]
          const parentSessionId = key[1]
          const delegationId = key[2]

          log.info("Cleaning orphaned delegation", {
            delegationId,
            parentSessionId,
            status: delegation.status,
            description: delegation.description,
          })

          // Transition to failed state
          await DelegationStore.markFailed(parentSessionId, delegationId, {
            message: "Process exited while task was running",
            code: "ORPHANED",
          })

          cleaned++
        }
      } catch (error) {
        // Log error but continue with other delegations
        log.error("Failed to clean delegation", {
          key: key.join("/"),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    log.info("Orphan cleanup complete", { cleaned })
  } catch (error) {
    log.error("Orphan cleanup failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return { cleaned }
}

/**
 * Register orphan cleanup to run. Call this during system initialization.
 */
export async function initOrphanCleanup(): Promise<void> {
  log.info("Initializing orphan cleanup")
  await cleanupOrphanedDelegations()
}
