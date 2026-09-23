import type { NextRequest } from "next/server";
import { matchJob } from "@/lib/match";
import { deriveProfile, type SearchProfile } from "@/lib/profile";
import {
  enrichGlintsDescriptions,
  searchAllSources,
  type JobListing,
} from "@/lib/jobs";
import {
  TARGET_WINDOW_HOURS,
  postedTimestamp,
  relativeLabel,
  selectByFreshness,
} from "@/lib/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_QUERIES = 5;
const GLINTS_LIMIT = 50;
const JOBSTREET_PAGE_SIZE = 50;

export type ScoredJob = JobListing & {
  match: ReturnType<typeof matchJob>;
  locationMatch: boolean;
};

export async function POST(req: NextRequest) {
  let cv = "";
  let keyword = "";
  let locationInput = "";
  let locationStrict = false;

  try {
    const body = await req.json();
    cv = String(body?.cv ?? "").trim();
    keyword = String(body?.keyword ?? "").trim();
    locationInput = String(body?.location ?? "").trim();
    locationStrict = Boolean(body?.locationStrict);
  } catch {
    return Response.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  if (!cv && !keyword) {
    return Response.json({ error: "Isi CV atau kata kunci pencarian dulu." }, { status: 400 });
  }

  let profile: SearchProfile | null = null;
  let profileError = "";

  if (cv) {
    try {
      profile = await deriveProfile(cv, req.signal);
      if (!profile) profileError = "Profil tidak bisa dibaca dari CV ini.";
    } catch (err) {
      profileError = err instanceof Error ? err.message : "Gagal menurunkan profil dari CV.";
    }
  }

  const queries: string[] = [];
  if (keyword) queries.push(keyword);
  if (profile) {
    for (const title of profile.titles) {
      if (!queries.some((q) => q.toLowerCase() === title.toLowerCase())) queries.push(title);
    }
  }
  const limited = queries.slice(0, MAX_QUERIES);

  if (limited.length === 0) {
    return Response.json(
      { error: profileError || "Tidak bisa menentukan kata kunci pencarian dari CV ini." },
      { status: 422 },
    );
  }

  const location = locationInput || profile?.location || "";
  const strictLocation = locationStrict && location ? location : undefined;

  const searchOptions = {
    glintsLimit: GLINTS_LIMIT,
    jobstreetPageSize: JOBSTREET_PAGE_SIZE,
    strictLocation,
    signal: req.signal,
  };

  const now = Date.now();
  const result = await searchAllSources(limited, searchOptions);
  const fresh = selectByFreshness(result.jobs, now);

  // Teks lengkap Glints hanya ada di halaman detail; diambil setelah umur
  // disaring supaya jumlah request sesuai hasil yang benar-benar dipakai.
  const freshJobs = await enrichGlintsDescriptions(fresh.jobs, req.signal);
  const { sources } = result;

  const skills = profile
    ? { core: profile.core, other: profile.other }
    : { core: [] as string[], other: [] as string[] };

  const needle = location.trim().toLowerCase();
  const preferLocation = needle.length > 0 && !strictLocation;

  const scored: ScoredJob[] = freshJobs
    .map((job) => ({
      ...job,
      postedLabel: relativeLabel(job.postedAt, now) ?? job.postedLabel,
      match: matchJob(job.title, job.description, skills),
      locationMatch: preferLocation ? job.location.toLowerCase().includes(needle) : false,
    }))
    .sort(
      (a, b) =>
        b.match.score - a.match.score ||
        Number(b.locationMatch) - Number(a.locationMatch) ||
        b.match.titleMatches - a.match.titleMatches ||
        b.match.matchedCore - a.match.matchedCore ||
        postedTimestamp(b.postedAt) - postedTimestamp(a.postedAt),
    );

  const allSourcesFailed = sources.length > 0 && sources.every((s) => !s.ok);

  return Response.json({
    profile,
    profileError: profileError || null,
    queries: limited,
    location,
    locationStrict: Boolean(strictLocation),
    sources,
    jobs: scored,
    totalJobs: result.jobs.length,
    freshness: {
      targetHours: TARGET_WINDOW_HOURS,
      windowHours: fresh.windowHours,
      label: fresh.label,
      targetCount: fresh.targetCount,
    },
    allSourcesFailed,
  });
}
