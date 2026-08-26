"use client";

import * as React from "react";
import { Sun, Moon } from "lucide-react";

/**
 * Theme toggle. The initial class is applied by an inline script in the root
 * layout before paint, so this component only has to stay in sync with it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("vf-theme", next ? "dark" : "light");
    } catch {
      // Storage can be unavailable in private modes; the toggle still works for
      // this session, it just will not be remembered.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className={`inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg ${className ?? ""}`}
    >
      {/* Render nothing until mounted so server and client markup agree. */}
      {mounted ? (dark ? <Sun className="size-4" /> : <Moon className="size-4" />) : <span className="size-4" />}
    </button>
  );
}
