import type { JobListing } from "@/lib/jobs";

export type FreshnessWindow = {
  hours: number;
  label: string;
};

export const FRESHNESS_WINDOWS: FreshnessWindow[] = [{ hours: 24, label: "24 jam terakhir" }];

export const TARGET_WINDOW_HOURS = FRESHNESS_WINDOWS[0].hours;

export type FreshnessSelection = {
  jobs: JobListing[];
  windowHours: number;
  label: string;
  targetCount: number;
};

export function ageHours(postedAt: string | null, now: number): number | null {
  if (!postedAt) return null;
  const timestamp = Date.parse(postedAt);
  if (!Number.isFinite(timestamp)) return null;
  return (now - timestamp) / 3_600_000;
}

export function postedTimestamp(postedAt: string | null): number {
  if (!postedAt) return 0;
  const timestamp = Date.parse(postedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function relativeLabel(postedAt: string | null, now: number): string | null {
  const age = ageHours(postedAt, now);
  if (age === null) return null;
  if (age < 1 / 60) return "baru saja";
  if (age < 1) return `${Math.max(1, Math.round(age * 60))} menit lalu`;
  if (age < 24) return `${Math.round(age)} jam lalu`;
  const days = Math.round(age / 24);
  if (days < 30) return `${days} hari lalu`;
  return `${Math.round(days / 30)} bulan lalu`;
}

export function selectByFreshness(
  jobs: JobListing[],
  now: number = Date.now(),
): FreshnessSelection {
  // Hanya hari ini (≤24 jam) yang boleh tampil; tanpa pelebaran jendela.
  const window = FRESHNESS_WINDOWS[0];
  const kept = jobs.filter((job) => {
    const age = ageHours(job.postedAt, now);
    return age !== null && age >= 0 && age <= window.hours;
  });

  return {
    jobs: kept,
    windowHours: window.hours,
    label: window.label,
    targetCount: kept.length,
  };
}
