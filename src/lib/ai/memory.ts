/**
 * Semantic memory powered by pgvector.
 *
 * Each meaningful event (task created, goal set, preference learned) is
 * embedded with nomic-embed-text via Ollama and stored. When the assistant
 * needs context for a new utterance, it retrieves top-k similar memories.
 *
 * Note: Prisma doesn't natively type the `vector` column, so we use raw SQL
 * for inserts and similarity queries.
 */
import { prisma } from "@/lib/db";
import { ollamaEmbed } from "./ollama";

export async function rememberFact(args: {
  userId: string;
  kind: "task" | "goal" | "note" | "preference" | "fact";
  content: string;
  refId?: string;
}) {
  const embedding = await ollamaEmbed(args.content);
  const vec = `[${embedding.join(",")}]`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Memory" (id, "userId", kind, "refId", content, embedding, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::vector, NOW())`,
    args.userId,
    args.kind,
    args.refId ?? null,
    args.content,
    vec,
  );
}

export async function recallSimilar(args: {
  userId: string;
  query: string;
  k?: number;
  kinds?: Array<"task" | "goal" | "note" | "preference" | "fact">;
}): Promise<Array<{ id: string; kind: string; refId: string | null; content: string; distance: number }>> {
  const k = args.k ?? 6;
  const embedding = await ollamaEmbed(args.query);
  const vec = `[${embedding.join(",")}]`;

  const kindsClause = args.kinds?.length
    ? `AND kind = ANY($3::text[])`
    : "";

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, kind, "refId", content, (embedding <=> $1::vector) AS distance
     FROM "Memory"
     WHERE "userId" = $2 ${kindsClause}
     ORDER BY embedding <=> $1::vector ASC
     LIMIT ${k}`,
    vec,
    args.userId,
    ...(args.kinds?.length ? [args.kinds] : []),
  )) as Array<{ id: string; kind: string; refId: string | null; content: string; distance: number }>;

  return rows;
}
