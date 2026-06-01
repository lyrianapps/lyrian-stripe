import { cookies } from "next/headers";
import { env } from "@/lib/env";

export type DemoMode = "subscription" | "paygo";

export async function getDemoMode(): Promise<DemoMode> {
  const cookieStore = await cookies();
  const mode = cookieStore.get("demo_mode")?.value;
  return mode === "paygo" ? "paygo" : "subscription";
}

/** Returns the correct test user ID for the active demo mode. */
export async function getDemoUserId(): Promise<string> {
  const mode = await getDemoMode();
  return mode === "paygo" ? env.TEST_USER_ID_PAYGO : env.TEST_USER_ID;
}
