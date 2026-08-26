"use client";

/**
 * Milestone editor.
 *
 * A milestone is a programmable payment, so the card is laid out like one:
 * amount and deadline at the top, then what is being delivered, then what counts
 * as acceptance, then what evidence proves it.
 */

import * as React from "react";
import {
  Trash2, Plus, X, ChevronUp, ChevronDown, AlertTriangle, GripVertical,
} from "lucide-react";
import { Button, Field, Input, Textarea, cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/domain/money";
import { EVIDENCE_META } from "@/lib/utils/format";
import type { EvidenceKind } from "@/lib/domain/types";
import type { DraftMilestone } from "./types";

/** Words that make a criterion unenforceable. Mirrors the server-side detector. */
const VAGUE = /\b(professional|modern|clean|nice|good|beautiful|polished|premium|some|several|a few|various|multiple|etc|as needed|if necessary)\b/i;

export function MilestoneEditor({
  milestone, index, total, asset, onChange, onRemove, onMove,
}: {
  milestone: DraftMilestone;
  index: number;
  total: number;
  asset: string;
  onChange: (patch: Partial<DraftMilestone>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [amountRaw, setAmountRaw] = React.useState(
    milestone.amount > 0 ? (milestone.amount / 100).toFixed(2) : "",
  );
  const [amountError, setAmountError] = React.useState<string | null>(null);
  const [newDeliverable, setNewDeliverable] = React.useState("");
  const [newCriterion, setNewCriterion] = React.useState("");

  const commitAmount = (value: string) => {
    setAmountRaw(value);
    if (!value.trim()) {
      onChange({ amount: 0 });
      setAmountError(null);
      return;
    }
    try {
      onChange({ amount: parseMoney(value, asset) });
      setAmountError(null);
    } catch (e) {
      setAmountError(e instanceof Error ? e.message : "Enter a valid amount.");
    }
  };

  const toggleEvidence = (kind: EvidenceKind) => {
    onChange({
      requiredEvidence: milestone.requiredEvidence.includes(kind)
        ? milestone.requiredEvidence.filter((k) => k !== kind)
        : [...milestone.requiredEvidence, kind],
    });
  };

  const addDeliverable = () => {
    if (!newDeliverable.trim()) return;
    onChange({ deliverables: [...milestone.deliverables, newDeliverable.trim()] });
    setNewDeliverable("");
  };

  const addCriterion = () => {
    if (!newCriterion.trim()) return;
    onChange({
      acceptanceCriteria: [
        ...milestone.acceptanceCriteria,
        { id: Math.random().toString(36).slice(2), text: newCriterion.trim(), ambiguityFlag: null },
      ],
    });
    setNewCriterion("");
  };

  return (
    <div className="rounded-xl border border-line bg-raised">
      {/* ---------- Header ---------- */}
      <div className="flex items-start gap-3 border-b border-line-subtle p-4">
        <div className="flex shrink-0 flex-col gap-0.5 pt-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move ${milestone.title} up`}
            className="rounded p-0.5 text-faint transition-colors hover:bg-inset hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <GripVertical className="size-3.5 text-faint" aria-hidden />
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Move ${milestone.title} down`}
            className="rounded p-0.5 text-faint transition-colors hover:bg-inset hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs text-faint">Milestone {index + 1}</span>
          </div>

          <Field label="Title" htmlFor={`m-title-${milestone.localId}`} required>
            <Input
              id={`m-title-${milestone.localId}`}
              value={milestone.title}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="Development"
              maxLength={120}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Payment"
              htmlFor={`m-amount-${milestone.localId}`}
              required
              error={amountError}
              aside={milestone.amount > 0 ? formatMoney(milestone.amount, asset) : undefined}
            >
              <Input
                id={`m-amount-${milestone.localId}`}
                inputMode="decimal"
                value={amountRaw}
                onChange={(e) => commitAmount(e.target.value)}
                placeholder="1500.00"
              />
            </Field>

            <Field label="Due date" htmlFor={`m-due-${milestone.localId}`}>
              <Input
                id={`m-due-${milestone.localId}`}
                type="date"
                value={milestone.dueAt ? milestone.dueAt.slice(0, 10) : ""}
                onChange={(e) =>
                  onChange({ dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })
                }
              />
            </Field>
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${milestone.title}`}
          className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* ---------- Body ---------- */}
      <div className="space-y-5 p-4">
        <Field
          label="Description"
          htmlFor={`m-desc-${milestone.localId}`}
          hint="What happens during this milestone."
        >
          <Textarea
            id={`m-desc-${milestone.localId}`}
            value={milestone.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={2}
            maxLength={2000}
          />
        </Field>

        {/* --- Deliverables --- */}
        <section>
          <h4 className="text-xs font-medium text-muted">Deliverables</h4>
          {milestone.deliverables.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {milestone.deliverables.map((d, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-line bg-inset px-3 py-2">
                  <span className="flex-1 text-xs">{d}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ deliverables: milestone.deliverables.filter((_, x) => x !== i) })
                    }
                    aria-label={`Remove deliverable: ${d}`}
                    className="rounded p-0.5 text-faint transition-colors hover:text-danger"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-2 flex gap-2">
            <Input
              value={newDeliverable}
              onChange={(e) => setNewDeliverable(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDeliverable(); } }}
              placeholder="Responsive 5-page website"
              aria-label="New deliverable"
              className="h-9 text-xs"
            />
            <Button size="sm" variant="secondary" onClick={addDeliverable} disabled={!newDeliverable.trim()}>
              Add
            </Button>
          </div>
        </section>

        {/* --- Acceptance criteria --- */}
        <section>
          <h4 className="text-xs font-medium text-muted">Acceptance criteria</h4>
          <p className="mt-0.5 text-2xs text-faint">
            What must be true for this milestone to be approved. Objective beats subjective.
          </p>

          {milestone.acceptanceCriteria.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {milestone.acceptanceCriteria.map((c) => {
                const vague = VAGUE.test(c.text);
                return (
                  <li key={c.id}>
                    <div
                      className={cn(
                        "flex items-start gap-2 rounded-lg border px-3 py-2",
                        vague ? "border-attn-border bg-attn-soft" : "border-line bg-inset",
                      )}
                    >
                      <input
                        value={c.text}
                        onChange={(e) =>
                          onChange({
                            acceptanceCriteria: milestone.acceptanceCriteria.map((x) =>
                              x.id === c.id ? { ...x, text: e.target.value } : x,
                            ),
                          })
                        }
                        aria-label="Acceptance criterion"
                        className="flex-1 bg-transparent text-xs outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            acceptanceCriteria: milestone.acceptanceCriteria.filter((x) => x.id !== c.id),
                          })
                        }
                        aria-label="Remove criterion"
                        className="rounded p-0.5 text-faint transition-colors hover:text-danger"
                      >
                        <X className="size-3" />
                      </button>
                    </div>

                    {/* Live ambiguity hint as the user types. */}
                    {vague ? (
                      <p className="mt-1 flex items-start gap-1.5 pl-3 text-[10px] leading-relaxed text-attn">
                        <AlertTriangle className="mt-px size-2.5 shrink-0" aria-hidden />
                        This can be read more than one way. Prefer a checkable requirement,
                        for example a page count, a breakpoint, or a file format.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="mt-2 flex gap-2">
            <Input
              value={newCriterion}
              onChange={(e) => setNewCriterion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCriterion(); } }}
              placeholder="Responsive at 390px, 768px and 1440px"
              aria-label="New acceptance criterion"
              className="h-9 text-xs"
            />
            <Button size="sm" variant="secondary" onClick={addCriterion} disabled={!newCriterion.trim()}>
              Add
            </Button>
          </div>
        </section>

        {/* --- Evidence --- */}
        <section>
          <h4 className="text-xs font-medium text-muted">Required evidence</h4>
          <p className="mt-0.5 text-2xs text-faint">
            What the provider must attach when submitting this milestone.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(Object.keys(EVIDENCE_META) as EvidenceKind[])
              .filter((k) => k !== "note")
              .map((kind) => {
                const selected = milestone.requiredEvidence.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => toggleEvidence(kind)}
                    aria-pressed={selected}
                    className={cn(
                      "h-7 rounded-md border px-2.5 text-2xs font-medium transition-colors",
                      selected
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line text-subtle hover:border-line-strong hover:bg-inset",
                    )}
                  >
                    {EVIDENCE_META[kind].short}
                  </button>
                );
              })}
          </div>
        </section>
      </div>
    </div>
  );
}
