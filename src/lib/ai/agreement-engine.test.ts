/**
 * Agreement engine: the deterministic path.
 *
 * This is the engine that runs when no model key is configured, so it is the one a
 * judge cloning the repository will actually see. Its output has to be genuinely
 * usable, and above all it must never produce an agreement whose milestone amounts
 * do not sum to the contract value.
 */

import { describe, it, expect } from "vitest";
import { generateAgreement, detectIssues, applyPatch, extractBudget } from "./agreement-engine";

const gen = (brief: string, hint: number | null = null) =>
  generateAgreement({ brief, asset: "USDC", totalAmountHint: hint });

describe("budget extraction", () => {
  it("reads the common ways people write money", async () => {
    expect(extractBudget("The total budget is $2,500.", "USDC")).toBe(250_000);
    expect(extractBudget("Build me a 5-page website for EUR 3000", "USDC")).toBe(300_000);
    expect(extractBudget("budget: 8000", "USDC")).toBe(800_000);
    expect(extractBudget("around 2.5k for this", "USDC")).toBe(250_000);
    // European thousands separator, not a decimal.
    expect(extractBudget("total of 2.500 EUR", "USDC")).toBe(250_000);
  });

  it("returns null when no budget is stated", () => {
    expect(extractBudget("I need a logo designed soon.", "USDC")).toBeNull();
  });
});

describe("generated agreements", () => {
  it("always allocates exactly the contract value", async () => {
    const briefs = [
      "I need a designer to create a brand identity for my startup. The total budget is $2,500. Moodboard first, then logo concepts, then final brand files.",
      "Build me a 5-page website for $3,000 with design, development and launch phases.",
      "Looking for a developer to build an internal analytics dashboard over 6 weeks. Budget $8,000.",
      "I want some copywriting done. 1500 dollars.",
      "Need help with a project.",
    ];

    for (const brief of briefs) {
      const result = await gen(brief);
      const allocated = result.milestones.reduce((a, m) => a + m.amount, 0);
      expect(allocated, `allocation for: ${brief.slice(0, 40)}`).toBe(result.totalAmount);
      expect(result.milestones.length).toBeGreaterThan(0);
      expect(result.milestones.every((m) => m.amount > 0)).toBe(true);
      expect(Number.isInteger(allocated)).toBe(true);
    }
  });

  it("honours an explicit payment schedule from the brief", async () => {
    const result = await gen(
      "Build me a 5-page website for $3,000. $750 after design, $1,500 after development, $750 after launch.",
    );

    expect(result.totalAmount).toBe(300_000);
    expect(result.milestones.map((m) => m.amount)).toEqual([75_000, 150_000, 75_000]);
    expect(result.rationale).toMatch(/already described a payment schedule/i);
  });

  it("reads the revision allowance without inventing a QA milestone", async () => {
    // "Two revision rounds" is a contract term, not a phase of work.
    const result = await gen(
      "I need a designer to create a brand identity. Budget $2,500. Moodboard first, then logo concepts, then final brand files. Two revision rounds.",
    );

    expect(result.rules.revisionRounds).toBe(2);
    expect(result.milestones.map((m) => m.title)).not.toContain("Revisions & QA");
  });

  it("does not open the title with an article", async () => {
    const result = await gen(
      "I need a designer to create a brand identity for my startup. Budget $2,500.",
    );
    expect(result.title).not.toMatch(/^(A|An|The)\s/);
    expect(result.title.toLowerCase()).toContain("brand identity");
  });

  it("respects an explicit budget hint over the brief", async () => {
    const result = await gen("Build a website for $3,000.", 500_000);
    expect(result.totalAmount).toBe(500_000);
    expect(result.milestones.reduce((a, m) => a + m.amount, 0)).toBe(500_000);
  });

  it("gives every milestone acceptance criteria and evidence", async () => {
    const result = await gen(
      "Build me a 5-page website for $3,000 with design, development and launch.",
    );
    for (const m of result.milestones) {
      expect(m.acceptanceCriteria.length, m.title).toBeGreaterThan(0);
      expect(m.requiredEvidence.length, m.title).toBeGreaterThan(0);
      expect(m.dueAt, m.title).toBeTruthy();
    }
  });
});

describe("issue detection", () => {
  it("flags an allocation mismatch as blocking", async () => {
    const draft = await gen("Build a website for $3,000 with design and development.");
    const broken = {
      ...draft,
      milestones: draft.milestones.map((m, i) => (i === 0 ? { ...m, amount: m.amount + 5000 } : m)),
    };

    const issues = detectIssues(broken);
    const mismatch = issues.find((i) => i.title.includes("do not match the total"));
    expect(mismatch?.severity).toBe("blocking");
    expect(mismatch?.patch?.op).toBe("rebalance_amounts");
  });

  it("flags ambiguous acceptance criteria", async () => {
    const draft = await gen("Build a website for $3,000 with design and development.");
    const vague = {
      ...draft,
      milestones: draft.milestones.map((m, i) =>
        i === 0
          ? {
              ...m,
              acceptanceCriteria: [
                { id: "c1", text: "Make the website look professional", verification: "manual" as const, ambiguityFlag: null },
              ],
            }
          : m,
      ),
    };

    const issues = detectIssues(vague);
    const ambiguity = issues.find((i) => i.title === "Ambiguous acceptance criterion");
    expect(ambiguity).toBeDefined();
    expect(ambiguity?.detail).toMatch(/subjective quality word/i);
    expect(ambiguity?.suggestion).toBeTruthy();
  });

  it("flags a milestone with no acceptance criteria as blocking", async () => {
    const draft = await gen("Build a website for $3,000 with design and development.");
    const stripped = {
      ...draft,
      milestones: draft.milestones.map((m, i) => (i === 0 ? { ...m, acceptanceCriteria: [] } : m)),
    };

    const issues = detectIssues(stripped);
    expect(issues.some((i) => i.severity === "blocking" && i.title.includes("no acceptance criteria"))).toBe(true);
  });

  it("flags a zero revision policy", async () => {
    const draft = await gen("Build a website for $3,000 with design and development.");
    const issues = detectIssues({ ...draft, rules: { ...draft.rules, revisionRounds: 0 } });
    const revision = issues.find((i) => i.title === "No revision rounds allowed");
    expect(revision?.patch).toEqual({ op: "set_revision_rounds", rounds: 2 });
  });
});

describe("applying suggestions", () => {
  it("rebalancing restores the allocation invariant", async () => {
    const draft = await gen("Build a website for $3,000 with design and development.");
    const broken = {
      ...draft,
      milestones: draft.milestones.map((m, i) => (i === 0 ? { ...m, amount: m.amount + 12_345 } : m)),
    };

    const fixed = applyPatch(broken, { op: "rebalance_amounts" });
    expect(fixed.milestones.reduce((a, m) => a + m.amount, 0)).toBe(fixed.totalAmount);
  });

  it("adding a criterion resolves the blocking issue it came from", async () => {
    const draft = await gen("Build a website for $3,000 with design and development.");
    const stripped = {
      ...draft,
      milestones: draft.milestones.map((m, i) => (i === 0 ? { ...m, acceptanceCriteria: [] } : m)),
    };

    const issue = detectIssues(stripped).find((i) => i.patch?.op === "add_criterion")!;
    const fixed = applyPatch(stripped, issue.patch!);

    expect(fixed.milestones[0].acceptanceCriteria.length).toBe(1);
    expect(detectIssues(fixed).some((i) => i.title.includes("no acceptance criteria"))).toBe(false);
  });
});
