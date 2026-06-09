/**
 * One-time migration: encrypt any plain-text Stripe credentials already
 * stored in the App table.
 *
 * Safe to run multiple times — values that are already encrypted (start with
 * "enc:v1:") are skipped automatically.
 *
 * Usage:
 *   FIELD_ENCRYPTION_KEY=<64-hex-chars> npx tsx scripts/encrypt-existing-keys.ts
 *
 * Dry-run (prints what would change without writing):
 *   FIELD_ENCRYPTION_KEY=<64-hex-chars> DRY_RUN=true npx tsx scripts/encrypt-existing-keys.ts
 *
 * Generate a key:
 *   openssl rand -hex 32
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt } from "../lib/crypto";

const DRY_RUN = process.env.DRY_RUN === "true";
const ENC_PREFIX = "enc:v1:";

if (!process.env.FIELD_ENCRYPTION_KEY) {
  console.error("❌  FIELD_ENCRYPTION_KEY is not set.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set.");
  process.exit(1);
}

// Instantiate Prisma directly — avoids importing lib/prisma which pulls in
// env.ts and demands all app env vars (SAAS_JWT_SECRET etc.) at startup.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const FIELDS = [
  "stripeSecretKey",
  "stripePublishableKey",
  "stripeWebhookSecret",
] as const;

type AppRow = {
  id: string;
  name: string;
  stripeSecretKey: string | null;
  stripePublishableKey: string | null;
  stripeWebhookSecret: string | null;
};

async function run() {
  console.log(
    DRY_RUN
      ? "🔍  Dry-run mode — no writes will be made.\n"
      : "🔐  Encrypting plain-text Stripe credentials…\n",
  );

  const apps = (await prisma.app.findMany({
    select: {
      id: true,
      name: true,
      stripeSecretKey: true,
      stripePublishableKey: true,
      stripeWebhookSecret: true,
    },
  })) as AppRow[];

  console.log(`   Found ${apps.length} app(s).\n`);

  let totalPatched = 0;

  for (const app of apps) {
    const patch: Record<string, string> = {};

    for (const field of FIELDS) {
      const value = app[field];
      if (value && !value.startsWith(ENC_PREFIX)) {
        patch[field] = encrypt(value);
      }
    }

    const fields = Object.keys(patch);

    if (fields.length === 0) {
      console.log(
        `   ✅  ${app.name} (${app.id}) — already encrypted, skipped.`,
      );
      continue;
    }

    console.log(
      `   🔑  ${app.name} (${app.id}) — encrypting: ${fields.join(", ")}`,
    );

    if (!DRY_RUN) {
      await prisma.app.update({ where: { id: app.id }, data: patch });
    }

    totalPatched++;
  }

  console.log(
    `\n${DRY_RUN ? "Would patch" : "Patched"} ${totalPatched} app(s).`,
  );

  if (DRY_RUN) {
    console.log("\nRe-run without DRY_RUN=true to apply changes.");
  } else {
    console.log("\n✅  Done. Plain-text credentials have been encrypted.");
  }
}

run()
  .catch((err) => {
    console.error("❌  Migration failed:", err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
