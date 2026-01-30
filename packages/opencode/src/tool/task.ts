import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { DelegationManager } from "../delegation/manager"

export const TaskTool = Tool.define("task", async () => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
  const description = DESCRIPTION.replace(
    "{agents}",
    agents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters: z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use for this task"),
    }),
    async execute(params, ctx) {
      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      // Find parent ToolPart by callID
      const parentMessage = await MessageV2.get({
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
      })
      const parentPart = parentMessage?.parts.find(
        (p): p is MessageV2.ToolPart => p.type === "tool" && p.callID === ctx.callID,
      )

      if (!parentPart) {
        return {
          title: params.description,
          output: "Error: Could not find parent tool part. Task not started.",
          metadata: {
            delegationId: undefined as string | undefined,
          },
        }
      }

      // Call ctx.metadata immediately with initial state
      ctx.metadata({
        title: params.description,
        metadata: { sessionId: "pending" },
      })

      // Start the delegation (returns immediately)
      const delegationId = await DelegationManager.start({
        description: params.description,
        prompt: params.prompt,
        agent: params.subagent_type,
        parentSessionId: ctx.sessionID,
        parentMessageId: ctx.messageID,
        parentCallID: ctx.callID!,
      })

      // Return immediately with delegation ID and anti-polling warning
      return {
        title: params.description,
        output: `Task started: ${delegationId}

⚠️ DO NOT poll task_list or task_read. You WILL be notified when the task completes.
Continue with other work while this task runs in the background.`,
        metadata: { delegationId },
      }
    },
  }
})
