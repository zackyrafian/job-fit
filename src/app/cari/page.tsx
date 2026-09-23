"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Briefcase,
  CircleAlert,
  Clock,
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
import { Kicker, Rule, Tag } from "@/components/report-ui";
import { readStoredCv, writePendingJd, writeStoredCv } from "@/lib/storage";

const ACCEPTED_FILES = ".pdf,.docx,.txt,.md";

type JobSource = "glints" | "jobstreet";

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
  locationMatch: boolean;
};

type SearchProfile = {
  titles: string[];
  core: string[];
  other: string[];
  seniority: string;
  location: string;
};

type SourceStatus = { source: JobSource; ok: boolean; count: number; error?: string };

type Freshness = {
  targetHours: number;
  windowHours: number;
  label: string;
  targetCount: number;
};

type SearchResponse = {
  profile: SearchProfile | null;
  profileError: string | null;
  queries: string[];
  location: string;
  locationStrict: boolean;
  sources: SourceStatus[];
  jobs: ScoredJob[];
  totalJobs: number;
  freshness: Freshness;
  allSourcesFailed: boolean;
  error?: string;
};

const SOURCE_LABEL: Record<JobSource, string> = { glints: "Glints", jobstreet: "JobStreet" };

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
  const [locationQuery, setLocationQuery] = useState("");
  const [locationStrict, setLocationStrict] = useState(false);
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

    const slowStage = setTimeout(() => setStage("Mengambil lowongan dari Glints & JobStreet…"), 6000);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cv, keyword, location: locationQuery, locationStrict }),
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
  }, [cv, keyword, locationQuery, locationStrict]);

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
    <div className="min-h-dvh bg-paper">
      <SiteHeader active="search" busy={loading}>
        <Button onClick={search} disabled={loading || uploading}>
          {loading ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Mencari
            </>
          ) : (
            "Cari Lowongan"
          )}
        </Button>
      </SiteHeader>

      <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-12 md:py-14 lg:px-[88px]">
        <header className="max-w-[760px]">
          <Kicker>Pencarian lowongan</Kicker>
          <h1 className="mt-4 font-serif text-[40px] leading-[1.05] tracking-[-1px] md:text-[52px]">
            Cari lowongan yang cocok
          </h1>
          <p className="mt-5 text-[15px] leading-[23px] text-ink-2">
            CV-mu diubah jadi kata kunci pencarian, lalu dicari ke Glints dan JobStreet. Hanya
            lowongan yang berumur 24 jam ke bawah yang ditampilin — diambil dari yang paling baru,
            diutamakan yang sesuai lokasi, lalu diurutkan dari yang paling cocok dengan CV. Urutannya
            pakai tumpang tindih kata kunci — ini penyaring kasar, bukan skor Job Fit. Klik Analisis
            untuk penilaian yang sebenarnya.
          </p>
        </header>

        <div className="mt-10 grid gap-6 md:grid-cols-2 md:gap-8">
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
                  className="-mr-2 h-7"
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
              className="min-h-[180px] w-full resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3/60"
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
                aria-label="Kata kunci tambahan"
                placeholder="mis. golang developer"
                className="h-11 w-full bg-transparent px-3 text-[15px] text-ink outline-none placeholder:text-ink-3/60"
              />
            </Field>

            <div className="mt-6">
              <Field
                label="Lokasi"
                icon={<MapPin className="size-3.5" />}
                footer="Kosongkan untuk pakai lokasi dari CV · centang untuk mewajibkan lokasi ini"
              >
                <div className="flex items-center gap-2 pl-3 pr-2">
                  <input
                    value={locationQuery}
                    onChange={(e) => setLocationQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !loading) search();
                    }}
                    aria-label="Lokasi"
                    placeholder="mis. Jakarta"
                    className="h-11 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3/60"
                  />
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3">
                    <input
                      type="checkbox"
                      checked={locationStrict}
                      onChange={(e) => setLocationStrict(e.target.checked)}
                      className="size-3.5 accent-pine"
                    />
                    wajib
                  </label>
                </div>
              </Field>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
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

            {stage && <p className="mt-3 text-[12.5px] leading-[1.5] text-ink-3">{stage}</p>}
            {error && (
              <p className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-rust">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        </div>

        {data?.profile && (
          <div className="mt-10 rounded-[6px] border border-rule bg-sheet p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <Kicker tone="muted">Profil dari CV</Kicker>
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
            <p className="mt-4 text-[12.5px] leading-[1.6] text-ink-3">
              Pencarian: <span className="text-ink">{data.queries.join(" · ")}</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {data.profile.core.map((skill) => (
                <Chip key={skill} tone="good">
                  {skill}
                </Chip>
              ))}
              {data.profile.other.map((skill) => (
                <Chip key={skill}>{skill}</Chip>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-[1.5] text-ink-3">
              Skill di atas dipakai untuk menghitung kecocokan kata kunci. Yang bertanda hijau
              berbobot lebih besar.
            </p>
          </div>
        )}

        {data && (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-rule px-2 py-1 font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3">
              <Clock className="size-3" />
              {data.freshness.label}
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3">
              <span className="text-ink">{jobs.length}</span> dari {data.jobs.length} lowongan
              {hasFullText > 0 && ` · ${hasFullText} punya teks lengkap`}
            </span>
            <span className="flex items-center gap-3">
              {data.sources.map((s) => (
                <span key={s.source} title={s.error ? `Gagal: ${s.error}` : undefined}>
                  <Tag
                    label={`${SOURCE_LABEL[s.source]} ${s.ok ? s.count : "gagal"}`}
                    tone={s.ok ? "pine" : "brass"}
                  />
                </span>
              ))}
            </span>
          </div>
        )}

        {data && data.freshness.targetCount < data.totalJobs && (
          <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-[1.5] text-brass">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            {data.freshness.targetCount === 0
              ? `Belum ada lowongan yang berumur ${data.freshness.targetHours} jam ke bawah untuk kata kunci ini.`
              : `Hanya lowongan ${data.freshness.label} yang tampil: ${data.freshness.targetCount} dari ${data.totalJobs} hasil lolos, sisanya sudah lewat ${data.freshness.targetHours} jam dan dibuang.`}
          </p>
        )}

        {showFilters && data && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[6px] border border-rule bg-sheet p-3">
            <div className="flex items-center gap-0.5 rounded-[4px] border border-rule p-0.5">
              {(["all", "glints", "jobstreet"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setSourceFilter(value)}
                  className={cn(
                    "rounded-[3px] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[1px] transition-colors",
                    sourceFilter === value
                      ? "bg-ink text-paper"
                      : "text-ink-3 hover:text-ink",
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
              className="h-8 min-w-[160px] flex-1 rounded-[4px] border border-rule-2 bg-transparent px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-3/60 focus:border-pine/50"
            />

            <button
              onClick={() => setFullTextOnly((v) => !v)}
              className={cn(
                "rounded-[4px] border px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[1px] transition-colors",
                fullTextOnly
                  ? "border-pine-2/30 bg-pine-2/10 text-pine"
                  : "border-rule-2 text-ink-3 hover:text-ink",
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
                className="inline-flex items-center gap-1 rounded-[4px] px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3 transition-colors hover:text-ink"
              >
                <Trash2 className="size-3" />
                Reset
              </button>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-4">
          {jobs.map((job) => (
            <JobCard key={job.key} job={job} onAnalyze={() => analyzeJob(job)} />
          ))}
        </div>

        {data && jobs.length === 0 && (
          <div className="mt-6 rounded-[6px] border border-dashed border-rule-2 p-12 text-center">
            <Search className="mx-auto size-5 text-ink-3/50" />
            <p className="mt-4 font-serif text-[20px] tracking-[-0.3px]">
              {data?.jobs.length === 0
                ? "Belum ada lowongan baru hari ini"
                : "Tidak ada lowongan yang cocok dengan filter"}
            </p>
            <p className="mx-auto mt-2 max-w-[440px] text-[13.5px] leading-[1.6] text-ink-3">
              {data?.jobs.length === 0
                ? "Hasil dibatasi ke lowongan berumur 24 jam ke bawah — coba kata kunci lain atau cek lagi nanti."
                : "Coba longgarkan filter lokasi atau matikan &ldquo;hanya teks lengkap&rdquo;."}
            </p>
          </div>
        )}

        {!data && !loading && (
          <div className="mt-6 rounded-[6px] border border-dashed border-rule-2 p-12 text-center">
            <Briefcase className="mx-auto size-5 text-ink-3/50" />
            <p className="mt-4 font-serif text-[20px] tracking-[-0.3px]">Belum ada hasil</p>
            <p className="mx-auto mt-2 max-w-[440px] text-[13.5px] leading-[1.6] text-ink-3">
              Isi CV di atas lalu klik Cari lowongan.
            </p>
          </div>
        )}

        <footer className="mt-12">
          <Rule />
          <p className="pt-6 pb-2 font-mono text-[10.5px] uppercase tracking-[1.2px] text-ink-3">
            Data diambil dari endpoint pencarian Glints dan JobStreet · hanya lowongan 24 jam
            terakhir · diurutkan dari yang paling baru lalu paling cocok · peringkat di halaman ini
            hanya kecocokan kata kunci, bukan skor Job Fit
          </p>
        </footer>
      </main>
    </div>
  );
}

function JobCard({ job, onAnalyze }: { job: ScoredJob; onAnalyze: () => void }) {
  const strong = job.match.score >= 55;

  return (
    <div className="rounded-[6px] border border-rule bg-sheet p-5 transition-colors hover:border-rule-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-serif text-[20px] leading-[1.15] tracking-[-0.3px] md:text-[24px]">
              {job.title}
            </h2>
            <Chip>{SOURCE_LABEL[job.source]}</Chip>
            {job.locationMatch && <Chip tone="good">lokasi cocok</Chip>}
            {!job.fullText && <Chip tone="bad">teks ringkas</Chip>}
          </div>

          <p className="mt-2.5 font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
            {job.workMode ? ` · ${job.workMode}` : ""}
            {job.workType ? ` · ${job.workType}` : ""}
          </p>

          {(job.salary || job.postedLabel) && (
            <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-2">
              {job.salary && <span className="text-ink">{job.salary}</span>}
              {job.salary && job.postedLabel ? " · " : ""}
              {job.postedLabel}
            </p>
          )}
        </div>

        <div className="w-28 shrink-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[1px] text-ink-3">
              kata kunci
            </span>
            <span
              className={cn(
                "font-serif text-[20px] leading-none tracking-[-0.4px] tabular-nums",
                strong && "text-pine",
              )}
            >
              {job.match.score}%
            </span>
          </div>
          <div className="mt-2">
            <Meter value={job.match.score} tone={strong ? "good" : "neutral"} />
          </div>
          {job.match.coreTotal > 0 && (
            <p className="mt-1.5 text-right font-mono text-[10px] uppercase tracking-[1px] text-ink-3">
              inti {job.match.matchedCore}/{job.match.coreTotal}
            </p>
          )}
        </div>
      </div>

      {job.match.matched.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onAnalyze}>
          <Sparkles className="size-3" />
          Analisis
        </Button>
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[4px] border border-rule-2 px-3.5 font-mono text-[11px] uppercase tracking-[1px] whitespace-nowrap text-ink-2 transition-colors hover:border-ink-3/60 hover:bg-sheet hover:text-ink"
        >
          <ExternalLink className="size-3" />
          Buka di {SOURCE_LABEL[job.source]}
        </a>

        {!job.fullText && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
            <ArrowUpRight className="size-3" />
            JobStreet cuma memberi ringkasan — buka di sana untuk teks penuh
          </span>
        )}
      </div>
    </div>
  );
}
