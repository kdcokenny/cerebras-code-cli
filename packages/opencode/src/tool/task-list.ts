import { z } from "zod"
import { Tool } from "./tool.js"
import { DelegationManager } from "../delegation/manager.js"
import { taskOutputReminder, taskReadAfterNotification } from "../delegation/anti-polling.js"
import { Permission } from "../permission"

export const TaskListTool = Tool.define("task_list", {
  description: `List all delegated background tasks in the current session. Shows task IDs, descriptions, and status. ${taskOutputReminder()} ${taskReadAfterNotification()}`,
  parameters: z.object({
    session_id: z.string().optional().describe("The session ID to list tasks for. Defaults to current session."),
  }),
  async execute(params, ctx) {
    const sessionID = params.session_id ?? ctx.sessionID
    const delegations = await DelegationManager.list(sessionID)

    if (delegations.length === 0) {
      return {
        title: "No tasks found",
        metadata: {},
        output: `No delegated tasks found in this session.\n\n${taskOutputReminder()} ${taskReadAfterNotification()}`,
      }
    }

    // Hard block: prevent polling while tasks are running
    const hasRunning = delegations.some((d) => d.status === "queued" || d.status === "running")
    if (hasRunning) {
      throw new Permission.RejectedError(
        ctx.sessionID,
        "polling_forbidden",
        ctx.callID,
        {
          running_count: delegations.filter((d) => d.status === "queued" || d.status === "running").length,
        },
        "🚫 POLLING IS FORBIDDEN. TASKS ARE STILL RUNNING. WAIT FOR <BATCH-COMPLETE>.",
      )
    }

    // Format the list
    const lines = delegations.map((d) => {
      const statusIcon = {
        queued: "⏳",
        running: "⏳",
        completed: "✅",
        failed: "❌",
      }[d.status]
      return `${statusIcon} ${d.id} - ${d.description} (${d.status})`
    })

    return {
      title: `${delegations.length} task(s) found`,
      metadata: {},
      output: lines.join("\n") + `\n\n${taskOutputReminder()} ${taskReadAfterNotification()}`,
    }
  },
})
