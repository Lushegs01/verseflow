import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { reconcile } from "@/lib/services/escrow";
import { audit } from "@/lib/services/activity";

export const runtime = "nodejs";

/**
 * Compare the payment ledger against the settlement layer for one agreement.
 *
 * Read-only: it reports divergence, it does not correct it. Silently "fixing" a
 * mismatch between the database and the chain would destroy the only signal that
 * something is wrong.
 */
export const POST = route(
  { admin: true, rateLimit: { limit: 60, windowSeconds: 60, scope: "admin.reconcile" } },
  async ({ request, auth, ip }) => {
    const { agreementId } = await parseBody(request, z.object({ agreementId: z.string().min(1) }));
    const result = await reconcile(agreementId);

    audit({
      actorId: auth.user.id,
      action: "admin.reconcile",
      entityType: "agreement",
      entityId: agreementId,
      after: { ok: result.ok, issues: result.issues },
      ip,
    });

    return result;
  },
);
