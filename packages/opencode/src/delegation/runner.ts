import { Log } from "../util/log"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Config } from "../config/config"
import { Delegation } from "./types"
import { Store } from "./store"
import { notifyBatchCompletion } from "./notification"
import { DelegationManager } from "./manager"

/**
 * Handle batch-aware completion notification.
 * Marks the task as complete/failed in its batch, then checks if the entire batch
 * is complete. If so, sends consolidated batch notification.
 */
async function handleBatchCompletion(
  batchId: string | undefined,
  delegationId: string,
  status: "completed" | "failed",
  resultOrError: string,
  description: string,
): Promise<void> {
  // If no batchId, fall back to individual notification for backwards compatibility
  if (!batchId) {
    return
  }

  // Mark task in batch
  if (status === "completed") {
    DelegationManager.markTaskComplete(batchId, delegationId, resultOrError)
  } else {
    DelegationManager.markTaskFailed(batchId, delegationId, resultOrError)
  }

  // Check if batch is complete and not already notified
  if (DelegationManager.isBatchComplete(batchId) && !DelegationManager.isBatchNotified(batchId)) {
    const batchResults = DelegationManager.getBatchResults(batchId)
    if (batchResults) {
      try {
        await notifyBatchCompletion({
          batchId: batchResults.batchId,
          parentSessionID: batchResults.parentSessionID,
          results: batchResults.results,
        })
        // Only mark notified on SUCCESS
        DelegationManager.markBatchNotified(batchId)
      } finally {
        // Always cleanup, even if notification fails
        DelegationManager.cleanupBatch(batchId)
      }
    }
  }
}

export namespace DelegationRunner {
  const log = Log.create({ service: "delegation.runner" })

  /**
   * Run a single delegation from queued to completed/failed state.
   * This is a fire-and-forget function - it handles its own lifecycle.
   *
   * Architecture: Per-delegation runner (no global loop).
   */
  export async function run(delegation: Delegation.DelegationQueued): Promise<void> {
    log.info("Running delegation", { delegationId: delegation.id, agent: delegation.agent })

    const startedAt = Date.now()
    let childSessionID: string | undefined = undefined

    try {
      // 1. Get configuration for timeout
      const config = await Config.get()
      const timeoutMs = config.delegation?.timeoutMs ?? 15 * 60 * 1000

      // 2. Get or create child session
      const agent = await Agent.get(delegation.agent)
      if (!agent) {
        throw new Error(`Unknown agent type: ${delegation.agent}`)
      }

      const childSession = await Session.create({
        parentID: delegation.parentSessionID,
        title: delegation.description + ` (@${agent.name} delegation)`,
      })
      childSessionID = childSession.id

      // 3. Transition to running state
      const runningDelegation: Delegation.DelegationRunning = {
        ...delegation,
        status: "running",
        childSessionID: childSession.id,
        startedAt,
      }
      await Store.update(runningDelegation)

      // 4. Find parent ToolPart by parentCallID (not parentPartID!)
      let parentMessage: MessageV2.WithParts | undefined
      let parentPart: MessageV2.ToolPart | undefined

      try {
        parentMessage = await MessageV2.get({
          sessionID: delegation.parentSessionID,
          messageID: delegation.parentMessageID,
        })

        parentPart = parentMessage.parts.find(
          (p): p is MessageV2.ToolPart => p.type === "tool" && p.callID === delegation.parentCallID,
        )
      } catch (error) {
        log.warn("Could not find parent message/part for streaming updates", {
          delegationId: delegation.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // 5. Track child tool parts for streaming updates
      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}

      // 6. Subscribe to Bus events BEFORE starting prompt
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== childSession.id) return
        if (evt.properties.part.type !== "tool") return

        const part = evt.properties.part
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }

        // Update parent ToolPart with streaming progress (only update metadata)
        if (parentPart) {
          try {
            // Only update if part is in a state that has these properties
            if (
              parentPart.state.status === "completed" ||
              parentPart.state.status === "running" ||
              parentPart.state.status === "error"
            ) {
              const existingTime = parentPart.state.time
              const hasEnd = "end" in existingTime

              await Session.updatePart({
                id: parentPart.id,
                messageID: delegation.parentMessageID,
                sessionID: delegation.parentSessionID,
                type: "tool",
                tool: parentPart.tool,
                callID: parentPart.callID,
                state: {
                  status: "completed", // Keep status as completed (per requirement)
                  input: parentPart.state.input,
                  output: parentPart.state.status === "completed" ? parentPart.state.output : "",
                  title:
                    parentPart.state.status === "completed" || parentPart.state.status === "running"
                      ? parentPart.state.title || delegation.description
                      : delegation.description,
                  metadata: {
                    ...(parentPart.state.metadata || {}),
                    summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
                    sessionId: childSession.id,
                  },
                  time: hasEnd
                    ? (existingTime as { start: number; end: number })
                    : { start: existingTime.start, end: Date.now() },
                },
              })
            }
          } catch (error) {
            // Wrap in try/catch to avoid unhandled rejections if parent part disappears
            log.warn("Failed to update parent part during streaming", {
              delegationId: delegation.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })

      // 7. Get the parent message to inherit model settings
      const parentMsg = await MessageV2.get({
        sessionID: delegation.parentSessionID,
        messageID: delegation.parentMessageID,
      })

      const model = agent.model ?? {
        modelID: parentMsg.info.role === "assistant" ? parentMsg.info.modelID : "gpt-4",
        providerID: parentMsg.info.role === "assistant" ? parentMsg.info.providerID : "openai",
      }

      // 8. Resolve prompt parts
      const promptParts = await SessionPrompt.resolvePromptParts(delegation.prompt)

      // 10. Create a promise that rejects on timeout
      const messageID = Identifier.ascending("message")
      const executionPromise = SessionPrompt.prompt({
        messageID,
        sessionID: childSession.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          task: false,
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          ...agent.tools,
        },
        parts: promptParts,
      })

      let timeoutHandle: Timer | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          SessionPrompt.cancel(childSession.id)
          reject(new Error(`Delegation timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      })

      try {
        // 11. Race execution against timeout
        const result = await Promise.race([executionPromise, timeoutPromise])

        // 12. Unsubscribe from Bus events
        unsub()

        // 13. Build final summary from session messages
        const messages = await Session.messages({ sessionID: childSession.id })
        const summary = messages
          .filter((x) => x.info.role === "assistant")
          .flatMap((msg) => {
            return msg.parts.filter((x): x is MessageV2.ToolPart => x.type === "tool")
          })
          .map((part) => ({
            id: part.id,
            tool: part.tool,
            state: {
              status: part.state.status,
              title: part.state.status === "completed" ? part.state.title : undefined,
            },
          }))

        const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

        const output =
          text + "\n\n" + ["<task_metadata>", `session_id: ${childSession.id}`, "</task_metadata>"].join("\n")

        // 14. Update delegation to completed state
        const completedDelegation: Delegation.DelegationCompleted = {
          ...runningDelegation,
          status: "completed",
          completedAt: Date.now(),
          result: output,
        }
        await Store.update(completedDelegation)

        // 15. Final update to parent ToolPart with complete summary
        if (parentPart) {
          try {
            await Session.updatePart({
              id: parentPart.id,
              messageID: delegation.parentMessageID,
              sessionID: delegation.parentSessionID,
              type: "tool",
              tool: parentPart.tool,
              callID: parentPart.callID,
              state: {
                status: "completed",
                input: parentPart.state.input,
                output,
                title: delegation.description,
                metadata: {
                  delegationId: delegation.id,
                  summary,
                  sessionId: childSession.id,
                },
                time: { start: delegation.createdAt, end: Date.now() },
              },
            })
          } catch (error) {
            log.warn("Failed to update parent part on completion", {
              delegationId: delegation.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        log.info("Delegation completed", { delegationId: delegation.id, duration: Date.now() - startedAt })

        // 16. Handle batch completion (replaces per-task notification)
        try {
          await handleBatchCompletion(delegation.batchId, delegation.id, "completed", output, delegation.description)
        } catch (error) {
          log.error("Failed to handle batch completion", {
            delegationId: delegation.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } catch (error) {
        // Unsubscribe on error
        unsub()
        throw error
      } finally {
        // Clear timeout timer
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
      }
    } catch (error) {
      // Handle failure
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error("Delegation failed", { delegationId: delegation.id, error: errorMessage })

      const failedDelegation: Delegation.DelegationFailed = {
        ...delegation,
        status: "failed",
        childSessionID: childSessionID,
        startedAt,
        failedAt: Date.now(),
        error: errorMessage,
      }
      await Store.update(failedDelegation)

      // Update parent ToolPart with error info
      try {
        const parentMsg = await MessageV2.get({
          sessionID: delegation.parentSessionID,
          messageID: delegation.parentMessageID,
        })

        const parentPart = parentMsg.parts.find(
          (p): p is MessageV2.ToolPart => p.type === "tool" && p.callID === delegation.parentCallID,
        )

        if (parentPart) {
          await Session.updatePart({
            id: parentPart.id,
            messageID: delegation.parentMessageID,
            sessionID: delegation.parentSessionID,
            type: "tool",
            tool: parentPart.tool,
            callID: parentPart.callID,
            state: {
              status: "error",
              input: parentPart.state.input,
              error: errorMessage,
              metadata: {
                delegationId: delegation.id,
                sessionId: childSessionID,
              },
              time: { start: delegation.createdAt, end: Date.now() },
            },
          })
        }
      } catch (updateError) {
        log.warn("Failed to update parent part on error", {
          delegationId: delegation.id,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        })
      }

      // Handle batch completion (failure is still a completion)
      try {
        await handleBatchCompletion(delegation.batchId, delegation.id, "failed", errorMessage, delegation.description)
      } catch (error) {
        log.error("Failed to handle batch completion", {
          delegationId: delegation.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
