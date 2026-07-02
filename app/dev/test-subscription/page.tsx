import TestSubscriptionClient from "./TestSubscriptionClient";
import VerifyAdminClient from "./VerifyAdminClient";
import { cookies } from "next/headers";
import { env } from "@/env";

export default async function TestSubscriptionPage() {
  // server-side check for admin cookie to avoid client flash
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get("dev_admin")?.value;
  const devAdmin = Boolean(
    env.SAAS_JWT_SECRET && cookieValue === env.SAAS_JWT_SECRET,
  );

  // If not in dev mode, render not found
  if (process.env.NODE_ENV === "production") {
    return <div className="max-w-xl mx-auto py-12 px-4">Not found</div>;
  }

  return devAdmin ? <TestSubscriptionClient /> : <VerifyAdminClient />;
}
