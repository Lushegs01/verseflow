"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Bell, Check } from "lucide-react";
import { cn, EmptyState, Skeleton } from "@/components/ui";
import { api } from "@/lib/utils/api-client";
import { relativeTime } from "@/lib/utils/format";
import type { Notification, NotificationKind } from "@/lib/domain/types";

const KIND_TONE: Record<NotificationKind, string> = {
  milestone_ready_for_review: "bg-attn",
  payment_released: "bg-settle",
  revision_requested: "bg-attn",
  revision_submitted: "bg-accent",
  agreement_awaiting_signature: "bg-accent",
  escrow_funded: "bg-locked",
  dispute_opened: "bg-danger",
  dispute_resolved: "bg-settle",
  deadline_approaching: "bg-attn",
  agreement_completed: "bg-settle",
};

export function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [notifications, setNotifications] = React.useState<Notification[] | null>(null);
  const router = useRouter();

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const result = await api.get<{ notifications: Notification[] }>("/api/notifications");
      if (!cancelled && result.ok) setNotifications(result.data.notifications);
    })();

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const markAllRead = async () => {
    await api.post("/api/notifications", { ids: null });
    setNotifications((prev) =>
      prev ? prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) : prev,
    );
    router.refresh();
  };

  if (!open) return null;

  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-paper-950/30" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-line bg-raised shadow-xl animate-[fade_0.2s_ease-out]"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle px-4">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="ml-auto flex items-center gap-1 text-2xs text-accent transition-colors hover:underline"
            >
              <Check className="size-3" aria-hidden />
              Mark all read
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className={cn("rounded-md p-1 text-faint transition-colors hover:bg-inset hover:text-fg", unread > 0 ? "" : "ml-auto")}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {notifications === null ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={<Bell className="size-5" />}
              title="Nothing new"
              description="Milestone reviews, payments, and signature requests will appear here."
            />
          ) : (
            <ul className="divide-y divide-line-subtle">
              {notifications.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href ?? "/app"}
                    onClick={onClose}
                    className={cn(
                      "flex gap-3 px-4 py-3.5 transition-colors hover:bg-inset",
                      !n.readAt && "bg-accent-soft/40",
                    )}
                  >
                    <span
                      className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", KIND_TONE[n.kind] ?? "bg-faint")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{n.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-subtle">{n.body}</span>
                      <span className="mt-1 block text-2xs text-faint">{relativeTime(n.createdAt)}</span>
                    </span>
                    {!n.readAt ? (
                      <span className="sr-only">Unread</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
