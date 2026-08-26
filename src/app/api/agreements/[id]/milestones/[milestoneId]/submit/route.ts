import { route, parseBody } from "@/lib/api/handler";
import { milestoneSubmissionSchema } from "@/lib/domain/validation";
import { loadBundle } from "@/lib/services/agreements";
import { submitMilestone } from "@/lib/services/milestones";
import { requireRole, assertNotSelfDealing } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";
import { milestonesRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

type Params = { id: string; milestoneId: string };

export const POST = route<Params>(
  { auth: true, rateLimit: { limit: 30, windowSeconds: 300, scope: "milestone.submit" } },
  async ({ params, request, auth, ip }) => {
    const bundle = await loadBundle(params.id);
    if (!bundle) throw errors.notFound("Agreement");
    requireRole(bundle.agreement, auth.user, "provider");
    assertNotSelfDealing(bundle.agreement, auth.user, "submit");

    const milestone = await milestonesRepo.byId(params.milestoneId);
    if (!milestone || milestone.agreementId !== bundle.agreement.id) {
      throw errors.notFound("Milestone");
    }

    const input = await parseBody(request, milestoneSubmissionSchema);
    const result = await submitMilestone({ bundle, milestone, actor: auth.user, input, ip });

    return {
      milestone: result.milestone,
      evidence: result.evidence,
      analysis: result.analysis,
      bundleHash: result.bundleHash,
      anchorTxHash: result.anchorTxHash,
    };
  },
);
