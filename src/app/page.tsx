"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ACCEPTED_FILES = ".pdf,.docx,.txt,.md";
const THINKING_PREVIEW_CHARS = 4000;
const FLUSH_INTERVAL_MS = 100;

type Mode = "fast" | "detailed";

const MODE_INFO: Record<Mode, { label: string; hint: string }> = {
  fast: { label: "Cepat", hint: "prompt ringkas · ±15 detik" },
  detailed: { label: "Detail", hint: "prompt lengkap · ±50 detik" },
};

export default function Home() {
  const [cv, setCv] = useState("");
  const [jd, setJd] = useState("");
  const [cvFile, setCvFile] = useState("");
  const [mode, setMode] = useState<Mode>("fast");
  const [output, setOutput] = useState("");
  const [thinking, setThinking] = useState("");
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef("");
  const thinkingRef = useRef("");
  const lastFlushRef = useRef(0);
  const gotTextRef = useRef(false);

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
    setOutput(textRef.current);
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
    setThinkingOpen(true);
    setCopied(false);
    setLoading(true);
    textRef.current = "";
    thinkingRef.current = "";
    lastFlushRef.current = 0;
    gotTextRef.current = false;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cv, jd, mode }),
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
          let evt: { kind?: string; text?: string };
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (!evt.text) continue;

          if (evt.kind === "thinking") {
            thinkingRef.current += evt.text;
          } else {
            textRef.current += evt.text;
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
  }, [cv, jd, mode, flush]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const copy = useCallback(async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
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
    setError("");
  }, [stop]);

  const thinkingPreview = thinking.length > THINKING_PREVIEW_CHARS
    ? "…" + thinking.slice(-THINKING_PREVIEW_CHARS)
    : thinking;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-8 lg:px-8">
      <header className="mb-7">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Job Fit Analyzer
          </h1>
          <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-blue-300">
            no fabrication
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Upload CV (PDF/DOCX) atau tempel manual, isi Job Description, lalu analisis seberapa
          cocok keduanya. Skor dihitung berbobot dan setiap match wajib punya bukti dari CV.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          label="Candidate CV"
          hint={cvFile ? `${cvFile} · ${cv.length.toLocaleString("id-ID")} chars` : `${cv.length.toLocaleString("id-ID")} chars`}
          accent="text-emerald-300"
          onFileDrop={uploadCv}
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
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
              >
                {uploading ? "Membaca…" : "Upload PDF/DOCX"}
              </button>
            </>
          }
        >
          <textarea
            value={cv}
            onChange={(e) => setCv(e.target.value)}
            spellCheck={false}
            placeholder="Upload file PDF/DOCX, drag & drop ke sini, atau tempel isi CV…"
            className="h-[340px] w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed text-slate-200 outline-none placeholder:text-slate-600"
          />
        </Panel>

        <Panel
          label="Job Description"
          hint={`${jd.length.toLocaleString("id-ID")} chars`}
          accent="text-amber-300"
        >
          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            spellCheck={false}
            placeholder="Tempel Job Description di sini…"
            className="h-[340px] w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed text-slate-200 outline-none placeholder:text-slate-600"
          />
        </Panel>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-slate-700">
          {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              title={MODE_INFO[m].hint}
              className={`px-3.5 py-2.5 text-sm font-medium transition ${
                mode === m
                  ? "bg-slate-700 text-white"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
            >
              {MODE_INFO[m].label}
            </button>
          ))}
        </div>

        <button
          onClick={analyze}
          disabled={loading || uploading}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Menganalisis…
            </>
          ) : (
            "Analyze Job Fit"
          )}
        </button>

        {loading && (
          <button
            onClick={stop}
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-300 transition hover:border-slate-600 hover:text-white"
          >
            Stop
          </button>
        )}

        <button
          onClick={clearAll}
          className="rounded-lg border border-slate-800 px-4 py-2.5 text-sm text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
        >
          Clear
        </button>

        <span className="text-xs text-slate-500">{MODE_INFO[mode].hint}</span>

        {error && (
          <span className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </span>
        )}
      </div>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium tracking-wide text-slate-400 uppercase">Result</h2>
          {output && !loading && (
            <div className="flex gap-2">
              <button
                onClick={copy}
                className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-700 hover:text-white"
              >
                {copied ? "Copied!" : "Copy markdown"}
              </button>
              <button
                onClick={download}
                className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-700 hover:text-white"
              >
                Download .md
              </button>
            </div>
          )}
        </div>

        {(thinking || (loading && !output)) && (
          <div className="mb-3 overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40">
            <button
              type="button"
              onClick={() => setThinkingOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
            >
              <span className="flex items-center gap-2 text-xs font-medium tracking-wide text-slate-400 uppercase">
                {loading && !output && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
                )}
                Proses berpikir model
                <span className="tabular-nums text-slate-600">{thinking.length.toLocaleString("id-ID")} chars</span>
                {loading && <span className="tabular-nums text-slate-600">· {elapsed}s</span>}
              </span>
              <span className="text-xs text-slate-500">{thinkingOpen ? "sembunyikan" : "tampilkan"}</span>
            </button>
            {thinkingOpen && (
              <pre className="max-h-56 overflow-y-auto border-t border-slate-800/80 px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-500">
                {thinkingPreview || "menunggu token pertama dari model…"}
              </pre>
            )}
          </div>
        )}

        <div
          ref={outputRef}
          className="max-h-[70vh] min-h-[220px] overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/60 p-5 backdrop-blur-sm"
        >
          {output ? (
            <div className="md-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
            </div>
          ) : loading ? (
            <p className="text-sm text-slate-500">
              Menunggu jawaban… jawaban mulai muncul setelah model selesai berpikir.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Hasil analisis akan muncul di sini dan streaming secara real-time.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Panel({
  label,
  hint,
  accent,
  action,
  onFileDrop,
  children,
}: {
  label: string;
  hint: string;
  accent: string;
  action?: React.ReactNode;
  onFileDrop?: (file: File) => void;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);

  const dropProps = onFileDrop
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFileDrop(file);
        },
      }
    : {};

  return (
    <div
      {...dropProps}
      className={`relative overflow-hidden rounded-xl border bg-slate-950/60 backdrop-blur-sm transition ${
        dragging ? "border-emerald-400/70 ring-2 ring-emerald-400/20" : "border-slate-800/80"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-900/40 px-4 py-2.5">
        <span className={`text-xs font-semibold tracking-wide uppercase ${accent}`}>{label}</span>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-slate-500 sm:inline">{hint}</span>
          {action}
        </div>
      </div>
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/85 text-sm font-medium text-emerald-300">
          Lepaskan file untuk di-upload
        </div>
      )}
    </div>
  );
}
