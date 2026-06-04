import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

  const existing = await prisma.todo.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const todo = await prisma.todo.update({
    where: { id },
    data: { completed: !existing.completed },
  });

  logPatch.info({ todoId: id, completed: todo.completed }, "Todo toggled");
  return NextResponse.json({ todo });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.todo.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.todo.delete({ where: { id } });
  logDelete.info({ todoId: id }, "Todo deleted");
  return NextResponse.json({ success: true });
}
