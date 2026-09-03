import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Lock, Shield, Scale, Sparkles, Database, Activity } from "lucide-react";
import { publicChainInfo } from "@/lib/chain/config";
import { MarketingHeader } from "@/components/marketing/header";

export const metadata: Metadata = {
  title: "How VerseFlow works",
  description:
    "The trust model, escrow architecture, and settlement design behind VerseFlow.",
};

export default function DocsPage() {
  const chain = publicChainInfo();

  return (
    <div className="min-h-dvh bg-surface">
      <MarketingHeader />

      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <h1 className="text-gradient font-display text-4xl leading-tight">How VerseFlow works</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          A short, honest description of what the product does, what it guarantees, and
          what it does not.
        </p>

        {/* ---------------- Trust model ---------------- */}
        <Section id="trust" icon={<Shield className="size-4" />} title="The trust model">
          <p>
            VerseFlow separates four things that other products tend to blur together, and
            keeps them visibly separate in the interface:
          </p>
          <Layers />
          <p>
            The practical consequence is simple: the AI in VerseFlow has no write access to
            escrow. It cannot move a milestone between states, cannot release a payment, and
            nothing downstream branches on its output to decide whether money moves. It
            produces a recommendation that a person reads.
          </p>
        </Section>

        {/* ---------------- Escrow ---------------- */}
        <Section id="escrow" icon={<Lock className="size-4" />} title="Escrow architecture">
          <p>
            When a client funds an agreement, the full contract value moves into a milestone
            escrow contract along with the per-milestone allocation and the hash of the terms
            both parties signed. The contract enforces four invariants that the application
            is not trusted to enforce on its own:
          </p>
          <ul>
            <li>
              <strong>Funds are held by the contract.</strong> There is no operator withdrawal
              path and no upgrade hatch that can move a depositor&apos;s money.
            </li>
            <li>
              <strong>Only the client can release.</strong> Neither the backend nor any AI
              component is an authorized party. On a disputed milestone, a single arbiter
              address set at deployment can settle — and only that milestone&apos;s own balance.
            </li>
            <li>
              <strong>Releases are monotonic and capped.</strong> A milestone can never pay out
              more than it was funded for, and the sum of all releases can never exceed the
              deposit.
            </li>
            <li>
              <strong>The signed terms are anchored.</strong> If the off-chain record is ever
              altered, the hashes stop matching and the discrepancy is visible to both parties.
            </li>
          </ul>
          <p>
            The contract source is in <code>contracts/VerseFlowEscrow.sol</code>. Evidence is
            anchored by hash only — no work product is written on chain.
          </p>
        </Section>

        {/* ---------------- Settlement ---------------- */}
        <Section id="settlement" icon={<Activity className="size-4" />} title="Settlement">
          <p>
            VerseFlow settles on {chain.name}, an EVM-compatible network. Milestone escrow only
            works when settlement is cheap enough to repeat and fast enough that nobody waits on
            a payment they have already been told is coming — a three-milestone agreement is at
            least four on-chain operations, and on a high-fee network the economics stop working
            for a $750 milestone.
          </p>
          <p>
            Blockchain-specific code sits behind a single <code>SettlementAdapter</code> interface.
            Services depend on that interface and never on an RPC client or a wallet object, which
            is what makes the local simulation and a live deployment genuinely interchangeable.
          </p>
          <Callout
            tone={chain.mode === "live" ? "settle" : "attn"}
            title={chain.mode === "live" ? `Running live on ${chain.name}` : "Running on the local simulation"}
          >
            {chain.mode === "live" ? (
              <>
                Transactions are real and have explorer entries. Chain ID {chain.chainId}.
              </>
            ) : (
              <>
                This deployment has no RPC endpoint or escrow address configured, so it settles on a
                deterministic local ledger that enforces the same invariants as the contract.
                Every receipt is stamped as simulated and labelled throughout the interface.
                Simulated activity is never presented as live network activity.
              </>
            )}
          </Callout>
          <p>
            A payment is only ever marked settled after the settlement layer confirms the
            transaction receipt. A wallet returning a hash means the transaction was broadcast,
            not that it succeeded.
          </p>
        </Section>

        {/* ---------------- Agreement engine ---------------- */}
        <Section id="engine" icon={<Sparkles className="size-4" />} title="The agreement engine">
          <p>
            Natural language goes in; milestones, amounts, deadlines, acceptance criteria, and
            evidence requirements come out. Everything generated lands in an editable field, and
            every suggestion is presented as an explicit accept, edit, or reject decision.
          </p>
          <p>
            There are two engines behind it. With an API key configured, a language model does the
            extraction. Without one, a deterministic rule engine handles it — phase detection,
            budget parsing, explicit payment schedules, revision counts, and ambiguity flagging.
            The rule engine is not a degraded fallback: it is why this repository can be cloned
            and run end to end with no keys at all. The interface always states which engine
            produced a given result.
          </p>
          <p>
            Evidence analysis follows the same rule. It never claims certainty: criteria it cannot
            check from the submitted evidence are marked unverified rather than quietly passed,
            and confidence reflects coverage rather than conviction.
          </p>
        </Section>

        {/* ---------------- Disputes ---------------- */}
        <Section id="disputes" icon={<Scale className="size-4" />} title="Disputes">
          <p>
            Either party can freeze a milestone. While it is frozen, no funds can be released by
            anyone. Most disagreements resolve through a revision round or an agreed partial
            release; escalation is the last option, not the first.
          </p>
          <Callout tone="neutral" title="Arbitration here is operator-mediated">
            VerseFlow does not have a decentralized arbitration layer, and does not claim one. The
            escrow contract has a single arbiter address set at deployment. It can act only on a
            milestone a party explicitly flagged, can only split that milestone&apos;s own balance
            between the two parties, cannot touch other milestones, and cannot pay itself. Every
            resolution writes an immutable audit event visible to both sides.
          </Callout>
        </Section>

        {/* ---------------- Data ---------------- */}
        <Section id="data" icon={<Database className="size-4" />} title="Data and privacy">
          <p>
            Reputation is computed from settled contract history at request time — never written
            by a seed or a batch job. Nothing is self-reported, which is what makes it worth
            anything.
          </p>
          <p>
            It is also private by default. A public profile is opt-in, each metric is published
            individually, and showcased agreements can have their value hidden behind a range.
            Counterparty identities, acceptance criteria, evidence, and messages are never
            published. A profile that has not opted in returns a 404 rather than a &ldquo;this user
            is private&rdquo; page, because the absence of a public profile is itself private.
          </p>
          <p>
            The payment ledger and audit log are append-only at the database level, enforced by
            triggers rather than convention. Confirmed payments reject any change to their
            amount, recipient, or transaction hash — including from an operator.
          </p>
        </Section>

        <div className="mt-12 border-t border-line pt-8">
          <Link
            href="/app/agreements/new"
            className="inline-flex h-11 items-center gap-2 rounded-lg face-primary sheen px-5 text-sm font-medium text-primary-fg transition-transform duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-px active:translate-y-0"
          >
            Create an agreement
          </Link>
          <Link
            href="/"
            className="ml-3 inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm text-muted transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back home
          </Link>
        </div>
      </main>
    </div>
  );
}

function Section({
  id, icon, title, children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-20">
      <h2 className="flex items-center gap-2 font-display text-2xl">
        <span className="text-faint" aria-hidden>{icon}</span>
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-base leading-relaxed text-muted [&_code]:rounded [&_code]:bg-inset [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm [&_li]:leading-relaxed [&_strong]:font-medium [&_strong]:text-fg [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

function Layers() {
  const layers = [
    { label: "AI recommendation", body: "Structures terms and reads evidence against criteria. Advisory only." },
    { label: "Contract rule", body: "What the two parties agreed: amounts, windows, revision limits, evidence requirements." },
    { label: "Human approval", body: "A person with the authority decides. The client releases; nobody releases for them." },
    { label: "On-chain settlement", body: "The escrow contract executes only what an authorized party signed for." },
  ];

  return (
    <ol className="not-prose my-5 space-y-2">
      {layers.map((layer, i) => (
        <li key={layer.label} className="panel flex gap-3 rounded-xl p-4">
          <span className="font-mono text-2xs text-faint" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg">{layer.label}</span>
            <span className="mt-0.5 block text-sm text-subtle">{layer.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Callout({
  tone, title, children,
}: {
  tone: "neutral" | "settle" | "attn";
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    neutral: "border-line bg-inset",
    settle: "border-settle-border bg-settle-soft",
    attn: "border-attn-border bg-attn-soft",
  }[tone];

  return (
    <div className={`not-prose my-5 rounded-lg border p-4 ${styles}`}>
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}
