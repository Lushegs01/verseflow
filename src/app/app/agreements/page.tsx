import Link from "next/link";
import type { Metadata } from "next";
import { Plus, ArrowRight, FileText } from "lucide-react";
import { requireAuth } from "@/lib/services/auth";
import { listForUser, computeProgress } from "@/lib/services/agreements";
import { formatMoney } from "@/lib/domain/money";
import { formatDate, relativeTime, AGREEMENT_STATUS_META } from "@/lib/utils/format";
import { Card, Badge, Avatar, Progress, EmptyState } from "@/components/ui";
import { AgreementFilters } from "@/components/app/agreement-filters";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agreements" };

export default async function AgreementsPage({
  searchParams,
}: { searchParams: Promise<{ filter?: string }> }) {
  const auth = await requireAuth();
  const { filter = "active" } = await searchParams;
  const bundles = await listForUser(auth.user.id);

  const buckets = {
    active: bundles.filter((b) =>
      ["funded", "in_progress", "disputed", "paused"].includes(b.agreement.status),
    ),
    pending: bundles.filter((b) =>
      ["draft", "awaiting_signature", "awaiting_funding"].includes(b.agreement.status),
    ),
    completed: bundles.filter((b) => b.agreement.status === "completed"),
    all: bundles,
  };

  const shown = buckets[filter as keyof typeof buckets] ?? buckets.active;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Agreements</h1>
          <p className="mt-1 text-sm text-subtle">
            Everything you are a party to, as client or provider.
          </p>
        </div>
        <Link
          href="/app/agreements/new"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden />
          Create agreement
        </Link>
      </header>

      <AgreementFilters
        current={filter}
        counts={{
          active: buckets.active.length,
          pending: buckets.pending.length,
          completed: buckets.completed.length,
          all: buckets.all.length,
        }}
      />

      <div className="mt-5">
        {shown.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FileText className="size-5" />}
              title={
                filter === "completed" ? "No completed agreements yet" :
                filter === "pending" ? "Nothing pending" :
                "No agreements yet"
              }
              description={
                filter === "completed"
                  ? "Completed agreements build your verifiable work history."
                  : filter === "pending"
                    ? "Drafts and agreements awaiting signature or funding appear here."
                    : "Your first agreement will appear here."
              }
              action={
                filter !== "completed" ? (
                  <Link
                    href="/app/agreements/new"
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
                  >
                    Create an Agreement
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <ul className="stagger space-y-2.5">
            {shown.map((bundle, i) => {
              const { agreement } = bundle;
              const progress = computeProgress(bundle);
              const isClient = agreement.clientId === auth.user.id;
              const counterparty = isClient ? bundle.provider : bundle.client;
              const meta = AGREEMENT_STATUS_META[agreement.status];

              return (
                <li key={agreement.id} style={{ ["--i" as string]: i }}>
                  <Link href={`/app/agreements/${agreement.id}`} className="block">
                    <Card interactive className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-start gap-3">
                        <Avatar
                          name={counterparty?.displayName ?? "?"}
                          color={counterparty?.avatarColor}
                          size="md"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-base font-medium">{agreement.title}</h2>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                            {agreement.isSimulated ? (
                              <Badge tone="outline">Simulated</Badge>
                            ) : null}
                          </div>

                          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-2xs text-faint">
                            <span className="font-mono">{agreement.reference}</span>
                            <span aria-hidden>·</span>
                            <span>{isClient ? "You are the client" : "You are the provider"}</span>
                            <span aria-hidden>·</span>
                            <span>{counterparty?.displayName ?? "Awaiting counterparty"}</span>
                            <span aria-hidden>·</span>
                            <span>Updated {relativeTime(agreement.updatedAt)}</span>
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-lg font-semibold tabular">
                            {formatMoney(agreement.totalAmount, agreement.asset)}
                          </p>
                          {agreement.expectedCompletionAt ? (
                            <p className="text-2xs text-faint">
                              Due {formatDate(agreement.expectedCompletionAt)}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {progress.totalMilestones > 0 ? (
                        <div className="mt-4">
                          <Progress
                            value={progress.percentComplete}
                            tone={agreement.status === "disputed" ? "attn" : "settle"}
                          />
                          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-2xs">
                            <span className="text-subtle">
                              {formatMoney(progress.releasedAmount, agreement.asset)} released ·{" "}
                              {formatMoney(progress.lockedAmount, agreement.asset)} locked
                            </span>
                            <span className="tabular text-faint">
                              {progress.completedMilestones}/{progress.totalMilestones} milestones
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
