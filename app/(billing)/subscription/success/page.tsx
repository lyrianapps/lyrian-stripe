"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";

export default function SubscriptionSuccessPage() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const returnUrl = params.get("returnUrl");
      if (returnUrl) {
        // Optionally: poll a server endpoint to confirm subscription status
        // before redirecting. For now, redirect immediately so SaaS app
        // receives the user back.
        window.location.href = returnUrl;
      }
    } catch (e) {
      // ignore malformed URL and stay on page
    }
  }, []);

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
