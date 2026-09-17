import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type ExtractResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status: number };

function normalize(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fromPdf(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function fromDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

export async function extractDocument(file: File): Promise<ExtractResult> {
  if (file.size === 0) {
    return { ok: false, error: "File kosong.", status: 400 };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File terlalu besar (maksimal 15 MB).", status: 413 };
  }

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let raw: string;

    if (name.endsWith(".pdf")) {
      raw = await fromPdf(buffer);
    } else if (name.endsWith(".docx")) {
      raw = await fromDocx(buffer);
    } else if (/\.(txt|md|markdown|text)$/.test(name)) {
      raw = buffer.toString("utf8");
    } else if (name.endsWith(".doc")) {
      return {
        ok: false,
        error: "Format .doc lama belum didukung. Simpan ulang sebagai .docx atau PDF.",
        status: 415,
      };
    } else {
      return {
        ok: false,
        error: "Format tidak didukung. Gunakan PDF, DOCX, TXT, atau MD.",
        status: 415,
      };
    }

    const text = normalize(raw);
    if (!text) {
      return {
        ok: false,
        error: "Tidak ada teks yang bisa dibaca dari file ini. Kalau PDF-nya hasil scan/gambar, teksnya perlu di-OCR dulu.",
        status: 422,
      };
    }

    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : "kesalahan tidak diketahui";
    return { ok: false, error: `Gagal membaca file: ${message}`, status: 500 };
  }
}
