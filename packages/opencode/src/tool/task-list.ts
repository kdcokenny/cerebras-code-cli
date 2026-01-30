import { z } from "zod"
import { Tool } from "./tool"
import { DelegationStore } from "../delegation/store"

export const TaskListTool = Tool.define("task_list", {
  description: `List all background tasks for the current session.

Shows task IDs, status, description, and agent type. Does NOT include full results - use task_read for that.

⚠️ DO NOT poll this tool. You WILL be notified when tasks complete.`,
  parameters: z.object({}),
  execute: async (_input, ctx) => {
    const delegations = await DelegationStore.list(ctx.sessionID)

    if (delegations.length === 0) {
      return {
        title: "Tasks",
        output: "No tasks found for this session.",
        metadata: {},
      }
    }

    // Build a table of tasks
    const lines = [
      "ID                    | Status    | Description                        | Agent",
      "----------------------|-----------|------------------------------------|---------",
    ]

    for (const d of delegations) {
      const id = d.id.padEnd(21)
      const status = d.status.padEnd(9)
      const desc = d.description.slice(0, 35).padEnd(35)
      const agent = d.agent
      lines.push(`${id} | ${status} | ${desc} | ${agent}`)
    }

    // Add anti-polling warning
    lines.push("")
    lines.push("⚠️ DO NOT poll this tool. You WILL be notified when tasks complete.")

    return {
      title: "Tasks",
      output: lines.join("\n"),
      metadata: {},
    }
  },
})
