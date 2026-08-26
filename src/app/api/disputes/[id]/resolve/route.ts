import { route, parseBody } from "@/lib/api/handler";
import { disputeResolveSchema } from "@/lib/domain/validation";
import { disputesRepo } from "@/lib/db/repositories";
import { loadBundle } from "@/lib/services/agreements";
import { resolveDispute } from "@/lib/services/disputes";
import { requireParty } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";

export const runtime = "nodejs";

/**
 * Resolve a dispute. Parties can settle between themselves; escalated disputes are
 * resolved by an operator. Either path writes an immutable audit event.
 */
export const POST = route<{ id: string }>(
  { auth: true, rateLimit: { limit: 20, windowSeconds: 300, scope: "dispute.resolve" } },
  async ({ params, request, auth, ip }) => {
    const dispute = await disputesRepo.byId(params.id);
    if (!dispute) throw errors.notFound("Dispute");

    const bundle = await loadBundle(dispute.agreementId);
    if (!bundle) throw errors.notFound("Agreement");
    if (!auth.user.isAdmin) requireParty(bundle.agreement, auth.user);

    const input = await parseBody(request, disputeResolveSchema);
    const result = await resolveDispute({ dispute, bundle, actor: auth.user, input, ip });

    return result;
  },
);
