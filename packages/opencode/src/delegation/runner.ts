import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Identifier } from "../id/id"
import { DelegationStore } from "./store"
import type { DelegationInfo } from "./types"
import { Log } from "../util/log"
import { DelegationNotification } from "./notification"

const log = Log.create({ service: "delegation-runner" })

export namespace DelegationRunner {
  /**
   * Run a delegation in the background. This function should NOT be awaited
   * by the caller - it handles its own completion and error states.
   */
  export async function run(delegation: DelegationInfo & { status: "queued" }): Promise<void> {
    try {
      // 1. Get the agent configuration
      const agent = await Agent.get(delegation.agent)
      if (!agent) {
        throw new Error(`Unknown agent type: ${delegation.agent}`)
      }

      // 2. Get parent message to determine model
      const parentMessage = await MessageV2.get({
        sessionID: delegation.parentSessionId,
        messageID: delegation.parentMessageId,
      })

      // 3. Create child session
      const childSession = await Session.create({
        parentID: delegation.parentSessionId,
        title: delegation.description + ` (@${agent.name} subagent)`,
      })

      // 4. Transition to running
      await DelegationStore.markRunning(delegation.parentSessionId, delegation.id, childSession.id)

      // 5. Find parent ToolPart by callID
      const parentPart = parentMessage.parts.find((p) => p.type === "tool" && p.callID === delegation.parentCallID)

      // 6. Subscribe to child session PartUpdated events to stream progress
      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}

      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
        if (event.properties.part.sessionID !== childSession.id) return
        if (event.properties.part.type !== "tool") return

        const part = event.properties.part

        // Accumulate child tool parts
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }

        // Update parent ToolPart with summary (same pattern as TaskTool)
        if (parentPart && parentPart.type === "tool" && parentPart.state.status === "running") {
          await Session.updatePart({
            ...parentPart,
            state: {
              status: "running",
              title: delegation.description,
              input: {
                prompt: delegation.prompt,
                description: delegation.description,
                subagent_type: delegation.agent,
              },
              metadata: {
                summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
                sessionId: childSession.id,
              },
              time: {
                start: parentPart.state.time.start,
              },
            },
          })
        }
      })

      try {
        // 7. Prepare prompt parts
        const messageID = Identifier.ascending("message")
        const promptParts = await SessionPrompt.resolvePromptParts(delegation.prompt)

        // 8. Determine model (same logic as TaskTool)
        const model = agent.model ?? {
          modelID: parentMessage.info.role === "assistant" ? parentMessage.info.modelID : "claude-3-5-sonnet-20241022",
          providerID: parentMessage.info.role === "assistant" ? parentMessage.info.providerID : "anthropic",
        }

        // 9. Run the child session (this is the blocking part)
        const result = await SessionPrompt.prompt({
          messageID,
          sessionID: childSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            ...agent.tools,
            todowrite: false,
            todoread: false,
            task: false,
          },
          parts: promptParts,
        })

        // 10. Build final result text (extract text parts from last message)
        const resultText = result.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as MessageV2.TextPart).text)
          .join("\n")

        // 11. Transition to completed
        await DelegationStore.markCompleted(delegation.parentSessionId, delegation.id, resultText)

        // 12. Get all tool parts from child session for final summary
        const messages = await Session.messages({ sessionID: childSession.id })
        const summary = messages
          .filter((x) => x.info.role === "assistant")
          .flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
          .map((part) => ({
            id: part.id,
            tool: part.tool,
            state: {
              status: part.state.status,
              title: part.state.status === "completed" ? part.state.title : undefined,
            },
          }))

        // 13. Update parent ToolPart to completed
        if (parentPart && parentPart.type === "tool") {
          await Session.updatePart({
            ...parentPart,
            state: {
              status: "completed",
              title: delegation.description,
              input: {
                prompt: delegation.prompt,
                description: delegation.description,
                subagent_type: delegation.agent,
              },
              output: `Task completed. Use task_read("${delegation.id}") for full result.`,
              metadata: {
                summary,
                sessionId: childSession.id,
              },
              time: {
                start: parentPart.state.status === "running" ? parentPart.state.time.start : Date.now(),
                end: Date.now(),
              },
            },
          })
        }

        // 14. Send completion notification (best effort - don't let failure corrupt state)
        try {
          await DelegationNotification.sendCompletion(
            delegation.parentSessionId,
            (await DelegationStore.get(delegation.parentSessionId, delegation.id)) as DelegationInfo,
          )
        } catch (notifyError) {
          log.error("Failed to send completion notification", {
            delegationId: delegation.id,
            error: notifyError instanceof Error ? notifyError.message : String(notifyError),
          })
          // Do NOT re-throw - state is already committed
        }
      } finally {
        // 15. Unsubscribe from events
        unsub()
      }

      log.info("Delegation completed", { delegationId: delegation.id })
    } catch (error) {
      // Handle failure
      log.error("Delegation failed", { delegationId: delegation.id, error })

      await DelegationStore.markFailed(delegation.parentSessionId, delegation.id, {
        message: error instanceof Error ? error.message : String(error),
      })

      // Update parent ToolPart to error state
      const parentMessage = await MessageV2.get({
        sessionID: delegation.parentSessionId,
        messageID: delegation.parentMessageId,
      }).catch(() => null)

      if (parentMessage) {
        const parentPart = parentMessage.parts.find((p) => p.type === "tool" && p.callID === delegation.parentCallID)

        if (parentPart && parentPart.type === "tool") {
          await Session.updatePart({
            ...parentPart,
            state: {
              status: "error",
              input: {
                prompt: delegation.prompt,
                description: delegation.description,
                subagent_type: delegation.agent,
              },
              error: error instanceof Error ? error.message : String(error),
              metadata: parentPart.state.status === "running" ? parentPart.state.metadata : {},
              time: {
                start: parentPart.state.status === "running" ? parentPart.state.time.start : Date.now(),
                end: Date.now(),
              },
            },
          })
        }
      }

      // Send completion notification (failure is still a completion) - best effort
      try {
        await DelegationNotification.sendCompletion(
          delegation.parentSessionId,
          (await DelegationStore.get(delegation.parentSessionId, delegation.id)) as DelegationInfo,
        )
      } catch (notifyError) {
        log.error("Failed to send failure notification", {
          delegationId: delegation.id,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        })
        // Do NOT re-throw - state is already committed
      }
    }
  }
}
