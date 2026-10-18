// Calls a model through OpenRouter and returns JSON that follows a schema.
import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { requireEnv } from "./arc.ts";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

export type Part =
  | { type: "text"; text: string }
  | { type: "file"; file: { filename: string; file_data: string } }
  | { type: "image_url"; image_url: { url: string } };

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Turn a document on disk into a message part: PDFs and images as files, anything else as text. */
export function documentPart(path: string): Part {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") {
    const data = readFileSync(path).toString("base64");
    return { type: "file", file: { filename: basename(path), file_data: `data:application/pdf;base64,${data}` } };
  }
  if (IMAGE_TYPES[ext]) {
    const data = readFileSync(path).toString("base64");
    return { type: "image_url", image_url: { url: `data:${IMAGE_TYPES[ext]};base64,${data}` } };
  }
  return { type: "text", text: readFileSync(path, "utf8") };
}

/**
 * Ask the model for JSON matching `schema`. Only providers that enforce structured
 * outputs are used, but enforcement varies, so callers must still validate the result.
 */
export async function askJson({
  system,
  content,
  schemaName,
  schema,
  timeoutMs = 90_000,
}: {
  system: string;
  content: Part[];
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ value: unknown; model: string }> {
  const request = () =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}`,
        "Content-Type": "application/json",
        "X-Title": "Payme",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
        provider: { require_parameters: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  // A model call changes nothing, so dropped connections, rate limits and server
  // errors are retried a few times.
  let response!: Response; // assigned before the loop can exit; a failed last attempt throws
  for (let attempt = 1; ; attempt++) {
    try {
      response = await request();
      if (response.ok || attempt >= 3 || (response.status !== 429 && response.status < 500)) break;
    } catch (err) {
      if (attempt >= 3) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const body = (await response.json()) as {
    model?: string;
    choices?: { message?: { content?: unknown } }[];
    error?: { message?: string };
  };
  if (body.error) throw new Error(`OpenRouter error: ${body.error.message}`);
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("OpenRouter returned no message content.");
  return { value: JSON.parse(text), model: body.model ?? "unknown" };
}
