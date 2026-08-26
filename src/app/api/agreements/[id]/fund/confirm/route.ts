import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { txHashSchema } from "@/lib/domain/validation";
import { loadBundle } from "@/lib/services/agreements";
import { confirmFunding } from "@/lib/services/escrow";
import { requireRole } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";

export const runtime = "nodejs";

/**
 * Verify the funding transaction against the settlement layer. Polled by the
 * funding UI. Only this endpoint can mark an agreement funded -- a wallet saying
 * "success" is not sufficient.
 */
export const POST = route<{ id: string }>(
  { auth: true, rateLimit: { limit: 120, windowSeconds: 60, scope: "escrow.confirm" } },
  async ({ params, request, auth, ip }) => {
    const bundle = await loadBundle(params.id);
    if (!bundle) throw errors.notFound("Agreement");
    requireRole(bundle.agreement, auth.user, "client");

    const { txHash } = await parseBody(request, z.object({ txHash: txHashSchema }));
    const result = await confirmFunding({ bundle, actor: auth.user, txHash, ip });

    return { status: result.status, agreement: result.agreement, reason: result.reason ?? null };
  },
);
