import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FlowVisual } from "@/components/marketing/flow-visual";
import {
  Section,
  ProblemSection,
  SolutionSection,
  AISection,
  EscrowSection,
  EvidenceSection,
  TrustSection,
  ReputationSection,
  VerseSection,
  FinalCTA,
} from "@/components/marketing/sections";
import { MarketingHeader } from "@/components/marketing/header";
import { publicChainInfo } from "@/lib/chain/config";

export default function LandingPage() {
  const chain = publicChainInfo();

  return (
    <div className="min-h-dvh bg-surface">
      <MarketingHeader />

      <main id="main">
        {/* ================= Hero ================= */}
        <Section className="pt-12 pb-16 sm:pt-20 sm:pb-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-raised py-1 pl-1 pr-3 text-2xs">
                <span className="rounded-full bg-primary px-2 py-0.5 font-medium text-primary-fg">
                  New
                </span>
                <span className="text-muted">Programmable escrow on {chain.name}</span>
              </div>

              <h1 className="mt-6 font-display text-5xl leading-[0.98] sm:text-6xl">
                Turn agreements into programmable payments.
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                VerseFlow helps clients and service providers turn real-world work agreements into
                transparent milestones, protected escrow, evidence-based approvals, and verifiable
                payment history.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/app/agreements/new"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-base font-medium text-primary-fg shadow-sm transition-opacity hover:opacity-90"
                >
                  Create an Agreement
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link
                  href="#how-it-works"
                  className="inline-flex h-12 items-center justify-center rounded-lg border border-line-strong px-6 text-base font-medium transition-colors hover:bg-raised"
                >
                  See how it works
                </Link>
              </div>

              <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
                {[
                  { term: "Escrow", detail: "Funded before work starts" },
                  { term: "Evidence", detail: "Hashed and timestamped" },
                  { term: "Approval", detail: "Always a human decision" },
                ].map((item) => (
                  <div key={item.term}>
                    <dt className="text-xs font-semibold">{item.term}</dt>
                    <dd className="mt-0.5 text-2xs leading-snug text-subtle">{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="lg:pl-4">
              <FlowVisual />
            </div>
          </div>
        </Section>

        {/* ================= Who it is for ================= */}
        <Section className="pb-16 sm:pb-20">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-line py-5">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-faint">
              Built for
            </p>
            {[
              "Freelancers", "Agencies", "Consultants", "Developers",
              "Designers", "Creators", "DAO contributors", "Contractors",
            ].map((role) => (
              <span key={role} className="text-sm text-subtle">{role}</span>
            ))}
          </div>
        </Section>

        <ProblemSection />
        <SolutionSection />
        <AISection />
        <EscrowSection />
        <EvidenceSection />
        <TrustSection />
        <ReputationSection />
        <VerseSection chainName={chain.name} />
        <FinalCTA />
      </main>

      <footer className="border-t border-line bg-raised">
        <Section className="py-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            <div className="max-w-xs">
              <Link href="/" className="font-display text-xl">VerseFlow</Link>
              <p className="mt-2 text-xs leading-relaxed text-subtle">
                Programmable escrow and payment orchestration for work agreements.
                Settling on {chain.name}.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
              <FooterColumn
                title="Product"
                links={[
                  { label: "Create agreement", href: "/app/agreements/new" },
                  { label: "Dashboard", href: "/app" },
                  { label: "How it works", href: "/#how-it-works" },
                ]}
              />
              <FooterColumn
                title="Trust"
                links={[
                  { label: "Trust model", href: "/#ai" },
                  { label: "Escrow contract", href: "/docs/escrow" },
                  { label: "Security", href: "/docs/security" },
                ]}
              />
              <FooterColumn
                title="Demo"
                links={[
                  { label: "Client walkthrough", href: "/api/demo/start?persona=client" },
                  { label: "Provider walkthrough", href: "/api/demo/start?persona=provider" },
                ]}
              />
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-3 border-t border-line-subtle pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-2xs text-faint">
              VerseFlow · Built for the Verse Buildathon, Payments &amp; Merchant Solutions
            </p>
            {/*
              Settlement mode is stated in the footer of every page. If the product is
              running against the local simulation, it says so -- simulated activity is
              never presented as real network activity.
            */}
            <p className="text-2xs text-faint">
              Settlement:{" "}
              <span className={chain.mode === "live" ? "text-settle" : "text-attn"}>
                {chain.mode === "live" ? `${chain.name} (live)` : "Local simulation"}
              </span>
            </p>
          </div>
        </Section>
      </footer>
    </div>
  );
}

function FooterColumn({
  title, links,
}: { title: string; links: Array<{ label: string; href: string }> }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-faint">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="group inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-fg"
            >
              {link.label}
              <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
