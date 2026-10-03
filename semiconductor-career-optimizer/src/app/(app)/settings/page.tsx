import { SettingsPanel } from "@/components/settings-panel";
import { currentUser } from "@/lib/server/session";

export default async function Page() {
  const user = (await currentUser())!;
  const provider = process.env.AI_PROVIDER || "mock";
  return <SettingsPanel email={user.email} provider={provider} external={provider !== "mock"} storage={process.env.STORAGE_DRIVER || "local"} />;
}
