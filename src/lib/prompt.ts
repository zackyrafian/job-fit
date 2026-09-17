import { readFile } from "node:fs/promises";
import path from "node:path";

const PROMPT_PATH = path.join(process.cwd(), "prompts", "job-fit-analysis.md");

let cachedTemplate: string | null = null;

export async function loadTemplate(): Promise<string> {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = await readFile(PROMPT_PATH, "utf8");
  return cachedTemplate;
}

/**
 * Uses the function form of `replaceAll` so that `$&`-style sequences inside
 * the CV/JD are never interpreted as replacement patterns.
 */
export function fillTemplate(template: string, cv: string, jd: string): string {
  return template
    .replaceAll("{{CV_CONTENT}}", () => cv)
    .replaceAll("{{JOB_DESCRIPTION}}", () => jd);
}
