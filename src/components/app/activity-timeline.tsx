"use client";

import * as React from "react";
import {
  FileText, PenLine, Lock, Vault, Play, Upload, Paperclip, ScanLine, Check,
  Split, Banknote, AlertCircle, RotateCcw, Scale, MessageSquare, Handshake,
  Flag, X, Pause, Shield, Pencil, Sparkles, ExternalLink,
} from "lucide-react";
import { cn, Mono } from "@/components/ui";
import { formatTime, formatDate, ACTIVITY_META } from "@/lib/utils/format";
import { shortHash } from "@/lib/domain/hashing";
import type { ActivityEvent, ActivityType } from "@/lib/domain/types";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  file: FileText, edit: Pencil, sparkles: Sparkles, pen: PenLine, lock: Lock,
  vault: Vault, play: Play, upload: Upload, paperclip: Paperclip, scan: ScanLine,
  check: Check, split: Split, banknote: Banknote, alert: AlertCircle,
  rotate: RotateCcw, scale: Scale, message: MessageSquare, handshake: Handshake,
  flag: Flag, x: X, pause: Pause, shield: Shield,
};

const TONE_CLASS: Record<string, string> = {
  neutral: "border-line bg-inset text-subtle",
  accent: "border-accent-border bg-accent-soft text-accent",
  settle: "border-settle-border bg-settle-soft text-settle",
  locked: "border-locked-border bg-locked-soft text-locked",
  attn: "border-attn-border bg-attn-soft text-attn",
  danger: "border-danger-border bg-danger-soft text-danger",
  outline: "border-line bg-raised text-subtle",
};

/**
 * The agreement audit trail.
 *
 * Every state change writes an event, so this is the record both parties read to
 * answer "what actually happened?" without relying on anyone's account of it.
 * Transaction hashes are shown where one exists, with an explorer link only when
 * settlement is live -- a simulated hash gets no link, because there is nothing
 * to link to.
 */
export function ActivityTimeline({
  events, explorerUrl, compact = false, limit,
}: {
  events: ActivityEvent[];
  explorerUrl: string | null;
  compact?: boolean;
  limit?: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = limit && !expanded ? events.slice(0, limit) : events;

  if (events.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-faint">
        Activity will appear here as the agreement progresses.
      </p>
    );
  }

  // Group by calendar day so a long history stays scannable.
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of shown) {
    const day = event.createdAt.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(event);
  }

  return (
    <div>
      {Array.from(groups.entries()).map(([day, dayEvents]) => (
        <section key={day} className="mb-5 last:mb-0">
          <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-faint">
            {formatDate(dayEvents[0].createdAt, { withYear: true })}
          </p>

          <ol className="relative space-y-0">
            <div className="absolute bottom-3 left-[13px] top-3 w-px bg-line" aria-hidden />

            {dayEvents.map((event) => {
              const meta = ACTIVITY_META[event.type as ActivityType] ?? { tone: "neutral", icon: "file" };
              const Icon = ICONS[meta.icon] ?? FileText;
              const advisory = event.metadata?.advisory === true;

              return (
                <li key={event.id} className="relative flex gap-3 py-2">
                  <span
                    className={cn(
                      "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border",
                      TONE_CLASS[meta.tone],
                    )}
                    aria-hidden
                  >
                    <Icon className="size-3.5" />
                  </span>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-2xs tabular text-faint">
                        {formatTime(event.createdAt)}
                      </span>
                      <span className="text-sm">{event.summary}</span>
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="text-2xs text-faint">{event.actorLabel}</span>

                      {/* AI output is labelled wherever it appears in the record. */}
                      {advisory ? (
                        <span className="rounded border border-accent-border bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          Advisory only
                        </span>
                      ) : null}

                      {event.txHash && !compact ? (
                        explorerUrl ? (
                          <a
                            href={`${explorerUrl.replace(/\/$/, "")}/tx/${event.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-2xs text-accent transition-colors hover:underline"
                          >
                            {shortHash(event.txHash, 5)}
                            <ExternalLink className="size-2.5" aria-hidden />
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Mono value={event.txHash} display={shortHash(event.txHash, 5)} label="transaction hash" />
                            <span className="text-[10px] text-faint">(simulated)</span>
                          </span>
                        )
                      ) : null}

                      {typeof event.metadata?.bundleHash === "string" && !compact ? (
                        <Mono
                          value={event.metadata.bundleHash as string}
                          display={`bundle ${shortHash(event.metadata.bundleHash as string, 4)}`}
                          label="evidence bundle hash"
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {limit && events.length > limit ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-accent transition-colors hover:underline"
        >
          {expanded ? "Show less" : `Show all ${events.length} events`}
        </button>
      ) : null}
    </div>
  );
}
