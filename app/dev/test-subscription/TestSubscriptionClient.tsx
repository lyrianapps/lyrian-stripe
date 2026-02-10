"use client";

import { useState } from "react";

export default function TestSubscriptionClient() {
  const [appId, setAppId] = useState("dev_app_basic12");
  const [externalUserId, setExternalUserId] = useState("dev_basic_user12");
  const [minutes, setMinutes] = useState(30);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleCreateAndOpen = async () => {
    setLoading(true);
    setMessage(null);
    try {
      // create test subscription
      const res = await fetch("/api/dev/create-test-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, externalUserId, minutes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Failed to create test subscription");
        setLoading(false);
        return;
      }

      // create portal URL (signed JWT) and redirect
      const p = await fetch("/api/dev/create-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, externalUserId, expiresMinutes: 15 }),
      });
      const pd = await p.json();
      if (!p.ok) {
        setMessage(pd.error || "Failed to create portal URL");
        setLoading(false);
        return;
      }

      window.location.href = pd.url;
    } catch (err) {
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold mb-4">Dev: Create Test Subscription</h2>

      <label className="block mb-2">
        <span className="text-sm font-medium">App ID</span>
        <input
          className="mt-1 block w-full"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        />
      </label>

      <label className="block mb-2">
        <span className="text-sm font-medium">External User ID</span>
        <input
          className="mt-1 block w-full"
          value={externalUserId}
          onChange={(e) => setExternalUserId(e.target.value)}
        />
      </label>

      <label className="block mb-4">
        <span className="text-sm font-medium">Expires (minutes)</span>
        <input
          type="number"
          className="mt-1 block w-32"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
        />
      </label>

      <div className="flex gap-2">
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded"
          onClick={handleCreateAndOpen}
          disabled={loading}
        >
          {loading ? "Creating…" : "Create & Open Portal"}
        </button>
      </div>

      {message && <p className="mt-4 text-red-600">{message}</p>}
    </div>
  );
}
