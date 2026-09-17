import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { streamCompletion, type StreamChunk } from "@/lib/ai";
import { fillTemplate } from "@/lib/prompt";

export type SearchProfile = {
  titles: string[];
  core: string[];
  other: string[];
  seniority: string;
  location: string;
};

const PROMPT_PATH = path.join(process.cwd(), "prompts", "search-profile.md");
const MAX_CACHE = 20;

let cachedTemplate: string | null = null;
const cache = new Map<string, SearchProfile>();

async function loadProfileTemplate(): Promise<string> {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = await readFile(PROMPT_PATH, "utf8");
  return cachedTemplate;
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractJsonObject(raw: string): unknown {
  const text = raw.trim();
  const candidates: string[] = [];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

export function normalizeProfile(value: unknown): SearchProfile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  const titles = stringList(row.titles, 5);
  const core = stringList(row.core, 6);
  const other = stringList(row.other, 10).filter((skill) => !core.includes(skill));

  if (titles.length === 0 || core.length + other.length === 0) return null;

  return {
    titles,
    core,
    other,
    seniority: typeof row.seniority === "string" ? row.seniority.trim() : "",
    location: typeof row.location === "string" ? row.location.trim() : "",
  };
}

export function getCachedProfile(cv: string): SearchProfile | null {
  return cache.get(createHash("sha256").update(cv).digest("hex")) ?? null;
}

export async function deriveProfile(cv: string, signal: AbortSignal): Promise<SearchProfile | null> {
  const key = createHash("sha256").update(cv).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const template = await loadProfileTemplate();
  const prompt = fillTemplate(template, cv, "");

  let reply = "";
  for await (const chunk of streamCompletion(prompt, signal) as AsyncGenerator<StreamChunk>) {
    if (chunk.kind === "text") reply += chunk.text;
  }

  const profile = normalizeProfile(extractJsonObject(reply));
  if (!profile) return null;

  cache.set(key, profile);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return profile;
}
