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

const MAX_RESULT_LENGTH = 10 * 1024 // 10KB

function truncateResult(text: string): string {
  if (text.length <= MAX_RESULT_LENGTH) return text
  return text.slice(0, MAX_RESULT_LENGTH) + "\n\n[truncated - use task_read(id) for full content]"
}

export interface BatchResult {
  id: string
  status: "completed" | "failed"
  description: string
  result?: string
  error?: string
}

export interface BatchCompletionInput {
  batchId: string
  parentSessionID: string
  results: BatchResult[]
}

export async function notifyBatchCompletion(input: BatchCompletionInput): Promise<void> {
  const { batchId, parentSessionID, results } = input

  // Build XML for each task
  const tasksXml = results
    .map((task) => {
      if (task.status === "completed") {
        return `  <task id="${escape(task.id)}" status="completed">
    <description>${escape(task.description)}</description>
    <result>${cdata(truncateResult(task.result ?? ""))}</result>
  </task>`
      } else {
        return `  <task id="${escape(task.id)}" status="failed">
    <description>${escape(task.description)}</description>
    <error>${cdata(task.error ?? "Unknown error")}</error>
  </task>`
      }
    })
    .join("\n")

  const message = `<batch-complete batch-id="${escape(batchId)}">
${tasksXml}
</batch-complete>`

  // Inject with synthetic: true (hidden from user) and noReply: false (wake agent)
  await SessionPrompt.prompt({
    sessionID: parentSessionID,
    noReply: false, // Wake the agent!
    parts: [
      {
        type: "text",
        text: message,
        synthetic: true, // Hidden from user, visible to agent
      },
    ],
  })
}
