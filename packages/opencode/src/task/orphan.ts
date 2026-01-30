import { Task } from "./types.js"
import { Store } from "./store.js"
import { notifyCompletion, notifyBatchCompletion } from "./notification.js"
import { TaskManager } from "./manager.js"
import { Log } from "../util/log"

const log = Log.create({ service: "task.orphan" })

/**
 * Initialize orphan cleanup on server startup.
 * Finds all tasks that were queued or running when the server crashed/restarted
 * and marks them as failed with a descriptive error.
 */
export async function initOrphanCleanup(): Promise<void> {
  log.info("Starting orphan cleanup")

  const all = await Store.listAll()

  for (const task of all) {
    // Mark BOTH queued and running tasks as failed
    if (task.status !== "queued" && task.status !== "running") {
      continue
    }

    log.info("Cleaning orphaned task", {
      taskId: task.id,
      status: task.status,
      description: task.description,
    })

    // This task was interrupted by server restart
    const failed: Task.TaskFailed = {
      ...task,
      status: "failed",
      startedAt: task.status === "running" ? task.startedAt : Date.now(),
      failedAt: Date.now(),
      error: "Task interrupted by server restart",
    }

    await Store.update(failed)

    // Attempt to notify parent session, but parent may also be gone
    // Notification errors are expected and should not halt cleanup
    try {
      await notifyCompletion(failed)
    } catch (error) {
      // Ignore notification errors during cleanup - parent session may be orphaned too
      log.warn("Failed to notify orphaned task", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Handle batch completion for orphaned tasks
    if (task.batchId) {
      // Re-register orphan with batch (batch state lost on restart)
      TaskManager.registerBatch(task.batchId, task.parentSessionID, task.id, task.description)

      // Mark task as failed in batch
      TaskManager.markTaskFailed(task.batchId, task.id, "Task interrupted by server restart")

      // Check if batch is now complete
      if (TaskManager.isBatchComplete(task.batchId) && !TaskManager.isBatchNotified(task.batchId)) {
        TaskManager.markBatchNotified(task.batchId)

        const batchResults = TaskManager.getBatchResults(task.batchId)
        if (batchResults) {
          try {
            await notifyBatchCompletion({
              batchId: batchResults.batchId,
              parentSessionID: batchResults.parentSessionID,
              results: batchResults.results,
            })
          } catch (error) {
            log.warn("Failed to send batch completion notification for orphaned tasks", {
              batchId: task.batchId,
              error,
            })
          }
          TaskManager.cleanupBatch(task.batchId)
        }
      }
    }
  }

  log.info("Orphan cleanup complete")
}
