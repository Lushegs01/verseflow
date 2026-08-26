"use client";

/**
 * Escrow funding.
 *
 * The states here are real, not decorative: preparing, awaiting the wallet,
 * confirming on the network, and finally funded. A transaction is only ever shown
 * as funded after the server has verified the receipt -- a wallet returning a hash
 * moves us to "confirming", never to "done".
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  Lock, Wallet, Loader2, Check, AlertCircle, ExternalLink, ArrowRight, ShieldCheck,
} from "lucide-react";
import { Card, Button, Alert, Mono, Badge, useToast } from "@/components/ui";
import { formatMoney } from "@/lib/domain/money";
import { shortHash, shortAddress } from "@/lib/domain/hashing";
import { api, pollUntil, makeIdempotencyKey, trackEvent } from "@/lib/utils/api-client";

type Stage =
  | "review"        // showing what is about to happen
  | "preparing"     // asking the server for the transaction
  | "awaiting"      // waiting on the wallet signature
  | "confirming"    // broadcast, waiting for the network
  | "funded"
  | "failed";

interface PreparedTx {
  to: string | null;
  data: string | null;
  value: string;
  chainId: number;
  summary: string;
  simulatedReceipt: { txHash: string } | null;
}

interface Intent {
  escrowAddress: string | null;
  onChainId: string;
  termsHash: string;
  chainId: number;
  mode: "simulated" | "live";
  transaction: PreparedTx;
}

export function FundingFlow({
  agreementId, reference, title, totalAmount, asset, milestones,
  clientAddress, providerName, providerAddress, chain,
}: {
  agreementId: string;
  reference: string;
  title: string;
  totalAmount: number;
  asset: string;
  milestones: Array<{ id: string; title: string; amount: number }>;
  clientAddress: string | null;
  providerName: string;
  providerAddress: string | null;
  chain: { mode: "simulated" | "live"; name: string; explorerUrl: string; hasExplorer: boolean };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const reduced = useReducedMotion();

  const [stage, setStage] = React.useState<Stage>("review");
  const [intent, setIntent] = React.useState<Intent | null>(null);
  const [txHash, setTxHash] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);
  const [fundedAt, setFundedAt] = React.useState<string | null>(null);

  // Generated once and reused across retries, so a repeated attempt after a
  // dropped response can never fund twice.
  const idempotencyKey = React.useRef(makeIdempotencyKey("fund"));

  const fund = async () => {
    setError(null);
    setStage("preparing");

    if (!clientAddress) {
      setError({ message: "No wallet address on file.", hint: "Add a wallet in Settings before funding." });
      setStage("failed");
      return;
    }

    const prepared = await api.post<{ intent: Intent }>(`/api/agreements/${agreementId}/fund`, {
      idempotencyKey: idempotencyKey.current,
      fromAddress: clientAddress,
    });

    if (!prepared.ok) {
      setError({ message: prepared.error.message, hint: prepared.error.hint });
      setStage("failed");
      return;
    }

    setIntent(prepared.data.intent);
    const tx = prepared.data.intent.transaction;

    let hash: string;

    if (tx.simulatedReceipt) {
      // Simulated settlement: the adapter already produced a receipt to verify.
      hash = tx.simulatedReceipt.txHash;
      setStage("confirming");
    } else {
      // Live settlement: the user's own wallet signs. The server holds no key.
      setStage("awaiting");
      const ethereum = (window as unknown as {
        ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      }).ethereum;

      if (!ethereum) {
        setError({
          message: "Your wallet was disconnected.",
          hint: "Reconnect to continue. No funds have moved.",
        });
        setStage("failed");
        return;
      }

      try {
        hash = (await ethereum.request({
          method: "eth_sendTransaction",
          params: [{
            from: clientAddress,
            to: tx.to,
            data: tx.data,
            value: tx.value === "0" ? undefined : `0x${BigInt(tx.value).toString(16)}`,
          }],
        })) as string;
        setStage("confirming");
      } catch (walletError) {
        const message = walletError instanceof Error ? walletError.message : "";
        setError({
          message: /reject|denied|cancell/i.test(message)
            ? "You cancelled the transaction."
            : "The transaction was not completed.",
          hint: "Your funds remain in your wallet.",
        });
        setStage("failed");
        return;
      }
    }

    setTxHash(hash);

    // Verify against the settlement layer. This is the only thing that can mark
    // the agreement funded.
    const confirmed = await pollUntil(
      () => api.post<{ status: string; reason: string | null }>(
        `/api/agreements/${agreementId}/fund/confirm`,
        { txHash: hash },
      ),
      (data) => data.status === "confirmed" || data.status === "failed",
      { intervalMs: 900, maxAttempts: 45 },
    );

    if (!confirmed.ok) {
      setError({ message: confirmed.error.message, hint: confirmed.error.hint });
      setStage("failed");
      return;
    }

    if (confirmed.data.status === "failed") {
      setError({
        message: "The transaction was not completed.",
        hint: confirmed.data.reason ?? "Your funds remain in your wallet.",
      });
      setStage("failed");
      return;
    }

    setFundedAt(new Date().toISOString());
    setStage("funded");
    trackEvent("escrow_funded", { amount: totalAmount, asset }, agreementId);
    toast({
      tone: "settle",
      title: "Escrow funded",
      body: `${formatMoney(totalAmount, asset)} is now secured.`,
    });
    router.refresh();
  };

  // ---------------------------------------------------------------- Success

  if (stage === "funded") {
    return (
      <div className="mt-6">
        <Card className="overflow-hidden">
          <div className="border-b border-line-subtle bg-settle-soft px-5 py-8 text-center">
            <motion.span
              className="mx-auto flex size-14 items-center justify-center rounded-full bg-settle text-white"
              initial={reduced ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <Check className="size-7" aria-hidden />
            </motion.span>
            <h1 className="mt-4 font-display text-2xl">Escrow funded</h1>
            <p className="mt-1.5 text-sm text-muted">
              {formatMoney(totalAmount, asset)} is locked until milestone conditions are satisfied.
            </p>
          </div>

          <div className="space-y-2.5 p-5">
            <DetailRow label="Agreement">{reference}</DetailRow>
            <DetailRow label="Amount">{formatMoney(totalAmount, asset)}</DetailRow>
            <DetailRow label="Network">
              {chain.mode === "live" ? chain.name : "Local simulation"}
            </DetailRow>
            {intent?.escrowAddress ? (
              <DetailRow label="Escrow address">
                <Mono value={intent.escrowAddress} display={shortAddress(intent.escrowAddress, 5)} label="escrow address" />
              </DetailRow>
            ) : null}
            {txHash ? (
              <DetailRow label="Transaction">
                {chain.hasExplorer ? (
                  <a
                    href={`${chain.explorerUrl.replace(/\/$/, "")}/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-2xs text-accent hover:underline"
                  >
                    {shortHash(txHash, 6)}
                    <ExternalLink className="size-2.5" aria-hidden />
                  </a>
                ) : (
                  <Mono value={txHash} display={shortHash(txHash, 6)} label="transaction hash" />
                )}
              </DetailRow>
            ) : null}
            {fundedAt ? (
              <DetailRow label="Funded at">
                {new Date(fundedAt).toLocaleString("en-US", {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                })}
              </DetailRow>
            ) : null}
          </div>

          <div className="border-t border-line-subtle p-4">
            <Button
              variant="primary"
              fullWidth
              iconRight={<ArrowRight className="size-4" />}
              onClick={() => router.push(`/app/agreements/${agreementId}`)}
            >
              Go to the agreement
            </Button>
          </div>
        </Card>

        {chain.mode === "simulated" ? (
          <p className="mt-3 text-center text-2xs leading-relaxed text-faint">
            Settled on the local simulation. This is not a live network transaction
            and has no explorer entry.
          </p>
        ) : null}
      </div>
    );
  }

  // ---------------------------------------------------------------- Working

  const working = stage === "preparing" || stage === "awaiting" || stage === "confirming";

  return (
    <div className="mt-6">
      <Card className="overflow-hidden">
        <header className="border-b border-line-subtle bg-inset px-5 py-4">
          <h1 className="font-display text-2xl">Escrow funding</h1>
          <p className="mt-1 text-xs text-subtle">{reference} — {title}</p>
        </header>

        <div className="p-5">
          {/* --- Amount --- */}
          <div className="rounded-xl border border-locked-border bg-locked-soft p-5 text-center">
            <p className="text-2xs text-muted">Amount to lock</p>
            <p className="mt-1 text-4xl font-semibold tabular">
              {formatMoney(totalAmount, asset)}
            </p>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted">
              <Lock className="size-3" aria-hidden />
              Locked until milestone conditions are satisfied
            </p>
          </div>

          {/* --- Allocation --- */}
          <section className="mt-5">
            <h2 className="text-2xs font-medium uppercase tracking-wider text-faint">
              How it is allocated
            </h2>
            <ul className="mt-2 divide-y divide-line-subtle rounded-lg border border-line">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-baseline gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{m.title}</span>
                  <span className="text-sm font-semibold tabular">
                    {formatMoney(m.amount, asset)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs text-faint">
              Each milestone can only ever release the amount allocated to it.
            </p>
          </section>

          {/* --- Wallet --- */}
          <section className="mt-5 space-y-2">
            <WalletRow label="Funding from" address={clientAddress} name="Your wallet" />
            <WalletRow label="Provider" address={providerAddress} name={providerName} />
          </section>

          {/* --- Live state --- */}
          {working ? (
            <div className="mt-5 rounded-lg border border-accent-border bg-accent-soft p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden />
                <div className="min-w-0" role="status" aria-live="polite">
                  <p className="text-sm font-medium">
                    {stage === "preparing" && "Preparing the transaction…"}
                    {stage === "awaiting" && "Awaiting wallet confirmation"}
                    {stage === "confirming" && `Confirming on ${chain.mode === "live" ? chain.name : "the simulated network"}`}
                  </p>
                  <p className="mt-0.5 text-2xs text-muted">
                    {stage === "awaiting"
                      ? "Approve the transaction in your wallet."
                      : stage === "confirming"
                        ? "Waiting for the network to confirm. Do not close this page."
                        : "One moment."}
                  </p>
                </div>
              </div>

              {txHash ? (
                <div className="mt-3 border-t border-accent-border pt-2.5">
                  <Mono value={txHash} display={shortHash(txHash, 6)} label="transaction hash" />
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <Alert
              tone="danger"
              title={error.message}
              className="mt-5"
              icon={<AlertCircle className="size-4" />}
            >
              {error.hint}
            </Alert>
          ) : null}
        </div>

        <footer className="border-t border-line-subtle bg-inset p-4">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            icon={<Wallet className="size-4" />}
            loading={working}
            loadingText={
              stage === "awaiting" ? "Awaiting wallet…" :
              stage === "confirming" ? "Confirming…" : "Preparing…"
            }
            onClick={fund}
          >
            {stage === "failed" ? "Try again" : `Fund ${formatMoney(totalAmount, asset)}`}
          </Button>

          <p className="mt-3 flex items-start gap-1.5 text-2xs leading-relaxed text-faint">
            <ShieldCheck className="mt-px size-3 shrink-0" aria-hidden />
            Funds go to the escrow contract, not to VerseFlow. Releases require your
            authorization, milestone by milestone.
          </p>
        </footer>
      </Card>

      {chain.mode === "simulated" ? (
        <div className="mt-3">
          <Badge tone="attn">Simulated settlement</Badge>
          <p className="mt-1.5 text-2xs leading-relaxed text-faint">
            This environment settles on a local ledger that enforces the same rules as the
            escrow contract. No live network transaction is created, and nothing here is
            presented as one.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-subtle">{label}</span>
      <span className="min-w-0 text-right text-xs font-medium">{children}</span>
    </div>
  );
}

function WalletRow({ label, address, name }: { label: string; address: string | null; name: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-2.5">
      <Wallet className="size-3.5 shrink-0 text-faint" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-2xs text-faint">{label}</span>
        <span className="block truncate text-sm">{name}</span>
      </span>
      {address ? (
        <Mono value={address} display={shortAddress(address, 4)} label={label} />
      ) : (
        <span className="text-2xs text-danger">No address</span>
      )}
    </div>
  );
}
