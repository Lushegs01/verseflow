"use client";

import * as React from "react";
import { cn, CountUp } from "@/components/ui";
import { formatMoney } from "@/lib/domain/money";

/**
 * A single operational figure.
 *
 * Numbers count up on mount because a value that animates into place reads as
 * live rather than static -- and `CountUp` respects reduced-motion, so it settles
 * instantly for anyone who has asked for that.
 */
export function StatTile({
  label, value, format, asset = "USDC", icon, tone = "neutral", caption, className,
}: {
  label: string;
  value: number;
  format: "money" | "count" | "percent" | "days";
  asset?: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "settle" | "locked" | "attn" | "accent" | "danger";
  caption?: string;
  className?: string;
}) {
  const formatter = React.useCallback(
    (n: number) => {
      switch (format) {
        case "money":
          return formatMoney(n, asset, { compact: n >= 1_000_000 });
        case "percent":
          return `${n}%`;
        case "days":
          return n > 0 ? `${n}d` : "--";
        default:
          return n.toLocaleString("en-US");
      }
    },
    [format, asset],
  );

  const toneClass = {
    neutral: "text-fg",
    settle: "text-settle",
    locked: "text-locked",
    attn: "text-attn",
    accent: "text-accent",
    danger: "text-danger",
  }[tone];

  return (
    <div className={cn("bg-raised p-4", className)}>
      <div className="flex items-center gap-1.5 text-faint">
        {icon ? <span aria-hidden>{icon}</span> : null}
        <p className="text-2xs font-medium">{label}</p>
      </div>
      <p className={cn("mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl", toneClass)}>
        <CountUp value={value} format={formatter} />
      </p>
      {caption ? <p className="mt-0.5 text-2xs leading-tight text-faint">{caption}</p> : null}
    </div>
  );
}
