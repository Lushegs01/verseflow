import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowRight, Lock, Shield, ExternalLink, ScrollText, AlertTriangle, Scale,
} from "lucide-react";
import { requireAuth, roleOn, getAuth } from "@/lib/services/auth";
import { loadBundle, computeProgress } from "@/lib/services/agreements";
import { activityRepo, disputesRepo, paymentsRepo, analysisRepo } from "@/lib/db/repositories";
import { formatMoney } from "@/lib/domain/money";
import { shortHash, shortAddress } from "@/lib/domain/hashing";
import { publicChainInfo } from "@/lib/chain/config";
import { formatDate, AGREEMENT_STATUS_META, MILESTONE_STATUS_META } from "@/lib/utils/format";
import { Card, Badge, Avatar, Progress, Mono, Alert } from "@/components/ui";
import { PaymentTimeline, MilestoneCard, VerificationPanel } from "@/components/app/milestone-parts";
import { ActivityTimeline } from "@/components/app/activity-timeline";
import { SignAgreementPanel } from "@/components/app/sign-panel";

export const dynamic = "force-dynamic";

/**
 * Metadata runs outside the page's authorization check, so it has to repeat it.
 * Without this, the document title would disclose a private agreement's reference
 * and title to someone who is not a party to it -- the page body is guarded, but
 * the tab title would not be.
 */
export async function generateMetadata({
  params,
}: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return { title: "Agreement", robots: { index: false } };

  const bundle = await loadBundle(id);
  const visible = bundle && (roleOn(bundle.agreement, auth.user.id) !== null || auth.user.isAdmin);

  return {
    title: visible ? `${bundle.agreement.reference} · ${bundle.agreement.title}` : "Agreement",
    // Agreements are private and must never appear in a search index.
    robots: { index: false, follow: false },
  };
}

export default async function AgreementPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  const bundle = await loadBundle(id);

  // Not being a party is indistinguishable from the agreement not existing, so
  // the existence of private agreements is never leaked.
  if (!bundle) notFound();
  const role = roleOn(bundle.agreement, auth.user.id);
  if (!role && !auth.user.isAdmin) notFound();

  const { agreement, milestones, client, provider } = bundle;
  const progress = computeProgress(bundle);
  const chain = publicChainInfo();
  const statusMeta = AGREEMENT_STATUS_META[agreement.status];
  const activity = await activityRepo.forAgreement(agreement.id);
  const disputes = await disputesRepo.forAgreement(agreement.id);
  const payments = await paymentsRepo.forAgreement(agreement.id);
  const isClient = role === "client";

  const current = progress.currentMilestone;
  const currentAnalysis = current ? await analysisRepo.latestForMilestone(current.id) : null;
  const openDispute = disputes.find((d) => d.status !== "resolved" && d.status !== "withdrawn");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* ---------- Header ---------- */}
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-2xs text-faint">
          <Link href="/app/agreements" className="transition-colors hover:text-fg">Agreements</Link>
          <span aria-hidden>/</span>
          <span className="font-mono">{agreement.reference}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl leading-tight">{agreement.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
              <span className="text-sm text-subtle">
                <strong className="font-semibold text-fg">
                  {formatMoney(agreement.totalAmount, agreement.asset)}
                </strong>{" "}
                {agreement.status === "in_progress" || agreement.status === "funded" ? "secured" : "contract value"}
              </span>
              <span className="text-sm text-subtle">
                {progress.completedMilestones} / {progress.totalMilestones} milestones complete
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isClient && agreement.status === "awaiting_funding" ? (
              <Link
                href={`/app/agreements/${agreement.id}/fund`}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
              >
                <Lock className="size-4" aria-hidden />
                Fund agreement
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {openDispute ? (
        <Alert
          tone="danger"
          title="This milestone is paused while the dispute is reviewed"
          className="mb-5"
          icon={<Scale className="size-4" />}
          action={
            <Link
              href={`/app/agreements/${agreement.id}/dispute/${openDispute.id}`}
              className="inline-flex h-8 items-center rounded-md border border-danger-border bg-raised px-3 text-xs font-medium transition-colors hover:bg-inset"
            >
              Open dispute
            </Link>
          }
        >
          {openDispute.reason}. No funds can be released for this milestone until it is resolved.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ================= Main column ================= */}
        <div className="min-w-0 space-y-6">
          {/* --- Signature stage --- */}
          {agreement.status === "draft" || agreement.status === "awaiting_signature" ? (
            <SignAgreementPanel
              agreementId={agreement.id}
              reference={agreement.reference}
              title={agreement.title}
              status={agreement.status}
              totalAmount={agreement.totalAmount}
              asset={agreement.asset}
              milestones={milestones.map((m) => ({
                id: m.id, title: m.title, amount: m.amount, dueAt: m.dueAt,
              }))}
              rules={agreement.rules}
              role={role ?? "client"}
              clientName={client?.displayName ?? "Client"}
              providerName={provider?.displayName ?? "Provider"}
              clientAddress={bundle.clientAddress}
              providerAddress={bundle.providerAddress}
              clientSigned={Boolean(agreement.clientSignature)}
              providerSigned={Boolean(agreement.providerSignature)}
              expectedCompletionAt={agreement.expectedCompletionAt}
            />
          ) : null}

          {/* --- Awaiting funding --- */}
          {agreement.status === "awaiting_funding" ? (
            <Card>
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-locked-border bg-locked-soft text-locked">
                    <Lock className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">
                      {isClient ? "Fund escrow to start work" : "Waiting for the client to fund escrow"}
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Both parties have signed and the terms are locked. Work begins once{" "}
                      {formatMoney(agreement.totalAmount, agreement.asset)} is secured in escrow.
                    </p>
                    {isClient ? (
                      <Link
                        href={`/app/agreements/${agreement.id}/fund`}
                        className="mt-3.5 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
                      >
                        Fund agreement
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {/* --- Current milestone spotlight --- */}
          {current && ["funded", "in_progress", "disputed"].includes(agreement.status) ? (
            <section aria-labelledby="current-heading">
              <h2 id="current-heading" className="mb-3 text-sm font-semibold">Current milestone</h2>
              <MilestoneCard
                milestone={current}
                asset={agreement.asset}
                revisionsAllowed={agreement.rules.revisionRounds}
                defaultOpen
                action={
                  <MilestoneActions
                    agreementId={agreement.id}
                    milestone={current}
                    isClient={isClient}
                    asset={agreement.asset}
                  />
                }
              />

              {currentAnalysis && (current.status === "under_review" || current.status === "submitted") ? (
                <div className="mt-4">
                  <VerificationPanel analysis={currentAnalysis} />
                </div>
              ) : null}
            </section>
          ) : null}

          {/* --- All milestones --- */}
          <section aria-labelledby="milestones-heading">
            <h2 id="milestones-heading" className="mb-3 text-sm font-semibold">
              All milestones
            </h2>
            <div className="space-y-3">
              {milestones.map((m) => {

                if (current && m.id === current.id) return null;
                return (
                  <MilestoneCard
                    key={m.id}
                    milestone={m}
                    asset={agreement.asset}
                    revisionsAllowed={agreement.rules.revisionRounds}
                    action={
                      <MilestoneActions
                        agreementId={agreement.id}
                        milestone={m}
                        isClient={isClient}
                        asset={agreement.asset}
                      />
                    }
                  />
                );
              })}
            </div>
          </section>

          {/* --- Activity --- */}
          <section aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="mb-3 text-sm font-semibold">Agreement activity</h2>
            <Card className="p-4 sm:p-5">
              <ActivityTimeline
                events={activity}
                explorerUrl={chain.hasExplorer ? chain.explorerUrl : null}
                limit={12}
              />
            </Card>
          </section>
        </div>

        {/* ================= Sidebar ================= */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* --- Payment timeline --- */}
          <Card>
            <div className="border-b border-line-subtle px-4 py-3">
              <h2 className="text-xs font-semibold">Payment timeline</h2>
            </div>
            <div className="p-2">
              <PaymentTimeline
                milestones={milestones}
                asset={agreement.asset}
                activeId={current?.id}
              />
            </div>
            <div className="border-t border-line-subtle px-4 py-3">
              <Progress
                value={progress.percentComplete}
                tone="settle"
                label="Settled"
                showValue
              />
              <div className="mt-3 flex items-baseline justify-between text-2xs">
                <span className="text-subtle">Still locked</span>
                <span className="font-semibold tabular text-locked">
                  {formatMoney(progress.lockedAmount, agreement.asset)}
                </span>
              </div>
            </div>
          </Card>

          {/* --- Parties --- */}
          <Card>
            <div className="border-b border-line-subtle px-4 py-3">
              <h2 className="text-xs font-semibold">Parties</h2>
            </div>
            <div className="divide-y divide-line-subtle">
              <PartyRow
                label="Client"
                name={client?.displayName ?? "Unknown"}
                handle={client?.handle}
                color={client?.avatarColor}
                address={bundle.clientAddress}
                signed={Boolean(agreement.clientSignature)}
                isYou={role === "client"}
              />
              <PartyRow
                label="Provider"
                name={provider?.displayName ?? "Awaiting provider"}
                handle={provider?.handle}
                color={provider?.avatarColor}
                address={bundle.providerAddress}
                signed={Boolean(agreement.providerSignature)}
                isYou={role === "provider"}
              />
            </div>
          </Card>

          {/* --- Agreement rules --- */}
          <Card>
            <div className="border-b border-line-subtle px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold">
                <ScrollText className="size-3.5 text-faint" aria-hidden />
                Agreement rules
              </h2>
            </div>
            <ul className="space-y-2 p-4 text-xs">
              <RuleRow label="Revision rounds" value={`${agreement.rules.revisionRounds} per milestone`} />
              <RuleRow label="Approval window" value={`${agreement.rules.approvalWindowHours} hours`} />
              <RuleRow label="Dispute window" value={`${agreement.rules.disputeWindowHours} hours`} />
              <RuleRow label="Evidence" value={agreement.rules.evidenceRequired ? "Required per milestone" : "Optional"} />
              <RuleRow label="Partial release" value={agreement.rules.partialReleaseAllowed ? "Allowed" : "Not allowed"} />
              {agreement.expectedCompletionAt ? (
                <RuleRow label="Expected completion" value={formatDate(agreement.expectedCompletionAt, { withYear: true })} />
              ) : null}
            </ul>
            {agreement.rules.additionalTerms.length > 0 ? (
              <div className="border-t border-line-subtle p-4">
                <p className="text-2xs font-medium uppercase tracking-wider text-faint">Additional terms</p>
                <ul className="mt-2 space-y-1.5">
                  {agreement.rules.additionalTerms.map((term, i) => (
                    <li key={i} className="text-xs leading-relaxed text-muted">{term}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {/* --- Settlement detail --- */}
          <Card>
            <div className="border-b border-line-subtle px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold">
                <Shield className="size-3.5 text-faint" aria-hidden />
                Settlement
              </h2>
            </div>
            <div className="space-y-2.5 p-4">
              <TechRow label="Network">
                <span className={agreement.isSimulated ? "text-attn" : "text-settle"}>
                  {agreement.isSimulated ? "Local simulation" : chain.name}
                </span>
              </TechRow>

              {agreement.agreementHash ? (
                <TechRow label="Terms hash">
                  <Mono
                    value={agreement.agreementHash}
                    display={shortHash(agreement.agreementHash, 5)}
                    label="terms hash"
                  />
                </TechRow>
              ) : null}

              {agreement.escrowAddress ? (
                <TechRow label="Escrow">
                  {chain.hasExplorer ? (
                    <a
                      href={`${chain.explorerUrl.replace(/\/$/, "")}/address/${agreement.escrowAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-2xs text-accent hover:underline"
                    >
                      {shortAddress(agreement.escrowAddress, 4)}
                      <ExternalLink className="size-2.5" aria-hidden />
                    </a>
                  ) : (
                    <Mono
                      value={agreement.escrowAddress}
                      display={shortAddress(agreement.escrowAddress, 4)}
                      label="escrow address"
                    />
                  )}
                </TechRow>
              ) : null}

              {agreement.fundingTxHash ? (
                <TechRow label="Funding tx">
                  {chain.hasExplorer ? (
                    <a
                      href={`${chain.explorerUrl.replace(/\/$/, "")}/tx/${agreement.fundingTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-2xs text-accent hover:underline"
                    >
                      {shortHash(agreement.fundingTxHash, 4)}
                      <ExternalLink className="size-2.5" aria-hidden />
                    </a>
                  ) : (
                    <Mono
                      value={agreement.fundingTxHash}
                      display={shortHash(agreement.fundingTxHash, 4)}
                      label="funding transaction"
                    />
                  )}
                </TechRow>
              ) : null}

              <TechRow label="Payments">
                <span className="tabular">
                  {payments.filter((p) => p.status === "confirmed").length} settled
                </span>
              </TechRow>
            </div>

            {agreement.isSimulated ? (
              <div className="border-t border-line-subtle bg-attn-soft px-4 py-2.5">
                <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
                  <AlertTriangle className="mt-px size-3 shrink-0 text-attn" aria-hidden />
                  Settled on the local simulation. These hashes are not live network
                  transactions and have no explorer entry.
                </p>
              </div>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MilestoneActions({
  agreementId, milestone, isClient, asset,
}: {
  agreementId: string;
  milestone: { id: string; status: string; amount: number; releasedAmount: number };
  isClient: boolean;
  asset: string;
}) {
  const remaining = milestone.amount - milestone.releasedAmount;

  if (isClient && (milestone.status === "under_review" || milestone.status === "submitted")) {
    return (
      <Link
        href={`/app/agreements/${agreementId}/review/${milestone.id}`}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 sm:w-auto"
      >
        Review milestone · {formatMoney(remaining, asset)}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    );
  }

  if (!isClient && (milestone.status === "in_progress" || milestone.status === "revision_requested")) {
    return (
      <Link
        href={`/app/agreements/${agreementId}/submit/${milestone.id}`}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 sm:w-auto"
      >
        {milestone.status === "revision_requested" ? "Submit revision" : "Submit milestone"}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    );
  }

  if (milestone.status === "locked") {
    return (
      <p className="text-xs text-faint">
        Starts automatically once the previous milestone settles.
      </p>
    );
  }

  return (
    <p className="text-xs text-faint">
      {MILESTONE_STATUS_META[milestone.status as keyof typeof MILESTONE_STATUS_META]?.description ?? ""}
    </p>
  );
}

function PartyRow({
  label, name, handle, color, address, signed, isYou,
}: {
  label: string;
  name: string;
  handle?: string;
  color?: string;
  address: string | null;
  signed: boolean;
  isYou: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <Avatar name={name} color={color} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-2xs text-faint">{label}</p>
          {isYou ? <span className="text-[10px] text-accent">(you)</span> : null}
        </div>
        {handle ? (
          <Link href={`/p/${handle}`} className="block truncate text-sm font-medium hover:underline">
            {name}
          </Link>
        ) : (
          <p className="truncate text-sm font-medium">{name}</p>
        )}
        {address ? (
          <Mono value={address} display={shortAddress(address, 4)} label="wallet address" className="mt-0.5" />
        ) : null}
      </div>
      <Badge tone={signed ? "settle" : "neutral"} className="mt-0.5 shrink-0">
        {signed ? "Signed" : "Not signed"}
      </Badge>
    </div>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-subtle">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </li>
  );
}

function TechRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-2xs text-faint">{label}</span>
      <span className="min-w-0 text-right text-2xs">{children}</span>
    </div>
  );
}
