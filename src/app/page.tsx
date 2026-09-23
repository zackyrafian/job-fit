"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CircleAlert, Loader2, Upload } from "lucide-react";
import { stripJsonBlock, type ScoreBreakdown } from "@/lib/score";
import { parseReport, summarizeCv, summarizeJob } from "@/lib/report";
import { readStoredCv, takePendingJd, writeStoredCv } from "@/lib/storage";
import { Button, Field } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";
import {
  AbsorptionList,
  ChangeBlock,
  EmptyRow,
  GapLists,
  Icon,
  Kicker,
  KeywordGroups,
  MonoBox,
  Rule,
  ScoreRow,
  SectionHeader,
  SkillRow,
  SummaryPanel,
} from "@/components/report-ui";

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

type JevSignal = { choice: string; confidence: number };

const SIGNAL_LABEL: Record<string, string> = {
  seniority_fit: "Seniority",
  domain_fit: "Domain",
  location_fit: "Lokasi",
};

const SIGNAL_TEXT: Record<string, string> = {
  far_below: "jauh di bawah",
  below: "di bawah",
  matches: "sesuai",
  above: "di atas",
  not_stated: "tidak disebut",
  same_domain: "sektor sama",
  adjacent_domain: "sektor berdekatan",
  unrelated_domain: "sektor tak terkait",
  satisfies: "sesuai",
  commutable: "bisa komuter",
  relocation_needed: "perlu relokasi",
  mismatch: "tidak cocok",
};

const MATCH_TAG: Record<string, string> = { MATCH: "COCOK", EQUIVALENT: "SETARA" };

export default function Home() {
  const [cv, setCv] = useState("");
  const [jd, setJd] = useState("");
  const [cvFile, setCvFile] = useState("");
  const [output, setOutput] = useState("");
  const [thinking, setThinking] = useState("");
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [signals, setSignals] = useState<Record<string, JevSignal> | null>(null);
  const [engine, setEngine] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [editing, setEditing] = useState(true);
  const [today, setToday] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cvRef = useRef<HTMLTextAreaElement>(null);
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
    setToday(
      new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
    );
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
      setError("CV dan deskripsi pekerjaan wajib diisi.");
      return;
    }

    setError("");
    setOutput("");
    setThinking("");
    setScore(null);
    setSignals(null);
    setEngine("");
    setFromCache(false);
    setCopied(false);
    setLoading(true);
    setEditing(false);
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
          let evt: {
            kind?: string;
            text?: string;
            score?: ScoreBreakdown;
            signals?: Record<string, JevSignal>;
            engine?: string;
            cached?: boolean;
          };
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
            setSignals(evt.signals ?? null);
            setEngine(evt.engine ?? "");
            continue;
          }
          if (evt.kind === "done") continue;
          if (!evt.text) continue;

          if (evt.kind === "thinking") {
            thinkingRef.current += evt.text;
          } else {
            rawRef.current += evt.text;
            gotTextRef.current = true;
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

  const newAnalysis = useCallback(() => {
    stop();
    setOutput("");
    setThinking("");
    setScore(null);
    setSignals(null);
    setEngine("");
    setError("");
    setEditing(true);
    requestAnimationFrame(() => cvRef.current?.focus());
  }, [stop]);

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
    a.download = "analisis-kecocokan-cv.md";
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
    setSignals(null);
    setEngine("");
    setError("");
    setEditing(true);
  }, [stop]);

  const loadSample = useCallback(() => {
    setCv(SAMPLE_CV);
    setJd(SAMPLE_JD);
    setCvFile("");
    setError("");
  }, []);

  const report = useMemo(() => parseReport(output), [output]);
  const cvPanel = useMemo(() => summarizeCv(cv, cvFile || undefined), [cv, cvFile]);
  const jobPanel = useMemo(() => summarizeJob(jd), [jd]);

  const thinkingPreview =
    thinking.length > THINKING_PREVIEW_CHARS ? "…" + thinking.slice(-THINKING_PREVIEW_CHARS) : thinking;

  const signalEntries = signals ? Object.entries(signals) : [];
  const requirementCount =
    score?.requirements.length ??
    report.matched.length + report.partial.length + report.unmatched.length;
  const keywordCount = report.keywordGroups.reduce((sum, g) => sum + g.items.length, 0);

  const hasResult = Boolean(output) && (report.hasAny || loading);
  const showFallback = Boolean(output) && !report.hasAny && !loading;

  return (
    <div className="min-h-dvh bg-paper">
      <SiteHeader active="analyze" busy={loading}>
        <Button variant="default" onClick={newAnalysis}>
          Analisis Baru
        </Button>
      </SiteHeader>

      <main className="mx-auto w-full max-w-[1440px] px-6 md:px-12 lg:px-[88px]">
        <section className="pt-12 md:pt-16">
          <Kicker>Laporan analisis{today ? ` · ${today}` : ""}</Kicker>
          <h1 className="mt-5 max-w-[900px] font-serif text-[38px] leading-[1.03] tracking-[-1px] md:text-[54px] md:tracking-[-1.3px] lg:text-[66px] lg:leading-[66px] lg:tracking-[-1.4px]">
            Analisis Kecocokan CV
          </h1>
          <p className="mt-6 max-w-[640px] text-[15px] leading-[23px] text-ink-2">
            Model menilai status tiap persyaratan pada deskripsi pekerjaan terhadap CV-mu; skornya
            dihitung di server dari tabel itu, jadi input yang sama selalu memberi skor yang sama.
          </p>
        </section>

        <Rule heavy className="my-10 md:my-14" />

        <section id="input" className="scroll-mt-24">
          {editing ? (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <Field
                  label="CV Kandidat"
                  icon={<Icon name="file-text" className="size-3.5" />}
                  hint={
                    cvFile
                      ? `${cvFile} · ${cv.length.toLocaleString("id-ID")} karakter`
                      : `${cv.length.toLocaleString("id-ID")} karakter`
                  }
                  footer="PDF, DOCX, TXT, atau MD · maks 15 MB · bisa tempel teks langsung"
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
                    ref={cvRef}
                    value={cv}
                    onChange={(e) => setCv(e.target.value)}
                    aria-label="CV kandidat"
                    spellCheck={false}
                    placeholder="Upload file, drag & drop ke sini, atau tempel isi CV…"
                    className="min-h-[280px] w-full resize-y bg-transparent p-4 font-mono text-[12.5px] leading-[1.75] text-ink outline-none placeholder:text-ink-3/60"
                  />
                </Field>

                <Field
                  label="Deskripsi Pekerjaan"
                  icon={<Icon name="file-text" className="size-3.5" />}
                  hint={`${jd.length.toLocaleString("id-ID")} karakter`}
                  footer="Tempel deskripsi lowongan lengkap beserta persyaratannya"
                >
                  <textarea
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    aria-label="Deskripsi pekerjaan"
                    spellCheck={false}
                    placeholder="Tempel deskripsi pekerjaan di sini…"
                    className="min-h-[280px] w-full resize-y bg-transparent p-4 font-mono text-[12.5px] leading-[1.75] text-ink outline-none placeholder:text-ink-3/60"
                  />
                </Field>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button variant="ghost" size="sm" onClick={loadSample}>
                  Contoh
                </Button>
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Bersihkan
                </Button>
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  {loading && (
                    <Button variant="outline" size="sm" onClick={stop}>
                      Hentikan
                    </Button>
                  )}
                  <Button onClick={analyze} disabled={loading || uploading}>
                    {loading ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Menganalisis
                      </>
                    ) : (
                      "Analisis Kecocokan"
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-4">
                <Kicker tone="muted">Input yang dianalisis</Kicker>
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  Ubah input
                </Button>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <SummaryPanel kicker="CV Kandidat" data={cvPanel} icon="file-text" />
                <div id="deskripsi-pekerjaan" className="scroll-mt-24">
                  <SummaryPanel kicker="Deskripsi Pekerjaan" data={jobPanel} icon="file-text" />
                </div>
              </div>
            </>
          )}
        </section>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-3 rounded-[6px] border border-rust/40 bg-rust/[0.05] px-4 py-3 text-[14px] leading-[1.55] text-rust"
          >
            <CircleAlert className="mt-px size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!editing && (
          <>
            <Rule heavy className="my-10 md:my-14" />

            <section className="flex flex-col gap-14 md:gap-16">
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
                <div>
                  <Kicker>Hasil analisis</Kicker>
                  <h2 className="mt-3 font-serif text-[26px] leading-[1.1] tracking-[-0.6px] md:text-[32px]">
                    Ringkasan skor kecocokan
                  </h2>
                </div>
                <div className="flex items-center gap-5 pb-1">
                  {loading && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="font-mono text-[10.5px] uppercase tracking-[1.2px] text-ink-3"
                    >
                      Menulis<span className="stream-caret" />
                    </span>
                  )}
                  <a
                    href="#deskripsi-pekerjaan"
                    className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[1.2px] text-ink-3 transition-colors hover:text-ink"
                  >
                    Lihat deskripsi pekerjaan
                    <Icon name="arrow-up-right" className="size-3.5" />
                  </a>
                </div>
              </div>

              {(thinking || (loading && !output)) && (
                <details className="rounded-[6px] border border-rule bg-sheet">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-mono text-[10.5px] uppercase tracking-[1.2px] text-ink-3">
                    <span className="flex items-center gap-2">
                      {loading && !output && (
                        <span className="size-1.5 animate-pulse rounded-full bg-pine-2" />
                      )}
                      Proses berpikir model · {thinking.length.toLocaleString("id-ID")} karakter
                    </span>
                    <span>{loading ? `${elapsed}s` : "Lihat"}</span>
                  </summary>
                  <pre className="max-h-56 overflow-y-auto border-t border-rule bg-paper/60 px-4 py-3 font-mono text-[11px] leading-[1.7] whitespace-pre-wrap text-ink-3">
                    {thinkingPreview || "Menunggu token pertama dari model…"}
                  </pre>
                </details>
              )}

              {score && (
                <div className="flex flex-col gap-8">
                  <ScoreRow score={score} />
                  {signalEntries.length > 0 && (
                    <div className="flex flex-wrap gap-2.5">
                      {signalEntries.map(([id, signal]) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-2 rounded-[3px] border border-rule px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3"
                        >
                          <span className="text-ink-2">{SIGNAL_LABEL[id] ?? id}</span>
                          {SIGNAL_TEXT[signal.choice] ?? signal.choice}
                          <span className="tabular-nums">{Math.round(signal.confidence * 100)}%</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!output && loading && (
                <div className="flex flex-col gap-3">
                  {[92, 78, 85, 64].map((w, i) => (
                    <div
                      key={i}
                      className="h-2.5 animate-pulse rounded-[3px] bg-rule"
                      style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </div>
              )}

              {report.matched.length > 0 && (
                <section>
                  <SectionHeader
                    kicker="Keterampilan cocok"
                    title="Persyaratan yang terpenuhi penuh"
                    right={
                      <span className="font-mono text-[11px] tracking-[1px] text-ink-3">
                        {report.matched.length} item
                      </span>
                    }
                  />
                  <div className="mt-8">
                    {report.matched.map((item, i) => (
                      <SkillRow
                        key={i}
                        name={item.name}
                        tag={MATCH_TAG[item.status] ?? "COCOK"}
                        tone="pine"
                        italic
                      >
                        {item.quote ? `“${item.quote}”` : "Tercantum di CV."}
                      </SkillRow>
                    ))}
                  </div>
                </section>
              )}

              {report.partial.length > 0 && (
                <section>
                  <SectionHeader
                    kicker="Kecocokan sebagian"
                    title="Terpenuhi, tapi di bawah standar"
                    right={
                      <span className="font-mono text-[11px] tracking-[1px] text-ink-3">
                        {report.partial.length} item
                      </span>
                    }
                  />
                  <div className="mt-8">
                    {report.partial.map((item, i) => (
                      <SkillRow key={i} name={item.name} tag="SEBAGIAN" tone="brass">
                        {item.body || "Sebagian terpenuhi."}
                      </SkillRow>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <SectionHeader
                  kicker="Tidak cocok"
                  title="Persyaratan yang belum terpenuhi"
                  right={
                    <span className="font-mono text-[11px] tracking-[1px] text-ink-3">
                      {report.unmatched.length} keterampilan
                    </span>
                  }
                />
                <div className="mt-8">
                  {report.unmatched.length === 0 ? (
                    <EmptyRow text="Tidak ada persyaratan yang sepenuhnya tidak terpenuhi." />
                  ) : (
                    report.unmatched.map((item, i) => (
                      <SkillRow key={i} name={item.skill} tag="TIDAK COCOK" tone="rust">
                        <span>{item.reason}</span>
                        {item.priority && (
                          <span className="mt-2 block font-mono text-[10.5px] uppercase tracking-[1.1px] text-ink-3">
                            Prioritas {item.priority}
                          </span>
                        )}
                      </SkillRow>
                    ))
                  )}
                </div>
              </section>

              {report.keywordGroups.length > 0 && (
                <section>
                  <SectionHeader
                    kicker="Analisis kata kunci"
                    title="Kata kunci yang terbaca di CV"
                  />
                  <div className="mt-8">
                    <KeywordGroups groups={report.keywordGroups} />
                  </div>
                </section>
              )}

              {report.absorption.length > 0 && (
                <section>
                  <SectionHeader
                    kicker="Penyerapan kata kunci"
                    title="Cara aman memakai kata kunci"
                  />
                  <div className="mt-8">
                    <AbsorptionList rows={report.absorption} />
                  </div>
                </section>
              )}

              {report.changes.length > 0 && (
                <section>
                  <SectionHeader
                    kicker="Saran perubahan CV"
                    title="Perbaikan yang bisa kamu lakukan"
                    right={
                      <span className="font-mono text-[11px] tracking-[1px] text-ink-3">
                        {report.changes.length} saran
                      </span>
                    }
                  />
                  <div className="mt-8">
                    {report.changes.map((item, i) => (
                      <ChangeBlock key={i} item={item} />
                    ))}
                  </div>
                </section>
              )}

              {report.gaps.length > 0 && (
                <section>
                  <SectionHeader kicker="Kesenjangan akhir" title="Peta kekuatan dan celah" />
                  <div className="mt-8">
                    <GapLists gaps={report.gaps} />
                  </div>
                </section>
              )}

              {(report.emphasize.length > 0 || report.avoid.length > 0) && (
                <section>
                  <SectionHeader
                    kicker="Penekanan kata kunci"
                    title="Kata kunci untuk ditonjolkan & dihindari"
                  />
                  <div className="mt-8 grid gap-5 md:grid-cols-2">
                    <MonoBox kicker="TONJOLKAN" items={report.emphasize} tone="pine" />
                    <MonoBox kicker="JANGAN DIKLAIM" items={report.avoid} tone="rust" />
                  </div>
                </section>
              )}

              {showFallback && (
                <section>
                  <SectionHeader kicker="Laporan" title="Hasil lengkap" />
                  <div className="md-body mt-8 rounded-[6px] border border-rule bg-sheet p-5 md:p-7">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
                  </div>
                </section>
              )}

              {hasResult && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-rule-2 pt-6">
                  <span className="font-mono text-[10.5px] uppercase tracking-[1.2px] text-ink-3">
                    Dibuat dengan Rekrut · {requirementCount} persyaratan · {keywordCount} kata kunci
                    dianalisis
                    {engine === "jev" ? " · dinilai Jev" : ""}
                    {fromCache ? " · hasil cache" : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={copy}>
                      {copied ? "Tersalin" : "Salin"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={download}>
                      Unduh .md
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        <div className="h-10" />
      </main>
    </div>
  );
}
