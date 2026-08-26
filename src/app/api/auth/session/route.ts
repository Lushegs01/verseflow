import { route } from "@/lib/api/handler";
import { getAuth, signOut } from "@/lib/services/auth";
import { walletsRepo, notificationsRepo } from "@/lib/db/repositories";
import { publicChainInfo } from "@/lib/chain/config";

export const runtime = "nodejs";

/** Current session, used by the client shell to hydrate wallet + user state. */
export const GET = route({}, async () => {
  const auth = await getAuth();
  const chain = publicChainInfo();

  if (!auth) return { user: null, address: null, chain };

  return {
    user: {
      id: auth.user.id,
      handle: auth.user.handle,
      displayName: auth.user.displayName,
      headline: auth.user.headline,
      avatarColor: auth.user.avatarColor,
      isAdmin: auth.user.isAdmin,
      publicProfileEnabled: auth.user.publicProfileEnabled,
    },
    address: auth.address,
    wallets: await walletsRepo.forUser(auth.user.id),
    unreadNotifications: await notificationsRepo.unreadCount(auth.user.id),
    chain,
  };
});

export const DELETE = route({}, async () => {
  await signOut();
  return { ok: true };
});
