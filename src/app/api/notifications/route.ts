import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { notificationsRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

export const GET = route({ auth: true }, async ({ auth }) => ({
  notifications: await notificationsRepo.forUser(auth.user.id, 40),
  unread: await notificationsRepo.unreadCount(auth.user.id),
}));

/** Mark notifications read. An empty id list marks everything read. */
export const POST = route({ auth: true }, async ({ request, auth }) => {
  const { ids } = await parseBody(request, z.object({ ids: z.array(z.string()).nullable().default(null) }));
  await notificationsRepo.markRead(auth.user.id, ids);
  return { unread: await notificationsRepo.unreadCount(auth.user.id) };
});
