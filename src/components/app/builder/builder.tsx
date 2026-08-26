"use client";

/**
 * Agreement builder.
 *
 * Two entry points -- describe it, or start from scratch -- converging on the same
 * editable draft. The AI path is the hero, but it never hides contract logic:
 * every generated field lands in an editable control, and every suggestion is
 * shown as an accept / edit / reject decision.
 *
 * The allocation total is recomputed on every keystroke and the draft cannot leave
 * the builder while milestone amounts disagree with the contract value.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Sparkles, PenLine, ArrowRight, ArrowLeft, Check, AlertTriangle, Loader2,
  Plus, Trash2, GripVertical, X, Wand2, Info,
} from "lucide-react";
import {
  Card, Button, Badge, Alert, Field, Input, Textarea, Select, useToast, cn,
} from "@/components/ui";
import { formatMoney, parseMoney, ASSETS, splitEvenly } from "@/lib/domain/money";
import { DEFAULT_AGREEMENT_RULES, type EvidenceKind } from "@/lib/domain/types";
import { EVIDENCE_META } from "@/lib/utils/format";
import { api, trackEvent } from "@/lib/utils/api-client";
import type { GeneratedAgreement, AgreementIssue } from "@/lib/ai/agreement-engine";
import { STEPS, type StepId, type DraftState, type DraftMilestone, newLocalId, allocated } from "./types";
import { MilestoneEditor } from "./milestone-editor";
import { IssuePanel } from "./issue-panel";

const EXAMPLE_BRIEFS = [
  "I need a designer to create a brand identity for my startup. The total budget is $2,500. I want a moodboard first, then logo concepts, then final brand files. Two revision rounds.",
  "Build me a 5-page website for €3,000. €750 after design, €1,500 after development, €750 after launch.",
  "Looking for a developer to build an internal analytics dashboard over about 6 weeks. Budget $8,000, paid across discovery, build, and rollout.",
];

function emptyDraft(role: "client" | "provider"): DraftState {
  return {
    title: "",
    description: "",
    totalAmount: 0,
    asset: "USDC",
    counterpartyAddress: "",
    counterpartyHandle: "",
    role,
    expectedCompletionAt: null,
    rules: { ...DEFAULT_AGREEMENT_RULES },
    milestones: [],
    issues: [],
    engine: null,
    rationale: "",
  };
}

export function AgreementBuilder({
  userAddress, userName,
}: { userAddress: string | null; userName: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const reduced = useReducedMotion();

  const [mode, setMode] = React.useState<"choose" | "ai" | "build">("choose");
  const [step, setStep] = React.useState<StepId>("basics");
  const [draft, setDraft] = React.useState<DraftState>(() => emptyDraft("client"));
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const total = draft.totalAmount;
  const alloc = allocated(draft.milestones);
  const balanced = alloc === total && total > 0;

  const update = React.useCallback((patch: Partial<DraftState>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  // ------------------------------------------------------------- Persist

  const save = async () => {
    setErrors({});

    if (!balanced) {
      setErrors({ milestones: "Milestone amounts must equal the total agreement value." });
      setStep("milestones");
      return;
    }
    if (!draft.counterpartyAddress && !draft.counterpartyHandle) {
      setErrors({ counterparty: "Add the other party before creating the agreement." });
      setStep("basics");
      return;
    }

    setSaving(true);

    const payload = {
      role: draft.role,
      draft: {
        title: draft.title.trim(),
        description: draft.description.trim(),
        totalAmount: draft.totalAmount,
        asset: draft.asset,
        providerInviteAddress: draft.counterpartyAddress.trim() || null,
        providerHandle: draft.counterpartyHandle.trim() || null,
        expectedCompletionAt: draft.expectedCompletionAt,
        rules: draft.rules,
        milestones: draft.milestones.map((m) => ({
          title: m.title.trim(),
          description: m.description.trim(),
          amount: m.amount,
          dueAt: m.dueAt,
          deliverables: m.deliverables.filter((d) => d.trim()),
          acceptanceCriteria: m.acceptanceCriteria
            .filter((c) => c.text.trim())
            .map((c) => ({
              id: c.id,
              text: c.text.trim(),
              verification: "manual" as const,
              ambiguityFlag: c.ambiguityFlag,
            })),
          requiredEvidence: m.requiredEvidence,
        })),
      },
    };

    const result = await api.post<{ agreement: { id: string } }>("/api/agreements", payload);

    if (!result.ok) {
      const fields = (result.error.details?.issues ?? []) as Array<{ path: string; message: string }>;
      setErrors(Object.fromEntries(fields.map((f) => [f.path, f.message])));
      toast({ tone: "danger", title: "Could not create the agreement", body: result.error.message });
      setSaving(false);
      return;
    }

    trackEvent("agreement_created", { engine: draft.engine, milestoneCount: draft.milestones.length });
    toast({ tone: "settle", title: "Agreement created", body: "Review the terms, then send for signature." });
    router.push(`/app/agreements/${result.data.agreement.id}`);
  };

  // ------------------------------------------------------------- Mode choice

  if (mode === "choose") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="font-display text-4xl leading-tight">Create an agreement</h1>
        <p className="mt-3 max-w-lg text-base text-muted">
          Turn what you already agreed with someone into milestones, escrow, and a
          payment schedule.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("ai")}
            className="group rounded-xl border border-line bg-raised p-6 text-left transition-all hover:border-accent-border hover:shadow-md"
          >
            <span className="inline-flex size-10 items-center justify-center rounded-lg border border-accent-border bg-accent-soft text-accent">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-base font-semibold">Describe your project</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-subtle">
              Write it the way you would explain it to a colleague. Get milestones,
              amounts, deadlines, and acceptance criteria to edit.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent">
              Recommended
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMode("build")}
            className="group rounded-xl border border-line bg-raised p-6 text-left transition-all hover:border-line-strong hover:shadow-md"
          >
            <span className="inline-flex size-10 items-center justify-center rounded-lg border border-line bg-inset text-subtle">
              <PenLine className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-base font-semibold">Start from scratch</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-subtle">
              Build the agreement field by field. Best when you already know the
              exact milestones and amounts.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-muted">
              Build manually
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- AI mode

  if (mode === "ai") {
    return (
      <AIComposer
        userAddress={userAddress}
        onCancel={() => setMode("choose")}
        onGenerated={(generated, role, counterparty) => {
          setDraft({
            title: generated.title,
            description: generated.description,
            totalAmount: generated.totalAmount,
            asset: generated.asset,
            counterpartyAddress: counterparty.address,
            counterpartyHandle: counterparty.handle,
            role,
            expectedCompletionAt: generated.expectedCompletionAt,
            rules: generated.rules,
            milestones: generated.milestones.map((m) => ({
              localId: newLocalId(),
              title: m.title,
              description: m.description,
              amount: m.amount,
              dueAt: m.dueAt,
              deliverables: m.deliverables,
              acceptanceCriteria: m.acceptanceCriteria.map((c) => ({
                id: c.id, text: c.text, ambiguityFlag: c.ambiguityFlag,
              })),
              requiredEvidence: m.requiredEvidence,
            })),
            issues: generated.issues,
            engine: generated.engine,
            rationale: generated.rationale,
          });
          setMode("build");
          setStep("review");
        }}
      />
    );
  }

  // ------------------------------------------------------------- Builder

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {/* ---------- Stepper ---------- */}
      <nav aria-label="Progress" className="mb-6">
        <ol className="no-scrollbar flex items-center gap-1 overflow-x-auto">
          {STEPS.map((s, i) => {
            const state = i < stepIndex ? "done" : i === stepIndex ? "current" : "upcoming";
            return (
              <li key={s.id} className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => setStep(s.id)}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                    state === "current" ? "bg-inset font-medium text-fg" : "text-subtle hover:text-fg",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                      state === "done" && "border-settle bg-settle text-white",
                      state === "current" && "border-fg bg-fg text-inverse",
                      state === "upcoming" && "border-line text-faint",
                    )}
                    aria-hidden
                  >
                    {state === "done" ? <Check className="size-3" /> : i + 1}
                  </span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 ? (
                  <span className="mx-0.5 h-px w-3 bg-line sm:w-5" aria-hidden />
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ---------- Persistent allocation bar ---------- */}
      <div
        className={cn(
          "sticky top-16 z-20 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border px-4 py-2.5 backdrop-blur-md",
          balanced
            ? "border-line bg-raised/90"
            : total > 0
              ? "border-danger-border bg-danger-soft/90"
              : "border-line bg-raised/90",
        )}
        role="status"
        aria-live="polite"
      >
        <span className="text-xs text-subtle">
          Total contract value{" "}
          <strong className="font-semibold text-fg">
            {total > 0 ? formatMoney(total, draft.asset) : "--"}
          </strong>
        </span>
        <span className={cn("text-xs", balanced ? "text-subtle" : "text-danger")}>
          Allocated{" "}
          <strong className="font-semibold">
            {formatMoney(alloc, draft.asset)} / {formatMoney(total, draft.asset)}
          </strong>
        </span>
        {!balanced && total > 0 ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle className="size-3.5" aria-hidden />
            {alloc > total
              ? `${formatMoney(alloc - total, draft.asset)} over`
              : `${formatMoney(total - alloc, draft.asset)} unallocated`}
          </span>
        ) : total > 0 ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-settle">
            <Check className="size-3.5" aria-hidden />
            Balanced
          </span>
        ) : null}
      </div>

      {/* ---------- Engine note ---------- */}
      {draft.rationale && stepIndex >= 2 ? (
        <Alert
          tone="accent"
          className="mb-5"
          icon={<Sparkles className="size-4" />}
          title={draft.engine === "model" ? "Generated from your brief" : "Structured from your brief"}
        >
          {draft.rationale}
        </Alert>
      ) : null}

      {/* ---------- Steps ---------- */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {step === "basics" ? (
            <BasicsStep draft={draft} update={update} errors={errors} userName={userName} />
          ) : null}
          {step === "payment" ? <PaymentStep draft={draft} update={update} errors={errors} /> : null}
          {step === "milestones" ? (
            <MilestonesStep draft={draft} update={update} errors={errors} />
          ) : null}
          {step === "acceptance" ? <AcceptanceStep draft={draft} update={update} /> : null}
          {step === "review" ? (
            <ReviewStep draft={draft} update={update} balanced={balanced} errors={errors} />
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* ---------- Navigation ---------- */}
      <div className="mt-8 flex items-center gap-3">
        {stepIndex > 0 ? (
          <Button
            variant="ghost"
            icon={<ArrowLeft className="size-4" />}
            onClick={() => setStep(STEPS[stepIndex - 1].id)}
          >
            Back
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setMode("choose")}>Cancel</Button>
        )}

        <div className="ml-auto">
          {stepIndex < STEPS.length - 1 ? (
            <Button
              variant="primary"
              iconRight={<ArrowRight className="size-4" />}
              onClick={() => setStep(STEPS[stepIndex + 1].id)}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              loading={saving}
              disabled={!balanced}
              iconRight={<ArrowRight className="size-4" />}
              onClick={save}
            >
              Create agreement
            </Button>
          )}
        </div>
      </div>

      {!balanced && stepIndex === STEPS.length - 1 && total > 0 ? (
        <p className="mt-3 text-right text-xs text-danger">
          Milestone amounts must equal the total agreement value before the agreement can be created.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI composer
// ---------------------------------------------------------------------------

function AIComposer({
  userAddress, onCancel, onGenerated,
}: {
  userAddress: string | null;
  onCancel: () => void;
  onGenerated: (
    generated: GeneratedAgreement,
    role: "client" | "provider",
    counterparty: { address: string; handle: string },
  ) => void;
}) {
  const { toast } = useToast();
  const reduced = useReducedMotion();

  const [brief, setBrief] = React.useState("");
  const [role, setRole] = React.useState<"client" | "provider">("client");
  const [asset, setAsset] = React.useState("USDC");
  const [budget, setBudget] = React.useState("");
  const [counterpartyAddress, setCounterpartyAddress] = React.useState("");
  const [counterpartyHandle, setCounterpartyHandle] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [preview, setPreview] = React.useState<GeneratedAgreement | null>(null);

  const generate = async () => {
    if (brief.trim().length < 20) {
      toast({ tone: "attn", title: "Add a little more detail", body: "Describe the work, the budget, and the stages." });
      return;
    }
    setGenerating(true);

    let totalAmountHint: number | null = null;
    if (budget.trim()) {
      try { totalAmountHint = parseMoney(budget, asset); } catch { totalAmountHint = null; }
    }

    const result = await api.post<{ generated: GeneratedAgreement }>("/api/ai/generate", {
      brief: brief.trim(), asset, totalAmountHint, roleHint: role,
    });

    if (!result.ok) {
      toast({ tone: "danger", title: "Could not generate the agreement", body: result.error.message });
      setGenerating(false);
      return;
    }

    setPreview(result.data.generated);
    setGenerating(false);
  };

  const accept = () => {
    if (!preview) return;
    onGenerated(preview, role, {
      address: counterpartyAddress.trim(),
      handle: counterpartyHandle.trim(),
    });
  };

  const blocking = preview?.issues.filter((i) => i.severity === "blocking").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </button>
      </div>

      <h1 className="font-display text-3xl leading-tight">Describe your project</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Write it however you would explain it to a colleague. Everything generated is
        editable, and nothing is created until you say so.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* ---------- Left: the brief ---------- */}
        <div className="space-y-4">
          <Card>
            <div className="border-b border-line-subtle px-4 py-3">
              <h2 className="text-xs font-medium text-subtle">Your brief</h2>
            </div>
            <div className="p-4">
              <Field label="Describe the work" htmlFor="brief" aside={`${brief.length}/6000`}>
                <Textarea
                  id="brief"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="I need a designer to create a brand identity for my startup. The total budget is $2,500. I want a moodboard first, then logo concepts, then final brand files. Two revision rounds."
                  rows={8}
                  maxLength={6000}
                  className="text-sm leading-relaxed"
                />
              </Field>

              {brief.length === 0 ? (
                <div className="mt-3">
                  <p className="mb-2 text-2xs text-faint">Try one of these</p>
                  <div className="space-y-1.5">
                    {EXAMPLE_BRIEFS.map((example, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setBrief(example)}
                        className="w-full rounded-lg border border-line px-3 py-2 text-left text-xs leading-relaxed text-subtle transition-colors hover:border-line-strong hover:bg-inset hover:text-fg"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="border-b border-line-subtle px-4 py-3">
              <h2 className="text-xs font-medium text-subtle">Details</h2>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Your role" htmlFor="role">
                  <Select id="role" value={role} onChange={(e) => setRole(e.target.value as "client" | "provider")}>
                    <option value="client">I am hiring (client)</option>
                    <option value="provider">I am delivering (provider)</option>
                  </Select>
                </Field>

                <Field label="Settlement asset" htmlFor="asset">
                  <Select id="asset" value={asset} onChange={(e) => setAsset(e.target.value)}>
                    {Object.values(ASSETS).map((a) => (
                      <option key={a.symbol} value={a.symbol}>{a.symbol} — {a.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Total budget"
                htmlFor="budget"
                hint="Optional. Leave blank and it will be read from your brief."
              >
                <Input
                  id="budget"
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="2500"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={role === "client" ? "Provider handle" : "Client handle"}
                  htmlFor="cp-handle"
                  hint="If they already use VerseFlow."
                >
                  <Input
                    id="cp-handle"
                    value={counterpartyHandle}
                    onChange={(e) => setCounterpartyHandle(e.target.value)}
                    placeholder="alexmorgan"
                  />
                </Field>

                <Field
                  label="Or wallet address"
                  htmlFor="cp-address"
                  hint="They join by connecting this address."
                >
                  <Input
                    id="cp-address"
                    value={counterpartyAddress}
                    onChange={(e) => setCounterpartyAddress(e.target.value)}
                    placeholder="0x…"
                    className="font-mono text-xs"
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Button
            variant="primary"
            size="lg"
            fullWidth
            icon={<Sparkles className="size-4" />}
            loading={generating}
            loadingText="Structuring your agreement…"
            onClick={generate}
          >
            Generate agreement
          </Button>
        </div>

        {/* ---------- Right: generated agreement ---------- */}
        <div className="space-y-4">
          <Card className="min-h-64">
            <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-3">
              <Sparkles className="size-3.5 text-accent" aria-hidden />
              <h2 className="text-xs font-medium text-subtle">Generated agreement</h2>
              {preview ? (
                <Badge tone="neutral" className="ml-auto">
                  {preview.engine === "model" ? "Language model" : "Rule engine"}
                </Badge>
              ) : null}
            </div>

            {generating ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-20 w-full" />
                ))}
              </div>
            ) : !preview ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
                <Wand2 className="size-5 text-faint" aria-hidden />
                <p className="mt-3 text-sm text-subtle">
                  Your structured agreement will appear here.
                </p>
                <p className="mt-1 text-2xs text-faint">
                  Milestones, amounts, deadlines, acceptance criteria, and evidence requirements.
                </p>
              </div>
            ) : (
              <div className="p-4">
                <h3 className="text-base font-semibold">{preview.title}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                  <span className="font-semibold text-fg">
                    {formatMoney(preview.totalAmount, preview.asset)}
                  </span>
                  <span>{preview.milestones.length} milestones</span>
                  <span>{preview.rules.revisionRounds} revision rounds</span>
                </div>

                <ul className="mt-4 space-y-2">
                  {preview.milestones.map((m, i) => (
                    <motion.li
                      key={i}
                      initial={reduced ? false : { opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: i * 0.06 }}
                      className="rounded-lg border border-line-subtle bg-inset p-3"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium">{m.title}</p>
                        <span className="shrink-0 text-sm font-semibold tabular">
                          {formatMoney(m.amount, preview.asset)}
                        </span>
                      </div>
                      {m.acceptanceCriteria.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {m.acceptanceCriteria.slice(0, 3).map((c) => (
                            <li key={c.id} className="flex items-start gap-1.5 text-2xs text-subtle">
                              <Check className="mt-0.5 size-2.5 shrink-0 text-settle" aria-hidden />
                              {c.text}
                            </li>
                          ))}
                          {m.acceptanceCriteria.length > 3 ? (
                            <li className="pl-4 text-2xs text-faint">
                              +{m.acceptanceCriteria.length - 3} more
                            </li>
                          ) : null}
                        </ul>
                      ) : null}
                      {m.requiredEvidence.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {m.requiredEvidence.map((k) => (
                            <span
                              key={k}
                              className="rounded border border-line bg-raised px-1.5 py-0.5 text-[10px] text-faint"
                            >
                              {EVIDENCE_META[k as EvidenceKind].short}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </motion.li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {preview && preview.issues.length > 0 ? (
            <Alert
              tone={blocking > 0 ? "danger" : "attn"}
              title={`${preview.issues.length} item${preview.issues.length === 1 ? "" : "s"} need${preview.issues.length === 1 ? "s" : ""} your attention`}
            >
              You will be able to accept, edit, or reject each one on the next screen.
            </Alert>
          ) : null}

          {preview ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              iconRight={<ArrowRight className="size-4" />}
              onClick={accept}
            >
              Review and edit
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function BasicsStep({
  draft, update, errors, userName,
}: {
  draft: DraftState;
  update: (patch: Partial<DraftState>) => void;
  errors: Record<string, string>;
  userName: string;
}) {
  return (
    <Card>
      <div className="border-b border-line-subtle px-5 py-3.5">
        <h2 className="text-sm font-semibold">Basics</h2>
        <p className="mt-0.5 text-2xs text-subtle">Who is involved and what the work is.</p>
      </div>
      <div className="space-y-5 p-5">
        <Field label="Agreement title" htmlFor="b-title" required error={errors.title}>
          <Input
            id="b-title"
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="E-commerce Website Redesign"
            maxLength={160}
          />
        </Field>

        <Field
          label="Description"
          htmlFor="b-desc"
          hint="What is being delivered, and any context that matters."
          aside={`${draft.description.length}/4000`}
        >
          <Textarea
            id="b-desc"
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            rows={4}
            maxLength={4000}
          />
        </Field>

        <Field label="Your role" htmlFor="b-role">
          <Select
            id="b-role"
            value={draft.role}
            onChange={(e) => update({ role: e.target.value as "client" | "provider" })}
          >
            <option value="client">{userName} is hiring (client)</option>
            <option value="provider">{userName} is delivering (provider)</option>
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={draft.role === "client" ? "Provider handle" : "Client handle"}
            htmlFor="b-handle"
            error={errors.counterparty}
            hint="If they already use VerseFlow."
          >
            <Input
              id="b-handle"
              value={draft.counterpartyHandle}
              onChange={(e) => update({ counterpartyHandle: e.target.value })}
              placeholder="alexmorgan"
            />
          </Field>

          <Field label="Or wallet address" htmlFor="b-address" hint="They join by connecting this address.">
            <Input
              id="b-address"
              value={draft.counterpartyAddress}
              onChange={(e) => update({ counterpartyAddress: e.target.value })}
              placeholder="0x…"
              className="font-mono text-xs"
            />
          </Field>
        </div>

        <Field
          label="Expected completion"
          htmlFor="b-completion"
          hint="Optional. No milestone can be due after this date."
        >
          <Input
            id="b-completion"
            type="date"
            value={draft.expectedCompletionAt ? draft.expectedCompletionAt.slice(0, 10) : ""}
            onChange={(e) =>
              update({
                expectedCompletionAt: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
          />
        </Field>
      </div>
    </Card>
  );
}

function PaymentStep({
  draft, update, errors,
}: {
  draft: DraftState;
  update: (patch: Partial<DraftState>) => void;
  errors: Record<string, string>;
}) {
  const [raw, setRaw] = React.useState(
    draft.totalAmount > 0 ? (draft.totalAmount / 100).toFixed(2) : "",
  );
  const [amountError, setAmountError] = React.useState<string | null>(null);

  const commit = (value: string) => {
    setRaw(value);
    if (!value.trim()) {
      update({ totalAmount: 0 });
      setAmountError(null);
      return;
    }
    try {
      update({ totalAmount: parseMoney(value, draft.asset) });
      setAmountError(null);
    } catch (e) {
      setAmountError(e instanceof Error ? e.message : "Enter a valid amount.");
    }
  };

  return (
    <Card>
      <div className="border-b border-line-subtle px-5 py-3.5">
        <h2 className="text-sm font-semibold">Payment</h2>
        <p className="mt-0.5 text-2xs text-subtle">
          The full amount is locked in escrow before work starts.
        </p>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Total contract value"
            htmlFor="p-total"
            required
            error={amountError ?? errors.totalAmount}
          >
            <Input
              id="p-total"
              inputMode="decimal"
              value={raw}
              onChange={(e) => commit(e.target.value)}
              placeholder="3000.00"
            />
          </Field>

          <Field label="Settlement asset" htmlFor="p-asset">
            <Select
              id="p-asset"
              value={draft.asset}
              onChange={(e) => update({ asset: e.target.value })}
            >
              {Object.values(ASSETS).map((a) => (
                <option key={a.symbol} value={a.symbol}>{a.symbol} — {a.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Alert tone="locked" icon={<Info className="size-4" />} title="How the money moves">
          The client locks {draft.totalAmount > 0 ? formatMoney(draft.totalAmount, draft.asset) : "the full value"}{" "}
          in escrow. Each milestone can only release the amount allocated to it, and
          releases require the client to authorize them.
        </Alert>
      </div>
    </Card>
  );
}

function MilestonesStep({
  draft, update, errors,
}: {
  draft: DraftState;
  update: (patch: Partial<DraftState>) => void;
  errors: Record<string, string>;
}) {
  const setMilestones = (milestones: DraftMilestone[]) => update({ milestones });

  const add = () => {
    setMilestones([
      ...draft.milestones,
      {
        localId: newLocalId(),
        title: `Milestone ${draft.milestones.length + 1}`,
        description: "",
        amount: 0,
        dueAt: null,
        deliverables: [],
        acceptanceCriteria: [],
        requiredEvidence: [],
      },
    ]);
  };

  /** Split the contract value evenly, losing nothing to rounding. */
  const distributeEvenly = () => {
    if (draft.milestones.length === 0 || draft.totalAmount <= 0) return;
    const parts = splitEvenly(draft.totalAmount, draft.milestones.length);
    setMilestones(draft.milestones.map((m, i) => ({ ...m, amount: parts[i] })));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.milestones.length) return;
    const next = [...draft.milestones];
    [next[index], next[target]] = [next[target], next[index]];
    setMilestones(next);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">Milestones</h2>
            <p className="mt-0.5 text-2xs text-subtle">
              Each one is a programmable payment with its own conditions.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={distributeEvenly} disabled={draft.milestones.length === 0}>
              Split evenly
            </Button>
            <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={add}>
              Add milestone
            </Button>
          </div>
        </div>

        {draft.milestones.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-subtle">No milestones yet.</p>
            <Button className="mt-4" variant="secondary" icon={<Plus className="size-3.5" />} onClick={add}>
              Add the first milestone
            </Button>
          </div>
        ) : null}
      </Card>

      {errors.milestones ? <Alert tone="danger" title={errors.milestones} /> : null}

      <div className="space-y-3">
        {draft.milestones.map((milestone, index) => (
          <MilestoneEditor
            key={milestone.localId}
            milestone={milestone}
            index={index}
            total={draft.milestones.length}
            asset={draft.asset}
            onChange={(patch) =>
              setMilestones(
                draft.milestones.map((m) => (m.localId === milestone.localId ? { ...m, ...patch } : m)),
              )
            }
            onRemove={() =>
              setMilestones(draft.milestones.filter((m) => m.localId !== milestone.localId))
            }
            onMove={(direction) => move(index, direction)}
          />
        ))}
      </div>
    </div>
  );
}

function AcceptanceStep({
  draft, update,
}: {
  draft: DraftState;
  update: (patch: Partial<DraftState>) => void;
}) {
  const setRule = <K extends keyof DraftState["rules"]>(key: K, value: DraftState["rules"][K]) => {
    update({ rules: { ...draft.rules, [key]: value } });
  };

  const [newTerm, setNewTerm] = React.useState("");

  return (
    <div className="space-y-4">
      <Card>
        <div className="border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold">Acceptance and review</h2>
          <p className="mt-0.5 text-2xs text-subtle">
            The rules that govern approval, revisions, and disputes.
          </p>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field
            label="Revision rounds per milestone"
            htmlFor="a-revisions"
            hint="Protects the client, capped so it cannot be used indefinitely."
          >
            <Select
              id="a-revisions"
              value={String(draft.rules.revisionRounds)}
              onChange={(e) => setRule("revisionRounds", Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n} round{n === 1 ? "" : "s"}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Approval window"
            htmlFor="a-window"
            hint="How long the client has to respond after a submission."
          >
            <Select
              id="a-window"
              value={String(draft.rules.approvalWindowHours)}
              onChange={(e) => setRule("approvalWindowHours", Number(e.target.value))}
            >
              {[24, 48, 72, 120, 168].map((h) => (
                <option key={h} value={h}>{h} hours</option>
              ))}
            </Select>
          </Field>

          <Field label="Dispute window" htmlFor="a-dispute" hint="How long a dispute can be opened after approval.">
            <Select
              id="a-dispute"
              value={String(draft.rules.disputeWindowHours)}
              onChange={(e) => setRule("disputeWindowHours", Number(e.target.value))}
            >
              {[72, 120, 168, 336, 720].map((h) => (
                <option key={h} value={h}>{h} hours</option>
              ))}
            </Select>
          </Field>

          <Field label="Late delivery policy" htmlFor="a-late" hint="Optional. Carried in the signed terms.">
            <Input
              id="a-late"
              value={draft.rules.lateDeliveryPolicy ?? ""}
              onChange={(e) => setRule("lateDeliveryPolicy", e.target.value || null)}
              placeholder="Deadlines may be extended by mutual agreement in writing."
            />
          </Field>
        </div>

        <div className="space-y-1 border-t border-line-subtle px-5 py-2">
          <ToggleRow
            label="Require evidence for each milestone"
            description="A milestone cannot be submitted without at least one evidence item."
            checked={draft.rules.evidenceRequired}
            onChange={(v) => setRule("evidenceRequired", v)}
          />
          <ToggleRow
            label="Allow partial release"
            description="The client can release part of a milestone with a stated reason."
            checked={draft.rules.partialReleaseAllowed}
            onChange={(v) => setRule("partialReleaseAllowed", v)}
          />
        </div>
      </Card>

      <Card>
        <div className="border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold">Additional terms</h2>
          <p className="mt-0.5 text-2xs text-subtle">
            Anything else both parties are agreeing to. Included in the signed hash.
          </p>
        </div>
        <div className="p-5">
          {draft.rules.additionalTerms.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {draft.rules.additionalTerms.map((term, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-line bg-inset p-3">
                  <span className="flex-1 text-xs leading-relaxed">{term}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setRule("additionalTerms", draft.rules.additionalTerms.filter((_, x) => x !== i))
                    }
                    aria-label="Remove term"
                    className="rounded p-1 text-faint transition-colors hover:text-danger"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex gap-2">
            <Input
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTerm.trim()) {
                  e.preventDefault();
                  setRule("additionalTerms", [...draft.rules.additionalTerms, newTerm.trim()]);
                  setNewTerm("");
                }
              }}
              placeholder="Source files are transferred on final payment."
              aria-label="Additional term"
              maxLength={500}
            />
            <Button
              variant="secondary"
              disabled={!newTerm.trim()}
              onClick={() => {
                setRule("additionalTerms", [...draft.rules.additionalTerms, newTerm.trim()]);
                setNewTerm("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ReviewStep({
  draft, update, balanced, errors,
}: {
  draft: DraftState;
  update: (patch: Partial<DraftState>) => void;
  balanced: boolean;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      {draft.issues.length > 0 ? (
        <IssuePanel
          issues={draft.issues}
          draft={draft}
          onApply={(nextDraft, resolvedId) =>
            update({
              ...nextDraft,
              issues: draft.issues.filter((i) => i.id !== resolvedId),
            })
          }
          onDismiss={(issueId) => update({ issues: draft.issues.filter((i) => i.id !== issueId) })}
        />
      ) : null}

      <Card>
        <div className="border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold">Review</h2>
          <p className="mt-0.5 text-2xs text-subtle">
            Both parties will sign exactly these terms.
          </p>
        </div>

        <div className="p-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="text-2xs text-faint">Title</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold">{draft.title || "Untitled"}</dd>
            </div>
            <div>
              <dt className="text-2xs text-faint">Contract value</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular">
                {formatMoney(draft.totalAmount, draft.asset)}
              </dd>
            </div>
            <div>
              <dt className="text-2xs text-faint">Milestones</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular">{draft.milestones.length}</dd>
            </div>
            <div>
              <dt className="text-2xs text-faint">Counterparty</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold">
                {draft.counterpartyHandle || draft.counterpartyAddress || "Not set"}
              </dd>
            </div>
          </dl>

          {errors.counterparty ? (
            <Alert tone="danger" className="mt-4" title={errors.counterparty} />
          ) : null}

          <section className="mt-6">
            <h3 className="text-2xs font-medium uppercase tracking-wider text-faint">
              Payment schedule
            </h3>
            <ul className="mt-2.5 divide-y divide-line-subtle rounded-lg border border-line">
              {draft.milestones.map((m) => (
                <li key={m.localId} className="flex items-baseline gap-3 px-3.5 py-2.5">
                  <span className="text-sm font-semibold tabular">
                    {formatMoney(m.amount, draft.asset)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{m.title}</span>
                  <span className="shrink-0 text-2xs text-faint">
                    {m.acceptanceCriteria.length} criteria
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6">
            <h3 className="text-2xs font-medium uppercase tracking-wider text-faint">
              Agreement rules
            </h3>
            <ul className="mt-2.5 space-y-1.5">
              {[
                `${draft.rules.revisionRounds} revision round${draft.rules.revisionRounds === 1 ? "" : "s"} per milestone`,
                `${draft.rules.approvalWindowHours}-hour approval window`,
                draft.rules.evidenceRequired ? "Evidence required for each milestone" : "Evidence optional",
                `Disputes must be opened within ${draft.rules.disputeWindowHours} hours`,
                draft.rules.partialReleaseAllowed ? "Partial release permitted with a reason" : "Partial release not permitted",
                ...draft.rules.additionalTerms,
              ].map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="text-muted">{rule}</span>
                </li>
              ))}
            </ul>
          </section>

          {!balanced ? (
            <Alert tone="danger" className="mt-6" title="Milestone amounts do not match the total">
              Allocated {formatMoney(allocated(draft.milestones), draft.asset)} of{" "}
              {formatMoney(draft.totalAmount, draft.asset)}. Fix this before creating the agreement.
            </Alert>
          ) : (
            <Alert tone="settle" className="mt-6" title="Ready to create">
              Once created, you can send it for signature. Nothing is locked or funded until
              both parties sign.
            </Alert>
          )}
        </div>
      </Card>
    </div>
  );
}

function ToggleRow({
  label, description, checked, onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-subtle">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-accent" : "bg-line-strong",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-[1.375rem]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
