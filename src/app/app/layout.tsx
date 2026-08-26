import { cookies } from "next/headers";
import { getAuth } from "@/lib/services/auth";
import { notificationsRepo } from "@/lib/db/repositories";
import { publicChainInfo } from "@/lib/chain/config";
import { hydrateSimulatedEscrowFromDb } from "@/lib/demo/seed";
import { AppShell, ConnectGate } from "@/components/app/shell";

export const dynamic = "force-dynamic";

/**
 * Application shell layout.
 *
 * Rebuilds the simulated escrow ledger on entry. Without this, a server restart
 * would leave funded agreements pointing at in-memory escrow state that no longer
 * exists, and the UI would show balances the settlement layer could not confirm.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const chain = publicChainInfo();

  if (chain.mode === "simulated") {
    try {
      await hydrateSimulatedEscrowFromDb();
    } catch (error) {
      console.error("[verseflow] could not rebuild simulated escrow state", error);
    }
  }

  const auth = await getAuth();
  if (!auth) return <ConnectGate />;

  const store = await cookies();
  const demoPersona = store.get("vf_demo")?.value ?? null;

  return (
    <AppShell
      user={{
        id: auth.user.id,
        handle: auth.user.handle,
        displayName: auth.user.displayName,
        avatarColor: auth.user.avatarColor,
        isAdmin: auth.user.isAdmin,
      }}
      address={auth.address}
      chain={{
        mode: chain.mode,
        name: chain.name,
        chainId: chain.chainId,
        hasExplorer: chain.hasExplorer,
      }}
      unreadCount={await notificationsRepo.unreadCount(auth.user.id)}
      demoPersona={demoPersona}
    >
      {children}
    </AppShell>
  );
}
