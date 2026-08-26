"use client";

/**
 * Settings.
 *
 * Privacy is the section that matters most here: reputation is private by
 * default, publishing is opt-in per metric, and the consequence of each toggle is
 * stated next to it rather than in a help page.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  User, Wallet, Bell, Shield, Eye, ExternalLink, Check, Copy, Plug, Lock, Info,
} from "lucide-react";
import {
  Card, Button, Badge, Alert, Field, Input, Textarea, Select, Toggle, Mono,
  useToast, cn,
} from "@/components/ui";
import { shortAddress } from "@/lib/domain/hashing";
import { formatDate } from "@/lib/utils/format";
import { api } from "@/lib/utils/api-client";
import type { NotificationKind, NotificationPreferences, PublicMetricKey } from "@/lib/domain/types";

const NOTIFICATION_KINDS: Array<{ kind: NotificationKind; label: string; description: string }> = [
  { kind: "milestone_ready_for_review", label: "Milestone ready for review", description: "A provider submitted work that needs your decision." },
  { kind: "payment_released", label: "Payment released", description: "Funds reached a provider." },
  { kind: "revision_requested", label: "Revision requested", description: "A client asked for changes." },
  { kind: "revision_submitted", label: "Revision submitted", description: "A provider addressed the changes." },
  { kind: "agreement_awaiting_signature", label: "Signature needed", description: "An agreement is waiting on you." },
  { kind: "escrow_funded", label: "Escrow funded", description: "A client secured the contract value." },
  { kind: "dispute_opened", label: "Dispute opened", description: "A milestone was paused pending review." },
  { kind: "dispute_resolved", label: "Dispute resolved", description: "A disputed milestone was settled." },
  { kind: "deadline_approaching", label: "Deadline approaching", description: "A milestone or review window is close to expiring." },
  { kind: "agreement_completed", label: "Agreement completed", description: "Every milestone settled." },
];

const PROFESSIONS = [
  "freelancer", "agency", "consultant", "developer", "designer",
  "creator", "marketer", "dao_contributor", "contractor", "client",
];

interface SettingsUser {
  id: string;
  handle: string;
  displayName: string;
  headline: string;
  bio: string;
  professions: string[];
  timezone: string;
  verification: string;
  publicProfileEnabled: boolean;
  publicMetrics: PublicMetricKey[];
  isAdmin: boolean;
  createdAt: string;
}

export function SettingsPanels({
  user, wallets, activeAddress, preferences, metricOptions, hasReputation, chain,
}: {
  user: SettingsUser;
  wallets: Array<{ id: string; address: string; label: string; isPrimary: boolean; verifiedAt: string | null; chainId: number }>;
  activeAddress: string | null;
  preferences: NotificationPreferences;
  metricOptions: Array<{ key: PublicMetricKey; label: string; caption: string }>;
  hasReputation: boolean;
  chain: { mode: string; name: string; chainId: number; escrowAddress: string | null };
}) {
  return (
    <div className="space-y-5">
      <ProfileSection user={user} />
      <WalletSection wallets={wallets} activeAddress={activeAddress} chain={chain} />
      <PrivacySection user={user} metricOptions={metricOptions} hasReputation={hasReputation} />
      <NotificationSection preferences={preferences} />
      <ConnectedAppsSection />
      <SecuritySection user={user} chain={chain} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({
  id, icon, title, description, children, footer,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-20 overflow-hidden">
      <div className="border-b border-line-subtle px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-faint" aria-hidden>{icon}</span>
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-2xs text-subtle">{description}</p> : null}
      </div>
      <div className="p-5">{children}</div>
      {footer ? (
        <div className="flex items-center gap-3 border-t border-line-subtle bg-inset px-5 py-3.5">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

function ProfileSection({ user }: { user: SettingsUser }) {
  const router = useRouter();
  const { toast } = useToast();
  const [displayName, setDisplayName] = React.useState(user.displayName);
  const [headline, setHeadline] = React.useState(user.headline);
  const [bio, setBio] = React.useState(user.bio);
  const [professions, setProfessions] = React.useState<string[]>(user.professions);
  const [timezone, setTimezone] = React.useState(user.timezone);
  const [saving, setSaving] = React.useState(false);

  const dirty =
    displayName !== user.displayName ||
    headline !== user.headline ||
    bio !== user.bio ||
    timezone !== user.timezone ||
    professions.join() !== user.professions.join();

  const save = async () => {
    setSaving(true);
    const result = await api.patch("/api/settings/profile", {
      displayName: displayName.trim(),
      headline: headline.trim(),
      bio: bio.trim(),
      professions,
      timezone,
    });

    if (result.ok) {
      toast({ tone: "settle", title: "Profile saved" });
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not save", body: result.error.message });
    }
    setSaving(false);
  };

  return (
    <Section
      id="profile"
      icon={<User className="size-4" />}
      title="Profile"
      description="How you appear to counterparties, and on your public profile if enabled."
      footer={
        <>
          <span className="text-2xs text-faint">
            {dirty ? "Unsaved changes" : "Everything saved"}
          </span>
          <Button className="ml-auto" variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Display name" htmlFor="s-name" required>
          <Input id="s-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
        </Field>

        <Field label="Handle" htmlFor="s-handle" hint="Your public profile lives at this address.">
          <div className="flex items-center gap-2">
            <Input id="s-handle" value={user.handle} readOnly disabled className="font-mono text-xs" />
            <Link
              href={`/p/${user.handle}`}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-xs transition-colors hover:bg-inset"
            >
              <ExternalLink className="size-3" aria-hidden />
              View
            </Link>
          </div>
        </Field>

        <Field label="Headline" htmlFor="s-headline" hint="One line, e.g. Full-stack developer." aside={`${headline.length}/140`}>
          <Input id="s-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={140} />
        </Field>

        <Field label="Bio" htmlFor="s-bio" aside={`${bio.length}/1000`}>
          <Textarea id="s-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={4} maxLength={1000} />
        </Field>

        <fieldset>
          <legend className="text-xs font-medium text-muted">What you do</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PROFESSIONS.map((p) => {
              const selected = professions.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setProfessions((prev) =>
                      selected ? prev.filter((x) => x !== p) : [...prev, p],
                    )
                  }
                  className={cn(
                    "h-7 rounded-md border px-2.5 text-2xs font-medium capitalize transition-colors",
                    selected
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-subtle hover:border-line-strong",
                  )}
                >
                  {p.replace(/_/g, " ")}
                </button>
              );
            })}
          </div>
        </fieldset>

        <Field label="Timezone" htmlFor="s-tz" hint="Used for deadlines and review windows.">
          <Select id="s-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {["UTC", "Europe/London", "Europe/Lisbon", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"].map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Section>
  );
}

function WalletSection({
  wallets, activeAddress, chain,
}: {
  wallets: Array<{ id: string; address: string; label: string; isPrimary: boolean; verifiedAt: string | null; chainId: number }>;
  activeAddress: string | null;
  chain: { name: string; chainId: number };
}) {
  return (
    <Section
      id="wallets"
      icon={<Wallet className="size-4" />}
      title="Wallet addresses"
      description="Escrow releases are paid to your primary address."
    >
      {wallets.length === 0 ? (
        <p className="text-sm text-faint">No wallet connected.</p>
      ) : (
        <ul className="space-y-2">
          {wallets.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3.5">
              <Wallet className="size-4 shrink-0 text-faint" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{w.label}</span>
                  {w.isPrimary ? <Badge tone="accent">Primary</Badge> : null}
                  {w.address.toLowerCase() === activeAddress?.toLowerCase() ? (
                    <Badge tone="settle">Active session</Badge>
                  ) : null}
                </div>
                <Mono value={w.address} display={shortAddress(w.address, 6)} label="wallet address" className="mt-0.5" />
              </div>
              <span className="shrink-0 text-2xs text-faint">
                {w.verifiedAt ? `Verified ${formatDate(w.verifiedAt)}` : "Unverified"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Alert tone="neutral" className="mt-4" icon={<Lock className="size-4" />} title="VerseFlow never holds your keys">
        Signing in proves you control an address. Funding and releasing are signed by your
        own wallet — the server has no key and cannot move your funds. Settlement runs on{" "}
        {chain.name} (chain {chain.chainId}).
      </Alert>
    </Section>
  );
}

function PrivacySection({
  user, metricOptions, hasReputation,
}: {
  user: SettingsUser;
  metricOptions: Array<{ key: PublicMetricKey; label: string; caption: string }>;
  hasReputation: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [enabled, setEnabled] = React.useState(user.publicProfileEnabled);
  const [metrics, setMetrics] = React.useState<PublicMetricKey[]>(user.publicMetrics);
  const [saving, setSaving] = React.useState(false);

  const dirty = enabled !== user.publicProfileEnabled || metrics.join() !== user.publicMetrics.join();

  const save = async () => {
    setSaving(true);
    const result = await api.patch("/api/settings/privacy", {
      publicProfileEnabled: enabled,
      publicMetrics: metrics,
    });

    if (result.ok) {
      toast({
        tone: "settle",
        title: enabled ? "Public profile updated" : "Public profile disabled",
        body: enabled ? undefined : "Your reputation is private again.",
      });
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not save", body: result.error.message });
    }
    setSaving(false);
  };

  return (
    <Section
      id="privacy"
      icon={<Eye className="size-4" />}
      title="Privacy and public reputation"
      description="Nothing about your work history is public unless you turn it on here."
      footer={
        <>
          <span className="text-2xs text-faint">
            {dirty ? "Unsaved changes" : "Everything saved"}
          </span>
          <Button className="ml-auto" variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="rounded-lg border border-line p-3.5">
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Enable my public profile"
          description={
            enabled
              ? `Visible at /p/${user.handle}. Only the metrics you select below are shown.`
              : "Your profile returns a 404 to anyone who visits it."
          }
        />
      </div>

      {!hasReputation ? (
        <Alert tone="neutral" className="mt-4">
          You have no settled agreements yet, so a public profile would be empty. It will
          fill in as you complete work.
        </Alert>
      ) : null}

      <fieldset className="mt-5" disabled={!enabled}>
        <legend className="text-xs font-medium text-muted">
          Metrics to publish
        </legend>
        <p className="mt-0.5 text-2xs text-faint">
          Choose individually. Anything not selected is not exposed by the public page or its API.
        </p>

        <div className={cn("mt-3 space-y-2", !enabled && "opacity-50")}>
          {metricOptions.map((option) => {
            const selected = metrics.includes(option.key);
            return (
              <label
                key={option.key}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  selected ? "border-accent-border bg-accent-soft" : "border-line hover:border-line-strong",
                  !enabled && "cursor-not-allowed",
                )}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!enabled}
                  onChange={(e) =>
                    setMetrics((prev) =>
                      e.target.checked ? [...prev, option.key] : prev.filter((k) => k !== option.key),
                    )
                  }
                  className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-subtle">{option.caption}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <Alert tone="neutral" className="mt-5" icon={<Info className="size-4" />} title="What is never published">
        Contract values you have not explicitly published, counterparty identities,
        acceptance criteria, evidence, messages, dispute details, and wallet balances. Showcased
        agreements can additionally have their value hidden behind a range.
      </Alert>
    </Section>
  );
}

function NotificationSection({ preferences }: { preferences: NotificationPreferences }) {
  const router = useRouter();
  const { toast } = useToast();
  const [channels, setChannels] = React.useState<Record<string, boolean>>(
    Object.fromEntries(
      NOTIFICATION_KINDS.map((k) => [k.kind, preferences.channels?.[k.kind] !== false]),
    ),
  );
  const [digest, setDigest] = React.useState(preferences.digestMode);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    const result = await api.patch("/api/settings/notifications", { channels, digestMode: digest });
    if (result.ok) {
      toast({ tone: "settle", title: "Notification preferences saved" });
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not save", body: result.error.message });
    }
    setSaving(false);
  };

  return (
    <Section
      icon={<Bell className="size-4" />}
      title="Notifications"
      description="Payment and signature events are on by default. Turning one off never delays the underlying action."
      footer={
        <Button className="ml-auto" variant="primary" size="sm" loading={saving} onClick={save}>
          Save changes
        </Button>
      }
    >
      <div className="rounded-lg border border-line p-3.5">
        <Toggle
          checked={digest}
          onChange={setDigest}
          label="Batch low-priority notifications"
          description="Group routine updates instead of surfacing each one. Payment and dispute events are always immediate."
        />
      </div>

      <ul className="mt-4 divide-y divide-line-subtle">
        {NOTIFICATION_KINDS.map((item) => (
          <li key={item.kind}>
            <Toggle
              checked={channels[item.kind] ?? true}
              onChange={(v) => setChannels((prev) => ({ ...prev, [item.kind]: v }))}
              label={item.label}
              description={item.description}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ConnectedAppsSection() {
  const integrations = [
    { name: "GitHub", description: "Read commit counts and repository access for evidence.", status: "manual" },
    { name: "Deployment checks", description: "Confirm a submitted URL is reachable at review time.", status: "manual" },
    { name: "Figma", description: "Read file metadata attached as design evidence.", status: "manual" },
  ];

  return (
    <Section
      icon={<Plug className="size-4" />}
      title="Connected applications"
      description="Evidence sources VerseFlow can read from."
    >
      <ul className="space-y-2">
        {integrations.map((item) => (
          <li key={item.name} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.name}</p>
              <p className="mt-0.5 text-xs text-subtle">{item.description}</p>
            </div>
            <Badge tone="neutral">Manual entry</Badge>
          </li>
        ))}
      </ul>

      {/* Stating plainly what is and is not built, rather than showing fake "Connect" buttons. */}
      <Alert tone="neutral" className="mt-4" icon={<Info className="size-4" />}>
        Evidence from these sources is currently entered by the provider and recorded as
        supplied. Automated verification through each provider&apos;s API is the next step and
        would populate commit counts and reachability checks directly.
      </Alert>
    </Section>
  );
}

function SecuritySection({
  user, chain,
}: {
  user: SettingsUser;
  chain: { mode: string; name: string; chainId: number; escrowAddress: string | null };
}) {
  return (
    <Section
      icon={<Shield className="size-4" />}
      title="Security and account"
      description="How your account and funds are protected."
    >
      <dl className="space-y-3">
        <Row label="Account created">{formatDate(user.createdAt, { withYear: true })}</Row>
        <Row label="Verification">
          <Badge tone={user.verification === "unverified" ? "neutral" : "settle"}>
            {user.verification.replace(/_/g, " ")}
          </Badge>
        </Row>
        <Row label="Role">
          <Badge tone={user.isAdmin ? "attn" : "neutral"}>
            {user.isAdmin ? "Operations" : "Standard"}
          </Badge>
        </Row>
        <Row label="Settlement mode">
          <span className={chain.mode === "live" ? "text-settle" : "text-attn"}>
            {chain.mode === "live" ? `${chain.name} (live)` : "Local simulation"}
          </span>
        </Row>
        {chain.escrowAddress ? (
          <Row label="Escrow contract">
            <Mono value={chain.escrowAddress} display={shortAddress(chain.escrowAddress, 5)} label="escrow contract address" />
          </Row>
        ) : null}
      </dl>

      <ul className="mt-5 space-y-2">
        {[
          "VerseFlow never stores private keys, and there is no server-side signing path.",
          "Every payment action requires your wallet signature and is verified against the settlement layer before it is recorded as settled.",
          "Release operations are idempotent, so a retried request cannot pay twice.",
          "The payment ledger and audit log are append-only at the database level.",
        ].map((line) => (
          <li key={line} className="flex items-start gap-2 text-xs leading-relaxed">
            <Check className="mt-0.5 size-3 shrink-0 text-settle" aria-hidden />
            <span className="text-muted">{line}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="text-right text-xs font-medium">{children}</dd>
    </div>
  );
}
