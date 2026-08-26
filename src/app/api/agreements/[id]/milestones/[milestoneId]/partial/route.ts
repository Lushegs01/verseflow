import { route, parseBody } from "@/lib/api/handler";
import { partialApprovalSchema } from "@/lib/domain/validation";
import { loadBundle } from "@/lib/services/agreements";
import { releaseMilestone, remainingFor } from "@/lib/services/escrow";
import { requireRole, assertNotSelfDealing } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";
import { milestonesRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

type Params = { id: string; milestoneId: string };

/** Release part of a milestone. Requires a stated reason; the rest stays locked. */
export const POST = route<Params>(
  { auth: true, rateLimit: { limit: 30, windowSeconds: 60, scope: "milestone.partial" } },
  async ({ params, request, auth, ip }) => {
    const bundle = await loadBundle(params.id);
    if (!bundle) throw errors.notFound("Agreement");
    requireRole(bundle.agreement, auth.user, "client");
    assertNotSelfDealing(bundle.agreement, auth.user, "approve");

    const milestone = await milestonesRepo.byId(params.milestoneId);
    if (!milestone || milestone.agreementId !== bundle.agreement.id) {
      throw errors.notFound("Milestone");
    }

    const body = await parseBody(request, partialApprovalSchema);
    const remaining = await remainingFor(milestone);

    const result = await releaseMilestone({
      bundle,
      milestone,
      actor: auth.user,
      amount: body.amount,
      kind: body.amount >= remaining ? "milestone_release" : "partial_release",
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      ip,
    });

    return {
      payment: result.payment,
      milestone: result.milestone,
      transaction: result.transaction,
      remainingAfter: remaining - body.amount,
    };
  },
);
