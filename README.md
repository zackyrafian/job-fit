# Job Fit Analyzer (JSA)

A small Next.js app that compares a CV against a Job Description and reports a
weighted Job Fit score, with the hard rule that nothing is ever fabricated.

## How it works

```
src/app/page.tsx              -> CV / JD inputs (incl. PDF/DOCX upload) + streaming result
src/app/api/analyze/route.ts  -> POST { cv, jd } -> streams NDJSON
src/app/api/extract/route.ts  -> POST multipart file -> { text } for PDF / DOCX / TXT / MD
src/lib/prompt.ts             -> loads prompts/job-fit-analysis.md and fills the placeholders
src/lib/extract.ts            -> PDF (unpdf) and DOCX (mammoth) text extraction
src/lib/ai.ts                 -> provider layer (Anthropic or OpenAI wire format, retries on 5xx/429)
src/lib/score.ts              -> parses the model's requirement table and computes the score
src/lib/cache.ts              -> in-memory result cache keyed by prompt + CV + JD
```

## Why the score is computed in code

The model is only asked to *classify*: for each requirement it returns a category,
a priority, and one status (`MATCH`, `EQUIVALENT`, `PARTIAL`, `RELATED`, `MISSING`),
plus a quoted CV line as evidence.

All arithmetic happens in `src/lib/score.ts`, never in the model:

```
status values    MATCH / EQUIVALENT = 100, PARTIAL = 50, RELATED = 25, MISSING = 0
priority weights HIGH = 3, MEDIUM = 2, LOW = 1
overall          sum(status value x priority weight) / sum(priority weight)
```

This is what makes the number stable. Two earlier designs did not:

- When the model did the arithmetic itself, the same CV and JD produced scores anywhere
  from 58% to 74%.
- A category-weighted formula (average each category, then weight Required Skills 35%,
  Experience 20%, and so on) turned out to be hypersensitive to *which bucket* a row
  landed in. "2+ years of Node.js" is genuinely ambiguous between the skill and
  experience categories, and moving that one row between them changed the score by
  2-7 points even though the fit judgement was identical. Weighting by priority removes
  the dependency entirely: a row contributes the same number wherever it is filed.

Measured across 5 CV/JD pairs (backend, frontend, data, devops, mobile) with 4 runs
each, the score is now identical in every run: a 0-point spread on all five, with the
full `category|priority|status` signature matching exactly.

Getting there also needed the prompt rules tightened, because the residual movement
came from the model judging the same requirement differently rather than from
bookkeeping. The rules that mattered:

- a shared qualifier ("5+ years of React, TypeScript, Next.js") applies to every item
  in the list, not just the first
- a threshold the CV never states (the role is listed, no years) is `PARTIAL`, not `MISSING`
- a parenthetical is a clarification and stays one row: "observability
  (Prometheus/Grafana)" is not two requirements
- location and work arrangement are never `HIGH` priority
- a technology keeps its skill category even when the JD attaches a years qualifier,
  so `experience` is reserved for technology-agnostic requirements

The per-category bars are still shown in the UI, but only as a breakdown - they no
longer feed the headline number.

Two more things keep it steady:

- **Temperature 0** (`AI_TEMPERATURE`) removes most sampling variance.
- **The result cache** means an identical CV + JD pair returns the byte-identical
  previous answer instantly, including the score. The cache key includes a hash of
  the prompt file, so editing the prompt invalidates old entries.

The response is streamed as NDJSON so reasoning and answer travel separately:

```
{"kind":"meta","cached":false}
{"kind":"thinking","text":"..."}     <- shown in the collapsible thinking panel
{"kind":"text","text":"..."}         <- the markdown report
{"kind":"score","score":{...}}       <- computed from the requirement table
{"kind":"done","cached":false}
```

The model's trailing `json` block is stripped before rendering, so it never reaches
the UI. `stripJsonBlock` in `src/lib/score.ts` also copes with a bare fence or an
unfenced payload.

## Prompt contract

`prompts/job-fit-analysis.md` is the single source of truth and is read at runtime —
edit it without touching any code. It requires the model to:

1. Extract every distinct requirement from the JD, one row each, with a fixed
   category and priority. Job titles, company blurb and boilerplate are excluded.
2. Assign one status per requirement, with a quoted CV line as evidence.
3. Write the narrative sections in a fixed format.
4. Emit the machine-readable table as a fenced `json` block at the very end.

## Mencari lowongan (`/cari`)

Halaman terpisah dari halaman analisis. CV diubah jadi kata kunci pencarian, lalu
lowongan diambil dari dua papan lowongan Indonesia dan diperingkat.

```
src/app/cari/page.tsx        -> UI: input CV, filter, daftar hasil
src/app/api/jobs/route.ts     -> POST { cv, keyword } -> profil + lowongan terperingkat
src/lib/profile.ts            -> CV -> SearchProfile lewat satu panggilan LLM (di-cache per CV)
src/lib/jobs.ts               -> adapter Kalibrr + JobStreet, normalisasi, dedupe
src/lib/match.ts              -> skor tumpang tindih kata kunci, tanpa LLM
prompts/search-profile.md     -> prompt penurun profil
```

Alurnya: CV -> profil (3-5 judul target + skill inti + skill pendukung) -> query ke
tiap sumber -> gabung dan dedupe -> peringkat lokal -> daftar. Klik **Analisis** pada
sebuah hasil untuk mengirim JD-nya ke halaman analisis lewat `localStorage`.

### Dua angka, dua arti

Halaman ini menampilkan **kecocokan kata kunci**, bukan skor Job Fit. Angka itu cuma
tumpang tindih kata kunci CV dengan teks lowongan - instan dan gratis, tapi kasar.
Ini disengaja: menganalisis 300 lowongan lewat LLM butuh sekitar 100 menit, sedangkan
peringkat lokal selesai di bawah satu detik. Karena itu peringkat lokal dipakai untuk
menyaring, dan skor Job Fit hanya dihitung untuk lowongan yang benar-benar kamu pilih.

Label keduanya sengaja dibedakan supaya angka heuristik tidak disangka punya bobot
analitis yang sama dengan skor Job Fit.

### Sumber data dan batasannya

| Sumber | Cakupan | Teks JD | Catatan |
| ------ | ------- | ------- | ------- |
| Kalibrr | lebih sedikit | **penuh** (`description` + `qualifications`) | hasilnya bisa langsung dianalisis |
| JobStreet | lebih banyak | hanya ringkasan ~200 char | detail page diblokir Cloudflare, jadi harus dibuka di sana |

Keduanya adalah endpoint pencarian internal yang tidak didokumentasikan, bukan API
publik resmi. Artinya bisa berubah atau memblokir sewaktu-waktu. `searchAllSources`
memakai `Promise.allSettled`, jadi kalau satu sumber mati sumber lain tetap jalan dan
UI menandainya sebagai gagal alih-alih menampilkan error total.

## CV upload

The CV panel accepts **PDF**, **DOCX**, **TXT**, and **MD**, either via the upload
button or drag & drop.

- max 15 MB
- legacy `.doc` is rejected — resave as `.docx` or PDF
- scanned/image-only PDFs have no text layer, so they are rejected rather than
  silently producing an empty CV (run them through OCR first)

## Interface

Neutral, shadcn-style design tokens defined as HSL CSS variables in
`src/app/globals.css` (`--background`, `--foreground`, `--muted`, `--border`,
`--input`, `--primary`, `--ring`). They are exposed to Tailwind through
`@theme inline`, so components use `bg-background`, `text-muted-foreground`,
`border-border`, and so on.

Dark mode is the default and is applied by putting `.dark` on `<html>` (set before
paint by a small inline script in `layout.tsx` to avoid a flash). The toggle in the
header persists the choice in `localStorage`. Inter is loaded through `next/font`,
icons come from `lucide-react`.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in your values
npm run dev                  # http://localhost:3000
```

### Node version

Node **22** is required: `unpdf` needs ≥22 and Next.js 16 needs ≥20.9. It is pinned in
`.nvmrc`, which Nixpacks/Coolify reads when building the deploy image. Without that file
Nixpacks falls back to its Node 18 default and `next build` fails with
`You are using Node.js 18.20.5. For Next.js, Node.js version ">=20.9.0" is required.`

### Environment variables

| Variable         | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `AI_API`         | `anthropic-messages` (→ `{base}/v1/messages`) or `openai-completions` (→ `{base}/chat/completions`) |
| `AI_BASE_URL`    | Base URL, no trailing slash (include `/v1` if the provider needs it) |
| `AI_MODEL`       | Model id                                                            |
| `AI_MAX_TOKENS`  | Max output tokens per request (default `32000`)                      |
| `AI_TEMPERATURE` | Sampling temperature (default `0`)                                   |
| `AI_API_KEY`     | API key                                                             |

`.env.local` is gitignored. Restart the server after changing it.

### Notes on reasoning models

`claude-opus-5` on the local gateway is a reasoning model, and the gateway ignores
`thinking` parameters — thinking cannot be disabled. Two consequences:

- The token budget must be generous. The model spends a large amount of thinking
  before emitting a visible character; with a small `AI_MAX_TOKENS` the whole budget
  is consumed and the API returns an empty body. The route detects that case and
  reports it instead of showing a blank result.
- A run takes roughly 12–25 seconds. The UI shows a live thinking panel so the wait
  is not a blank screen.

## Production

```bash
npm run build
npm start
```
