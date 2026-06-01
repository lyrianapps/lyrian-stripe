"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

interface Usage {
  allowed: boolean;
  used: number;
  cap: number | null;
  remaining: number | null;
  plan: string;
  billingType: string;
  yearMonth: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage bar
// ─────────────────────────────────────────────────────────────────────────────

function UsageBar({ usage }: { usage: Usage }) {
  const isMetered =
    usage.billingType === "metered" || usage.billingType === "volume";
  const pct = usage.cap ? Math.min((usage.used / usage.cap) * 100, 100) : 0;
  const isFull = usage.cap !== null && usage.used >= usage.cap;
  const isWarning = usage.cap !== null && usage.used >= usage.cap * 0.8;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-gray-700">
          {isMetered ? (
            <>
              <span className="text-xl font-bold text-gray-900">
                {usage.used}
              </span>
              <span className="ml-1 text-gray-500">
                todos created · billed at $0.04 each
              </span>
            </>
          ) : (
            <>
              <span className="text-xl font-bold text-gray-900">
                {usage.used}
              </span>
              {usage.cap && (
                <span className="text-gray-500 ml-1">
                  / {usage.cap} todos this month
                </span>
              )}
            </>
          )}
        </div>
        <Link
          href="/settings"
          className="text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          {isFull ? "⚡ Upgrade now" : "Manage plan →"}
        </Link>
      </div>

      {!isMetered && usage.cap && (
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${
              isFull ? "bg-red-500" : isWarning ? "bg-amber-400" : "bg-blue-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <div className="mt-1.5 text-xs text-gray-400">
        Plan:{" "}
        <span className="font-medium capitalize">
          {usage.plan.replace(/_/g, " ")}
        </span>
        {isMetered && " · invoice sent at period end"}
        {!isMetered &&
          usage.remaining !== null &&
          ` · ${usage.remaining} remaining`}
        <span className="ml-2">({usage.yearMonth})</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upgrade prompt (shown when free cap is hit)
// ─────────────────────────────────────────────────────────────────────────────

function UpgradePrompt({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>
          🚫
        </span>
        <div className="flex-1">
          <p className="font-semibold text-amber-900">Monthly limit reached</p>
          <p className="mt-1 text-sm text-amber-700">
            You&apos;ve used all 500 free todos this month. Upgrade to Pay as
            You Go for $0.04/todo with no monthly cap — you&apos;re only charged
            for what you create.
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              href="/settings"
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              View plans
            </Link>
            <button
              onClick={onDismiss}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/todos").then((r) => r.json()),
      fetch("/api/billing/usage").then((r) => r.json()),
    ])
      .then(([todosData, usageData]: [{ todos: Todo[] }, Usage]) => {
        setTodos(todosData.todos ?? []);
        setUsage(usageData);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const text = newText.trim();
    if (!text || adding) return;

    setAdding(true);
    setError(null);
    setUpgradeRequired(false);

    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const data = (await res.json()) as {
      todo?: Todo;
      usage?: Usage;
      error?: string;
      upgradeRequired?: boolean;
    };

    if (res.status === 402) {
      setUpgradeRequired(true);
      if (data.usage) setUsage(data.usage);
    } else if (!res.ok) {
      setError(data.error ?? "Failed to create todo");
    } else {
      if (data.todo) setTodos((prev) => [data.todo!, ...prev]);
      if (data.usage) setUsage(data.usage);
      setNewText("");
    }

    setAdding(false);
  }

  async function handleToggle(id: string) {
    const res = await fetch(`/api/todos/${id}`, { method: "PATCH" });
    if (res.ok) {
      const { todo } = (await res.json()) as { todo: Todo };
      setTodos((prev) => prev.map((t) => (t.id === id ? todo : t)));
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
    if (res.ok) setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {usage && <UsageBar usage={usage} />}

      {upgradeRequired && (
        <UpgradePrompt onDismiss={() => setUpgradeRequired(false)} />
      )}

      {/* Add todo form */}
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="What needs to be done?"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          disabled={adding}
        />
        <button
          type="submit"
          disabled={adding || !newText.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {adding ? "Adding…" : "Add Todo"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Todo list */}
      {todos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <span className="text-4xl mb-3">✅</span>
          <p className="text-sm">No todos yet — add one above!</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-4 py-3 shadow-sm"
            >
              {/* Checkbox */}
              <button
                onClick={() => handleToggle(todo.id)}
                aria-label={
                  todo.completed ? "Mark incomplete" : "Mark complete"
                }
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  todo.completed
                    ? "bg-green-500 border-green-500 text-white"
                    : "border-gray-300 hover:border-blue-400"
                }`}
              >
                {todo.completed && (
                  <span className="text-xs leading-none">✓</span>
                )}
              </button>

              {/* Text */}
              <span
                className={`flex-1 text-sm ${
                  todo.completed
                    ? "line-through text-gray-400"
                    : "text-gray-800"
                }`}
              >
                {todo.text}
              </span>

              {/* Delete */}
              <button
                onClick={() => handleDelete(todo.id)}
                aria-label="Delete todo"
                className="text-gray-300 hover:text-red-400 transition-colors text-xl leading-none"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
