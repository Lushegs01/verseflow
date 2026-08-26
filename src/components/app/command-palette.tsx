"use client";

/**
 * Command palette (Cmd/Ctrl+K).
 *
 * Two modes in one surface: a fixed command list when the input is empty, and
 * live search across agreements, milestones, payments, transaction hashes, and
 * public profiles once you type. Results are already permission-filtered by the
 * server, so nothing appears here that the viewer could not otherwise open.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search, Plus, FileText, Wallet, Settings, TrendingUp, BarChart3,
  CornerDownLeft, Loader2, Receipt, Flag, User as UserIcon,
} from "lucide-react";
import { cn } from "@/components/ui";
import { api } from "@/lib/utils/api-client";

interface SearchResult {
  type: "agreement" | "milestone" | "payment" | "user" | "dispute";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  adminOnly?: boolean;
}

const COMMANDS: Command[] = [
  { id: "create", label: "Create agreement", hint: "Start from scratch or describe it", icon: Plus, href: "/app/agreements/new" },
  { id: "agreements", label: "View agreements", icon: FileText, href: "/app/agreements" },
  { id: "reputation", label: "Open reputation", icon: TrendingUp, href: "/app/reputation" },
  { id: "analytics", label: "Open analytics", icon: BarChart3, href: "/app/analytics" },
  { id: "wallet", label: "Wallet and addresses", icon: Wallet, href: "/app/settings#wallets" },
  { id: "settings", label: "Open settings", icon: Settings, href: "/app/settings" },
  { id: "ops", label: "Operations console", icon: Flag, href: "/app/admin", adminOnly: true },
];

const TYPE_ICON: Record<SearchResult["type"], React.ComponentType<{ className?: string }>> = {
  agreement: FileText,
  milestone: Flag,
  payment: Receipt,
  user: UserIcon,
  dispute: Flag,
};

export function CommandPalette({
  open, onClose, isAdmin,
}: { open: boolean; onClose: () => void; isAdmin: boolean }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commands = React.useMemo(
    () => COMMANDS.filter((c) => !c.adminOnly || isAdmin),
    [isAdmin],
  );

  const filteredCommands = React.useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  const items: Array<{ kind: "command"; value: Command } | { kind: "result"; value: SearchResult }> =
    React.useMemo(
      () => [
        ...filteredCommands.map((c) => ({ kind: "command" as const, value: c })),
        ...results.map((r) => ({ kind: "result" as const, value: r })),
      ],
      [filteredCommands, results],
    );

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  // Debounced search. Aborts the in-flight request when the query moves on, so a
  // slow response cannot overwrite results for a newer query.
  React.useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      const result = await api.get<{ results: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(term)}`,
        controller.signal,
      );
      if (result.ok) setResults(result.data.results);
      setLoading(false);
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  React.useEffect(() => {
    setCursor(0);
  }, [query, results.length]);

  const go = React.useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[cursor];
      if (item) go(item.kind === "command" ? item.value.href : item.value.href);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-paper-950/40 backdrop-blur-[2px] animate-[fade_0.15s_ease-out]"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-line bg-raised shadow-xl animate-[rise_0.2s_var(--ease-out-expo)]"
      >
        <div className="flex items-center gap-3 border-b border-line-subtle px-4">
          <Search className="size-4 shrink-0 text-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search agreements, payments, transaction hashes…"
            aria-label="Search"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-faint" aria-hidden /> : null}
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-faint">
              {query.trim().length < 2
                ? "Type to search"
                : `Nothing matched “${query.trim()}”`}
            </p>
          ) : null}

          {filteredCommands.length > 0 ? (
            <p className="px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-wider text-faint">
              Commands
            </p>
          ) : null}

          {filteredCommands.map((command, index) => (
            <PaletteRow
              key={command.id}
              icon={command.icon}
              title={command.label}
              subtitle={command.hint}
              active={cursor === index}
              onSelect={() => go(command.href)}
              onHover={() => setCursor(index)}
            />
          ))}

          {results.length > 0 ? (
            <p className="px-3 pb-1 pt-3 text-2xs font-medium uppercase tracking-wider text-faint">
              Results
            </p>
          ) : null}

          {results.map((result, index) => {
            const position = filteredCommands.length + index;
            return (
              <PaletteRow
                key={`${result.type}-${result.id}`}
                icon={TYPE_ICON[result.type]}
                title={result.title}
                subtitle={result.subtitle}
                badge={result.type}
                active={cursor === position}
                onSelect={() => go(result.href)}
                onHover={() => setCursor(position)}
              />
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-line-subtle bg-inset px-4 py-2 text-2xs text-faint">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="size-3" /> open</span>
          <span className="ml-auto flex items-center gap-1"><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function PaletteRow({
  icon: Icon, title, subtitle, badge, active, onSelect, onHover,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  badge?: string;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-inset" : "hover:bg-inset",
      )}
    >
      <Icon className="size-4 shrink-0 text-faint" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {subtitle ? <span className="block truncate text-2xs text-faint">{subtitle}</span> : null}
      </span>
      {badge ? (
        <span className="shrink-0 rounded border border-line bg-raised px-1.5 py-0.5 text-[10px] capitalize text-faint">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-line bg-raised px-1 font-sans text-[10px]">
      {children}
    </kbd>
  );
}
