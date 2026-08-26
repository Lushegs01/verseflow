import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireAuth, roleOn } from "@/lib/services/auth";
import { loadBundle } from "@/lib/services/agreements";
import { loadMilestoneDetail } from "@/lib/services/milestones";
import { remainingFor } from "@/lib/services/escrow";
import { milestonesRepo } from "@/lib/db/repositories";
import { publicChainInfo } from "@/lib/chain/config";
import { ReviewPanel } from "@/components/app/review-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review milestone" };

export default async function ReviewPage({
  params,
}: { params: Promise<{ id: string; milestoneId: string }> }) {
  const { id, milestoneId } = await params;
  const auth = await requireAuth();
  const bundle = await loadBundle(id);

  if (!bundle) notFound();
  const role = roleOn(bundle.agreement, auth.user.id);
  if (!role) notFound();

  // Reviewing is a client action. A provider cannot approve their own milestone,
  // and the route reflects that rather than only the API.
  if (role !== "client") redirect(`/app/agreements/${id}`);

  const milestone = await milestonesRepo.byId(milestoneId);
  if (!milestone || milestone.agreementId !== bundle.agreement.id) notFound();

  const detail = await loadMilestoneDetail(milestone);
  const chain = publicChainInfo();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href={`/app/agreements/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {bundle.agreement.reference} — {bundle.agreement.title}
      </Link>

      <ReviewPanel
        agreementId={bundle.agreement.id}
        milestone={detail.milestone}
        evidence={detail.evidence}
        analysis={detail.analysis}
        revisions={detail.revisions}
        asset={bundle.agreement.asset}
        remaining={await remainingFor(milestone)}
        rules={bundle.agreement.rules}
        providerName={bundle.provider?.displayName ?? "the provider"}
        chain={chain}
      />
    </div>
  );
}
