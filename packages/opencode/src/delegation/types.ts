import z from "zod"

export namespace Delegation {
  // Base fields shared by all states
  const DelegationBase = z.object({
    id: z.string(), // Readable ID like "swift-amber-falcon"
    sessionID: z.string(), // Parent session ID
    parentSessionID: z.string(), // Same as sessionID (for clarity)
    parentMessageID: z.string(), // Message containing the task tool call
    parentPartID: z.string(), // The ToolPart ID (callID) for streaming updates
    parentCallID: z.string(), // The callID used to find the parent ToolPart
    childSessionID: z.string().optional(), // Child session ID (set when running)
    description: z.string(), // Task description
    agent: z.string(), // Agent type (e.g., "explore", "coder")
    prompt: z.string(), // The prompt for the child session
    createdAt: z.number(), // Timestamp when created
  })

  // Queued state - waiting to be picked up by runner
  export const DelegationQueued = DelegationBase.extend({
    status: z.literal("queued"),
  }).meta({
    ref: "DelegationQueued",
  })
  export type DelegationQueued = z.infer<typeof DelegationQueued>

  // Running state - being executed by runner
  export const DelegationRunning = DelegationBase.extend({
    status: z.literal("running"),
    childSessionID: z.string(), // Now required
    startedAt: z.number(), // When execution started
  }).meta({
    ref: "DelegationRunning",
  })
  export type DelegationRunning = z.infer<typeof DelegationRunning>

  // Completed state - finished successfully
  export const DelegationCompleted = DelegationBase.extend({
    status: z.literal("completed"),
    childSessionID: z.string(),
    startedAt: z.number(),
    completedAt: z.number(),
    result: z.string(), // Final result/output
  }).meta({
    ref: "DelegationCompleted",
  })
  export type DelegationCompleted = z.infer<typeof DelegationCompleted>

  // Failed state - finished with error
  export const DelegationFailed = DelegationBase.extend({
    status: z.literal("failed"),
    childSessionID: z.string().optional(),
    startedAt: z.number().optional(),
    failedAt: z.number(),
    error: z.string(), // Error message
  }).meta({
    ref: "DelegationFailed",
  })
  export type DelegationFailed = z.infer<typeof DelegationFailed>

  // Discriminated union for all delegation states
  export const Info = z
    .discriminatedUnion("status", [DelegationQueued, DelegationRunning, DelegationCompleted, DelegationFailed])
    .meta({
      ref: "Delegation",
    })
  export type Info = z.infer<typeof Info>
}
