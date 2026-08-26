import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { signIn } from "@/lib/services/auth";
import { addressSchema } from "@/lib/domain/validation";
import { track } from "@/lib/services/activity";
import { walletsRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

const schema = z.object({
  address: addressSchema,
  signature: z.string().min(4).max(2000),
  displayName: z.string().trim().max(80).optional(),
});

export const POST = route(
  { rateLimit: { limit: 10, windowSeconds: 60, scope: "auth.verify" } },
  async ({ request }) => {
    const body = await parseBody(request, schema);
    const auth = await signIn(body);

    track({
      name: "wallet_connected",
      userId: auth.user.id,
      properties: { address: auth.address, isNewUser: auth.user.displayName.startsWith("Wallet ") },
    });

    return {
      user: {
        id: auth.user.id,
        handle: auth.user.handle,
        displayName: auth.user.displayName,
        avatarColor: auth.user.avatarColor,
        isAdmin: auth.user.isAdmin,
      },
      address: auth.address,
      wallets: walletsRepo.forUser(auth.user.id),
    };
  },
);
