FROM node:22-alpine AS base

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile --production=false

# ── Builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (DATABASE_URL not needed at build time for this step)
RUN npx prisma generate

# Build-time env vars (dummy values for validation, real values injected at runtime)
ARG BILLING_API_URL="https://placeholder.example.com"
ARG BILLING_API_KEY="placeholder_api_key"
ARG BILLING_APP_ID="placeholder_app_id"
ARG SAAS_JWT_SECRET="placeholder_jwt_secret_for_build"

ENV BILLING_API_URL=$BILLING_API_URL
ENV BILLING_API_KEY=$BILLING_API_KEY
ENV BILLING_APP_ID=$BILLING_APP_ID
ENV SAAS_JWT_SECRET=$SAAS_JWT_SECRET

ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build

# ── Runner ────────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
