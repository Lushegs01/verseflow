import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { showcaseSchema } from "@/lib/domain/validation";
import { showcaseRepo, agreementsRepo } from "@/lib/db/repositories";
import { newId, nowIso } from "@/lib/domain/ids";
import { errors } from "@/lib/domain/errors";
import { roleOn } from "@/lib/services/auth";
import { track } from "@/lib/services/activity";

export const runtime = "nodejs";

export const GET = route({ auth: true }, async ({ auth }) => ({
  items: showcaseRepo.forUser(auth.user.id),
}));

/**
 * Publish a completed agreement on the public profile. Ownership and completion
 * are re-checked here rather than trusted from the client.
 */
export const POST = route({ auth: true }, async ({ request, auth }) => {
  const body = await parseBody(request, showcaseSchema);

  const agreement = agreementsRepo.byId(body.agreementId);
  if (!agreement) throw errors.notFound("Agreement");
  if (!roleOn(agreement, auth.user.id)) throw errors.notFound("Agreement");
  if (agreement.status !== "completed") {
    throw errors.forbidden("Only completed agreements can be published.");
  }

  const item = showcaseRepo.upsert({
    id: newId("shw"),
    userId: auth.user.id,
    agreementId: body.agreementId,
    publicTitle: body.publicTitle,
    summary: body.summary,
    anonymizeValue: body.anonymizeValue,
    position: showcaseRepo.forUser(auth.user.id).length,
    createdAt: nowIso(),
  });

  track({
    name: "public_agreement_shared",
    userId: auth.user.id,
    agreementId: agreement.id,
    properties: { anonymized: body.anonymizeValue },
  });

  return { item };
});

export const DELETE = route({ auth: true }, async ({ request, auth }) => {
  const { id } = await parseBody(request, z.object({ id: z.string().min(1) }));
  showcaseRepo.remove(id, auth.user.id);
  return { ok: true };
});
