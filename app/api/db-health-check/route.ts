import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      message: "Database connection healthy.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: "Database connection failed.",
        error: String(error),
      },
      { status: 500 },
    );
  } finally {
    await prisma.$disconnect();
  }
}
