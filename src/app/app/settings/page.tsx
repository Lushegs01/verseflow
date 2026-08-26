import type { Metadata } from "next";
import { requireAuth } from "@/lib/services/auth";
import { walletsRepo, notificationsRepo } from "@/lib/db/repositories";
import { PUBLIC_METRIC_OPTIONS, computeReputation } from "@/lib/services/reputation";
import { publicChainInfo } from "@/lib/chain/config";
import { SettingsPanels } from "@/components/app/settings-panels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await requireAuth();
  const wallets = await walletsRepo.forUser(auth.user.id);
  const preferences = await notificationsRepo.preferences(auth.user.id);
  const reputation = await computeReputation(auth.user.id);
  const chain = publicChainInfo();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-subtle">
          Your profile, wallets, privacy, and notifications.
        </p>
      </header>

      <SettingsPanels
        user={{
          id: auth.user.id,
          handle: auth.user.handle,
          displayName: auth.user.displayName,
          headline: auth.user.headline,
          bio: auth.user.bio,
          professions: auth.user.professions,
          timezone: auth.user.timezone,
          verification: auth.user.verification,
          publicProfileEnabled: auth.user.publicProfileEnabled,
          publicMetrics: auth.user.publicMetrics,
          isAdmin: auth.user.isAdmin,
          createdAt: auth.user.createdAt,
        }}
        wallets={wallets.map((w) => ({
          id: w.id,
          address: w.address,
          label: w.label,
          isPrimary: w.isPrimary,
          verifiedAt: w.verifiedAt,
          chainId: w.chainId,
        }))}
        activeAddress={auth.address}
        preferences={preferences}
        metricOptions={PUBLIC_METRIC_OPTIONS}
        hasReputation={reputation.contractsCompleted > 0}
        chain={chain}
      />
    </div>
  );
}
