import { Ollama } from "ollama";

const host = process.env.OLLAMA_HOST || "http://localhost:11434";
export const ollama = new Ollama({ host });

export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3";
export const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

interface ChatOpts {
  system?: string;
  prompt: string;
  format?: "json" | undefined;
  temperature?: number;
}

export async function ollamaChat({ system, prompt, format, temperature = 0.2 }: ChatOpts) {
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    format,
    options: { temperature },
    messages: [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      { role: "user" as const, content: prompt },
    ],
  });
  return res.message.content;
}

export async function ollamaEmbed(text: string): Promise<number[]> {
  const res = await ollama.embeddings({ model: OLLAMA_EMBED_MODEL, prompt: text });
  return res.embedding;
}

/**
 * Does `installed` satisfy a request for `wanted`?
 *
 * Ollama names are `family:tag`, and an absent tag means `:latest`. The old
 * check compared only the family, so with `OLLAMA_MODEL=gemma3:4b` configured
 * and just `gemma3:1b` pulled it reported the model as present — Settings
 * showed a green light for a model that would 404 on first use.
 */
export function modelMatches(installed: string, wanted: string): boolean {
  const norm = (n: string) => (n.includes(":") ? n : `${n}:latest`);
  return norm(installed) === norm(wanted);
}

/** Health check used by the Settings page "Test connection" button. */
export async function ollamaHealth() {
  try {
    const list = await ollama.list();
    const models = list.models?.map((m) => m.name) ?? [];
    const present = models.some((name) => modelMatches(name, OLLAMA_MODEL));
    return {
      ok: true,
      model: OLLAMA_MODEL,
      present,
      models,
      // Same family, different tag — the most likely cause of a miss, and the
      // one where "pull it" is the obvious next step.
      ...(present
        ? {}
        : {
            hint:
              `${OLLAMA_MODEL} is not installed. Run: `
              + `docker exec lifeos-ollama ollama pull ${OLLAMA_MODEL}`,
          }),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
