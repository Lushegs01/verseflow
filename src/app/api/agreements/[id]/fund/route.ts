import { route, parseBody } from "@/lib/api/handler";
import { fundingSchema } from "@/lib/domain/validation";
import { loadBundle } from "@/lib/services/agreements";
import { prepareFunding } from "@/lib/services/escrow";
import { requireRole } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";

export const runtime = "nodejs";

/**
 * Prepare escrow funding. In live mode this returns an unsigned transaction for
 * the client's wallet; the server never signs.
 */
export const POST = route<{ id: string }>(
  { auth: true, rateLimit: { limit: 15, windowSeconds: 60, scope: "escrow.fund" } },
  async ({ params, request, auth }) => {
    const bundle = loadBundle(params.id);
    if (!bundle) throw errors.notFound("Agreement");
    requireRole(bundle.agreement, auth.user, "client");

    const body = await parseBody(request, fundingSchema);
    const intent = await prepareFunding({
      bundle,
      actor: auth.user,
      idempotencyKey: body.idempotencyKey,
      fromAddress: body.fromAddress,
    });

    return { intent };
  },
);
