# Job Fit Analyzer (JSA)

A small Next.js app that runs the [`job-fit-analysis.md`](./prompts/job-fit-analysis.md)
prompt: upload or paste a CV plus a Job Description, and get a weighted Job Fit
analysis that never fabricates experience.

## How it works

```
src/app/page.tsx              -> CV / JD inputs (incl. PDF/DOCX upload) + streaming markdown output
src/app/api/analyze/route.ts  -> POST { cv, jd } -> streams plain-text markdown
src/app/api/extract/route.ts  -> POST multipart file -> { text } for PDF / DOCX / TXT / MD
src/lib/prompt.ts             -> loads prompts/job-fit-analysis.md, fills {{CV_CONTENT}} / {{JOB_DESCRIPTION}}
src/lib/extract.ts            -> PDF (unpdf) and DOCX (mammoth) text extraction
src/lib/ai.ts                 -> provider abstraction (OpenAI-compatible or Anthropic-compatible)
```

The prompt lives in `prompts/job-fit-analysis.md` and is read at runtime — edit it
without touching any code.

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

### Reasoning models need a big token budget

`claude-opus-5` on the local gateway is a reasoning model: on the full prompt it
spends ~38k characters of internal thinking before emitting the first visible
character, which takes roughly 35–45 seconds. If `AI_MAX_TOKENS` is too small,
the whole budget is consumed by thinking and the API returns an empty body.

The route detects that case and reports it instead of showing a blank result.
The UI shows a "model sedang berpikir…" counter so the wait is not a black box.

## Production

```bash
npm run build
npm start
```
