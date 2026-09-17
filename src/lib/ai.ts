export type ApiFormat = "openai-completions" | "anthropic-messages";

export type Provider = {
  api: ApiFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
};

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

function readDelta(evt: SseEvent, api: ApiFormat): { text: string; stopReason?: string } {
  if (api === "anthropic-messages") {
    if (evt.type === "error") {
      throw new Error(evt.error?.message || "AI provider returned an error.");
    }
    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
      return { text: evt.delta.text ?? "" };
    }
    if (evt.type === "message_delta") {
      return { text: "", stopReason: evt.delta?.stop_reason ?? undefined };
    }
    return { text: "" };
  }
  return { text: evt.choices?.[0]?.delta?.content ?? "" };
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
 * Yields raw text chunks as they arrive.
 */
export async function* streamCompletion(prompt: string, signal?: AbortSignal): AsyncGenerator<string> {
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

  const body = isAnthropic
    ? {
        model: provider.model,
        max_tokens: provider.maxTokens,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }
    : {
        model: provider.model,
        max_tokens: provider.maxTokens,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      };

  const res = await requestStream(url, headers, body, signal);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let produced = false;
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
      if (delta.text) {
        produced = true;
        yield delta.text;
      }
    }
  }

  if (!produced) {
    const reason = stopReason === "max_tokens"
      ? "seluruh budget token habis sebelum model sempat menulis jawaban (model ini memakai reasoning panjang)"
      : `model berhenti tanpa mengeluarkan teks${stopReason ? ` (stop_reason: ${stopReason})` : ""}`;
    throw new Error(
      `Tidak ada jawaban yang dihasilkan: ${reason}. Naikkan AI_MAX_TOKENS (sekarang ${provider.maxTokens}) atau pilih model non-reasoning.`,
    );
  }
}
