/**
 * Test email notifications
 *
 * Usage:
 *   npx tsx scripts/test-email.ts <your-email@example.com>
 *   npx tsx scripts/test-email.ts --preview  # Just show HTML, don't send
 *
 * Requires RESEND_API_KEY in .env (unless using --preview)
 */

import { env } from "../env";
import {
  sendSubscriptionEmail,
  previewEmail,
  EmailEventType,
  EmailContext,
} from "../lib/email";

async function main() {
  const arg = process.argv[2];
  const isPreview = arg === "--preview";
  const testEmail = isPreview ? "preview@example.com" : arg;

  if (!arg) {
    console.error("❌ Usage:");
    console.error("   npx tsx scripts/test-email.ts <your-email@example.com>");
    console.error(
      "   npx tsx scripts/test-email.ts --preview  # Preview HTML only",
    );
    process.exit(1);
  }

  if (!isPreview && !env.RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY not set in .env");
    console.error("   Get a free key at https://resend.com");
    console.error("   Or use --preview to just see the email HTML");
    process.exit(1);
  }

  const testCases: { event: EmailEventType; context: EmailContext }[] = [
    {
      event: "subscription_created",
      context: {
        to: testEmail,
        customerName: "Test User",
        appName: "My SaaS App",
        planName: "Basic",
        amount: 1000,
        currency: "usd",
      },
    },
    {
      event: "subscription_upgraded",
      context: {
        to: testEmail,
        customerName: "Test User",
        appName: "My SaaS App",
        planName: "Pro",
        previousPlanName: "Basic",
        amount: 3000,
        currency: "usd",
      },
    },
    {
      event: "subscription_downgraded",
      context: {
        to: testEmail,
        customerName: "Test User",
        appName: "My SaaS App",
        planName: "Basic",
        previousPlanName: "Pro",
        amount: 1000,
        currency: "usd",
      },
    },
    {
      event: "subscription_canceled",
      context: {
        to: testEmail,
        customerName: "Test User",
        appName: "My SaaS App",
        planName: "Pro",
      },
    },
    {
      event: "payment_failed",
      context: {
        to: testEmail,
        customerName: "Test User",
        appName: "My SaaS App",
        planName: "Pro",
        amount: 3000,
        currency: "usd",
      },
    },
  ];

  console.log(
    `\n📧 ${isPreview ? "Previewing" : "Testing"} email notifications${isPreview ? "" : ` to: ${testEmail}`}\n`,
  );

  let successCount = 0;
  let failCount = 0;

  for (const { event, context } of testCases) {
    if (isPreview) {
      const { subject, html } = previewEmail(event, context);
      console.log(`\n${"=".repeat(60)}`);
      console.log(`📨 ${event}`);
      console.log(`Subject: ${subject}`);
      console.log(`${"=".repeat(60)}`);
      console.log(html);
      successCount++;
    } else {
      process.stdout.write(`  ${event}... `);
      const success = await sendSubscriptionEmail(event, context);
      console.log(success ? "✅ Sent" : "❌ Failed");
      if (success) successCount++;
      else failCount++;
      // Rate limit: 2 requests/sec on free tier - use 1.5s to be safe
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (isPreview) {
    console.log("\n✨ Preview complete!\n");
  } else if (failCount === 0) {
    console.log("\n✨ Done! Check your inbox.\n");
  } else if (successCount === 0) {
    console.log("\n❌ All emails failed to send.\n");
    console.log("Note: Without a verified domain, Resend only allows sending");
    console.log(
      "to your account email. Verify a domain at https://resend.com/domains\n",
    );
  } else {
    console.log(`\n⚠️  ${successCount} sent, ${failCount} failed.\n`);
  }
}

main().catch(console.error);
