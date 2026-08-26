import { route, parseBody } from "@/lib/api/handler";
import { disputeOpenSchema } from "@/lib/domain/validation";
import { loadBundle } from "@/lib/services/agreements";
import { openDispute } from "@/lib/services/disputes";
import { requireParty } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";
import { milestonesRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

type Params = { id: string; milestoneId: string };

export const POST = route<Params>(
  { auth: true, rateLimit: { limit: 10, windowSeconds: 300, scope: "dispute.open" } },
  async ({ params, request, auth, ip }) => {
    const bundle = loadBundle(params.id);
    if (!bundle) throw errors.notFound("Agreement");
    requireParty(bundle.agreement, auth.user);

    const milestone = milestonesRepo.byId(params.milestoneId);
    if (!milestone || milestone.agreementId !== bundle.agreement.id) {
      throw errors.notFound("Milestone");
    }

    const input = await parseBody(request, disputeOpenSchema);
    const dispute = openDispute({ bundle, milestone, actor: auth.user, input, ip });

    return { dispute };
  },
);
