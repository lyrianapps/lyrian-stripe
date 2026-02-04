/**
 * Generate API key for a SaaS app
 *
 * Usage:
 *   npx tsx scripts/create-app.ts <app-id> <app-name>
 *
 * Example:
 *   npx tsx scripts/create-app.ts saas-todo-app "My Todo App"
 */

import { prisma } from "../lib/prisma";
import { generateApiKey } from "../lib/auth/apiKey";

async function main() {
  const appId = process.argv[2];
  const appName = process.argv[3] || appId;

  if (!appId) {
    console.error(
      "❌ Usage: npx tsx scripts/create-app.ts <app-id> [app-name]",
    );
    console.error(
      "   Example: npx tsx scripts/create-app.ts my-saas-app 'My SaaS App'",
    );
    process.exit(1);
  }

  // Check if app already exists
  const existingApp = await prisma.app.findUnique({ where: { id: appId } });

  if (existingApp?.apiKey) {
    console.log(`\n⚠️  App "${appId}" already has an API key:`);
    console.log(`   ${existingApp.apiKey}\n`);
    process.exit(0);
  }

  const apiKey = generateApiKey();

  await prisma.app.upsert({
    where: { id: appId },
    update: { apiKey },
    create: {
      id: appId,
      name: appName,
      apiKey,
    },
  });

  console.log(`
✅ App created successfully!

   App ID:   ${appId}
   Name:     ${appName}
   API Key:  ${apiKey}

Save this API key securely - it won't be shown again.

Usage in your SaaS app:
   
   curl -X GET "https://your-billing-app.com/api/subscription/status?appId=${appId}&externalUserId=user-123" \\
     -H "x-api-key: ${apiKey}"
`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
