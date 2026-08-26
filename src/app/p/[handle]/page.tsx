import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Check, ArrowRight, ShieldCheck } from "lucide-react";
import { buildPublicProfile } from "@/lib/services/reputation";
import { formatDate } from "@/lib/utils/format";
import { Badge } from "@/components/ui";
import { ShareProfile } from "@/components/app/share-profile";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { ProfileViewTracker } from "@/components/app/profile-view-tracker";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const profile = buildPublicProfile(handle);
  if (!profile) return { title: "Profile not found", robots: { index: false } };

  return {
    title: `${profile.user.displayName} · Verified work history`,
    description:
      profile.user.headline ||
      `${profile.user.displayName} on VerseFlow — verifiable work history from settled escrow agreements.`,
    openGraph: {
      title: `${profile.user.displayName} · VerseFlow`,
      description: profile.user.headline,
      type: "profile",
    },
  };
}

export default async function PublicProfilePage({
  params,
}: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = buildPublicProfile(handle);

  // A profile that has not opted in is a 404, not a "this user is private" page.
  // The absence of a public profile is itself private information.
  if (!profile) notFound();

  return (
    <div className="min-h-dvh bg-surface">
      <ProfileViewTracker handle={handle} />

      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center px-5 sm:px-8">
          <Link href="/" className="font-display text-xl tracking-tight">VerseFlow</Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/app/agreements/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
            >
              Create an agreement
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        {/* ---------- Identity ---------- */}
        <div className="flex flex-wrap items-start gap-5">
          <span
            className="flex size-16 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
            style={{ backgroundColor: profile.user.avatarColor }}
            aria-hidden
          >
            {profile.user.displayName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="font-display text-4xl leading-tight">{profile.user.displayName}</h1>
            {profile.user.headline ? (
              <p className="mt-1 text-base text-muted">{profile.user.headline}</p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="settle" icon={<ShieldCheck className="size-3" />}>
                Verified work history
              </Badge>
              <span className="text-2xs text-faint">
                On VerseFlow since {formatDate(profile.memberSince, { withYear: true })}
              </span>
            </div>
          </div>

          <ShareProfile handle={profile.user.handle} name={profile.user.displayName} />
        </div>

        {profile.user.bio ? (
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted">{profile.user.bio}</p>
        ) : null}

        {/* ---------- Metrics ---------- */}
        {profile.metrics.length > 0 ? (
          <section className="mt-10" aria-labelledby="stats-heading">
            <h2 id="stats-heading" className="sr-only">Work statistics</h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
              {profile.metrics.map((metric) => (
                <div key={metric.key} className="bg-raised p-5">
                  <p className="text-2xl font-semibold tabular">{metric.value}</p>
                  <p className="mt-1 text-xs font-medium">{metric.label}</p>
                  <p className="mt-0.5 text-2xs leading-tight text-faint">{metric.caption}</p>
                </div>
              ))}
            </div>

            <p className="mt-3 text-2xs leading-relaxed text-faint">
              Every figure is derived from agreements that were signed, funded, and settled
              through escrow. None of it is self-reported, and {profile.user.displayName.split(" ")[0]}{" "}
              chose which metrics appear here.
            </p>
          </section>
        ) : null}

        {/* ---------- Selected work ---------- */}
        {profile.showcase.length > 0 ? (
          <section className="mt-10" aria-labelledby="work-heading">
            <h2 id="work-heading" className="text-sm font-semibold">Selected work</h2>
            <ul className="mt-3 space-y-2.5">
              {profile.showcase.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-line bg-raised p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-medium">{item.title}</h3>
                      {item.summary ? (
                        <p className="mt-1 text-sm text-subtle">{item.summary}</p>
                      ) : null}
                    </div>
                    {item.valueLabel ? (
                      <span className="shrink-0 text-sm font-semibold tabular text-subtle">
                        {item.valueLabel}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs">
                    <span className="flex items-center gap-1 text-settle">
                      <Check className="size-3" aria-hidden />
                      {item.completedOnTime ? "Completed on time" : "Completed"}
                    </span>
                    <span className="text-faint">
                      {item.milestoneCount} milestone{item.milestoneCount === 1 ? "" : "s"} settled
                    </span>
                    {item.completedAt ? (
                      <span className="text-faint">{formatDate(item.completedAt, { withYear: true })}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ---------- CTA ---------- */}
        <section className="mt-12 rounded-xl border border-line bg-raised p-6 sm:p-8">
          <h2 className="font-display text-2xl">
            Work with {profile.user.displayName.split(" ")[0]} through VerseFlow
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            Set up milestones, lock the budget in escrow, and release payment as work is
            approved. Both sides see the same terms and the same record.
          </p>
          <Link
            href="/app/agreements/new"
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
          >
            Create an agreement
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
          <p className="text-2xs text-faint">
            Reputation on VerseFlow is computed from settled escrow agreements. Contract
            details, evidence, and counterparties are never published.
          </p>
        </div>
      </footer>
    </div>
  );
}
