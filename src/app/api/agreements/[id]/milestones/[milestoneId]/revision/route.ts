import { route, parseBody } from "@/lib/api/handler";
import { revisionRequestSchema } from "@/lib/domain/validation";
import { loadBundle } from "@/lib/services/agreements";
import { requestRevision } from "@/lib/services/milestones";
import { requireRole } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";
import { milestonesRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

type Params = { id: string; milestoneId: string };

export const POST = route<Params>(
  { auth: true, rateLimit: { limit: 30, windowSeconds: 60, scope: "milestone.revision" } },
  async ({ params, request, auth, ip }) => {
    const bundle = await loadBundle(params.id);
    if (!bundle) throw errors.notFound("Agreement");
    requireRole(bundle.agreement, auth.user, "client");

    const milestone = await milestonesRepo.byId(params.milestoneId);
    if (!milestone || milestone.agreementId !== bundle.agreement.id) {
      throw errors.notFound("Milestone");
    }

    const input = await parseBody(request, revisionRequestSchema);
    const result = await requestRevision({ bundle, milestone, actor: auth.user, input, ip });

    return result;
  },
);
