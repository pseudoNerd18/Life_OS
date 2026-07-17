"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/ariakit";
import { toast } from "sonner";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/ariakit/style.css";
import "./block-editor.css";

/** Drop events already serviced by the fallback below — see its comment. */
const handledDrops = new WeakSet<Event>();

/**
 * Block-based note editor (BlockNote — Notion-style slash menu, drag handles,
 * nested lists, tables, code blocks).
 *
 * Storage contract: the DB column stays **HTML**, exactly as the previous
 * TipTap editor wrote it. Existing notes therefore load without a migration,
 * and everything downstream that treats `Note.content` as markup (list-pane
 * previews, excerpts, AI extraction) keeps working unchanged.
 *
 * `initialHTML` is read once on mount. The component is keyed by note id at the
 * call site, so switching notes remounts rather than reconciling — which is
 * what we want, since ProseMirror owns its own document state.
 */
export function BlockEditor({
  initialHTML,
  onChangeHTML,
}: {
  initialHTML: string;
  onChangeHTML: (html: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const editor = useCreateBlockNote({
    // Backs the image block's drag-and-drop, paste, and file-picker upload —
    // without it BlockNote embeds a transient blob: URL that dies on reload.
    //
    // BlockNote's own paste/drop handlers `await` this with no try/catch, and
    // resolving with a placeholder value (e.g. an empty url) does NOT clear its
    // internal "loading" flag for the block either — verified empirically, the
    // block is left showing "Loading..." forever regardless of what this
    // resolves to. The only way out is to remove the stuck block ourselves.
    uploadFile: async (file: File, blockId?: string) => {
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/notes/images", { method: "POST", body });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "Image upload failed");
        }
        const { url } = await res.json();
        return url;
      } catch (e) {
        toast.error((e as Error).message || "Image upload failed");
        if (blockId) editor.removeBlocks([blockId]);
        return "";
      }
    },
  });

  /**
   * Fallback for drops that land in the note pane but outside the actual
   * ProseMirror content box — e.g. a short note where most of the visible
   * area below the text is wrapper padding, not the editor itself. BlockNote
   * resolves a drop position via `posAtCoords` against its own DOM node and
   * silently no-ops when that falls outside it, which reads as "drag and drop
   * doesn't work." This appends the image at the end of the document instead.
   */
  async function insertImageAtEnd(file: File) {
    const blocks = editor.document;
    const [inserted] = editor.insertBlocks(
      [{ type: "image", props: { name: file.name } }],
      blocks[blocks.length - 1],
      "after",
    );
    const url = await editor.uploadFile!(file, inserted.id);
    editor.updateBlock(inserted.id, typeof url === "string" ? { props: { url } } : url);
  }

  // Seed the document from stored HTML. Runs once per mounted note.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const html = initialHTML.trim();
    if (!html) return;
    const blocks = editor.tryParseHTMLToBlocks(html);
    if (blocks.length) editor.replaceBlocks(editor.document, blocks);
    // `initialHTML` is intentionally a mount-time snapshot: re-seeding on every
    // prop change would clobber in-flight typing with a stale autosave echo.
  }, [editor, initialHTML]);

  return (
    <div
      className="min-h-full"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        // Only step in for drops BlockNote will not see. It owns everything
        // inside `.bn-editor` (its ProseMirror node) and uploads the file
        // itself there — note that it does *not* preventDefault() when it
        // does, so testing `e.defaultPrevented` here would let both paths run
        // and insert the image twice. Containment is the reliable signal.
        //
        // The same drop event can also reach this handler more than once, so
        // the WeakSet keeps a second visit from inserting a duplicate.
        if (handledDrops.has(e.nativeEvent)) return;
        const editorEl = e.currentTarget.querySelector(".bn-editor");
        if (editorEl && e.target instanceof Node && editorEl.contains(e.target)) return;

        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        handledDrops.add(e.nativeEvent);
        e.preventDefault();
        for (const file of files) insertImageAtEnd(file).catch((err) => toast.error((err as Error).message));
      }}
    >
      <BlockNoteView
        editor={editor}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        onChange={() => {
          if (!seeded.current) return;
          onChangeHTML(editor.blocksToHTMLLossy(editor.document));
        }}
      />
    </div>
  );
}
