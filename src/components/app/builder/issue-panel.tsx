"use client";

/**
 * Agreement issues.
 *
 * Every AI-suggested change is a decision the user makes explicitly: accept, edit,
 * or reject. Nothing is applied silently, and rejecting is as easy as accepting --
 * these are suggestions, not corrections.
 */

import * as React from "react";
import {
  AlertTriangle, AlertCircle, Lightbulb, Check, Pencil, X, ChevronDown,
} from "lucide-react";
import { Card, Button, Badge, Input, cn, type BadgeTone } from "@/components/ui";
import { splitEvenly } from "@/lib/domain/money";
import type { AgreementIssue, IssuePatch } from "@/lib/ai/agreement-engine";
import type { DraftState } from "./types";

const SEVERITY: Record<
  AgreementIssue["severity"],
  { label: string; tone: BadgeTone; icon: React.ReactNode }
> = {
  blocking: { label: "Blocking", tone: "danger", icon: <AlertCircle className="size-3.5" /> },
  attention: { label: "Needs attention", tone: "attn", icon: <AlertTriangle className="size-3.5" /> },
  suggestion: { label: "Suggestion", tone: "neutral", icon: <Lightbulb className="size-3.5" /> },
};

export function IssuePanel({
  issues, draft, onApply, onDismiss,
}: {
  issues: AgreementIssue[];
  draft: DraftState;
  onApply: (nextDraft: Partial<DraftState>, resolvedIssueId: string) => void;
  onDismiss: (issueId: string) => void;
}) {
  const [open, setOpen] = React.useState(true);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");

  const blocking = issues.filter((i) => i.severity === "blocking").length;

  /** Apply a patch to the draft. The user sees the result before saving anything. */
  const applyPatch = (issue: AgreementIssue, patch: IssuePatch, overrideText?: string) => {
    const milestones = draft.milestones.map((m) => ({
      ...m,
      acceptanceCriteria: m.acceptanceCriteria.map((c) => ({ ...c })),
      deliverables: [...m.deliverables],
      requiredEvidence: [...m.requiredEvidence],
    }));

    switch (patch.op) {
      case "rebalance_amounts": {
        if (milestones.length === 0) break;
        const parts = splitEvenly(draft.totalAmount, milestones.length);
        milestones.forEach((m, i) => { m.amount = parts[i]; });
        onApply({ milestones }, issue.id);
        return;
      }
      case "add_criterion": {
        const target = milestones[patch.milestoneIndex];
        if (target) {
          target.acceptanceCriteria.push({
            id: Math.random().toString(36).slice(2),
            text: overrideText ?? patch.text,
            ambiguityFlag: null,
          });
        }
        onApply({ milestones }, issue.id);
        return;
      }
      case "set_criterion_text": {
        const target = milestones[patch.milestoneIndex];
        const criterion = target?.acceptanceCriteria.find((c) => c.id === patch.criterionId);
        if (criterion) criterion.text = overrideText ?? patch.text;
        onApply({ milestones }, issue.id);
        return;
      }
      case "set_due_date": {
        const target = milestones[patch.milestoneIndex];
        if (target) target.dueAt = patch.dueAt;
        onApply({ milestones }, issue.id);
        return;
      }
      case "add_evidence_requirement": {
        const target = milestones[patch.milestoneIndex];
        if (target && !target.requiredEvidence.includes(patch.kind)) {
          target.requiredEvidence.push(patch.kind);
        }
        onApply({ milestones }, issue.id);
        return;
      }
      case "set_revision_rounds": {
        onApply({ rules: { ...draft.rules, revisionRounds: patch.rounds } }, issue.id);
        return;
      }
    }
  };

  /** Rewriting an ambiguous criterion needs the criterion, which the issue points at. */
  const startEdit = (issue: AgreementIssue) => {
    setEditing(issue.id);
    if (issue.target.kind === "criterion" && issue.target.index !== undefined) {
      const milestone = draft.milestones[issue.target.index];
      const criterion = milestone?.acceptanceCriteria.find((c) => c.id === issue.target.criterionId);
      setEditValue(criterion?.text ?? "");
    } else if (issue.patch?.op === "add_criterion") {
      setEditValue(issue.patch.text);
    } else {
      setEditValue("");
    }
  };

  const commitEdit = (issue: AgreementIssue) => {
    if (!editValue.trim()) return;

    if (issue.target.kind === "criterion" && issue.target.index !== undefined && issue.target.criterionId) {
      applyPatch(
        issue,
        {
          op: "set_criterion_text",
          milestoneIndex: issue.target.index,
          criterionId: issue.target.criterionId,
          text: editValue.trim(),
        },
        editValue.trim(),
      );
    } else if (issue.patch) {
      applyPatch(issue, issue.patch, editValue.trim());
    }

    setEditing(null);
    setEditValue("");
  };

  if (issues.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 border-b border-line-subtle px-5 py-3.5 text-left transition-colors hover:bg-inset"
      >
        <AlertTriangle
          className={cn("size-4 shrink-0", blocking > 0 ? "text-danger" : "text-attn")}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {issues.length} item{issues.length === 1 ? "" : "s"} to review
          </h2>
          <p className="mt-0.5 text-2xs text-subtle">
            {blocking > 0
              ? `${blocking} must be fixed before this agreement can be funded.`
              : "Suggestions to make the terms harder to misread. All optional."}
          </p>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-faint transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open ? (
        <ul className="divide-y divide-line-subtle">
          {issues.map((issue) => {
            const severity = SEVERITY[issue.severity];
            const isEditing = editing === issue.id;

            return (
              <li key={issue.id} className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0",
                      issue.severity === "blocking" ? "text-danger" :
                      issue.severity === "attention" ? "text-attn" : "text-faint",
                    )}
                    aria-hidden
                  >
                    {severity.icon}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{issue.title}</h3>
                      <Badge tone={severity.tone}>{severity.label}</Badge>
                    </div>

                    <p className="mt-1 text-xs leading-relaxed text-muted">{issue.detail}</p>

                    {issue.suggestion ? (
                      <div className="mt-2.5 rounded-lg border border-accent-border bg-accent-soft p-3">
                        <p className="text-2xs font-medium text-accent">Suggested</p>
                        <p className="mt-0.5 text-xs leading-relaxed">{issue.suggestion}</p>
                      </div>
                    ) : null}

                    {isEditing ? (
                      <div className="mt-3 space-y-2">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(issue); } }}
                          aria-label="Edit the suggested text"
                          autoFocus
                          className="text-xs"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="primary" onClick={() => commitEdit(issue)}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {issue.patch ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Check className="size-3" />}
                            onClick={() => applyPatch(issue, issue.patch!)}
                          >
                            Accept suggestion
                          </Button>
                        ) : null}

                        {issue.target.kind === "criterion" || issue.patch?.op === "add_criterion" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Pencil className="size-3" />}
                            onClick={() => startEdit(issue)}
                          >
                            Edit
                          </Button>
                        ) : null}

                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<X className="size-3" />}
                          onClick={() => onDismiss(issue.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
