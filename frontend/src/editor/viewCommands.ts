// View commands (zoom, fit) asked from outside the canvas, e.g. by the toolbar buttons. The
// schematic canvas owns the viewport and registers how to carry them out.

export interface ViewCommands {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** The whole circuit as a PNG image, without the grid nor the selection (null: failed). */
  exportImage: (options: ImageOptions) => Promise<Blob | null>;
}

export interface ImageOptions {
  /** Leave the background transparent (true) instead of white, e.g. for a report. */
  transparent: boolean;
}

let current: ViewCommands | null = null;

/** Called by the canvas; returns the function that unregisters it. */
export function registerViewCommands(commands: ViewCommands): () => void {
  current = commands;
  return () => {
    if (current === commands) current = null;
  };
}

export const zoomIn = () => current?.zoomIn();
export const zoomOut = () => current?.zoomOut();
export const fitView = () => current?.fit();
export const exportImage = (options: ImageOptions): Promise<Blob | null> =>
  current?.exportImage(options) ?? Promise.resolve(null);
