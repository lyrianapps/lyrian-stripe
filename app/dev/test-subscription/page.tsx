import TestSubscriptionClient from "./TestSubscriptionClient";
import VerifyAdminClient from "./VerifyAdminClient";
import { cookies } from "next/headers";

export default async function TestSubscriptionPage() {
  // server-side check for admin cookie to avoid client flash
  const cookieStore = await cookies();
  const devAdmin = cookieStore.get("dev_admin")?.value === "1";

  // If not in dev mode, render not found
  if (process.env.NODE_ENV === "production") {
    return <div className="max-w-xl mx-auto py-12 px-4">Not found</div>;
  }

  return devAdmin ? <TestSubscriptionClient /> : <VerifyAdminClient />;
}
