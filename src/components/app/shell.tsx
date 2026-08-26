"use client";

/**
 * Application shell.
 *
 * Desktop gets a persistent sidebar; mobile gets a bottom navigation bar with the
 * primary action always within thumb reach. These are two different layouts, not
 * one layout scaled down -- which is why the mobile bar carries "Create" as a
 * dedicated centre action rather than hiding it behind a menu.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, FileText, TrendingUp, BarChart3, Settings, Shield,
  Plus, Search, Bell, LogOut, ChevronDown, Wallet, RotateCcw, Check,
} from "lucide-react";
import { cn, Avatar, Badge, Button, useToast } from "@/components/ui";
import { ThemeToggle } from "./theme-toggle";
import { CommandPalette } from "./command-palette";
import { NotificationPanel } from "./notifications";
import { api, trackEvent } from "@/lib/utils/api-client";

export interface ShellUser {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  isAdmin: boolean;
}

export interface ShellChain {
  mode: "simulated" | "live";
  name: string;
  chainId: number;
  hasExplorer: boolean;
}

const NAV_ITEMS = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/app/agreements", label: "Agreements", icon: FileText, exact: false },
  { href: "/app/reputation", label: "Reputation", icon: TrendingUp, exact: false },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3, exact: false },
  { href: "/app/settings", label: "Settings", icon: Settings, exact: false },
];

export function AppShell({
  user, address, chain, unreadCount, demoPersona, children,
}: {
  user: ShellUser;
  address: string | null;
  chain: ShellChain;
  unreadCount: number;
  demoPersona: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);

  // Cmd/Ctrl+K opens the command palette from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => {
          if (!v) trackEvent("command_palette_opened");
          return !v;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const nav = user.isAdmin
    ? [...NAV_ITEMS, { href: "/app/admin", label: "Operations", icon: Shield, exact: false }]
    : NAV_ITEMS;

  return (
    <div className="min-h-dvh bg-surface">
      {demoPersona ? <DemoBanner persona={demoPersona} /> : null}

      <div className="flex">
        {/* ---------- Desktop sidebar ---------- */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-raised lg:flex">
          <div className="flex h-14 items-center px-5">
            <Link href="/" className="font-display text-xl tracking-tight">VerseFlow</Link>
          </div>

          <div className="px-3 pb-3">
            <Button
              variant="primary"
              fullWidth
              icon={<Plus className="size-4" />}
              onClick={() => (window.location.href = "/app/agreements/new")}
            >
              Create agreement
            </Button>
          </div>

          <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
            {nav.map((item) => {
              const active = isActive(item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active ? "bg-inset font-medium text-fg" : "text-muted hover:bg-inset hover:text-fg",
                  )}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="space-y-2 border-t border-line-subtle p-3">
            <SettlementBadge chain={chain} />
            <UserMenu user={user} address={address} />
          </div>
        </aside>

        {/* ---------- Main column ---------- */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/85 px-4 backdrop-blur-md sm:px-6">
            <Link href="/" className="font-display text-lg lg:hidden">VerseFlow</Link>

            <button
              type="button"
              onClick={() => { setPaletteOpen(true); trackEvent("command_palette_opened"); }}
              className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-line bg-raised px-3 text-sm text-faint transition-colors hover:border-line-strong lg:ml-0 lg:w-72"
            >
              <Search className="size-3.5 shrink-0" aria-hidden />
              <span className="hidden lg:inline">Search agreements, payments…</span>
              <kbd className="ml-auto hidden rounded border border-line bg-inset px-1.5 py-0.5 font-sans text-2xs lg:inline">
                ⌘K
              </kbd>
            </button>

            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setNotificationsOpen(true)}
                aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
                className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
              >
                <Bell className="size-4" />
                {unreadCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-semibold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </button>
              <div className="lg:hidden">
                <Avatar name={user.displayName} color={user.avatarColor} size="sm" />
              </div>
            </div>
          </header>

          <main id="main" className="pb-24 lg:pb-8">{children}</main>
        </div>
      </div>

      {/* ---------- Mobile bottom navigation ---------- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised/95 pb-safe backdrop-blur-md lg:hidden"
      >
        <div className="flex h-16 items-stretch">
          {nav.slice(0, 2).map((item) => (
            <BottomNavLink key={item.href} item={item} active={isActive(item.href, item.exact)} />
          ))}

          {/* The primary action sits centre-bottom, always reachable by thumb. */}
          <div className="flex flex-1 items-center justify-center">
            <Link
              href="/app/agreements/new"
              aria-label="Create agreement"
              className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-fg shadow-md transition-transform active:scale-95"
            >
              <Plus className="size-5" aria-hidden />
            </Link>
          </div>

          {nav.slice(2, 4).map((item) => (
            <BottomNavLink key={item.href} item={item} active={isActive(item.href, item.exact)} />
          ))}
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} isAdmin={user.isAdmin} />
      <NotificationPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  );
}

function BottomNavLink({
  item, active,
}: {
  item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
  active: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 text-2xs transition-colors",
        active ? "text-fg" : "text-faint",
      )}
    >
      <item.icon className="size-5" aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}

/**
 * Settlement mode is surfaced permanently in the shell. If the product is running
 * against the local simulation, the user is told on every screen.
 */
function SettlementBadge({ chain }: { chain: ShellChain }) {
  return (
    <div className="rounded-lg border border-line bg-inset px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", chain.mode === "live" ? "bg-settle" : "bg-attn")}
          aria-hidden
        />
        <span className="text-2xs font-medium">
          {chain.mode === "live" ? chain.name : "Simulated settlement"}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] leading-tight text-faint">
        {chain.mode === "live"
          ? `Chain ${chain.chainId} · live transactions`
          : "Local ledger. Not live network activity."}
      </p>
    </div>
  );
}

function UserMenu({ user, address }: { user: ShellUser; address: string | null }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = async () => {
    await api.del("/api/auth/session");
    router.push("/");
    router.refresh();
  };

  return (
    <div ref={ref} className="relative">
      {open ? (
        <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-lg border border-line bg-raised shadow-lg">
          <Link
            href={`/p/${user.handle}`}
            className="block px-3 py-2 text-sm text-muted transition-colors hover:bg-inset hover:text-fg"
          >
            View public profile
          </Link>
          <Link
            href="/app/settings"
            className="block px-3 py-2 text-sm text-muted transition-colors hover:bg-inset hover:text-fg"
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 border-t border-line-subtle px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-inset hover:text-fg"
          >
            <LogOut className="size-3.5" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-inset"
      >
        <Avatar name={user.displayName} color={user.avatarColor} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{user.displayName}</span>
          <span className="block truncate font-mono text-[10px] text-faint">
            {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "No wallet"}
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-faint" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Demo banner. Judges need to know which persona they are, be able to switch, and
 * be able to reset -- and everyone needs to know this is demo data.
 */
function DemoBanner({ persona }: { persona: string }) {
  const [resetting, setResetting] = React.useState(false);
  const { toast } = useToast();

  const labels: Record<string, string> = {
    client: "Northstar Coffee (client)",
    provider: "Alex Morgan (provider)",
    operator: "Operations",
  };

  const reset = async () => {
    setResetting(true);
    const result = await api.post<{ redirect: string }>("/api/demo/reset");
    if (result.ok) {
      window.location.href = result.data.redirect;
    } else {
      toast({ tone: "danger", title: "Reset failed", body: result.error.message });
      setResetting(false);
    }
  };

  return (
    <div className="border-b border-attn-border bg-attn-soft">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:px-6">
        <Badge tone="attn">Demo mode</Badge>
        <span className="text-2xs text-muted">
          Signed in as <strong className="font-medium text-fg">{labels[persona] ?? persona}</strong>
        </span>

        <div className="ml-auto flex items-center gap-1">
          {(["client", "provider", "operator"] as const)
            .filter((p) => p !== persona)
            .map((p) => (
              <a
                key={p}
                href={`/api/demo/start?persona=${p}`}
                className="rounded px-2 py-1 text-2xs font-medium text-accent transition-colors hover:bg-raised"
              >
                Switch to {p}
              </a>
            ))}
          <button
            type="button"
            onClick={reset}
            disabled={resetting}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium text-muted transition-colors hover:bg-raised disabled:opacity-50"
          >
            {resetting ? <Check className="size-3" /> : <RotateCcw className="size-3" />}
            {resetting ? "Resetting…" : "Reset demo"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown when someone reaches the app with no session. */
export function ConnectGate() {
  const [connecting, setConnecting] = React.useState(false);
  const { toast } = useToast();
  const router = useRouter();

  /**
   * Wallet sign-in. Uses an injected EIP-1193 provider when one exists; otherwise
   * offers the demo personas. There is no password path -- VerseFlow never handles
   * credentials.
   */
  const connect = async () => {
    setConnecting(true);
    try {
      const ethereum = (window as unknown as { ethereum?: {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      } }).ethereum;

      if (!ethereum) {
        toast({
          tone: "attn",
          title: "No wallet detected",
          body: "Install a browser wallet, or explore the demo below.",
        });
        setConnecting(false);
        return;
      }

      const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account returned");

      const nonceResult = await api.post<{ nonce: string; message: string }>("/api/auth/nonce", { address });
      if (!nonceResult.ok) throw new Error(nonceResult.error.message);

      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [nonceResult.data.message, address],
      })) as string;

      const verify = await api.post("/api/auth/verify", { address, signature });
      if (!verify.ok) {
        toast({ tone: "danger", title: "Could not sign in", body: verify.error.message });
        setConnecting(false);
        return;
      }

      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet connection was cancelled.";
      toast({ tone: "attn", title: "Wallet not connected", body: message });
      setConnecting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="font-display text-2xl">VerseFlow</Link>
        <h1 className="mt-6 font-display text-3xl leading-tight">Connect your wallet</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Signing proves you control the address. It does not authorize any payment
          and does not move funds.
        </p>

        <div className="mt-8 space-y-3">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={connecting}
            loadingText="Waiting for your wallet…"
            icon={<Wallet className="size-4" />}
            onClick={connect}
          >
            Connect wallet
          </Button>

          <div className="flex items-center gap-3 py-2">
            <span className="h-px flex-1 bg-line" />
            <span className="text-2xs uppercase tracking-wider text-faint">or explore the demo</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <a
              href="/api/demo/start?persona=client"
              className="flex h-11 items-center justify-center rounded-lg border border-line bg-raised text-sm font-medium transition-colors hover:border-line-strong"
            >
              As a client
            </a>
            <a
              href="/api/demo/start?persona=provider"
              className="flex h-11 items-center justify-center rounded-lg border border-line bg-raised text-sm font-medium transition-colors hover:border-line-strong"
            >
              As a provider
            </a>
          </div>

          <p className="pt-2 text-2xs leading-relaxed text-faint">
            The demo signs you in as a seeded account with real agreement history. Settlement
            runs on the local simulation and is labelled as such throughout.
          </p>
        </div>
      </div>
    </div>
  );
}
