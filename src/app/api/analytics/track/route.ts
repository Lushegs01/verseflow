import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { track } from "@/lib/services/activity";

export const runtime = "nodejs";

const ANALYTICS_EVENTS = [
  "wallet_connected", "agreement_created", "ai_agreement_generated", "agreement_signed",
  "escrow_funded", "milestone_submitted", "evidence_uploaded", "milestone_approved",
  "payment_released", "partial_payment_executed", "revision_requested", "dispute_opened",
  "dispute_resolved", "reputation_profile_viewed", "public_agreement_shared",
  "demo_mode_started", "command_palette_opened",
] as const;

const schema = z.object({
  name: z.enum(ANALYTICS_EVENTS),
  anonymousId: z.string().max(64).optional(),
  agreementId: z.string().max(64).nullable().default(null),
  properties: z.record(z.unknown()).default({}),
});

/**
 * Client-side product events. Server-side events are recorded directly by the
 * services; this covers the ones only the browser can see (profile views, palette
 * opens) and is rate limited because it is an unauthenticated write path.
 */
export const POST = route(
  { rateLimit: { limit: 120, windowSeconds: 60, scope: "analytics.track" } },
  async ({ request, auth }) => {
    const body = await parseBody(request, schema);
    await track({
      name: body.name,
      userId: auth?.user.id ?? null,
      anonymousId: body.anonymousId,
      agreementId: body.agreementId,
      properties: body.properties as Record<string, unknown>,
    });
    return { ok: true };
  },
);
