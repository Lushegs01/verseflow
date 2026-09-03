"use client";

/**
 * Milestone submission.
 *
 * The evidence requirements come from the agreement, so the form tells the
 * provider exactly what the client already agreed to accept. Missing required
 * evidence is surfaced before submission rather than as a server rejection after.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  Github, Globe, Figma, FileText, FileImage, Link2, StickyNote, GitCommit,
  Plus, X, Upload, Check, AlertTriangle, Loader2, ArrowRight, ScanLine,
} from "lucide-react";
import {
  Card, Button, Badge, Alert, Field, Input, Textarea, Select, useToast, Mono,
} from "@/components/ui";
import { formatMoney } from "@/lib/domain/money";
import { shortHash } from "@/lib/domain/hashing";
import { formatDate, EVIDENCE_META, MILESTONE_STATUS_META } from "@/lib/utils/format";
import { EvidenceCard, VerificationPanel } from "./milestone-parts";
import { api, trackEvent } from "@/lib/utils/api-client";
import type {
  Milestone, Evidence, EvidenceKind, EvidenceAnalysis, RevisionRequest,
} from "@/lib/domain/types";

const KIND_ICON: Record<EvidenceKind, React.ComponentType<{ className?: string }>> = {
  github_repo: Github, github_commits: GitCommit, deployment_url: Globe, figma: Figma,
  document: FileText, file: FileImage, screenshot: FileImage, note: StickyNote, link: Link2,
};

/** What each evidence kind expects in its source field. */
const KIND_CONFIG: Record<EvidenceKind, { placeholder: string; sourceLabel: string; urlLike: boolean }> = {
  github_repo: { placeholder: "https://github.com/org/repo", sourceLabel: "Repository URL", urlLike: true },
  github_commits: { placeholder: "https://github.com/org/repo/compare/v1...main", sourceLabel: "Commit range URL", urlLike: true },
  deployment_url: { placeholder: "https://staging.example.com", sourceLabel: "Deployment URL", urlLike: true },
  figma: { placeholder: "https://figma.com/file/…", sourceLabel: "Figma URL", urlLike: true },
  document: { placeholder: "https://docs.example.com/handover", sourceLabel: "Document URL", urlLike: true },
  file: { placeholder: "design-files.zip", sourceLabel: "File name", urlLike: false },
  screenshot: { placeholder: "responsive-checks.zip", sourceLabel: "File name", urlLike: false },
  note: { placeholder: "", sourceLabel: "", urlLike: false },
  link: { placeholder: "https://example.com", sourceLabel: "URL", urlLike: true },
};

interface DraftEvidence {
  localId: string;
  kind: EvidenceKind;
  title: string;
  source: string;
  description: string;
}

export function SubmitPanel({
  agreementId, milestone, previousEvidence, revisions, asset,
  evidenceRequired, revisionsAllowed, clientName,
}: {
  agreementId: string;
  milestone: Milestone;
  previousEvidence: Evidence[];
  revisions: RevisionRequest[];
  asset: string;
  evidenceRequired: boolean;
  revisionsAllowed: number;
  clientName: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const reduced = useReducedMotion();

  const [note, setNote] = React.useState("");
  const [items, setItems] = React.useState<DraftEvidence[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{
    analysis: EvidenceAnalysis; bundleHash: string; evidence: Evidence[];
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  const isRevision = milestone.status === "revision_requested";
  const openRevision = revisions.find((r) => !r.resolvedAt);
  const canSubmit = milestone.status === "in_progress" || milestone.status === "revision_requested";

  const providedKinds = new Set(items.map((i) => i.kind));
  const missingRequired = milestone.requiredEvidence.filter((k) => !providedKinds.has(k));
  const hasContent = items.length > 0 || note.trim().length > 0;

  const addItem = (kind: EvidenceKind) => {
    setItems((prev) => [
      ...prev,
      {
        localId: Math.random().toString(36).slice(2),
        kind,
        title: EVIDENCE_META[kind].label,
        source: "",
        description: "",
      },
    ]);
  };

  const updateItem = (localId: string, patch: Partial<DraftEvidence>) => {
    setItems((prev) => prev.map((i) => (i.localId === localId ? { ...i, ...patch } : i)));
  };

  const removeItem = (localId: string) => {
    setItems((prev) => prev.filter((i) => i.localId !== localId));
  };

  const submit = async () => {
    setTouched(true);
    setError(null);

    if (evidenceRequired && !hasContent) {
      setError("This milestone requires at least one evidence item before submission.");
      return;
    }

    setSubmitting(true);

    const payload = {
      note: note.trim(),
      evidence: items
        .filter((i) => i.title.trim())
        .map((i) => ({
          kind: i.kind,
          title: i.title.trim(),
          source: i.source.trim(),
          description: i.description.trim(),
          // Metadata a real integration would populate by calling the source.
          // Recorded as provided rather than invented.
          metadata: {} as Record<string, string>,
        })),
    };

    const response = await api.post<{
      analysis: EvidenceAnalysis; bundleHash: string; evidence: Evidence[];
    }>(`/api/agreements/${agreementId}/milestones/${milestone.id}/submit`, payload);

    if (!response.ok) {
      setError(response.error.hint ? `${response.error.message} ${response.error.hint}` : response.error.message);
      setSubmitting(false);
      return;
    }

    trackEvent("milestone_submitted", { evidenceCount: payload.evidence.length }, agreementId);
    setResult(response.data);
    setSubmitting(false);
    router.refresh();
  };

  // ---------------------------------------------------------------- Success

  if (result) {
    return (
      <div className="mt-4 space-y-5">
        <Card className="overflow-hidden">
          <div className="bg-settle-soft px-5 py-10 text-center">
            <motion.span
              className="mx-auto flex size-14 items-center justify-center rounded-full bg-settle text-white"
              initial={reduced ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <Check className="size-7" aria-hidden />
            </motion.span>
            <h1 className="mt-4 font-display text-2xl">Milestone submitted</h1>
            <p className="mt-1.5 text-sm text-muted">
              {clientName} has been notified and has the review window to respond.
            </p>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-2xs text-muted">
              <span>Evidence bundle</span>
              <Mono value={result.bundleHash} display={shortHash(result.bundleHash, 5)} label="evidence bundle hash" />
            </div>
          </div>
        </Card>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <ScanLine className="size-4 text-accent" aria-hidden />
            <h2 className="text-sm font-semibold">What the client will see</h2>
          </div>
          <VerificationPanel analysis={result.analysis} />
        </div>

        <Button
          variant="primary"
          fullWidth
          iconRight={<ArrowRight className="size-4" />}
          onClick={() => { router.push(`/app/agreements/${agreementId}`); router.refresh(); }}
        >
          Back to the agreement
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------- Form

  return (
    <div className="mt-4 space-y-5">
      <header>
        <h1 className="text-gradient font-display text-3xl leading-tight">
          {isRevision ? "Submit revised work" : "Submit milestone"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-lg font-semibold tabular">{formatMoney(milestone.amount, asset)}</span>
          <span className="text-sm text-subtle">{milestone.title}</span>
          <Badge tone={MILESTONE_STATUS_META[milestone.status].tone}>
            {MILESTONE_STATUS_META[milestone.status].label}
          </Badge>
          {milestone.dueAt ? (
            <span className="text-xs text-faint">Due {formatDate(milestone.dueAt)}</span>
          ) : null}
        </div>
      </header>

      {!canSubmit ? (
        <Alert tone="attn" title="This milestone is not open for submission">
          {MILESTONE_STATUS_META[milestone.status].description}
        </Alert>
      ) : null}

      {/* --- What the client asked for --- */}
      {openRevision ? (
        <Alert tone="attn" title={`Revision ${openRevision.round} of ${revisionsAllowed} requested`}>
          <p className="font-medium text-fg">{openRevision.issue}</p>
          <p className="mt-1">Requested: {openRevision.requestedAction}</p>
        </Alert>
      ) : null}

      <Card>
        <div className="border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold">What this milestone requires</h2>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <section>
            <h3 className="text-2xs font-medium uppercase tracking-wider text-faint">Deliverables</h3>
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
              Acceptance criteria
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
      </Card>

      {/* --- Evidence --- */}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold">Evidence</h2>
          {milestone.requiredEvidence.length > 0 ? (
            <span className="text-2xs text-faint">
              Required: {milestone.requiredEvidence.map((k) => EVIDENCE_META[k].short).join(", ")}
            </span>
          ) : null}
        </div>

        <div className="p-5">
          {/* Missing-requirement warning surfaces before the submit attempt. */}
          {touched && missingRequired.length > 0 ? (
            <Alert tone="attn" title="Some required evidence is missing" className="mb-4">
              This milestone asks for{" "}
              {missingRequired.map((k) => EVIDENCE_META[k].label).join(", ")}. You can still
              submit, but the client agreed to expect these.
            </Alert>
          ) : null}

          {items.length === 0 ? (
            <p className="mb-4 text-sm text-faint">
              Add the repositories, deployments, files, and links that show the work was done.
            </p>
          ) : (
            <ul className="mb-4 space-y-3">
              {items.map((item) => {
                const Icon = KIND_ICON[item.kind];
                const config = KIND_CONFIG[item.kind];
                return (
                  <li key={item.localId} className="rounded-lg border border-line bg-inset p-4">
                    <div className="flex items-center gap-2.5">
                      <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                      <span className="flex-1 text-xs font-medium">{EVIDENCE_META[item.kind].label}</span>
                      <button
                        type="button"
                        onClick={() => removeItem(item.localId)}
                        aria-label={`Remove ${EVIDENCE_META[item.kind].label}`}
                        className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-danger"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      <Field label="Label" htmlFor={`title-${item.localId}`}>
                        <Input
                          id={`title-${item.localId}`}
                          value={item.title}
                          onChange={(e) => updateItem(item.localId, { title: e.target.value })}
                          placeholder="northstar-coffee/storefront"
                          maxLength={160}
                        />
                      </Field>

                      {item.kind !== "note" ? (
                        <Field label={config.sourceLabel} htmlFor={`source-${item.localId}`}>
                          <Input
                            id={`source-${item.localId}`}
                            type={config.urlLike ? "url" : "text"}
                            inputMode={config.urlLike ? "url" : "text"}
                            value={item.source}
                            onChange={(e) => updateItem(item.localId, { source: e.target.value })}
                            placeholder={config.placeholder}
                          />
                        </Field>
                      ) : null}

                      <Field
                        label="What does this show?"
                        htmlFor={`desc-${item.localId}`}
                        hint="Point the client at the specific criterion this satisfies."
                      >
                        <Textarea
                          id={`desc-${item.localId}`}
                          value={item.description}
                          onChange={(e) => updateItem(item.localId, { description: e.target.value })}
                          placeholder="All five pages deployed and responsive at the three agreed breakpoints."
                          rows={2}
                          maxLength={2000}
                        />
                      </Field>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-muted">Add evidence</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EVIDENCE_META) as EvidenceKind[])
                .filter((k) => k !== "note")
                .map((kind) => {
                  const Icon = KIND_ICON[kind];
                  const isRequired = milestone.requiredEvidence.includes(kind);
                  const isAdded = providedKinds.has(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => addItem(kind)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${
                        isRequired && !isAdded
                          ? "border-attn-border bg-attn-soft text-attn"
                          : "border-line hover:border-line-strong hover:bg-inset"
                      }`}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {EVIDENCE_META[kind].short}
                      {isRequired ? <span aria-label="required">*</span> : null}
                      <Plus className="size-3 opacity-50" aria-hidden />
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      </Card>

      {/* --- Note --- */}
      <Card>
        <div className="border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold">Notes for the client</h2>
        </div>
        <div className="p-5">
          <Field
            label="Explain what you delivered"
            htmlFor="submit-note"
            hint="Flagging anything you could not complete builds more trust than leaving it out."
            aside={`${note.length}/4000`}
          >
            <Textarea
              id="submit-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="All five pages are live on staging and responsive at the three agreed breakpoints. I have not run the cross-browser pass on Safari and Edge yet."
              rows={4}
              maxLength={4000}
            />
          </Field>
        </div>
      </Card>

      {/* --- Previous submissions --- */}
      {previousEvidence.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">
            Previously submitted · {previousEvidence.length} item{previousEvidence.length === 1 ? "" : "s"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {previousEvidence.map((e) => <EvidenceCard key={e.id} evidence={e} />)}
          </div>
        </section>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Could not submit" icon={<AlertTriangle className="size-4" />}>
          {error}
        </Alert>
      ) : null}

      {/* --- Sticky submit bar: always reachable on mobile --- */}
      <div className="sticky bottom-20 z-20 lg:bottom-4">
        <div className="panel raised-4 rounded-xl p-3">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            icon={submitting ? undefined : <Upload className="size-4" />}
            loading={submitting}
            loadingText="Analyzing evidence…"
            disabled={!canSubmit || (evidenceRequired && !hasContent)}
            onClick={submit}
          >
            {isRevision ? "Submit revision" : "Submit milestone"}
          </Button>

          {evidenceRequired && !hasContent ? (
            <p className="mt-2 text-center text-2xs text-faint">
              Add at least one evidence item or a note to submit.
            </p>
          ) : (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-2xs text-faint">
              <Loader2 className="size-3 opacity-0" aria-hidden />
              Evidence is hashed and timestamped on submission.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
