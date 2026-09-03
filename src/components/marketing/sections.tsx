"use client";

/**
 * Marketing page sections.
 *
 * Each one shows the actual mechanism rather than describing it abstractly --
 * the AI section shows a real brief becoming real terms, the evidence section
 * shows real evidence cards. A payments product earns trust by being specific.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight, Github, Globe, FileImage, Check, AlertTriangle,
  Lock, Sparkles, Shield, Scale, Clock, TrendingUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function Section({
  children, className, id,
}: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className ?? ""}`}>
      {children}
    </section>
  );
}

/**
 * Section label. The short rule that precedes it does the work a heavier weight
 * or a louder colour would otherwise have to do.
 */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-center gap-2.5 text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
      <span
        aria-hidden
        className="h-px w-6 shrink-0 rounded-full"
        style={{ background: "linear-gradient(90deg, transparent, var(--accent))" }}
      />
      {children}
    </p>
  );
}

export function SectionTitle({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`text-gradient font-display text-3xl leading-[1.1] sm:text-4xl ${className ?? ""}`}>
      {children}
    </h2>
  );
}

export function Reveal({
  children, delay = 0, className,
}: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Problem
// ---------------------------------------------------------------------------

export function ProblemSection() {
  const items = [
    {
      party: "Freelancers",
      want: "want to get paid",
      pain: "Work delivered, invoice sent, then weeks of chasing. No leverage once the files are handed over.",
    },
    {
      party: "Clients",
      want: "want proof the work was delivered",
      pain: "Paying up front means trusting a stranger. Paying after means the provider carries all the risk.",
    },
  ];

  return (
    <Section className="py-20 sm:py-28">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
        <Reveal>
          <Eyebrow>The problem</Eyebrow>
          <SectionTitle>
            Payment systems sit between two people.
            <span className="text-subtle"> They do not manage the agreement.</span>
          </SectionTitle>
        </Reveal>

        <div className="space-y-4">
          {items.map((item, i) => (
            <Reveal key={item.party} delay={0.08 * (i + 1)}>
              <div className="panel rounded-xl p-5 transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:raised-3">
                <p className="text-base font-medium">
                  {item.party} <span className="text-subtle">{item.want}.</span>
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.pain}</p>
              </div>
            </Reveal>
          ))}

          <Reveal delay={0.24}>
            <div className="edge-light relative overflow-hidden rounded-xl border border-accent-border bg-accent-soft p-5">
              <span
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-accent/12 blur-2xl"
              />
              <p className="relative text-sm leading-relaxed">
                An invoice records what someone <em>says</em> happened. VerseFlow holds the money against
                what the two sides actually agreed, and releases it when a person says the terms were met.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Solution
// ---------------------------------------------------------------------------

const SOLUTION_STEPS = [
  { title: "Agree", body: "Write the terms in plain language. Milestones, amounts, deadlines, and what counts as done.", icon: "01" },
  { title: "Fund", body: "The client locks the full contract value in escrow. Neither side can move it unilaterally.", icon: "02" },
  { title: "Work", body: "The provider delivers a milestone and attaches evidence: repositories, deployments, files, links.", icon: "03" },
  { title: "Verify", body: "Evidence is checked against the acceptance criteria the two parties already agreed on.", icon: "04" },
  { title: "Release", body: "The client approves. Payment settles on Verse and the agreement history updates.", icon: "05" },
];

export function SolutionSection() {
  return (
    <Section id="how-it-works" className="py-20 sm:py-28">
      <Reveal className="max-w-2xl">
        <Eyebrow>How it works</Eyebrow>
        <SectionTitle>Five steps, one continuous record.</SectionTitle>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Every step writes a timestamped event. At any moment both parties can answer the same six
          questions: what did we promise, where is the money, what happened, was it satisfied, what
          gets paid, and what does the history say.
        </p>
      </Reveal>

      {/* One hairline grid rather than five separate cards: the steps are a
          single continuous record, and the layout should say so. */}
      <div className="raised-2 mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {SOLUTION_STEPS.map((step, i) => (
          <Reveal key={step.title} delay={i * 0.06} className="h-full">
            <div className="group relative h-full bg-raised p-5 transition-colors duration-300 hover:bg-inset">
              {/* The step number sits in its own chip so the eye can count. */}
              <span className="inline-flex size-7 items-center justify-center rounded-lg border border-line bg-inset font-mono text-2xs text-subtle transition-colors duration-300 group-hover:border-accent-border group-hover:bg-accent-soft group-hover:text-accent">
                {step.icon}
              </span>
              <h3 className="mt-3.5 text-base font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-subtle">{step.body}</p>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px scale-x-0 bg-accent opacity-0 transition-[transform,opacity] duration-500 ease-[var(--ease-out-expo)] group-hover:scale-x-100 group-hover:opacity-100"
              />
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// AI section
// ---------------------------------------------------------------------------

const BRIEF_TEXT =
  "I need a designer to create a brand identity for my startup. Budget is $2,500. I want a moodboard first, then logo concepts, then final brand files. Two revision rounds.";

export function AISection() {
  const reduced = useReducedMotion();
  const [typed, setTyped] = React.useState(reduced ? BRIEF_TEXT : "");
  const [showResult, setShowResult] = React.useState(Boolean(reduced));
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [started, setStarted] = React.useState(false);

  // Type the brief out once, when the section scrolls into view.
  React.useEffect(() => {
    if (reduced || started) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setStarted(true); observer.disconnect(); }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced, started]);

  React.useEffect(() => {
    if (!started || reduced) return;
    let i = 0;
    const timer = setInterval(() => {
      i += 2;
      setTyped(BRIEF_TEXT.slice(0, i));
      if (i >= BRIEF_TEXT.length) {
        clearInterval(timer);
        setTimeout(() => setShowResult(true), 350);
      }
    }, 18);
    return () => clearInterval(timer);
  }, [started, reduced]);

  const milestones = [
    { title: "Moodboard & Direction", amount: "$500", criteria: "At least two distinct visual directions presented" },
    { title: "Logo Concepts", amount: "$1,250", criteria: "3 concepts delivered in vector format" },
    { title: "Final Brand Files", amount: "$750", criteria: "Source files and usage guidelines supplied" },
  ];

  return (
    <Section id="ai" className="py-20 sm:py-28">
      <Reveal className="max-w-2xl">
        <Eyebrow>Agreement engine</Eyebrow>
        <SectionTitle>Describe the work. Get a fundable contract.</SectionTitle>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Type how you would explain the project to a colleague. VerseFlow turns it into milestones,
          amounts, deadlines, acceptance criteria, and evidence requirements — every field editable,
          nothing hidden behind the assistant.
        </p>
      </Reveal>

      <div ref={containerRef} className="mt-12 grid gap-4 lg:grid-cols-2">
        {/* Left: the brief */}
        <Reveal className="h-full">
          <div className="panel h-full overflow-hidden rounded-2xl">
            <div className="flex items-center gap-2 border-b border-line-subtle bg-inset px-4 py-3">
              <span className="size-1.5 rounded-full bg-faint" aria-hidden />
              <span className="text-xs font-medium text-subtle">Your brief</span>
            </div>
            <div className="p-5">
              <p className="min-h-28 text-sm leading-relaxed">
                {typed}
                {!showResult && !reduced ? (
                  <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-accent align-middle" />
                ) : null}
              </p>
            </div>
          </div>
        </Reveal>

        {/* Right: the generated agreement */}
        <Reveal delay={0.1} className="h-full">
          <div className="panel border-gradient h-full overflow-hidden rounded-2xl">
            <div className="flex items-center gap-2 border-b border-line-subtle bg-inset px-4 py-3">
              <Sparkles className="size-3.5 text-accent" aria-hidden />
              <span className="text-xs font-medium text-subtle">Generated agreement</span>
              <span className="ml-auto font-mono text-2xs text-faint">$2,500 allocated</span>
            </div>

            <div className="space-y-2 p-4">
              {milestones.map((m, i) => (
                <motion.div
                  key={m.title}
                  initial={reduced ? false : { opacity: 0, x: 12 }}
                  animate={showResult ? { opacity: 1, x: 0 } : { opacity: 0, x: 12 }}
                  transition={{ duration: 0.4, delay: 0.1 * i, ease: [0.16, 1, 0.3, 1] }}
                  className="edge-light rounded-lg border border-line-subtle bg-inset p-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium">{m.title}</p>
                    <span className="shrink-0 text-sm font-semibold tabular text-settle">{m.amount}</span>
                  </div>
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-subtle">
                    <Check className="mt-0.5 size-3 shrink-0 text-settle" aria-hidden />
                    {m.criteria}
                  </p>
                </motion.div>
              ))}

              {/* Ambiguity detection, shown as a real product surface. */}
              <motion.div
                initial={reduced ? false : { opacity: 0 }}
                animate={showResult ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.4, delay: 0.42 }}
                className="edge-light flex items-start gap-2 rounded-lg border border-attn-border bg-attn-soft p-3"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-attn" aria-hidden />
                <div>
                  <p className="text-xs font-medium">2 items need your attention</p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-muted">
                    No deadline was given for the final milestone, and &ldquo;final brand files&rdquo; does not
                    say which formats are included.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------

export function EscrowSection() {
  return (
    <Section className="py-20 sm:py-28">
      <div className="panel raised-3 overflow-hidden rounded-3xl">
        <div className="grid lg:grid-cols-2">
          <div className="p-8 sm:p-10">
            <Reveal>
              <Eyebrow>Escrow</Eyebrow>
              <SectionTitle className="text-2xl sm:text-3xl">
                The money is already there.
              </SectionTitle>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                When a client funds an agreement, the full contract value moves into a milestone escrow
                contract. The provider can see it. Neither party can withdraw it alone. Each milestone
                can only ever pay out what was allocated to it.
              </p>

              <ul className="mt-6 space-y-3">
                {[
                  "Funds are held by the contract, not by VerseFlow",
                  "Releases are capped per milestone and can never exceed the deposit",
                  "The signed terms hash is stored on chain and can be re-verified",
                  "No operator withdrawal path exists in the contract",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <Lock className="mt-0.5 size-3.5 shrink-0 text-locked" aria-hidden />
                    <span className="text-muted">{item}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={0.12} className="border-t border-line lg:border-l lg:border-t-0">
            <div className="h-full bg-inset p-8 sm:p-10">
              <p className="text-xs text-subtle">Payment timeline</p>
              <div className="mt-5 space-y-3">
                {[
                  { label: "Design", amount: "$750", state: "Released", tone: "settle" as const },
                  { label: "Development", amount: "$1,500", state: "Current", tone: "accent" as const },
                  { label: "Launch", amount: "$750", state: "Locked", tone: "neutral" as const },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="raised-1 lit flex items-center gap-3 rounded-lg border border-line-subtle bg-raised p-3.5"
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        row.tone === "settle" ? "bg-settle shadow-[0_0_0_3px_color-mix(in_oklab,var(--settle)_20%,transparent)]" :
                        row.tone === "accent" ? "bg-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_20%,transparent)]" :
                        "bg-line-strong"
                      }`}
                      aria-hidden
                    />
                    <span className="text-sm font-medium">{row.label}</span>
                    <span className="ml-auto text-sm font-semibold tabular">{row.amount}</span>
                    <span
                      className={`w-16 shrink-0 text-right text-2xs ${
                        row.tone === "settle" ? "text-settle" : row.tone === "accent" ? "text-accent" : "text-faint"
                      }`}
                    >
                      {row.state}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
                <span className="text-xs text-subtle">Still locked in escrow</span>
                <span className="text-2xl font-semibold tabular text-locked [text-shadow:0_0_24px_color-mix(in_oklab,var(--locked)_35%,transparent)]">
                  $2,250
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export function EvidenceSection() {
  const cards = [
    { icon: <Github className="size-4" />, title: "GitHub", primary: "northstar/storefront", detail: "37 commits since this milestone opened" },
    { icon: <Globe className="size-4" />, title: "Deployment", primary: "staging.northstar.coffee", detail: "Reachable · checked 4 minutes ago" },
    { icon: <FileImage className="size-4" />, title: "Screenshots", primary: "3 files", detail: "390px, 768px and 1440px widths" },
  ];

  return (
    <Section className="py-20 sm:py-28">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
        <Reveal>
          <Eyebrow>Evidence</Eyebrow>
          <SectionTitle>Approval based on what was actually delivered.</SectionTitle>
          <p className="mt-4 text-base leading-relaxed text-muted">
            A milestone is submitted with evidence attached: repositories, deployments, design files,
            documents, screenshots. Each item is hashed and timestamped, and the bundle hash is anchored
            to the agreement — so what was submitted, and when, is not something either side can revise
            after the fact.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-subtle">
            The work product itself stays private. Only hashes are anchored.
          </p>
        </Reveal>

        <div className="space-y-3">
          {cards.map((card, i) => (
            <Reveal key={card.title} delay={0.08 * i}>
              <div className="panel group flex items-start gap-3.5 rounded-xl p-4 transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:raised-3">
                <span className="raised-1 mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-inset text-subtle transition-colors duration-300 group-hover:border-accent-border group-hover:bg-accent-soft group-hover:text-accent">
                  {card.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-faint">{card.title}</p>
                  <p className="truncate text-sm font-medium">{card.primary}</p>
                  <p className="mt-0.5 text-xs text-subtle">{card.detail}</p>
                </div>
                <Check className="mt-1 size-4 shrink-0 text-settle" aria-hidden />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Trust — the most important section in the product
// ---------------------------------------------------------------------------

export function TrustSection() {
  const layers = [
    { label: "AI recommendation", body: "Structures your terms and reads evidence against the criteria. Advisory only.", tone: "accent" as const, icon: <Sparkles className="size-4" /> },
    { label: "Contract rule", body: "What the two parties agreed: amounts, windows, revision limits, evidence requirements.", tone: "locked" as const, icon: <Scale className="size-4" /> },
    { label: "Human approval", body: "A person with the authority decides. The client releases; nobody releases for them.", tone: "settle" as const, icon: <Shield className="size-4" /> },
    { label: "On-chain settlement", body: "The escrow contract executes only what an authorized party actually signed for.", tone: "neutral" as const, icon: <Lock className="size-4" /> },
  ];

  return (
    <Section className="py-20 sm:py-28">
      {/* The most important claim on the page, so it gets the page's only other
          pool of ambient light and its widest panel. */}
      <div className="panel raised-3 relative isolate overflow-hidden rounded-3xl p-8 sm:p-12">
        <div className="aurora opacity-60" aria-hidden />
        <div className="noise absolute inset-0" aria-hidden />
        <Reveal className="relative max-w-2xl">
          <Eyebrow>Trust model</Eyebrow>
          <SectionTitle>VerseFlow does not let AI decide who receives money.</SectionTitle>
          <p className="mt-4 text-base leading-relaxed text-muted">
            AI helps structure agreements and analyze evidence. Payment actions remain governed by
            explicit agreement rules and authorized human decisions. These four layers are kept
            visibly separate throughout the product, because collapsing them is how a payments
            product loses the right to be trusted.
          </p>
        </Reveal>

        <div className="relative mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {layers.map((layer, i) => (
            <Reveal key={layer.label} delay={i * 0.07} className="h-full">
              <div className="lit raised-1 h-full rounded-xl border border-line-subtle bg-inset p-5 transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-1 hover:raised-3">
                {/* Each layer is numbered: they are a sequence of gates, not four
                    interchangeable features. */}
                <div className="flex items-center justify-between">
                  <span
                    className={`edge-light inline-flex size-9 items-center justify-center rounded-lg border ${
                      layer.tone === "accent" ? "border-accent-border bg-accent-soft text-accent" :
                      layer.tone === "locked" ? "border-locked-border bg-locked-soft text-locked" :
                      layer.tone === "settle" ? "border-settle-border bg-settle-soft text-settle" :
                      "border-line bg-raised text-subtle"
                    }`}
                  >
                    {layer.icon}
                  </span>
                  <span className="font-mono text-2xs text-faint">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="mt-3.5 text-sm font-semibold">{layer.label}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-subtle">{layer.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Reputation
// ---------------------------------------------------------------------------

export function ReputationSection() {
  const stats = [
    { value: "23", label: "Contracts completed" },
    { value: "$48.2K", label: "Value settled" },
    { value: "96%", label: "On time" },
    { value: "84%", label: "Repeat clients" },
  ];

  return (
    <Section className="py-20 sm:py-28">
      <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
        <Reveal delay={0.1} className="order-2 lg:order-1">
          <div className="panel raised-3 rounded-3xl p-6">
            <div className="flex items-center gap-3.5">
              <span
                className="flex size-12 items-center justify-center rounded-full text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),var(--glow-settle)]"
                style={{
                  backgroundImage:
                    "linear-gradient(145deg, color-mix(in oklab, #0F9D6B 78%, white), #0F9D6B 60%, color-mix(in oklab, #0F9D6B 85%, black))",
                }}
                aria-hidden
              >
                AM
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold">Alex Morgan</p>
                <p className="text-xs text-subtle">Full-stack developer</p>
              </div>
              <span className="edge-light ml-auto inline-flex items-center gap-1.5 rounded-full border border-settle-border bg-settle-soft px-2.5 py-1 text-2xs font-medium text-settle">
                <Check className="size-3" aria-hidden />
                Verified history
              </span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="lit bg-inset p-4 text-center transition-colors duration-300 hover:bg-raised">
                  <p className="text-gradient text-2xl font-semibold tabular">{stat.value}</p>
                  <p className="mt-1 text-2xs leading-tight text-subtle">{stat.label}</p>
                </div>
              ))}
            </div>

            <p className="mt-4 text-2xs leading-relaxed text-faint">
              Every figure is derived from agreements that were signed, funded, and settled. Nothing is
              self-reported, and only what Alex chose to publish is shown.
            </p>
          </div>
        </Reveal>

        <Reveal className="order-1 lg:order-2">
          <Eyebrow>Reputation</Eyebrow>
          <SectionTitle>A work history that cannot be invented.</SectionTitle>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Reputation is computed from settled contract history: how many agreements completed, how much
            value actually moved, how often milestones landed on time, how often clients came back.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              { icon: <TrendingUp className="size-3.5" />, text: "Built from real escrow settlements, not reviews" },
              { icon: <Shield className="size-3.5" />, text: "Private by default — you choose what to publish" },
              { icon: <Clock className="size-3.5" />, text: "Portable: share one link, keep the history" },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-2.5 text-sm text-muted">
                <span className="mt-0.5 shrink-0 text-accent" aria-hidden>{item.icon}</span>
                {item.text}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Verse
// ---------------------------------------------------------------------------

export function VerseSection({ chainName }: { chainName: string }) {
  return (
    <Section className="py-20 sm:py-28">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Reveal>
          <Eyebrow>Settlement layer</Eyebrow>
          <SectionTitle>Why {chainName}.</SectionTitle>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="space-y-5">
            <p className="text-base leading-relaxed text-muted">
              Milestone escrow only works if settlement is cheap enough to do repeatedly and fast enough
              that nobody is left waiting on a payment they have already been told is coming. A three-
              milestone agreement is at least four on-chain operations; on a high-fee network the
              economics stop working for a $750 milestone.
            </p>
            <p className="text-base leading-relaxed text-muted">
              {chainName} is EVM-compatible, so the escrow contract is ordinary, auditable Solidity, and
              settlement finality is quick enough that a provider sees the payment land while they are
              still in the conversation.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "EVM-compatible", body: "Standard Solidity, standard tooling, auditable by anyone" },
                { label: "Low settlement cost", body: "Per-milestone releases stay economical" },
                { label: "Fast finality", body: "Payment confirms while it still matters" },
              ].map((item) => (
                <div className="panel rounded-xl p-4 transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:raised-3" key={item.label}>
                  <p className="text-xs font-semibold">{item.label}</p>
                  <p className="mt-1 text-2xs leading-relaxed text-subtle">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

export function FinalCTA() {
  return (
    <Section className="py-20 sm:py-32">
      <Reveal>
        {/* The last thing on the page, so it is allowed to be the loudest:
            ambient light, a gradient hairline, and the dot field underneath. */}
        <div className="panel border-gradient grain raised-4 relative isolate overflow-hidden rounded-3xl px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="aurora" aria-hidden />
          <div className="noise absolute inset-0" aria-hidden />

          <div className="relative">
            <h2 className="text-gradient font-display text-4xl leading-[1.05] sm:text-5xl">
              Build your first <em className="text-brand-gradient">agreement</em>.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted">
              Describe a project in a sentence. Review the milestones. Fund escrow when you are ready.
              It takes about two minutes.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/app/agreements/new"
                className="face-primary sheen group inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-base font-medium text-primary-fg transition-transform duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 active:translate-y-0"
              >
                Create an Agreement
                <ArrowRight
                  className="size-4 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:translate-x-1"
                  aria-hidden
                />
              </a>
              <a
                href="/api/demo/start?persona=client"
                className="face-quiet inline-flex h-12 items-center justify-center rounded-xl border border-line-strong bg-raised px-6 text-base font-medium transition-transform duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5"
              >
                Explore the demo
              </a>
            </div>

            <p className="mt-8 text-2xs text-faint">
              No card required · Escrow funded only when you choose to fund it
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
