import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, Lock, Inbox, Activity, CheckCircle2, Banknote, Plus, Clock, AlertTriangle,
} from "lucide-react";
import { requireAuth } from "@/lib/services/auth";
import { computeDashboardSummary, buildActionQueue, type ActionItem } from "@/lib/services/analytics";
import { listForUser, computeProgress } from "@/lib/services/agreements";
import { formatMoney } from "@/lib/domain/money";
import { formatDate, timeRemaining, AGREEMENT_STATUS_META } from "@/lib/utils/format";
import { Card, Badge, EmptyState, Progress, Avatar } from "@/components/ui";
import { StatTile } from "@/components/app/stat-tile";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const auth = await requireAuth();
  const summary = computeDashboardSummary(auth.user.id);
  const actions = buildActionQueue(auth.user.id);
  const bundles = listForUser(auth.user.id);

  const active = bundles.filter((b) =>
    ["funded", "in_progress", "disputed", "paused", "awaiting_funding", "awaiting_signature"].includes(
      b.agreement.status,
    ),
  );

  const firstName = auth.user.displayName.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl">
          {actions.length > 0
            ? `${firstName}, you have ${actions.length} thing${actions.length === 1 ? "" : "s"} to do.`
            : `You are caught up, ${firstName}.`}
        </h1>
        <p className="mt-1.5 text-sm text-subtle">
          {actions.length > 0
            ? "Ordered by what is most urgent."
            : "Nothing is waiting on you right now."}
        </p>
      </header>

      {/* ---------- Overview ---------- */}
      <section aria-label="Overview" className="mb-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-5">
          <StatTile
            label="Funds in escrow"
            value={summary.fundsInEscrow}
            format="money"
            asset={summary.asset}
            icon={<Lock className="size-3.5" />}
            tone="locked"
          />
          <StatTile
            label="Awaiting your action"
            value={summary.awaitingYourAction}
            format="count"
            icon={<Inbox className="size-3.5" />}
            tone={summary.awaitingYourAction > 0 ? "attn" : "neutral"}
          />
          <StatTile
            label="In progress"
            value={summary.inProgress}
            format="count"
            icon={<Activity className="size-3.5" />}
          />
          <StatTile
            label="Completed this month"
            value={summary.completedThisMonth}
            format="count"
            icon={<CheckCircle2 className="size-3.5" />}
          />
          <StatTile
            label="Settled"
            value={summary.settledTotal}
            format="money"
            asset={summary.asset}
            icon={<Banknote className="size-3.5" />}
            tone="settle"
            className="col-span-2 lg:col-span-1"
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* ---------- Action queue ---------- */}
        <section aria-labelledby="action-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="action-heading" className="text-sm font-semibold">Action required</h2>
            {actions.length > 0 ? (
              <span className="text-2xs text-faint">{actions.length} item{actions.length === 1 ? "" : "s"}</span>
            ) : null}
          </div>

          {actions.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CheckCircle2 className="size-5" />}
                title="You are caught up."
                description="When a milestone needs review or a signature is due, it will appear here first."
              />
            </Card>
          ) : (
            <ul className="stagger space-y-2">
              {actions.slice(0, 8).map((item, i) => (
                <li key={`${item.kind}-${item.milestoneId ?? item.agreementId}`} style={{ ["--i" as string]: i }}>
                  <ActionCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- Active agreements ---------- */}
        <section aria-labelledby="active-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="active-heading" className="text-sm font-semibold">Active agreements</h2>
            <Link href="/app/agreements" className="text-2xs text-accent transition-colors hover:underline">
              View all
            </Link>
          </div>

          {active.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Plus className="size-5" />}
                title="No agreements yet"
                description="Your first agreement will appear here."
                action={
                  <Link
                    href="/app/agreements/new"
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
                  >
                    Create an Agreement
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                }
              />
            </Card>
          ) : (
            <ul className="space-y-2">
              {active.slice(0, 6).map((bundle) => {
                const progress = computeProgress(bundle);
                const isClient = bundle.agreement.clientId === auth.user.id;
                const counterparty = isClient ? bundle.provider : bundle.client;
                const meta = AGREEMENT_STATUS_META[bundle.agreement.status];

                return (
                  <li key={bundle.agreement.id}>
                    <Link href={`/app/agreements/${bundle.agreement.id}`} className="block">
                      <Card interactive className="p-4">
                        <div className="flex items-start gap-3">
                          <Avatar
                            name={counterparty?.displayName ?? "?"}
                            color={counterparty?.avatarColor}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{bundle.agreement.title}</p>
                            <p className="mt-0.5 truncate text-2xs text-faint">
                              {bundle.agreement.reference} · {counterparty?.displayName ?? "Awaiting counterparty"}
                            </p>
                          </div>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>

                        <div className="mt-3.5">
                          <Progress
                            value={progress.percentComplete}
                            tone={bundle.agreement.status === "disputed" ? "attn" : "settle"}
                          />
                          <div className="mt-2 flex items-baseline justify-between text-2xs">
                            <span className="text-subtle">
                              {formatMoney(progress.releasedAmount, bundle.agreement.asset)} released
                            </span>
                            <span className="tabular text-faint">
                              {progress.completedMilestones}/{progress.totalMilestones} milestones
                            </span>
                          </div>
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const ACTION_ICON: Record<ActionItem["kind"], React.ReactNode> = {
  review_milestone: <Inbox className="size-4" />,
  sign_agreement: <Clock className="size-4" />,
  fund_escrow: <Lock className="size-4" />,
  submit_milestone: <ArrowRight className="size-4" />,
  address_revision: <AlertTriangle className="size-4" />,
  resolve_dispute: <AlertTriangle className="size-4" />,
};

function ActionCard({ item }: { item: ActionItem }) {
  const remaining = item.dueAt ? timeRemaining(item.dueAt) : null;

  return (
    <Link href={item.href} className="block">
      <Card
        interactive
        className={
          item.urgency === "overdue"
            ? "border-danger-border p-4"
            : item.urgency === "soon"
              ? "border-attn-border p-4"
              : "p-4"
        }
      >
        <div className="flex items-start gap-3.5">
          <span
            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border ${
              item.urgency === "overdue"
                ? "border-danger-border bg-danger-soft text-danger"
                : item.urgency === "soon"
                  ? "border-attn-border bg-attn-soft text-attn"
                  : "border-line bg-inset text-subtle"
            }`}
            aria-hidden
          >
            {ACTION_ICON[item.kind]}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-sm font-medium">{item.title}</p>
              {item.amount !== null && item.amount > 0 ? (
                <span className="text-sm font-semibold tabular text-settle">
                  {formatMoney(item.amount, item.asset)}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-subtle">{item.subtitle}</p>

            {remaining ? (
              <p
                className={`mt-1.5 text-2xs ${remaining.overdue ? "font-medium text-danger" : "text-faint"}`}
              >
                {remaining.overdue ? remaining.label : `${remaining.label} · due ${formatDate(item.dueAt)}`}
              </p>
            ) : null}
          </div>

          <ArrowRight className="mt-2.5 size-4 shrink-0 text-faint" aria-hidden />
        </div>
      </Card>
    </Link>
  );
}
