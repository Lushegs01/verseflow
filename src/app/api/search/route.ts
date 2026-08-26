import { route } from "@/lib/api/handler";
import { searchRepo } from "@/lib/db/repositories";

export const runtime = "nodejs";

/**
 * Global search. Results are filtered to what the viewer is entitled to see --
 * a payment id or transaction hash belonging to someone else returns nothing.
 */
export const GET = route({}, async ({ request, auth }) => {
  const term = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (term.length < 2) return { results: [] };

  const results = await searchRepo.query(term, auth?.user.id ?? null, 20);
  return {
    results: results.map((r) => ({
      type: r.entityType,
      id: r.entityId,
      title: r.title,
      subtitle: r.subtitle,
      href: r.href,
    })),
  };
});
