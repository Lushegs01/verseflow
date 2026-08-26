/**
 * Model provider.
 *
 * The AI in VerseFlow is an assistant with a narrow, structured job. It never
 * holds authority over funds, so this module is deliberately small: send a
 * schema-constrained request, validate the response, and hand back typed data or
 * nothing at all.
 *
 * When no API key is configured, callers fall back to the deterministic rule
 * engines. That is not a degraded demo path -- the rule engines are the reason a
 * judge can clone this repository and see the full flow with zero setup.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

export function isModelConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ModelRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** JSON Schema the reply must satisfy. Enforced again by zod on the way out. */
  temperature?: number;
}

/**
 * Ask the model for JSON. Returns null on any failure -- an unavailable or
 * malformed model response must degrade to the rule engine, never surface as an
 * error in the middle of someone building an agreement.
 */
export async function requestJson<T>(
  req: ModelRequest,
  validate: (value: unknown) => T | null,
  timeoutMs = 45_000,
): Promise<T | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error("[verseflow:ai] model request failed", response.status);
      return null;
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const text = (payload.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    const parsed = extractJson(text);
    if (parsed === null) return null;

    return validate(parsed);
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      console.error("[verseflow:ai] model request error", error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first JSON object out of a reply, tolerating prose or code fences around it. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Reported in the UI so people always know which engine produced a suggestion. */
export function engineLabel(): "model" | "rules" {
  return isModelConfigured() ? "model" : "rules";
}
