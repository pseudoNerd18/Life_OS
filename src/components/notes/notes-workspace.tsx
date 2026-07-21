"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * BlockNote pulls in ProseMirror, which touches `window` at module scope, so it
 * must not be part of the server bundle.
 */
const BlockEditor = dynamic(
  () => import("./block-editor").then((m) => m.BlockEditor),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-muted-foreground">Loading editor…</p>
    ),
  },
);

interface NoteShape {
  id: string; title: string; content: string; tags: string[];
  pinned: boolean; createdAt: string; updatedAt: string;
}

export function NotesWorkspace({ initial }: { initial: NoteShape[] }) {
  const [notes, setNotes] = useState<NoteShape[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const selected = notes.find((n) => n.id === selectedId);

  async function create() {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Untitled", content: "" }),
    });
    if (!res.ok) return toast.error("Failed to create");
    const n = (await res.json()) as NoteShape;
    setNotes((s) => [n, ...s]);
    setSelectedId(n.id);
  }

  async function save(id: string, patch: Partial<NoteShape>) {
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as NoteShape;
    setNotes((s) => s.map((n) => (n.id === id ? updated : n)));
  }

  async function remove(id: string) {
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setNotes((s) => s.filter((n) => n.id !== id));
    if (selectedId === id) setSelectedId(notes[0]?.id ?? null);
  }

  const filtered = notes.filter((n) =>
    n.title.toLowerCase().includes(query.toLowerCase()) ||
    n.content.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex-1 flex min-h-0">
      {/* List pane */}
      <aside className="w-72 border-r border-border flex flex-col shrink-0">
        <div className="p-3 border-b border-border space-y-2">
          <Button onClick={create} variant="outline" className="w-full justify-start">
            <Plus className="h-3.5 w-3.5" /> New note
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground">No notes yet.</p>
          )}
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => setSelectedId(n.id)}
              className={cn(
                "w-full text-left px-4 py-3 border-b border-border hover:bg-secondary/40 transition-colors",
                selectedId === n.id && "bg-secondary/60",
              )}
            >
              <p className="text-sm truncate">{n.title || "Untitled"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                {stripMarkup(n.content) || "No content"}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {new Date(n.updatedAt).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* Editor pane */}
      <section className="flex-1 min-w-0">
        {selected ? (
          <Editor key={selected.id} note={selected} onSave={save} onDelete={remove} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Select or create a note.
          </div>
        )}
      </section>
    </div>
  );
}

function stripMarkup(s: string) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 80);
}

function Editor({
  note, onSave, onDelete,
}: {
  note: NoteShape;
  onSave: (id: string, patch: Partial<NoteShape>) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(note.title);

  /**
   * Autosave.
   *
   * A "latest values" ref keeps the interval stable: it is created exactly once
   * per note (deps: `[note.id]`) and reads the current title/content/onSave on
   * each tick. Listing `title` or `onSave` in the deps would tear down and
   * rebuild the timer on every keystroke, and could fire a save against a stale
   * note id captured in an old closure.
   *
   * `html` is the editor's serialized content, pushed up by BlockEditor's
   * onChange. It lives in a ref rather than state so typing does not re-render
   * this component (and thus remount the editor) on every character.
   */
  const latest = useRef<{
    title: string;
    html: string | null;
    onSave: (id: string, patch: Partial<NoteShape>) => void;
    noteId: string;
  }>({ title, html: null, onSave, noteId: note.id });
  latest.current.title = title;
  latest.current.onSave = onSave;
  latest.current.noteId = note.id;

  useEffect(() => {
    const flush = () => {
      const { title: tt, html, onSave: save, noteId } = latest.current;
      // `html === null` means the editor never reported a change for this note,
      // so there is nothing to persist — and writing would blank the content.
      save(noteId, html === null ? { title: tt } : { title: tt, content: html });
    };
    const t = setInterval(flush, 2_500);
    return () => {
      clearInterval(t);
      flush(); // capture edits made since the last tick
    };
    // Intentionally NOT depending on title/onSave — see comment above.
  }, [note.id]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-4 border-b border-border flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Autosaves every few seconds · type &ldquo;/&rdquo; for blocks
        </p>
        <button
          onClick={() => onDelete(note.id)}
          className="text-xs text-muted-foreground hover:text-[hsl(var(--destructive))] inline-flex items-center gap-1.5"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-10">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            className="w-full font-display text-4xl italic bg-transparent outline-none placeholder:text-muted-foreground/40"
          />
          <div className="mt-6">
            <BlockEditor
              initialHTML={note.content}
              onChangeHTML={(html) => {
                latest.current.html = html;
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
