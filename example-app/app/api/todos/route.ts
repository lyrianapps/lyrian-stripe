import { NextRequest, NextResponse } from "next/server";
import { todoStore } from "@/lib/todoStore";
import { reportUsage } from "@/lib/billing";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const logGet = logger.child({ route: "GET /api/todos" });
const logPost = logger.child({ route: "POST /api/todos" });

/** GET /api/todos — list all todos for the logged-in user */
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;
  const todos = todoStore.list(userId);
  logGet.debug({ userId, count: todos.length }, "Todos listed");
  return NextResponse.json({ todos });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = (
    (body as Record<string, unknown>)?.text as string | undefined
  )?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // ── Step 1: Check billing before creating the todo ───────────────────────
  let usage;
  try {
    usage = await reportUsage({ externalUserId: userId, quantity: 1 });
  } catch (err) {
    logPost.error({ err }, "Usage report failed");
    return NextResponse.json(
      { error: "Billing service unavailable — cannot create todo" },
      { status: 503 },
    );
  }

  if (!usage.allowed) {
    logPost.warn(
      { used: usage.used, cap: usage.cap, plan: usage.plan },
      "Free cap hit — upgrade required",
    );
    return NextResponse.json(
      { error: "Monthly todo limit reached", usage, upgradeRequired: true },
      { status: 402 },
    );
  }

  // ── Step 2: Create the todo ───────────────────────────────────────────────
  const todo = todoStore.create(userId, text);

  logPost.info(
    { todoId: todo.id, plan: usage.plan, used: usage.used },
    "Todo created",
  );
  return NextResponse.json({ todo, usage }, { status: 201 });
}
