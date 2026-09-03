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

  // The icon chip picks up the figure's colour, so a row of tiles is scannable
  // by hue before a single number has been read.
  const chipClass = {
    neutral: "border-line bg-inset text-faint",
    settle: "border-settle-border bg-settle-soft text-settle",
    locked: "border-locked-border bg-locked-soft text-locked",
    attn: "border-attn-border bg-attn-soft text-attn",
    accent: "border-accent-border bg-accent-soft text-accent",
    danger: "border-danger-border bg-danger-soft text-danger",
  }[tone];

  // A figure that means something glows a little; a neutral count stays flat.
  const bloom = {
    neutral: "",
    settle: "[text-shadow:0_0_22px_color-mix(in_oklab,var(--settle)_32%,transparent)]",
    locked: "[text-shadow:0_0_22px_color-mix(in_oklab,var(--locked)_32%,transparent)]",
    attn: "[text-shadow:0_0_22px_color-mix(in_oklab,var(--attn)_32%,transparent)]",
    accent: "[text-shadow:0_0_22px_color-mix(in_oklab,var(--accent)_32%,transparent)]",
    danger: "[text-shadow:0_0_22px_color-mix(in_oklab,var(--danger)_32%,transparent)]",
  }[tone];

  return (
    <div
      className={cn(
        "lit group relative overflow-hidden bg-raised p-4 transition-colors duration-300 hover:bg-inset",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span
            className={cn(
              "edge-light flex size-6 shrink-0 items-center justify-center rounded-md border",
              chipClass,
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <p className="text-2xs font-medium text-subtle">{label}</p>
      </div>
      <p
        className={cn(
          "mt-2 text-xl font-semibold tracking-tight sm:text-2xl",
          toneClass,
          bloom,
        )}
      >
        <CountUp value={value} format={formatter} />
      </p>
      {caption ? <p className="mt-0.5 text-2xs leading-tight text-faint">{caption}</p> : null}
    </div>
  );
}
