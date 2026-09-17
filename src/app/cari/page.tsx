"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Briefcase,
  CircleAlert,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, Chip, Field, Meter, cn } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";
import { readStoredCv, writePendingJd, writeStoredCv } from "@/lib/storage";

const ACCEPTED_FILES = ".pdf,.docx,.txt,.md";

type JobSource = "kalibrr" | "jobstreet";

type MatchResult = {
  score: number;
  matched: string[];
  missing: string[];
  matchedCore: number;
  coreTotal: number;
};

type ScoredJob = {
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
  match: MatchResult;
};

type SearchProfile = {
  titles: string[];
  core: string[];
  other: string[];
  seniority: string;
  location: string;
};

type SourceStatus = { source: JobSource; ok: boolean; count: number; error?: string };

type SearchResponse = {
  profile: SearchProfile | null;
  profileError: string | null;
  queries: string[];
  sources: SourceStatus[];
  jobs: ScoredJob[];
  allSourcesFailed: boolean;
  error?: string;
};

const SOURCE_LABEL: Record<JobSource, string> = { kalibrr: "Kalibrr", jobstreet: "JobStreet" };

const SENIORITY_LABEL: Record<string, string> = {
  intern: "intern",
  junior: "junior",
  mid: "mid-level",
  senior: "senior",
  lead: "lead",
};

export default function CariPage() {
  const router = useRouter();

  const [cv, setCv] = useState("");
  const [cvFile, setCvFile] = useState("");
  const [keyword, setKeyword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [sourceFilter, setSourceFilter] = useState<"all" | JobSource>("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [fullTextOnly, setFullTextOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const stored = readStoredCv();
    if (stored) setCv(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStoredCv(cv);
  }, [cv, hydrated]);

  const uploadCv = useCallback(async (file: File) => {
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `Upload gagal (${res.status}).`);
      setCv(payload.text);
      setCvFile(payload.filename);
    } catch (err) {
      setError((err as Error).message || "Upload gagal.");
    } finally {
      setUploading(false);
    }
  }, []);

  const search = useCallback(async () => {
    if (!cv.trim() && !keyword.trim()) {
      setError("Isi CV atau kata kunci pencarian dulu.");
      return;
    }

    setError("");
    setData(null);
    setLoading(true);
    setStage(cv.trim() ? "Membaca CV jadi profil pencarian…" : "Mencari lowongan…");

    const controller = new AbortController();
    abortRef.current = controller;

    const slowStage = setTimeout(() => setStage("Mengambil lowongan dari Kalibrr & JobStreet…"), 6000);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cv, keyword }),
        signal: controller.signal,
      });
      const payload = (await res.json().catch(() => ({}))) as SearchResponse;
      if (!res.ok) throw new Error(payload?.error || `Pencarian gagal (${res.status}).`);
      setData(payload);
      if (payload.allSourcesFailed) {
        setError("Semua sumber lowongan sedang tidak bisa diakses. Coba lagi sebentar lagi.");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Terjadi kesalahan.");
      }
    } finally {
      clearTimeout(slowStage);
      setLoading(false);
      setStage("");
      abortRef.current = null;
    }
  }, [cv, keyword]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setStage("");
  }, []);

  const analyzeJob = useCallback(
    (job: ScoredJob) => {
      writeStoredCv(cv);
      writePendingJd(job.description);
      router.push("/");
    },
    [cv, router],
  );

  const jobs = useMemo(() => {
    if (!data) return [];
    const needle = locationFilter.trim().toLowerCase();
    return data.jobs.filter((job) => {
      if (sourceFilter !== "all" && job.source !== sourceFilter) return false;
      if (fullTextOnly && !job.fullText) return false;
      if (needle && !job.location.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, sourceFilter, locationFilter, fullTextOnly]);

  const hasFullText = useMemo(
    () => (data ? data.jobs.filter((j) => j.fullText).length : 0),
    [data],
  );

  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader active="search" busy={loading} />

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Cari lowongan yang cocok</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            CV-mu diubah jadi kata kunci pencarian, lalu dicari ke Kalibrr dan JobStreet. Urutannya
            pakai tumpang tindih kata kunci — ini penyaring kasar, bukan skor Job Fit. Klik
            Analisis untuk penilaian yang sebenarnya.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="CV kamu"
            icon={<FileText className="size-3.5" />}
            hint={cvFile ? `${cvFile} · ${cv.length.toLocaleString("id-ID")} chars` : undefined}
            footer="Sama dengan CV di halaman Analisis · PDF, DOCX, TXT, MD · maks 15 MB"
            action={
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED_FILES}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadCv(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="-mr-2 h-7 text-muted-foreground"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  Upload
                </Button>
              </>
            }
            onFileDrop={uploadCv}
          >
            <textarea
              value={cv}
              onChange={(e) => setCv(e.target.value)}
              spellCheck={false}
              placeholder="Tempel CV di sini, atau upload file…"
              className="min-h-[180px] w-full resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
            />
          </Field>

          <div className="flex flex-col">
            <Field
              label="Kata kunci tambahan"
              icon={<Search className="size-3.5" />}
              footer="Opsional. Kalau diisi, ini dipakai sebagai pencarian pertama — berguna kalau kamu mau mencari peran yang tidak ada di CV."
            >
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading) search();
                }}
                placeholder="mis. golang developer jakarta"
                className="h-11 w-full bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </Field>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {loading ? (
                <Button variant="outline" size="sm" onClick={stop}>
                  <Loader2 className="size-3 animate-spin" />
                  Stop
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setShowFilters((v) => !v)}>
                  <Filter className="size-3.5" />
                  Filter
                </Button>
              )}
              <Button onClick={search} disabled={loading || uploading} className="ml-auto">
                {loading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Mencari
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    Cari lowongan
                  </>
                )}
              </Button>
            </div>

            {stage && <p className="mt-2 text-xs text-muted-foreground">{stage}</p>}
            {error && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <CircleAlert className="mt-px size-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        </div>

        {data?.profile && (
          <div className="mt-6 rounded-md border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Profil dari CV:</span>
              {data.profile.seniority && (
                <Chip>{SENIORITY_LABEL[data.profile.seniority] ?? data.profile.seniority}</Chip>
              )}
              {data.profile.location && (
                <Chip>
                  <MapPin className="mr-1 size-3" />
                  {data.profile.location}
                </Chip>
              )}
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              Pencarian: <span className="text-foreground">{data.queries.join(" · ")}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.profile.core.map((skill) => (
                <Chip key={skill} tone="good">
                  {skill}
                </Chip>
              ))}
              {data.profile.other.map((skill) => (
                <Chip key={skill}>{skill}</Chip>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Skill di atas dipakai untuk menghitung kecocokan kata kunci. Yang bertanda hijau
              berbobot lebih besar.
            </p>
          </div>
        )}

        {data && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="text-foreground">{jobs.length}</span> dari {data.jobs.length} lowongan
              {hasFullText > 0 && ` · ${hasFullText} punya teks lengkap`}
            </span>
            <span className="flex items-center gap-2">
              {data.sources.map((s) => (
                <span
                  key={s.source}
                  className={cn(
                    "inline-flex items-center gap-1",
                    s.ok ? "" : "text-amber-600 dark:text-amber-400",
                  )}
                  title={s.error ? `Gagal: ${s.error}` : undefined}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      s.ok ? "bg-emerald-500" : "bg-amber-500",
                    )}
                  />
                  {SOURCE_LABEL[s.source]} {s.ok ? s.count : "gagal"}
                </span>
              ))}
            </span>
          </div>
        )}

        {showFilters && data && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-1">
              {(["all", "kalibrr", "jobstreet"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setSourceFilter(value)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                    sourceFilter === value
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "all" ? "Semua sumber" : SOURCE_LABEL[value]}
                </button>
              ))}
            </div>

            <input
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              placeholder="Filter lokasi, mis. jakarta"
              className="h-7 min-w-[160px] flex-1 rounded border border-input bg-transparent px-2 text-[11px] outline-none focus:border-ring"
            />

            <button
              onClick={() => setFullTextOnly((v) => !v)}
              className={cn(
                "rounded border px-2 py-1 text-[11px] font-medium transition-colors",
                fullTextOnly
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              Hanya teks lengkap
            </button>

            {(sourceFilter !== "all" || locationFilter || fullTextOnly) && (
              <button
                onClick={() => {
                  setSourceFilter("all");
                  setLocationFilter("");
                  setFullTextOnly(false);
                }}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="size-3" />
                Reset
              </button>
            )}
          </div>
        )}

        <div className="mt-5 space-y-2.5">
          {jobs.map((job) => (
            <JobCard key={job.key} job={job} onAnalyze={() => analyzeJob(job)} />
          ))}
        </div>

        {data && jobs.length === 0 && (
          <div className="mt-6 rounded-md border border-dashed border-border p-10 text-center">
            <Search className="mx-auto size-5 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Tidak ada lowongan yang cocok dengan filter</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Coba longgarkan filter lokasi atau matikan &ldquo;hanya teks lengkap&rdquo;.
            </p>
          </div>
        )}

        {!data && !loading && (
          <div className="mt-6 rounded-md border border-dashed border-border p-10 text-center">
            <Briefcase className="mx-auto size-5 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Belum ada hasil</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Isi CV di atas lalu klik Cari lowongan.
            </p>
          </div>
        )}

        <footer className="mt-8 pb-4 text-center text-xs text-muted-foreground">
          Data diambil dari endpoint pencarian publik Kalibrr dan JobStreet · peringkat di halaman
          ini hanya kecocokan kata kunci, bukan skor Job Fit
        </footer>
      </main>
    </div>
  );
}

function JobCard({ job, onAnalyze }: { job: ScoredJob; onAnalyze: () => void }) {
  const strong = job.match.score >= 55;

  return (
    <div className="rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{job.title}</h2>
            <Chip>{SOURCE_LABEL[job.source]}</Chip>
            {!job.fullText && <Chip tone="bad">teks ringkas</Chip>}
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
            {job.workMode ? ` · ${job.workMode}` : ""}
            {job.workType ? ` · ${job.workType}` : ""}
          </p>

          {(job.salary || job.postedLabel) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {job.salary && <span className="text-foreground">{job.salary}</span>}
              {job.salary && job.postedLabel ? " · " : ""}
              {job.postedLabel}
            </p>
          )}
        </div>

        <div className="w-28 shrink-0">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-muted-foreground">kata kunci</span>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                strong ? "text-emerald-600 dark:text-emerald-400" : "",
              )}
            >
              {job.match.score}%
            </span>
          </div>
          <div className="mt-1.5">
            <Meter value={job.match.score} tone={strong ? "good" : "neutral"} />
          </div>
          {job.match.coreTotal > 0 && (
            <p className="mt-1 text-right text-[10px] text-muted-foreground">
              inti {job.match.matchedCore}/{job.match.coreTotal}
            </p>
          )}
        </div>
      </div>

      {job.match.matched.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.match.matched.map((skill) => (
            <Chip key={skill} tone="good">
              {skill}
            </Chip>
          ))}
          {job.match.missing.slice(0, 5).map((skill) => (
            <Chip key={skill} tone="bad">
              {skill}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onAnalyze} className="h-7">
          <Sparkles className="size-3" />
          Analisis
        </Button>
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-muted"
        >
          <ExternalLink className="size-3" />
          Buka di {SOURCE_LABEL[job.source]}
        </a>

        {!job.fullText && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ArrowUpRight className="size-3" />
            JobStreet cuma memberi ringkasan — buka di sana untuk teks penuh
          </span>
        )}
      </div>
    </div>
  );
}
