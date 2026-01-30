import z from "zod"
import { Tool } from "./tool.js"
import { DelegationManager } from "../delegation/manager.js"
import { taskReadAfterNotification, standardWarning } from "../delegation/anti-polling.js"

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

    // Format output based on status
    let output: string
    const status = delegation.status
    switch (status) {
      case "queued":
        output = `Status: Queued (waiting to start)\nDescription: ${delegation.description}\nAgent: ${delegation.agent}\n\n⏳ Task still running. ${standardWarning()}`
        break
      case "running":
        output = `Status: Running\nDescription: ${delegation.description}\nAgent: ${delegation.agent}\nStarted: ${new Date(delegation.startedAt).toISOString()}\n\n⏳ Task still running. ${standardWarning()}`
        break
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
