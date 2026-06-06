import { NextRequest, NextResponse } from "next/server";
import { todoStore } from "@/lib/todoStore";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const logPatch = logger.child({ route: "PATCH /api/todos/[id]" });
const logDelete = logger.child({ route: "DELETE /api/todos/[id]" });

type Params = { params: Promise<{ id: string }> };

export async function PATCH(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = todoStore.findOwned(id, session.userId);
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const todo = todoStore.toggle(id)!;
  logPatch.info({ todoId: id, completed: todo.completed }, "Todo toggled");
  return NextResponse.json({ todo });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = todoStore.findOwned(id, session.userId);
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  todoStore.delete(id);
  logDelete.info({ todoId: id }, "Todo deleted");
  return NextResponse.json({ success: true });
}
