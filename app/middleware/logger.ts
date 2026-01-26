import { NextRequest } from "next/server";

export function logger(request: NextRequest) {
  console.log(`[${new Date().toISOString()}] ${request.method} ${request.url}`);
}
