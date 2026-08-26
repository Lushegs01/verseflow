import { route } from "@/lib/api/handler";
import { loadBundle, sendForSignature } from "@/lib/services/agreements";
import { requireParty } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";

export const runtime = "nodejs";

/** Move a draft into signature collection. */
export const POST = route<{ id: string }>({ auth: true }, async ({ params, auth }) => {
  const bundle = loadBundle(params.id);
  if (!bundle) throw errors.notFound("Agreement");
  requireParty(bundle.agreement, auth.user);

  const agreement = sendForSignature({ agreement: bundle.agreement, actor: auth.user });
  return { agreement };
});
