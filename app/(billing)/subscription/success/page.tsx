import { redirect } from "next/navigation";
import Link from "next/link";
import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";

export default async function SubscriptionSuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const returnUrl = Array.isArray(params?.returnUrl)
    ? params.returnUrl[0]
    : params?.returnUrl;

  // Redirect server-side if returnUrl is provided
  if (returnUrl) {
    redirect(returnUrl);
  }

  return (
    <div className="max-w-xl mx-auto py-24 px-4 text-center">
      <Heading level={1} className="text-green-600 mb-4">
        Subscription Successful!
      </Heading>
      <Paragraph className="mb-6">
        Thank you for subscribing. Your plan is now active and you can access
        all features.
      </Paragraph>
      <Link href="/subscription" className="text-blue-600 underline">
        Go to Subscription Management
      </Link>
    </div>
  );
}
