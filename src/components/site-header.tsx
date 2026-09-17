"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Moon, ScanSearch, Search, Sun } from "lucide-react";
import { Button, cn } from "@/components/ui";

const NAV = [
  { href: "/", label: "Analisis", icon: ScanSearch },
  { href: "/cari", label: "Cari Lowongan", icon: Search },
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
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {}
  };

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="grid size-7 place-items-center rounded-md border border-border bg-muted">
              <ScanSearch className="size-3.5 text-muted-foreground" />
            </div>
            <span className="hidden text-sm font-medium tracking-tight sm:inline">
              Job Fit Analyzer
            </span>
          </Link>

          <nav className="flex items-center gap-0.5">
            {NAV.map((item) => {
              const isActive = (item.href === "/") === (active === "analyze");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          {children}
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Ganti tema">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </div>

      {busy && (
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <div className="progress-slide h-px w-1/4 bg-foreground/40" />
        </div>
      )}
    </header>
  );
}
