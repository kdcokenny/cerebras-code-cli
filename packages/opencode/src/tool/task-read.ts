import { z } from "zod"
import { Tool } from "./tool"
import { DelegationStore } from "../delegation/store"

export const TaskReadTool = Tool.define("task_read", async () => {
  return {
    description: `Read the result of a background task by its ID.

Use this tool to retrieve the full result of a completed delegation.

⚠️ DO NOT poll this tool while tasks are running. You WILL be notified when tasks complete.`,
    parameters: z.object({
      id: z.string().describe("The task ID (e.g., 'swift-amber-falcon')"),
    }),
    async execute(input, ctx) {
      const delegation = await DelegationStore.get(ctx.sessionID, input.id)

      if (!delegation) {
        return {
          title: `Task: ${input.id}`,
          output: `Task not found: ${input.id}

This task ID does not exist in the current session.`,
          metadata: {},
        }
      }

      if (delegation.status === "queued" || delegation.status === "running") {
        return {
          title: `Task: ${input.id} (${delegation.status})`,
          output: `Task is still ${delegation.status}.

⚠️ DO NOT poll this tool. You WILL be notified when the task completes.
Continue with other work.`,
          metadata: {},
        }
      }

      if (delegation.status === "failed") {
        return {
          title: `Task: ${input.id} (failed)`,
          output: `Task failed: ${delegation.error.message}${delegation.error.code ? ` (${delegation.error.code})` : ""}`,
          metadata: {},
        }
      }

      // status === "completed"
      return {
        title: `Task: ${input.id}`,
        output: delegation.result,
        metadata: {},
      }
    },
  }
})
