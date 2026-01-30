import { SessionPrompt } from "../session/prompt"
import { DelegationStore } from "./store"
import type { DelegationInfo } from "./types"
import { Log } from "../util/log"

const log = Log.create({ service: "delegation-notification" })

export namespace DelegationNotification {
  /**
   * Send a completion notification for a delegation.
   *
   * Uses noReply logic:
   * - Per-task notification: Always noReply = true (just inject message)
   * - All-complete notification: noReply = false (wake model)
   */
  export async function sendCompletion(parentSessionId: string, delegation: DelegationInfo): Promise<void> {
    log.info("sendCompletion", {
      parentSessionId,
      delegationId: delegation.id,
      status: delegation.status,
    })

    // Get active count to determine if other tasks are still active
    const activeCount = await DelegationStore.getActiveCount(parentSessionId)
    log.info("activeCount", { activeCount })

    // Determine if this is the last task
    const isLastTask = activeCount === 0

    // Build the notification message
    let notificationMessage = `<task-notification>
<task-id>${delegation.id}</task-id>
<status>${delegation.status}</status>
<summary>${delegation.description} (${delegation.agent})</summary>
</task-notification>`

    // If tasks are still running, add a reminder
    if (!isLastTask) {
      notificationMessage += `\n\n**${activeCount} delegation${activeCount === 1 ? "" : "s"} still in progress.** You WILL be notified when ALL complete.
❌ Do NOT poll \`delegation_list\` - continue productive work.`
    }

    // Determine if we should send the all-complete notification
    let shouldSendAllComplete = false

    if (isLastTask) {
      // Try to set the wake latch
      const gotWakeLatch = await DelegationStore.trySetWakeLatch(parentSessionId)
      log.info("trySetWakeLatch", { gotWakeLatch })

      if (gotWakeLatch) {
        // We successfully set the wake latch, so we should send all-complete
        shouldSendAllComplete = true
        log.info("will send all-complete - last task completed and got wake latch")
      } else {
        // Someone else already triggered wake
        log.info("not sending all-complete - wake latch already set")
      }
    }

    // Send the per-task completion notification (ALWAYS noReply: true)
    log.info("sending per-task completion notification", {
      delegationId: delegation.id,
      isLastTask,
      shouldSendAllComplete,
    })

    await SessionPrompt.prompt({
      sessionID: parentSessionId,
      parts: [
        {
          type: "text",
          text: notificationMessage,
        },
      ],
      noReply: true,
    })

    // If this was the last task and we got the wake latch, send "all complete" message
    if (shouldSendAllComplete) {
      log.info("sending all complete notification")
      await SessionPrompt.prompt({
        sessionID: parentSessionId,
        parts: [
          {
            type: "text",
            text: `<task-notification>
<status>all-complete</status>
<summary>All delegations complete.</summary>
</task-notification>`,
          },
        ],
        noReply: false,
      })
    }
  }
}
