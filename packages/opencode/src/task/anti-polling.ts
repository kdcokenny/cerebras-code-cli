/**
 * Single source of truth for anti-polling messaging.
 * Ensures consistent emoji usage and wording across all task outputs.
 */

/**
 * Standard warning for tool outputs/descriptions.
 * @returns "🚫 DO NOT POLL. YOU WILL BE NOTIFIED VIA <BATCH-COMPLETE>."
 */
export function standardWarning(): string {
  return "🚫 DO NOT POLL. YOU WILL BE NOTIFIED VIA <BATCH-COMPLETE>."
}

/**
 * Instruction for using task_read after receiving notification.
 * @returns "If you need the full result for this task, call task_read once after this notification."
 */
export function taskReadAfterNotification(): string {
  return "If you need the full result for this task, call task_read once after this notification."
}

/**
 * Reminder for notifications when there are remaining tasks running.
 * @param remainingCount Number of tasks still queued or running
 * @returns Multi-line reminder with warning, mention, and task_read guidance
 */
export function reminderRemaining(remainingCount: number): string {
  return [
    "⚠️ Do NOT poll task_read or task_list - continue productive work.",
    taskReadAfterNotification(),
    "You WILL be notified as each task completes.",
  ].join(" ")
}

/**
 * Final reminder for notifications when no remaining tasks exist.
 * @returns Multi-line reminder with warning, mention, and task_read guidance
 */
export function reminderFinal(): string {
  return [
    "🚫 DO NOT POLL TASK_READ OR TASK_LIST FOR FUTURE TASKS.",
    taskReadAfterNotification(),
    "YOU WILL BE NOTIFIED VIA <BATCH-COMPLETE> WHEN ALL TASKS FINISH.",
  ].join(" ")
}

/**
 * Reminder for task tool outputs.
 * @returns "⚠️ Do NOT poll task_read or task_list. You WILL be notified when complete."
 */
export function taskOutputReminder(): string {
  return "⚠️ Do NOT poll task_read or task_list. You WILL be notified when complete."
}

/**
 * System prompt rules block for task.txt.
 * Includes all anti-polling rules with consistent emoji usage.
 * @returns Multi-line system prompt block
 */
export function systemRules(): string {
  return `🚫 NEVER POLL TASK_READ OR TASK_LIST TO CHECK COMPLETION. YOU WILL BE NOTIFIED VIA <BATCH-COMPLETE> WHEN ALL TASKS FINISH.
❌ DO NOT POLL TASK_READ OR TASK_LIST - CONTINUE PRODUCTIVE WORK WHILE TASKS RUN IN THE BACKGROUND.`
}
