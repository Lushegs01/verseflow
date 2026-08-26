import { route, parseBody } from "@/lib/api/handler";
import { aiGenerateSchema } from "@/lib/domain/validation";
import { generateAgreement } from "@/lib/ai/agreement-engine";
import { track } from "@/lib/services/activity";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Turn a natural-language brief into a structured agreement proposal.
 *
 * This endpoint never writes anything. It returns a draft the user reviews and
 * edits; creating the agreement is a separate, explicit action.
 */
export const POST = route(
  { auth: true, rateLimit: { limit: 20, windowSeconds: 300, scope: "ai.generate" } },
  async ({ request, auth }) => {
    const body = await parseBody(request, aiGenerateSchema);

    const generated = await generateAgreement({
      brief: body.brief,
      asset: body.asset,
      totalAmountHint: body.totalAmountHint,
    });

    await track({
      name: "ai_agreement_generated",
      userId: auth.user.id,
      properties: {
        engine: generated.engine,
        milestoneCount: generated.milestones.length,
        issueCount: generated.issues.length,
        briefLength: body.brief.length,
      },
    });

    return { generated };
  },
);
