"use client";

import Link from "next/link";
import { cn } from "@/components/ui";

const NAV = [
  { href: "/", label: "Analisis", key: "analyze" },
  { href: "/cari", label: "Lowongan", key: "search" },
] as const;

export function SiteHeader({
  active,
  busy = false,
  children,
}: {
  active: "analyze" | "search";
  busy?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-[74px] w-full max-w-[1440px] items-center justify-between gap-6 px-6 md:px-12 lg:px-[88px]">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-[30px] place-items-center rounded-[7px] bg-pine font-serif text-[17px] leading-none text-paper">
            R
          </span>
          <span className="font-serif text-[21px] tracking-[-0.4px]">Rekrut</span>
        </Link>

        <div className="flex items-center gap-4 md:gap-9">
          <nav className="hidden items-center gap-7 md:flex">
            {NAV.map((item) => {
              const isActive = item.key === active;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-[1px] transition-colors",
                    isActive ? "text-ink" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {children}
        </div>
      </div>

      {busy && (
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <div className="progress-slide h-px w-1/4 bg-pine/50" />
        </div>
      )}
    </header>
  );
}
