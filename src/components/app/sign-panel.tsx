"use client";

/**
 * Agreement Lock.
 *
 * The last screen before money is committed. It restates the exact terms both
 * parties are signing in human-readable form, shows the hash those terms produce,
 * and makes the on-chain / off-chain boundary explicit.
 *
 * Nothing here is summarized or elided -- a party signing must be able to see
 * every term that affects payment.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { PenLine, Lock, Check, ShieldCheck, Info, Loader2 } from "lucide-react";
import { Card, Button, Badge, Alert, Mono, useToast, Modal } from "@/components/ui";
import { formatMoney } from "@/lib/domain/money";
import { shortHash, shortAddress } from "@/lib/domain/hashing";
import { formatDate } from "@/lib/utils/format";
import { api, trackEvent } from "@/lib/utils/api-client";
import type { AgreementRules } from "@/lib/domain/types";

interface SignPanelProps {
  agreementId: string;
  reference: string;
  title: string;
  status: string;
  totalAmount: number;
  asset: string;
  milestones: Array<{ id: string; title: string; amount: number; dueAt: string | null }>;
  rules: AgreementRules;
  role: "client" | "provider";
  clientName: string;
  providerName: string;
  clientAddress: string | null;
  providerAddress: string | null;
  clientSigned: boolean;
  providerSigned: boolean;
  expectedCompletionAt: string | null;
}

export function SignAgreementPanel(props: SignPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [signing, setSigning] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [termsHash, setTermsHash] = React.useState<string | null>(null);
  const [signMessage, setSignMessage] = React.useState<string | null>(null);
  const [loadingHash, setLoadingHash] = React.useState(true);

  const youSigned = props.role === "client" ? props.clientSigned : props.providerSigned;
  const otherSigned = props.role === "client" ? props.providerSigned : props.clientSigned;
  const isDraft = props.status === "draft";

  // Fetch the exact hash this party will sign. Recomputed server-side from the
  // stored terms, so what is displayed is what gets signed.
  React.useEffect(() => {
    if (isDraft) { setLoadingHash(false); return; }
    let cancelled = false;
    (async () => {
      const result = await api.get<{ termsHash: string; message: string }>(
        `/api/agreements/${props.agreementId}/sign`,
      );
      if (cancelled) return;
      if (result.ok) {
        setTermsHash(result.data.termsHash);
        setSignMessage(result.data.message);
      }
      setLoadingHash(false);
    })();
    return () => { cancelled = true; };
  }, [props.agreementId, isDraft]);

  const sendForSignature = async () => {
    setSending(true);
    const result = await api.post(`/api/agreements/${props.agreementId}/send`);
    if (result.ok) {
      toast({ tone: "settle", title: "Sent for signature", body: "Both parties can now sign." });
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not send", body: result.error.message });
    }
    setSending(false);
  };

  const sign = async () => {
    if (!termsHash || !signMessage) return;
    setSigning(true);
    setConfirmOpen(false);

    const address = props.role === "client" ? props.clientAddress : props.providerAddress;
    if (!address) {
      toast({ tone: "danger", title: "No wallet address", body: "Add a wallet address before signing." });
      setSigning(false);
      return;
    }

    let signature: string;
    const ethereum = (window as unknown as {
      ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
    }).ethereum;

    if (ethereum) {
      try {
        signature = (await ethereum.request({
          method: "personal_sign",
          params: [signMessage, address],
        })) as string;
      } catch {
        toast({ tone: "attn", title: "Signature cancelled", body: "Nothing was committed." });
        setSigning(false);
        return;
      }
    } else {
      // No injected wallet: the demo personas sign with a clearly-marked
      // simulated signature. The server records the method, so the UI can always
      // say which kind of signature was used.
      signature = `simulated:${props.role}:${Date.now()}`;
    }

    const result = await api.post<{ bothSigned: boolean }>(
      `/api/agreements/${props.agreementId}/sign`,
      { address, signature, termsHash },
    );

    if (result.ok) {
      trackEvent("agreement_signed", { role: props.role }, props.agreementId);
      toast({
        tone: "settle",
        title: result.data.bothSigned ? "Agreement locked" : "Signature recorded",
        body: result.data.bothSigned
          ? "Both parties signed. The terms are now immutable."
          : "Waiting for the other party to sign.",
      });
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not sign", body: result.error.message });
    }
    setSigning(false);
  };

  return (
    <Card className="overflow-hidden">
      <header className="border-b border-line-subtle bg-inset px-5 py-4">
        <h2 className="font-display text-2xl">Agreement Lock</h2>
        <p className="mt-1 text-xs text-subtle">
          {isDraft
            ? "Review the terms, then send them for signature."
            : "Both parties are signing these exact terms."}
        </p>
      </header>

      <div className="p-5">
        {/* ---------- Parties and value ---------- */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <SummaryItem label="Client" value={props.clientName}>
            {props.clientAddress ? (
              <Mono value={props.clientAddress} display={shortAddress(props.clientAddress, 4)} label="client address" />
            ) : (
              <span className="text-2xs text-faint">No address</span>
            )}
          </SummaryItem>

          <SummaryItem label="Provider" value={props.providerName}>
            {props.providerAddress ? (
              <Mono value={props.providerAddress} display={shortAddress(props.providerAddress, 4)} label="provider address" />
            ) : (
              <span className="text-2xs text-faint">No address</span>
            )}
          </SummaryItem>

          <SummaryItem label="Contract value" value={formatMoney(props.totalAmount, props.asset)} />

          <SummaryItem
            label="Milestones"
            value={String(props.milestones.length)}
          >
            {props.expectedCompletionAt ? (
              <span className="text-2xs text-faint">
                Expected {formatDate(props.expectedCompletionAt)}
              </span>
            ) : null}
          </SummaryItem>
        </dl>

        {/* ---------- Payment schedule ---------- */}
        <section className="mt-6">
          <h3 className="text-2xs font-medium uppercase tracking-wider text-faint">
            Payment schedule
          </h3>
          <ul className="mt-2.5 divide-y divide-line-subtle rounded-lg border border-line">
            {props.milestones.map((m) => (
              <li key={m.id} className="flex items-baseline gap-3 px-3.5 py-2.5">
                <span className="text-sm font-semibold tabular">
                  {formatMoney(m.amount, props.asset)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{m.title}</span>
                {m.dueAt ? (
                  <span className="shrink-0 text-2xs text-faint">{formatDate(m.dueAt)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- Rules ---------- */}
        <section className="mt-6">
          <h3 className="text-2xs font-medium uppercase tracking-wider text-faint">
            Agreement rules
          </h3>
          <ul className="mt-2.5 space-y-1.5">
            {[
              `${props.rules.revisionRounds} revision round${props.rules.revisionRounds === 1 ? "" : "s"} per milestone`,
              `${props.rules.approvalWindowHours}-hour approval window`,
              props.rules.evidenceRequired
                ? "Evidence required for each milestone"
                : "Evidence optional",
              `Disputes must be opened within ${props.rules.disputeWindowHours} hours`,
              props.rules.partialReleaseAllowed
                ? "Partial release permitted, with a stated reason"
                : "Partial release not permitted",
              ...props.rules.additionalTerms,
            ].map((rule, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
                <span className="text-muted">{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- Hash ---------- */}
        {!isDraft ? (
          <section className="mt-6 rounded-lg border border-line bg-inset p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-medium">
                <ShieldCheck className="size-3.5 text-accent" aria-hidden />
                Terms hash
              </h3>
              {loadingHash ? (
                <Loader2 className="size-3.5 animate-spin text-faint" aria-hidden />
              ) : termsHash ? (
                <Mono value={termsHash} display={shortHash(termsHash, 8)} label="terms hash" />
              ) : (
                <span className="text-2xs text-faint">Unavailable</span>
              )}
            </div>
            <p className="mt-2 text-2xs leading-relaxed text-subtle">
              This hash covers every term above. Both signatures are bound to it, and it is
              written into the escrow contract at funding — so if the stored terms ever
              diverge from what was signed, the mismatch is detectable.
            </p>
          </section>
        ) : null}

        {/* ---------- On-chain / off-chain boundary ---------- */}
        <section className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-locked-border bg-locked-soft p-3.5">
            <p className="flex items-center gap-1.5 text-2xs font-semibold text-locked">
              <Lock className="size-3" aria-hidden />
              Recorded on chain
            </p>
            <ul className="mt-1.5 space-y-0.5 text-2xs leading-relaxed text-muted">
              <li>Terms hash and agreement id</li>
              <li>Escrowed amount and per-milestone allocation</li>
              <li>Every release, with recipient and amount</li>
              <li>Evidence bundle hashes</li>
            </ul>
          </div>

          <div className="rounded-lg border border-line bg-inset p-3.5">
            <p className="flex items-center gap-1.5 text-2xs font-semibold text-subtle">
              <Info className="size-3" aria-hidden />
              Kept off chain
            </p>
            <ul className="mt-1.5 space-y-0.5 text-2xs leading-relaxed text-muted">
              <li>Full agreement text and acceptance criteria</li>
              <li>Uploaded files and evidence content</li>
              <li>Messages and revision requests</li>
              <li>Personal profile information</li>
            </ul>
          </div>
        </section>

        {/* ---------- Signature status ---------- */}
        {!isDraft ? (
          <section className="mt-6 space-y-2">
            <SignatureRow name={props.clientName} label="Client" signed={props.clientSigned} />
            <SignatureRow name={props.providerName} label="Provider" signed={props.providerSigned} />
          </section>
        ) : null}
      </div>

      {/* ---------- Actions ---------- */}
      <footer className="border-t border-line-subtle bg-inset p-4">
        {isDraft ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-subtle">
              Sending locks editing while signatures are collected.
            </p>
            <Button variant="primary" loading={sending} onClick={sendForSignature}>
              Send for signature
            </Button>
          </div>
        ) : youSigned ? (
          <Alert tone={otherSigned ? "settle" : "attn"} title={otherSigned ? "Both parties have signed" : "Waiting for the other party"}>
            {otherSigned
              ? "The terms are locked and the agreement is ready for funding."
              : `You signed these terms. ${props.role === "client" ? props.providerName : props.clientName} has not signed yet.`}
          </Alert>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-subtle">
              Signing binds you to the exact terms above.
            </p>
            <Button
              variant="primary"
              icon={<PenLine className="size-4" />}
              loading={signing}
              loadingText="Waiting for signature…"
              disabled={loadingHash || !termsHash}
              onClick={() => setConfirmOpen(true)}
            >
              {props.role === "client" ? "Client: Sign agreement" : "Provider: Sign agreement"}
            </Button>
          </div>
        )}
      </footer>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Sign these terms"
        description="This is what your signature commits you to."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<PenLine className="size-4" />} onClick={sign}>
              Sign agreement
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            You are signing <strong className="text-fg">{props.reference} — {props.title}</strong> for{" "}
            <strong className="text-fg">{formatMoney(props.totalAmount, props.asset)}</strong> across{" "}
            {props.milestones.length} milestone{props.milestones.length === 1 ? "" : "s"}.
          </p>
          <div className="rounded-lg border border-line bg-inset p-3">
            <p className="text-2xs text-faint">Terms hash</p>
            <p className="mt-0.5 break-all font-mono text-2xs">{termsHash}</p>
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            Signing does not move any funds. Escrow is funded as a separate action by
            the client after both signatures are in.
          </p>
        </div>
      </Modal>
    </Card>
  );
}

function SummaryItem({
  label, value, children,
}: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold">{value}</dd>
      {children ? <div className="mt-0.5">{children}</div> : null}
    </div>
  );
}

function SignatureRow({ name, label, signed }: { name: string; label: string; signed: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-2.5">
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
          signed ? "border-settle-border bg-settle-soft text-settle" : "border-line bg-inset text-faint"
        }`}
        aria-hidden
      >
        {signed ? <Check className="size-3" /> : <PenLine className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xs text-faint">{label}</span>
        <span className="block truncate text-sm">{name}</span>
      </span>
      <Badge tone={signed ? "settle" : "neutral"}>{signed ? "Signed" : "Awaiting signature"}</Badge>
    </div>
  );
}
