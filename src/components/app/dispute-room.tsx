"use client";

/**
 * Dispute resolution.
 *
 * Designed to lower the temperature, not raise it. Both sides see the same
 * agreement terms, the same evidence, and the same timeline, laid out neutrally.
 * There are no verdict badges, no "who is winning", and negotiation is offered
 * before escalation because most of these are scope misunderstandings.
 *
 * Arbitration here is operator-mediated and labelled as such. VerseFlow does not
 * claim a decentralized arbitration layer it has not built.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Scale, MessageSquare, Send, Check, ArrowRight, ShieldAlert, Info, Clock,
} from "lucide-react";
import {
  Card, Button, Badge, Alert, Modal, Field, Textarea, Input, Avatar, Progress, useToast, cn,
} from "@/components/ui";
import { formatMoney, parseMoney, percentOf } from "@/lib/domain/money";
import { formatDateTime, relativeTime, MILESTONE_STATUS_META } from "@/lib/utils/format";
import { EvidenceCard, VerificationPanel } from "./milestone-parts";
import { ActivityTimeline } from "./activity-timeline";
import { api, makeIdempotencyKey, trackEvent } from "@/lib/utils/api-client";
import type {
  Dispute, Milestone, Evidence, EvidenceAnalysis, RevisionRequest, ActivityEvent,
} from "@/lib/domain/types";

interface Message {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorColor: string;
  isYou: boolean;
}

export function DisputeRoom({
  agreementId, dispute, milestone, evidence, analysis, revisions, messages,
  activity, asset, remaining, viewerRole, isAdmin, clientName, providerName, openedByName,
}: {
  agreementId: string;
  dispute: Dispute;
  milestone: Milestone;
  evidence: Evidence[];
  analysis: EvidenceAnalysis | null;
  revisions: RevisionRequest[];
  messages: Message[];
  activity: ActivityEvent[];
  asset: string;
  remaining: number;
  viewerRole: "client" | "provider" | "operator";
  isAdmin: boolean;
  clientName: string;
  providerName: string;
  openedByName: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = React.useState<"evidence" | "terms" | "messages" | "timeline">("evidence");
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [settleOpen, setSettleOpen] = React.useState(false);

  const resolved = dispute.status === "resolved" || dispute.status === "withdrawn";
  const canSettle = viewerRole === "client" || isAdmin;

  const send = async () => {
    if (draft.trim().length < 2) return;
    setSending(true);
    const result = await api.post(`/api/disputes/${dispute.id}/messages`, { body: draft.trim() });
    if (result.ok) {
      setDraft("");
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not send", body: result.error.message });
    }
    setSending(false);
  };

  return (
    <div className="mt-4 space-y-5">
      {/* ---------- Header ---------- */}
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-gradient font-display text-3xl leading-tight">Resolve milestone</h1>
          <Badge tone={resolved ? "settle" : "danger"}>
            {resolved ? "Resolved" : "Open"}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-subtle">
          {milestone.title} · {formatMoney(milestone.amount, asset)} ·{" "}
          {formatMoney(remaining, asset)} still locked
        </p>
      </header>

      {resolved ? (
        <Alert tone="settle" title="This dispute was resolved">
          <p>
            {dispute.resolution === "released_partial" || dispute.resolution === "negotiated"
              ? `Settled with ${formatMoney(dispute.resolvedProviderAmount ?? 0, asset)} released to ${providerName}.`
              : dispute.resolution === "released_full"
                ? `Settled in full to ${providerName}.`
                : dispute.resolution === "refunded_full"
                  ? `The milestone was closed and funds returned to ${clientName}.`
                  : "The dispute was withdrawn."}
          </p>
          {dispute.resolutionNote ? (
            <p className="mt-1.5 italic">{dispute.resolutionNote}</p>
          ) : null}
          <p className="mt-1.5 text-2xs text-faint">
            Resolved {relativeTime(dispute.resolvedAt)}
          </p>
        </Alert>
      ) : (
        <Alert tone="attn" icon={<Clock className="size-4" />} title="Funds are paused">
          {formatMoney(remaining, asset)} remains locked in escrow and cannot be released by
          either party until this is resolved.
        </Alert>
      )}

      {/* ---------- The disagreement, stated neutrally ---------- */}
      <Card>
        <div className="border-b border-line-subtle px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="size-4 text-faint" aria-hidden />
            {dispute.reason}
          </h2>
          <p className="mt-0.5 text-2xs text-faint">
            Opened by {openedByName} · {formatDateTime(dispute.openedAt)}
          </p>
        </div>
        <div className="p-5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{dispute.detail}</p>
        </div>
      </Card>

      {/* ---------- Side-by-side context ---------- */}
      <div>
        <div role="tablist" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
          {([
            { id: "evidence", label: "Submitted evidence", count: evidence.length },
            { id: "terms", label: "Agreement terms" },
            { id: "messages", label: "Messages", count: messages.length },
            { id: "timeline", label: "Timeline" },
          ] as const).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors",
                tab === t.id ? "text-fg" : "text-subtle hover:text-fg",
              )}
            >
              {t.label}
              {"count" in t && typeof t.count === "number" ? (
                <span className="ml-1.5 rounded-full bg-inset px-1.5 py-0.5 text-2xs tabular">
                  {t.count}
                </span>
              ) : null}
              {tab === t.id ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-fg" /> : null}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "evidence" ? (
            <div className="space-y-4">
              {evidence.length === 0 ? (
                <Card><p className="p-5 text-sm text-faint">No evidence was submitted.</p></Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {evidence.map((e) => <EvidenceCard key={e.id} evidence={e} />)}
                </div>
              )}
              {analysis ? <VerificationPanel analysis={analysis} compact /> : null}
            </div>
          ) : null}

          {tab === "terms" ? (
            <Card>
              <div className="grid gap-5 p-5 sm:grid-cols-2">
                <section>
                  <h3 className="text-2xs font-medium uppercase tracking-wider text-faint">
                    Deliverables agreed
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {milestone.deliverables.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-faint" aria-hidden />
                        <span className="text-muted">{d}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="text-2xs font-medium uppercase tracking-wider text-faint">
                    Acceptance criteria agreed
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {milestone.acceptanceCriteria.map((c) => (
                      <li key={c.id} className="flex items-start gap-2 text-xs">
                        <Check className="mt-0.5 size-3 shrink-0 text-faint" aria-hidden />
                        <span className="text-muted">{c.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              {revisions.length > 0 ? (
                <div className="border-t border-line-subtle p-5">
                  <h3 className="text-2xs font-medium uppercase tracking-wider text-faint">
                    Revision history
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {revisions.map((r) => (
                      <li key={r.id} className="rounded-lg border border-line bg-inset p-3">
                        <p className="text-2xs text-faint">
                          Round {r.round} · {formatDateTime(r.createdAt)}
                        </p>
                        <p className="mt-1 text-xs">{r.issue}</p>
                        <p className="mt-0.5 text-2xs text-subtle">Requested: {r.requestedAction}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          {tab === "messages" ? (
            <Card>
              <div className="max-h-96 overflow-y-auto p-5">
                {messages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-faint">
                    No messages yet. Most disputes resolve once both sides restate what they
                    expected.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {messages.map((m) => (
                      <li key={m.id} className={cn("flex gap-3", m.isYou && "flex-row-reverse")}>
                        <Avatar name={m.authorName} color={m.authorColor} size="sm" />
                        <div className={cn("max-w-[80%] min-w-0", m.isYou && "text-right")}>
                          <p className="text-2xs text-faint">
                            {m.authorName} · {relativeTime(m.createdAt)}
                          </p>
                          <div
                            className={cn(
                              "mt-1 inline-block rounded-lg px-3 py-2 text-left text-xs leading-relaxed",
                              m.isYou ? "bg-accent-soft" : "bg-inset",
                            )}
                          >
                            {m.body}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!resolved ? (
                <div className="border-t border-line-subtle p-4">
                  <div className="flex gap-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Explain your position, referring to the agreed criteria."
                      rows={2}
                      maxLength={4000}
                      aria-label="Message"
                      className="min-h-0"
                    />
                    <Button
                      variant="primary"
                      icon={<Send className="size-3.5" />}
                      loading={sending}
                      disabled={draft.trim().length < 2}
                      onClick={send}
                      aria-label="Send message"
                    >
                      Send
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          ) : null}

          {tab === "timeline" ? (
            <Card className="p-5">
              <ActivityTimeline events={activity} explorerUrl={null} compact />
            </Card>
          ) : null}
        </div>
      </div>

      {/* ---------- Resolution options ---------- */}
      {!resolved ? (
        <Card>
          <div className="border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-sm font-semibold">How to move forward</h2>
            <p className="mt-0.5 text-2xs text-subtle">
              Most disputes are scope misunderstandings and settle without escalation.
            </p>
          </div>

          <div className="space-y-3 p-5">
            <ResolutionOption
              title="Continue the conversation"
              body="Restate what each side expected against the written criteria. This resolves most disputes."
              action={
                <Button variant="secondary" icon={<MessageSquare className="size-3.5" />} onClick={() => setTab("messages")}>
                  Open messages
                </Button>
              }
            />

            <ResolutionOption
              title="Agree on a partial release"
              body={
                canSettle
                  ? "Release the part both sides agree was delivered and return the rest."
                  : "The client can propose a split. You will see it here once they do."
              }
              action={
                canSettle ? (
                  <Button variant="primary" icon={<Scale className="size-3.5" />} onClick={() => setSettleOpen(true)}>
                    Propose a split
                  </Button>
                ) : null
              }
            />

            <ResolutionOption
              title="Escalate to operations review"
              body="A VerseFlow operator reviews the agreement, the evidence, and the messages, then settles the milestone. The decision and its reasoning are written into the permanent audit record."
              tone="attn"
              action={
                isAdmin ? (
                  <Button variant="danger" icon={<ShieldAlert className="size-3.5" />} onClick={() => setSettleOpen(true)}>
                    Resolve as operator
                  </Button>
                ) : (
                  <span className="text-2xs text-faint">Contact support to escalate</span>
                )
              }
            />
          </div>

          {/* Honest about what arbitration actually is here. */}
          <div className="border-t border-line-subtle bg-inset px-5 py-3">
            <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-subtle">
              <Info className="mt-px size-3 shrink-0 text-faint" aria-hidden />
              Arbitration on VerseFlow is operator-mediated, not decentralized. An operator
              can only split the disputed milestone between the two parties, can never take a
              cut, and every resolution writes an immutable audit event visible to both sides.
            </p>
          </div>
        </Card>
      ) : null}

      <SettleModal
        open={settleOpen}
        onClose={() => setSettleOpen(false)}
        disputeId={dispute.id}
        agreementId={agreementId}
        remaining={remaining}
        asset={asset}
        providerName={providerName}
        clientName={clientName}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function ResolutionOption({
  title, body, action, tone = "neutral",
}: {
  title: string;
  body: string;
  action: React.ReactNode;
  tone?: "neutral" | "attn";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center",
        tone === "attn" ? "border-attn-border bg-attn-soft" : "border-line",
      )}
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-subtle">{body}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function SettleModal({
  open, onClose, disputeId, agreementId, remaining, asset, providerName, clientName, isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  disputeId: string;
  agreementId: string;
  remaining: number;
  asset: string;
  providerName: string;
  clientName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [percent, setPercent] = React.useState(50);
  const [custom, setCustom] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const idempotencyKey = React.useRef(makeIdempotencyKey("settle"));

  React.useEffect(() => {
    if (open) { setPercent(50); setCustom(""); setNote(""); setTouched(false); }
  }, [open]);

  const providerAmount = React.useMemo(() => {
    if (custom.trim()) {
      try { return Math.min(parseMoney(custom, asset), remaining); } catch { return 0; }
    }
    return percentOf(remaining, percent);
  }, [custom, percent, remaining, asset]);

  const clientRefund = remaining - providerAmount;
  const noteError = touched && note.trim().length < 10 ? "Record why this resolution was reached." : null;

  // Mirrors the server rule, so the button explains itself rather than failing.
  const zeroAwardBlocked = !isAdmin && providerAmount <= 0 && remaining > 0;

  const submit = async () => {
    setTouched(true);
    if (note.trim().length < 10 || zeroAwardBlocked) return;

    setSubmitting(true);
    const resolution =
      providerAmount >= remaining ? "released_full" :
      providerAmount === 0 ? "refunded_full" :
      isAdmin ? "released_partial" : "negotiated";

    const result = await api.post(`/api/disputes/${disputeId}/resolve`, {
      resolution,
      providerAmount,
      note: note.trim(),
      idempotencyKey: idempotencyKey.current,
    });

    if (result.ok) {
      trackEvent("dispute_resolved", { resolution, providerAmount }, agreementId);
      toast({ tone: "settle", title: "Dispute resolved", body: "Both parties have been notified." });
      onClose();
      router.push(`/app/agreements/${agreementId}`);
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not resolve", body: result.error.message });
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isAdmin ? "Resolve as operator" : "Propose a settlement"}
      description="The split is shown before anything executes."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={submitting}
            disabled={zeroAwardBlocked}
            title={zeroAwardBlocked ? "A full refund requires operations review." : undefined}
            onClick={submit}
          >
            Settle milestone
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <div className="bg-settle-soft p-4 text-center">
            <p className="text-2xs text-muted">To {providerName}</p>
            <p className="mt-1 text-xl font-semibold tabular text-settle">
              {formatMoney(providerAmount, asset)}
            </p>
          </div>
          <div className="bg-inset p-4 text-center">
            <p className="text-2xs text-muted">Returned to {clientName}</p>
            <p className="mt-1 text-xl font-semibold tabular">
              {formatMoney(clientRefund, asset)}
            </p>
          </div>
        </div>

        <Progress value={remaining > 0 ? Math.round((providerAmount / remaining) * 100) : 0} tone="settle" />

        <div>
          <p className="mb-2 text-xs font-medium text-muted">Split</p>
          <div className="flex flex-wrap gap-2">
            {/*
              A full refund (0% to the provider) takes money back from someone who
              may have delivered, so it is not something a client can agree alone.
              The option is offered only to an operator, and the server enforces
              the same rule regardless of what the UI shows.
            */}
            {(isAdmin ? [0, 25, 50, 75, 100] : [25, 50, 75, 100]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { setPercent(p); setCustom(""); }}
                className={cn(
                  "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
                  !custom && percent === p
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line hover:border-line-strong",
                )}
              >
                {p}%
              </button>
            ))}
          </div>
          {!isAdmin ? (
            <p className="mt-2 text-2xs leading-relaxed text-faint">
              Returning the full amount to yourself needs operations review. Propose an
              amount here, or escalate.
            </p>
          ) : null}
        </div>

        <Field label="Or an exact amount to the provider" htmlFor="settle-amount" hint={`Maximum ${formatMoney(remaining, asset)}`}>
          <Input
            id="settle-amount"
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={(remaining / 100).toFixed(2)}
          />
        </Field>

        <Field
          label="Resolution note"
          htmlFor="settle-note"
          required
          error={noteError}
          hint="Written into the permanent audit record and visible to both parties."
          aside={`${note.length}/4000`}
        >
          <Textarea
            id="settle-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Both parties agreed the CRM endpoint was discussed but never written into the acceptance criteria. Settled at 80% with the integration descoped."
            rows={4}
            maxLength={4000}
          />
        </Field>
      </div>
    </Modal>
  );
}
