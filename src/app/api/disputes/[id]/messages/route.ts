import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { disputesRepo, usersRepo } from "@/lib/db/repositories";
import { loadBundle } from "@/lib/services/agreements";
import { addMessage } from "@/lib/services/disputes";
import { requireParty } from "@/lib/services/auth";
import { errors } from "@/lib/domain/errors";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = route<Params>({ auth: true }, async ({ params, auth }) => {
  const dispute = disputesRepo.byId(params.id);
  if (!dispute) throw errors.notFound("Dispute");

  const bundle = loadBundle(dispute.agreementId);
  if (!bundle) throw errors.notFound("Agreement");
  requireParty(bundle.agreement, auth.user);

  const messages = disputesRepo.messages(dispute.id);
  const authors = new Map(
    messages.map((m) => {
      const user = usersRepo.byId(m.authorId);
      return [
        m.authorId,
        {
          displayName: user?.displayName ?? "Unknown",
          avatarColor: user?.avatarColor ?? "#A8A49B",
        },
      ];
    }),
  );

  return {
    dispute,
    messages: messages.map((m) => ({ ...m, author: authors.get(m.authorId) })),
  };
});

export const POST = route<Params>(
  { auth: true, rateLimit: { limit: 40, windowSeconds: 300, scope: "dispute.message" } },
  async ({ params, request, auth }) => {
    const dispute = disputesRepo.byId(params.id);
    if (!dispute) throw errors.notFound("Dispute");

    const bundle = loadBundle(dispute.agreementId);
    if (!bundle) throw errors.notFound("Agreement");
    requireParty(bundle.agreement, auth.user);

    const { body } = await parseBody(
      request,
      z.object({ body: z.string().trim().min(2).max(4000) }),
    );
    const message = addMessage({ dispute, actor: auth.user, body, agreement: bundle });

    return { message };
  },
);
