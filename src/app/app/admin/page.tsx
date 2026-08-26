import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Shield, AlertTriangle, ExternalLink, Lock, Scale } from "lucide-react";
import { getAuth } from "@/lib/services/auth";
import {
  agreementsRepo, usersRepo, paymentsRepo, disputesRepo, auditRepo, milestonesRepo,
} from "@/lib/db/repositories";
import { computeProductMetrics } from "@/lib/services/analytics";
import { formatMoney } from "@/lib/domain/money";
import { shortHash } from "@/lib/domain/hashing";
import { publicChainInfo } from "@/lib/chain/config";
import {
  formatDateTime, relativeTime, AGREEMENT_STATUS_META, PAYMENT_STATUS_META,
} from "@/lib/utils/format";
import { Card, Badge, Alert, Mono, EmptyState } from "@/components/ui";
import { StatTile } from "@/components/app/stat-tile";
import { ReconcileButton } from "@/components/app/reconcile-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operations" };

/**
 * Operations console.
 *
 * Read-heavy by design. The only write action available here is dispute
 * resolution, which runs through the same service and audit path as everything
 * else. There is no control on this page that can silently alter a payment, a
 * milestone, or historical financial state.
 */
export default async function AdminPage() {
  const auth = await getAuth();
  if (!auth) redirect("/app");
  if (!auth.user.isAdmin) redirect("/app");

  const chain = publicChainInfo();
  const metrics = computeProductMetrics();
  const agreements = agreementsRepo.all();
  const users = usersRepo.all();
  const payments = paymentsRepo.all();
  const disputes = disputesRepo.all();
  const audit = auditRepo.recent(30);

  const openDisputes = disputes.filter((d) => d.status !== "resolved" && d.status !== "withdrawn");
  const failedPayments = payments.filter((p) => p.status === "failed");
  const pendingPayments = payments.filter((p) => p.status === "pending" || p.status === "submitted");

  // Flagged activity: things a human should look at, ranked by how much money is at stake.
  const overdueReviews = milestonesRepo
    .all()
    .filter(
      (m) =>
        m.status === "under_review" &&
        m.reviewDueAt &&
        Date.parse(m.reviewDueAt) < Date.now(),
    )
    .sort((a, b) => b.amount - a.amount);

  const escrowHeld = agreements
    .filter((a) => ["funded", "in_progress", "disputed", "paused"].includes(a.status))
    .reduce((sum, a) => {
      const released = milestonesRepo.forAgreement(a.id).reduce((x, m) => x + m.releasedAmount, 0);
      return sum + Math.max(0, a.totalAmount - released);
    }, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Shield className="size-5 text-faint" aria-hidden />
          <h1 className="font-display text-3xl">Operations</h1>
          <Badge tone="attn">Restricted</Badge>
        </div>
        <p className="mt-1 text-sm text-subtle">
          Support and dispute resolution. Every action here writes an immutable audit event.
        </p>
      </header>

      {/* ---------- Overview ---------- */}
      <section aria-label="Platform overview" className="mb-6">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-5">
          <StatTile label="Users" value={users.length} format="count" />
          <StatTile label="Agreements" value={agreements.length} format="count" />
          <StatTile
            label="Escrow held"
            value={escrowHeld}
            format="money"
            asset={metrics.asset}
            tone="locked"
          />
          <StatTile
            label="Settled"
            value={metrics.paymentVolume}
            format="money"
            asset={metrics.asset}
            tone="settle"
          />
          <StatTile
            label="Open disputes"
            value={openDisputes.length}
            format="count"
            tone={openDisputes.length > 0 ? "danger" : "neutral"}
            className="col-span-2 lg:col-span-1"
          />
        </div>
      </section>

      {/* ---------- Guarantee ---------- */}
      <Alert tone="neutral" className="mb-6" icon={<Lock className="size-4" />} title="What operations cannot do">
        The payment ledger and the audit log are append-only at the database level, and
        confirmed payments are protected by a constraint that rejects any change to their
        amount, recipient, or transaction hash. No control on this page can rewrite
        financial history — a dispute resolution creates new records, it never edits old
        ones.
      </Alert>

      {/* ---------- Flagged ---------- */}
      <section aria-labelledby="flagged-heading" className="mb-6">
        <h2 id="flagged-heading" className="mb-3 text-sm font-semibold">Needs attention</h2>

        <div className="space-y-2">
          {openDisputes.length === 0 && failedPayments.length === 0 && overdueReviews.length === 0 ? (
            <Card>
              <EmptyState title="Nothing flagged" description="No open disputes, failed payments, or overdue reviews." />
            </Card>
          ) : null}

          {openDisputes.map((dispute) => {
            const agreement = agreements.find((a) => a.id === dispute.agreementId);
            const milestone = milestonesRepo.byId(dispute.milestoneId);
            return (
              <Card key={dispute.id} className="border-danger-border p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <Scale className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Open dispute · {dispute.reason}</p>
                    <p className="mt-0.5 text-2xs text-faint">
                      {agreement?.reference} · {milestone?.title} · opened {relativeTime(dispute.openedAt)}
                    </p>
                  </div>
                  {milestone && agreement ? (
                    <span className="shrink-0 text-sm font-semibold tabular">
                      {formatMoney(milestone.amount - milestone.releasedAmount, agreement.asset)}
                    </span>
                  ) : null}
                  {agreement ? (
                    <Link
                      href={`/app/agreements/${agreement.id}/dispute/${dispute.id}`}
                      className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-raised px-3 text-xs font-medium transition-colors hover:bg-inset"
                    >
                      Review
                    </Link>
                  ) : null}
                </div>
              </Card>
            );
          })}

          {failedPayments.map((payment) => (
            <Card key={payment.id} className="border-attn-border p-4">
              <div className="flex flex-wrap items-start gap-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-attn" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Failed payment</p>
                  <p className="mt-0.5 text-2xs text-faint">
                    {payment.failureReason ?? "No reason recorded"} · {relativeTime(payment.createdAt)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular">
                  {formatMoney(payment.amount, payment.asset)}
                </span>
              </div>
            </Card>
          ))}

          {overdueReviews.slice(0, 5).map((milestone) => {
            const agreement = agreements.find((a) => a.id === milestone.agreementId);
            return (
              <Card key={milestone.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Review window elapsed</p>
                    <p className="mt-0.5 text-2xs text-faint">
                      {agreement?.reference} · {milestone.title} · due{" "}
                      {relativeTime(milestone.reviewDueAt)}
                    </p>
                  </div>
                  {agreement ? (
                    <span className="shrink-0 text-sm font-semibold tabular">
                      {formatMoney(milestone.amount, agreement.asset)}
                    </span>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------- Agreements ---------- */}
        <section aria-labelledby="agreements-heading">
          <h2 id="agreements-heading" className="mb-3 text-sm font-semibold">Recent agreements</h2>
          <Card>
            <ul className="divide-y divide-line-subtle">
              {agreements.slice(0, 10).map((a) => {
                const meta = AGREEMENT_STATUS_META[a.status];
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/app/agreements/${a.id}`}
                        className="block truncate text-xs font-medium hover:underline"
                      >
                        {a.title}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-2 text-[10px] text-faint">
                        <span className="font-mono">{a.reference}</span>
                        <span>{relativeTime(a.updatedAt)}</span>
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular">
                      {formatMoney(a.totalAmount, a.asset, { compact: true })}
                    </span>
                    <Badge tone={meta.tone} className="shrink-0">{meta.label}</Badge>
                    <ReconcileButton agreementId={a.id} />
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>

        {/* ---------- Payments ---------- */}
        <section aria-labelledby="payments-heading">
          <h2 id="payments-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold">
            Transaction status
            {pendingPayments.length > 0 ? (
              <Badge tone="attn">{pendingPayments.length} pending</Badge>
            ) : null}
          </h2>
          <Card>
            <ul className="divide-y divide-line-subtle">
              {payments.slice(0, 10).map((p) => {
                const meta = PAYMENT_STATUS_META[p.status];
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium tabular">
                        {formatMoney(p.amount, p.asset)}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 text-[10px] text-faint">
                        <span>{p.kind.replace(/_/g, " ")}</span>
                        <span>{relativeTime(p.createdAt)}</span>
                        {p.isSimulated ? <span className="text-attn">simulated</span> : null}
                      </p>
                    </div>
                    {p.txHash ? (
                      chain.hasExplorer ? (
                        <a
                          href={`${chain.explorerUrl.replace(/\/$/, "")}/tx/${p.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-accent hover:underline"
                        >
                          {shortHash(p.txHash, 3)}
                          <ExternalLink className="size-2.5" aria-hidden />
                        </a>
                      ) : (
                        <Mono value={p.txHash} display={shortHash(p.txHash, 3)} label="transaction hash" />
                      )
                    ) : null}
                    <Badge tone={meta.tone} className="shrink-0">{meta.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      </div>

      {/* ---------- Audit ---------- */}
      <section aria-labelledby="audit-heading" className="mt-6">
        <h2 id="audit-heading" className="mb-3 text-sm font-semibold">
          Audit log
          <span className="ml-2 text-2xs font-normal text-faint">Append-only</span>
        </h2>
        <Card>
          {audit.length === 0 ? (
            <p className="p-8 text-center text-sm text-faint">No audit events recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {audit.map((entry) => {
                const actor = entry.actorId ? usersRepo.byId(entry.actorId) : null;
                return (
                  <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="font-mono text-[10px] tabular text-faint">
                      {formatDateTime(entry.createdAt)}
                    </span>
                    <span className="font-mono text-2xs text-accent">{entry.action}</span>
                    <span className="text-2xs text-muted">
                      {actor?.displayName ?? "System"}
                    </span>
                    <span className="font-mono text-[10px] text-faint">
                      {entry.entityType}/{entry.entityId.slice(0, 12)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
