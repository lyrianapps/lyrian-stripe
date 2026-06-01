import type { Metadata } from "next";
import Link from "next/link";
import { getDemoMode } from "@/lib/demoMode";
import { DemoModeSwitcher } from "@/components/DemoModeSwitcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "TodoApp — Billing Example",
  description:
    "Example Next.js app demonstrating lyrian-stripe pay-as-you-go billing integration",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demoMode = await getDemoMode();
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <div className="mx-auto max-w-2xl px-4 pb-16">
          <header className="flex items-center justify-between border-b border-gray-200 py-5 mb-8">
            <Link
              href="/"
              className="text-lg font-bold tracking-tight text-gray-900"
            >
              TodoApp
            </Link>
            <div className="flex items-center gap-4">
              <DemoModeSwitcher current={demoMode} />
              <nav className="flex gap-5 text-sm">
                <Link
                  href="/"
                  className="text-gray-500 hover:text-gray-900 transition-colors"
                >
                  Todos
                </Link>
                <Link
                  href="/settings"
                  className="text-gray-500 hover:text-gray-900 transition-colors"
                >
                  Settings
                </Link>
              </nav>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
