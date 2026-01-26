import { z } from "zod";

export const SessionPayloadSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
});

export const JWTTokenSchema = z.string().min(1);

export const JWTPayloadSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
});
