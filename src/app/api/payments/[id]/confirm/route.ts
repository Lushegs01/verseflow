import { route } from "@/lib/api/handler";
import { confirmRelease } from "@/lib/services/escrow";
import { paymentsRepo, agreementsRepo } from "@/lib/db/repositories";
import { requireParty } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";

export const runtime = "nodejs";

/**
 * Verify a release transaction. Polled by the client after approving. This is the
 * only path that marks a payment confirmed and credits a milestone.
 */
export const POST = route<{ id: string }>(
  { auth: true, rateLimit: { limit: 120, windowSeconds: 60, scope: "payment.confirm" } },
  async ({ params, auth, ip }) => {
    const payment = paymentsRepo.byId(params.id);
    if (!payment) throw errors.notFound("Payment");

    const agreement = agreementsRepo.byId(payment.agreementId);
    if (!agreement) throw errors.notFound("Agreement");
    requireParty(agreement, auth.user);

    const result = await confirmRelease({ payment, actor: auth.user, ip });
    return { status: result.status, payment: result.payment, reason: result.reason ?? null };
  },
);
