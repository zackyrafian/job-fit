import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { streamCompletion, type StreamChunk } from "@/lib/ai";
import { cacheKey, getCached, setCached } from "@/lib/cache";
import { fillTemplate, loadTemplate } from "@/lib/prompt";
import { scoreReport } from "@/lib/score";

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

  const template = await loadTemplate();
  const templateVersion = createHash("sha256").update(template).digest("hex").slice(0, 12);
  const key = cacheKey([templateVersion, cv, jd]);
  const cachedReply = getCached(key);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
      };

      const finish = (reply: string, fromCache: boolean) => {
        const score = scoreReport(reply);
        if (score) send({ kind: "score", score });
        send({ kind: "done", cached: fromCache });
      };

      try {
        if (cachedReply !== null) {
          send({ kind: "meta", cached: true });
          send({ kind: "text", text: cachedReply });
          finish(cachedReply, true);
          return;
        }

        send({ kind: "meta", cached: false });

        const prompt = fillTemplate(template, cv, jd);
        let reply = "";

        for await (const chunk of streamCompletion(prompt, req.signal) as AsyncGenerator<StreamChunk>) {
          if (chunk.kind === "text") reply += chunk.text;
          send(chunk);
        }

        if (reply.trim()) setCached(key, reply);
        finish(reply, false);
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
