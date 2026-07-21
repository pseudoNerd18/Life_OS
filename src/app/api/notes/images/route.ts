import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { rateLimitFor } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

/**
 * Stores a dropped/pasted note image as a DB row rather than a file on disk —
 * the app has no persistent upload volume, but Postgres already is one.
 */
export async function POST(req: Request) {
  const user = await currentUser();

  const rl = await rateLimitFor("noteImage", user.id);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many uploads — try again in a moment." }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected a multipart/form-data body with a `file` field" }, { status: 400 });
  }
  const file = formData.get("file") as Blob | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "image too large (max 10MB)" }, { status: 413 });

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "unsupported image type" }, { status: 415 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const image = await prisma.noteImage.create({
    data: { userId: user.id, mimeType, data },
    select: { id: true },
  });

  return NextResponse.json({ url: `/api/notes/images/${image.id}` });
}
