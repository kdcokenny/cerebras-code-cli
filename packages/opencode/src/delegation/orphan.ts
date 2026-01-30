import { Delegation } from "./types.js"
import { Store } from "./store.js"
import { notifyCompletion, notifyBatchCompletion } from "./notification.js"
import { DelegationManager } from "./manager.js"
import { Log } from "../util/log"

const log = Log.create({ service: "delegation.orphan" })

/**
 * Initialize orphan cleanup on server startup.
 * Finds all delegations that were queued or running when the server crashed/restarted
 * and marks them as failed with a descriptive error.
 */
export async function initOrphanCleanup(): Promise<void> {
  log.info("Starting orphan cleanup")

  const all = await Store.listAll()

  for (const delegation of all) {
    // Mark BOTH queued and running delegations as failed
    if (delegation.status !== "queued" && delegation.status !== "running") {
      continue
    }

    log.info("Cleaning orphaned delegation", {
      delegationId: delegation.id,
      status: delegation.status,
      description: delegation.description,
    })

    // This delegation was interrupted by server restart
    const failed: Delegation.DelegationFailed = {
      ...delegation,
      status: "failed",
      startedAt: delegation.status === "running" ? delegation.startedAt : Date.now(),
      failedAt: Date.now(),
      error: "Delegation interrupted by server restart",
    }

    await Store.update(failed)

    // Attempt to notify parent session, but parent may also be gone
    // Notification errors are expected and should not halt cleanup
    try {
      await notifyCompletion(failed)
    } catch (error) {
      // Ignore notification errors during cleanup - parent session may be orphaned too
      log.warn("Failed to notify orphaned delegation", {
        delegationId: delegation.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Handle batch completion for orphaned delegations
    if (delegation.batchId) {
      // Re-register orphan with batch (batch state lost on restart)
      DelegationManager.registerBatch(
        delegation.batchId,
        delegation.parentSessionID,
        delegation.id,
        delegation.description,
      )

      // Mark task as failed in batch
      DelegationManager.markTaskFailed(delegation.batchId, delegation.id, "Delegation interrupted by server restart")

      // Check if batch is now complete
      if (
        DelegationManager.isBatchComplete(delegation.batchId) &&
        !DelegationManager.isBatchNotified(delegation.batchId)
      ) {
        DelegationManager.markBatchNotified(delegation.batchId)

        const batchResults = DelegationManager.getBatchResults(delegation.batchId)
        if (batchResults) {
          try {
            await notifyBatchCompletion({
              batchId: batchResults.batchId,
              parentSessionID: batchResults.parentSessionID,
              results: batchResults.results,
            })
          } catch (error) {
            log.warn("Failed to send batch completion notification for orphaned delegations", {
              batchId: delegation.batchId,
              error,
            })
          }
          DelegationManager.cleanupBatch(delegation.batchId)
        }
      }
    }
  }

  log.info("Orphan cleanup complete")
}
