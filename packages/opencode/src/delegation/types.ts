import z from "zod"

// Common fields present in all delegation states
const DelegationBase = z.object({
  id: z.string(),
  description: z.string(),
  prompt: z.string(),
  agent: z.string(),
  parentSessionId: z.string(),
  parentMessageId: z.string(),
  parentCallID: z.string(),
})

// Queued state - delegation created but not yet started
export const DelegationQueued = DelegationBase.extend({
  status: z.literal("queued"),
  queuedAt: z.number(),
}).meta({
  ref: "DelegationQueued",
})
export type DelegationQueued = z.infer<typeof DelegationQueued>

// Running state - delegation is currently executing
export const DelegationRunning = DelegationBase.extend({
  status: z.literal("running"),
  startedAt: z.number(),
  childSessionId: z.string(),
}).meta({
  ref: "DelegationRunning",
})
export type DelegationRunning = z.infer<typeof DelegationRunning>

// Completed state - delegation finished successfully
export const DelegationCompleted = DelegationBase.extend({
  status: z.literal("completed"),
  startedAt: z.number(),
  completedAt: z.number(),
  childSessionId: z.string(),
  result: z.string(),
}).meta({
  ref: "DelegationCompleted",
})
export type DelegationCompleted = z.infer<typeof DelegationCompleted>

// Failed state - delegation encountered an error
export const DelegationFailed = DelegationBase.extend({
  status: z.literal("failed"),
  startedAt: z.number(),
  failedAt: z.number(),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }),
  childSessionId: z.string().optional(),
}).meta({
  ref: "DelegationFailed",
})
export type DelegationFailed = z.infer<typeof DelegationFailed>

// Discriminated union of all delegation states
export const DelegationState = z
  .discriminatedUnion("status", [DelegationQueued, DelegationRunning, DelegationCompleted, DelegationFailed])
  .meta({
    ref: "DelegationState",
  })
export type DelegationState = z.infer<typeof DelegationState>

// Alias for the complete delegation info (same as DelegationState)
export type DelegationInfo = DelegationState
