import Link from "next/link";
import { FileQuestion } from "lucide-react";

/**
 * In-app not-found boundary.
 *
 * Reached both by genuinely missing records and by a viewer who is not a party to
 * an agreement -- the two are deliberately indistinguishable, so the existence of
 * a private agreement is never revealed by the difference between 404 and 403.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-center px-4 py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-line bg-inset text-subtle">
        <FileQuestion className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 font-display text-2xl">This could not be found.</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        It may have been removed, or you may not be a party to it. Agreements are visible
        only to the client and the provider named in them.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/app"
          className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
        >
          Back to dashboard
        </Link>
        <Link
          href="/app/agreements"
          className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm transition-colors hover:bg-raised"
        >
          View agreements
        </Link>
      </div>
    </div>
  );
}
