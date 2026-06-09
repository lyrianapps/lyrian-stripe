import { todoStore } from "@/lib/todoStore";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export async function AnalyticsDashboard({
  userId,
  today,
}: {
  userId: string;
  today: string; // YYYY-MM-DD, passed from the page
}) {
  const todos = todoStore.list(userId);

  const total = todos.length;
  const completed = todos.filter((t) => t.completed).length;
  const pending = total - completed;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Group by day (last 7 days)
  const dayMs = 24 * 60 * 60 * 1000;
  const todayMs = new Date(today + "T12:00:00Z").getTime();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayMs - (6 - i) * dayMs);
    return d.toISOString().slice(0, 10);
  });

  const byDay = Object.fromEntries(
    days.map((d) => [d, { created: 0, completed: 0 }]),
  );
  for (const todo of todos) {
    const day = todo.createdAt.slice(0, 10);
    if (byDay[day]) byDay[day].created++;
    if (todo.completed) {
      const doneDay = todo.updatedAt.slice(0, 10);
      if (byDay[doneDay]) byDay[doneDay].completed++;
    }
  }

  const maxCreated = Math.max(...Object.values(byDay).map((d) => d.created), 1);

  return (
    <div className="flex flex-col gap-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total todos" value={total} />
        <StatCard label="Completed" value={completed} />
        <StatCard label="Pending" value={pending} />
        <StatCard
          label="Completion rate"
          value={`${completionRate}%`}
          sub="of all todos"
        />
      </div>

      {/* 7-day bar chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm font-medium text-gray-700 mb-4">
          Todos created — last 7 days
        </p>
        <div className="flex items-end gap-2 h-24">
          {days.map((day) => {
            const count = byDay[day].created;
            const heightPct = Math.round((count / maxCreated) * 100);
            const label = new Date(day + "T12:00:00Z").toLocaleDateString(
              undefined,
              { weekday: "short" },
            );
            return (
              <div
                key={day}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <span className="text-[10px] text-gray-400">{count || ""}</span>
                <div
                  className="w-full rounded-t-sm bg-blue-500 transition-all"
                  style={{
                    height: `${Math.max(heightPct, count > 0 ? 8 : 2)}%`,
                  }}
                />
                <span className="text-[10px] text-gray-400">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {total === 0 && (
        <p className="text-center text-sm text-gray-400">
          No todos yet — create some to see your stats here.
        </p>
      )}
    </div>
  );
}
