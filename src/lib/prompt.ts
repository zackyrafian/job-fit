import { readFile } from "node:fs/promises";
import path from "node:path";

export const MODES = {
  fast: "job-fit-analysis-compact.md",
  detailed: "job-fit-analysis.md",
} as const;

export type AnalysisMode = keyof typeof MODES;

export function isAnalysisMode(value: unknown): value is AnalysisMode {
  return typeof value === "string" && value in MODES;
}

const cache = new Map<AnalysisMode, string>();

async function loadTemplate(mode: AnalysisMode): Promise<string> {
  const cached = cache.get(mode);
  if (cached) return cached;

  const file = path.join(process.cwd(), "prompts", MODES[mode]);
  const template = await readFile(file, "utf8");
  cache.set(mode, template);
  return template;
}

/**
 * Fills the template placeholders. Uses the function form of `replaceAll`
 * so that `$&`-style sequences inside the CV/JD are never interpreted.
 */
export async function buildPrompt(
  cv: string,
  jd: string,
  mode: AnalysisMode = "fast",
): Promise<string> {
  const template = await loadTemplate(mode);
  return template
    .replaceAll("{{CV_CONTENT}}", () => cv)
    .replaceAll("{{JOB_DESCRIPTION}}", () => jd);
}
