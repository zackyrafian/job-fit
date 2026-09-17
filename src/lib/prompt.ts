import { readFile } from "node:fs/promises";
import path from "node:path";

const PROMPT_PATH = path.join(process.cwd(), "prompts", "job-fit-analysis.md");

let cachedTemplate: string | null = null;

/** Loads `prompts/job-fit-analysis.md` from disk (cached after first read). */
export async function loadTemplate(): Promise<string> {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = await readFile(PROMPT_PATH, "utf8");
  return cachedTemplate;
}

/**
 * Fills the template placeholders. Uses the function form of `replaceAll`
 * so that `$&`-style sequences inside the CV/JD are never interpreted.
 */
export async function buildPrompt(cv: string, jd: string): Promise<string> {
  const template = await loadTemplate();
  return template
    .replaceAll("{{CV_CONTENT}}", () => cv)
    .replaceAll("{{JOB_DESCRIPTION}}", () => jd);
}
