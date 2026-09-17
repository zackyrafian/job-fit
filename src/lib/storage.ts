const CV_KEY = "jsa.cv";
const PENDING_JD_KEY = "jsa.pendingJd";
const MAX_CHARS = 200_000;

export function readStoredCv(): string {
  try {
    return localStorage.getItem(CV_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredCv(cv: string): void {
  try {
    if (!cv) {
      localStorage.removeItem(CV_KEY);
      return;
    }
    localStorage.setItem(CV_KEY, cv.slice(0, MAX_CHARS));
  } catch {}
}

export function writePendingJd(jd: string): void {
  try {
    localStorage.setItem(PENDING_JD_KEY, jd.slice(0, MAX_CHARS));
  } catch {}
}

export function takePendingJd(): string {
  try {
    const value = localStorage.getItem(PENDING_JD_KEY) ?? "";
    if (value) localStorage.removeItem(PENDING_JD_KEY);
    return value;
  } catch {
    return "";
  }
}
