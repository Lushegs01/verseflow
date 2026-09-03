import Link from "next/link";
import { ArrowRight, ArrowUpRight, Lock, ShieldCheck, Zap } from "lucide-react";
import { BrandLockup } from "@/components/ui";
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

  const HERO_PROOF = [
    { icon: Lock, term: "Escrow", detail: "Funded before work starts" },
    { icon: ShieldCheck, term: "Evidence", detail: "Hashed and timestamped" },
    { icon: Zap, term: "Approval", detail: "Always a human decision" },
  ];

  return (
    <div className="min-h-dvh bg-surface">
      <MarketingHeader />

      <main id="main">
        {/* ================= Hero =================
            The only place on the site with ambient light behind it. Everything
            below is flat by comparison, which is what makes this read as the
            top of the page rather than one section among many. */}
        <div className="relative isolate overflow-hidden">
          <div className="aurora" aria-hidden />
          <div className="noise absolute inset-0" aria-hidden />

          <Section className="relative pt-12 pb-16 sm:pt-20 sm:pb-24">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
              <div>
                <div className="panel sheen inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-2xs">
                  <span className="face-primary rounded-full px-2 py-0.5 font-medium text-primary-fg">
                    New
                  </span>
                  <span className="text-muted">Programmable escrow on {chain.name}</span>
                  <span className="size-1 rounded-full bg-settle shadow-[0_0_6px_0_var(--settle)]" aria-hidden />
                </div>

                {/* One italic phrase carries the promise; the rest stays roman and
                    fades a shade toward the page as it descends. */}
                <h1 className="text-gradient mt-6 font-display text-5xl leading-[0.98] sm:text-6xl">
                  Turn agreements into{" "}
                  <em className="text-brand-gradient">programmable</em> payments.
                </h1>

                <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                  VerseFlow helps clients and service providers turn real-world work agreements into
                  transparent milestones, protected escrow, evidence-based approvals, and verifiable
                  payment history.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/app/agreements/new"
                    className="face-primary sheen group inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-base font-medium text-primary-fg transition-transform duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 active:translate-y-0"
                  >
                    Create an Agreement
                    <ArrowRight
                      className="size-4 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:translate-x-1"
                      aria-hidden
                    />
                  </Link>
                  <Link
                    href="#how-it-works"
                    className="face-quiet inline-flex h-12 items-center justify-center rounded-xl border border-line-strong bg-raised px-6 text-base font-medium transition-[transform,border-color] duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-line-strong"
                  >
                    See how it works
                  </Link>
                </div>

                <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
                  {HERO_PROOF.map((item) => (
                    <div key={item.term}>
                      <dt className="flex items-center gap-1.5 text-xs font-semibold">
                        <item.icon className="size-3 text-accent" aria-hidden />
                        {item.term}
                      </dt>
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
        </div>

        {/* ================= Who it is for ================= */}
        <Section className="pb-16 sm:pb-20">
          <div className="panel flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl px-5 py-4 sm:px-6">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-faint">
              Built for
            </p>
            {[
              "Freelancers", "Agencies", "Consultants", "Developers",
              "Designers", "Creators", "DAO contributors", "Contractors",
            ].map((role, i) => (
              <span key={role} className="flex items-center gap-5 text-sm text-subtle">
                {i > 0 ? <span className="h-3 w-px bg-line" aria-hidden /> : null}
                {role}
              </span>
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

      <footer className="relative border-t border-line bg-raised">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in oklab, var(--accent) 30%, transparent) 35%, color-mix(in oklab, var(--locked) 26%, transparent) 65%, transparent)",
          }}
        />
        <Section className="py-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            <div className="max-w-xs">
              <Link href="/" aria-label="VerseFlow home">
                <BrandLockup size={26} />
              </Link>
              <p className="mt-3 text-xs leading-relaxed text-subtle">
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
