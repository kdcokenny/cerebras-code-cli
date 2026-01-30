import { Storage } from "../storage/storage"
import { Task } from "./types"

/**
 * Store namespace for task persistence operations.
 * Uses Storage API with key structure: ["task", sessionID, taskId]
 */
export namespace Store {
  /**
   * Create a new task in queued state.
   */
  export async function create(task: Task.TaskQueued): Promise<void> {
    await Storage.write(["task", task.sessionID, task.id], task)
  }

  /**
   * Get a task by ID.
   * Returns undefined if not found.
   */
  export async function get(sessionID: string, id: string): Promise<Task.Info | undefined> {
    try {
      return await Storage.read<Task.Info>(["task", sessionID, id])
    } catch (e) {
      if (e instanceof Storage.NotFoundError) {
        return undefined
      }
      throw e
    }
  }

  /**
   * List all tasks for a session.
   * Returns empty array if session has no tasks.
   */
  export async function list(sessionID: string): Promise<Task.Info[]> {
    const result: Task.Info[] = []
    const items = await Storage.list(["task", sessionID])
    for (const item of items) {
      try {
        const task = await Storage.read<Task.Info>(item)
        result.push(task)
      } catch (e) {
        // Skip if read fails (e.g., file was deleted concurrently)
        if (!(e instanceof Storage.NotFoundError)) {
          throw e
        }
      }
    }
    return result
  }

  /**
   * List ALL tasks across all sessions.
   * Used for orphan cleanup and system maintenance.
   */
  export async function listAll(): Promise<Task.Info[]> {
    const result: Task.Info[] = []
    const sessions = await Storage.list(["task"])
    for (const sessionPath of sessions) {
      const items = await Storage.list(sessionPath)
      for (const item of items) {
        try {
          const task = await Storage.read<Task.Info>(item)
          result.push(task)
        } catch (e) {
          // Skip if read fails
          if (!(e instanceof Storage.NotFoundError)) {
            throw e
          }
        }
      }
    }
    return result
  }

  /**
   * Update a task (for state transitions).
   */
  export async function update(task: Task.Info): Promise<void> {
    await Storage.write(["task", task.sessionID, task.id], task)
  }

  /**
   * Remove a task from storage.
   */
  export async function remove(sessionID: string, id: string): Promise<void> {
    await Storage.remove(["task", sessionID, id])
  }
}
