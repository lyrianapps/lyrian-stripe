import { z } from "zod";
import { Plan, BillingType } from "@/lib/generated/prisma/enums";

const VALID_PLAN_KEYS = Object.values(Plan) as string[];
const VALID_BILLING_TYPES = Object.values(BillingType) as string[];

export const PlanSchema = z.object({
  planKey: z.string().refine((k): k is Plan => VALID_PLAN_KEYS.includes(k), {
    message: `planKey must be one of: ${VALID_PLAN_KEYS.join(", ")}`,
  }),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().int().min(0),
  currency: z.string().default("usd"),
  stripeProductId: z.string().startsWith("prod_"),
  stripePriceId: z.string().startsWith("price_"),
  sortOrder: z.number().int().default(0),
  billingType: z
    .string()
    .refine((t): t is BillingType => VALID_BILLING_TYPES.includes(t), {
      message: `billingType must be one of: ${VALID_BILLING_TYPES.join(", ")}`,
    })
    .default("flat_rate"),
  unitAmount: z.number().int().min(0).optional(),
  stripeMeterEventName: z.string().optional(),
  freeUnitsPerMonth: z.number().int().min(0).optional(),
});

export const ConfigureSchema = z.object({
  stripeSecretKey: z.string().startsWith("sk_").optional(),
  stripePublishableKey: z.string().startsWith("pk_").optional(),
  stripeWebhookSecret: z.string().startsWith("whsec_").optional(),
  billingMode: z
    .enum(["flat_rate", "metered"] as const)
    .optional()
    .describe("flat_rate or metered — all plans must match this mode"),
  plans: z.array(PlanSchema).min(1).optional(),
});

export type ConfigureInput = z.infer<typeof ConfigureSchema>;
export type PlanInput = z.infer<typeof PlanSchema>;
