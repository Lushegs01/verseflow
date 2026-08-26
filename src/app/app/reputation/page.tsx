import Link from "next/link";
import type { Metadata } from "next";
import { TrendingUp, Eye, EyeOff, ExternalLink, Share2, Award } from "lucide-react";
import { requireAuth } from "@/lib/services/auth";
import { computeReputation, showcaseCandidates } from "@/lib/services/reputation";
import { showcaseRepo } from "@/lib/db/repositories";
import { formatMoney } from "@/lib/domain/money";
import { formatDate } from "@/lib/utils/format";
import { Card, Badge, EmptyState, Alert } from "@/components/ui";
import { StatTile } from "@/components/app/stat-tile";
import { ShowcaseManager } from "@/components/app/showcase-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reputation" };

export default async function ReputationPage() {
  const auth = await requireAuth();
  const reputation = computeReputation(auth.user.id);
  const candidates = showcaseCandidates(auth.user.id);
  const showcase = showcaseRepo.forUser(auth.user.id);

  const hasHistory = reputation.contractsCompleted > 0 || reputation.milestonesCompleted > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Work reputation</h1>
          <p className="mt-1 max-w-xl text-sm text-subtle">
            Computed from agreements that were signed, funded, and settled. Nothing here
            is self-reported.
          </p>
        </div>

        {auth.user.publicProfileEnabled ? (
          <Link
            href={`/p/${auth.user.handle}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-medium transition-colors hover:bg-raised"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            View public profile
          </Link>
        ) : null}
      </header>

      {!hasHistory ? (
        <Card>
          <EmptyState
            icon={<Award className="size-5" />}
            title="No reputation yet"
            description="Complete your first agreement to start building your work history."
            action={
              <Link
                href="/app/agreements/new"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
              >
                Create an Agreement
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {/* ---------- Metrics ---------- */}
          <section aria-label="Reputation metrics">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
              <StatTile
                label="Contracts completed"
                value={reputation.contractsCompleted}
                format="count"
                caption="Settled in full"
              />
              <StatTile
                label="Value settled"
                value={reputation.valueSettled}
                format="money"
                tone="settle"
                caption="Released through escrow"
              />
              <StatTile
                label="On time"
                value={reputation.onTimeRate}
                format="percent"
                caption="Milestones met by deadline"
              />
              <StatTile
                label="Milestone success"
                value={reputation.milestoneSuccessRate}
                format="percent"
                caption="Approved and paid"
              />
              <StatTile
                label="Disputes"
                value={reputation.disputeCount}
                format="count"
                tone={reputation.disputeCount > 0 ? "attn" : "neutral"}
                caption={`${reputation.disputeRate}% of agreements`}
              />
              <StatTile
                label="Repeat clients"
                value={reputation.repeatClientRate}
                format="percent"
                caption="Agreements from returning clients"
              />
              <StatTile
                label="Avg completion"
                value={reputation.avgCompletionDays}
                format="days"
                caption="Funding to final settlement"
              />
              <StatTile
                label="Milestones paid"
                value={reputation.milestonesCompleted}
                format="count"
                caption="Across all agreements"
              />
            </div>

            {reputation.firstSettlementAt ? (
              <p className="mt-3 text-2xs text-faint">
                Active since {formatDate(reputation.firstSettlementAt, { withYear: true })} ·
                Most recent settlement {formatDate(reputation.lastSettlementAt, { withYear: true })}
              </p>
            ) : null}
          </section>

          {/* ---------- Privacy state ---------- */}
          <section className="mt-6">
            <Alert
              tone={auth.user.publicProfileEnabled ? "settle" : "neutral"}
              icon={auth.user.publicProfileEnabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              title={
                auth.user.publicProfileEnabled
                  ? "Your public profile is live"
                  : "Your reputation is private"
              }
              action={
                <Link
                  href="/app/settings#privacy"
                  className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-xs font-medium transition-colors hover:bg-inset"
                >
                  {auth.user.publicProfileEnabled ? "Manage" : "Enable"}
                </Link>
              }
            >
              {auth.user.publicProfileEnabled ? (
                <>
                  Showing {auth.user.publicMetrics.length} metric
                  {auth.user.publicMetrics.length === 1 ? "" : "s"} at{" "}
                  <span className="font-mono">/p/{auth.user.handle}</span>. Contract details
                  are never exposed.
                </>
              ) : (
                <>
                  Nothing is visible to anyone else. Turn on a public profile to share a
                  verifiable work history with prospective clients.
                </>
              )}
            </Alert>
          </section>

          {/* ---------- Showcase ---------- */}
          <section className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <Share2 className="size-4 text-faint" aria-hidden />
              <h2 className="text-sm font-semibold">Selected work</h2>
              <span className="text-2xs text-faint">
                Choose which completed agreements appear publicly
              </span>
            </div>

            <ShowcaseManager
              candidates={candidates.map((a) => ({
                id: a.id,
                title: a.title,
                totalAmount: a.totalAmount,
                asset: a.asset,
                completedAt: a.completedAt,
              }))}
              existing={showcase.map((s) => ({
                id: s.id,
                agreementId: s.agreementId,
                publicTitle: s.publicTitle,
                summary: s.summary,
                anonymizeValue: s.anonymizeValue,
              }))}
            />
          </section>
        </>
      )}
    </div>
  );
}
