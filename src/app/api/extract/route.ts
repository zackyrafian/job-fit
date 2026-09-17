import type { NextRequest } from "next/server";
import { extractDocument } from "@/lib/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return Response.json({ error: "Form data tidak valid." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "File tidak ditemukan pada request." }, { status: 400 });
  }

  const result = await extractDocument(file);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({ text: result.text, filename: file.name, chars: result.text.length });
}
