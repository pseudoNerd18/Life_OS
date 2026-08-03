/**
 * In-memory data store.
 *
 * A tiny subset of the Prisma client surface, enough to run the whole app
 * with no database. Used automatically when DATABASE_URL is absent.
 *
 * Scope: process-lifetime only. Resets on server restart. That's the correct
 * behavior for a zero-config "just let me try it" mode — and the diagnostics
 * banner makes it explicit to the user.
 *
 * This is deliberately NOT a full Prisma reimplementation. It supports the
 * exact query shapes the app actually issues. If a new query shape is added
 * elsewhere, extend the matching method here.
 */
import { nanoid } from "nanoid";

type Row = Record<string, unknown>;

function now() {
  return new Date();
}

/** Matches a Prisma-style `where` against a row (supports the operators we use). */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      const arr = cond as Row[];
      if (!arr.every((c) => matches(row, c))) return false;
      continue;
    }
    if (key === "OR") {
      const arr = cond as Row[];
      if (!arr.some((c) => matches(row, c))) return false;
      continue;
    }
    const val = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("equals" in c && val !== c.equals) return false;
      if ("in" in c && !(c.in as unknown[]).includes(val)) return false;
      if ("not" in c && val === c.not) return false;
      if ("lt" in c && !(val != null && (val as number | Date) < (c.lt as number | Date))) return false;
      if ("lte" in c && !(val != null && (val as number | Date) <= (c.lte as number | Date))) return false;
      if ("gt" in c && !(val != null && (val as number | Date) > (c.gt as number | Date))) return false;
      if ("gte" in c && !(val != null && (val as number | Date) >= (c.gte as number | Date))) return false;
    } else {
      if (val !== cond) return false;
    }
  }
  return true;
}

function applyOrderBy(rows: Row[], orderBy: Row | Row[] | undefined): Row[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const [field, dir] = Object.entries(clause)[0] as [string, "asc" | "desc"];
      const av = a[field], bv = b[field];
      if (av == null && bv == null) continue;
      if (av == null) return dir === "asc" ? 1 : -1;
      if (bv == null) return dir === "asc" ? -1 : 1;
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
}

class Collection {
  rows: Row[] = [];

  async findUnique({ where }: { where: Row }) {
    return this.rows.find((r) => matches(r, where)) ?? null;
  }
  async findFirst({ where, orderBy }: { where?: Row; orderBy?: Row | Row[] } = {}) {
    const filtered = applyOrderBy(this.rows.filter((r) => matches(r, where)), orderBy);
    return filtered[0] ?? null;
  }
  async findMany({
    where, orderBy, take, include, select,
  }: {
    where?: Row; orderBy?: Row | Row[]; take?: number;
    include?: Row; select?: Row;
  } = {}) {
    let out = applyOrderBy(this.rows.filter((r) => matches(r, where)), orderBy);
    if (typeof take === "number") out = out.slice(0, take);
    // include/select are passed through as-is; callers in memory-mode get the
    // base row. Relations resolve as empty arrays — acceptable for guest mode.
    if (include) {
      out = out.map((r) => {
        const copy = { ...r };
        for (const k of Object.keys(include)) {
          if (!(k in copy)) copy[k] = [];
        }
        return copy;
      });
    }
    void select;
    return out;
  }
  async create({ data }: { data: Row }) {
    const row: Row = {
      id: (data.id as string) ?? nanoid(),
      createdAt: now(),
      updatedAt: now(),
      ...data,
    };
    this.rows.push(row);
    return row;
  }
  async createMany({ data }: { data: Row[] }) {
    for (const d of data) await this.create({ data: d });
    return { count: data.length };
  }
  async update({ where, data }: { where: Row; data: Row }) {
    const row = this.rows.find((r) => matches(r, where));
    if (!row) throw new Error("Record to update not found.");
    Object.assign(row, data, { updatedAt: now() });
    return row;
  }
  async updateMany({ where, data }: { where?: Row; data: Row }) {
    let count = 0;
    for (const row of this.rows) {
      if (matches(row, where)) { Object.assign(row, data, { updatedAt: now() }); count++; }
    }
    return { count };
  }
  async upsert({ where, create, update }: { where: Row; create: Row; update: Row }) {
    const row = this.rows.find((r) => matches(r, where));
    if (row) { Object.assign(row, update, { updatedAt: now() }); return row; }
    return this.create({ data: create });
  }
  async delete({ where }: { where: Row }) {
    const i = this.rows.findIndex((r) => matches(r, where));
    if (i === -1) throw new Error("Record to delete does not exist.");
    return this.rows.splice(i, 1)[0];
  }
  async deleteMany({ where }: { where?: Row } = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, where));
    return { count: before - this.rows.length };
  }
  async count({ where }: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, where)).length;
  }
}

export class MemoryStore {
  user = new Collection();
  task = new Collection();
  goal = new Collection();
  milestone = new Collection();
  note = new Collection();
  noteLink = new Collection();
  calendarAccount = new Collection();
  calendarEvent = new Collection();
  conversation = new Collection();
  message = new Collection();
  memory = new Collection();
  notification = new Collection();
  dailyBriefing = new Collection();

  // Raw SQL is a no-op in memory mode — semantic memory simply doesn't persist
  // embeddings. recallSimilar() callers already tolerate an empty array.
  async $executeRawUnsafe() { return 0; }
  async $queryRawUnsafe<T = unknown>(): Promise<T> { return [] as unknown as T; }
  async $transaction<T>(arg: Promise<T>[] | ((tx: MemoryStore) => Promise<T>)): Promise<unknown> {
    if (typeof arg === "function") return arg(this);
    return Promise.all(arg);
  }
  async $connect() { /* no-op */ }
  async $disconnect() { /* no-op */ }
}

let store: MemoryStore | null = null;
export function getMemoryStore(): MemoryStore {
  if (!store) store = new MemoryStore();
  return store;
}
