import type { Metadata } from "next";
import { requireAuth } from "@/lib/services/auth";
import { walletsRepo } from "@/lib/db/repositories";
import { AgreementBuilder } from "@/components/app/builder/builder";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create an agreement" };

export default async function NewAgreementPage() {
  const auth = await requireAuth();
  const wallets = await walletsRepo.forUser(auth.user.id);

  return (
    <AgreementBuilder
      userAddress={wallets[0]?.address ?? auth.address}
      userName={auth.user.displayName}
    />
  );
}
