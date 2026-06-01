import { SettingsPage } from "@/components/SettingsPage";
import { getDemoMode } from "@/lib/demoMode";

export default async function Settings() {
  const demoMode = await getDemoMode();
  return (
    <>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>
      <SettingsPage demoMode={demoMode} />
    </>
  );
}
