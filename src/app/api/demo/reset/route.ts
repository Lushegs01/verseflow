import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { toErrorResponse } from "@/lib/api/handler";
import { clearAllData, seedDemoData } from "@/lib/demo/seed";
import { SESSION_COOKIE } from "@/lib/services/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reset the demo environment to its seeded starting state.
 *
 * Deliberately gated: allowed in development, or in production only when
 * ALLOW_DEMO_RESET is explicitly set. A public endpoint that wipes the database
 * is not something to leave open by default.
 */
export async function POST(request: NextRequest) {
  try {
    const allowed =
      process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_RESET === "true";

    if (!allowed) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Demo reset is disabled in this environment.",
          },
        },
        { status: 403 },
      );
    }

    clearAllData();
    await seedDemoData();

    // The old session pointed at users that no longer exist.
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    store.delete("vf_demo");

    return NextResponse.json({ ok: true, redirect: "/api/demo/start?persona=client" });
  } catch (error) {
    return toErrorResponse(error);
  }
}
