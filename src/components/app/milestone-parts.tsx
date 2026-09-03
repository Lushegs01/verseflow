"use client";

/**
 * Milestone presentation: the payment timeline, milestone cards, evidence cards,
 * and the verification panel.
 *
 * The verification panel is the most delicate surface in the product. It has to be
 * genuinely useful without ever reading as a decision, so its language, hierarchy,
 * and disclaimer placement are all deliberate.
 */

import * as React from "react";
import {
  Check, Circle, Lock, Github, Globe, FileImage, FileText, Figma, Link2,
  StickyNote, GitCommit, ScanLine, AlertTriangle, HelpCircle, X, ChevronDown, ExternalLink,
} from "lucide-react";
import { cn, Badge, Mono, Progress, type BadgeTone } from "@/components/ui";
import { formatMoney } from "@/lib/domain/money";
import { formatDate, formatDateTime, relativeTime, timeRemaining, MILESTONE_STATUS_META, EVIDENCE_META } from "@/lib/utils/format";
import { shortHash } from "@/lib/domain/hashing";
import { RECOMMENDATION_LABELS, ASSESSMENT_LABELS } from "@/lib/ai/evidence-analyzer";
import type {
  Milestone, Evidence, EvidenceAnalysis, EvidenceKind, CriterionAssessment,
} from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Payment timeline
// ---------------------------------------------------------------------------

/**
 * The sidebar timeline that makes money visibly connected to work progress.
 * Released / current / locked, in one glance.
 */
export function PaymentTimeline({
  milestones, asset, activeId,
}: {
  milestones: Milestone[];
  asset: string;
  activeId?: string | null;
}) {
  return (
    <ol className="space-y-1">
      {milestones.map((m) => {
        const released = m.status === "released";
        const partial = m.releasedAmount > 0 && !released;
        const active =
          m.id === activeId ||
          ["in_progress", "submitted", "under_review", "revision_requested", "approved", "partially_approved", "disputed"].includes(m.status);

        return (
          <li
            key={m.id}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
              active && !released && "bg-inset",
            )}
          >
            <span className="shrink-0" aria-hidden>
              {released ? (
                <Check className="size-3.5 text-settle" />
              ) : active ? (
                <Circle className="size-3.5 fill-accent text-accent" />
              ) : (
                <Lock className="size-3.5 text-faint" />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{m.title}</span>
              {partial ? (
                <span className="block text-[10px] text-locked">
                  {formatMoney(m.releasedAmount, asset)} released
                </span>
              ) : null}
            </span>

            <span
              className={cn(
                "shrink-0 text-xs font-semibold tabular",
                released ? "text-settle" : active ? "text-fg" : "text-faint",
              )}
            >
              {formatMoney(m.amount, asset)}
            </span>

            {/* State is never conveyed by colour alone. */}
            <span className="w-14 shrink-0 text-right text-[10px] text-faint">
              {released ? "Released" : active ? "Current" : "Locked"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Milestone card
// ---------------------------------------------------------------------------

export function MilestoneCard({
  milestone, asset, revisionsAllowed, defaultOpen = false, action,
}: {
  milestone: Milestone;
  asset: string;
  revisionsAllowed: number;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const meta = MILESTONE_STATUS_META[milestone.status];
  const overdue =
    Boolean(milestone.dueAt) &&
    Date.parse(milestone.dueAt as string) < Date.now() &&
    !["released", "cancelled"].includes(milestone.status);

  const contentId = `milestone-${milestone.id}-content`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-raised transition-colors",
        milestone.status === "under_review" || milestone.status === "submitted"
          ? "border-attn-border"
          : milestone.status === "disputed"
            ? "border-danger-border"
            : "border-line",
      )}
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xs text-faint">
                Milestone {milestone.position + 1}
              </span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {overdue ? <Badge tone="danger">Past deadline</Badge> : null}
            </div>
            <h3 className="mt-1.5 text-base font-semibold">{milestone.title}</h3>
            {milestone.description ? (
              <p className="mt-1 text-xs leading-relaxed text-subtle">{milestone.description}</p>
            ) : null}
          </div>

          <div className="text-right">
            <p className="text-xl font-semibold tabular">{formatMoney(milestone.amount, asset)}</p>
            {milestone.releasedAmount > 0 && milestone.releasedAmount < milestone.amount ? (
              <p className="text-2xs text-locked">
                {formatMoney(milestone.releasedAmount, asset)} released
              </p>
            ) : null}
            {milestone.dueAt ? (
              <p className={cn("mt-0.5 text-2xs", overdue ? "text-danger" : "text-faint")}>
                Due {formatDate(milestone.dueAt)}
              </p>
            ) : null}
          </div>
        </div>

        {milestone.releasedAmount > 0 && milestone.releasedAmount < milestone.amount ? (
          <Progress
            className="mt-3"
            value={Math.round((milestone.releasedAmount / milestone.amount) * 100)}
            tone="locked"
          />
        ) : null}

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-faint">
          {milestone.requiredEvidence.length > 0 ? (
            <span>
              Evidence: {milestone.requiredEvidence.map((k) => EVIDENCE_META[k].short).join(", ")}
            </span>
          ) : null}
          {revisionsAllowed > 0 ? (
            <span className={milestone.revisionCount >= revisionsAllowed ? "text-attn" : undefined}>
              {milestone.revisionCount} / {revisionsAllowed} revisions used
            </span>
          ) : null}
          {milestone.reviewDueAt && milestone.status === "under_review" ? (
            <span className={timeRemaining(milestone.reviewDueAt).overdue ? "text-danger" : "text-attn"}>
              Review {timeRemaining(milestone.reviewDueAt).label.toLowerCase()}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={contentId}
          className="mt-3 flex items-center gap-1 text-xs text-accent transition-colors hover:underline"
        >
          {open ? "Hide" : "View"} deliverables and acceptance criteria
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>

      {open ? (
        <div id={contentId} className="border-t border-line-subtle bg-inset p-4 sm:p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <section>
              <h4 className="text-2xs font-medium uppercase tracking-wider text-faint">Deliverables</h4>
              {milestone.deliverables.length === 0 ? (
                <p className="mt-2 text-xs text-faint">None listed.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {milestone.deliverables.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-faint" aria-hidden />
                      <span className="text-muted">{d}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="text-2xs font-medium uppercase tracking-wider text-faint">
                Acceptance criteria
              </h4>
              {milestone.acceptanceCriteria.length === 0 ? (
                <p className="mt-2 text-xs text-faint">None defined.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {milestone.acceptanceCriteria.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-xs">
                      <Check className="mt-0.5 size-3 shrink-0 text-faint" aria-hidden />
                      <span className="text-muted">{c.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {action ? <div className="mt-5">{action}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

const EVIDENCE_ICON: Record<EvidenceKind, React.ComponentType<{ className?: string }>> = {
  github_repo: Github,
  github_commits: GitCommit,
  deployment_url: Globe,
  figma: Figma,
  document: FileText,
  file: FileImage,
  screenshot: FileImage,
  note: StickyNote,
  link: Link2,
};

export function EvidenceCard({ evidence }: { evidence: Evidence }) {
  const Icon = EVIDENCE_ICON[evidence.kind] ?? FileText;
  const meta = evidence.metadata as Record<string, unknown>;
  const isUrl = /^https?:\/\//.test(evidence.source);

  // Surface the metadata that actually matters per evidence kind, rather than
  // dumping the whole object.
  const details: Array<{ label: string; value: string; tone?: "settle" | "danger" }> = [];

  if (evidence.kind === "github_repo" || evidence.kind === "github_commits") {
    if (meta.commitsSinceMilestone) details.push({ label: "Commits since milestone opened", value: String(meta.commitsSinceMilestone) });
    else if (meta.commits) details.push({ label: "Commits", value: String(meta.commits) });
    if (meta.branch) details.push({ label: "Branch", value: String(meta.branch) });
    if (meta.lastCommit) details.push({ label: "Last commit", value: relativeTime(String(meta.lastCommit)) });
  }

  if (evidence.kind === "deployment_url") {
    const status = String(meta.status ?? "").toLowerCase();
    if (status) {
      details.push({
        label: "Status",
        value: status === "online" ? "Reachable" : "Offline",
        tone: status === "online" ? "settle" : "danger",
      });
    }
    if (meta.checkedAt) details.push({ label: "Checked", value: relativeTime(String(meta.checkedAt)) });
    if (meta.pagesDetected) details.push({ label: "Pages detected", value: String(meta.pagesDetected) });
    if (meta.responseMs) details.push({ label: "Response", value: `${meta.responseMs}ms` });
  }

  if (evidence.kind === "screenshot" || evidence.kind === "file") {
    if (meta.files) details.push({ label: "Files", value: String(meta.files) });
    if (Array.isArray(meta.widths)) details.push({ label: "Widths", value: (meta.widths as string[]).join(", ") });
  }

  if (evidence.kind === "figma") {
    if (meta.frames) details.push({ label: "Frames", value: String(meta.frames) });
    if (meta.pages) details.push({ label: "Pages", value: String(meta.pages) });
  }

  return (
    <div className="panel rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-inset text-subtle">
          <Icon className="size-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-2xs text-faint">{EVIDENCE_META[evidence.kind].label}</p>
          <p className="truncate text-sm font-medium">{evidence.title}</p>

          {evidence.source ? (
            isUrl ? (
              <a
                href={evidence.source}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-accent transition-colors hover:underline"
              >
                <span className="truncate">{evidence.source.replace(/^https?:\/\//, "")}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            ) : (
              <p className="mt-0.5 truncate font-mono text-xs text-subtle">{evidence.source}</p>
            )
          ) : null}

          {evidence.description ? (
            <p className="mt-2 text-xs leading-relaxed text-muted">{evidence.description}</p>
          ) : null}

          {details.length > 0 ? (
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
              {details.map((d) => (
                <div key={d.label} className="min-w-0">
                  <dt className="truncate text-[10px] text-faint">{d.label}</dt>
                  <dd
                    className={cn(
                      "truncate text-xs font-medium",
                      d.tone === "settle" && "text-settle",
                      d.tone === "danger" && "text-danger",
                    )}
                  >
                    {d.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>

      {/* Everything is timestamped and hashed, and both are shown. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-subtle pt-2.5">
        <span className="text-[10px] text-faint">{formatDateTime(evidence.submittedAt)}</span>
        <Mono value={evidence.hash} display={shortHash(evidence.hash, 4)} label="evidence hash" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification panel
// ---------------------------------------------------------------------------

const ASSESSMENT_ICON: Record<CriterionAssessment, React.ReactNode> = {
  met: <Check className="size-3.5 text-settle" />,
  likely_met: <Check className="size-3.5 text-settle" />,
  unverified: <AlertTriangle className="size-3.5 text-attn" />,
  not_met: <X className="size-3.5 text-danger" />,
};

const ASSESSMENT_TONE: Record<CriterionAssessment, BadgeTone> = {
  met: "settle",
  likely_met: "settle",
  unverified: "attn",
  not_met: "danger",
};

const RECOMMENDATION_TONE: Record<string, BadgeTone> = {
  likely_satisfies: "settle",
  partially_satisfies: "attn",
  needs_clarification: "attn",
  likely_insufficient: "danger",
};

/**
 * AI verification assistant.
 *
 * Three rules this component exists to enforce visually:
 *   1. The word "recommendation" appears before any conclusion.
 *   2. Unverifiable criteria are shown as unverified, never quietly passed.
 *   3. The disclaimer sits with the recommendation, not buried in a footer.
 */
export function VerificationPanel({
  analysis, compact = false,
}: {
  analysis: EvidenceAnalysis;
  compact?: boolean;
}) {
  const unverified = analysis.findings.filter((f) => f.assessment === "unverified").length;
  const notMet = analysis.findings.filter((f) => f.assessment === "not_met").length;

  return (
    <div className="panel overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-center gap-2 border-b border-line-subtle bg-inset px-4 py-3">
        <ScanLine className="size-4 shrink-0 text-accent" aria-hidden />
        <h3 className="text-sm font-semibold">AI Verification Assistant</h3>
        <Badge
          tone={analysis.consistency === "high" ? "settle" : analysis.consistency === "medium" ? "attn" : "danger"}
          className="ml-auto"
        >
          Evidence consistency: {analysis.consistency}
        </Badge>
      </header>

      <div className="p-4 sm:p-5">
        <section>
          <h4 className="text-2xs font-medium uppercase tracking-wider text-faint">
            Acceptance criteria
          </h4>
          <ul className="mt-2.5 space-y-2">
            {analysis.findings.map((finding) => (
              <li key={finding.criterionId} className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0" aria-hidden>
                  {ASSESSMENT_ICON[finding.assessment]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-relaxed">{finding.criterionText}</p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-faint">{finding.reasoning}</p>
                </div>
                {/* Text label, so the assessment is never colour-only. */}
                <Badge tone={ASSESSMENT_TONE[finding.assessment]} className="mt-0.5 shrink-0">
                  {ASSESSMENT_LABELS[finding.assessment]}
                </Badge>
              </li>
            ))}
          </ul>
        </section>

        {analysis.openQuestions.length > 0 && !compact ? (
          <section className="mt-5 rounded-lg border border-attn-border bg-attn-soft p-3.5">
            <h4 className="flex items-center gap-1.5 text-xs font-medium">
              <HelpCircle className="size-3.5 text-attn" aria-hidden />
              Needs a person to check
            </h4>
            <ul className="mt-2 space-y-1.5">
              {analysis.openQuestions.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-2xs leading-relaxed text-muted">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-attn" aria-hidden />
                  {q}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* --- Recommendation --- */}
        <section className="mt-5 rounded-lg border border-line bg-inset p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-2xs font-medium uppercase tracking-wider text-faint">
              Recommendation
            </h4>
            <span className="ml-auto text-2xs text-faint">
              {analysis.engine === "model" ? "Language model" : "Rule engine"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-base font-semibold">
              {RECOMMENDATION_LABELS[analysis.recommendation]}
            </p>
            <Badge tone={RECOMMENDATION_TONE[analysis.recommendation] ?? "neutral"}>
              {analysis.confidence}% confidence
            </Badge>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-muted">{analysis.summary}</p>

          {unverified > 0 || notMet > 0 ? (
            <p className="mt-2 text-2xs text-attn">
              {unverified > 0 ? `${unverified} criterion${unverified === 1 ? "" : "s"} could not be verified from the evidence. ` : ""}
              {notMet > 0 ? `${notMet} appear${notMet === 1 ? "s" : ""} unmet.` : ""}
            </p>
          ) : null}

          {/*
            The disclaimer sits directly under the recommendation, where the
            decision is actually being formed -- not in a footer people scroll past.
          */}
          <div className="mt-3.5 flex items-start gap-2 border-t border-line pt-3">
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-faint" aria-hidden />
            <p className="text-2xs leading-relaxed text-subtle">
              <strong className="font-medium text-fg">
                AI recommendation — not a unilateral payment decision.
              </strong>{" "}
              This analysis has no authority over escrow. What can happen next is
              determined by the agreement rules and by an authorized human decision.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
