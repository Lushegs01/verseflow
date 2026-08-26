"use client";

import * as React from "react";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui";
import { api } from "@/lib/utils/api-client";

/**
 * Reconcile one agreement against the settlement layer.
 *
 * Reports divergence rather than correcting it: an automatic "fix" would hide the
 * exact signal an operator needs to see.
 */
export function ReconcileButton({ agreementId }: { agreementId: string }) {
  const { toast } = useToast();
  const [state, setState] = React.useState<"idle" | "checking" | "ok" | "issues">("idle");

  const run = async () => {
    setState("checking");
    const result = await api.post<{ ok: boolean; issues: string[] }>("/api/admin/reconcile", { agreementId });

    if (!result.ok) {
      toast({ tone: "danger", title: "Could not reconcile", body: result.error.message });
      setState("idle");
      return;
    }

    if (result.data.ok) {
      setState("ok");
      toast({ tone: "settle", title: "Reconciled", body: "The ledger matches the settlement layer." });
    } else {
      setState("issues");
      toast({
        tone: "danger",
        title: "Divergence detected",
        body: result.data.issues[0] ?? "The ledger does not match the settlement layer.",
      });
    }
    setTimeout(() => setState("idle"), 4000);
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "checking"}
      aria-label="Reconcile against the settlement layer"
      title="Reconcile against the settlement layer"
      className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-inset hover:text-fg disabled:opacity-50"
    >
      {state === "checking" ? (
        <RefreshCw className="size-3.5 animate-spin" />
      ) : state === "ok" ? (
        <Check className="size-3.5 text-settle" />
      ) : state === "issues" ? (
        <AlertTriangle className="size-3.5 text-danger" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
    </button>
  );
}
