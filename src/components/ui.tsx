"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export { cn };

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
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-[4px] font-mono text-[11px] uppercase tracking-[1px] whitespace-nowrap transition-colors",
        "focus-visible:ring-2 focus-visible:ring-pine/30 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        variant === "default" && "bg-ink text-paper hover:bg-ink/90",
        variant === "outline" &&
          "border border-rule-2 text-ink-2 hover:border-ink-3/60 hover:bg-sheet hover:text-ink",
        variant === "ghost" && "text-ink-3 hover:bg-rule/50 hover:text-ink",
        size === "default" && "h-10 px-5",
        size === "sm" && "h-8 px-3.5",
        size === "icon" && "size-9",
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
      <div className="mb-3 flex min-h-[24px] items-center justify-between gap-3">
        <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[1.5px] text-ink-3">
          <span className="text-pine">{icon}</span>
          {label}
        </label>
        <div className="flex items-center gap-3">
          {hint && (
            <span className="hidden font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3 sm:inline">
              {hint}
            </span>
          )}
          {action}
        </div>
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-[6px] border bg-sheet transition-colors",
          dragging
            ? "border-pine ring-2 ring-pine/20"
            : "border-rule-2 focus-within:border-pine/50",
        )}
      >
        {children}
        {dragging && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-sheet/90 font-mono text-[11px] uppercase tracking-[1px] text-pine">
            Lepaskan file untuk di-upload
          </div>
        )}
      </div>

      {footer && <p className="mt-2.5 text-[12.5px] leading-[1.5] text-ink-3">{footer}</p>}
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
        "inline-flex items-center rounded-[3px] border px-2 py-[3px] text-[11px] leading-none whitespace-nowrap",
        tone === "neutral" && "border-rule bg-rule/40 text-ink-2",
        tone === "good" && "border-pine-2/30 bg-pine-2/10 text-pine",
        tone === "bad" && "border-rule-2 text-ink-3",
      )}
    >
      {children}
    </span>
  );
}

export function Meter({ value, tone = "neutral" }: { value: number; tone?: "neutral" | "good" }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="h-[5px] w-full overflow-hidden rounded-[3px] bg-rule">
      <div
        className={cn(
          "h-full rounded-[3px] transition-[width] duration-500",
          tone === "good" ? "bg-pine-2" : "bg-ink-3/70",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
