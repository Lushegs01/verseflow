import { route } from "@/lib/api/handler";
import { issueNonce, buildSignInMessage } from "@/lib/services/auth";
import { z } from "zod";
import { addressSchema } from "@/lib/domain/validation";

export const runtime = "nodejs";

/**
 * Issue a sign-in nonce. The nonce is stored in an httpOnly cookie so the client
 * cannot choose it, which is what makes the resulting signature replay-resistant.
 */
export const POST = route({ rateLimit: { limit: 20, windowSeconds: 60, scope: "auth.nonce" } }, async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = z.object({ address: addressSchema }).safeParse(body);
  if (!parsed.success) {
    return { error: { code: "VALIDATION_FAILED", message: "Enter a valid wallet address." } };
  }

  const nonce = await issueNonce();
  return { nonce, message: buildSignInMessage(parsed.data.address, nonce) };
});
