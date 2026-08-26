"use client";

/**
 * Analytics charts.
 *
 * Hand-built SVG rather than a charting library: two chart types with specific
 * requirements do not justify the dependency, and this way they inherit the design
 * tokens directly and stay accessible (each carries a table-equivalent for screen
 * readers, and nothing is communicated by colour alone).
 */

import * as React from "react";
import { formatMoney } from "@/lib/domain/money";
import type { FunnelStage } from "@/lib/services/analytics";

export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div>
      <ol className="space-y-3">
        {stages.map((stage, i) => {
          const width = Math.max((stage.count / max) * 100, stage.count > 0 ? 4 : 0.5);
          const dropped =
            i > 0 && stages[i - 1].count > 0 ? stages[i - 1].count - stage.count : 0;

          return (
            <li key={stage.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium">{stage.label}</span>
                <span className="flex items-baseline gap-2">
                  {stage.conversion !== null ? (
                    <span
                      className={`text-2xs tabular ${
                        stage.conversion >= 70 ? "text-settle" :
                        stage.conversion >= 40 ? "text-attn" : "text-danger"
                      }`}
                    >
                      {stage.conversion}%
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold tabular">{stage.count}</span>
                </span>
              </div>

              <div className="mt-1.5 h-6 overflow-hidden rounded-md bg-sunken">
                <div
                  className="h-full rounded-md bg-accent transition-[width] duration-700 ease-[var(--ease-out-expo)]"
                  style={{ width: `${width}%`, opacity: 1 - i * 0.11 }}
                />
              </div>

              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="text-2xs text-faint">{stage.caption}</span>
                {dropped > 0 ? (
                  <span className="text-2xs text-faint">
                    {dropped} did not continue
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Table equivalent for assistive technology. */}
      <table className="sr-only">
        <caption>Agreement lifecycle funnel</caption>
        <thead>
          <tr><th>Stage</th><th>Count</th><th>Conversion from previous</th></tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.key}>
              <td>{s.label}</td>
              <td>{s.count}</td>
              <td>{s.conversion === null ? "n/a" : `${s.conversion}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VolumeChart({
  data, asset,
}: {
  data: Array<{ week: string; funded: number; released: number }>;
  asset: string;
}) {
  const max = Math.max(...data.flatMap((d) => [d.funded, d.released]), 1);
  const [hovered, setHovered] = React.useState<number | null>(null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-2xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-locked" aria-hidden />
          <span className="text-subtle">Funded into escrow</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-settle" aria-hidden />
          <span className="text-subtle">Released to providers</span>
        </span>
      </div>

      <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Weekly funding and release volume">
        {data.map((d, i) => (
          <div
            key={d.week}
            className="group relative flex h-full flex-1 items-end gap-0.5"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div
              className="flex-1 rounded-t-sm bg-locked transition-opacity"
              style={{
                height: `${Math.max((d.funded / max) * 100, d.funded > 0 ? 2 : 0)}%`,
                opacity: hovered === null || hovered === i ? 1 : 0.4,
              }}
            />
            <div
              className="flex-1 rounded-t-sm bg-settle transition-opacity"
              style={{
                height: `${Math.max((d.released / max) * 100, d.released > 0 ? 2 : 0)}%`,
                opacity: hovered === null || hovered === i ? 1 : 0.4,
              }}
            />

            {hovered === i ? (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 shadow-lg">
                <p className="text-2xs font-medium">
                  Week of {new Date(d.week).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
                <p className="mt-0.5 text-2xs text-locked">
                  Funded {formatMoney(d.funded, asset, { compact: true })}
                </p>
                <p className="text-2xs text-settle">
                  Released {formatMoney(d.released, asset, { compact: true })}
                </p>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-faint">
        <span>
          {data[0] ? new Date(data[0].week).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
        </span>
        <span>
          {data.at(-1) ? new Date(data.at(-1)!.week).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
        </span>
      </div>

      <table className="sr-only">
        <caption>Weekly funding and release volume</caption>
        <thead>
          <tr><th>Week</th><th>Funded</th><th>Released</th></tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.week}>
              <td>{d.week}</td>
              <td>{formatMoney(d.funded, asset)}</td>
              <td>{formatMoney(d.released, asset)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
