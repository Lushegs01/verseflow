import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireAuth, roleOn } from "@/lib/services/auth";
import { loadBundle } from "@/lib/services/agreements";
import { publicChainInfo } from "@/lib/chain/config";
import { FundingFlow } from "@/components/app/funding-flow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fund escrow" };

export default async function FundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  const bundle = await loadBundle(id);

  if (!bundle) notFound();
  const role = roleOn(bundle.agreement, auth.user.id);
  if (!role) notFound();

  // Funding is a client action; a provider landing here goes back to the agreement.
  if (role !== "client") redirect(`/app/agreements/${id}`);

  // Already funded, or not yet ready: there is nothing to do on this screen.
  if (bundle.agreement.status !== "awaiting_funding") {
    redirect(`/app/agreements/${id}`);
  }

  const chain = publicChainInfo();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href={`/app/agreements/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to agreement
      </Link>

      <FundingFlow
        agreementId={bundle.agreement.id}
        reference={bundle.agreement.reference}
        title={bundle.agreement.title}
        totalAmount={bundle.agreement.totalAmount}
        asset={bundle.agreement.asset}
        milestones={bundle.milestones.map((m) => ({
          id: m.id, title: m.title, amount: m.amount,
        }))}
        clientAddress={bundle.clientAddress}
        providerName={bundle.provider?.displayName ?? "Provider"}
        providerAddress={bundle.providerAddress}
        chain={chain}
      />
    </div>
  );
}
