"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Briefcase,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Download,
  FileText,
  Loader2,
  ScanSearch,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { CATEGORY_LABEL, stripJsonBlock, type ScoreBreakdown, type Status } from "@/lib/score";
import { readStoredCv, takePendingJd, writeStoredCv } from "@/lib/storage";
import { Button, Field, cn } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";

const ACCEPTED_FILES = ".pdf,.docx,.txt,.md";
const THINKING_PREVIEW_CHARS = 4000;
const FLUSH_INTERVAL_MS = 100;

const SAMPLE_CV = `Zacky Rafian — Backend Developer

Membangun REST API menggunakan Go dan Gin untuk aplikasi POS.
Database PostgreSQL, deployment pakai Docker ke VPS.
Internship backend Node.js selama 3 bulan.
Frontend React.js untuk dashboard internal.`;

const SAMPLE_JD = `Backend Engineer

Required: 2+ tahun pengalaman profesional Node.js, desain RESTful API,
PostgreSQL, Docker.
Preferred: AWS, Kubernetes, React.js.
Education: S1 Ilmu Komputer.`;

const STATUS_DOT: Record<Status, string> = {
  MATCH: "bg-emerald-500",
  EQUIVALENT: "bg-emerald-500",
  PARTIAL: "bg-amber-500",
  RELATED: "bg-amber-500",
  MISSING: "bg-muted-foreground/40",
};

export default function Home() {
  const [cv, setCv] = useState("");
  const [jd, setJd] = useState("");
  const [cvFile, setCvFile] = useState("");
  const [output, setOutput] = useState("");
  const [thinking, setThinking] = useState("");
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rawRef = useRef("");
  const thinkingRef = useRef("");
  const lastFlushRef = useRef(0);
  const gotTextRef = useRef(false);

  useEffect(() => {
    const stored = readStoredCv();
    if (stored) setCv(stored);
    const pendingJd = takePendingJd();
    if (pendingJd) setJd(pendingJd);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStoredCv(cv);
  }, [cv, hydrated]);

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  const flush = useCallback((force = false) => {
    const now = performance.now();
    if (!force && now - lastFlushRef.current < FLUSH_INTERVAL_MS) return;
    lastFlushRef.current = now;
    setOutput(stripJsonBlock(rawRef.current));
    setThinking(thinkingRef.current);
  }, []);

  const uploadCv = useCallback(async (file: File) => {
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Upload gagal (${res.status}).`);
      setCv(data.text);
      setCvFile(data.filename);
    } catch (err) {
      setError((err as Error).message || "Upload gagal.");
    } finally {
      setUploading(false);
    }
  }, []);

  const analyze = useCallback(async () => {
    if (!cv.trim() || !jd.trim()) {
      setError("CV dan Job Description wajib diisi.");
      return;
    }

    setError("");
    setOutput("");
    setThinking("");
    setScore(null);
    setFromCache(false);
    setThinkingOpen(true);
    setCopied(false);
    setLoading(true);
    rawRef.current = "";
    thinkingRef.current = "";
    lastFlushRef.current = 0;
    gotTextRef.current = false;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cv, jd }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Request gagal (${res.status}).`);
      }
      if (!res.body) throw new Error("Server tidak mengirim stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { kind?: string; text?: string; score?: ScoreBreakdown; cached?: boolean };
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }

          if (evt.kind === "meta") {
            setFromCache(Boolean(evt.cached));
            continue;
          }
          if (evt.kind === "score" && evt.score) {
            setScore(evt.score);
            continue;
          }
          if (evt.kind === "done") continue;
          if (!evt.text) continue;

          if (evt.kind === "thinking") {
            thinkingRef.current += evt.text;
          } else {
            rawRef.current += evt.text;
            if (!gotTextRef.current) {
              gotTextRef.current = true;
              setThinkingOpen(false);
            }
            if (outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight;
            }
          }
          flush();
        }
      }
      flush(true);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Terjadi kesalahan.");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
      flush(true);
    }
  }, [cv, jd, flush]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const copy = useCallback(async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [output]);

  const download = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "job-fit-analysis.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [output]);

  const clearAll = useCallback(() => {
    stop();
    setCv("");
    setJd("");
    setCvFile("");
    setOutput("");
    setThinking("");
    setScore(null);
    setError("");
  }, [stop]);

  const loadSample = useCallback(() => {
    setCv(SAMPLE_CV);
    setJd(SAMPLE_JD);
    setCvFile("");
    setError("");
  }, []);

  const thinkingPreview =
    thinking.length > THINKING_PREVIEW_CHARS
      ? "…" + thinking.slice(-THINKING_PREVIEW_CHARS)
      : thinking;

  const status = error
    ? "Error"
    : loading && !output
      ? "Berpikir"
      : loading
        ? "Menulis"
        : output
          ? "Selesai"
          : null;

  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader active="analyze" busy={loading}>
        <span className="hidden items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex">
          <ShieldCheck className="size-3" />
          skor dihitung, bukan ditebak
        </span>
      </SiteHeader>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Analisis kecocokan CV</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Model hanya menilai status tiap requirement; persentasenya dihitung di server dari tabel
            itu, jadi input yang sama selalu menghasilkan skor yang sama.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Candidate CV"
            icon={<FileText className="size-3.5" />}
            hint={cvFile ? `${cvFile} · ${cv.length.toLocaleString("id-ID")} chars` : undefined}
            footer="PDF, DOCX, TXT, atau MD · maks 15 MB"
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
              placeholder="Upload file, drag & drop ke sini, atau tempel isi CV…"
              className="min-h-[280px] w-full resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
            />
          </Field>

          <Field
            label="Job Description"
            icon={<Briefcase className="size-3.5" />}
            hint={`${jd.length.toLocaleString("id-ID")} chars`}
            footer="Tempel deskripsi lowongan lengkap beserta requirement-nya"
          >
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              spellCheck={false}
              placeholder="Tempel Job Description di sini…"
              className="min-h-[280px] w-full resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadSample}>
            Contoh
          </Button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {loading ? (
              <Button variant="outline" size="sm" onClick={stop}>
                <Square className="size-3" />
                Stop
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={clearAll}>
                <Trash2 className="size-3.5" />
                Clear
              </Button>
            )}

            <Button onClick={analyze} disabled={loading || uploading}>
              {loading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Menganalisis
                </>
              ) : (
                "Analyze Job Fit"
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-5 flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">
            <CircleAlert className="mt-px size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="mt-8">
          <div className="mb-3 flex h-8 items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-medium">Hasil analisis</h2>
              {status && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {loading && <Loader2 className="size-2.5 animate-spin" />}
                  {status}
                  {loading && <span className="tabular-nums">{elapsed}s</span>}
                </span>
              )}
            </div>

            {output && !loading && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copy}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Tersalin" : "Copy"}
                </Button>
                <Button variant="outline" size="sm" onClick={download}>
                  <Download className="size-3.5" />
                  .md
                </Button>
              </div>
            )}
          </div>

          {(thinking || (loading && !output)) && (
            <div className="mb-3 overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => setThinkingOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {loading && !output && <Loader2 className="size-3 animate-spin" />}
                  <span className="font-medium">Proses berpikir model</span>
                  <span className="font-mono text-[10px]">
                    {thinking.length.toLocaleString("id-ID")} chars
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    thinkingOpen && "rotate-180",
                  )}
                />
              </button>
              {thinkingOpen && (
                <pre className="max-h-56 overflow-y-auto border-t border-border bg-muted/30 px-3.5 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {thinkingPreview || "Menunggu token pertama dari model…"}
                </pre>
              )}
            </div>
          )}

          {score && <ScoreCard score={score} fromCache={fromCache} />}

          <div
            ref={outputRef}
            className="max-h-[70vh] min-h-[220px] overflow-y-auto rounded-md border border-border bg-card p-4 sm:p-6"
          >
            {output ? (
              <div className="md-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
                {loading && <span className="stream-caret" />}
              </div>
            ) : loading ? (
              <div className="space-y-2.5 pt-1">
                <p className="text-sm text-muted-foreground">
                  Model sedang berpikir — jawaban muncul setelah tahap ini selesai.
                </p>
                <div className="space-y-2.5 pt-3">
                  {[92, 78, 85, 64].map((w, i) => (
                    <div
                      key={i}
                      className="h-2.5 animate-pulse rounded bg-muted"
                      style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
                <ScanSearch className="size-5 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Belum ada analisis. Isi CV dan Job Description, lalu tekan Analyze Job Fit.
                </p>
              </div>
            )}
          </div>
        </section>

        <footer className="mt-8 pb-4 text-center text-xs text-muted-foreground">
          Prompt bisa diubah di{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            prompts/job-fit-analysis.md
          </code>{" "}
          · skor adalah estimasi analitis, bukan prediksi rekrutmen
        </footer>
      </main>
    </div>
  );
}

function ScoreCard({ score, fromCache }: { score: ScoreBreakdown; fromCache: boolean }) {
  return (
    <div className="mb-3 rounded-md border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Job Fit</p>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">{score.overall}%</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{score.requirements.length} requirement</span>
          {fromCache && (
            <span className="rounded border border-border px-1.5 py-0.5">hasil cache</span>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-2.5">
        {score.categories.map((c) => (
          <div key={c.category} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">{c.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/70"
                style={{ width: `${c.score}%` }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-xs tabular-nums">{c.score}%</span>
            <span className="hidden w-20 shrink-0 text-right text-[11px] text-muted-foreground sm:block">
              {c.count} item
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Skor total = rata-rata berbobot prioritas (HIGH ×3, MEDIUM ×2, LOW ×1) dari seluruh
        requirement. Bar di atas hanya rincian per kategori.
      </p>

      <details className="group mt-5">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          Lihat {score.requirements.length} requirement dan statusnya
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Requirement</th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Kategori</th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Prioritas</th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {score.requirements.map((r, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-2 align-top">
                    <span className="text-foreground">{r.requirement}</span>
                    {r.evidence && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground italic">
                        “{r.evidence}”
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top text-muted-foreground">
                    {CATEGORY_LABEL[r.category]}
                  </td>
                  <td className="px-2 py-2 align-top text-muted-foreground">{r.priority}</td>
                  <td className="px-2 py-2 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-1.5 rounded-full", STATUS_DOT[r.status])} />
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
