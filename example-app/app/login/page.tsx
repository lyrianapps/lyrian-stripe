"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BillingType } from "@/lib/auth";

// ── Tiny crypto helpers (no extra deps) ──────────────────────────────────────

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateUserId(): string {
  return crypto.randomUUID();
}

// ── localStorage credential store ────────────────────────────────────────────

interface StoredUser {
  userId: string;
  email: string;
  passwordHash: string;
  billingType: BillingType;
}

const STORAGE_KEY = "lyrian_users";

function getUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveUser(user: StoredUser) {
  const users = getUsers().filter((u) => u.email !== user.email);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...users, user]));
}

function findUser(email: string): StoredUser | undefined {
  return getUsers().find((u) => u.email === email);
}

// ── Component ─────────────────────────────────────────────────────────────────

type Tab = "register" | "login";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [billingType, setBillingType] = useState<BillingType>("flat_rate");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (findUser(email)) {
      setError("An account with this email already exists. Please log in.");
      setLoading(false);
      return;
    }

    try {
      const passwordHash = await sha256(password);
      const userId = generateUserId();
      saveUser({ userId, email, passwordHash, billingType });

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email, billingType }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Registration failed");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const user = findUser(email);
      if (!user) {
        setError("No account found with this email.");
        setLoading(false);
        return;
      }

      const passwordHash = await sha256(password);
      if (passwordHash !== user.passwordHash) {
        setError("Incorrect password.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          email: user.email,
          billingType: user.billingType,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Login failed");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {/* Tabs */}
        <div className="mb-6 flex rounded-lg border border-gray-200 p-0.5">
          {(["register", "login"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <form
          onSubmit={tab === "register" ? handleRegister : handleLogin}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {tab === "register" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Billing type
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBillingType("flat_rate")}
                  className={`rounded-lg border-2 p-3 text-left text-sm transition-colors ${
                    billingType === "flat_rate"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="font-medium text-gray-900">Subscription</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    Monthly flat rate, todo cap
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setBillingType("metered")}
                  className={`rounded-lg border-2 p-3 text-left text-sm transition-colors ${
                    billingType === "metered"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="font-medium text-gray-900">Pay as You Go</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    Per todo, no monthly cap
                  </div>
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading
              ? "Please wait…"
              : tab === "register"
                ? "Create account"
                : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
