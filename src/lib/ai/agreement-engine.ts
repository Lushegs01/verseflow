/**
 * Agreement engine: natural language in, structured agreement out.
 *
 * Three responsibilities, kept separate so each can be reviewed independently:
 *   extract()          -- turn a brief into milestones, amounts, criteria, evidence
 *   detectIssues()     -- flag ambiguity, gaps, and arithmetic that does not add up
 *   suggestions        -- concrete, acceptable/editable/rejectable proposals
 *
 * Nothing here writes to an agreement. It produces a proposal the user reviews,
 * edits, and explicitly accepts. That separation -- AI recommendation vs. contract
 * rule vs. human approval -- is the product's core trust principle.
 */

import { z } from "zod";
import { requestJson, isModelConfigured } from "./provider";
import { newId } from "@/lib/domain/ids";
import { splitEvenly, parseMoney } from "@/lib/domain/money";
import type { EvidenceKind } from "@/lib/domain/types";
import { DEFAULT_AGREEMENT_RULES } from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface GeneratedMilestone {
  title: string;
  description: string;
  amount: number;
  dueAt: string | null;
  deliverables: string[];
  acceptanceCriteria: Array<{ id: string; text: string; verification: "evidence" | "manual"; ambiguityFlag: string | null }>;
  requiredEvidence: EvidenceKind[];
}

export type IssueSeverity = "blocking" | "attention" | "suggestion";

export interface AgreementIssue {
  id: string;
  severity: IssueSeverity;
  /** Where the issue lives, so the UI can jump to it. */
  target: { kind: "agreement" | "milestone" | "criterion"; index?: number; criterionId?: string };
  title: string;
  detail: string;
  /** A concrete replacement the user can accept in one click. */
  suggestion: string | null;
  /** Machine-applicable fix, when there is one. */
  patch: IssuePatch | null;
}

export type IssuePatch =
  | { op: "set_criterion_text"; milestoneIndex: number; criterionId: string; text: string }
  | { op: "add_criterion"; milestoneIndex: number; text: string }
  | { op: "set_due_date"; milestoneIndex: number; dueAt: string }
  | { op: "rebalance_amounts" }
  | { op: "add_evidence_requirement"; milestoneIndex: number; kind: EvidenceKind }
  | { op: "set_revision_rounds"; rounds: number };

export interface GeneratedAgreement {
  title: string;
  description: string;
  totalAmount: number;
  asset: string;
  expectedCompletionAt: string | null;
  rules: typeof DEFAULT_AGREEMENT_RULES;
  milestones: GeneratedMilestone[];
  issues: AgreementIssue[];
  engine: "model" | "rules";
  /** Short note explaining what the engine inferred and what it guessed. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function generateAgreement(input: {
  brief: string;
  asset: string;
  totalAmountHint: number | null;
}): Promise<GeneratedAgreement> {
  const fromModel = isModelConfigured() ? await generateWithModel(input) : null;
  const draft = fromModel ?? generateWithRules(input);

  // Issue detection runs over the final draft regardless of which engine produced
  // it, so the same guarantees hold either way.
  return { ...draft, issues: detectIssues(draft) };
}

// ---------------------------------------------------------------------------
// Model path
// ---------------------------------------------------------------------------

const modelSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().max(4000).default(""),
  totalAmount: z.number().nonnegative(),
  currency: z.string().optional(),
  expectedCompletionAt: z.string().nullable().default(null),
  revisionRounds: z.number().int().min(0).max(10).default(2),
  approvalWindowHours: z.number().int().min(1).max(720).default(72),
  rationale: z.string().max(1200).default(""),
  milestones: z
    .array(
      z.object({
        title: z.string().min(2).max(120),
        description: z.string().max(2000).default(""),
        amount: z.number().nonnegative(),
        dueAt: z.string().nullable().default(null),
        deliverables: z.array(z.string().max(300)).default([]),
        acceptanceCriteria: z.array(z.string().max(500)).default([]),
        requiredEvidence: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(20),
});

const SYSTEM_PROMPT = `You convert freelance and agency work briefs into structured, fundable escrow agreements.

Rules you must follow:
- Amounts are in MAJOR currency units (dollars/euros), as numbers. Milestone amounts MUST sum exactly to totalAmount.
- Write acceptance criteria that are objectively checkable. Prefer "responsive at 390px, 768px and 1440px" over "looks good on mobile".
- Only propose deadlines that the brief supports, or that follow obviously from a stated duration. Use ISO-8601 dates.
- requiredEvidence entries must come from: github_repo, github_commits, deployment_url, figma, document, file, screenshot, note, link.
- Do not invent scope the brief does not mention. If something important is missing, leave it out; it will be flagged for the user.
- Reply with JSON only, no prose.`;

async function generateWithModel(input: {
  brief: string;
  asset: string;
  totalAmountHint: number | null;
}): Promise<GeneratedAgreement | null> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await requestJson(
    {
      system: SYSTEM_PROMPT,
      prompt: `Today is ${today}. Settlement asset: ${input.asset}.
${input.totalAmountHint ? `The user already set a total budget of ${input.totalAmountHint / 100}.` : ""}

Brief:
"""
${input.brief}
"""

Return JSON with keys: title, description, totalAmount, currency, expectedCompletionAt, revisionRounds, approvalWindowHours, rationale, milestones[{title, description, amount, dueAt, deliverables[], acceptanceCriteria[], requiredEvidence[]}].`,
      maxTokens: 4096,
    },
    (value) => {
      const parsed = modelSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
  );

  if (!result) return null;

  const toMinor = (major: number) => Math.round(major * 100);
  let milestones: GeneratedMilestone[] = result.milestones.map((m) => ({
    title: m.title,
    description: m.description,
    amount: toMinor(m.amount),
    dueAt: normalizeDate(m.dueAt),
    deliverables: m.deliverables.filter(Boolean),
    acceptanceCriteria: m.acceptanceCriteria.filter(Boolean).map((text) => ({
      id: newId("mst"),
      text,
      verification: "manual" as const,
      ambiguityFlag: null,
    })),
    requiredEvidence: m.requiredEvidence.filter(isEvidenceKind),
  }));

  const total = input.totalAmountHint ?? toMinor(result.totalAmount);
  // The model can drift by a cent or two. Rather than surface a broken draft,
  // reconcile the rounding here and let the user see the final numbers.
  milestones = reconcileAmounts(milestones, total);

  return {
    title: result.title,
    description: result.description,
    totalAmount: total,
    asset: input.asset,
    expectedCompletionAt: normalizeDate(result.expectedCompletionAt) ?? inferCompletion(milestones),
    rules: {
      ...DEFAULT_AGREEMENT_RULES,
      revisionRounds: result.revisionRounds,
      approvalWindowHours: result.approvalWindowHours,
    },
    milestones,
    issues: [],
    engine: "model",
    rationale: result.rationale || "Generated from your brief.",
  };
}

// ---------------------------------------------------------------------------
// Deterministic rule path
// ---------------------------------------------------------------------------

/**
 * Phase vocabulary. Each entry knows the language that signals it, what it
 * usually delivers, how it is normally verified, and its typical share of budget.
 * This is what lets the no-API-key path produce a genuinely usable agreement
 * rather than a single generic milestone.
 */
interface PhaseTemplate {
  key: string;
  title: string;
  signals: RegExp;
  weight: number;
  deliverables: string[];
  criteria: string[];
  evidence: EvidenceKind[];
  description: string;
}

const PHASES: PhaseTemplate[] = [
  {
    key: "discovery",
    title: "Discovery & Requirements",
    signals: /\b(discovery|research|audit|requirements?|scoping|strategy|workshop|interview)\b/i,
    weight: 0.15,
    deliverables: ["Requirements document", "Agreed scope summary"],
    criteria: [
      "Requirements document delivered covering every in-scope feature",
      "Scope summary reviewed and confirmed in writing by both parties",
    ],
    evidence: ["document", "note"],
    description: "Align on scope, constraints, and success measures before work begins.",
  },
  {
    key: "moodboard",
    title: "Moodboard & Direction",
    signals: /\b(moodboard|mood board|direction|inspiration|concept board)\b/i,
    weight: 0.2,
    deliverables: ["Moodboard with 2+ visual directions", "Written rationale per direction"],
    criteria: [
      "At least two distinct visual directions presented",
      "Each direction includes colour, type, and imagery references",
    ],
    evidence: ["figma", "file", "screenshot"],
    description: "Establish visual direction before committing to detailed design.",
  },
  {
    key: "design",
    title: "Design",
    signals: /\b(design|ui|ux|mockup|wireframe|prototype|brand|identity|logo|visual)\b/i,
    weight: 0.25,
    deliverables: ["Design files for all agreed screens", "Desktop and mobile layouts"],
    criteria: [
      "All agreed screens designed at desktop and mobile widths",
      "Source design file shared with view access",
      "Typography, colour, and spacing defined as reusable styles",
    ],
    evidence: ["figma", "screenshot", "file"],
    description: "Produce the complete visual design for the agreed scope.",
  },
  {
    key: "content",
    title: "Content & Copy",
    signals: /\b(content|copy|copywriting|writing|article|blog|script|seo)\b/i,
    weight: 0.2,
    deliverables: ["Final copy for all agreed sections", "Editable source document"],
    criteria: [
      "Copy delivered for every agreed section",
      "Content supplied in an editable format",
    ],
    evidence: ["document", "file"],
    description: "Write and deliver the agreed written material.",
  },
  {
    key: "development",
    title: "Development",
    signals: /\b(develop|development|build|code|coding|implement|engineer|frontend|backend|app|website|api|integration)\b/i,
    weight: 0.45,
    deliverables: [
      "Implemented application matching the approved design",
      "Deployed staging environment",
      "Source repository access",
    ],
    criteria: [
      "All agreed pages or screens are reachable and functional",
      "Layout is responsive at the agreed breakpoints",
      "No blocking defects in primary navigation or core flows",
      "Staging URL is reachable and current",
      "Source repository is accessible to the client",
    ],
    evidence: ["github_repo", "deployment_url", "screenshot"],
    description: "Build the product to match the approved design and agreed scope.",
  },
  {
    key: "revisions",
    title: "Revisions & QA",
    signals: /\b(qa|testing|test|quality|bug|revision|refine|polish)\b/i,
    weight: 0.15,
    deliverables: ["Resolved issue list", "Test summary"],
    criteria: [
      "All reported blocking issues resolved",
      "Test summary delivered covering the agreed browsers or devices",
    ],
    evidence: ["document", "screenshot", "deployment_url"],
    description: "Resolve defects and verify quality against the agreed criteria.",
  },
  {
    key: "launch",
    title: "Launch & Handover",
    signals: /\b(launch|deploy|deployment|go.?live|handover|handoff|ship|release|production|migration)\b/i,
    weight: 0.2,
    deliverables: ["Production deployment", "Handover documentation", "Access credentials transferred"],
    criteria: [
      "Production environment is live and reachable",
      "Handover documentation delivered",
      "All accounts and credentials transferred to the client",
    ],
    evidence: ["deployment_url", "document", "note"],
    description: "Ship to production and hand over everything the client needs to operate it.",
  },
];

function generateWithRules(input: {
  brief: string;
  asset: string;
  totalAmountHint: number | null;
}): GeneratedAgreement {
  const brief = input.brief.trim();
  const total = input.totalAmountHint ?? extractBudget(brief, input.asset) ?? 300_000;

  const explicitSchedule = extractExplicitSchedule(brief, total);
  const matched = explicitSchedule ? [] : matchPhases(brief);

  const startDate = new Date();
  const durationDays = extractDurationDays(brief) ?? Math.max(21, matched.length * 14);

  let milestones: GeneratedMilestone[];

  if (explicitSchedule && explicitSchedule.length > 0) {
    // The brief already stated a payment schedule. Honour it exactly rather than
    // imposing a template -- the user told us the answer.
    milestones = explicitSchedule.map((item, i) => {
      const phase = PHASES.find((p) => p.signals.test(item.label)) ?? inferPhaseByPosition(i, explicitSchedule.length);
      return buildMilestone(phase, item.amount, item.label, startDate, durationDays, i, explicitSchedule.length);
    });
  } else if (matched.length >= 2) {
    const weights = matched.map((p) => p.weight);
    const amounts = distributeByWeight(total, weights);
    milestones = matched.map((phase, i) =>
      buildMilestone(phase, amounts[i], null, startDate, durationDays, i, matched.length),
    );
  } else {
    // Nothing recognizable: a defensible three-phase default the user can reshape.
    const fallback = [PHASES[0], PHASES[4], PHASES[6]];
    const amounts = distributeByWeight(total, [0.25, 0.5, 0.25]);
    milestones = fallback.map((phase, i) =>
      buildMilestone(phase, amounts[i], null, startDate, durationDays, i, fallback.length),
    );
  }

  milestones = reconcileAmounts(milestones, total);

  return {
    title: extractTitle(brief),
    description: brief,
    totalAmount: total,
    asset: input.asset,
    expectedCompletionAt: inferCompletion(milestones),
    rules: {
      ...DEFAULT_AGREEMENT_RULES,
      revisionRounds: extractRevisionRounds(brief) ?? DEFAULT_AGREEMENT_RULES.revisionRounds,
    },
    milestones,
    issues: [],
    engine: "rules",
    rationale: explicitSchedule
      ? "Your brief already described a payment schedule, so those milestones and amounts were used directly."
      : matched.length >= 2
        ? `Recognized ${matched.length} phases in your brief and split the budget across them. Adjust any amount and the rest stay balanced.`
        : "The brief did not name specific phases, so a standard three-stage structure was proposed. Rename or replace any milestone.",
  };
}

function buildMilestone(
  phase: PhaseTemplate,
  amount: number,
  labelOverride: string | null,
  start: Date,
  durationDays: number,
  index: number,
  count: number,
): GeneratedMilestone {
  const offset = Math.round((durationDays * (index + 1)) / count);
  const due = new Date(start.getTime() + offset * 86_400_000);
  return {
    title: labelOverride ? titleCase(labelOverride) : phase.title,
    description: phase.description,
    amount,
    dueAt: due.toISOString(),
    deliverables: [...phase.deliverables],
    acceptanceCriteria: phase.criteria.map((text) => ({
      id: newId("mst"),
      text,
      verification: "manual" as const,
      ambiguityFlag: null,
    })),
    requiredEvidence: [...phase.evidence],
  };
}

function inferPhaseByPosition(index: number, count: number): PhaseTemplate {
  if (index === 0) return PHASES[2];
  if (index === count - 1) return PHASES[6];
  return PHASES[4];
}

/**
 * Phrases that state a *policy* rather than name a phase of work.
 *
 * "Two revision rounds" sets the revision allowance; it does not mean the project
 * has a QA milestone. Stripping these before phase matching stops the engine from
 * inventing a milestone out of a contract term.
 */
const POLICY_PHRASES = [
  /\b(\d{1,2}|one|two|three|four|five)\s+(?:rounds?\s+of\s+)?revisions?\b/gi,
  /\brevisions?\s*:\s*\d{1,2}\b/gi,
  /\b(?:up to|max(?:imum)?(?: of)?)\s+\d{1,2}\s+revisions?\b/gi,
];

function matchPhases(brief: string): PhaseTemplate[] {
  // Match phases against the brief with policy statements removed.
  let scannable = brief;
  for (const phrase of POLICY_PHRASES) scannable = scannable.replace(phrase, " ");

  const matched = PHASES.filter((p) => p.signals.test(scannable));
  // Keep canonical order so a brief mentioning "launch and design" still reads
  // design -> launch.
  return matched.sort((a, b) => PHASES.indexOf(a) - PHASES.indexOf(b));
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

const CURRENCY_SIGNS: Record<string, string> = { "$": "USDC", "€": "EURC", "£": "USDC" };

export function extractBudget(brief: string, _asset: string): number | null {
  // Handles the ways people actually write amounts:
  //   "$3,000"  "3000 USD"  "EUR 3000"  "2.500 EUR"  "3k"  "2.5k"  "budget: 8000"
  // Currency-first and number-first are both common, so both are matched.
  const patterns = [
    /(?:[$€£])\s?([\d,.]+)\s?(k|m)?\b/i,
    /\b(?:usd|eur|usdc|eurc)\s?([\d,.]+)\s?(k|m)?\b/i,
    /\b([\d,.]+)\s?(k|m)?\s?(?:usd|eur|usdc|eurc|dollars?|euros?)\b/i,
    /\bbudget(?:\s+is|\s+of)?[:\s]+([\d,.]+)\s?(k|m)?/i,
    /\btotal(?:\s+is|\s+of)?[:\s]+([\d,.]+)\s?(k|m)?/i,
    // Last resort: a bare "2.5k" or "8m". The magnitude suffix is required, so
    // plain numbers ("5-page", "6 weeks") are never mistaken for a budget.
    /\b([\d][\d,.]*)\s?(k|m)\b/i,
  ];

  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (!match) continue;
    const raw = match[1];
    const scale = (match[2] ?? "").toLowerCase();
    const normalized = normalizeNumber(raw);
    if (normalized === null) continue;
    const multiplier = scale === "k" ? 1_000 : scale === "m" ? 1_000_000 : 1;
    return Math.round(normalized * multiplier * 100);
  }
  return null;
}

/**
 * Find an explicit payment schedule such as
 * "750 after design, 1500 after development, 750 after launch".
 */
function extractExplicitSchedule(
  brief: string,
  total: number,
): Array<{ amount: number; label: string }> | null {
  const pattern =
    /(?:[$€£])?\s?([\d][\d,.]*)\s?(k)?\s*(?:after|on|for|upon|at)\s+([a-z][a-z\s&/-]{2,40})/gi;
  const found: Array<{ amount: number; label: string }> = [];

  for (const match of brief.matchAll(pattern)) {
    const value = normalizeNumber(match[1]);
    if (value === null) continue;
    const multiplier = (match[2] ?? "").toLowerCase() === "k" ? 1_000 : 1;
    const label = match[3].trim().replace(/\s+(and|then|,).*$/i, "").trim();
    if (!label) continue;
    found.push({ amount: Math.round(value * multiplier * 100), label });
  }

  if (found.length < 2) return null;

  // Only trust the parse if the parts actually add up to the stated total. If they
  // do not, the user gets an amount-mismatch issue instead of a silently wrong split.
  const sum = found.reduce((a, b) => a + b.amount, 0);
  if (Math.abs(sum - total) > total * 0.02) return null;

  return found;
}

function normalizeNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "");
  // "2.500" is European thousands; "2.50" is decimal. Disambiguate by group size.
  const europeanThousands = /^\d{1,3}(\.\d{3})+$/.test(cleaned);
  const normalized = europeanThousands ? cleaned.replace(/\./g, "") : cleaned.replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractDurationDays(brief: string): number | null {
  const weeks = brief.match(/\b(\d{1,2})\s*(?:-|to)?\s*(?:\d{1,2})?\s*weeks?\b/i);
  if (weeks) return Number(weeks[1]) * 7;
  const months = brief.match(/\b(\d{1,2})\s*months?\b/i);
  if (months) return Number(months[1]) * 30;
  const days = brief.match(/\b(\d{1,3})\s*days?\b/i);
  if (days) return Number(days[1]);
  return null;
}

function extractRevisionRounds(brief: string): number | null {
  const numeric = brief.match(/\b(\d{1,2})\s*(?:rounds?\s*of\s*)?revisions?\b/i);
  if (numeric) return Math.min(Number(numeric[1]), 10);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const worded = brief.match(/\b(one|two|three|four|five)\s+(?:rounds?\s+of\s+)?revisions?\b/i);
  if (worded) return words[worded[1].toLowerCase()] ?? null;
  return null;
}

function extractTitle(brief: string): string {
  const cleaned = brief.replace(/\s+/g, " ").trim();

  // "I need a designer to create a brand identity for my startup" -> "Brand Identity"
  const forPattern = cleaned.match(
    /\b(?:build|create|design|develop|make|need|want)\s+(?:me\s+)?(?:a|an|the)?\s*([a-z][a-z\s-]{4,50}?)(?:\s+for\b|\s+with\b|[.,;]|$)/i,
  );
  if (forPattern) {
    const candidate = stripLeadingArticle(
      forPattern[1].trim().replace(/\b(designer|developer|freelancer|agency)\s+to\s+\w+\s+/i, ""),
    );
    if (candidate.length > 3) return titleCase(candidate.slice(0, 60));
  }

  const firstSentence = cleaned.split(/[.!?]/)[0];
  return titleCase(stripLeadingArticle(firstSentence).slice(0, 60) || "New Agreement");
}

/** "a brand identity" -> "brand identity". A title should not open with an article. */
function stripLeadingArticle(text: string): string {
  return text.replace(/^\s*(?:a|an|the)\s+/i, "").trim();
}

function titleCase(text: string): string {
  const small = new Set(["a", "an", "the", "for", "and", "or", "of", "to", "in", "on", "with", "my"]);
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => (i > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function isEvidenceKind(value: string): value is EvidenceKind {
  return [
    "github_repo", "github_commits", "deployment_url", "figma",
    "document", "file", "screenshot", "note", "link",
  ].includes(value);
}

function distributeByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return splitEvenly(total, weights.length);
  const raw = weights.map((w) => Math.floor((total * w) / sum));
  let remainder = total - raw.reduce((a, b) => a + b, 0);
  // Hand the rounding remainder to the largest milestones first.
  const order = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w);
  let cursor = 0;
  while (remainder > 0) {
    raw[order[cursor % order.length].i] += 1;
    remainder -= 1;
    cursor += 1;
  }
  return raw;
}

/** Force milestone amounts to sum exactly to the total, adjusting the largest one. */
export function reconcileAmounts(milestones: GeneratedMilestone[], total: number): GeneratedMilestone[] {
  if (milestones.length === 0) return milestones;
  const allocated = milestones.reduce((a, m) => a + m.amount, 0);
  const difference = total - allocated;
  if (difference === 0) return milestones;

  const largestIndex = milestones.reduce(
    (best, m, i) => (m.amount > milestones[best].amount ? i : best),
    0,
  );
  const adjusted = milestones.map((m, i) =>
    i === largestIndex ? { ...m, amount: Math.max(1, m.amount + difference) } : m,
  );

  // If the adjustment was clamped, spread the residual evenly instead.
  const finalAllocated = adjusted.reduce((a, m) => a + m.amount, 0);
  if (finalAllocated !== total) {
    const even = splitEvenly(total, adjusted.length);
    return adjusted.map((m, i) => ({ ...m, amount: even[i] }));
  }
  return adjusted;
}

function inferCompletion(milestones: GeneratedMilestone[]): string | null {
  const dates = milestones.map((m) => m.dueAt).filter((d): d is string => Boolean(d));
  if (dates.length === 0) return null;
  return dates.sort().at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// Issue detection
// ---------------------------------------------------------------------------

/** Words that make an acceptance criterion unenforceable. */
const VAGUE_TERMS = [
  { pattern: /\b(professional|modern|clean|nice|good|beautiful|polished|premium)\b/i, note: "subjective quality word" },
  { pattern: /\b(fast|quick|performant|snappy|responsive)\b(?!\s+at\b)/i, note: "unquantified performance claim" },
  { pattern: /\b(etc|and so on|and more|among others)\b/i, note: "open-ended scope" },
  { pattern: /\b(some|several|a few|various|multiple)\b/i, note: "unspecified quantity" },
  { pattern: /\b(as needed|if necessary|where appropriate|reasonable)\b/i, note: "undefined trigger" },
  { pattern: /\b(work(s|ing)? (well|properly|correctly))\b/i, note: "undefined success condition" },
];

const CONCRETE_HINTS: Record<string, string> = {
  "subjective quality word":
    "Replace the subjective word with a checkable requirement, for example a named style guide, a page count, or a defined breakpoint.",
  "unquantified performance claim":
    "State a measurable target, for example \"loads in under 2s on a 4G connection\" or \"responsive at 390px, 768px, 1440px\".",
  "open-ended scope":
    "List the items explicitly. Open-ended scope is the most common cause of disputes.",
  "unspecified quantity":
    "Give an exact number, for example \"3 logo concepts\" rather than \"several concepts\".",
  "undefined trigger":
    "Say who decides and on what basis, or remove the conditional.",
  "undefined success condition":
    "Describe the specific behaviour that counts as working, and how it will be checked.",
};

export function detectIssues(draft: Omit<GeneratedAgreement, "issues">): AgreementIssue[] {
  const issues: AgreementIssue[] = [];
  const push = (issue: Omit<AgreementIssue, "id">) => issues.push({ ...issue, id: newId("ana") });

  // --- Arithmetic. This is blocking: an agreement that does not add up cannot be funded.
  const allocated = draft.milestones.reduce((a, m) => a + m.amount, 0);
  if (allocated !== draft.totalAmount) {
    push({
      severity: "blocking",
      target: { kind: "agreement" },
      title: "Milestone amounts do not match the total",
      detail: `Milestones allocate ${(allocated / 100).toFixed(2)} but the agreement value is ${(draft.totalAmount / 100).toFixed(2)}.`,
      suggestion: "Rebalance the milestone amounts so they sum to the agreement value.",
      patch: { op: "rebalance_amounts" },
    });
  }

  draft.milestones.forEach((milestone, index) => {
    // --- Missing acceptance criteria.
    if (milestone.acceptanceCriteria.length === 0) {
      push({
        severity: "blocking",
        target: { kind: "milestone", index },
        title: `"${milestone.title}" has no acceptance criteria`,
        detail:
          "Without acceptance criteria there is no objective basis for approving or rejecting this milestone.",
        suggestion: "Add at least one criterion describing what must be true for this to be accepted.",
        patch: {
          op: "add_criterion",
          milestoneIndex: index,
          text: "Deliverables listed above are supplied in the agreed format",
        },
      });
    }

    // --- Missing deadline.
    if (!milestone.dueAt) {
      const suggested = new Date(Date.now() + (index + 1) * 14 * 86_400_000).toISOString();
      push({
        severity: "attention",
        target: { kind: "milestone", index },
        title: `"${milestone.title}" has no deadline`,
        detail: "A milestone without a date cannot be late, which removes the main schedule protection for both sides.",
        suggestion: `Set a due date, for example ${suggested.slice(0, 10)}.`,
        patch: { op: "set_due_date", milestoneIndex: index, dueAt: suggested },
      });
    }

    // --- Missing evidence requirement.
    if (milestone.requiredEvidence.length === 0) {
      push({
        severity: "attention",
        target: { kind: "milestone", index },
        title: `"${milestone.title}" has no evidence requirement`,
        detail:
          "Evidence is what turns approval into a verifiable decision rather than a judgement call.",
        suggestion: "Require at least one evidence source for this milestone.",
        patch: { op: "add_evidence_requirement", milestoneIndex: index, kind: "file" },
      });
    }

    // --- Deliverables with nothing to verify them.
    if (milestone.deliverables.length === 0) {
      push({
        severity: "suggestion",
        target: { kind: "milestone", index },
        title: `"${milestone.title}" lists no deliverables`,
        detail: "Naming the deliverables makes it obvious what is being handed over.",
        suggestion: "List the concrete artifacts this milestone produces.",
        patch: null,
      });
    }

    // --- Ambiguous criteria.
    milestone.acceptanceCriteria.forEach((criterion) => {
      for (const vague of VAGUE_TERMS) {
        const match = criterion.text.match(vague.pattern);
        if (!match) continue;
        push({
          severity: "attention",
          target: { kind: "criterion", index, criterionId: criterion.id },
          title: "Ambiguous acceptance criterion",
          detail: `"${criterion.text}" contains ${vague.note} ("${match[0]}"), so it can be read more than one way.`,
          suggestion: CONCRETE_HINTS[vague.note],
          patch: null,
        });
        break;
      }
    });
  });

  // --- Revision policy.
  if (draft.rules.revisionRounds === 0) {
    push({
      severity: "attention",
      target: { kind: "agreement" },
      title: "No revision rounds allowed",
      detail:
        "With zero revisions, any disagreement escalates straight to a dispute. Most agreements settle faster with one or two rounds.",
      suggestion: "Allow two revision rounds.",
      patch: { op: "set_revision_rounds", rounds: 2 },
    });
  }

  // --- Front-loaded risk.
  const first = draft.milestones[0];
  if (draft.milestones.length > 1 && first && first.amount > draft.totalAmount * 0.6) {
    push({
      severity: "suggestion",
      target: { kind: "milestone", index: 0 },
      title: "Most of the value sits in the first milestone",
      detail: `The first milestone holds ${Math.round((first.amount / draft.totalAmount) * 100)}% of the contract value, which concentrates the client's risk early.`,
      suggestion: "Consider spreading value more evenly across milestones.",
      patch: null,
    });
  }

  return issues;
}

/** Apply an accepted suggestion. The user always sees the result before it is saved. */
export function applyPatch(
  draft: GeneratedAgreement,
  patch: IssuePatch,
): GeneratedAgreement {
  const milestones = draft.milestones.map((m) => ({
    ...m,
    acceptanceCriteria: m.acceptanceCriteria.map((c) => ({ ...c })),
  }));

  switch (patch.op) {
    case "rebalance_amounts":
      return { ...draft, milestones: reconcileAmounts(milestones, draft.totalAmount) };

    case "set_criterion_text": {
      const target = milestones[patch.milestoneIndex];
      if (target) {
        const criterion = target.acceptanceCriteria.find((c) => c.id === patch.criterionId);
        if (criterion) criterion.text = patch.text;
      }
      return { ...draft, milestones };
    }

    case "add_criterion": {
      const target = milestones[patch.milestoneIndex];
      if (target) {
        target.acceptanceCriteria.push({
          id: newId("mst"),
          text: patch.text,
          verification: "manual",
          ambiguityFlag: null,
        });
      }
      return { ...draft, milestones };
    }

    case "set_due_date": {
      const target = milestones[patch.milestoneIndex];
      if (target) target.dueAt = patch.dueAt;
      return { ...draft, milestones, expectedCompletionAt: inferCompletion(milestones) };
    }

    case "add_evidence_requirement": {
      const target = milestones[patch.milestoneIndex];
      if (target && !target.requiredEvidence.includes(patch.kind)) {
        target.requiredEvidence.push(patch.kind);
      }
      return { ...draft, milestones };
    }

    case "set_revision_rounds":
      return { ...draft, rules: { ...draft.rules, revisionRounds: patch.rounds } };

    default:
      return draft;
  }
}

export { parseMoney };
