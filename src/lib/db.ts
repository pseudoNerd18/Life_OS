/**
 * Database access layer.
 *
 * Key property: importing this module NEVER throws, even with no DATABASE_URL.
 *
 * - If a valid DATABASE_URL is present → real PrismaClient.
 * - Otherwise → an in-memory store with the same surface, so guest mode runs
 *   with zero infrastructure.
 *
 * The PrismaClient is constructed lazily inside a try/catch. If construction
 * itself fails (bad binary, missing engine, etc.) we degrade to memory mode
 * rather than taking the whole app down.
 */
import { getCapabilities } from "@/lib/env";
import { getMemoryStore, type MemoryStore } from "@/lib/memory-store";

type DbClient = MemoryStore | {
  user: unknown;
  $disconnect: () => Promise<void>;
};

const globalForDb = globalThis as unknown as {
  __lifeos_db?: DbClient;
  __lifeos_db_mode?: "prisma" | "memory";
};

function createClient(): { client: DbClient; mode: "prisma" | "memory" } {
  const caps = getCapabilities();

  if (!caps.hasDatabase) {
    return { client: getMemoryStore(), mode: "memory" };
  }

  try {
    // Lazy require so the Prisma engine is only loaded when we actually have a
    // URL. This avoids the eager "Environment variable not found" crash.
    const { PrismaClient } = require("@prisma/client");
    const client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
    return { client, mode: "prisma" };
  } catch (err) {
    console.error(
      "[db] PrismaClient construction failed — falling back to in-memory mode.\n",
      (err as Error).message,
    );
    return { client: getMemoryStore(), mode: "memory" };
  }
}

if (!globalForDb.__lifeos_db) {
  const { client, mode } = createClient();
  globalForDb.__lifeos_db = client;
  globalForDb.__lifeos_db_mode = mode;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[db] initialized in ${mode} mode`);
  }
}

/**
 * The shared client. Typed as `any` at the export boundary because it's a
 * union of two structurally-similar-but-not-identical clients; every call
 * site uses query shapes both support. This is a deliberate, localized
 * `any` — the alternative is threading a hand-written interface through the
 * entire app for a fallback path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prisma: any = globalForDb.__lifeos_db;

export function dbMode(): "prisma" | "memory" {
  return globalForDb.__lifeos_db_mode ?? "memory";
}
