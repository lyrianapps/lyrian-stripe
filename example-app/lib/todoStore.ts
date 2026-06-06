/**
 * In-memory todo store.
 *
 * Todos are stored in a module-level Map and are scoped per userId.
 * They reset on cold start — acceptable for this demo app now that the
 * example-app no longer has its own database.
 */

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// Global map: todoId -> Todo
const todos = new Map<string, Todo>();

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const todoStore = {
  list(userId: string): Todo[] {
    return [...todos.values()]
      .filter((t) => t.userId === userId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  },

  create(userId: string, text: string): Todo {
    const now = new Date().toISOString();
    const todo: Todo = {
      id: uid(),
      text,
      completed: false,
      userId,
      createdAt: now,
      updatedAt: now,
    };
    todos.set(todo.id, todo);
    return todo;
  },

  findOwned(id: string, userId: string): Todo | undefined {
    const todo = todos.get(id);
    return todo?.userId === userId ? todo : undefined;
  },

  toggle(id: string): Todo | undefined {
    const todo = todos.get(id);
    if (!todo) return undefined;
    todo.completed = !todo.completed;
    todo.updatedAt = new Date().toISOString();
    return todo;
  },

  delete(id: string): boolean {
    return todos.delete(id);
  },
};
