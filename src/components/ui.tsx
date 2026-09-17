"use client";

import { useState } from "react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Button({
  variant = "default",
  size = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
}) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
        "focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "outline" && "border border-border bg-background hover:bg-muted",
        variant === "ghost" && "hover:bg-muted",
        size === "default" && "h-9 px-4",
        size === "sm" && "h-8 gap-1.5 px-3 text-xs",
        size === "icon" && "size-8",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  icon,
  hint,
  footer,
  action,
  onFileDrop,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  hint?: string;
  footer?: string;
  action?: React.ReactNode;
  onFileDrop?: (file: File) => void;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);

  const dropProps = onFileDrop
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFileDrop(file);
        },
      }
    : {};

  return (
    <div {...dropProps} className="flex flex-col">
      <div className="mb-2 flex h-7 items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <span className="text-muted-foreground">{icon}</span>
          {label}
        </label>
        <div className="flex items-center gap-2">
          {hint && (
            <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
              {hint}
            </span>
          )}
          {action}
        </div>
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-md border bg-transparent transition-shadow",
          dragging
            ? "border-ring ring-[3px] ring-ring/20"
            : "border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20",
        )}
      >
        {children}
        {dragging && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/85 text-sm font-medium">
            Lepaskan file untuk di-upload
          </div>
        )}
      </div>

      {footer && <p className="mt-1.5 text-xs text-muted-foreground">{footer}</p>}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap",
        tone === "neutral" && "border-border bg-muted/40 text-muted-foreground",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        tone === "bad" && "border-border bg-transparent text-muted-foreground/70",
      )}
    >
      {children}
    </span>
  );
}

export function Meter({ value, tone = "neutral" }: { value: number; tone?: "neutral" | "good" }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "good" ? "bg-emerald-500" : "bg-foreground/70",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
