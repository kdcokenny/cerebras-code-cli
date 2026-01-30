import z from "zod"

export namespace Task {
  // Base fields shared by all states
  const TaskBase = z.object({
    id: z.string(), // Readable ID like "swift-amber-falcon"
    sessionID: z.string(), // Parent session ID
    parentSessionID: z.string(), // Same as sessionID (for clarity)
    parentMessageID: z.string(), // Message containing the task tool call
    parentPartID: z.string(), // The ToolPart ID (callID) for streaming updates
    parentCallID: z.string(), // The callID used to find the parent ToolPart
    batchId: z.string().optional(), // Batch ID for grouping tasks from same agent turn
    childSessionID: z.string().optional(), // Child session ID (set when running)
    description: z.string(), // Task description
    agent: z.string(), // Agent type (e.g., "explore", "coder")
    prompt: z.string(), // The prompt for the child session
    createdAt: z.number(), // Timestamp when created
  })

  // Queued state - waiting to be picked up by runner
  export const TaskQueued = TaskBase.extend({
    status: z.literal("queued"),
  }).meta({
    ref: "TaskQueued",
  })
  export type TaskQueued = z.infer<typeof TaskQueued>

  // Running state - being executed by runner
  export const TaskRunning = TaskBase.extend({
    status: z.literal("running"),
    childSessionID: z.string(), // Now required
    startedAt: z.number(), // When execution started
  }).meta({
    ref: "TaskRunning",
  })
  export type TaskRunning = z.infer<typeof TaskRunning>

  // Completed state - finished successfully
  export const TaskCompleted = TaskBase.extend({
    status: z.literal("completed"),
    childSessionID: z.string(),
    startedAt: z.number(),
    completedAt: z.number(),
    result: z.string(), // Final result/output
  }).meta({
    ref: "TaskCompleted",
  })
  export type TaskCompleted = z.infer<typeof TaskCompleted>

  // Failed state - finished with error
  export const TaskFailed = TaskBase.extend({
    status: z.literal("failed"),
    childSessionID: z.string().optional(),
    startedAt: z.number().optional(),
    failedAt: z.number(),
    error: z.string(), // Error message
  }).meta({
    ref: "TaskFailed",
  })
  export type TaskFailed = z.infer<typeof TaskFailed>

  // Discriminated union for all task states
  export const Info = z.discriminatedUnion("status", [TaskQueued, TaskRunning, TaskCompleted, TaskFailed]).meta({
    ref: "Task",
  })
  export type Info = z.infer<typeof Info>
}
