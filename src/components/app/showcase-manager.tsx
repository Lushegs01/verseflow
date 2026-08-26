"use client";

/**
 * Public showcase management.
 *
 * Publishing is per-agreement and opt-in, with a value-anonymization toggle, so a
 * provider can show scale and credibility without disclosing what a specific
 * client paid.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X, EyeOff, Eye } from "lucide-react";
import {
  Card, Button, Badge, Modal, Field, Input, Textarea, EmptyState, useToast, Toggle,
} from "@/components/ui";
import { formatMoney } from "@/lib/domain/money";
import { formatDate } from "@/lib/utils/format";
import { api } from "@/lib/utils/api-client";

interface Candidate {
  id: string;
  title: string;
  totalAmount: number;
  asset: string;
  completedAt: string | null;
}

interface Existing {
  id: string;
  agreementId: string;
  publicTitle: string;
  summary: string;
  anonymizeValue: boolean;
}

export function ShowcaseManager({
  candidates, existing,
}: { candidates: Candidate[]; existing: Existing[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [adding, setAdding] = React.useState<Candidate | null>(null);

  const publishedIds = new Set(existing.map((e) => e.agreementId));
  const available = candidates.filter((c) => !publishedIds.has(c.id));

  const remove = async (id: string) => {
    const result = await api.del("/api/settings/showcase", { id });
    if (result.ok) {
      toast({ tone: "neutral", title: "Removed from your public profile" });
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not remove", body: result.error.message });
    }
  };

  return (
    <div className="space-y-4">
      {existing.length === 0 && available.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to showcase yet"
            description="Completed agreements can be added to your public profile."
          />
        </Card>
      ) : null}

      {existing.length > 0 ? (
        <ul className="space-y-2">
          {existing.map((item) => {
            const agreement = candidates.find((c) => c.id === item.agreementId);
            return (
              <li key={item.id}>
                <Card className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{item.publicTitle}</h3>
                      <Badge tone={item.anonymizeValue ? "neutral" : "settle"}>
                        {item.anonymizeValue ? "Value hidden" : "Value shown"}
                      </Badge>
                    </div>
                    {item.summary ? (
                      <p className="mt-1 text-xs text-subtle">{item.summary}</p>
                    ) : null}
                    {agreement ? (
                      <p className="mt-1 text-2xs text-faint">
                        {agreement.title} · completed {formatDate(agreement.completedAt)}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    aria-label={`Remove ${item.publicTitle} from public profile`}
                    className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}

      {available.length > 0 ? (
        <Card>
          <div className="border-b border-line-subtle px-4 py-3">
            <h3 className="text-xs font-semibold">Available to publish</h3>
          </div>
          <ul className="divide-y divide-line-subtle">
            {available.slice(0, 6).map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{c.title}</p>
                  <p className="text-2xs text-faint">
                    {formatMoney(c.totalAmount, c.asset)} · completed {formatDate(c.completedAt)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" icon={<Plus className="size-3" />} onClick={() => setAdding(c)}>
                  Publish
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <AddModal candidate={adding} onClose={() => setAdding(null)} />
    </div>
  );
}

function AddModal({ candidate, onClose }: { candidate: Candidate | null; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [anonymize, setAnonymize] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (candidate) {
      setTitle(candidate.title.split(" — ")[0]);
      setSummary("");
      setAnonymize(true);
    }
  }, [candidate]);

  const save = async () => {
    if (!candidate) return;
    setSaving(true);
    const result = await api.post("/api/settings/showcase", {
      agreementId: candidate.id,
      publicTitle: title.trim(),
      summary: summary.trim(),
      anonymizeValue: anonymize,
    });

    if (result.ok) {
      toast({ tone: "settle", title: "Added to your public profile" });
      onClose();
      router.refresh();
    } else {
      toast({ tone: "danger", title: "Could not publish", body: result.error.message });
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(candidate)}
      onClose={onClose}
      title="Publish to your profile"
      description="You control the title, the summary, and whether the value is shown."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={save}>
            Publish
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Public title"
          htmlFor="sc-title"
          required
          hint="You can rename this so the client is not identifiable."
        >
          <Input
            id="sc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="E-commerce redesign"
            maxLength={120}
          />
        </Field>

        <Field label="Short summary" htmlFor="sc-summary" aside={`${summary.length}/400`}>
          <Textarea
            id="sc-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Delivered on schedule across three milestones."
            rows={2}
            maxLength={400}
          />
        </Field>

        <div className="rounded-lg border border-line p-3">
          <Toggle
            checked={anonymize}
            onChange={setAnonymize}
            label="Hide the exact contract value"
            description={
              candidate
                ? anonymize
                  ? `A range will be shown instead of ${formatMoney(candidate.totalAmount, candidate.asset)}.`
                  : `${formatMoney(candidate.totalAmount, candidate.asset)} will be visible publicly.`
                : ""
            }
          />
        </div>

        <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-faint">
          <EyeOff className="mt-px size-3 shrink-0" aria-hidden />
          Acceptance criteria, evidence, messages, and the counterparty are never published.
        </p>
      </div>
    </Modal>
  );
}
