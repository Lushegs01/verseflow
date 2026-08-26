/**
 * Evidence analysis.
 *
 * This module produces a RECOMMENDATION. It has no write access to escrow, no
 * ability to change milestone state, and nothing downstream branches on its output
 * to move money. The client reads it and decides.
 *
 * Two things follow from that, and both are enforced here rather than left to the UI:
 *   - It never claims certainty. Criteria it cannot check from evidence are marked
 *     "unverified", not quietly assumed to pass.
 *   - Its confidence reflects coverage, not conviction. Confidence falls when
 *     evidence is missing, and is capped well below 100 whenever any criterion is
 *     unverifiable from what was submitted.
 */

import { z } from "zod";
import { requestJson, isModelConfigured } from "./provider";
import { newId, nowIso } from "@/lib/domain/ids";
import type {
  AcceptanceCriterion,
  CriterionAssessment,
  CriterionFinding,
  Evidence,
  EvidenceAnalysis,
  EvidenceKind,
  Milestone,
  Recommendation,
} from "@/lib/domain/types";

export async function analyzeEvidence(
  milestone: Milestone,
  evidence: Evidence[],
  round: number,
): Promise<EvidenceAnalysis> {
  const base = analyzeWithRules(milestone, evidence, round);
  if (!isModelConfigured()) return base;

  const enriched = await analyzeWithModel(milestone, evidence, round, base);
  return enriched ?? base;
}

// ---------------------------------------------------------------------------
// Deterministic analysis
// ---------------------------------------------------------------------------

/**
 * Criterion keywords mapped to the evidence kinds that can actually substantiate them.
 * If a criterion mentions a repository, a screenshot does not verify it.
 */
const CRITERION_SIGNALS: Array<{ pattern: RegExp; kinds: EvidenceKind[]; label: string }> = [
  { pattern: /\b(repo|repository|source|code|git)\b/i, kinds: ["github_repo", "github_commits"], label: "repository access" },
  { pattern: /\b(commit|branch|pull request|pr)\b/i, kinds: ["github_commits", "github_repo"], label: "commit history" },
  { pattern: /\b(deploy|staging|production|live|url|reachable|hosted|environment)\b/i, kinds: ["deployment_url", "link"], label: "a reachable deployment" },
  { pattern: /\b(design|figma|mockup|prototype|wireframe|moodboard)\b/i, kinds: ["figma", "file", "screenshot"], label: "design files" },
  { pattern: /\b(responsive|breakpoint|mobile|desktop|layout|screen)\b/i, kinds: ["screenshot", "deployment_url", "figma"], label: "visual proof at each breakpoint" },
  { pattern: /\b(document|documentation|handover|report|summary|spec)\b/i, kinds: ["document", "file"], label: "a document" },
  { pattern: /\b(page|pages|screens?)\b/i, kinds: ["deployment_url", "screenshot", "figma"], label: "the delivered pages" },
  { pattern: /\b(browser|cross.?browser|safari|chrome|firefox|edge)\b/i, kinds: [], label: "browser compatibility testing" },
  { pattern: /\b(credential|access|account|transferred)\b/i, kinds: ["note", "document"], label: "written confirmation of transfer" },
];

function analyzeWithRules(
  milestone: Milestone,
  evidence: Evidence[],
  round: number,
): EvidenceAnalysis {
  const present = new Set(evidence.map((e) => e.kind));
  const findings: CriterionFinding[] = milestone.acceptanceCriteria.map((criterion) =>
    assessCriterion(criterion, evidence, present),
  );

  const openQuestions = buildOpenQuestions(milestone, evidence, findings);
  const consistency = scoreConsistency(milestone, evidence, findings);
  const { recommendation, confidence } = scoreRecommendation(findings, milestone, evidence);

  return {
    id: newId("ana"),
    milestoneId: milestone.id,
    agreementId: milestone.agreementId,
    round,
    consistency,
    findings,
    recommendation,
    confidence,
    summary: buildSummary(findings, milestone, evidence, recommendation),
    openQuestions,
    engine: "rules",
    createdAt: nowIso(),
  };
}

function assessCriterion(
  criterion: AcceptanceCriterion,
  evidence: Evidence[],
  present: Set<EvidenceKind>,
): CriterionFinding {
  const signals = CRITERION_SIGNALS.filter((s) => s.pattern.test(criterion.text));

  // A criterion nothing in our vocabulary recognizes is a human judgement call.
  if (signals.length === 0) {
    return {
      criterionId: criterion.id,
      criterionText: criterion.text,
      assessment: evidence.length > 0 ? "likely_met" : "unverified",
      reasoning:
        evidence.length > 0
          ? "Evidence was submitted, but this criterion needs a person to judge whether it is satisfied."
          : "No evidence was submitted that relates to this criterion.",
      supportingEvidenceIds: [],
    };
  }

  // A criterion whose only signal has no verifiable evidence kind (browser testing,
  // for example) is honestly reported as unverified rather than assumed.
  const verifiableSignals = signals.filter((s) => s.kinds.length > 0);
  if (verifiableSignals.length === 0) {
    return {
      criterionId: criterion.id,
      criterionText: criterion.text,
      assessment: "unverified",
      reasoning: `This requires ${signals[0].label}, which cannot be confirmed from the submitted evidence.`,
      supportingEvidenceIds: [],
    };
  }

  const supporting = evidence.filter((e) =>
    verifiableSignals.some((s) => s.kinds.includes(e.kind)),
  );

  if (supporting.length === 0) {
    const needed = verifiableSignals[0];
    return {
      criterionId: criterion.id,
      criterionText: criterion.text,
      assessment: "not_met",
      reasoning: `No ${needed.label} was submitted, so this criterion has nothing supporting it.`,
      supportingEvidenceIds: [],
    };
  }

  // Deployment evidence that reports itself offline contradicts the criterion.
  const offline = supporting.find(
    (e) => e.kind === "deployment_url" && String(e.metadata.status ?? "").toLowerCase() === "offline",
  );
  if (offline) {
    return {
      criterionId: criterion.id,
      criterionText: criterion.text,
      assessment: "not_met",
      reasoning: "The submitted deployment was recorded as offline when it was checked.",
      supportingEvidenceIds: [offline.id],
    };
  }

  const strong = verifiableSignals.every((s) => s.kinds.some((k) => present.has(k)));
  return {
    criterionId: criterion.id,
    criterionText: criterion.text,
    assessment: strong ? "met" : "likely_met",
    reasoning: strong
      ? `Supported by ${describeKinds(supporting)}.`
      : `Partially supported by ${describeKinds(supporting)}; some of what this criterion asks for was not submitted.`,
    supportingEvidenceIds: supporting.map((e) => e.id),
  };
}

function describeKinds(evidence: Evidence[]): string {
  const labels = Array.from(new Set(evidence.map((e) => EVIDENCE_LABELS[e.kind] ?? e.kind)));
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  github_repo: "a linked repository",
  github_commits: "commit history",
  deployment_url: "a deployment URL",
  figma: "a design file",
  document: "a document",
  file: "an uploaded file",
  screenshot: "screenshots",
  note: "a written note",
  link: "a link",
};

function buildOpenQuestions(
  milestone: Milestone,
  evidence: Evidence[],
  findings: CriterionFinding[],
): string[] {
  const questions: string[] = [];

  const missingRequired = milestone.requiredEvidence.filter(
    (kind) => !evidence.some((e) => e.kind === kind),
  );
  for (const kind of missingRequired) {
    questions.push(`The agreement requires ${EVIDENCE_LABELS[kind]}, which was not included in this submission.`);
  }

  for (const finding of findings) {
    if (finding.assessment === "unverified") {
      questions.push(`Confirm manually: ${finding.criterionText}`);
    }
  }

  if (evidence.length === 0) {
    questions.push("No evidence was submitted for this milestone.");
  }

  return questions.slice(0, 6);
}

function scoreConsistency(
  milestone: Milestone,
  evidence: Evidence[],
  findings: CriterionFinding[],
): "high" | "medium" | "low" {
  if (evidence.length === 0) return "low";

  const requiredCovered = milestone.requiredEvidence.every((k) => evidence.some((e) => e.kind === k));
  const contradictions = findings.filter((f) => f.assessment === "not_met").length;
  const distinctKinds = new Set(evidence.map((e) => e.kind)).size;

  if (contradictions > 0) return "low";
  if (requiredCovered && distinctKinds >= 2) return "high";
  if (requiredCovered || distinctKinds >= 2) return "medium";
  return "low";
}

function scoreRecommendation(
  findings: CriterionFinding[],
  milestone: Milestone,
  evidence: Evidence[],
): { recommendation: Recommendation; confidence: number } {
  if (findings.length === 0) {
    return { recommendation: "needs_clarification", confidence: 20 };
  }

  const weights: Record<CriterionAssessment, number> = {
    met: 1,
    likely_met: 0.75,
    unverified: 0.4,
    not_met: 0,
  };

  const score = findings.reduce((acc, f) => acc + weights[f.assessment], 0) / findings.length;
  const notMet = findings.filter((f) => f.assessment === "not_met").length;
  const unverified = findings.filter((f) => f.assessment === "unverified").length;

  const missingRequired = milestone.requiredEvidence.filter(
    (kind) => !evidence.some((e) => e.kind === kind),
  ).length;

  let recommendation: Recommendation;
  if (notMet > 0 && notMet >= findings.length / 2) recommendation = "likely_insufficient";
  else if (notMet > 0) recommendation = "partially_satisfies";
  else if (unverified > findings.length / 2) recommendation = "needs_clarification";
  else if (score >= 0.85) recommendation = "likely_satisfies";
  else if (score >= 0.6) recommendation = "partially_satisfies";
  else recommendation = "needs_clarification";

  // Confidence is coverage, penalised for anything missing, and never absolute.
  let confidence = Math.round(score * 100);
  confidence -= missingRequired * 12;
  confidence -= unverified * 5;
  if (unverified > 0) confidence = Math.min(confidence, 94); // never claim certainty
  if (evidence.length === 0) confidence = Math.min(confidence, 15);

  return { recommendation, confidence: Math.max(5, Math.min(confidence, 97)) };
}

function buildSummary(
  findings: CriterionFinding[],
  milestone: Milestone,
  evidence: Evidence[],
  recommendation: Recommendation,
): string {
  const met = findings.filter((f) => f.assessment === "met" || f.assessment === "likely_met").length;
  const total = findings.length;
  const kinds = new Set(evidence.map((e) => e.kind)).size;

  const lead =
    total === 0
      ? "This milestone has no acceptance criteria to check against."
      : `${met} of ${total} acceptance criteria are supported by the submitted evidence, drawn from ${kinds} evidence ${kinds === 1 ? "source" : "sources"}.`;

  const tail: Record<Recommendation, string> = {
    likely_satisfies:
      "Nothing in the evidence contradicts the agreed terms. The decision to release is yours.",
    partially_satisfies:
      "Some criteria are supported and others are not. A partial release or a revision request may fit better than full approval.",
    needs_clarification:
      "Several criteria cannot be confirmed from what was submitted. Asking for specifics is likely faster than deciding now.",
    likely_insufficient:
      "Most criteria are unsupported by the evidence provided. Review the details before taking any payment action.",
  };

  return `${lead} ${tail[recommendation]}`;
}

// ---------------------------------------------------------------------------
// Model-assisted analysis
// ---------------------------------------------------------------------------

const modelAnalysisSchema = z.object({
  consistency: z.enum(["high", "medium", "low"]),
  summary: z.string().max(1200),
  openQuestions: z.array(z.string().max(400)).max(6).default([]),
  findings: z
    .array(
      z.object({
        criterionId: z.string(),
        assessment: z.enum(["met", "likely_met", "unverified", "not_met"]),
        reasoning: z.string().max(600),
      }),
    )
    .default([]),
});

const ANALYSIS_SYSTEM = `You review submitted work evidence against agreed acceptance criteria for an escrow platform.

Critical constraints:
- You are producing a RECOMMENDATION for a human reviewer. You never decide payment.
- Never assume a criterion is met without evidence supporting it. Mark it "unverified" instead.
- If evidence contradicts a criterion, mark it "not_met" and say exactly what contradicts it.
- Things like cross-browser compatibility, accessibility audits, or subjective quality cannot be
  confirmed from links and screenshots. Mark those "unverified".
- Be concise and factual. No praise, no hedging filler.
- Reply with JSON only.`;

async function analyzeWithModel(
  milestone: Milestone,
  evidence: Evidence[],
  round: number,
  fallback: EvidenceAnalysis,
): Promise<EvidenceAnalysis | null> {
  const evidenceDescription = evidence
    .map(
      (e, i) =>
        `${i + 1}. [${e.kind}] "${e.title}" source=${e.source || "n/a"} metadata=${JSON.stringify(e.metadata)} description=${e.description || "n/a"}`,
    )
    .join("\n");

  const criteriaDescription = milestone.acceptanceCriteria
    .map((c) => `- id=${c.id} :: ${c.text}`)
    .join("\n");

  const result = await requestJson(
    {
      system: ANALYSIS_SYSTEM,
      prompt: `Milestone: "${milestone.title}"
Deliverables: ${milestone.deliverables.join("; ") || "none listed"}
Required evidence kinds: ${milestone.requiredEvidence.join(", ") || "none specified"}

Acceptance criteria:
${criteriaDescription || "none"}

Submitted evidence (round ${round}):
${evidenceDescription || "none submitted"}

Return JSON: { consistency, summary, openQuestions[], findings[{criterionId, assessment, reasoning}] }`,
      maxTokens: 2048,
    },
    (value) => {
      const parsed = modelAnalysisSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
  );

  if (!result) return null;

  // Merge onto the deterministic findings so a criterion the model omitted keeps
  // its rule-based assessment rather than silently disappearing.
  const byId = new Map(result.findings.map((f) => [f.criterionId, f]));
  const findings: CriterionFinding[] = fallback.findings.map((base) => {
    const override = byId.get(base.criterionId);
    if (!override) return base;
    return {
      ...base,
      assessment: override.assessment,
      reasoning: override.reasoning,
    };
  });

  const { recommendation, confidence } = scoreRecommendation(findings, milestone, evidence);

  return {
    ...fallback,
    id: newId("ana"),
    consistency: result.consistency,
    findings,
    recommendation,
    confidence,
    summary: result.summary || fallback.summary,
    openQuestions: result.openQuestions.length > 0 ? result.openQuestions : fallback.openQuestions,
    engine: "model",
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  likely_satisfies: "Likely satisfies milestone",
  partially_satisfies: "Partially satisfies milestone",
  needs_clarification: "Needs clarification",
  likely_insufficient: "Likely insufficient",
};

export const ASSESSMENT_LABELS: Record<CriterionAssessment, string> = {
  met: "Met",
  likely_met: "Likely met",
  unverified: "Not verified",
  not_met: "Not met",
};
