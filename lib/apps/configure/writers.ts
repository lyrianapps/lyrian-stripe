import { Plan, BillingType } from "@/lib/generated/prisma/enums";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import type { ConfigureInput, PlanInput } from "./schemas";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type CredentialInput = Pick<
  ConfigureInput,
  | "stripeSecretKey"
  | "stripePublishableKey"
  | "stripeWebhookSecret"
  | "billingMode"
>;

// Maps each credential field to its DB transform.
// Add a new entry here to support additional credential fields.
const CREDENTIAL_TRANSFORMS = new Map<
  keyof CredentialInput,
  (value: string) => string | BillingType
>([
  ["stripeSecretKey", encrypt],
  ["stripePublishableKey", encrypt],
  ["stripeWebhookSecret", encrypt],
  ["billingMode", (v) => v as BillingType],
]);

// ─── Credential writer ────────────────────────────────────────────────────────

/**
 * Encrypts and patches only the credential fields that are present.
 * billingMode is stored alongside credentials since it's an app-level setting.
 */
export async function applyCredentials(
  tx: TxClient,
  appId: string,
  input: CredentialInput,
) {
  const patch: Record<string, string | BillingType> = {};

  for (const [field, transform] of CREDENTIAL_TRANSFORMS) {
    const value = input[field];
    if (value) patch[field] = transform(value);
  }

  if (Object.keys(patch).length > 0) {
    await tx.app.update({ where: { id: appId }, data: patch });
  }
}

// ─── Plan writer ──────────────────────────────────────────────────────────────

/**
 * Upserts all plans in the incoming list and deactivates any not present.
 * Safe to call repeatedly — fully idempotent.
 */
export async function applyPlans(
  tx: TxClient,
  appId: string,
  plans: PlanInput[],
) {
  const incomingKeys = plans.map((p) => p.planKey);

  await tx.appPlan.updateMany({
    where: { appId, planKey: { notIn: incomingKeys } },
    data: { isActive: false },
  });

  for (const plan of plans) {
    const shared = {
      name: plan.name,
      description: plan.description ?? null,
      price: plan.price,
      currency: plan.currency,
      stripeProductId: plan.stripeProductId,
      stripePriceId: plan.stripePriceId,
      sortOrder: plan.sortOrder,
      billingType: plan.billingType as BillingType,
      unitAmount: plan.unitAmount ?? null,
      stripeMeterEventName: plan.stripeMeterEventName ?? null,
      freeUnitsPerMonth: plan.freeUnitsPerMonth ?? null,
    };

    await tx.appPlan.upsert({
      where: { appId_planKey: { appId, planKey: plan.planKey } },
      update: { ...shared, isActive: true },
      create: { appId, planKey: plan.planKey as Plan, ...shared },
    });
  }
}
