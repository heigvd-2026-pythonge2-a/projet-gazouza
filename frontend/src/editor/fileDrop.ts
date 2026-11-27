// Opening a schematic by dropping its file on the window (#277).
//
// A file dropped where nothing calls `preventDefault` makes the browser (and WebView2, in the
// desktop window) open it in place of the app, losing the schematic: every file drag over the
// window is therefore caught here. Only a drop on the schematic opens the file; elsewhere it is
// refused. Drags from the palette carry no file and are left to the canvas.

import { useEffect, useState, type RefObject } from "react";

import { openDroppedFile } from "./fileActions";

/** True if the drag carries files from outside the page (the Explorer). */
export const carriesFiles = (data: DataTransfer | null): boolean =>
  data !== null && Array.from(data.types).includes("Files");

/**
 * How long the "drop to open" frame stays after the last `dragover`. The browser repeats
 * `dragover` while a drag stays over the page, even without moving; `dragleave` is not reliable
 * enough to tell when the drag left the window.
 */
const OVER_TIMEOUT_MS = 200;

/** `getAsFileSystemHandle` (File System Access API), not in TypeScript's DOM types yet. */
interface ItemWithHandle {
  getAsFileSystemHandle(): Promise<FileSystemHandle | null>;
}

/** The file handle of a dropped item, when the browser gives one (Chrome, Edge, WebView2). */
function droppedHandle(data: DataTransfer): Promise<FileSystemFileHandle | null> {
  const item = data.items?.[0];
  if (!item || !("getAsFileSystemHandle" in item)) return Promise.resolve(null);
  // Asked during the event: the items are no longer readable once it is over.
  return (item as unknown as ItemWithHandle)
    .getAsFileSystemHandle()
    .then((h) => (h?.kind === "file" ? (h as FileSystemFileHandle) : null))
    .catch(() => null);
}

/**
 * Catches the files dragged over the window, and opens the one dropped on `target`. Returns true
 * while a file is dragged over `target`, to show where to drop it.
 */
export function useFileDrop(target: RefObject<HTMLElement | null>): boolean {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const inside = (e: DragEvent) =>
      e.target instanceof Node && (target.current?.contains(e.target) ?? false);
    const stopShowing = () => {
      window.clearTimeout(timer);
      setOver(false);
    };

    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      const onTarget = inside(e);
      if (e.dataTransfer) e.dataTransfer.dropEffect = onTarget ? "copy" : "none";
      setOver(onTarget);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOver(false), OVER_TIMEOUT_MS);
    };

    const onDrop = (e: DragEvent) => {
      const data = e.dataTransfer;
      if (!data || !carriesFiles(data)) return;
      e.preventDefault();
      stopShowing();
      if (!inside(e)) return;
      const file = data.files[0];
      if (!file) return;
      const handle = droppedHandle(data);
      void handle.then((h) => openDroppedFile(file, h));
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [target]);

  return over;
}
