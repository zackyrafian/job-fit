import type { NextRequest } from "next/server";
import { streamCompletion } from "@/lib/ai";
import { buildPrompt } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let cv = "";
  let jd = "";

  try {
    const body = await req.json();
    cv = String(body?.cv ?? "").trim();
    jd = String(body?.jd ?? "").trim();
  } catch {
    return Response.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  if (!cv || !jd) {
    return Response.json({ error: "CV dan Job Description wajib diisi." }, { status: 400 });
  }

  const prompt = await buildPrompt(cv, jd);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamCompletion(prompt, req.signal)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Terjadi kesalahan yang tidak diketahui.";
        controller.enqueue(encoder.encode(`\n\n> ⚠️ **Error:** ${message}\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
