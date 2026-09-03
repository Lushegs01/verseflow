"use client";

/**
 * Client review.
 *
 * Four actions, one of which moves money. The primary action is visually dominant
 * because it is usually the right one -- but the alternatives are full-weight
 * buttons, not buried links, and nothing here uses urgency or guilt to push a
 * release. A client who wants to request changes should find that just as easy.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  Check, RotateCcw, SplitSquareHorizontal, Scale, Loader2, ExternalLink,
  AlertCircle, ArrowRight, Info,
} from "lucide-react";
import {
  Card, Button, Badge, Alert, Modal, Field, Textarea, Input, Mono, useToast, Progress,
} from "@/components/ui";
import { formatMoney, parseMoney, percentOf } from "@/lib/domain/money";
import { shortHash } from "@/lib/domain/hashing";
import { formatDate, MILESTONE_STATUS_META, timeRemaining } from "@/lib/utils/format";
import { EvidenceCard, VerificationPanel } from "./milestone-parts";
import { api, pollUntil, makeIdempotencyKey, trackEvent } from "@/lib/utils/api-client";
import type {
  Milestone, Evidence, EvidenceAnalysis, AgreementRules, RevisionRequest,
} from "@/lib/domain/types";

type Action = null | "approve" | "partial" | "revision" | "dispute";
type TxStage = "idle" | "submitting" | "confirming" | "done" | "failed";

export function ReviewPanel({
  agreementId, milestone, evidence, analysis, revisions, asset, remaining,
  rules, providerName, chain,
}: {
  agreementId: string;
  milestone: Milestone;
  evidence: Evidence[];
  analysis: EvidenceAnalysis | null;
  revisions: RevisionRequest[];
  asset: string;
  remaining: number;
  rules: AgreementRules;
  providerName: string;
  chain: { mode: "simulated" | "live"; name: string; explorerUrl: string; hasExplorer: boolean };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const reduced = useReducedMotion();

  const [action, setAction] = React.useState<Action>(null);
  const [stage, setStage] = React.useState<TxStage>("idle");
  const [txHash, setTxHash] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const idempotencyKey = React.useRef(makeIdempotencyKey("release"));
  const revisionsLeft = rules.revisionRounds - milestone.revisionCount;
  const alreadyDecided = ["approved", "released", "cancelled"].includes(milestone.status);
  const reviewWindow = milestone.reviewDueAt ? timeRemaining(milestone.reviewDueAt) : null;

  // ------------------------------------------------------------- Release

  const release = async (amount: number, reason: string | null) => {
    setError(null);
    setStage("submitting");
    setAction(null);

    const isFull = amount >= remaining;
    const endpoint = isFull
      ? `/api/agreements/${agreementId}/milestones/${milestone.id}/approve`
      : `/api/agreements/${agreementId}/milestones/${milestone.id}/partial`;

    const body = isFull
      ? { idempotencyKey: idempotencyKey.current, note: reason ?? "" }
      : { idempotencyKey: idempotencyKey.current, amount, reason: reason ?? "" };

    const result = await api.post<{ payment: { id: string; txHash: string | null } }>(endpoint, body);

    if (!result.ok) {
      setError(result.error.hint ? `${result.error.message} ${result.error.hint}` : result.error.message);
      setStage("failed");
      return;
    }

    const paymentId = result.data.payment.id;
    setTxHash(result.data.payment.txHash);
    setStage("confirming");

    // The payment is not settled until the settlement layer confirms it.
    const confirmed = await pollUntil(
      () => api.post<{ status: string; reason: string | null }>(`/api/payments/${paymentId}/confirm`),
      (data) => data.status === "confirmed" || data.status === "failed",
      { intervalMs: 900, maxAttempts: 45 },
    );

    if (!confirmed.ok) {
      setError(confirmed.error.hint ? `${confirmed.error.message} ${confirmed.error.hint}` : confirmed.error.message);
      setStage("failed");
      return;
    }

    if (confirmed.data.status === "failed") {
      setError(
        confirmed.data.reason ??
          "The transaction was not completed. The funds remain in escrow.",
      );
      setStage("failed");
      return;
    }

    setStage("done");
    trackEvent(isFull ? "milestone_approved" : "partial_payment_executed", { amount, asset }, agreementId);
    toast({
      tone: "settle",
      title: "Payment released",
      body: `${formatMoney(amount, asset)} was released to ${providerName}.`,
    });
    setTimeout(() => {
      router.push(`/app/agreements/${agreementId}`);
      router.refresh();
    }, 1600);
  };

  // ------------------------------------------------------------- Success

  if (stage === "done") {
    return (
      <Card className="mt-6 overflow-hidden">
        <div className="bg-settle-soft px-5 py-10 text-center">
          <motion.span
            className="mx-auto flex size-14 items-center justify-center rounded-full bg-settle text-white"
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <Check className="size-7" aria-hidden />
          </motion.span>
          <h1 className="mt-4 font-display text-2xl">Payment released</h1>
          <p className="mt-1.5 text-sm text-muted">
            {providerName} has been paid for {milestone.title}.
          </p>
          {txHash ? (
            <div className="mt-4 inline-flex items-center gap-1.5">
              {chain.hasExplorer ? (
                <a
                  href={`${chain.explorerUrl.replace(/\/$/, "")}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-2xs text-accent hover:underline"
                >
                  {shortHash(txHash, 6)}
                  <ExternalLink className="size-2.5" aria-hidden />
                </a>
              ) : (
                <Mono value={txHash} display={shortHash(txHash, 6)} label="transaction hash" />
              )}
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  const working = stage === "submitting" || stage === "confirming";

  return (
    <div className="mt-4 space-y-5">
      {/* ---------- Header ---------- */}
      <header>
        <h1 className="text-gradient font-display text-3xl leading-tight">Milestone ready for review</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-lg font-semibold tabular text-settle">
            {formatMoney(remaining, asset)}
          </span>
          <span className="text-sm text-subtle">available for approval</span>
          <Badge tone={MILESTONE_STATUS_META[milestone.status].tone}>
            {MILESTONE_STATUS_META[milestone.status].label}
          </Badge>
          {reviewWindow ? (
            <span className={`text-xs ${reviewWindow.overdue ? "text-danger" : "text-attn"}`}>
              Review window: {reviewWindow.label}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-subtle">
          {milestone.title}
          {milestone.dueAt ? ` · due ${formatDate(milestone.dueAt)}` : ""}
        </p>
      </header>

      {milestone.releasedAmount > 0 ? (
        <Alert tone="locked" title="Part of this milestone is already released">
          {formatMoney(milestone.releasedAmount, asset)} of{" "}
          {formatMoney(milestone.amount, asset)} has been paid.{" "}
          {formatMoney(remaining, asset)} remains locked.
        </Alert>
      ) : null}

      {/* ---------- Requirements ---------- */}
      <Card>
        <div className="border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold">Requirements</h2>
        </div>
        <div className="p-5">
          {milestone.deliverables.length > 0 ? (
            <ul className="space-y-2">
              {milestone.deliverables.map((d, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-settle" aria-hidden />
                  <span className="text-muted">{d}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-faint">No deliverables were listed for this milestone.</p>
          )}
        </div>
      </Card>

      {/* ---------- Evidence ---------- */}
      <section aria-labelledby="evidence-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="evidence-heading" className="text-sm font-semibold">Evidence</h2>
          <span className="text-2xs text-faint">
            {evidence.length} item{evidence.length === 1 ? "" : "s"} · hashed and timestamped
          </span>
        </div>
        {evidence.length === 0 ? (
          <Card>
            <p className="p-5 text-sm text-faint">No evidence was submitted.</p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {evidence.map((item) => (
              <EvidenceCard key={item.id} evidence={item} />
            ))}
          </div>
        )}
      </section>

      {/* ---------- AI review ---------- */}
      {analysis ? <VerificationPanel analysis={analysis} /> : null}

      {/* ---------- Prior revisions ---------- */}
      {revisions.length > 0 ? (
        <Card>
          <div className="border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-sm font-semibold">
              Revision history · {milestone.revisionCount} of {rules.revisionRounds} used
            </h2>
          </div>
          <ul className="divide-y divide-line-subtle">
            {revisions.map((r) => (
              <li key={r.id} className="p-5">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xs text-faint">Round {r.round}</span>
                  <span className="text-2xs text-faint">{formatDate(r.createdAt)}</span>
                  {r.resolvedAt ? <Badge tone="settle">Addressed</Badge> : <Badge tone="attn">Open</Badge>}
                </div>
                <p className="mt-1.5 text-sm">{r.issue}</p>
                <p className="mt-1 text-xs text-subtle">Requested: {r.requestedAction}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ---------- Transaction state ---------- */}
      {working ? (
        <Alert tone="accent" icon={<Loader2 className="size-4 animate-spin" />} title={
          stage === "submitting" ? "Releasing payment…" : `Confirming on ${chain.mode === "live" ? chain.name : "the simulated network"}`
        }>
          <span role="status" aria-live="polite">
            {stage === "submitting"
              ? "Authorizing the release."
              : "Waiting for the network to confirm. Do not close this page."}
          </span>
          {txHash ? (
            <span className="mt-2 block">
              <Mono value={txHash} display={shortHash(txHash, 6)} label="transaction hash" />
            </span>
          ) : null}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="The payment was not completed" icon={<AlertCircle className="size-4" />}>
          {error}
        </Alert>
      ) : null}

      {/* ---------- Actions ---------- */}
      {alreadyDecided ? (
        <Alert tone="settle" title="This milestone has already been decided">
          No further action is needed here.
        </Alert>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-sm font-semibold">Your decision</h2>
            <p className="mt-0.5 text-2xs text-subtle">
              The agreement rules determine what can happen next. Nothing moves without you.
            </p>
          </div>

          <div className="p-4 sm:p-5">
            {/* Primary action: visually dominant, but not the only obvious option. */}
            <Button
              variant="settle"
              size="lg"
              fullWidth
              icon={<Check className="size-4" />}
              disabled={working}
              onClick={() => setAction("approve")}
            >
              Approve &amp; release {formatMoney(remaining, asset)}
            </Button>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Button
                variant="secondary"
                icon={<RotateCcw className="size-3.5" />}
                disabled={working || revisionsLeft <= 0}
                onClick={() => setAction("revision")}
                title={revisionsLeft <= 0 ? "All revision rounds have been used" : undefined}
              >
                Request revision
              </Button>

              <Button
                variant="secondary"
                icon={<SplitSquareHorizontal className="size-3.5" />}
                disabled={working || !rules.partialReleaseAllowed}
                onClick={() => setAction("partial")}
                title={!rules.partialReleaseAllowed ? "Partial release is not permitted by this agreement" : undefined}
              >
                Release partial
              </Button>

              <Button
                variant="secondary"
                icon={<Scale className="size-3.5" />}
                disabled={working}
                onClick={() => setAction("dispute")}
              >
                Open dispute
              </Button>
            </div>

            <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-faint">
              <span>
                {revisionsLeft > 0
                  ? `${revisionsLeft} of ${rules.revisionRounds} revision rounds remaining`
                  : "All revision rounds have been used"}
              </span>
              {!rules.partialReleaseAllowed ? <span>Partial release is disabled for this agreement</span> : null}
            </div>
          </div>
        </Card>
      )}

      {/* ---------- Modals ---------- */}
      <ApproveModal
        open={action === "approve"}
        onClose={() => setAction(null)}
        amount={remaining}
        asset={asset}
        providerName={providerName}
        milestoneTitle={milestone.title}
        analysis={analysis}
        onConfirm={(note) => release(remaining, note || null)}
      />

      <PartialModal
        open={action === "partial"}
        onClose={() => setAction(null)}
        remaining={remaining}
        asset={asset}
        providerName={providerName}
        onConfirm={(amount, reason) => release(amount, reason)}
      />

      <RevisionModal
        open={action === "revision"}
        onClose={() => setAction(null)}
        agreementId={agreementId}
        milestoneId={milestone.id}
        criteria={milestone.acceptanceCriteria}
        used={milestone.revisionCount}
        allowed={rules.revisionRounds}
      />

      <DisputeModal
        open={action === "dispute"}
        onClose={() => setAction(null)}
        agreementId={agreementId}
        milestoneId={milestone.id}
        amount={remaining}
        asset={asset}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

function ApproveModal({
  open, onClose, amount, asset, providerName, milestoneTitle, analysis, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  amount: number;
  asset: string;
  providerName: string;
  milestoneTitle: string;
  analysis: EvidenceAnalysis | null;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = React.useState("");
  const unverified = analysis?.findings.filter((f) => f.assessment === "unverified").length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Approve and release payment"
      description="This releases funds from escrow to the provider."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="settle" icon={<Check className="size-4" />} onClick={() => onConfirm(note)}>
            Release {formatMoney(amount, asset)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-settle-border bg-settle-soft p-4 text-center">
          <p className="text-2xs text-muted">Releasing to {providerName}</p>
          <p className="mt-1 text-3xl font-semibold tabular">{formatMoney(amount, asset)}</p>
          <p className="mt-1 text-2xs text-muted">for {milestoneTitle}</p>
        </div>

        {/* If the analysis could not verify something, say so here rather than
            letting an approval sail past it. */}
        {unverified > 0 ? (
          <Alert tone="attn" title={`${unverified} criterion${unverified === 1 ? "" : "s"} could not be verified`}>
            The evidence did not cover everything the agreement asks for. Approving
            releases the payment regardless — that is your call to make.
          </Alert>
        ) : null}

        <Field label="Note for the record" htmlFor="approve-note" hint="Optional. Stored in the agreement history.">
          <Textarea
            id="approve-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Everything checks out. Nice work on the mobile layouts."
            rows={3}
            maxLength={2000}
          />
        </Field>

        <p className="text-2xs leading-relaxed text-faint">
          Payment settles on the network. Once confirmed it cannot be reversed from
          within VerseFlow.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Partial release
// ---------------------------------------------------------------------------

function PartialModal({
  open, onClose, remaining, asset, providerName, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  remaining: number;
  asset: string;
  providerName: string;
  onConfirm: (amount: number, reason: string) => void;
}) {
  const [percent, setPercent] = React.useState(60);
  const [custom, setCustom] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const amount = React.useMemo(() => {
    if (custom.trim()) {
      try {
        return Math.min(parseMoney(custom, asset), remaining);
      } catch {
        return 0;
      }
    }
    return percentOf(remaining, percent);
  }, [custom, percent, remaining, asset]);

  const withheld = remaining - amount;
  const reasonError = touched && reason.trim().length < 10
    ? "Explain why you are releasing a partial amount."
    : null;
  const amountError = touched && amount <= 0 ? "Enter an amount greater than zero." : null;

  React.useEffect(() => {
    if (open) { setPercent(60); setCustom(""); setReason(""); setTouched(false); }
  }, [open]);

  const submit = () => {
    setTouched(true);
    if (amount <= 0 || reason.trim().length < 10) return;
    onConfirm(amount, reason.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Release a partial payment"
      description="Release part of the milestone now and keep the rest locked."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Release {formatMoney(amount, asset)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* The resulting split is shown before anything executes. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <div className="bg-settle-soft p-4 text-center">
            <p className="text-2xs text-muted">Released to {providerName}</p>
            <p className="mt-1 text-xl font-semibold tabular text-settle">
              {formatMoney(amount, asset)}
            </p>
          </div>
          <div className="bg-locked-soft p-4 text-center">
            <p className="text-2xs text-muted">Remains locked</p>
            <p className="mt-1 text-xl font-semibold tabular text-locked">
              {formatMoney(withheld, asset)}
            </p>
          </div>
        </div>

        <Progress value={remaining > 0 ? Math.round((amount / remaining) * 100) : 0} tone="settle" />

        <div>
          <p className="mb-2 text-xs font-medium text-muted">Quick amounts</p>
          <div className="flex flex-wrap gap-2">
            {[25, 50, 60, 75, 90].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { setPercent(p); setCustom(""); }}
                className={`h-8 rounded-md border px-3 text-xs font-medium transition-colors ${
                  !custom && percent === p
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line hover:border-line-strong"
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        <Field
          label="Or enter an exact amount"
          htmlFor="partial-amount"
          error={amountError}
          hint={`Maximum ${formatMoney(remaining, asset)}`}
        >
          <Input
            id="partial-amount"
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={(remaining / 100).toFixed(2)}
          />
        </Field>

        <Field
          label="Reason"
          htmlFor="partial-reason"
          required
          error={reasonError}
          hint="Shared with the provider and stored in the agreement history."
          aside={`${reason.length}/2000`}
        >
          <Textarea
            id="partial-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Mobile navigation overlaps the logo at 390px. Releasing for the rest of the delivered scope."
            rows={3}
            maxLength={2000}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Revision
// ---------------------------------------------------------------------------

function RevisionModal({
  open, onClose, agreementId, milestoneId, criteria, used, allowed,
}: {
  open: boolean;
  onClose: () => void;
  agreementId: string;
  milestoneId: string;
  criteria: Array<{ id: string; text: string }>;
  used: number;
  allowed: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [issue, setIssue] = React.useState("");
  const [requestedAction, setRequestedAction] = React.useState("");
  const [unmet, setUnmet] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (open) { setIssue(""); setRequestedAction(""); setUnmet([]); setTouched(false); }
  }, [open]);

  const issueError = touched && issue.trim().length < 10
    ? "Describe the issue specifically enough to be acted on."
    : null;
  const actionError = touched && requestedAction.trim().length < 5
    ? "State what needs to change."
    : null;

  const submit = async () => {
    setTouched(true);
    if (issue.trim().length < 10 || requestedAction.trim().length < 5) return;

    setSubmitting(true);
    const result = await api.post(
      `/api/agreements/${agreementId}/milestones/${milestoneId}/revision`,
      { issue: issue.trim(), requestedAction: requestedAction.trim(), unmetCriterionIds: unmet },
    );

    if (result.ok) {
      trackEvent("revision_requested", {}, agreementId);
      toast({ tone: "settle", title: "Revision requested", body: "The provider has been notified." });
      onClose();
      router.push(`/app/agreements/${agreementId}`);
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not request revision", body: result.error.message });
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a revision"
      description={`Round ${used + 1} of ${allowed}. The milestone returns to the provider.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={submitting} onClick={submit}>
            Request revision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="neutral" icon={<Info className="size-4" />}>
          A specific, actionable request gets resolved faster than a general one. Both are
          recorded, so vagueness here becomes ambiguity later.
        </Alert>

        <Field
          label="What is the issue?"
          htmlFor="revision-issue"
          required
          error={issueError}
          aside={`${issue.length}/2000`}
        >
          <Textarea
            id="revision-issue"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Mobile navigation overlaps the logo at 390px width on the product page."
            rows={3}
            maxLength={2000}
          />
        </Field>

        <Field
          label="What needs to change?"
          htmlFor="revision-action"
          required
          error={actionError}
        >
          <Textarea
            id="revision-action"
            value={requestedAction}
            onChange={(e) => setRequestedAction(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Fix the header layout so the logo and navigation do not overlap below 420px."
            rows={2}
            maxLength={2000}
          />
        </Field>

        {criteria.length > 0 ? (
          <fieldset>
            <legend className="text-xs font-medium text-muted">
              Which criteria are unmet? <span className="text-faint">(optional)</span>
            </legend>
            <div className="mt-2 space-y-1.5">
              {criteria.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5 transition-colors hover:border-line-strong has-[:checked]:border-attn-border has-[:checked]:bg-attn-soft"
                >
                  <input
                    type="checkbox"
                    checked={unmet.includes(c.id)}
                    onChange={(e) =>
                      setUnmet((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id),
                      )
                    }
                    className="mt-0.5 size-3.5 shrink-0 accent-[var(--attn)]"
                  />
                  <span className="text-xs leading-relaxed">{c.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Dispute
// ---------------------------------------------------------------------------

function DisputeModal({
  open, onClose, agreementId, milestoneId, amount, asset,
}: {
  open: boolean;
  onClose: () => void;
  agreementId: string;
  milestoneId: string;
  amount: number;
  asset: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (open) { setReason(""); setDetail(""); setTouched(false); }
  }, [open]);

  const detailError = touched && detail.trim().length < 20
    ? "Give enough detail for this to be reviewed fairly."
    : null;

  const submit = async () => {
    setTouched(true);
    if (reason.trim().length < 3 || detail.trim().length < 20) return;

    setSubmitting(true);
    const result = await api.post<{ dispute: { id: string } }>(
      `/api/agreements/${agreementId}/milestones/${milestoneId}/dispute`,
      { reason: reason.trim(), detail: detail.trim() },
    );

    if (result.ok) {
      trackEvent("dispute_opened", {}, agreementId);
      toast({ tone: "attn", title: "Dispute opened", body: "The milestone is paused while this is reviewed." });
      onClose();
      router.push(`/app/agreements/${agreementId}/dispute/${result.data.dispute.id}`);
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not open dispute", body: result.error.message });
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Open a dispute"
      description="Use this when a revision will not resolve the disagreement."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={submitting} onClick={submit}>
            Open dispute
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="attn" title="This pauses the milestone">
          {formatMoney(amount, asset)} stays locked in escrow until the dispute is resolved.
          Neither party can release it in the meantime. Most disagreements resolve faster
          through a revision or a partial release.
        </Alert>

        <Field label="Reason" htmlFor="dispute-reason" required hint="A short summary, e.g. “Scope disagreement”.">
          <Input
            id="dispute-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Scope disagreement"
            maxLength={200}
          />
        </Field>

        <Field
          label="What happened?"
          htmlFor="dispute-detail"
          required
          error={detailError}
          hint="Both parties and, if escalated, an operations reviewer will read this."
          aside={`${detail.length}/5000`}
        >
          <Textarea
            id="dispute-detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Describe the disagreement, referring to the specific acceptance criteria involved."
            rows={5}
            maxLength={5000}
          />
        </Field>
      </div>
    </Modal>
  );
}
