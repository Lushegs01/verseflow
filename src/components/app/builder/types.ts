import type { EvidenceKind, AgreementRules } from "@/lib/domain/types";
import type { AgreementIssue } from "@/lib/ai/agreement-engine";

/** Editable milestone shape used inside the builder. */
export interface DraftMilestone {
  localId: string;
  title: string;
  description: string;
  /** Minor units. */
  amount: number;
  dueAt: string | null;
  deliverables: string[];
  acceptanceCriteria: Array<{ id: string; text: string; ambiguityFlag: string | null }>;
  requiredEvidence: EvidenceKind[];
}

export interface DraftState {
  title: string;
  description: string;
  totalAmount: number;
  asset: string;
  counterpartyAddress: string;
  counterpartyHandle: string;
  role: "client" | "provider";
  expectedCompletionAt: string | null;
  rules: AgreementRules;
  milestones: DraftMilestone[];
  /** Advisory findings from the agreement engine. */
  issues: AgreementIssue[];
  engine: "model" | "rules" | null;
  rationale: string;
}

export const STEPS = [
  { id: "basics", label: "Basics" },
  { id: "payment", label: "Payment" },
  { id: "milestones", label: "Milestones" },
  { id: "acceptance", label: "Acceptance" },
  { id: "review", label: "Review" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export function newLocalId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Sum of milestone allocations, in minor units. */
export function allocated(milestones: DraftMilestone[]): number {
  return milestones.reduce((a, m) => a + m.amount, 0);
}
