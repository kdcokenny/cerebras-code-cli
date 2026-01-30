import { Log } from "../util/log"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Config } from "../config/config"
import { Task } from "./types"
import { Store } from "./store"
import { notifyBatchCompletion } from "./notification"
import { TaskManager } from "./manager"

/**
 * Handle batch-aware completion notification.
 * Marks the task as complete/failed in its batch, then checks if the entire batch
 * is complete. If so, sends consolidated batch notification.
 */
async function handleBatchCompletion(
  batchId: string | undefined,
  taskId: string,
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
    TaskManager.markTaskComplete(batchId, taskId, resultOrError)
  } else {
    TaskManager.markTaskFailed(batchId, taskId, resultOrError)
  }

  // Check if batch is complete and not already notified
  if (TaskManager.isBatchComplete(batchId) && !TaskManager.isBatchNotified(batchId)) {
    const batchResults = TaskManager.getBatchResults(batchId)
    if (batchResults) {
      try {
        await notifyBatchCompletion({
          batchId: batchResults.batchId,
          parentSessionID: batchResults.parentSessionID,
          results: batchResults.results,
        })
        // Only mark notified on SUCCESS
        TaskManager.markBatchNotified(batchId)
      } finally {
        // Always cleanup, even if notification fails
        TaskManager.cleanupBatch(batchId)
      }
    }
  }
}

export namespace TaskRunner {
  const log = Log.create({ service: "task.runner" })

  /**
   * Run a single task from queued to completed/failed state.
   * This is a fire-and-forget function - it handles its own lifecycle.
   *
   * Architecture: Per-task runner (no global loop).
   */
  export async function run(task: Task.TaskQueued): Promise<void> {
    log.info("Running task", { taskId: task.id, agent: task.agent })

    const startedAt = Date.now()
    let childSessionID: string | undefined = undefined

    try {
      // 1. Get configuration for timeout
      const config = await Config.get()
      const timeoutMs = config.task?.timeoutMs ?? 15 * 60 * 1000

      // 2. Get or create child session
      const agent = await Agent.get(task.agent)
      if (!agent) {
        throw new Error(`Unknown agent type: ${task.agent}`)
      }

      const childSession = await Session.create({
        parentID: task.parentSessionID,
        title: task.description + ` (@${agent.name} task)`,
      })
      childSessionID = childSession.id

      // 3. Transition to running state
      const runningTask: Task.TaskRunning = {
        ...task,
        status: "running",
        childSessionID: childSession.id,
        startedAt,
      }
      await Store.update(runningTask)

      // 4. Find parent ToolPart by parentCallID (not parentPartID!)
      let parentMessage: MessageV2.WithParts | undefined
      let parentPart: MessageV2.ToolPart | undefined

      try {
        parentMessage = await MessageV2.get({
          sessionID: task.parentSessionID,
          messageID: task.parentMessageID,
        })

        parentPart = parentMessage.parts.find(
          (p): p is MessageV2.ToolPart => p.type === "tool" && p.callID === task.parentCallID,
        )
      } catch (error) {
        log.warn("Could not find parent message/part for streaming updates", {
          taskId: task.id,
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
                messageID: task.parentMessageID,
                sessionID: task.parentSessionID,
                type: "tool",
                tool: parentPart.tool,
                callID: parentPart.callID,
                state: {
                  status: "completed", // Keep status as completed (per requirement)
                  input: parentPart.state.input,
                  output: parentPart.state.status === "completed" ? parentPart.state.output : "",
                  title:
                    parentPart.state.status === "completed" || parentPart.state.status === "running"
                      ? parentPart.state.title || task.description
                      : task.description,
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
              taskId: task.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })

      // 7. Get the parent message to inherit model settings
      const parentMsg = await MessageV2.get({
        sessionID: task.parentSessionID,
        messageID: task.parentMessageID,
      })

      const model = agent.model ?? {
        modelID: parentMsg.info.role === "assistant" ? parentMsg.info.modelID : "gpt-4",
        providerID: parentMsg.info.role === "assistant" ? parentMsg.info.providerID : "openai",
      }

      // 8. Resolve prompt parts
      const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)

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
          reject(new Error(`Task timed out after ${timeoutMs}ms`))
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

        // 14. Update task to completed state
        const completedTask: Task.TaskCompleted = {
          ...runningTask,
          status: "completed",
          completedAt: Date.now(),
          result: output,
        }
        await Store.update(completedTask)

        // 15. Final update to parent ToolPart with complete summary
        if (parentPart) {
          try {
            await Session.updatePart({
              id: parentPart.id,
              messageID: task.parentMessageID,
              sessionID: task.parentSessionID,
              type: "tool",
              tool: parentPart.tool,
              callID: parentPart.callID,
              state: {
                status: "completed",
                input: parentPart.state.input,
                output,
                title: task.description,
                metadata: {
                  taskId: task.id,
                  summary,
                  sessionId: childSession.id,
                },
                time: { start: task.createdAt, end: Date.now() },
              },
            })
          } catch (error) {
            log.warn("Failed to update parent part on completion", {
              taskId: task.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        log.info("Task completed", { taskId: task.id, duration: Date.now() - startedAt })

        // 16. Handle batch completion (replaces per-task notification)
        try {
          await handleBatchCompletion(task.batchId, task.id, "completed", output, task.description)
        } catch (error) {
          log.error("Failed to handle batch completion", {
            taskId: task.id,
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
      log.error("Task failed", { taskId: task.id, error: errorMessage })

      const failedTask: Task.TaskFailed = {
        ...task,
        status: "failed",
        childSessionID: childSessionID,
        startedAt,
        failedAt: Date.now(),
        error: errorMessage,
      }
      await Store.update(failedTask)

      // Update parent ToolPart with error info
      try {
        const parentMsg = await MessageV2.get({
          sessionID: task.parentSessionID,
          messageID: task.parentMessageID,
        })

        const parentPart = parentMsg.parts.find(
          (p): p is MessageV2.ToolPart => p.type === "tool" && p.callID === task.parentCallID,
        )

        if (parentPart) {
          await Session.updatePart({
            id: parentPart.id,
            messageID: task.parentMessageID,
            sessionID: task.parentSessionID,
            type: "tool",
            tool: parentPart.tool,
            callID: parentPart.callID,
            state: {
              status: "error",
              input: parentPart.state.input,
              error: errorMessage,
              metadata: {
                taskId: task.id,
                sessionId: childSessionID,
              },
              time: { start: task.createdAt, end: Date.now() },
            },
          })
        }
      } catch (updateError) {
        log.warn("Failed to update parent part on error", {
          taskId: task.id,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        })
      }

      // Handle batch completion (failure is still a completion)
      try {
        await handleBatchCompletion(task.batchId, task.id, "failed", errorMessage, task.description)
      } catch (error) {
        log.error("Failed to handle batch completion", {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
