/**
 * Schema validation for every write path.
 *
 * Rule: the API layer never trusts a request body. Everything crossing the
 * boundary is parsed here first, and financial invariants (amounts summing to
 * the total, evidence presence, revision limits) are enforced server-side even
 * when the UI already checks them.
 */

import { z } from "zod";
import { ASSETS } from "./money";

export const EVIDENCE_KINDS = [
  "github_repo",
  "github_commits",
  "deployment_url",
  "figma",
  "document",
  "file",
  "screenshot",
  "note",
  "link",
] as const;

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Enter a valid date." });

export const addressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid wallet address.");

export const txHashSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Enter a valid transaction hash.");

/** Money is always an integer count of minor units. Never a float. */
export const amountSchema = z
  .number()
  .int("Amounts must be a whole number of cents.")
  .min(0, "Amount cannot be negative.")
  .max(1_000_000_000_00, "Amount exceeds the supported maximum.");

export const assetSchema = z
  .string()
  .refine((v) => v in ASSETS, { message: "Unsupported settlement asset." });

export const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(3, "Describe the criterion.").max(500),
  verification: z.enum(["evidence", "manual"]).default("manual"),
  ambiguityFlag: z.string().max(500).nullable().default(null),
});

export const milestoneInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(2, "Give the milestone a title.").max(120),
  description: z.string().trim().max(2000).default(""),
  amount: amountSchema,
  dueAt: isoDate.nullable().default(null),
  deliverables: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).max(30).default([]),
  requiredEvidence: z.array(z.enum(EVIDENCE_KINDS)).max(9).default([]),
});

export const agreementRulesSchema = z.object({
  revisionRounds: z.number().int().min(0).max(10),
  approvalWindowHours: z.number().int().min(1).max(720),
  disputeWindowHours: z.number().int().min(1).max(2160),
  evidenceRequired: z.boolean(),
  partialReleaseAllowed: z.boolean(),
  lateDeliveryPolicy: z.string().max(1000).nullable().default(null),
  additionalTerms: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});

export const agreementDraftSchema = z
  .object({
    title: z.string().trim().min(3, "Give the agreement a title.").max(160),
    description: z.string().trim().max(4000).default(""),
    totalAmount: amountSchema.refine((v) => v > 0, "The agreement value must be greater than zero."),
    asset: assetSchema,
    providerInviteAddress: addressSchema.nullable().default(null),
    providerHandle: z.string().trim().max(64).nullable().default(null),
    expectedCompletionAt: isoDate.nullable().default(null),
    rules: agreementRulesSchema,
    milestones: z
      .array(milestoneInputSchema)
      .min(1, "Add at least one milestone.")
      .max(20, "An agreement supports up to 20 milestones."),
  })
  .superRefine((value, ctx) => {
    // The single most important financial invariant in the product.
    const allocated = value.milestones.reduce((acc, m) => acc + m.amount, 0);
    if (allocated !== value.totalAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["milestones"],
        message: "Milestone amounts must equal the total agreement value.",
        params: { allocated, total: value.totalAmount },
      });
    }
    for (const [i, m] of value.milestones.entries()) {
      if (m.amount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["milestones", i, "amount"],
          message: "Each milestone must be worth more than zero.",
        });
      }
    }
    // Milestone deadlines must not run past the stated completion date.
    if (value.expectedCompletionAt) {
      const end = Date.parse(value.expectedCompletionAt);
      for (const [i, m] of value.milestones.entries()) {
        if (m.dueAt && Date.parse(m.dueAt) > end) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["milestones", i, "dueAt"],
            message: "This milestone is due after the agreement completion date.",
          });
        }
      }
    }
  });

export type AgreementDraftInput = z.infer<typeof agreementDraftSchema>;
export type MilestoneInput = z.infer<typeof milestoneInputSchema>;

export const evidenceInputSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  title: z.string().trim().min(1, "Give the evidence a name.").max(160),
  source: z.string().trim().max(2000).default(""),
  description: z.string().trim().max(2000).default(""),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])).default({}),
});

export const milestoneSubmissionSchema = z.object({
  note: z.string().trim().max(4000).default(""),
  evidence: z.array(evidenceInputSchema).default([]),
});

export const approvalSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  note: z.string().trim().max(2000).default(""),
});

export const partialApprovalSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  amount: amountSchema.refine((v) => v > 0, "Enter an amount greater than zero."),
  // Partial releases move money on a judgement call, so the reason is mandatory.
  reason: z
    .string()
    .trim()
    .min(10, "Explain why you are releasing a partial amount.")
    .max(2000),
});

export const revisionRequestSchema = z.object({
  issue: z
    .string()
    .trim()
    .min(10, "Describe the issue specifically so it can be acted on.")
    .max(2000),
  requestedAction: z
    .string()
    .trim()
    .min(5, "State what needs to change.")
    .max(2000),
  unmetCriterionIds: z.array(z.string()).max(30).default([]),
});

export const disputeOpenSchema = z.object({
  reason: z.string().trim().min(3).max(200),
  detail: z
    .string()
    .trim()
    .min(20, "Give enough detail for this to be reviewed fairly.")
    .max(5000),
});

export const disputeResolveSchema = z
  .object({
    resolution: z.enum(["released_full", "released_partial", "refunded_full", "withdrawn", "negotiated"]),
    providerAmount: amountSchema.nullable().default(null),
    note: z.string().trim().min(10, "Record why this resolution was reached.").max(4000),
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .superRefine((value, ctx) => {
    if (value.resolution === "released_partial" && (value.providerAmount ?? 0) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerAmount"],
        message: "A partial settlement needs an amount greater than zero.",
      });
    }
  });

export const signatureSchema = z.object({
  address: addressSchema,
  signature: z.string().trim().min(4).max(1000),
  termsHash: z.string().trim().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid terms hash."),
});

export const fundingSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  fromAddress: addressSchema,
});

export const aiGenerateSchema = z.object({
  brief: z
    .string()
    .trim()
    .min(20, "Describe the project in a little more detail.")
    .max(6000),
  asset: assetSchema.default("USDC"),
  /** Optional hints the user set before generating. */
  totalAmountHint: amountSchema.nullable().default(null),
  roleHint: z.enum(["client", "provider"]).default("client"),
});

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  headline: z.string().trim().max(140).default(""),
  bio: z.string().trim().max(1000).default(""),
  professions: z.array(z.string()).max(10).default([]),
  timezone: z.string().max(64).default("UTC"),
});

export const privacyUpdateSchema = z.object({
  publicProfileEnabled: z.boolean(),
  publicMetrics: z
    .array(
      z.enum([
        "contracts_completed",
        "value_settled",
        "on_time_rate",
        "milestone_success_rate",
        "dispute_count",
        "repeat_client_rate",
        "avg_completion_days",
      ]),
    )
    .default([]),
});

export const showcaseSchema = z.object({
  agreementId: z.string().min(1),
  publicTitle: z.string().trim().min(2).max(120),
  summary: z.string().trim().max(400).default(""),
  anonymizeValue: z.boolean().default(false),
});

/** Flatten a ZodError into a field-keyed map the UI can render inline. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
