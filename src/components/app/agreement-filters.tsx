"use client";

import Link from "next/link";
import { cn } from "@/components/ui";

const TABS = [
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending" },
  { id: "completed", label: "Completed" },
  { id: "all", label: "All" },
] as const;

/**
 * Filter tabs implemented as links rather than client state, so a filtered view
 * is shareable, bookmarkable, and survives a refresh.
 */
export function AgreementFilters({
  current, counts,
}: {
  current: string;
  counts: Record<string, number>;
}) {
  return (
    <div role="tablist" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((tab) => {
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={`/app/agreements?filter=${tab.id}`}
            role="tab"
            aria-selected={active}
            className={cn(
              "relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "text-fg" : "text-subtle hover:text-fg",
            )}
          >
            {tab.label}
            <span className="ml-1.5 rounded-full bg-inset px-1.5 py-0.5 text-2xs tabular">
              {counts[tab.id] ?? 0}
            </span>
            {active ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-fg" /> : null}
          </Link>
        );
      })}
    </div>
  );
}
