"use client";

import * as React from "react";
import Link from "next/link";
import { RotateCcw, AlertCircle } from "lucide-react";

/**
 * Root error boundary.
 *
 * Deliberately says nothing about what failed internally, and does say the one
 * thing a user of a payments product needs to hear: no action was applied.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[verseflow] unhandled UI error", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-danger-border bg-danger-soft text-danger">
        <AlertCircle className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-gradient font-display text-3xl">Something went wrong.</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        The action was not applied and nothing was charged. Your funds and agreements are
        unaffected.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-2xs text-faint">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center gap-2 rounded-lg face-primary sheen px-4 text-sm font-medium text-primary-fg transition-transform duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-px active:translate-y-0"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Try again
        </button>
        <Link
          href="/app"
          className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm transition-colors hover:bg-raised"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
