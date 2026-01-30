import z from "zod"
import { Tool } from "./tool.js"
import { DelegationManager } from "../delegation/manager.js"
import { taskReadAfterNotification, standardWarning } from "../delegation/anti-polling.js"
import { Permission } from "../permission"

export const TaskReadTool = Tool.define("task_read", {
  description: `Read the status and result of a delegated background task. ${taskReadAfterNotification()} ${standardWarning()}`,
  parameters: z.object({
    id: z.string().describe("The delegation ID to read (e.g., 'swift-amber-falcon')"),
    session_id: z
      .string()
      .optional()
      .describe("The session ID where the task was created. Defaults to current session."),
  }),
  async execute(params, ctx) {
    const sessionID = params.session_id ?? ctx.sessionID
    const delegation = await DelegationManager.get(sessionID, params.id)

    if (!delegation) {
      return {
        title: `Task not found: ${params.id}`,
        metadata: {},
        output: `No delegation found with ID "${params.id}" in session "${sessionID}".`,
      }
    }

    // Hard block: prevent polling on running tasks
    const status = delegation.status
    if (status === "queued" || status === "running") {
      throw new Permission.RejectedError(
        ctx.sessionID,
        "polling_forbidden",
        ctx.callID,
        {
          task_id: params.id,
          task_status: delegation.status,
        },
        "🚫 POLLING IS FORBIDDEN. TASK IS STILL RUNNING. WAIT FOR <BATCH-COMPLETE>.",
      )
    }

    // Format output based on status
    let output: string
    switch (status) {
      case "completed":
        output = `Status: Completed\nDescription: ${delegation.description}\nAgent: ${delegation.agent}\nResult:\n${delegation.result}`
        break
      case "failed":
        output = `Status: Failed\nDescription: ${delegation.description}\nAgent: ${delegation.agent}\nError: ${delegation.error}`
        break
    }

    return {
      title: `Task ${params.id}: ${status}`,
      metadata: {},
      output,
    }
  },
})
