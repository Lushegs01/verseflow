import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireAuth, roleOn } from "@/lib/services/auth";
import { loadBundle } from "@/lib/services/agreements";
import { loadMilestoneDetail } from "@/lib/services/milestones";
import { remainingFor } from "@/lib/services/escrow";
import { disputesRepo, milestonesRepo, usersRepo, activityRepo } from "@/lib/db/repositories";
import { DisputeRoom } from "@/components/app/dispute-room";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Resolve milestone" };

export default async function DisputePage({
  params,
}: { params: Promise<{ id: string; disputeId: string }> }) {
  const { id, disputeId } = await params;
  const auth = await requireAuth();
  const bundle = loadBundle(id);

  if (!bundle) notFound();
  const role = roleOn(bundle.agreement, auth.user.id);
  if (!role && !auth.user.isAdmin) notFound();

  const dispute = disputesRepo.byId(disputeId);
  if (!dispute || dispute.agreementId !== bundle.agreement.id) notFound();

  const milestone = milestonesRepo.byId(dispute.milestoneId);
  if (!milestone) notFound();

  const detail = loadMilestoneDetail(milestone);
  const messages = disputesRepo.messages(dispute.id).map((m) => {
    const author = usersRepo.byId(m.authorId);
    return {
      ...m,
      authorName: author?.displayName ?? "Unknown",
      authorColor: author?.avatarColor ?? "#A8A49B",
      isYou: m.authorId === auth.user.id,
    };
  });

  const openedBy = usersRepo.byId(dispute.openedBy);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href={`/app/agreements/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {bundle.agreement.reference} — {bundle.agreement.title}
      </Link>

      <DisputeRoom
        agreementId={bundle.agreement.id}
        dispute={dispute}
        milestone={detail.milestone}
        evidence={detail.evidence}
        analysis={detail.analysis}
        revisions={detail.revisions}
        messages={messages}
        activity={activityRepo.forAgreement(bundle.agreement.id)}
        asset={bundle.agreement.asset}
        remaining={remainingFor(milestone)}
        viewerRole={auth.user.isAdmin && !role ? "operator" : (role ?? "client")}
        isAdmin={auth.user.isAdmin}
        clientName={bundle.client?.displayName ?? "Client"}
        providerName={bundle.provider?.displayName ?? "Provider"}
        openedByName={openedBy?.displayName ?? "A party"}
      />
    </div>
  );
}
