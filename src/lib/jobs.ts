export type JobSource = "kalibrr" | "jobstreet";

export type JobListing = {
  key: string;
  source: JobSource;
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  workType: string | null;
  workMode: string | null;
  url: string;
  postedAt: string | null;
  postedLabel: string | null;
  description: string;
  fullText: boolean;
};

export type SourceStatus = {
  source: JobSource;
  ok: boolean;
  count: number;
  error?: string;
};

const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const SOURCE_LABEL: Record<JobSource, string> = {
  kalibrr: "Kalibrr",
  jobstreet: "JobStreet",
};

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);
  const res = await fetch(url, {
    signal: combined,
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json, text/plain, */*",
      "accept-language": "id-ID,id;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatIdr(value: unknown, interval: string): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const millions = n / 1_000_000;
  const text = Number.isInteger(millions) ? String(millions) : millions.toFixed(1);
  return `Rp ${text} jt/${interval || "bulan"}`;
}

type KalibrrJob = {
  id?: number;
  name?: string;
  company_name?: string;
  company?: { code?: string };
  slug?: string;
  description?: string;
  qualifications?: string;
  tenure?: string;
  is_work_from_home?: boolean;
  is_hybrid?: boolean;
  base_salary?: number | null;
  maximum_salary?: number | null;
  salary_interval?: string | null;
  activation_date?: string;
  function?: string;
  google_location?: { address_components?: { city?: string; region?: string } };
};

export async function searchKalibrr(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<JobListing[]> {
  const url = `https://www.kalibrr.com/kjs/job_board/search?text=${encodeURIComponent(query)}&limit=${limit}&offset=0`;
  const payload = (await fetchJson(url, signal)) as { jobs?: KalibrrJob[] };
  const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];

  return rows.flatMap((job) => {
    const id = job.id;
    const title = asString(job.name);
    if (!id || !title) return [];

    const company = asString(job.company_name) || "Tanpa nama";
    const companyCode = asString(job.company?.code) || "jobs";
    const slug = asString(job.slug) || String(id);
    const parts = [asString(job.description), asString(job.qualifications)]
      .filter(Boolean)
      .map(stripHtml)
      .filter(Boolean);
    const description = parts.join("\n\n");
    if (!description) return [];

    const city = asString(job.google_location?.address_components?.city);
    const region = asString(job.google_location?.address_components?.region);
    const location = [city, region].filter(Boolean).join(", ") || "Indonesia";

    const salary =
      formatIdr(job.base_salary, asString(job.salary_interval)) ??
      (job.maximum_salary
        ? `s/d ${formatIdr(job.maximum_salary, asString(job.salary_interval))}`
        : null);

    const workMode = job.is_work_from_home ? "Remote" : job.is_hybrid ? "Hybrid" : "On-site";

    return [
      {
        key: `kalibrr:${id}`,
        source: "kalibrr" as const,
        id: String(id),
        title,
        company,
        location,
        salary,
        workType: asString(job.tenure) || null,
        workMode,
        url: `https://www.kalibrr.com/c/${companyCode}/jobs/${id}/${slug}`,
        postedAt: asString(job.activation_date) || null,
        postedLabel: null,
        description,
        fullText: true,
      },
    ];
  });
}

type JobStreetJob = {
  id?: string;
  title?: string;
  teaser?: string;
  bulletPoints?: string[];
  advertiser?: { description?: string };
  locations?: { label?: string }[];
  salaryLabel?: string;
  workTypes?: string[];
  workArrangements?: { data?: { label?: { text?: string } }[] };
  listingDate?: string;
  listingDateDisplay?: string;
  classifications?: string[];
};

function jobStreetCategory(raw: string[] | undefined): string {
  const first = Array.isArray(raw) ? raw[0] : undefined;
  if (!first) return "";
  try {
    const parsed = JSON.parse(first) as { subclassification?: { description?: string } };
    return asString(parsed?.subclassification?.description);
  } catch {
    return "";
  }
}

export async function searchJobStreet(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<JobListing[]> {
  const url =
    `https://id.jobstreet.com/api/jobsearch/v5/search?siteKey=ID-Main&sourcesystem=houston` +
    `&keywords=${encodeURIComponent(query)}&pageSize=${limit}`;
  const payload = (await fetchJson(url, signal)) as { data?: JobStreetJob[] };
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  return rows.flatMap((job) => {
    const id = asString(job.id);
    const title = asString(job.title);
    if (!id || !title) return [];

    const teaser = asString(job.teaser);
    const bullets = (job.bulletPoints ?? []).map(asString).filter(Boolean);
    const category = jobStreetCategory(job.classifications);
    const description = [teaser, ...bullets.map((b) => `- ${b}`)].filter(Boolean).join("\n");
    if (!description) return [];

    const location = (job.locations ?? [])
      .map((l) => asString(l.label))
      .filter(Boolean)
      .join(" · ");

    const workMode = (job.workArrangements?.data ?? [])
      .map((w) => asString(w?.label?.text))
      .filter(Boolean)
      .join(" · ");

    return [
      {
        key: `jobstreet:${id}`,
        source: "jobstreet" as const,
        id,
        title,
        company: asString(job.advertiser?.description) || "Tanpa nama",
        location: location || "Indonesia",
        salary: asString(job.salaryLabel) || null,
        workType: (job.workTypes ?? []).map(asString).filter(Boolean).join(" · ") || null,
        workMode: workMode || null,
        url: `https://id.jobstreet.com/job/${id}`,
        postedAt: asString(job.listingDate) || null,
        postedLabel: asString(job.listingDateDisplay) || null,
        description: category ? `${description}\n\nKategori: ${category}` : description,
        fullText: false,
      },
    ];
  });
}

function dedupeKey(job: JobListing): string {
  return `${job.title}|${job.company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function searchAllSources(
  queries: string[],
  perQuery: number,
  signal: AbortSignal,
): Promise<{ jobs: JobListing[]; sources: SourceStatus[] }> {
  const tasks: { source: JobSource; query: string; run: Promise<JobListing[]> }[] = [];

  for (const query of queries) {
    tasks.push({ source: "kalibrr", query, run: searchKalibrr(query, perQuery, signal) });
    tasks.push({ source: "jobstreet", query, run: searchJobStreet(query, perQuery, signal) });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run));

  const bySource = new Map<JobSource, SourceStatus>();
  const collected: JobListing[] = [];

  settled.forEach((result, index) => {
    const { source } = tasks[index];
    const current = bySource.get(source) ?? { source, ok: false, count: 0 };

    if (result.status === "fulfilled") {
      collected.push(...result.value);
      bySource.set(source, { ...current, ok: true, count: current.count + result.value.length });
    } else {
      const message = result.reason instanceof Error ? result.reason.message : "gagal";
      bySource.set(source, { ...current, error: current.error ?? message });
    }
  });

  const seen = new Set<string>();
  const jobs = collected.filter((job) => {
    const key = dedupeKey(job);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { jobs, sources: [...bySource.values()] };
}
