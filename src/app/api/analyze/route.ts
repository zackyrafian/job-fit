import type { NextRequest } from "next/server";
import { streamCompletion, type StreamChunk } from "@/lib/ai";
import { buildPrompt, isAnalysisMode, type AnalysisMode } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let cv = "";
  let jd = "";
  let mode: AnalysisMode = "fast";

  try {
    const body = await req.json();
    cv = String(body?.cv ?? "").trim();
    jd = String(body?.jd ?? "").trim();
    if (isAnalysisMode(body?.mode)) mode = body.mode;
  } catch {
    return Response.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  if (!cv || !jd) {
    return Response.json({ error: "CV dan Job Description wajib diisi." }, { status: 400 });
  }

  const prompt = await buildPrompt(cv, jd, mode);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: StreamChunk) => {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
      };

      try {
        for await (const chunk of streamCompletion(prompt, req.signal)) {
          send(chunk);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Terjadi kesalahan yang tidak diketahui.";
        send({ kind: "text", text: `\n\n> ⚠️ **Error:** ${message}\n` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
