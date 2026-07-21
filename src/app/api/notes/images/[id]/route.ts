import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;
  const image = await prisma.noteImage.findFirst({
    where: { id, userId: user.id },
    select: { mimeType: true, data: true },
  });
  if (!image) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "content-type": image.mimeType,
      "cache-control": "private, max-age=31536000, immutable",
      // These bytes came from a file the user dropped into a note, and SVG is
      // an accepted type — an `<svg><script>` opened at this URL would other-
      // wise run in the app's own origin, with its session cookies. The CSP
      // denies the document every fetch and `sandbox` drops script execution;
      // neither affects rendering the file as an <img> in the editor.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // Never let a sniffed type override the one we validated on upload.
      "x-content-type-options": "nosniff",
    },
  });
}
