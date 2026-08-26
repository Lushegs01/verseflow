import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { agreementDraftSchema } from "@/lib/domain/validation";
import { createAgreement, listForUser, computeProgress } from "@/lib/services/agreements";

export const runtime = "nodejs";

/** Agreements the signed-in user is a party to. */
export const GET = route({ auth: true }, async ({ auth }) => {
  const bundles = await listForUser(auth.user.id);

  return {
    agreements: bundles.map((bundle) => ({
      id: bundle.agreement.id,
      reference: bundle.agreement.reference,
      title: bundle.agreement.title,
      status: bundle.agreement.status,
      totalAmount: bundle.agreement.totalAmount,
      asset: bundle.agreement.asset,
      role: bundle.agreement.clientId === auth.user.id ? "client" : "provider",
      counterparty:
        bundle.agreement.clientId === auth.user.id
          ? (bundle.provider?.displayName ?? "Awaiting provider")
          : (bundle.client?.displayName ?? "Unknown client"),
      counterpartyColor:
        bundle.agreement.clientId === auth.user.id
          ? (bundle.provider?.avatarColor ?? "#A8A49B")
          : (bundle.client?.avatarColor ?? "#A8A49B"),
      progress: computeProgress(bundle),
      isSimulated: bundle.agreement.isSimulated,
      updatedAt: bundle.agreement.updatedAt,
      expectedCompletionAt: bundle.agreement.expectedCompletionAt,
    })),
  };
});

const createSchema = z.object({
  draft: agreementDraftSchema,
  role: z.enum(["client", "provider"]).default("client"),
});

export const POST = route(
  { auth: true, rateLimit: { limit: 30, windowSeconds: 300, scope: "agreements.create" } },
  async ({ request, auth, ip }) => {
    const { draft, role } = await parseBody(request, createSchema);

    const bundle = await createAgreement({
      input: draft,
      creator: auth.user,
      creatorRole: role,
      ip,
    });

    return {
      agreement: bundle.agreement,
      milestones: bundle.milestones,
    };
  },
);
