# Job Fit Analyzer (JSA)

A small Next.js app that runs the [`job-fit-analysis`](./prompts) prompt: upload or
paste a CV plus a Job Description, and get a weighted Job Fit analysis that never
fabricates experience.

## How it works

```
src/app/page.tsx              -> CV / JD inputs (incl. PDF/DOCX upload) + streaming markdown output
src/app/api/analyze/route.ts  -> POST { cv, jd, mode } -> streams NDJSON { kind, text }
src/app/api/extract/route.ts  -> POST multipart file -> { text } for PDF / DOCX / TXT / MD
src/lib/prompt.ts             -> picks the template for the mode and fills {{CV_CONTENT}} / {{JOB_DESCRIPTION}}
src/lib/extract.ts            -> PDF (unpdf) and DOCX (mammoth) text extraction
src/lib/ai.ts                 -> provider abstraction (OpenAI-compatible or Anthropic-compatible)
```

## Two analysis modes

Both modes use the same rules and produce the same 10 sections — they differ only
in how verbose the instruction prompt is. The model's internal thinking scales with
prompt size, so the shorter prompt is dramatically faster.

| Mode       | Template                             | Prompt size | Typical run |
| ---------- | ------------------------------------ | ----------- | ----------- |
| `fast`     | `prompts/job-fit-analysis-compact.md` | ~2.8k chars | ~15s        |
| `detailed` | `prompts/job-fit-analysis.md`         | ~10k chars  | ~45s        |

`fast` is the default. Both templates are read from disk at runtime, so you can
tune the wording without touching any code.

The reasoning stream is surfaced in the UI: a collapsible "Proses berpikir model"
panel shows the model's thinking live and auto-collapses once the answer starts.

## Interface

Neutral, shadcn-style design tokens defined as HSL CSS variables in
`src/app/globals.css` (`--background`, `--foreground`, `--muted`, `--border`,
`--input`, `--primary`, `--ring`). They are exposed to Tailwind through
`@theme inline`, so components use `bg-background`, `text-muted-foreground`,
`border-border`, and so on.

Dark mode is the default and is applied by putting `.dark` on `<html>` (set
before paint by a small inline script in `layout.tsx` to avoid a flash). The
toggle in the header persists the choice in `localStorage`. Inter is loaded
through `next/font`, icons come from `lucide-react`.

## CV upload

The CV panel accepts **PDF**, **DOCX**, **TXT**, and **MD**, either via the upload
button or drag & drop. Limits and behaviour:

- max 15 MB
- legacy `.doc` is rejected — resave as `.docx` or PDF
- scanned/image-only PDFs have no text layer, so they are rejected rather than
  silently producing an empty CV (run them through OCR first)

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in your values
npm run dev                  # http://localhost:3000
```

### Environment variables

| Variable        | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `AI_API`        | `anthropic-messages` (→ `{base}/v1/messages`) or `openai-completions` (→ `{base}/chat/completions`) |
| `AI_BASE_URL`   | Base URL, no trailing slash (include `/v1` if the provider needs it) |
| `AI_MODEL`      | Model id                                                            |
| `AI_MAX_TOKENS` | Max output tokens per request (default `32000`)                      |
| `AI_API_KEY`    | API key                                                             |

`.env.local` is gitignored. Restart the server after changing it.

### Notes on reasoning models

`claude-opus-5` on the local gateway is a reasoning model, and the gateway ignores
`thinking` parameters — thinking cannot be disabled. Two consequences:

- The token budget must be generous. On the full prompt the model spends ~35k
  characters thinking before emitting a visible character; with a small
  `AI_MAX_TOKENS` the whole budget is consumed and the API returns an empty body.
  The route detects that and reports it instead of showing a blank result.
- Latency is driven by prompt size. That is why `fast` mode exists.

## Production

```bash
npm run build
npm start
```
