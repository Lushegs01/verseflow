"use client";

/**
 * The hero visual: one agreement moving through its whole life.
 *
 * It is the pitch in motion -- agreement, escrow, work, verification, payment --
 * so it is built from the same primitives the product uses rather than being an
 * illustration of them. Motion here communicates the state machine; it is not
 * decoration, which is why each step lands with a real value change.
 */

import * as React from "react";
import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { FileText, Lock, Upload, ScanLine, Banknote, Check } from "lucide-react";

type StepKey = "agree" | "fund" | "work" | "verify" | "release";

interface Step {
  key: StepKey;
  label: string;
  caption: string;
  icon: React.ReactNode;
  accent: string;
}

const STEPS: Step[] = [
  { key: "agree", label: "Agreement", caption: "Terms signed by both parties", icon: <FileText className="size-4" />, accent: "var(--accent)" },
  { key: "fund", label: "€3,000 secured", caption: "Escrow funded and locked", icon: <Lock className="size-4" />, accent: "var(--locked)" },
  { key: "work", label: "Milestone submitted", caption: "Evidence attached and hashed", icon: <Upload className="size-4" />, accent: "var(--attn)" },
  { key: "verify", label: "Evidence verified", caption: "Criteria checked against evidence", icon: <ScanLine className="size-4" />, accent: "var(--accent)" },
  { key: "release", label: "€1,000 released", caption: "Payment reached the provider", icon: <Banknote className="size-4" />, accent: "var(--settle)" },
];

export function FlowVisual() {
  const [active, setActive] = React.useState(0);
  const reduced = useReducedMotion();
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused) return;
    // Reduced motion still advances -- the sequence is information, not flourish --
    // it just does so without the animated transitions.
    const timer = setInterval(() => setActive((i) => (i + 1) % STEPS.length), reduced ? 4200 : 2600);
    return () => clearInterval(timer);
  }, [paused, reduced]);

  const released = active >= 4 ? 1000 : 0;
  const locked = active >= 1 ? 3000 - released : 0;

  return (
    <div
      className="relative w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-2xl border border-line bg-raised shadow-lg">
        {/* Window chrome — grounds this as a product surface, not an illustration. */}
        <div className="flex items-center gap-2 border-b border-line-subtle bg-inset px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
          </div>
          <p className="ml-2 font-mono text-2xs text-faint">VF-1042 · Website Redesign</p>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-locked-border bg-locked-soft px-2 py-0.5 text-2xs font-medium text-locked">
            <span className="size-1.5 rounded-full bg-locked" aria-hidden />
            Escrow active
          </span>
        </div>

        <div className="p-5 sm:p-6">
          {/* --- Money summary. The numbers move because the state moved. --- */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <ValueTile label="Contract" value={3000} tone="fg" />
            <ValueTile label="Locked" value={locked} tone="locked" />
            <ValueTile label="Released" value={released} tone="settle" />
          </div>

          {/* --- The five steps --- */}
          <ol className="relative space-y-1">
            {/* Connector rail behind the steps. */}
            <div className="absolute left-[15px] top-4 bottom-4 w-px bg-line" aria-hidden />
            <motion.div
              className="absolute left-[15px] top-4 w-px origin-top bg-accent"
              aria-hidden
              initial={false}
              animate={{ scaleY: active / (STEPS.length - 1) }}
              style={{ height: "calc(100% - 2rem)" }}
              transition={{ duration: reduced ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
            />

            {STEPS.map((step, index) => {
              const done = index < active;
              const current = index === active;
              return (
                <li key={step.key} className="relative flex items-start gap-3.5 py-1.5">
                  <motion.span
                    className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors"
                    animate={{
                      backgroundColor: current || done ? step.accent : "var(--bg-raised)",
                      borderColor: current || done ? step.accent : "var(--border)",
                      color: current || done ? "#fff" : "var(--fg-faint)",
                      scale: current && !reduced ? 1.08 : 1,
                    }}
                    transition={{ duration: reduced ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {done ? <Check className="size-4" aria-hidden /> : step.icon}
                  </motion.span>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <motion.p
                      className="text-sm font-medium"
                      animate={{ color: current ? "var(--fg)" : done ? "var(--fg-muted)" : "var(--fg-faint)" }}
                      transition={{ duration: reduced ? 0 : 0.3 }}
                    >
                      {step.label}
                    </motion.p>
                    <AnimatePresence mode="wait" initial={false}>
                      {current ? (
                        <motion.p
                          key={step.key}
                          className="text-xs text-subtle"
                          initial={reduced ? false : { opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reduced ? undefined : { opacity: 0, y: 4 }}
                          transition={{ duration: 0.25 }}
                        >
                          {step.caption}
                        </motion.p>
                      ) : null}
                    </AnimatePresence>
                  </div>

                  {current ? (
                    <span className="shrink-0 pt-1 font-mono text-2xs text-faint">
                      {String(index + 1).padStart(2, "0")}/05
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>

        {/* --- Footer strip: the trust line, stated where the money is. --- */}
        <div className="border-t border-line-subtle bg-inset px-5 py-3">
          <p className="text-2xs leading-relaxed text-subtle">
            Verification is advisory. Releasing payment always takes an authorized human decision.
          </p>
        </div>
      </div>

      {/* Step controls — the animation is navigable, not just watchable. */}
      <div className="mt-4 flex items-center justify-center gap-2" role="tablist" aria-label="Agreement lifecycle steps">
        {STEPS.map((step, index) => (
          <button
            key={step.key}
            role="tab"
            aria-selected={index === active}
            aria-label={step.label}
            onClick={() => { setActive(index); setPaused(true); }}
            className="group p-1.5"
          >
            <span
              className={`block h-1 rounded-full transition-all duration-300 ${
                index === active ? "w-7 bg-fg" : "w-4 bg-line-strong group-hover:bg-faint"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function ValueTile({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: "fg" | "locked" | "settle";
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = React.useState(value);

  React.useEffect(() => {
    if (reduced) { setDisplay(value); return; }
    const from = display;
    const delta = value - from;
    if (delta === 0) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 650);
      setDisplay(Math.round(from + delta * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Intentionally keyed on `value` only: `display` is the animation's start point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);

  const color = tone === "settle" ? "text-settle" : tone === "locked" ? "text-locked" : "text-fg";

  return (
    <div className="rounded-lg border border-line-subtle bg-inset px-3 py-2.5">
      <p className="text-2xs text-faint">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular ${color}`}>
        €{display.toLocaleString("en-US")}
      </p>
    </div>
  );
}
