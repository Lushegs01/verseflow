/**
 * Presentation helpers shared by server and client components.
 *
 * Copy rule from the product brief: plain language in the interface, blockchain
 * vocabulary available in secondary technical detail. "Fund escrow", not
 * "initialize smart contract funding".
 */

import type {
  AgreementStatus,
  MilestoneStatus,
  EvidenceKind,
  ActivityType,
  PaymentStatus,
} from "@/lib/domain/types";
import type { BadgeTone } from "@/components/ui";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function formatDate(iso: string | null, opts: { withYear?: boolean } = {}): string {
  if (!iso) return "--";
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.withYear ? { year: "numeric" } : {}),
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "in 3 days", "2 hours ago", "just now". */
export function relativeTime(iso: string | null): string {
  if (!iso) return "--";
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const minute = 60_000, hour = 3_600_000, day = 86_400_000;

  if (abs < minute) return "just now";

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < hour) return rtf.format(Math.round(diff / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  if (abs < day * 30) return rtf.format(Math.round(diff / day), "day");
  return rtf.format(Math.round(diff / (day * 30)), "month");
}

/** Countdown used for approval windows: "18h left", "Overdue by 2d". */
export function timeRemaining(iso: string | null): { label: string; overdue: boolean } {
  if (!iso) return { label: "No deadline", overdue: false };
  const diff = Date.parse(iso) - Date.now();
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 3_600_000);
  const days = Math.floor(hours / 24);

  const magnitude = days >= 1 ? `${days}d` : hours >= 1 ? `${hours}h` : `${Math.max(1, Math.floor(abs / 60_000))}m`;
  return { label: overdue ? `Overdue by ${magnitude}` : `${magnitude} left`, overdue };
}

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

export const AGREEMENT_STATUS_META: Record<
  AgreementStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  draft: { label: "Draft", tone: "neutral", description: "Terms are still being written." },
  awaiting_signature: { label: "Awaiting signature", tone: "attn", description: "Waiting for both parties to sign." },
  awaiting_funding: { label: "Awaiting funding", tone: "attn", description: "Signed. The client needs to fund escrow." },
  funded: { label: "Funded", tone: "locked", description: "Money is secured in escrow." },
  in_progress: { label: "In progress", tone: "accent", description: "Work is underway." },
  completed: { label: "Completed", tone: "settle", description: "Every milestone settled." },
  cancelled: { label: "Cancelled", tone: "neutral", description: "This agreement was cancelled." },
  paused: { label: "Paused", tone: "attn", description: "Paused pending review." },
  disputed: { label: "Disputed", tone: "danger", description: "A dispute is being reviewed." },
};

export const MILESTONE_STATUS_META: Record<
  MilestoneStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  locked: { label: "Locked", tone: "neutral", description: "Starts once the previous milestone settles." },
  in_progress: { label: "In progress", tone: "accent", description: "Work is underway." },
  submitted: { label: "Submitted", tone: "attn", description: "Submitted, analysis running." },
  under_review: { label: "Ready for review", tone: "attn", description: "Waiting on the client." },
  revision_requested: { label: "Revision requested", tone: "attn", description: "Changes were requested." },
  approved: { label: "Approved", tone: "settle", description: "Approved, payment settling." },
  partially_approved: { label: "Partially approved", tone: "locked", description: "Part released, remainder still locked." },
  released: { label: "Paid", tone: "settle", description: "Payment reached the provider." },
  disputed: { label: "Disputed", tone: "danger", description: "Paused while the dispute is reviewed." },
  cancelled: { label: "Cancelled", tone: "neutral", description: "This milestone was cancelled." },
};

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "attn" },
  submitted: { label: "Confirming", tone: "attn" },
  confirmed: { label: "Settled", tone: "settle" },
  failed: { label: "Failed", tone: "danger" },
};

export const EVIDENCE_META: Record<EvidenceKind, { label: string; short: string }> = {
  github_repo: { label: "GitHub repository", short: "GitHub" },
  github_commits: { label: "Commit history", short: "Commits" },
  deployment_url: { label: "Deployment", short: "Deployment" },
  figma: { label: "Figma file", short: "Figma" },
  document: { label: "Document", short: "Document" },
  file: { label: "File upload", short: "Files" },
  screenshot: { label: "Screenshots", short: "Screenshots" },
  note: { label: "Written note", short: "Note" },
  link: { label: "Link", short: "Link" },
};

export const ACTIVITY_META: Record<ActivityType, { tone: BadgeTone; icon: string }> = {
  agreement_created: { tone: "neutral", icon: "file" },
  agreement_updated: { tone: "neutral", icon: "edit" },
  ai_agreement_generated: { tone: "accent", icon: "sparkles" },
  agreement_signed: { tone: "accent", icon: "pen" },
  agreement_locked: { tone: "locked", icon: "lock" },
  escrow_created: { tone: "locked", icon: "vault" },
  escrow_funded: { tone: "locked", icon: "vault" },
  milestone_started: { tone: "accent", icon: "play" },
  milestone_submitted: { tone: "attn", icon: "upload" },
  evidence_uploaded: { tone: "neutral", icon: "paperclip" },
  evidence_analyzed: { tone: "accent", icon: "scan" },
  milestone_approved: { tone: "settle", icon: "check" },
  milestone_partially_approved: { tone: "locked", icon: "split" },
  payment_released: { tone: "settle", icon: "banknote" },
  payment_failed: { tone: "danger", icon: "alert" },
  revision_requested: { tone: "attn", icon: "rotate" },
  revision_submitted: { tone: "accent", icon: "upload" },
  dispute_opened: { tone: "danger", icon: "scale" },
  dispute_message: { tone: "neutral", icon: "message" },
  dispute_resolved: { tone: "settle", icon: "handshake" },
  agreement_completed: { tone: "settle", icon: "flag" },
  agreement_cancelled: { tone: "neutral", icon: "x" },
  agreement_paused: { tone: "attn", icon: "pause" },
  admin_action: { tone: "attn", icon: "shield" },
};

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/** Turn a snake_case enum into readable text. */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
