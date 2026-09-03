/**
 * Design system primitives.
 *
 * Small, composable, and deliberately opinionated. Every interactive element
 * carries a focus ring, a disabled state, and a loading state, because those are
 * the states that get skipped and then bite in production.
 */

"use client";

import * as React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, Check, AlertCircle, Info, X, ChevronDown } from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant =
  | "primary" | "secondary" | "ghost" | "danger" | "settle" | "outline" | "accent";
type ButtonSize = "sm" | "md" | "lg";

/**
 * Filled variants get a lit face (`face-*`) and a gloss sweep (`sheen`); quiet
 * ones get neither, because a highlight on a transparent control reads as a
 * rendering artefact rather than as light.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "face-primary sheen text-primary-fg",
  accent:
    "face-tint sheen bg-accent text-accent-fg hover:lift-accent",
  secondary:
    "face-quiet bg-raised text-fg border border-line hover:border-line-strong",
  outline:
    "bg-transparent text-fg border border-line-strong hover:bg-raised hover:border-line-strong",
  ghost:
    "bg-transparent text-muted hover:bg-inset hover:text-fg",
  danger:
    "face-tint sheen bg-danger text-white hover:lift-danger",
  settle:
    "face-tint sheen bg-settle text-white hover:lift-settle",
};

/** Quiet variants sit flat on the page; filled ones lift a hair on hover. */
const LIFTS_ON_HOVER: Record<ButtonVariant, boolean> = {
  primary: true, accent: true, secondary: true, outline: false,
  ghost: false, danger: true, settle: true,
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Text announced to screen readers while loading. */
  loadingText?: string;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    loadingText,
    icon,
    iconRight,
    fullWidth,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex select-none items-center justify-center font-medium",
        "transition-[background-color,border-color,box-shadow,transform,opacity]",
        "duration-200 ease-[var(--ease-out-expo)]",
        "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
        // Press is a translate rather than a scale: text stays pin-sharp.
        "active:translate-y-px active:duration-75",
        LIFTS_ON_HOVER[variant] && "hover:-translate-y-px",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        <>
          {icon ? <span className="shrink-0" aria-hidden>{icon}</span> : null}
          {children}
          {iconRight ? <span className="shrink-0" aria-hidden>{iconRight}</span> : null}
        </>
      )}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  className,
  interactive,
  glow,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  /** Coloured lift, for the one card on a screen that is about money. */
  glow?: "accent" | "settle" | "locked";
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl border border-line bg-raised lit",
        glow === "accent" ? "lift-accent" :
        glow === "settle" ? "lift-settle" :
        glow === "locked" ? "lift-locked" : "raised-2",
        interactive && [
          "transition-[border-color,box-shadow,transform] duration-300 ease-[var(--ease-out-expo)]",
          "hover:-translate-y-0.5 hover:border-line-strong hover:raised-4",
        ],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4 p-5 pb-0", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold tracking-tight", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-3 border-t border-line-subtle px-5 py-4", className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export type BadgeTone =
  | "neutral" | "accent" | "settle" | "locked" | "attn" | "danger" | "outline";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-inset text-muted border-line",
  accent: "bg-accent-soft text-accent border-accent-border",
  settle: "bg-settle-soft text-settle border-settle-border",
  locked: "bg-locked-soft text-locked border-locked-border",
  attn: "bg-attn-soft text-attn border-attn-border",
  danger: "bg-danger-soft text-danger border-danger-border",
  outline: "bg-transparent text-subtle border-line",
};

export function Badge({
  tone = "neutral",
  className,
  icon,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; icon?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5",
        "text-2xs font-medium tracking-tight edge-light",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    >
      {icon ? <span className="shrink-0" aria-hidden>{icon}</span> : null}
      {children}
    </span>
  );
}

/**
 * A status dot paired with its label. Never communicates state by colour alone --
 * the text is always present, which is what makes this accessible.
 */
export function StatusDot({ tone = "neutral", pulse }: { tone?: BadgeTone; pulse?: boolean }) {
  const color: Record<BadgeTone, string> = {
    neutral: "bg-faint",
    accent: "bg-accent",
    settle: "bg-settle",
    locked: "bg-locked",
    attn: "bg-attn",
    danger: "bg-danger",
    outline: "bg-faint",
  };
  // A soft halo in the dot's own colour: the state reads at a glance without
  // the dot having to get bigger or louder.
  const halo: Record<BadgeTone, string> = {
    neutral: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--fg-faint)_18%,transparent)]",
    accent: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)]",
    settle: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--settle)_22%,transparent)]",
    locked: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--locked)_22%,transparent)]",
    attn: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--attn)_22%,transparent)]",
    danger: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_22%,transparent)]",
    outline: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--fg-faint)_18%,transparent)]",
  };

  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      {pulse ? (
        <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", color[tone])} />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", color[tone], halo[tone])} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Suffix rendered on the label row, e.g. a character count. */
  aside?: React.ReactNode;
}

export function Field({
  label, htmlFor, hint, error, required, children, className, aside,
}: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
          {label}
          {required ? <span className="ml-0.5 text-danger" aria-hidden>*</span> : null}
        </label>
        {aside ? <span className="text-2xs text-faint tabular">{aside}</span> : null}
      </div>

      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
            "aria-invalid": error ? true : undefined,
            "aria-required": required || undefined,
          })
        : children}

      {hint && !error ? (
        <p id={hintId} className="text-xs text-faint">{hint}</p>
      ) : null}

      {/* Validation messages are announced, not just shown. */}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Inputs are sunken rather than raised: an inner shadow at the top edge reads
 * as a well the text sits inside, which is the opposite treatment to a button
 * and makes the two instantly distinguishable at a glance.
 */
const CONTROL_BASE =
  "w-full rounded-lg border border-line bg-inset px-3 text-sm text-fg " +
  "shadow-[inset_0_1px_2px_rgb(19_18_17/0.05)] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] " +
  "transition-[border-color,box-shadow,background-color] duration-200 ease-[var(--ease-out-expo)] " +
  "placeholder:text-faint " +
  "hover:border-line-strong " +
  "focus:border-accent focus:bg-raised focus:outline-none " +
  "focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)] " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-[invalid=true]:border-danger " +
  "aria-[invalid=true]:focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_18%,transparent)]";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL_BASE, "h-10", className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(CONTROL_BASE, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(CONTROL_BASE, "h-10 appearance-none pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint"
        aria-hidden
      />
    </div>
  );
});

export function Checkbox({
  label, description, className, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = React.useId();
  return (
    <label
      htmlFor={props.id ?? id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-raised p-3",
        "transition-colors hover:border-line-strong has-[:checked]:border-accent-border has-[:checked]:bg-accent-soft",
        props.disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        id={props.id ?? id}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-subtle">{description}</span> : null}
      </span>
    </label>
  );
}

export function Toggle({
  checked, onChange, label, description, disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-subtle">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 ease-[var(--ease-out-expo)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "bg-accent shadow-[inset_0_1px_2px_rgb(19_18_17/0.14),var(--glow-accent)]"
            : "bg-line-strong shadow-[inset_0_1px_2px_rgb(19_18_17/0.14)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white transition-transform duration-300",
            "shadow-[0_1px_2px_rgb(19_18_17/0.3),0_0_0_0.5px_rgb(19_18_17/0.06)]",
            "ease-[var(--ease-spring)]",
            checked ? "translate-x-[1.375rem]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Alert({
  tone = "neutral", title, children, icon, className, action,
}: {
  tone?: BadgeTone;
  title?: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "border-line bg-inset",
    accent: "border-accent-border bg-accent-soft",
    settle: "border-settle-border bg-settle-soft",
    locked: "border-locked-border bg-locked-soft",
    attn: "border-attn-border bg-attn-soft",
    danger: "border-danger-border bg-danger-soft",
    outline: "border-line bg-transparent",
  };
  const defaultIcon =
    tone === "danger" ? <AlertCircle className="size-4" /> :
    tone === "settle" ? <Check className="size-4" /> :
    <Info className="size-4" />;

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border p-3.5 edge-light", tones[tone], className)}
    >
      <span
        className={cn(
          "mt-px shrink-0",
          tone === "danger" && "text-danger",
          tone === "settle" && "text-settle",
          tone === "attn" && "text-attn",
          tone === "accent" && "text-accent",
          tone === "neutral" && "text-subtle",
        )}
        aria-hidden
      >
        {icon ?? defaultIcon}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="text-sm font-medium">{title}</p> : null}
        {children ? <div className="text-xs leading-relaxed text-muted">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function EmptyState({
  icon, title, description, action, className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {icon ? (
        <div className="relative mb-4">
          {/* A soft bloom behind the glyph, so an empty screen still feels composed. */}
          <span
            className="absolute -inset-4 rounded-full bg-accent/8 blur-xl"
            aria-hidden
          />
          <div className="relative flex size-12 items-center justify-center rounded-xl border border-line bg-inset text-subtle raised-1 lit">
            {icon}
          </div>
        </div>
      ) : null}
      <p className="text-base font-medium">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-subtle">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function Progress({
  value, tone = "accent", className, label, showValue,
}: {
  value: number;
  tone?: "accent" | "settle" | "locked" | "attn";
  className?: string;
  label?: string;
  showValue?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const bg = {
    accent: "bg-accent", settle: "bg-settle", locked: "bg-locked", attn: "bg-attn",
  }[tone];
  // Inner top highlight plus an outer bloom, in one declaration: `cn` collapses
  // repeated shadow utilities down to the last one.
  const fillShadow = {
    accent: "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35),0_0_10px_-2px_var(--accent)]",
    settle: "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35),0_0_10px_-2px_var(--settle)]",
    locked: "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35),0_0_10px_-2px_var(--locked)]",
    attn: "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35),0_0_10px_-2px_var(--attn)]",
  }[tone];

  return (
    <div className={cn("space-y-1.5", className)}>
      {label || showValue ? (
        <div className="flex items-baseline justify-between gap-2">
          {label ? <span className="text-xs text-subtle">{label}</span> : <span />}
          {showValue ? <span className="text-xs font-medium tabular">{clamped}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-sunken shadow-[inset_0_1px_2px_rgb(19_18_17/0.08)]"
      >
        {/* The fill is lit along its own top edge and carries a faint glow, so a
            bar at 80% reads as a charged thing rather than a painted rectangle. */}
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]",
            bg,
            fillShadow,
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open, onClose, title, description, children, footer, size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  // Escape closes, and focus moves into the dialog so keyboard users are not
  // stranded behind it.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      ref.current?.querySelector<HTMLElement>("button, input, textarea, select")?.focus();
    }, 50);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      clearTimeout(timer);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 backdrop-blur-[3px] animate-[fade_0.2s_ease-out]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden bg-raised lit",
          "border border-line raised-5",
          "rounded-t-2xl sm:rounded-2xl",
          "animate-[rise_0.28s_var(--ease-out-expo)]",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-subtle p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">{title}</h2>
            {description ? <p className="mt-1 text-xs text-subtle">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-m-1 shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-inset hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line-subtle p-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs({
  tabs, active, onChange, className,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("no-scrollbar flex gap-1 overflow-x-auto border-b border-line", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors",
              selected ? "text-fg" : "text-subtle hover:text-fg",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "ml-1.5 rounded-full border px-1.5 py-0.5 text-2xs tabular transition-colors",
                  selected ? "border-line bg-inset text-fg" : "border-transparent bg-inset text-subtle",
                )}
              >
                {tab.count}
              </span>
            ) : null}
            {selected ? (
              // Ink underline with a matching bloom -- the indicator looks lit
              // rather than drawn, and lines up with the elevation language.
              <span
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-fg shadow-[0_0_8px_-1px_var(--fg)]"
                aria-hidden
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export interface ToastMessage {
  id: string;
  tone: BadgeTone;
  title: string;
  body?: string;
}

const ToastContext = React.createContext<{
  toast: (t: Omit<ToastMessage, "id">) => void;
}>({ toast: () => {} });

export function useToast() {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);

  const toast = React.useCallback((t: Omit<ToastMessage, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setMessages((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setMessages((prev) => prev.filter((m) => m.id !== id)), 6000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Polite region: status updates are announced without interrupting. */}
      <div
        role="region"
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5",
              "glass raised-4",
              "animate-[rise_0.3s_var(--ease-out-expo)]",
              m.tone === "danger" && "border-danger-border",
              m.tone === "settle" && "border-settle-border",
              m.tone === "attn" && "border-attn-border",
              (m.tone === "neutral" || m.tone === "accent") && "border-line",
            )}
          >
            <span
              className={cn(
                "mt-px shrink-0",
                m.tone === "danger" ? "text-danger" : m.tone === "settle" ? "text-settle" : "text-accent",
              )}
              aria-hidden
            >
              {m.tone === "danger" ? <AlertCircle className="size-4" /> :
               m.tone === "settle" ? <Check className="size-4" /> : <Info className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{m.title}</p>
              {m.body ? <p className="mt-0.5 text-xs text-subtle">{m.body}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))}
              className="-m-1 shrink-0 rounded p-1 text-faint hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export function Avatar({
  name, color, size = "md", className,
}: {
  name: string;
  color?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    xs: "size-5 text-[9px]",
    sm: "size-7 text-2xs",
    md: "size-9 text-xs",
    lg: "size-12 text-sm",
    xl: "size-16 text-lg",
  };
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const base = color ?? "var(--accent)";

  return (
    <span
      className={cn(
        // A slight gradient plus a top highlight turns a flat colour disc into
        // something that catches light with the rest of the interface.
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),inset_0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(19_18_17/0.18)]",
        sizes[size],
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(145deg, color-mix(in oklab, ${base} 82%, white), ${base} 62%, color-mix(in oklab, ${base} 88%, black))`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/**
 * The VerseFlow mark: a chevron whose left arm is solid and whose right arm is
 * held back at partial opacity -- the product's whole model in one glyph, value
 * that is half released and half still in escrow.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center text-white", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundImage:
          "linear-gradient(145deg, var(--color-verse-400) 0%, var(--color-verse-500) 42%, var(--color-locked-500) 100%)",
        boxShadow:
          "inset 0 1px 0 0 rgb(255 255 255 / 0.38), inset 0 0 0 1px rgb(0 0 0 / 0.08), var(--glow-accent)",
      }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}
      >
        <path
          d="M4.9 7.1 12 18.6 19.1 7.1"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.45"
        />
        <path
          d="M4.9 7.1 12 18.6"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Mark plus wordmark. The lockup used in every header and footer. */
export function BrandLockup({
  size = 28, className, wordmarkClassName,
}: {
  size?: number;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={size} />
      <span className={cn("font-display text-xl leading-none tracking-tight", wordmarkClassName)}>
        VerseFlow
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Money display
// ---------------------------------------------------------------------------

/**
 * Animated count-up for figures. Respects reduced-motion by rendering the final
 * value immediately.
 */
export function CountUp({
  value, format, duration = 900, className,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = React.useState(value);
  const previous = React.useRef(value);

  React.useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      setDisplay(value);
      previous.current = value;
      return;
    }

    const from = previous.current;
    const delta = value - from;
    if (delta === 0) return;

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // Ease-out cubic: fast start, settled finish.
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + delta * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else previous.current = value;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <span className={cn("tabular", className)}>{format(display)}</span>;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Divider({ className, label }: { className?: string; label?: string }) {
  if (label) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <span className="h-px flex-1 bg-line" />
        <span className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return <hr className={cn("border-t border-line-subtle", className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-inset px-1 font-sans text-2xs font-medium text-subtle">
      {children}
    </kbd>
  );
}

/** Monospace hash/address with copy-to-clipboard. */
export function Mono({
  value, display, className, copyable = true, label,
}: {
  value: string;
  display?: string;
  className?: string;
  copyable?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the value stays selectable either way.
    }
  };

  const content = (
    <span className="font-mono text-2xs tracking-tight">{display ?? value}</span>
  );

  if (!copyable) {
    return <span className={cn("text-subtle", className)}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      aria-label={copied ? "Copied" : `Copy ${label ?? "value"}`}
      className={cn(
        "group inline-flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-subtle",
        "transition-colors hover:bg-inset hover:text-fg",
        className,
      )}
    >
      {content}
      {copied ? (
        <Check className="size-3 shrink-0 text-settle" aria-hidden />
      ) : (
        <svg className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </button>
  );
}
