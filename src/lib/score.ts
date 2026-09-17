export const STATUSES = ["MATCH", "EQUIVALENT", "PARTIAL", "RELATED", "MISSING"] as const;
export const CATEGORIES = [
  "required_skills",
  "experience",
  "responsibilities",
  "education",
  "preferred_skills",
  "keywords",
] as const;
export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;

export type Status = (typeof STATUSES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];

export type Requirement = {
  requirement: string;
  category: Category;
  priority: Priority;
  status: Status;
  evidence: string;
};

export type CategoryScore = {
  category: Category;
  label: string;
  score: number;
  count: number;
};

export type ScoreBreakdown = {
  overall: number;
  categories: CategoryScore[];
  requirements: Requirement[];
  counts: Record<Status, number>;
};

export const STATUS_VALUE: Record<Status, number> = {
  MATCH: 100,
  EQUIVALENT: 100,
  PARTIAL: 50,
  RELATED: 25,
  MISSING: 0,
};

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export const CATEGORY_LABEL: Record<Category, string> = {
  required_skills: "Required Skills",
  experience: "Experience",
  responsibilities: "Responsibilities",
  education: "Education",
  preferred_skills: "Preferred Skills",
  keywords: "Keywords",
};

const ALIASES: Record<string, Category> = {
  required: "required_skills",
  required_skill: "required_skills",
  required_skills: "required_skills",
  skills: "required_skills",
  preferred: "preferred_skills",
  preferred_skill: "preferred_skills",
  preferred_skills: "preferred_skills",
  nice_to_have: "preferred_skills",
  experience: "experience",
  years_of_experience: "experience",
  responsibilities: "responsibilities",
  responsibility: "responsibilities",
  duties: "responsibilities",
  education: "education",
  certifications: "education",
  keywords: "keywords",
  keyword: "keywords",
};

function normalizeCategory(value: unknown): Category | null {
  if (typeof value !== "string") return null;
  return ALIASES[value.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : null;
}

export function parseRequirements(raw: unknown): Requirement[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { requirements?: unknown }).requirements)
      ? (raw as { requirements: unknown[] }).requirements
      : [];

  const out: Requirement[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    const category = normalizeCategory(row.category);
    const status = normalizeEnum(row.status, STATUSES);
    const priority = normalizeEnum(row.priority, PRIORITIES);
    const text = typeof row.requirement === "string" ? row.requirement.trim() : "";
    if (!category || !status || !priority || !text) continue;

    const evidence = typeof row.evidence === "string" ? row.evidence.trim() : "";
    out.push({
      requirement: text,
      category,
      priority,
      status,
      evidence: status === "MISSING" ? "" : evidence,
    });
  }
  return out;
}

/** Pulls the last fenced ```json block out of a model reply. */
export function extractJsonBlock(text: string): string | null {
  const marker = "```json";
  const start = text.lastIndexOf(marker);
  if (start === -1) return null;
  const rest = text.slice(start + marker.length);
  const end = rest.indexOf("```");
  const body = (end === -1 ? rest : rest.slice(0, end)).trim();
  return body || null;
}

export function computeScore(requirements: Requirement[]): ScoreBreakdown {
  const grouped = new Map<Category, Requirement[]>();
  for (const req of requirements) {
    const bucket = grouped.get(req.category) ?? [];
    bucket.push(req);
    grouped.set(req.category, bucket);
  }

  const categories: CategoryScore[] = CATEGORIES.filter((c) => grouped.has(c)).map((category) => {
    const rows = grouped.get(category)!;
    const mean = rows.reduce((sum, r) => sum + STATUS_VALUE[r.status], 0) / rows.length;
    return {
      category,
      label: CATEGORY_LABEL[category],
      score: Math.round(mean),
      count: rows.length,
    };
  });

  const totalPriority = requirements.reduce((sum, r) => sum + PRIORITY_WEIGHT[r.priority], 0);
  const overall =
    totalPriority > 0
      ? requirements.reduce(
          (sum, r) => sum + STATUS_VALUE[r.status] * PRIORITY_WEIGHT[r.priority],
          0,
        ) / totalPriority
      : 0;

  const counts = STATUSES.reduce(
    (acc, s) => {
      acc[s] = requirements.filter((r) => r.status === s).length;
      return acc;
    },
    {} as Record<Status, number>,
  );

  return {
    overall: Math.round(overall),
    categories,
    requirements,
    counts,
  };
}

export function scoreReport(reply: string): ScoreBreakdown | null {
  const block = extractJsonBlock(reply);
  if (!block) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return null;
  }

  const requirements = parseRequirements(parsed);
  if (requirements.length === 0) return null;
  return computeScore(requirements);
}

/**
 * Removes the trailing machine-readable json block so it never reaches the UI.
 * Handles the fenced form, a bare fence, and an unfenced payload.
 */
export function stripJsonBlock(reply: string): string {
  const cut = (index: number) => trimTrailingRule(reply.slice(0, index));

  const fenced = reply.lastIndexOf("```json");
  if (fenced !== -1) return cut(fenced);

  const anyFence = reply.lastIndexOf("```");
  if (anyFence !== -1 && /"requirements"\s*:/.test(reply.slice(anyFence))) return cut(anyFence);

  const bare = reply.lastIndexOf('"requirements"');
  if (bare !== -1) {
    const brace = reply.lastIndexOf("{", bare);
    if (brace !== -1) return cut(brace);
  }

  const partial = reply.match(/\n?`{1,3}(?:j(?:s(?:o(?:n)?)?)?)?$/);
  if (partial?.index !== undefined) return cut(partial.index);

  return reply;
}

function trimTrailingRule(text: string): string {
  return text.replace(/\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, "").trimEnd();
}
