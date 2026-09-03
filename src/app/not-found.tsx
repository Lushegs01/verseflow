import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <p className="font-mono text-2xs text-faint">404</p>
      <h1 className="mt-3 text-gradient font-display text-3xl">This page could not be found.</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        It may have moved, or you may not have access to it. Private agreements are not
        visible to anyone who is not a party to them.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/app"
          className="inline-flex h-10 items-center gap-2 rounded-lg face-primary sheen px-4 text-sm font-medium text-primary-fg transition-transform duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-px active:translate-y-0"
        >
          Go to your dashboard
        </Link>
        <Link
          href="/"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm text-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Home
        </Link>
      </div>
    </div>
  );
}
