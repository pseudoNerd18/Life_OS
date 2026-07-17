import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { NotesWorkspace } from "@/components/notes/notes-workspace";

export default async function NotesPage() {
  const user = await currentUser();

  const notes = await prisma.note.findMany({
    where: { userId: user.id },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return (
    <NotesWorkspace
      initial={notes.map((n: { id: string; title: string; content: string; tags: string[]; pinned: boolean; createdAt: Date; updatedAt: Date }) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      }))}
    />
  );
}
