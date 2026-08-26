import { route, parseBody } from "@/lib/api/handler";
import { approvalSchema } from "@/lib/domain/validation";
import { loadBundle } from "@/lib/services/agreements";
import { releaseMilestone, remainingFor } from "@/lib/services/escrow";
import { requireRole, assertNotSelfDealing } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";
import { milestonesRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

type Params = { id: string; milestoneId: string };

/** Approve in full and release the remaining balance for the milestone. */
export const POST = route<Params>(
  { auth: true, rateLimit: { limit: 30, windowSeconds: 60, scope: "milestone.approve" } },
  async ({ params, request, auth, ip }) => {
    const bundle = await loadBundle(params.id);
    if (!bundle) throw errors.notFound("Agreement");
    requireRole(bundle.agreement, auth.user, "client");
    assertNotSelfDealing(bundle.agreement, auth.user, "approve");

    const milestone = await milestonesRepo.byId(params.milestoneId);
    if (!milestone || milestone.agreementId !== bundle.agreement.id) {
      throw errors.notFound("Milestone");
    }

    const body = await parseBody(request, approvalSchema);
    const amount = await remainingFor(milestone);

    const result = await releaseMilestone({
      bundle,
      milestone,
      actor: auth.user,
      amount,
      kind: "milestone_release",
      reason: body.note || null,
      idempotencyKey: body.idempotencyKey,
      ip,
    });

    return {
      payment: result.payment,
      milestone: result.milestone,
      transaction: result.transaction,
    };
  },
);
