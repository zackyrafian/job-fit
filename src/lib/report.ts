export type ReportMatch = { name: string; status: string; quote: string };
export type ReportPartial = { name: string; body: string };
export type ReportUnmatched = { skill: string; priority: string; reason: string };
export type KeywordGroup = { label: string; items: string[] };
export type AbsorptionRow = { keyword: string; status: string; recommendation: string };
export type ChangeItem = {
  num: string;
  title: string;
  current: string;
  recommended: string;
  reason: string;
};
export type GapGroup = { label: string; items: string[] };

export type ParsedReport = {
  matched: ReportMatch[];
  partial: ReportPartial[];
  unmatched: ReportUnmatched[];
  keywordGroups: KeywordGroup[];
  absorption: AbsorptionRow[];
  changes: ChangeItem[];
  gaps: GapGroup[];
  emphasize: string[];
  avoid: string[];
  hasAny: boolean;
};

const EMPTY: ParsedReport = {
  matched: [],
  partial: [],
  unmatched: [],
  keywordGroups: [],
  absorption: [],
  changes: [],
  gaps: [],
  emphasize: [],
  avoid: [],
  hasAny: false,
};

function stripMd(input: string): string {
  return input
    .replace(/`/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+?)\*/g, "$1$2")
    .replace(/__([^_]+?)__/g, "$1")
    .trim();
}

function unquote(input: string): string {
  return input
    .trim()
    .replace(/^[“”"'«»]+/, "")
    .replace(/[“”"'«»]+$/, "")
    .trim();
}

function splitList(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((s) => s.trim()).filter(Boolean);
}

const SECTION_KEYS: Record<string, string> = {
  "matched skills": "matched",
  matched: "matched",
  "keterampilan cocok": "matched",
  "partial matches": "partial",
  "partial match": "partial",
  "kecocokan sebagian": "partial",
  "unmatched skills": "unmatched",
  unmatched: "unmatched",
  "tidak cocok": "unmatched",
  "keyword analysis": "keywords",
  "analisis kata kunci": "keywords",
  "keyword absorption": "absorption",
  "penyerapan kata kunci": "absorption",
  "recommended cv changes": "changes",
  "recommended changes": "changes",
  "cv changes": "changes",
  "saran perubahan cv": "changes",
  "final skill gap": "gap",
  "final gaps": "gap",
  "skill gap": "gap",
};

function sectionKey(heading: string): string | null {
  const key = heading
    .toLowerCase()
    .replace(/[#*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return SECTION_KEYS[key] ?? null;
}

function bulletText(raw: string): string | null {
  const m = raw.match(/^\s*[-*]\s+(.+)$/);
  return m ? m[1].trim() : null;
}

function parseMatchLine(raw: string): ReportMatch | null {
  const line = bulletText(raw) ?? raw.trim();
  if (!line) return null;

  const nameM = line.match(/\*\*(.+?)\*\*/);
  let name = nameM ? nameM[1].trim() : "";
  let rest = nameM ? line.slice((nameM.index ?? 0) + nameM[0].length) : line;

  let status = "";
  const sm = rest.match(/^\s*[—–-]\s*`?([A-Za-z_]{2,})`?\s*/);
  if (sm) {
    status = sm[1].toUpperCase();
    rest = rest.slice(sm[0].length);
  }
  rest = rest.replace(/^\s*[—–-]\s*/, "").trim();

  if (!name) name = unquote(stripMd(rest));
  if (!name) return null;
  return { name: stripMd(name), status, quote: unquote(stripMd(rest)) };
}

function parsePartialLine(raw: string): ReportPartial | null {
  const line = bulletText(raw) ?? raw.trim();
  if (!line) return null;

  const nameM = line.match(/\*\*(.+?)\*\*/);
  let name = nameM ? nameM[1].trim() : "";
  let body = nameM ? line.slice((nameM.index ?? 0) + nameM[0].length) : line;
  body = body.replace(/^\s*[—–-]\s*/, "").trim();

  if (!name) {
    name = body;
    body = "";
  }
  return { name: stripMd(name), body: stripMd(body) };
}

function parseTable(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    if (/^\|[\s:|-]+\|?$/.test(line)) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => stripMd(c.trim()));
    if (cells.length) rows.push(cells);
  }
  if (rows.length && /^(skill|keyword|kata kunci)\b/i.test(rows[0][0] ?? "")) rows.shift();
  return rows;
}

function parseKeywordGroups(lines: string[]): KeywordGroup[] {
  const groups: KeywordGroup[] = [];
  let current: KeywordGroup | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const labelOnly = line.match(/^\*\*(.+?)\*\*\s*:?\s*$/);
    if (labelOnly) {
      current = { label: labelOnly[1].trim(), items: [] };
      groups.push(current);
      continue;
    }
    const inline = line.match(/^\*\*(.+?)\*\*\s*:?\s*(.+)$/);
    if (inline) {
      current = { label: inline[1].trim(), items: splitList(stripMd(inline[2])) };
      groups.push(current);
      continue;
    }
    if (current) current.items.push(...splitList(stripMd(line)));
  }
  return groups.filter((g) => g.items.length > 0);
}

function parseChanges(lines: string[]): ChangeItem[] {
  const items: ChangeItem[] = [];
  let cur: ChangeItem | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const head = line.match(/^\*\*(\d+)\s*[.)]\s*(.+?)\*\*\s*$/);
    if (head) {
      cur = { num: head[1], title: stripMd(head[2]), current: "", recommended: "", reason: "" };
      items.push(cur);
      continue;
    }
    if (!cur) continue;

    const field = line.match(/^[-*]?\s*\*\*(current|recommended|reason)\s*:?\*\*\s*(.+)$/i);
    if (field) {
      const value = unquote(stripMd(field[2].trim()));
      const key = field[1].toLowerCase();
      if (key === "current") cur.current = value;
      else if (key === "recommended") cur.recommended = value;
      else cur.reason = value;
    }
  }
  return items;
}

function parseGap(lines: string[]): { gaps: GapGroup[]; emphasize: string[]; avoid: string[] } {
  const groups: Record<string, string[]> = {};
  let currentKey: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const label = line.match(/^\*\*(.+?)\*\*\s*:?\s*$/);
    if (label) {
      currentKey = label[1].trim().toLowerCase();
      groups[currentKey] = groups[currentKey] ?? [];
      continue;
    }
    const item = bulletText(line);
    if (item && currentKey) groups[currentKey].push(stripMd(item));
  }

  const pick = (...needles: string[]): string[] => {
    for (const key of Object.keys(groups)) {
      if (needles.every((n) => key.includes(n))) return groups[key];
    }
    return [];
  };

  const gaps: GapGroup[] = [];
  const strong = pick("strong");
  const partial = pick("partial");
  const skillGaps = pick("gap", "skill");
  if (strong.length) gaps.push({ label: "COCOK KUAT", items: strong });
  if (partial.length) gaps.push({ label: "COCOK SEBAGIAN", items: partial });
  if (skillGaps.length) gaps.push({ label: "KESENJANGAN", items: skillGaps });

  const emphasize = pick("emphas");
  const avoid = pick("not", "claim");
  return { gaps, emphasize, avoid };
}

export function parseReport(markdown: string): ParsedReport {
  if (!markdown.trim()) return { ...EMPTY };

  const fenced = markdown.lastIndexOf("```json");
  const text = fenced !== -1 ? markdown.slice(0, fenced) : markdown;

  const buckets: Record<string, string[]> = {};
  let section: string | null = null;

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = raw.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      section = sectionKey(heading[1]);
      if (section) buckets[section] = buckets[section] ?? [];
      continue;
    }
    if (section) buckets[section].push(raw);
  }

  const matched = (buckets.matched ?? [])
    .map(parseMatchLine)
    .filter((x): x is ReportMatch => x !== null);
  const partial = (buckets.partial ?? [])
    .map(parsePartialLine)
    .filter((x): x is ReportPartial => x !== null);
  const unmatched = parseTable(buckets.unmatched ?? []).map((cells) => ({
    skill: cells[0] ?? "",
    priority: cells[1] ?? "",
    reason: cells[2] ?? "",
  }));
  const keywordGroups = parseKeywordGroups(buckets.keywords ?? []);
  const absorption = parseTable(buckets.absorption ?? []).map((cells) => ({
    keyword: cells[0] ?? "",
    status: (cells[1] ?? "").toUpperCase().replace(/\s+/g, "_"),
    recommendation: cells[2] ?? "",
  }));
  const changes = parseChanges(buckets.changes ?? []);
  const { gaps, emphasize, avoid } = parseGap(buckets.gap ?? []);

  const hasAny =
    matched.length > 0 ||
    partial.length > 0 ||
    unmatched.length > 0 ||
    keywordGroups.length > 0 ||
    absorption.length > 0 ||
    changes.length > 0 ||
    gaps.length > 0 ||
    emphasize.length > 0 ||
    avoid.length > 0;

  return {
    matched,
    partial,
    unmatched,
    keywordGroups,
    absorption,
    changes,
    gaps,
    emphasize,
    avoid,
    hasAny,
  };
}

export const CATEGORY_LABEL_ID: Record<string, string> = {
  required_skills: "Keterampilan wajib",
  preferred_skills: "Keterampilan pendukung",
  experience: "Pengalaman",
  responsibilities: "Tanggung jawab",
  education: "Pendidikan",
  keywords: "Kata kunci",
};

export function scoreVerdict(overall: number): string {
  if (overall >= 85) return "Sangat cocok";
  if (overall >= 75) return "Cocok";
  if (overall >= 50) return "Cukup cocok";
  if (overall >= 30) return "Kurang cocok";
  return "Tidak cocok";
}

export function scoreNote(counts: Record<string, number>): string {
  const matched = (counts.MATCH ?? 0) + (counts.EQUIVALENT ?? 0);
  const partial = (counts.PARTIAL ?? 0) + (counts.RELATED ?? 0);
  const missing = counts.MISSING ?? 0;
  const parts = [`${matched} keterampilan cocok penuh`, `${partial} cocok sebagian`];
  parts.push(
    missing > 0 ? `${missing} tidak terpenuhi` : "tanpa persyaratan yang sepenuhnya tidak terpenuhi",
  );
  return `${parts.join(", ")}.`;
}

export type PanelSummary = {
  title: string;
  meta: string;
  summary: string;
  file: string;
};

function pickTitle(line: string | undefined): string {
  const value = (line ?? "").trim();
  if (!value || value.length > 80) return "";
  if (/[@]|https?:\/\//i.test(value)) return "";
  return value.replace(/^[#>*\-\s]+/, "").trim();
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function summarize(text: string, fallback: string): PanelSummary {
  const clean = text.trim();
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = pickTitle(lines[0]) || fallback;
  const rest = collapse(lines.slice(title === fallback ? 0 : 1).join(" "));
  return {
    title,
    meta: `${lines.length} baris · ${clean.length.toLocaleString("id-ID")} karakter`,
    summary: truncate(rest, 240) || "—",
    file: "",
  };
}

export function summarizeCv(cv: string, fileName?: string): PanelSummary {
  const result = summarize(cv, "CV Kandidat");
  result.file = fileName ? fileName : "teks ditempel";
  return result;
}

export function summarizeJob(jd: string): PanelSummary {
  const result = summarize(jd, "Deskripsi Pekerjaan");
  result.file = "deskripsi_pekerjaan.txt";
  return result;
}
