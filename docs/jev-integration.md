# Integrasi Jev (TypeSafe System One) ke Pipeline JSA

Status: **DRAFT — belum ada kode yang ditulis.** Dokumen ini menutup tahap desain.
Sumber: `docs.typesafe.ai`, `typesafe.ai`, diverifikasi 2026-09-19.

---

## 1. Ringkasan keputusan

Jev dipakai sebagai **lapisan keputusan semantik per-requirement**. Bukan untuk
ekstraksi, bukan untuk aritmetika, bukan untuk menulis laporan.

```
CV + JD
  │
  ├─[1] LLM ekstraksi ──────► Requirement[] + Candidate terstruktur
  │
  ├─[2] CODE pra-proses ────► canonicalize, dedupe, sort, parse angka,
  │                           bangun state Jev (terfilter)
  │
  ├─[3] JEV (1 call) ───────► keputusan per-requirement + confidence
  │
  ├─[4] CODE skoring ───────► guard deterministik, computeScore(), gating
  │
  └─[5] LLM narasi ─────────► penjelasan + rekomendasi CV (opsional)
```

Model Jev: alias `jev-latest` → `jev-1.13.0`. Endpoint `POST /v1/systemone`.

---

## 2. Kenapa Jev — dan kenapa bukan

### Alasan yang **tidak** berlaku

**"Jev memperbaiki instabilitas skor"** — tidak. `README.md` mencatat stabilitas
sudah dicapai dengan cara lain: 5 pasang CV/JD (backend, frontend, data, devops,
mobile) × 4 run, spread 0 poin, signature `category|priority|status` identik.
Temperature 0 + aturan prompt + cache sudah menyelesaikannya. Klaim ini tidak boleh
dipakai untuk membenarkan migrasi.

### Alasan yang berlaku

| # | Nilai | Bukti / mekanisme |
|---|---|---|
| 1 | **Kuantifikasi ketidakpastian per baris** | Sekarang pipeline tidak punya sinyal ragu sama sekali. `MATCH` adalah `MATCH`. Jev mengembalikan `probability` + `confidence` per baris → bisa dibedakan "yakin" vs "menebak". Ini kapabilitas yang benar-benar baru. |
| 2 | **Reviewable by construction** | Pertanyaan dan threshold hidup di satu file `src/lib/jev.ts` sebagai konstanta yang bisa dibaca manusia. Sekarang perilaku keputusan terkubur di `prompts/job-fit-analysis.md` (~150 baris aturan) dan muncul secara emergent. |
| 3 | **Latensi** | Keputusan per-requirement dievaluasi paralel dalam satu call, bukan bagian dari reasoning trace 12–25 detik. |
| 4 | **Biaya, jika ekstraksi & narasi ikut turun kelas** | Call Jev sendiri ~$0.0001 (lihat §12). Penghematan nyata hanya muncul kalau ekstraksi dan narasi dipindah ke model yang lebih murah, karena Jev mengambil alih bagian yang paling butuh reasoning. |
| 5 | **Konsistensi** | Dokumentasi jaggedness menyatakan Jev "extremely consistent": output yang mirip secara kuantitatif untuk input yang mirip secara semantik. |

### Biaya yang harus dibayar

- Dependency eksternal + API key baru di jalur kritis.
- Bahasa: bahasa utama Jev adalah Inggris; CV/JD di JSA sering Bahasa Indonesia. **Risiko akurasi nomor satu.**
- Orkestrasi dua model (LLM + Jev) dan pemisahan baris numerik vs semantik.
- Semantik skor bisa bergeser kalau `probability` ikut dipakai (lihat §9).

### Non-goals — yang **tidak** diserahkan ke Jev

| Tugas | Alasan | Pemilik |
|---|---|---|
| Ekstraksi requirement dari JD | Generatif / ruang jawaban terbuka | LLM |
| Menulis narasi & rekomendasi CV | Jev tidak dilatih menghasilkan teks | LLM |
| Membandingkan angka (tahun, bulan, IPK) | Jaggedness #2: "Jev is not a calculator", numerik tidak presisi | CODE |
| Menghitung skor, count, rata-rata | Jaggedness #2 dan #3 | CODE |
| Mengutip baris CV sebagai evidence | Generation | CODE (dari output ekstraksi) |
| Perbandingan tanggal | Jaggedness #3 | CODE |

---

## 3. Arsitektur

```
┌─ [1] EKSTRAKSI (LLM, model boleh kecil) ────────────────────────┐
│ prompts/extract-requirements.md                                  │
│ → Requirement[]  { id, text, verbatim, category, priority,       │
│                    threshold? }                                  │
│ → Candidate      { skills[], experience[], education[],          │
│                    evidence[{ id, line }] }                      │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─ [2] PRA-PROSES (CODE) ─────────────────────────────────────────┐
│ · canonicalize via src/lib/match.ts (preNormalize/canonicalize)  │
│ · dedupe alias (ALIAS_GROUPS)                                    │
│ · sort deterministik (category → text) supaya `req_<i>` stabil   │
│ · parse threshold ("1+ year" → 12 bulan) dan nilai kandidat      │
│ · hitung numeric_check per baris → { result: meets|below|absent} │
│ · buang field yang tidak dipakai (mitigasi context rot)          │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─ [3] JEV — satu call, speculative fan-out ──────────────────────┐
│ · 1 Choice per requirement (kriteria per kategori, §6.1)         │
│ · + 3 pertanyaan global (§6.3)                                   │
│ · state = { role, candidate } (§4)                               │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─ [4] SKORING (CODE) ────────────────────────────────────────────┐
│ · guard deterministik (§7) — kode boleh menimpa Jev              │
│ · computeScore() yang sudah ada, formula tidak berubah           │
│ · confidence gating (§8) → flag needs_review                     │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─ [5] NARASI (LLM, opsional) ────────────────────────────────────┐
│ · tabel Matched/Partial/Unmatched bisa di-generate dari kode     │
│ · LLM hanya untuk narasi + Recommended CV Changes                │
└──────────────────────────────────────────────────────────────────┘
```

**Kenapa dipisah begitu:** dokumentasi Jev berulang kali menekankan pertanyaan harus
atomik — "a judgment a knowledgeable person makes in a second". Seluruh keputusan
numerik dan seluruh tekstual dikeluarkan dari Jev, menyisakan satu jenis judgment
per pertanyaan: *teknologi/aktivitas ini, seberapa cocok?*

---

## 4. Kontrak state

Dikirim sebagai `state` di request Jev. Hanya berisi yang dibutuhkan pertanyaan.

```json
{
  "role": {
    "requirements": [
      {
        "id": "req_0",
        "text": "React.js",
        "verbatim": "React.js",
        "category": "required_skills",
        "priority": "HIGH",
        "numeric": null
      },
      {
        "id": "req_4",
        "text": "1+ year experience",
        "verbatim": "minimal 1 tahun pengalaman",
        "category": "experience",
        "priority": "HIGH",
        "numeric": {
          "required": { "kind": "months", "op": ">=", "value": 12 },
          "candidate": { "kind": "months", "value": 6 },
          "result": "below"
        }
      }
    ]
  },
  "candidate": {
    "skills": ["React.js", "JavaScript", "PostgreSQL", "Docker"],
    "experience": [
      { "activity": "freelance web development", "months": 6 }
    ],
    "education": [],
    "evidence": [
      { "id": "ev_0", "line": "6 months freelance web development" }
    ]
  }
}
```

Catatan desain:

- **CV mentah tidak dikirim.** Jaggedness #5: akurasi turun kalau state penuh detail
  tak relevan. Yang dikirim hanya field terstruktur hasil ekstraksi.
- **`numeric` dikirim sebagai fakta yang sudah dihitung.** Tujuannya agar Jev tidak
  perlu berhitung sama sekali; ia hanya memetakan fakta ke status.
- **`evidence[].line` adalah kutipan verbatim** dari CV. Ini yang dipakai mengisi
  field `evidence` di output — Jev tidak pernah menulis teks.

---

## 5. Model data

`Requirement` diperluas dari definisi di `src/lib/score.ts`:

```ts
type DecidedBy = "jev" | "code" | "code_override";

type RequirementDecision = {
  requirement: string;
  category: Category;        // tidak berubah
  priority: Priority;        // tidak berubah
  status: Status;            // tidak berubah
  evidence: string;          // tidak berubah
  decision: boolean;         // BARU: status ∈ {MATCH, EQUIVALENT}
  probability: number;       // BARU: probabilities[status]
  confidence: number;        // BARU: dari Jev; 0 untuk baris yang diputus kode
  decidedBy: DecidedBy;      // BARU: traceability
  needsReview: boolean;      // BARU: hasil confidence gating
};
```

`decidedBy` penting untuk audit: menjawab "baris ini diputus model atau kode, dan
apakah kode menimpa model".

---

## 6. Katalog pertanyaan — INTI DOKUMEN

Semua definisi tinggal di **satu file**: `src/lib/jev.ts`. Alasan: panduan resmi
TypeSafe ("put the constants — questions and thresholds — in a single place so they
are easy to review").

**Bahasa instruksi & kriteria: Inggris.** Dokumentasi Models menyatakan Inggris
adalah bahasa training utama dan akurasi terbaik; bahasa lain "handled but not equally
well". Isi `state` tetap verbatim dalam bahasa aslinya (Indonesia). Ini keputusan
sadar dan item uji nomor satu (§14).

### 6.1 Pertanyaan per-requirement (semantik)

Satu `choice` per requirement. `id` = `req_<i>` dari urutan hasil sort deterministik
di §3 step 2 — bukan urutan keluaran LLM, supaya stabil antar run.

**Kriteria dipilih per kategori.** `RELATED` tidak bermakna untuk baris `keywords`
atau `education`, jadi tidak ditawarkan. Ini mengurangi ambiguitas dan mengikuti
prinsip "treat the criteria as an extension of the instruction".

| Kategori | Opsi yang ditawarkan |
|---|---|
| `required_skills`, `preferred_skills` | MATCH, EQUIVALENT, RELATED, PARTIAL, MISSING |
| `experience` | MATCH, EQUIVALENT, PARTIAL, MISSING |
| `responsibilities` | MATCH, PARTIAL, MISSING |
| `education` | MATCH, EQUIVALENT, PARTIAL, MISSING |
| `keywords` | MATCH, PARTIAL, MISSING |

**Instructions** (bentuk objek, bukan string — field-nya bebas, model melihat namanya):

```js
choice(
  {
    question: "How well does `candidate` satisfy this requirement?",
    requirement: "`role.requirements[3]`",
    compare: ["`candidate.skills`", "`candidate.experience`", "`candidate.evidence`"],
    focus: "Judge technology and activity equivalence only.",
    not_for:
      "Do not judge or compare year counts, numbers, or thresholds — " +
      "that comparison already exists in `role.requirements[3].numeric`.",
  },
  { /* kriteria di bawah */ }
)
```

**Kriteria teknologi** (teks final):

```js
{
  MATCH: {
    what: "The candidate's material explicitly names this exact requirement.",
    examples: ["Requirement 'React.js' and the candidate lists 'React.js'."],
  },
  EQUIVALENT: {
    what: "The candidate names the same thing under a different spelling, abbreviation, or product alias.",
    not_for: "A different product in the same category — that is RELATED.",
    examples: ["Golang = Go", "Postgres = PostgreSQL", "k8s = Kubernetes", "RESTful API = REST API"],
  },
  RELATED: {
    what: "The candidate names a different but directly comparable technology occupying the same slot in the stack.",
    not_for: "A generic practice rather than a named technology. Deploying with Docker on a VPS does not make AWS RELATED.",
    examples: ["GCP vs AWS", "MySQL vs PostgreSQL", "Vue vs React", "Jest vs Vitest"],
  },
  PARTIAL: {
    what: "The candidate shows the same activity, but at a smaller scale than the requirement asks.",
    not_for: "An adjacent activity in the same area. Monitoring dashboards are not incident-response experience.",
    examples: [
      "A 3-month internship against a 2-year requirement.",
      "The role is listed but the year figure is never stated.",
    ],
  },
  MISSING: {
    what: "The candidate names nothing comparable to the requirement.",
    examples: ["Requirement 'TypeScript' and the candidate lists only JavaScript and Python."],
  },
}
```

Kelima deskripsi ini adalah port langsung dari aturan STEP 2 di
`prompts/job-fit-analysis.md`. Aturan itu hasil kerja keras (lihat README) dan tidak
boleh hilang saat pindah ke kriteria.

**Fallback kalau MATCH/EQUIVALENT kronis low-confidence:** kolaps jadi 4 opsi
(`meets / related / partial / missing`) dan biarkan kode memberi label EQUIVALENT
lewat `ALIAS_GROUPS` di `src/lib/match.ts`. Jangan lakukan di awal; ukur dulu.

### 6.2 Baris threshold numerik

Untuk requirement yang punya ambang terukur (tahun, bulan, jenjang, IPK), **angka
tidak pernah masuk pertanyaan sebagai operasi**. Yang dikirim adalah hasil yang sudah
dihitung, dan pertanyaannya tetap sama seperti §6.1.

Alur:

1. Ekstraksi (LLM) mengembalikan `threshold` terstruktur:
   `{ kind: "months", op: ">=", value: 12 }`. Untuk baris teknologi dengan kualifier
   bersama ("5+ tahun React, TypeScript, Next.js") kualifier itu **disalin ke setiap
   baris**, sesuai aturan prompt yang sudah ada.
2. Kode menghitung `numeric_check`:
   - `absent` — kandidat tidak menyebut aktivitas itu sama sekali
   - `below` — aktivitas ada, angka kandidat < ambang
   - `meets` — angka kandidat ≥ ambang
   - `unproven` — aktivitas ada, angka kandidat tidak pernah dinyatakan
3. Hasilnya dikirim di `numeric.result` (§4).
4. Jev memutuskan status dengan fakta itu tersedia.
5. Kode **memverifikasi** keputusan Jev terhadap fakta numerik (§7 guard 1–3).

Contoh persis dari skenario yang diminta:

| Requirement | numeric.result | Status sah |
|---|---|---|
| React.js | — | bebas (dinilai semantik) |
| TypeScript | — | bebas |
| Next.js | — | bebas |
| PostgreSQL | — | bebas |
| 1+ year experience (kandidat 6 bulan) | `below` | PARTIAL atau MISSING |

### 6.3 Pertanyaan global

Dikirim di call yang sama. Murah, dievaluasi paralel, dan **tidak** masuk perhitungan
skor Job Fit — dipakai untuk konteks dan gating.

| id | tipe | instruksi | opsi |
|---|---|---|---|
| `seniority_fit` | choice | "How does the candidate's overall seniority compare with the seniority the role states?" | `far_below`, `below`, `matches`, `above`, `not_stated` |
| `domain_fit` | choice | "How close is the candidate's domain or industry background to the role's domain?" | `same_domain`, `adjacent_domain`, `unrelated_domain`, `not_stated` |
| `location_fit` | choice | "Does the candidate's stated location satisfy the role's stated location requirement?" | `satisfies`, `commutable`, `relocation_needed`, `mismatch`, `not_stated` |

Ketiganya sengaja `choice` supaya membawa `confidence` — dipakai untuk gating, bukan
untuk skor.

**Tidak** dimasukkan: pertanyaan holistik "apakah kandidat ini sebaiknya diproses?".
Itu System Two — bergantung pada banyak faktor independen — dan dokumentasi Jev
secara eksplisit memperingatkan terhadap bentuk pertanyaan seperti itu. Kalau nanti
diinginkan sebagai sinyal diagnostik, ia harus berdiri di luar skor dan diberi label
sebagai eksperimental.

---

## 7. Guard deterministik

Diterapkan di kode setelah Jev menjawab. Fungsi: menegakkan invarian yang tidak
dijamin model. Dokumentasi jaggedness menyebut ini secara langsung — *"enforce
identities in code"*.

| # | Invarian | Aksi kalau dilanggar |
|---|---|---|
| 1 | `numeric.result === "below"` → status ∈ {PARTIAL, MISSING} | Timpa ke PARTIAL, `decidedBy = "code_override"` |
| 2 | `numeric.result === "absent"` → status === MISSING | Timpa ke MISSING |
| 3 | `numeric.result === "meets"` → status ∈ {MATCH, EQUIVALENT} | Timpa ke MATCH |
| 4 | status ∈ {MATCH, EQUIVALENT, RELATED, PARTIAL} → `evidence` tidak kosong | Turunkan ke MISSING (aturan lama, dipertahankan) |
| 5 | `EQUIVALENT`/`RELATED` hanya valid untuk baris teknologi | Kalau kategori non-teknologi memberi salah satunya, perlakukan sebagai PARTIAL |
| 6 | `EQUIVALENT` harus cocok dengan alias yang dikenal | Cek terhadap `ALIAS_GROUPS` di `src/lib/match.ts`; kalau tidak cocok, turunkan ke RELATED |
| 7 | Baris `keywords` (lokasi, work arrangement) tidak pernah HIGH | Turunkan ke MEDIUM/LOW — ditegakkan kode, bukan prompt |
| 8 | status & category harus dari himpunan tertutup | Sudah ditangani `parseRequirements` / `normalizeEnum` di `src/lib/score.ts` |

Guard 6 memakai kembali data yang sudah ada di repo, jadi tidak menambah tabel alias
baru.

---

## 8. Confidence gating

Threshold tinggal di `src/lib/jev.ts` sebagai konstanta bernama, bukan angka sihir di
tengah kode.

```ts
const CONFIDENCE_ACT = 0.75;
const CONFIDENCE_FLOOR = 0.50;
```

**Asimetris menurut arah kesalahan.** Ini mengikuti aturan keras aplikasi: "never
fabricate". Salah mengklaim `MATCH` lebih berbahaya daripada salah memberi `MISSING`.

| Status | confidence ≥ 0.75 | 0.50 ≤ c < 0.75 | c < 0.50 |
|---|---|---|---|
| MATCH, EQUIVALENT | terima | **turunkan satu tingkat**, flag | turunkan, flag `needs_review` |
| PARTIAL, RELATED | terima | terima, flag | flag `needs_review` |
| MISSING | terima | flag "mungkin ada, perlu dicek" | flag `needs_review` |

**Eskalasi level laporan:** kalau ada baris ber-priority `HIGH` dengan
`confidence < CONFIDENCE_ACT`, seluruh laporan diberi banner "perlu review manusia
pada N baris". Ini pola *Confidence-gated routing* dari dokumentasi.

Angka 0.75 dan 0.50 adalah **titik awal, bukan hasil tuning**. Dokumentasi hanya
menyebut 0.5 sebagai lantai umum; sisanya harus diukur pada data nyata (§14).

---

## 9. Skoring

Formula di `src/lib/score.ts` **tidak berubah**:

```
STATUS_VALUE  : MATCH/EQUIVALENT = 100, PARTIAL = 50, RELATED = 25, MISSING = 0
PRIORITY_WEIGHT: HIGH = 3, MEDIUM = 2, LOW = 1
overall       : Σ(STATUS_VALUE × PRIORITY_WEIGHT) / Σ(PRIORITY_WEIGHT)
```

Alasan tidak diubah: angka yang dihasilkan tetap sebanding dengan versi sekarang,
sehingga perbandingan sebelum/sesudah tetap sahih.

**Opsi yang disediakan tapi OFF secara default** — skor kontinu dari distribusi:

```
expected_status_value = Σ probabilities[s] × STATUS_VALUE[s]
overall               = Σ(expected × PRIORITY_WEIGHT) / Σ(PRIORITY_WEIGHT)
```

Ini memakai kalibrasi Jev dan menghilangkan efek tangga dari status diskret. Tapi ia
mengubah arti angka, jadi harus jadi flag terpisah (`JEV_EXPECTED_SCORE=1`) dan
diukur terpisah. Jangan dinyalakan sebelum ada baseline.

**Yang tidak dilakukan:** memakai `score` Jev untuk merekonstruksi besaran angka.
Dokumentasi jaggedness melarang ini secara eksplisit — level `score` lemah dalam
kalibrasi numerik. Karena itu semua baris threshold diputus kode (§6.2), bukan
`score`.

---

## 10. Kontrak output

Bentuk per baris — persis bentuk yang diminta:

```json
{
  "requirement": "React.js",
  "decision": true,
  "status": "MATCH",
  "probability": 0.98,
  "confidence": 0.95,
  "decidedBy": "jev",
  "needsReview": false,
  "evidence": "React.js — 2 tahun"
}
```

```json
{
  "requirement": "TypeScript",
  "decision": false,
  "status": "MISSING",
  "probability": 0.94,
  "confidence": 0.91,
  "decidedBy": "jev",
  "needsReview": false,
  "evidence": ""
}
```

```json
{
  "requirement": "1+ year experience",
  "decision": false,
  "status": "PARTIAL",
  "probability": 1.0,
  "confidence": 0.0,
  "decidedBy": "code",
  "needsReview": false,
  "evidence": "6 months freelance web development"
}
```

Catatan: `probability` **dan** `confidence` dua-duanya hanya tersedia dari `choice`
atau `score`. `noul` mengembalikan probabilitas saja tanpa `confidence`. Karena itu
seluruh pertanyaan keputusan memakai `choice`. Baris yang diputus kode punya
`confidence: 0` dan `decidedBy: "code"` supaya jelas bahwa itu bukan estimasi model.

NDJSON streaming yang sudah ada (`meta` / `thinking` / `text` / `score` / `done`)
tetap dipakai. `thinking` hanya terisi dari LLM; Jev tidak menghasilkan teks.

---

## 11. Pembagian Jev / LLM / CODE

| Tahap | Pemilik | Alasan |
|---|---|---|
| Ekstraksi requirement dari JD | LLM | Generatif, ruang jawaban terbuka |
| Ekstraksi skill/experience/education kandidat | LLM | Idem |
| Kutipan evidence verbatim dari CV | LLM (dipilih kode) | Jev tidak menghasilkan teks |
| Canonicalisasi, dedupe alias | CODE | `src/lib/match.ts` sudah ada |
| Parse threshold & bandingkan angka | CODE | Jaggedness #2 |
| Keputusan status per requirement | **JEV** | Inti calibrated decision |
| Relevansi domain / seniority / lokasi | **JEV** | Judgment atomik |
| Guard invarian | CODE | Jaggedness #8 |
| Hitung skor, count, rata-rata | CODE | Jaggedness #2 |
| Confidence gating | CODE | Threshold harus di kode |
| Narasi + Recommended CV Changes | LLM | Jev tidak menulis teks |
| Tabel Matched/Partial/Unmatched | CODE (dari keputusan) | Bisa deterministik penuh |

---

## 12. Akses, env, biaya

**Akses & auth**

- Endpoint: `POST https://api.typesafe.ai/v1/systemone`
- Key dibuat di `console.typesafe.ai/keys`. Homepage menampilkan "Join Waitlist" →
  akses publik kemungkinan masih dibatasi.
- Tanpa key, endpoint membalas `403 authentication_error` — sudah diverifikasi dari
  mesin pengembangan.

**Env baru** (mengikuti pola `AI_*` yang sudah ada)

| Variable | Default | Keterangan |
|---|---|---|
| `TYPESAFE_API_KEY` | — | wajib; dibaca SDK dari env |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | pin ke `jev-1.13.0` kalau threshold sudah di-tuning ke versi itu |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | override untuk gateway/proxy |
| `JEV_ENABLED` | `0` | kill switch; `0` → fallback ke pipeline LLM sekarang |
| `JEV_EXPECTED_SCORE` | `0` | menyalakan skor kontinu (§9) |

**SDK**

```
@typesafe-ai/sdk@0.6.0     // engines: node >=20 — proyek ini Node 22
```
Ekspor: `TypeSafeClient`, `choice()`, `noul()`, `score()`.
Metode: `client.systemOne({ state, questions, model? }, options?)`.
Retry otomatis untuk 408/429/5xx dengan exponential backoff.

**Biaya per analisis** (estimasi)

State ≈ 1.500 token (CV terstruktur + JD + pertanyaan). Input $42 per miliar token,
output gratis:

```
1.500 × 42 / 1_000_000_000 ≈ $0.000063
```

Artinya ± 0.006 sen per analisis. Praktis nol, dan jauh di bawah satu call LLM
reasoning. Klaim "238x lebih murah" dari halaman marketing mengacu pada model kelas
frontier, bukan pada total biaya pipeline — penghematan total hanya berarti kalau
ekstraksi dan narasi juga turun kelas model.

**Batas konteks:** 64k token total (state + semua pertanyaan), 32k untuk state +
pertanyaan terpanjang. Untuk JD 5–30 requirement, tidak ada masalah.

---

## 13. Risiko

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| 1 | **Bahasa.** CV/JD Bahasa Indonesia, Jev dioptimalkan untuk Inggris | Akurasi turun, confidence tidak terkalibrasi | Instruksi & kriteria dalam Inggris; uji khusus pada korpus Indonesia sebelum dipakai; kalau gagal → §15 keputusan A |
| 2 | **Context rot.** Semua pertanyaan berbagi satu state yang memuat semua requirement | Akurasi turun seiring jumlah requirement | State ramping (hanya field terpakai); referensi path eksplisit (`` `role.requirements[3]` ``); uji pada JD besar; kalau perlu, pecah jadi beberapa call per grup requirement |
| 3 | Threshold confidence belum divalidasi | Flag review palsu atau lolosnya baris ragu | Tuning pada data berlabel (§14); nilai awal 0.75/0.50 hanya titik mulai |
| 4 | Akses masih waitlist | Integrasi tidak bisa diuji end-to-end | `JEV_ENABLED=0` fallback ke pipeline sekarang |
| 5 | Dua model dalam jalur kritis | Kompleksitas, mode kegagalan baru | Kill switch; `decidedBy` mencatat asal setiap keputusan; fallback per-call ke LLM |
| 6 | Alias `jev-latest` bisa bergerak | Jawaban berubah tanpa perubahan di sisi kita | Pin `jev-1.13.0` setelah threshold di-tuning; `response.model` dicatat per run |
| 7 | Klaim "zero hallucinations" di marketing | Ekspektasi berlebihan | Dokumentasi jaggedness menyatakan sendiri model ini bisa salah, dan `confidence` mendeskripsikan jawaban, bukan jaminan benar |

---

## 14. Rencana uji

1. **Baseline dulu.** Jalankan pipeline sekarang pada set uji, catat skor + status per
   baris. Tanpa ini, tidak ada pembanding dan migrasi tidak bisa dibenarkan.
2. **Set uji:** 5 pasang CV/JD yang sudah dipakai di README (backend, frontend, data,
   devops, mobile), × 4 run — supaya sebanding dengan angka 0-spread yang sudah ada.
3. **Uji bahasa:** tambahkan minimal 3 pasang CV/JD berbahasa Indonesia. Ukur
   distribusi `confidence`; kalau confidence kolaps (semua rendah) atau status
   bergeser sistematis, risiko #1 terkonfirmasi.
4. **Uji invarian:** verifikasi guard §7 benar-benar tidak pernah dilewati Jev.
5. **Tuning threshold:** kumpulkan baris dengan `confidence` rendah, label manual,
   lalu pilih `CONFIDENCE_ACT` / `CONFIDENCE_FLOOR` dari data itu.
6. **Uji skala:** satu JD dengan 25+ requirement; ukur apakah akurasi turun
   (context rot) dan apakah perlu chunking.
7. **Ukur biaya & latensi** sebelum/sesudah, dipisah per tahap (ekstraksi, Jev,
   narasi) supaya kelihatan mana yang benar-benar menghemat.

**Kriteria sukses:** status per baris identik atau lebih baik dari baseline pada set
uji yang sama, plus sinyal `confidence` yang terpisah dengan baik antara baris yang
benar dan yang salah. Kalau hanya "setara", migrasi harus dinilai dari latensi/biaya
saja — dan itu harus keputusan sadar.

---

## 15. Keputusan terbuka

| # | Pertanyaan | Default yang diusulkan |
|---|---|---|
| A | Kalau akurasi pada CV Bahasa Indonesia jelek, lanjut? | Uji dulu; kalau < baseline, tahan integrasi dan pertahankan pipeline sekarang |
| B | Model untuk ekstraksi & narasi | Model murah/cepat terpisah, bukan model reasoning sekarang — inilah sumber penghematan sebenarnya |
| C | `choice` 5 opsi vs kolaps 4 opsi untuk MATCH/EQUIVALENT | Mulai 5 opsi, ukur confidence di batas itu |
| D | Skor kontinu dari probabilitas (§9) | OFF dulu; nyalakan hanya kalau baseline sudah ada |
| E | Pin versi model atau pakai alias | Pin `jev-1.13.0` setelah tuning threshold |
| F | Perluas ke `/cari` (rerank lowongan)? | Tidak untuk v1. Ratusan lowongan × pertanyaan = biaya dan latensi nyata |
