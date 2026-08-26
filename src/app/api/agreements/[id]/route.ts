import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { agreementDraftSchema } from "@/lib/domain/validation";
import { loadBundle, updateAgreement, computeProgress, cancelAgreement } from "@/lib/services/agreements";
import { loadMilestoneDetail } from "@/lib/services/milestones";
import { requireParty, roleOn } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";
import { activityRepo, paymentsRepo, disputesRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = route<Params>({ auth: true }, async ({ params, auth }) => {
  const bundle = loadBundle(params.id);
  if (!bundle) throw errors.notFound("Agreement");
  requireParty(bundle.agreement, auth.user);

  return {
    agreement: bundle.agreement,
    milestones: bundle.milestones.map((m) => loadMilestoneDetail(m)),
    progress: computeProgress(bundle),
    role: roleOn(bundle.agreement, auth.user.id),
    client: bundle.client && {
      id: bundle.client.id, displayName: bundle.client.displayName,
      handle: bundle.client.handle, avatarColor: bundle.client.avatarColor,
    },
    provider: bundle.provider && {
      id: bundle.provider.id, displayName: bundle.provider.displayName,
      handle: bundle.provider.handle, avatarColor: bundle.provider.avatarColor,
    },
    clientAddress: bundle.clientAddress,
    providerAddress: bundle.providerAddress,
    activity: activityRepo.forAgreement(bundle.agreement.id),
    payments: paymentsRepo.forAgreement(bundle.agreement.id),
    disputes: disputesRepo.forAgreement(bundle.agreement.id),
  };
});

export const PATCH = route<Params>({ auth: true }, async ({ params, request, auth, ip }) => {
  const bundle = loadBundle(params.id);
  if (!bundle) throw errors.notFound("Agreement");
  requireParty(bundle.agreement, auth.user);

  const draft = await parseBody(request, agreementDraftSchema);
  const updated = updateAgreement({ agreement: bundle.agreement, input: draft, actor: auth.user, ip });

  return { agreement: updated.agreement, milestones: updated.milestones };
});

export const DELETE = route<Params>({ auth: true }, async ({ params, request, auth, ip }) => {
  const bundle = loadBundle(params.id);
  if (!bundle) throw errors.notFound("Agreement");
  requireParty(bundle.agreement, auth.user);

  const { reason } = await parseBody(
    request,
    z.object({ reason: z.string().trim().min(3).max(500).default("Cancelled by a party.") }),
  );

  const agreement = cancelAgreement({ agreement: bundle.agreement, actor: auth.user, reason, ip });
  return { agreement };
});
