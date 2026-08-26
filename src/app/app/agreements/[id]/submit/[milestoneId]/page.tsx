import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireAuth, roleOn } from "@/lib/services/auth";
import { loadBundle } from "@/lib/services/agreements";
import { loadMilestoneDetail } from "@/lib/services/milestones";
import { milestonesRepo } from "@/lib/db/repositories";
import { SubmitPanel } from "@/components/app/submit-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Submit milestone" };

export default async function SubmitPage({
  params,
}: { params: Promise<{ id: string; milestoneId: string }> }) {
  const { id, milestoneId } = await params;
  const auth = await requireAuth();
  const bundle = loadBundle(id);

  if (!bundle) notFound();
  const role = roleOn(bundle.agreement, auth.user.id);
  if (!role) notFound();

  // Only the provider submits work. A client landing here is redirected rather
  // than shown a form they cannot use.
  if (role !== "provider") redirect(`/app/agreements/${id}`);

  const milestone = milestonesRepo.byId(milestoneId);
  if (!milestone || milestone.agreementId !== bundle.agreement.id) notFound();

  const detail = loadMilestoneDetail(milestone);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href={`/app/agreements/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {bundle.agreement.reference} — {bundle.agreement.title}
      </Link>

      <SubmitPanel
        agreementId={bundle.agreement.id}
        milestone={detail.milestone}
        previousEvidence={detail.evidence}
        revisions={detail.revisions}
        asset={bundle.agreement.asset}
        evidenceRequired={bundle.agreement.rules.evidenceRequired}
        revisionsAllowed={bundle.agreement.rules.revisionRounds}
        clientName={bundle.client?.displayName ?? "the client"}
      />
    </div>
  );
}
