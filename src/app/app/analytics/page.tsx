import type { Metadata } from "next";
import { Activity, TrendingUp, Info } from "lucide-react";
import { requireAuth } from "@/lib/services/auth";
import { computeProductMetrics } from "@/lib/services/analytics";
import { formatMoney } from "@/lib/domain/money";
import { Card, Badge, Alert } from "@/components/ui";
import { StatTile } from "@/components/app/stat-tile";
import { FunnelChart, VolumeChart } from "@/components/app/charts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics" };

/**
 * Internal product analytics.
 *
 * These are traction metrics, not vanity counts: activation, funding conversion,
 * completion, settled volume, dispute rate, and time to settlement. Every figure
 * is computed from the same records the product runs on.
 */
export default async function AnalyticsPage() {
  await requireAuth();
  const metrics = computeProductMetrics();

  const eventRows = Object.entries(metrics.eventCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 14);

  const totalEvents = Object.values(metrics.eventCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl">Analytics</h1>
        <p className="mt-1 max-w-2xl text-sm text-subtle">
          Product traction, measured from the agreement and payment records themselves.
        </p>
      </header>

      {/* ---------- Core metrics ---------- */}
      <section aria-label="Core metrics" className="mb-6">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
          <StatTile label="Agreements created" value={metrics.agreementsCreated} format="count" />
          <StatTile
            label="Funding volume"
            value={metrics.fundingVolume}
            format="money"
            asset={metrics.asset}
            tone="locked"
            caption="Total locked in escrow"
          />
          <StatTile
            label="Payment volume"
            value={metrics.paymentVolume}
            format="money"
            asset={metrics.asset}
            tone="settle"
            caption="Confirmed settlements"
          />
          <StatTile
            label="Milestones completed"
            value={metrics.milestonesCompleted}
            format="count"
          />
          <StatTile label="Unique users" value={metrics.uniqueUsers} format="count" />
          <StatTile
            label="Repeat users"
            value={metrics.repeatUsers}
            format="count"
            caption="More than one agreement"
          />
          <StatTile
            label="Avg time to milestone"
            value={metrics.avgTimeToMilestoneDays}
            format="days"
            caption="Submission to release"
          />
          <StatTile
            label="Avg agreement value"
            value={metrics.avgAgreementValue}
            format="money"
            asset={metrics.asset}
          />
        </div>
      </section>

      {/* ---------- Rates ---------- */}
      <section aria-label="Product rates" className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Product health</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-5">
          <StatTile
            label="Activation"
            value={metrics.activationRate}
            format="percent"
            caption="Users who created an agreement"
          />
          <StatTile
            label="Funding conversion"
            value={metrics.fundingConversion}
            format="percent"
            tone={metrics.fundingConversion >= 70 ? "settle" : "attn"}
            caption="Signed agreements funded"
          />
          <StatTile
            label="Completion rate"
            value={metrics.completionRate}
            format="percent"
            caption="Funded agreements completed"
          />
          <StatTile
            label="Milestone approval"
            value={metrics.milestoneApprovalRate}
            format="percent"
            caption="Reviewed milestones approved"
          />
          <StatTile
            label="Dispute rate"
            value={metrics.disputeRate}
            format="percent"
            tone={metrics.disputeRate > 10 ? "danger" : "neutral"}
            caption="Funded agreements disputed"
            className="col-span-2 lg:col-span-1"
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        {/* ---------- Funnel ---------- */}
        <section aria-labelledby="funnel-heading">
          <h2 id="funnel-heading" className="mb-3 text-sm font-semibold">
            Agreement lifecycle
          </h2>
          <Card className="p-5">
            <FunnelChart stages={metrics.funnel} />
          </Card>
        </section>

        {/* ---------- Volume ---------- */}
        <section aria-labelledby="volume-heading">
          <h2 id="volume-heading" className="mb-3 text-sm font-semibold">
            Weekly volume
          </h2>
          <Card className="p-5">
            {metrics.volumeByWeek.length === 0 ? (
              <p className="py-10 text-center text-sm text-faint">
                Volume will appear once agreements are funded.
              </p>
            ) : (
              <VolumeChart data={metrics.volumeByWeek} asset={metrics.asset} />
            )}
          </Card>
        </section>
      </div>

      {/* ---------- Events ---------- */}
      <section aria-labelledby="events-heading" className="mt-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="events-heading" className="text-sm font-semibold">Tracked events</h2>
          <Badge tone="neutral">{totalEvents.toLocaleString("en-US")} total</Badge>
          <span className="text-2xs text-faint">Forwarded to Verse App Analytics when configured</span>
        </div>

        <Card>
          {eventRows.length === 0 ? (
            <p className="p-8 text-center text-sm text-faint">No events recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {eventRows.map(([name, count]) => {
                const share = totalEvents > 0 ? (count / totalEvents) * 100 : 0;
                return (
                  <li key={name} className="flex items-center gap-4 px-5 py-2.5">
                    <span className="w-52 shrink-0 truncate font-mono text-2xs text-muted">{name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(share, 1)}%` }}
                      />
                    </span>
                    <span className="w-12 shrink-0 text-right text-xs font-medium tabular">
                      {count.toLocaleString("en-US")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      <Alert tone="neutral" className="mt-6" icon={<Info className="size-4" />} title="How these numbers are produced">
        Every metric on this page is computed at request time from the agreement,
        milestone, and payment tables — the same records the product operates on. Nothing
        is pre-aggregated or written by a seed, so a number here cannot be inflated
        without the underlying escrow activity actually existing.
      </Alert>
    </div>
  );
}
