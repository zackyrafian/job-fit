import { readFile } from "node:fs/promises";
import path from "node:path";

const PROMPT_DIR = path.join(process.cwd(), "prompts");
const templates = new Map<string, string>();

export async function loadTemplateFile(name: string): Promise<string> {
  const cached = templates.get(name);
  if (cached) return cached;
  const content = await readFile(path.join(PROMPT_DIR, name), "utf8");
  templates.set(name, content);
  return content;
}

export function loadTemplate(): Promise<string> {
  return loadTemplateFile("job-fit-analysis.md");
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

export function fillDecisionsTemplate(
  template: string,
  cv: string,
  jd: string,
  decisions: string,
): string {
  return template
    .replaceAll("{{CV_CONTENT}}", () => cv)
    .replaceAll("{{JOB_DESCRIPTION}}", () => jd)
    .replaceAll("{{DECISIONS}}", () => decisions);
}
