"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { BrandLockup } from "@/components/ui";

const NAV = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Agreement engine", href: "/#ai" },
  { label: "Docs", href: "/docs" },
];

export function MarketingHeader() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu on route hash change so a nav tap does not leave it open.
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-300 ${
        scrolled ? "glass shadow-[0_1px_0_0_var(--border),0_8px_24px_-16px_rgb(19_18_17/0.3)]" : "bg-transparent"
      }`}
    >
      {/* A hairline that brightens toward the centre rather than a flat rule --
          the page edge reads as lit, matching every other surface. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-px transition-opacity duration-300 ${
          scrolled ? "opacity-100" : "opacity-0"
        }`}
        style={{
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklab, var(--accent) 35%, transparent) 30%, color-mix(in oklab, var(--locked) 30%, transparent) 70%, transparent)",
        }}
      />

      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Link href="/" aria-label="VerseFlow home" className="group">
          <BrandLockup
            size={26}
            className="transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:-translate-y-px"
          />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/app"
            className="hidden h-9 items-center rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg sm:inline-flex"
          >
            Open app
          </Link>
          <Link
            href="/app/agreements/new"
            className="face-primary sheen group inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-primary-fg transition-transform duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-px active:translate-y-px"
          >
            <span className="hidden sm:inline">Create agreement</span>
            <span className="sm:hidden">Create</span>
            <ArrowRight
              className="size-3.5 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="-mr-1 rounded-md p-1.5 text-muted transition-colors hover:bg-raised md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="glass border-t border-line px-5 py-3 md:hidden"
        >
          <ul className="space-y-1">
            {[...NAV, { label: "Open app", href: "/app" }].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm text-muted transition-colors hover:bg-raised hover:text-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
