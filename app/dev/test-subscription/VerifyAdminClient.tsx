"use client";

import { useState } from "react";

export default function VerifyAdminClient() {
  const [adminToken, setAdminToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleVerifyToken = async () => {
    setVerifying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/dev/verify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: adminToken }),
      });
      if (res.ok) {
        setMessage("Verified as admin — reloading…");
        window.location.reload();
      } else {
        const d = await res.json().catch(() => ({}));
        setMessage(d.error || "Invalid token");
      }
    } catch (err) {
      setMessage("Network error");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold mb-4">Admin verification required</h2>
      <p className="mb-4 text-sm text-gray-600">
        Enter the dev admin token to access the test subscription tools.
      </p>

      <label className="block mb-2">
        <span className="text-sm font-medium">Admin token</span>
        <input
          className="mt-1 block w-full"
          value={adminToken}
          onChange={(e) => setAdminToken(e.target.value)}
        />
      </label>

      <div className="flex gap-2">
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded"
          onClick={handleVerifyToken}
          disabled={verifying}
        >
          {verifying ? "Verifying…" : "Verify"}
        </button>
      </div>

      {message && <p className="mt-4 text-red-600">{message}</p>}
    </div>
  );
}
