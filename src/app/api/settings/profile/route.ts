import { route, parseBody } from "@/lib/api/handler";
import { profileUpdateSchema } from "@/lib/domain/validation";
import { usersRepo } from "@/lib/db/repositories";
import { indexPublicProfile, audit } from "@/lib/services/activity";

export const runtime = "nodejs";

export const PATCH = route({ auth: true }, async ({ request, auth, ip }) => {
  const body = await parseBody(request, profileUpdateSchema);

  await usersRepo.updateProfile(auth.user.id, {
    displayName: body.displayName,
    headline: body.headline,
    bio: body.bio,
    professions: body.professions as never,
    timezone: body.timezone,
  });

  const updated = (await usersRepo.byId(auth.user.id))!;
  if (updated.publicProfileEnabled) await indexPublicProfile(updated);

  await audit({
    actorId: auth.user.id,
    action: "settings.profile",
    entityType: "user",
    entityId: auth.user.id,
    before: { displayName: auth.user.displayName },
    after: { displayName: updated.displayName },
    ip,
  });

  return { user: updated };
});
