import z from "zod"
import { Tool } from "./tool.js"
import { TaskManager } from "../task/manager.js"
import { taskReadAfterNotification, standardWarning } from "../task/anti-polling.js"
import { Permission } from "../permission"

export const TaskReadTool = Tool.define("task_read", {
  description: `Read the status and result of a delegated background task. ${taskReadAfterNotification()} ${standardWarning()}`,
  parameters: z.object({
    id: z.string().describe("The task ID to read (e.g., 'swift-amber-falcon')"),
    session_id: z
      .string()
      .optional()
      .describe("The session ID where the task was created. Defaults to current session."),
  }),
  async execute(params, ctx) {
    const sessionID = params.session_id ?? ctx.sessionID
    const task = await TaskManager.get(sessionID, params.id)

    if (!task) {
      return {
        title: `Task not found: ${params.id}`,
        metadata: {},
        output: `No task found with ID "${params.id}" in session "${sessionID}".`,
      }
    }

    // Hard block: prevent polling on running tasks
    const status = task.status
    if (status === "queued" || status === "running") {
      throw new Permission.RejectedError(
        ctx.sessionID,
        "polling_forbidden",
        ctx.callID,
        {
          task_id: params.id,
          task_status: task.status,
        },
        "🚫 POLLING IS FORBIDDEN. TASK IS STILL RUNNING. WAIT FOR <BATCH-COMPLETE>.",
      )
    }

    // Format output based on status
    let output: string
    switch (status) {
      case "completed":
        output = `Status: Completed\nDescription: ${task.description}\nAgent: ${task.agent}\nResult:\n${task.result}`
        break
      case "failed":
        output = `Status: Failed\nDescription: ${task.description}\nAgent: ${task.agent}\nError: ${task.error}`
        break
    }

    return {
      title: `Task ${params.id}: ${status}`,
      metadata: {},
      output,
    }
  },
})
