import type { NextRequest } from "next/server";
import { matchJob } from "@/lib/match";
import { deriveProfile, type SearchProfile } from "@/lib/profile";
import { searchAllSources, type JobListing } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_QUERIES = 3;
const PER_QUERY = 20;

export type ScoredJob = JobListing & {
  match: ReturnType<typeof matchJob>;
};

export async function POST(req: NextRequest) {
  let cv = "";
  let keyword = "";
  let location = "";

  try {
    const body = await req.json();
    cv = String(body?.cv ?? "").trim();
    keyword = String(body?.keyword ?? "").trim();
    location = String(body?.location ?? "").trim();
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

  const { jobs, sources } = await searchAllSources(limited, PER_QUERY, req.signal);

  const skills = profile
    ? { core: profile.core, other: profile.other }
    : { core: [] as string[], other: [] as string[] };

  const scored: ScoredJob[] = jobs
    .map((job) => ({
      ...job,
      match: matchJob(`${job.title}\n${job.description}`, skills),
    }))
    .sort((a, b) => b.match.score - a.match.score || b.match.matchedCore - a.match.matchedCore);

  const allSourcesFailed = sources.length > 0 && sources.every((s) => !s.ok);

  return Response.json({
    profile,
    profileError: profileError || null,
    queries: limited,
    location,
    sources,
    jobs: scored,
    allSourcesFailed,
  });
}
