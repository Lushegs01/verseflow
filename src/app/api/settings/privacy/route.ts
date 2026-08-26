import { route, parseBody } from "@/lib/api/handler";
import { privacyUpdateSchema } from "@/lib/domain/validation";
import { usersRepo, searchRepo } from "@/lib/db/repositories";
import { indexPublicProfile, audit } from "@/lib/services/activity";

export const runtime = "nodejs";

/**
 * Reputation visibility. Nothing is public unless it is explicitly enabled here,
 * and disabling removes the profile from the public search index immediately.
 */
export const PATCH = route({ auth: true }, async ({ request, auth, ip }) => {
  const body = await parseBody(request, privacyUpdateSchema);

  usersRepo.updatePrivacy(auth.user.id, body.publicProfileEnabled, body.publicMetrics);
  const updated = usersRepo.byId(auth.user.id)!;

  if (updated.publicProfileEnabled) indexPublicProfile(updated);
  else searchRepo.remove("user", updated.id);

  audit({
    actorId: auth.user.id,
    action: "settings.privacy",
    entityType: "user",
    entityId: auth.user.id,
    before: {
      publicProfileEnabled: auth.user.publicProfileEnabled,
      publicMetrics: auth.user.publicMetrics,
    },
    after: {
      publicProfileEnabled: updated.publicProfileEnabled,
      publicMetrics: updated.publicMetrics,
    },
    ip,
  });

  return { user: updated };
});
