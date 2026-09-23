import { Impit } from "impit";

export type JobSource = "glints" | "jobstreet";

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
  glints: "Glints",
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

// ---------------------------------------------------------------------------
// Glints
//
// Endpoint resmi tidak tersedia; pencarian memakai GraphQL internal
// `POST /api/v2-alc/graphql?op=searchJobsV3` yang dilindungi Cloudflare WAF,
// sehingga request-nya harus memakai TLS/JA3 khas Chrome (lihat impit).
// Karena itu juga halaman 2 diblokir (403), jadi maksimal 1 halaman per query.
// ---------------------------------------------------------------------------

const GLINTS_SEARCH_URL = "https://glints.com/api/v2-alc/graphql?op=searchJobsV3";
const GLINTS_PAGE_SIZE_MAX = 50;
const GLINTS_DETAIL_TIMEOUT_MS = 12000;
const GLINTS_DETAIL_CONCURRENCY = 6;

const GLINTS_SEARCH_QUERY = `query searchJobsV3($data: JobSearchConditionInput!) {
  searchJobsV3(data: $data) {
    jobsInPage {
      id
      title
      createdAt
      type
      workArrangementOption
      isRemote
      company { name }
      location { name formattedName parents { name administrativeLevelName level } }
      salaries { salaryType minAmount maxAmount CurrencyCode paymentFrequency }
      externalApplyURL
    }
    hasMore
  }
}`;

let glintsClient: Impit | null = null;

function glintsFetch(): Impit {
  if (!glintsClient) glintsClient = new Impit({ browser: "chrome", timeout: REQUEST_TIMEOUT_MS });
  return glintsClient;
}

async function glintsJson(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body: string },
  signal: AbortSignal,
): Promise<unknown> {
  const res = await glintsFetch().fetch(url, {
    ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type GlintsLocation = {
  name?: string;
  formattedName?: string;
  parents?: { name?: string; administrativeLevelName?: string }[];
};

type GlintsSalary = {
  salaryType?: string;
  minAmount?: number;
  maxAmount?: number;
  CurrencyCode?: string;
  paymentFrequency?: string | null;
};

type GlintsJob = {
  id?: string;
  title?: string;
  createdAt?: string;
  type?: string;
  workArrangementOption?: string;
  isRemote?: boolean;
  company?: { name?: string };
  location?: GlintsLocation;
  salaries?: GlintsSalary[] | null;
  externalApplyURL?: string | null;
};

const GLINTS_WORK_TYPE: Record<string, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Kontrak",
  TEMPORARY: "Kontrak",
  INTERNSHIP: "Magang",
  APPRENTICESHIP: "Magang",
};

const GLINTS_WORK_MODE: Record<string, string> = {
  ONSITE: "On-site",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
};

const GLINTS_PAYMENT_FREQUENCY: Record<string, string> = {
  DAILY: "per hari",
  WEEKLY: "per minggu",
  MONTHLY: "per bulan",
};

function glintsLocation(location: GlintsLocation | undefined): string {
  if (!location) return "Indonesia";
  const parts: string[] = [];
  const push = (value?: string) => {
    const text = asString(value);
    if (text && !parts.some((part) => part.toLowerCase() === text.toLowerCase())) parts.push(text);
  };
  push(location.formattedName || location.name);
  for (const parent of location.parents ?? []) push(parent.name);
  return parts.join(", ") || "Indonesia";
}

function glintsSalary(salaries: GlintsSalary[] | null | undefined): string | null {
  const basic = (salaries ?? []).find((s) => !s.salaryType || s.salaryType === "BASIC");
  if (!basic) return null;
  const currency = asString(basic.CurrencyCode);
  const prefix = currency === "IDR" ? "Rp " : currency ? `${currency} ` : "";
  const render = (value?: number) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return "";
    return `${prefix}${Math.round(n).toLocaleString("id-ID")}`;
  };
  const min = render(basic.minAmount);
  const max = render(basic.maxAmount);
  if (!min && !max) return null;
  const range = min && max ? `${min} – ${max}` : min || max;
  const frequency = GLINTS_PAYMENT_FREQUENCY[asString(basic.paymentFrequency)];
  return frequency ? `${range} ${frequency}` : range;
}

function glintsSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "job";
}

function draftToText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      blocks?: { type?: string; text?: string; depth?: number }[];
    };
    const lines = (parsed.blocks ?? []).map((block) => {
      const text = asString(block.text);
      if (!text) return "";
      if (block.type === "unordered-list-item") return `- ${text}`;
      if (block.type === "ordered-list-item") return `1. ${text}`;
      return text;
    });
    return lines.filter(Boolean).join("\n").trim();
  } catch {
    return "";
  }
}

function nextDataDescription(html: string): string {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) return "";
  try {
    const data = JSON.parse(match[1])?.props?.pageProps?.initialData?.data;
    const raw = data?.descriptionJsonString;
    if (typeof raw !== "string" || !raw) return "";
    return draftToText(raw);
  } catch {
    return "";
  }
}

/** Ambil deskripsi lengkap dari halaman detail (field search selalu kosong). */
export async function fetchGlintsDescription(job: JobListing, signal: AbortSignal): Promise<string> {
  const slug = glintsSlug(job.title);
  const url = `https://glints.com/id/en/opportunities/jobs/${slug}/${job.id}`;
  const res = await glintsFetch().fetch(url, {
    headers: { accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(GLINTS_DETAIL_TIMEOUT_MS)]),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return nextDataDescription(await res.text());
}

/** Ambil teks lengkap untuk lowongan Glints, paralel dengan batas konkurensi. */
export async function enrichGlintsDescriptions(
  jobs: JobListing[],
  signal: AbortSignal,
  concurrency: number = GLINTS_DETAIL_CONCURRENCY,
): Promise<JobListing[]> {
  const targets = jobs.filter((job) => job.source === "glints" && !job.fullText);
  if (targets.length === 0) return jobs;

  const results = new Map<string, string>();
  let cursor = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      const job = targets[cursor++];
      if (signal.aborted) return;
      try {
        const text = await fetchGlintsDescription(job, signal);
        if (text) results.set(job.key, text);
      } catch {
        // deskripsi bersifat pelengkap; kegagalan diabaikan
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
  );

  return jobs.map((job) => {
    const text = results.get(job.key);
    return text ? { ...job, description: text, fullText: true } : job;
  });
}

export type GlintsOptions = {
  limit?: number;
  signal: AbortSignal;
};

export async function searchGlints(
  query: string,
  opts: GlintsOptions,
): Promise<JobListing[]> {
  const limit = Math.min(opts.limit ?? GLINTS_PAGE_SIZE_MAX, GLINTS_PAGE_SIZE_MAX);

  const payload = (await glintsJson(
    GLINTS_SEARCH_URL,
    {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        origin: "https://glints.com",
        referer: "https://glints.com/id/en/job-search",
      },
      body: JSON.stringify({
        operationName: "searchJobsV3",
        variables: {
          data: {
            CountryCode: ["ID"],
            SearchTerm: [query],
            includeExternalJobs: true,
            lastUpdatedAtRange: "PAST_24_HOURS",
            pageSize: limit,
            page: 1,
          },
        },
        query: GLINTS_SEARCH_QUERY,
      }),
    },
    opts.signal,
  )) as {
    data?: { searchJobsV3?: { jobsInPage?: GlintsJob[] } };
    errors?: { message?: string }[];
  };

  const graphqlErrors = payload?.errors;
  if (graphqlErrors?.length) throw new Error(graphqlErrors[0]?.message || "GraphQL error");

  const rows = payload?.data?.searchJobsV3?.jobsInPage ?? [];

  return rows.flatMap((job) => {
    const id = asString(job.id);
    const title = asString(job.title);
    if (!id || !title) return [];

    // Umur tidak dipotong di sini: `lastUpdatedAtRange` menyaring updatedAt,
    // bukan createdAt. Penyaringan <24 jam terpusat di selectByFreshness.
    const postedAt = asString(job.createdAt);
    if (!postedAt || !Number.isFinite(Date.parse(postedAt))) return [];

    const workMode = job.isRemote
      ? "Remote"
      : GLINTS_WORK_MODE[asString(job.workArrangementOption)] || null;
    const external = asString(job.externalApplyURL);

    return [
      {
        key: `glints:${id}`,
        source: "glints" as const,
        id,
        title,
        company: asString(job.company?.name) || "Tanpa nama",
        location: glintsLocation(job.location),
        salary: glintsSalary(job.salaries),
        workType: GLINTS_WORK_TYPE[asString(job.type)] || asString(job.type) || null,
        workMode,
        url:
          external ||
          `https://glints.com/id/en/opportunities/jobs/${glintsSlug(title)}/${id}`,
        postedAt,
        postedLabel: null,
        description: "",
        fullText: false,
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

export type JobStreetOptions = {
  pageSize: number;
  location?: string;
  signal: AbortSignal;
};

export async function searchJobStreet(
  query: string,
  opts: JobStreetOptions,
): Promise<JobListing[]> {
  const params = new URLSearchParams({
    siteKey: "ID-Main",
    sourcesystem: "houston",
    keywords: query,
    pageSize: String(opts.pageSize),
    daterange: "1",
  });
  if (opts.location) params.set("where", opts.location);

  const payload = (await fetchJson(
    `https://id.jobstreet.com/api/jobsearch/v5/search?${params.toString()}`,
    opts.signal,
  )) as { data?: JobStreetJob[] };
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  return rows.flatMap((job) => {
    const id = asString(job.id);
    const title = asString(job.title);
    if (!id || !title) return [];

    const postedAt = asString(job.listingDate);
    if (!postedAt || !Number.isFinite(Date.parse(postedAt))) return [];

    const company = asString(job.advertiser?.description) || "Tanpa nama";
    const teaser = asString(job.teaser);
    const bullets = (job.bulletPoints ?? []).map(asString).filter(Boolean);
    const category = jobStreetCategory(job.classifications);
    const description = [
      teaser && !isCompanyName(teaser, company) ? teaser : "",
      ...bullets.map((b) => `- ${b}`),
      category ? `Kategori: ${category}` : "",
    ]
      .filter(Boolean)
      .join("\n");

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
        company,
        location: location || "Indonesia",
        salary: asString(job.salaryLabel) || null,
        workType: (job.workTypes ?? []).map(asString).filter(Boolean).join(" · ") || null,
        workMode: workMode || null,
        url: `https://id.jobstreet.com/job/${id}`,
        postedAt,
        postedLabel: asString(job.listingDateDisplay) || null,
        description,
        fullText: false,
      },
    ];
  });
}

const COMPANY_NOISE = /\b(pt|cv|tbk|persero|ltd|inc|corp|group|co)\b/g;

function normalizeCompany(value: string): string {
  return value
    .toLowerCase()
    .replace(COMPANY_NOISE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isCompanyName(teaser: string, company: string): boolean {
  const a = normalizeCompany(teaser);
  const b = normalizeCompany(company);
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.includes(short);
}

function canonicalTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeKey(job: JobListing): string {
  return `${canonicalTitle(job.title)}|${normalizeCompany(job.company)}`;
}

export function dedupeJobs(jobs: JobListing[]): JobListing[] {
  const byKey = new Map<string, JobListing>();
  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, job);
      continue;
    }
    // Teks lengkap menang. Kalau dua-duanya masih ringkas, Glints dipilih
    // karena deskripsinya baru diambil belakangan (enrichGlintsDescriptions).
    const better =
      (!existing.fullText && job.fullText) ||
      (existing.fullText === job.fullText &&
        existing.source === "jobstreet" &&
        job.source === "glints");
    if (better) byKey.set(key, job);
  }
  return [...byKey.values()];
}

export type SearchAllOptions = {
  glintsLimit: number;
  jobstreetPageSize: number;
  strictLocation?: string;
  signal: AbortSignal;
};

export async function searchAllSources(
  queries: string[],
  opts: SearchAllOptions,
): Promise<{ jobs: JobListing[]; sources: SourceStatus[] }> {
  const tasks: { source: JobSource; run: Promise<JobListing[]> }[] = [];

  for (const query of queries) {
    tasks.push({
      source: "glints",
      run: searchGlints(query, { limit: opts.glintsLimit, signal: opts.signal }),
    });
    tasks.push({
      source: "jobstreet",
      run: searchJobStreet(query, {
        pageSize: opts.jobstreetPageSize,
        location: opts.strictLocation,
        signal: opts.signal,
      }),
    });
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

  const needle = opts.strictLocation?.trim().toLowerCase() ?? "";
  const located = needle
    ? collected.filter((job) => job.location.toLowerCase().includes(needle))
    : collected;

  return { jobs: dedupeJobs(located), sources: [...bySource.values()] };
}
