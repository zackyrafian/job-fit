import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { streamCompletion, type StreamChunk } from "@/lib/ai";
import { cacheKey, getCached, setCached } from "@/lib/cache";
import { fillDecisionsTemplate, fillTemplate, loadTemplate, loadTemplateFile } from "@/lib/prompt";
import { computeScore, scoreReport } from "@/lib/score";
import {
  decideRequirements,
  jevEnabled,
  parseExtraction,
  type DecidedRequirement,
  type JevSignal,
} from "@/lib/jev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Send = (chunk: unknown) => void;

type JevPayload = {
  report: string;
  decisions: DecidedRequirement[];
  signals: Record<string, JevSignal>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  cost: string;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Terjadi kesalahan yang tidak diketahui.";
}

async function collectCompletion(
  prompt: string,
  signal: AbortSignal | undefined,
  onThinking?: (text: string) => void,
): Promise<string> {
  let text = "";
  for await (const chunk of streamCompletion(prompt, signal) as AsyncGenerator<StreamChunk>) {
    if (chunk.kind === "thinking") onThinking?.(chunk.text);
    else text += chunk.text;
  }
  return text;
}

async function runJev(
  cv: string,
  jd: string,
  send: Send,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const extractTemplate = await loadTemplateFile("extract-requirements.md");
  const reportTemplate = await loadTemplateFile("job-fit-report.md");
  const model = process.env.JEV_MODEL || "jev-1.13-free";
  const key = cacheKey(["jev-v1", hash(extractTemplate), hash(reportTemplate), model, cv, jd]);

  const cached = getCached(key);
  if (cached !== null) {
    const payload = JSON.parse(cached) as JevPayload;
    send({ kind: "meta", cached: true, engine: "jev" });
    send({
      kind: "score",
      engine: "jev",
      score: computeScore(payload.decisions),
      signals: payload.signals,
      model: payload.model,
    });
    send({ kind: "text", text: payload.report });
    send({ kind: "done", cached: true });
    return true;
  }

  send({ kind: "meta", cached: false, engine: "jev" });

  const extractReply = await collectCompletion(
    fillTemplate(extractTemplate, cv, jd),
    signal,
    (text) => send({ kind: "thinking", text }),
  );
  const extracted = parseExtraction(extractReply);
  if (!extracted) return false;

  const outcome = await decideRequirements(extracted, signal);
  send({
    kind: "score",
    engine: "jev",
    score: computeScore(outcome.decisions),
    signals: outcome.signals,
    model: outcome.model,
    usage: outcome.usage,
    cost: outcome.cost,
  });

  const reportPrompt = fillDecisionsTemplate(
    reportTemplate,
    cv,
    jd,
    JSON.stringify(outcome.decisions, null, 2),
  );
  let report = "";
  for await (const chunk of streamCompletion(reportPrompt, signal) as AsyncGenerator<StreamChunk>) {
    if (chunk.kind === "text") report += chunk.text;
    send(chunk);
  }

  const payload: JevPayload = {
    report,
    decisions: outcome.decisions,
    signals: outcome.signals,
    model: outcome.model,
    usage: outcome.usage,
    cost: outcome.cost,
  };
  setCached(key, JSON.stringify(payload));
  send({ kind: "done", cached: false });
  return true;
}

async function runLegacy(
  cv: string,
  jd: string,
  send: Send,
  signal: AbortSignal | undefined,
): Promise<void> {
  const template = await loadTemplate();
  const key = cacheKey([hash(template), cv, jd]);

  const cachedReply = getCached(key);
  if (cachedReply !== null) {
    send({ kind: "meta", cached: true, engine: "llm" });
    send({ kind: "text", text: cachedReply });
    const score = scoreReport(cachedReply);
    if (score) send({ kind: "score", engine: "llm", score });
    send({ kind: "done", cached: true });
    return;
  }

  send({ kind: "meta", cached: false, engine: "llm" });

  const prompt = fillTemplate(template, cv, jd);
  let reply = "";
  for await (const chunk of streamCompletion(prompt, signal) as AsyncGenerator<StreamChunk>) {
    if (chunk.kind === "text") reply += chunk.text;
    send(chunk);
  }

  if (reply.trim()) setCached(key, reply);
  const score = scoreReport(reply);
  if (score) send({ kind: "score", engine: "llm", score });
  send({ kind: "done", cached: false });
}

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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let textSent = false;
      const send: Send = (chunk) => {
        if (chunk && typeof chunk === "object" && (chunk as { kind?: string }).kind === "text") {
          textSent = true;
        }
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
      };

      try {
        if (jevEnabled()) {
          try {
            if (await runJev(cv, jd, send, req.signal)) return;
          } catch (err) {
            console.error("[analyze] pipeline Jev gagal, jatuh ke LLM tunggal:", err);
            if (textSent) {
              send({ kind: "text", text: `\n\n> ⚠️ **Error:** ${message(err)}\n` });
              return;
            }
            send({ kind: "meta", cached: false, engine: "llm" });
          }
        }
        await runLegacy(cv, jd, send, req.signal);
      } catch (err) {
        send({ kind: "text", text: `\n\n> ⚠️ **Error:** ${message(err)}\n` });
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
