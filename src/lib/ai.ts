export type ApiFormat = "openai-completions" | "anthropic-messages";

export type Provider = {
  api: ApiFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
};

export type StreamChunk = { kind: "thinking" | "text"; text: string };

const DEFAULT_MAX_TOKENS = 32000;

export function getProvider(): Provider {
  const configured = Number(process.env.AI_MAX_TOKENS);
  return {
    api: (process.env.AI_API as ApiFormat) || "openai-completions",
    baseUrl: (process.env.AI_BASE_URL || "https://openagentic.id/api/v1").replace(/\/+$/, ""),
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL ?? "",
    maxTokens: Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_TOKENS,
  };
}

type SseEvent = Record<string, any>;

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  return trimmed.slice(5).trim();
}

function readDelta(evt: SseEvent, api: ApiFormat): { chunk?: StreamChunk; stopReason?: string } {
  if (api === "anthropic-messages") {
    if (evt.type === "error") {
      throw new Error(evt.error?.message || "AI provider returned an error.");
    }
    if (evt.type === "content_block_delta") {
      if (evt.delta?.type === "text_delta") {
        return { chunk: { kind: "text", text: evt.delta.text ?? "" } };
      }
      if (evt.delta?.type === "thinking_delta") {
        return { chunk: { kind: "thinking", text: evt.delta.thinking ?? "" } };
      }
    }
    if (evt.type === "message_delta") {
      return { stopReason: evt.delta?.stop_reason ?? undefined };
    }
    return {};
  }

  const delta = evt.choices?.[0]?.delta;
  const text = delta?.content ?? "";
  const reasoning = delta?.reasoning_content ?? delta?.reasoning ?? "";
  if (reasoning) return { chunk: { kind: "thinking", text: reasoning } };
  if (text) return { chunk: { kind: "text", text } };
  return {};
}

async function requestStream(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError = "AI request gagal.";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (res.ok && res.body) return res;

    const detail = await res.text().catch(() => "");
    lastError = `AI request gagal (${res.status} ${res.statusText}). ${detail.slice(0, 600)}`;

    if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS - 1) break;
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }

  throw new Error(lastError);
}

/**
 * Streams a single-turn completion from the configured provider.
 * Yields reasoning ("thinking") and answer ("text") chunks as they arrive.
 */
export async function* streamCompletion(
  prompt: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const provider = getProvider();

  if (!provider.apiKey) {
    throw new Error(
      "AI_API_KEY belum di-set. Buat file .env.local (lihat .env.example) lalu restart server.",
    );
  }

  const isAnthropic = provider.api === "anthropic-messages";
  const url = isAnthropic
    ? `${provider.baseUrl}/v1/messages`
    : `${provider.baseUrl}/chat/completions`;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isAnthropic) {
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["authorization"] = `Bearer ${provider.apiKey}`;
  }

  const body = {
    model: provider.model,
    max_tokens: provider.maxTokens,
    stream: true,
    messages: [{ role: "user", content: prompt }],
  };

  const res = await requestStream(url, headers, body, signal);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let producedText = false;
  let stopReason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const data = parseSseLine(line);
      if (data === null) continue;
      if (data === "[DONE]") {
        stopReason = stopReason ?? "end_turn";
        break;
      }

      let evt: SseEvent;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = readDelta(evt, provider.api);
      if (delta.stopReason) stopReason = delta.stopReason;
      if (delta.chunk?.text) {
        if (delta.chunk.kind === "text") producedText = true;
        yield delta.chunk;
      }
    }
  }

  if (!producedText) {
    const reason =
      stopReason === "max_tokens"
        ? "seluruh budget token habis sebelum model sempat menulis jawaban"
        : `model berhenti tanpa mengeluarkan teks${stopReason ? ` (stop_reason: ${stopReason})` : ""}`;
    throw new Error(
      `Tidak ada jawaban yang dihasilkan: ${reason}. Naikkan AI_MAX_TOKENS (sekarang ${provider.maxTokens}) atau pilih mode Cepat.`,
    );
  }
}
