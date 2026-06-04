# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: paygo-subscription.spec.ts >> register → paygo upgrade → redirected back to settings
- Location: example-app/e2e/paygo-subscription.spec.ts:20:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected: "https://lyrian-example-app-494926016713.us-central1.run.app/"
Received: "https://lyrian-example-app-494926016713.us-central1.run.app/login"
Timeout:  15000ms

Call log:
  - Expect "toHaveURL" with timeout 15000ms
    34 × unexpected value "https://lyrian-example-app-494926016713.us-central1.run.app/login"

```

```yaml
- banner:
  - link "TodoApp":
    - /url: /
  - navigation:
    - link "Todos":
      - /url: /
    - link "Settings":
      - /url: /settings
  - text: paygo-test-1780596287452@example.com
  - button "Log out"
- main:
  - button "register"
  - button "login"
  - text: Email
  - textbox "you@example.com": paygo-test-1780596287452@example.com
  - text: Password
  - textbox "••••••••": test1234
  - text: Billing type
  - button "Subscription Monthly flat rate, todo cap"
  - button "Pay as You Go Per todo, no monthly cap"
  - button "Please wait…" [disabled]
- alert
```

# Test source

```ts
  1   | /**
  2   |  * E2E: Pay As You Go subscription flow
  3   |  *
  4   |  * 1. Register a new account with billing type "metered" (Pay as You Go)
  5   |  * 2. Navigate to Settings
  6   |  * 3. Click "Upgrade →" on the paygo plan card
  7   |  * 4. Complete Stripe test checkout (card 4242 4242 4242 4242)
  8   |  * 5. Get redirected back to /settings
  9   |  * 6. Screenshot the final state
  10  |  */
  11  | import { test, expect } from "@playwright/test";
  12  | import path from "path";
  13  | 
  14  | const TEST_PASSWORD = "test1234";
  15  | 
  16  | function uniqueEmail() {
  17  |   return `paygo-test-${Date.now()}@example.com`;
  18  | }
  19  | 
  20  | test("register → paygo upgrade → redirected back to settings", async ({
  21  |   page,
  22  | }) => {
  23  |   const testEmail = uniqueEmail();
  24  | 
  25  |   // ── 1. Register ────────────────────────────────────────────────────────────
  26  |   await page.goto("/login");
  27  |   await expect(page.locator("text=Create account")).toBeVisible();
  28  | 
  29  |   // Email & password
  30  |   await page.fill('input[type="email"]', testEmail);
  31  |   await page.fill('input[type="password"]', TEST_PASSWORD);
  32  | 
  33  |   // Select "Pay as You Go" billing type
  34  |   await page.click('button:has-text("Pay as You Go")');
  35  |   // Verify selection via class (Tailwind v4 uses oklab, not rgb)
  36  |   await expect(page.locator('button:has-text("Pay as You Go")')).toHaveClass(
  37  |     /border-blue-500/,
  38  |   );
  39  | 
  40  |   // Submit registration
  41  |   await page.click('button[type="submit"]:has-text("Create account")');
  42  | 
  43  |   // Should land on home (todo list)
> 44  |   await expect(page).toHaveURL("/", { timeout: 15000 });
      |                      ^ Error: expect(page).toHaveURL(expected) failed
  45  | 
  46  |   // ── 2. Navigate to Settings ────────────────────────────────────────────────
  47  |   await page.click('a[href="/settings"]');
  48  |   await expect(page).toHaveURL("/settings");
  49  |   await expect(page.locator("text=Available Plans")).toBeVisible({
  50  |     timeout: 10000,
  51  |   });
  52  | 
  53  |   // ── 3. Click Upgrade on the paygo plan card ────────────────────────────────
  54  |   // The paygo plan card shows "Usage-based" price and "Upgrade →" button
  55  |   const paygoCard = page
  56  |     .locator("div")
  57  |     .filter({ hasText: "Usage-based" })
  58  |     .first();
  59  |   await expect(paygoCard).toBeVisible({ timeout: 10000 });
  60  | 
  61  |   const upgradeButton = paygoCard.locator('button:has-text("Upgrade")');
  62  |   await upgradeButton.click();
  63  | 
  64  |   // ── 4. Stripe checkout ─────────────────────────────────────────────────────
  65  |   await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 });
  66  |   await page.screenshot({
  67  |     path: path.join("e2e", "screenshots", "stripe-checkout.png"),
  68  |     fullPage: true,
  69  |   });
  70  | 
  71  |   // Stripe hosted checkout: fill card details
  72  |   // Email may already be pre-filled from registration; fill if empty
  73  |   const emailInput = page
  74  |     .locator('input[type="email"], input[name="email"]')
  75  |     .first();
  76  |   if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
  77  |     const currentVal = await emailInput.inputValue().catch(() => "");
  78  |     if (!currentVal) {
  79  |       await emailInput.fill(testEmail);
  80  |     }
  81  |   }
  82  | 
  83  |   // Card number — Stripe renders card fields in iframes
  84  |   // Try the unified "Payment" iframe first, fall back to individual field iframes
  85  |   const cardNumberFrame = page.frameLocator(
  86  |     'iframe[title="Secure card number input frame"]',
  87  |   );
  88  |   const expiryFrame = page.frameLocator(
  89  |     'iframe[title="Secure expiry date input frame"]',
  90  |   );
  91  |   const cvcFrame = page.frameLocator('iframe[title="Secure CVC input frame"]');
  92  | 
  93  |   await cardNumberFrame.locator("input").fill("4242424242424242");
  94  |   await expiryFrame.locator("input").fill("1230");
  95  |   await cvcFrame.locator("input").fill("123");
  96  | 
  97  |   await page.screenshot({
  98  |     path: path.join("e2e", "screenshots", "stripe-checkout-filled.png"),
  99  |     fullPage: true,
  100 |   });
  101 | 
  102 |   // Submit the checkout form
  103 |   const submitButton = page
  104 |     .locator(
  105 |       'button[type="submit"], button:has-text("Subscribe"), button:has-text("Start"), button:has-text("Pay")',
  106 |     )
  107 |     .first();
  108 |   await expect(submitButton).toBeEnabled({ timeout: 5000 });
  109 |   await submitButton.click();
  110 | 
  111 |   // ── 5. Redirected back to /settings ───────────────────────────────────────
  112 |   await page.waitForURL(
  113 |     /lyrian-example-app.*\.run\.app\/settings|localhost.*\/settings/,
  114 |     { timeout: 30000 },
  115 |   );
  116 | 
  117 |   // Subscription should now be active (status badge)
  118 |   await expect(page.locator("text=active, text=trialing").first()).toBeVisible({
  119 |     timeout: 10000,
  120 |   });
  121 | 
  122 |   // ── 6. Screenshot ─────────────────────────────────────────────────────────
  123 |   await page.screenshot({
  124 |     path: path.join("e2e", "screenshots", "paygo-subscribed.png"),
  125 |     fullPage: true,
  126 |   });
  127 | 
  128 |   console.log("✅  Screenshot saved: e2e/screenshots/paygo-subscribed.png");
  129 | });
  130 | 
```