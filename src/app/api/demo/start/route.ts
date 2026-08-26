import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { toErrorResponse } from "@/lib/api/handler";
import { seedDemoData, isSeeded, hydrateSimulatedEscrowFromDb, DEMO_ADDRESSES } from "@/lib/demo/seed";
import { sessionsRepo, usersRepo, agreementsRepo } from "@/lib/db/repositories";
import { SESSION_COOKIE } from "@/lib/services/auth";
import { track } from "@/lib/services/activity";
import { getChainConfig } from "@/lib/chain/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Demo mode.
 *
 * Seeds the environment if it is empty, then signs the visitor in as one of the
 * demo personas so a judge can experience the full lifecycle with no wallet, no
 * API keys, and no setup.
 *
 * The signed-in account is a real user record and every action taken from here
 * runs the real services -- this is a shortcut past authentication, not a
 * separate fake code path.
 */
export async function GET(request: NextRequest) {
  try {
    const persona = new URL(request.url).searchParams.get("persona") ?? "client";

    if (!await isSeeded()) {
      await seedDemoData();
    } else {
      await hydrateSimulatedEscrowFromDb();
    }

    const handle =
      persona === "provider" ? "alexmorgan" :
      persona === "operator" ? "vf-operations" :
      "northstarcoffee";

    const user = await usersRepo.byHandle(handle);
    if (!user) {
      return NextResponse.json(
        { error: { code: "INTERNAL", message: "Demo data could not be prepared." } },
        { status: 500 },
      );
    }

    const address =
      handle === "alexmorgan" ? DEMO_ADDRESSES.alex :
      handle === "vf-operations" ? DEMO_ADDRESSES.operator :
      DEMO_ADDRESSES.northstar;

    const session = await sessionsRepo.create(user.id, address, getChainConfig().chainId);
    const store = await cookies();
    store.set(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    // Marks the session as demo so the app shell can show the persona switcher.
    store.set("vf_demo", persona, { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });

    await track({ name: "demo_mode_started", userId: user.id, properties: { persona } });

    // Land each persona where their work actually is.
    const headline = await agreementsRepo.byReference("VF-1042");
    const destination =
      persona === "operator" ? "/app/admin" :
      headline ? `/app/agreements/${headline.id}` : "/app";

    return NextResponse.redirect(new URL(destination, request.url));
  } catch (error) {
    return toErrorResponse(error);
  }
}
