import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Parsing is extraction work -> cheaper model. Coaching emails -> top model.
// Each is a fallback chain: newest first, then the previous generation if this
// account doesn't have the newer model (404).
export const MODEL_PARSE = ["claude-sonnet-5-5", "claude-sonnet-5"];
export const MODEL_EMAIL = ["claude-opus-5-5", "claude-opus-5"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyParams = Record<string, any>;

/**
 * Create a message, degrading gracefully if the target model rejects an optional
 * tuning parameter (thinking / output_config). Model capabilities differ across
 * generations, so a 400 about those params retries once without them instead of
 * failing the user's request.
 */
export async function createMessage(params: AnyParams) {
  const models: string[] = Array.isArray(params.model) ? params.model : [params.model];
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await createWithParamFallback({ ...params, model });
    } catch (err: unknown) {
      lastErr = err;
      if (!isModelUnavailable(err) || model === models[models.length - 1]) throw err;
      console.warn(`[anthropic] ${model} unavailable, falling back:`, describe(err));
    }
  }
  throw lastErr;
}

function isModelUnavailable(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  const m = describe(err).toLowerCase();
  return err.status === 404 || (err.status === 400 && m.includes("model") && (m.includes("not found") || m.includes("invalid") || m.includes("does not exist")));
}

async function createWithParamFallback(params: AnyParams) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await client.messages.create(params as any);
  } catch (err: unknown) {
    if (isUnsupportedParamError(err)) {
      const { thinking, output_config, ...rest } = params;
      void thinking;
      void output_config;
      console.warn("[anthropic] retrying without thinking/output_config:", describe(err));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await client.messages.create(rest as any);
    }
    throw err;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnsupportedParamError(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status !== 400) return false;
  const m = describe(err).toLowerCase();
  return (
    m.includes("thinking") ||
    m.includes("output_config") ||
    m.includes("effort") ||
    m.includes("unexpected") ||
    m.includes("unsupported") ||
    m.includes("not supported") ||
    m.includes("extra inputs")
  );
}

/** Concatenate text blocks (adaptive thinking can emit a leading thinking block). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractText(message: any): string {
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return content.map((b: any) => (b?.type === "text" ? b.text : "")).join("");
}

/** Log token usage so API spend is observable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function logUsage(label: string, message: any) {
  const u = message?.usage;
  if (!u) return;
  console.log(
    `[anthropic:${label}] in=${u.input_tokens ?? "?"} out=${u.output_tokens ?? "?"} ` +
      `cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`
  );
}

/**
 * Turn an SDK error into something a coordinator can act on, instead of dumping
 * raw JSON into the UI.
 */
export function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const raw = describe(err).toLowerCase();

    if (raw.includes("credit balance") || raw.includes("billing")) {
      return "Anthropic credits are exhausted. Add funds in the Anthropic Console (Plans & Billing), then try again. If you just added funds, make sure the API key in Vercel belongs to that same organization.";
    }
    if (err.status === 401) {
      return "The Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY in your Vercel Production environment variables.";
    }
    if (err.status === 403) {
      return "This API key doesn't have access to the requested model. Check the key's permissions in the Anthropic Console.";
    }
    if (err.status === 404) {
      return "That Claude model isn't available to this account. Check the model name / your account's model access.";
    }
    if (err.status === 413 || raw.includes("too large")) {
      return "That upload is too large for one request. Try fewer pages or smaller images.";
    }
    if (err.status === 429) {
      return "Rate limited by Anthropic. Wait a moment and try again.";
    }
    if (err.status && err.status >= 500) {
      return "Anthropic is temporarily unavailable. Try again in a minute.";
    }
    return `Anthropic API error (${err.status ?? "unknown"}): ${describe(err)}`;
  }
  return describe(err) || "Unknown error";
}

/** Retry once on transient (429 / 5xx) failures. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const transient =
      err instanceof Anthropic.APIError &&
      (err.status === 429 || (typeof err.status === "number" && err.status >= 500));
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 2000));
    return await fn();
  }
}
