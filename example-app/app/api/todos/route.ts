import { NextRequest, NextResponse } from "next/server";
import { prisma, resetPrisma } from "@/lib/prisma";
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
  const todos = await prisma.todo.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
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
  // Set updatedAt explicitly because the migration column has no DB default
  // (only the Prisma client's @updatedAt). With the new prisma-client
  // generator + adapter-pg this is not always populated, causing a NOT NULL
  // violation that surfaces as an opaque 500.
  //
  // Cloud Run + Cloud SQL intermittently serves stale pg pool sockets
  // ("connect EIO /cloudsql/.../.s.PGSQL.5432"). When that happens the
  // ENTIRE pool can be poisoned, so a same-client retry won't help — we
  // dispose the client and try again with a fresh one.
  function isTransientConnError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("EIO") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("Connection terminated")
    );
  }

  let todo;
  let lastErr: unknown;
  const MAX_ATTEMPTS = 3;
  // Backoff: 0ms (initial), 500ms, 2000ms — gives the Cloud SQL Auth Proxy
  // sidecar time to recover from a transient socket failure. Total worst
  // case: ~2.5s of waits + 3 × 5s connect timeout = ~17.5s, well under
  // Cloud Run's 30s request budget.
  const BACKOFF_MS = [0, 500, 2000];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }
    try {
      todo = await prisma.todo.create({
        data: { text, userId, updatedAt: new Date() },
      });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && isTransientConnError(err)) {
        logPost.warn(
          { err, attempt },
          "Transient DB connection error, recreating client and retrying",
        );
        await resetPrisma();
        continue;
      }
      break;
    }
  }
  if (lastErr || !todo) {
    logPost.error({ err: lastErr, userId }, "Failed to create todo");
    return NextResponse.json(
      {
        error: "Failed to create todo",
        message: lastErr instanceof Error ? lastErr.message : String(lastErr),
      },
      { status: 500 },
    );
  }

  logPost.info(
    { todoId: todo.id, plan: usage.plan, used: usage.used },
    "Todo created",
  );
  return NextResponse.json({ todo, usage }, { status: 201 });
}
