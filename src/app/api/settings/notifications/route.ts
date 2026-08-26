import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { notificationsRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

export const GET = route({ auth: true }, async ({ auth }) => ({
  preferences: notificationsRepo.preferences(auth.user.id),
}));

export const PATCH = route({ auth: true }, async ({ request, auth }) => {
  const body = await parseBody(
    request,
    z.object({
      channels: z.record(z.boolean()).default({}),
      digestMode: z.boolean().default(false),
    }),
  );

  notificationsRepo.savePreferences({
    userId: auth.user.id,
    channels: body.channels as never,
    digestMode: body.digestMode,
  });

  return { preferences: notificationsRepo.preferences(auth.user.id) };
});
