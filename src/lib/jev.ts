import {
  coerceCategory,
  coercePriority,
  coerceStatus,
  extractJsonBlock,
  type Category,
  type DecidedBy,
  type Priority,
  type Requirement,
  type Status,
} from "@/lib/score";
import { knownAliasMatch } from "@/lib/match";

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const CONFIDENCE_ACT = 0.75;
const CONFIDENCE_FLOOR = 0.5;

const TECH_CATEGORIES = new Set<Category>(["required_skills", "preferred_skills"]);

export type JevAnswer = {
  type?: string;
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
};

export type JevResponse = {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  cost?: string;
};

export type NumericResult = "meets" | "below" | "unproven";

export type NumericFact = {
  required: { kind: string; op: string; value: number };
  candidate: { kind: string; value: number } | null;
};

export type ExtractedRequirement = {
  id: string;
  text: string;
  category: Category;
  priority: Priority;
  evidence: string;
  numeric: NumericFact | null;
};

export type CandidateProfile = {
  seniority: string;
  location: string;
  skills: string[];
  experience: Array<{ activity: string; months: number | null }>;
  education: string[];
};

export type RoleProfile = {
  seniority: string;
  location: string;
  domain: string;
};

export type Extracted = {
  role: RoleProfile;
  candidate: CandidateProfile;
  requirements: ExtractedRequirement[];
};

export type DecidedRequirement = Requirement & {
  probability: number;
  confidence: number;
  decidedBy: DecidedBy;
  needsReview: boolean;
};

export type JevSignal = { choice: string; confidence: number };

export type JevOutcome = {
  decisions: DecidedRequirement[];
  signals: Record<string, JevSignal>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  cost: string;
};

export function jevEnabled(): boolean {
  const flag = (process.env.JEV_ENABLED ?? "1").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(flag);
}

export function jevConfig() {
  return {
    baseUrl: (process.env.JEV_BASE_URL || "https://opencode.ai/zen").replace(/\/+$/, ""),
    model: process.env.JEV_MODEL || "jev-1.13-free",
    apiKey: process.env.JEV_API_KEY || "",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function askJev(
  state: unknown,
  questions: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JevResponse> {
  const { baseUrl, model, apiKey } = jevConfig();
  const url = `${baseUrl}/v1/systemone`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const body = JSON.stringify({ model, state, questions });

  let lastError = "Panggilan Jev gagal.";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body, signal });
    if (res.ok) {
      const data = (await res.json()) as JevResponse;
      if (!data || typeof data !== "object" || !data.answers) {
        throw new Error("Jev membalas tanpa field `answers`.");
      }
      return data;
    }
    const detail = await res.text().catch(() => "");
    lastError = `Jev ${res.status} ${res.statusText}. ${detail.slice(0, 400)}`;
    if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS - 1) break;
    await sleep(600 * (attempt + 1));
  }
  throw new Error(lastError);
}

const STATUS_CRITERIA: Record<Status, Record<string, unknown>> = {
  MATCH: {
    what: "The candidate's material explicitly names this exact requirement.",
    examples: ["Requirement 'React.js' and the candidate lists 'React.js'."],
  },
  EQUIVALENT: {
    what: "The candidate names the same thing under a different spelling, abbreviation, or product alias.",
    not_for: "A different product in the same category - that is RELATED.",
    examples: [
      "Golang = Go",
      "Postgres = PostgreSQL",
      "k8s = Kubernetes",
      "RESTful API = REST API",
    ],
  },
  RELATED: {
    what: "The candidate names a different but directly comparable technology occupying the same slot in the stack.",
    not_for:
      "A generic practice rather than a named technology. Deploying with Docker on a VPS does not make AWS RELATED.",
    examples: ["GCP vs AWS", "MySQL vs PostgreSQL", "Vue vs React", "Jest vs Vitest"],
  },
  PARTIAL: {
    what: "The candidate shows the same activity, but at a smaller scale than the requirement asks.",
    not_for:
      "An adjacent activity in the same area. Monitoring dashboards are not incident-response experience.",
    examples: [
      "A 3-month internship against a 2-year requirement.",
      "The role is listed but the year figure is never stated.",
    ],
  },
  MISSING: {
    what: "The candidate names nothing comparable to the requirement.",
    examples: ["Requirement 'TypeScript' and the candidate lists only JavaScript and Python."],
  },
};

const CATEGORY_STATUSES: Record<Category, Status[]> = {
  required_skills: ["MATCH", "EQUIVALENT", "RELATED", "PARTIAL", "MISSING"],
  preferred_skills: ["MATCH", "EQUIVALENT", "RELATED", "PARTIAL", "MISSING"],
  experience: ["MATCH", "EQUIVALENT", "PARTIAL", "MISSING"],
  responsibilities: ["MATCH", "PARTIAL", "MISSING"],
  education: ["MATCH", "EQUIVALENT", "PARTIAL", "MISSING"],
  keywords: ["MATCH", "PARTIAL", "MISSING"],
};

function requirementQuestion(req: ExtractedRequirement, index: number) {
  const criteria: Record<string, unknown> = {};
  for (const status of CATEGORY_STATUSES[req.category]) criteria[status] = STATUS_CRITERIA[status];
  return {
    type: "choice" as const,
    instructions: {
      question: "How well does `candidate` satisfy this requirement?",
      requirement: `\`role.requirements[${index}]\``,
      compare: [
        "`candidate.skills`",
        "`candidate.experience`",
        "`candidate.education`",
        "`candidate.evidence`",
      ],
      focus: "Judge technology and activity equivalence only.",
      not_for: `Do not judge or compare year counts, numbers, or thresholds - that comparison already exists in \`role.requirements[${index}].numeric\`.`,
    },
    criteria,
  };
}

const GLOBAL_QUESTIONS: Record<string, unknown> = {
  seniority_fit: {
    type: "choice",
    instructions:
      "How does the candidate's overall seniority compare with the seniority the role states?",
    criteria: {
      far_below: "The candidate is clearly below the role's seniority.",
      below: "The candidate is somewhat below the role's seniority.",
      matches: "The candidate's seniority matches the role.",
      above: "The candidate is above the role's seniority.",
      not_stated: "The role or the candidate does not state a seniority.",
    },
  },
  domain_fit: {
    type: "choice",
    instructions:
      "How close is the candidate's domain or industry background to the role's domain?",
    criteria: {
      same_domain: "The candidate has worked in the role's domain.",
      adjacent_domain: "The candidate's domain is adjacent to the role's.",
      unrelated_domain: "The candidate's domain is unrelated to the role's.",
      not_stated: "The role or the candidate does not state a domain.",
    },
  },
  location_fit: {
    type: "choice",
    instructions:
      "Does the candidate's stated location satisfy the role's stated location requirement?",
    criteria: {
      satisfies: "The candidate's location satisfies the role.",
      commutable: "The candidate could commute to the role.",
      relocation_needed: "The candidate would need to relocate.",
      mismatch: "The candidate's location conflicts with the role.",
      not_stated: "The role or the candidate does not state a location.",
    },
  },
};

function numericResult(numeric: NumericFact): NumericResult {
  if (!numeric.candidate) return "unproven";
  const a = numeric.required.value;
  const b = numeric.candidate.value;
  switch (numeric.required.op) {
    case ">":
      return b > a ? "meets" : "below";
    case ">=":
      return b >= a ? "meets" : "below";
    case "=":
    case "==":
      return b === a ? "meets" : "below";
    case "<":
      return b < a ? "meets" : "below";
    case "<=":
      return b <= a ? "meets" : "below";
    default:
      return "unproven";
  }
}

export function buildState(extracted: Extracted): unknown {
  const evidence = [...new Set(extracted.requirements.map((r) => r.evidence).filter(Boolean))];
  return {
    role: {
      seniority: extracted.role.seniority,
      location: extracted.role.location,
      domain: extracted.role.domain,
      requirements: extracted.requirements.map((r) => ({
        id: r.id,
        text: r.text,
        category: r.category,
        priority: r.priority,
        numeric: r.numeric ? { ...r.numeric, result: numericResult(r.numeric) } : null,
      })),
    },
    candidate: {
      seniority: extracted.candidate.seniority,
      location: extracted.candidate.location,
      skills: extracted.candidate.skills,
      experience: extracted.candidate.experience,
      education: extracted.candidate.education,
      evidence,
    },
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseNumeric(raw: unknown): NumericFact | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const required = row.required as Record<string, unknown> | undefined;
  if (!required || typeof required !== "object") return null;
  const value = asNumber(required.value);
  const op = asString(required.op) || ">=";
  const kind = asString(required.kind) || "units";
  const candidateRaw = row.candidate as Record<string, unknown> | null | undefined;
  const candidate =
    candidateRaw && typeof candidateRaw === "object" && candidateRaw.value !== null
      ? { kind: asString(candidateRaw.kind) || kind, value: asNumber(candidateRaw.value) }
      : null;
  return { required: { kind, op, value }, candidate };
}

function parseCandidate(raw: unknown): CandidateProfile {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const skills = Array.isArray(row.skills) ? row.skills.map(asString).filter(Boolean) : [];
  const education = Array.isArray(row.education)
    ? row.education.map(asString).filter(Boolean)
    : [];
  const experience = Array.isArray(row.experience)
    ? row.experience
        .map((item) => {
          if (typeof item === "string") return { activity: item.trim(), months: null };
          if (!item || typeof item !== "object") return null;
          const entry = item as Record<string, unknown>;
          const activity = asString(entry.activity);
          if (!activity) return null;
          const months = entry.months === null || entry.months === undefined ? null : asNumber(entry.months);
          return { activity, months };
        })
        .filter((x): x is { activity: string; months: number | null } => x !== null)
    : [];
  return {
    seniority: asString(row.seniority),
    location: asString(row.location),
    skills,
    experience,
    education,
  };
}

export function parseExtraction(reply: string): Extracted | null {
  const block = extractJsonBlock(reply);
  if (!block) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(block) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rawReqs = Array.isArray(parsed.requirements) ? parsed.requirements : [];
  const requirements: ExtractedRequirement[] = [];
  rawReqs.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const category = coerceCategory(row.category);
    const priority = coercePriority(row.priority) ?? "MEDIUM";
    const text = asString(row.requirement) || asString(row.text);
    if (!category || !text) return;
    const id = asString(row.id) || `req_${index}`;
    requirements.push({
      id,
      text,
      category,
      priority,
      evidence: asString(row.evidence),
      numeric: parseNumeric(row.numeric),
    });
  });

  if (requirements.length === 0) return null;

  const roleRaw = (parsed.role && typeof parsed.role === "object" ? parsed.role : {}) as Record<
    string,
    unknown
  >;

  return {
    role: {
      seniority: asString(roleRaw.seniority),
      location: asString(roleRaw.location),
      domain: asString(roleRaw.domain),
    },
    candidate: parseCandidate(parsed.candidate),
    requirements,
  };
}

function applyGuards(req: ExtractedRequirement, status: Status): Status {
  const result = req.numeric ? numericResult(req.numeric) : null;
  if (result === "below" && status !== "PARTIAL" && status !== "MISSING") return "PARTIAL";
  if (result === "meets" && status !== "MATCH" && status !== "EQUIVALENT") return "MATCH";
  if (status !== "MISSING" && !req.evidence) return "MISSING";
  if ((status === "EQUIVALENT" || status === "RELATED") && !TECH_CATEGORIES.has(req.category)) {
    return "PARTIAL";
  }
  if (status === "EQUIVALENT" && !knownAliasMatch(req.text, req.evidence)) return "RELATED";
  return status;
}

function gateConfidence(status: Status, confidence: number): { status: Status; needsReview: boolean } {
  if (confidence >= CONFIDENCE_ACT) return { status, needsReview: false };
  if (status === "MATCH" || status === "EQUIVALENT") return { status: "PARTIAL", needsReview: true };
  return { status, needsReview: true };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function decideOne(req: ExtractedRequirement, answer: JevAnswer | undefined): DecidedRequirement {
  let status: Status = "MISSING";
  let probability = 0;
  let confidence = 0;
  let decidedBy: DecidedBy = "code";

  if (answer && answer.type === "choice" && typeof answer.choice === "string") {
    const coerced = coerceStatus(answer.choice);
    if (coerced) {
      status = coerced;
      decidedBy = "jev";
    }
    confidence = asNumber(answer.confidence);
    probability = asNumber(answer.probabilities?.[status]) || asNumber(answer.probabilities?.[answer.choice]);
  }

  const guarded = applyGuards(req, status);
  if (guarded !== status) decidedBy = "code_override";
  status = guarded;

  const gated = gateConfidence(status, confidence);
  if (gated.status !== status) decidedBy = "code_override";
  status = gated.status;

  const priority: Priority =
    req.category === "keywords" && req.priority === "HIGH" ? "MEDIUM" : req.priority;
  const evidence = status === "MISSING" ? "" : req.evidence;

  return {
    requirement: req.text,
    category: req.category,
    priority,
    status,
    evidence,
    probability: round3(probability),
    confidence: round3(confidence),
    decidedBy,
    needsReview: gated.needsReview,
  };
}

export async function decideRequirements(
  extracted: Extracted,
  signal?: AbortSignal,
): Promise<JevOutcome> {
  const questions: Record<string, unknown> = {};
  extracted.requirements.forEach((req, index) => {
    questions[req.id] = requirementQuestion(req, index);
  });
  for (const [id, question] of Object.entries(GLOBAL_QUESTIONS)) questions[id] = question;

  const response = await askJev(buildState(extracted), questions, signal);
  const answers = response.answers ?? {};

  const decisions = extracted.requirements.map((req) => decideOne(req, answers[req.id]));

  const signals: Record<string, JevSignal> = {};
  for (const id of Object.keys(GLOBAL_QUESTIONS)) {
    const answer = answers[id];
    if (answer && typeof answer.choice === "string") {
      signals[id] = { choice: answer.choice, confidence: round3(asNumber(answer.confidence)) };
    }
  }

  return {
    decisions,
    signals,
    model: response.model ?? jevConfig().model,
    usage: {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
    },
    cost: response.cost ?? "0",
  };
}

export const CONFIDENCE_THRESHOLDS = { act: CONFIDENCE_ACT, floor: CONFIDENCE_FLOOR };
