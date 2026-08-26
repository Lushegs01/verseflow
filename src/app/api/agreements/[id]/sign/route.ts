import { route, parseBody } from "@/lib/api/handler";
import { signatureSchema } from "@/lib/domain/validation";
import { loadBundle, signAgreement, computeTermsHash } from "@/lib/services/agreements";
import { requireParty } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";

export const runtime = "nodejs";

type Params = { id: string };

/** The exact terms hash a party is about to sign, plus a human-readable preimage. */
export const GET = route<Params>({ auth: true }, async ({ params, auth }) => {
  const bundle = await loadBundle(params.id);
  if (!bundle) throw errors.notFound("Agreement");
  const role = requireParty(bundle.agreement, auth.user);

  const { termsHash, onChainId } = computeTermsHash(bundle);
  return {
    termsHash,
    onChainId,
    role,
    alreadySigned: Boolean(
      role === "client" ? bundle.agreement.clientSignature : bundle.agreement.providerSignature,
    ),
    message: [
      "VerseFlow agreement signature",
      "",
      `Agreement: ${bundle.agreement.reference} - ${bundle.agreement.title}`,
      `Value: ${bundle.agreement.totalAmount / 100} ${bundle.agreement.asset}`,
      `Milestones: ${bundle.milestones.length}`,
      `Terms hash: ${termsHash}`,
      "",
      "Signing binds you to these exact terms.",
    ].join("\n"),
  };
});

export const POST = route<Params>(
  { auth: true, rateLimit: { limit: 20, windowSeconds: 60, scope: "agreements.sign" } },
  async ({ params, request, auth, ip }) => {
    const bundle = await loadBundle(params.id);
    if (!bundle) throw errors.notFound("Agreement");
    const role = requireParty(bundle.agreement, auth.user);

    const body = await parseBody(request, signatureSchema);

    const result = await signAgreement({
      agreement: bundle.agreement,
      actor: auth.user,
      role,
      address: body.address,
      signature: body.signature,
      termsHash: body.termsHash,
      ip,
    });

    return { agreement: result.agreement, bothSigned: result.bothSigned };
  },
);
