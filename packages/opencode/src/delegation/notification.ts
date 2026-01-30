import { SessionPrompt } from "../session/prompt.js"
import { Delegation } from "./types.js"
import { escape, cdata } from "../util/xml"
import { Log } from "../util/log"
import { DelegationManager } from "./manager.js"
import { reminderRemaining, reminderFinal } from "./anti-polling.js"

const log = Log.create({ service: "delegation.notification" })

export async function notifyCompletion(
  delegation: Delegation.DelegationCompleted | Delegation.DelegationFailed,
): Promise<void> {
  const status = delegation.status
  const id = delegation.id
  const description = escape(delegation.description)

  // Check if there are remaining delegations in the session
  let antiPollingNote = ""
  try {
    const allDelegations = await DelegationManager.list(delegation.parentSessionID)
    const remainingCount = allDelegations.filter((d) => d.status === "queued" || d.status === "running").length

    if (remainingCount > 0) {
      antiPollingNote = `\n\n${reminderRemaining(remainingCount)}`
    } else {
      antiPollingNote = `\n\n${reminderFinal()}`
    }
  } catch (error) {
    // Fallback if we can't get delegation list
    antiPollingNote = `\n\n${reminderFinal()}`
  }

  let message: string
  if (delegation.status === "completed") {
    message = `<task-notification>
<task-id>${escape(id)}</task-id>
<status>complete</status>
<summary>Task "${description}" completed successfully</summary>
<result>${cdata(delegation.result)}</result>
</task-notification>${antiPollingNote}`
  } else {
    message = `<task-notification>
<task-id>${escape(id)}</task-id>
<status>failed</status>
<summary>Task "${description}" failed</summary>
<error>${escape(delegation.error)}</error>
</task-notification>${antiPollingNote}`
  }

  // Inject the notification into the parent session WITHOUT triggering a model response
  try {
    await SessionPrompt.prompt({
      sessionID: delegation.parentSessionID,
      noReply: true, // Critical: don't trigger model response
      parts: [{ type: "text", text: message }],
    })
  } catch (error) {
    // Catch and log notification failures; do not fail delegation because notification failed
    log.error("Failed to send notification", {
      delegationId: delegation.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
