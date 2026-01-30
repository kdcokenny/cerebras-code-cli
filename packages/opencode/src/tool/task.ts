import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Agent } from "../agent/agent"
import { TaskManager } from "../task/manager"
import { taskOutputReminder, taskReadAfterNotification, systemRules } from "../task/anti-polling"

export const TaskTool = Tool.define("task", async () => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
  const description = DESCRIPTION.replace(
    "{agents}",
    agents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  ).replace("{systemRules}", systemRules())
  return {
    description,
    parameters: z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use for this task"),
    }),
    async execute(params, ctx) {
      // Guard: ctx.callID must be present
      if (!ctx.callID) {
        throw new Error("ctx.callID is missing. This tool requires a valid callID for task tracking.")
      }

      // 1. Validate agent exists
      const agent = await Agent.get(params.subagent_type)
      if (!agent) {
        throw new Error(`Unknown agent type: ${params.subagent_type}`)
      }

      // 2. Start async task
      const taskId = await TaskManager.start({
        sessionID: ctx.sessionID,
        parentMessageID: ctx.messageID,
        parentPartID: ctx.callID, // The ToolPart ID for streaming updates
        parentCallID: ctx.callID, // The callID to find parent ToolPart
        description: params.description,
        agent: params.subagent_type,
        prompt: params.prompt,
        batchId: ctx.messageID, // Use message ID as batch ID - all tasks in same turn share this
      })

      // 3. Return immediately with task info
      return {
        title: params.description,
        metadata: {
          taskId,
          summary: [] as Array<{
            id: string
            tool: string
            state: { status: string; title?: string }
          }>, // Will be populated by runner streaming
          sessionId: undefined as string | undefined, // Will be set by runner when child session starts
        },
        output: [
          `Task started: ${taskId}`,
          "",
          "The task is running in the background. You will be notified when it completes.",
          taskReadAfterNotification(),
          "",
          taskOutputReminder(),
        ].join("\n"),
      }
    },
  }
})
