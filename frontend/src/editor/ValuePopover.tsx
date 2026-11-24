import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import {
  componentBox,
  getDef,
  mainParam,
  paramProblem,
  useEditorStore,
  visibleParams,
} from "../store";
import type { Viewport } from "./Grid";
import { focusInspector } from "./inspectorFocus";
import { GRID, UI } from "./theme";

/** Space between the symbol and the menu, in grid units. */
const GAP = 0.4;
/** Smallest space kept between the menu and the edges of the canvas, in pixels. */
const MARGIN = 4;
/** Colour of a warning, as in the properties panel. */
const WARNING = "#b45309";

/**
 * Small menu over a component, opened by a double-click (#197), to change its main value without
 * leaving the schematic. Each key typed changes the document, as in the properties panel (which
 * shows the same value); Enter or a click elsewhere keeps it, Escape takes it back. The menu sits
 * above the component, or under it when there is no room above.
 */
export function ValuePopover({
  componentId,
  viewport,
  onClose,
}: {
  componentId: string;
  viewport: Viewport;
  onClose: () => void;
}) {
  const component = useEditorStore((s) => s.doc.components.find((c) => c.id === componentId));
  const setParam = useEditorStore((s) => s.setParam);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const edited = useRef(false);
  const id = useId();

  const def = component ? getDef(component.type) : null;
  const param = component && def ? mainParam(def, component.params) : null;
  const gone = !component || !param;

  // The component was deleted (or undone away) while the menu was open.
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  // A press anywhere else keeps the value and closes the menu.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  useEffect(() => {
    // The edits typed from now on are one undo step of their own, for Escape.
    useEditorStore.getState().sealHistory();
    input.current?.focus();
    input.current?.select();
  }, []);

  // After every render (the view may have moved): above the component, or under it when the top
  // of the canvas is too close; slid sideways to stay inside the canvas.
  useLayoutEffect(() => {
    const el = ref.current;
    const area = el?.parentElement?.getBoundingClientRect();
    if (!el || !area || !component) return;
    const box = componentBox(component);
    const scale = GRID * viewport.scale;
    const x = ((box.min.x + box.max.x) / 2) * scale + viewport.x;
    const above = (box.min.y - GAP) * scale + viewport.y;
    const below = (box.max.y + GAP) * scale + viewport.y;
    const { width, height } = el.getBoundingClientRect();
    const top = above - height >= MARGIN ? above - height : below;
    const left = Math.max(Math.min(x - width / 2, area.width - MARGIN - width), MARGIN);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });

  if (gone) return null;
  const value = component.params[param.name] ?? "";
  const problem = paramProblem(component.type, param, value);
  const problemColor = problem?.level === "warning" ? WARNING : UI.error;
  const more = def !== null && visibleParams(def, component.params).length > 1;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    // Escape must not also reach the app (it would clear the selection).
    e.stopPropagation();
    if (e.key === "Escape" && edited.current) useEditorStore.getState().undo();
    onClose();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Valeur de ${component.name ?? component.params.net ?? ""}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 200,
        padding: 8,
        background: "#ffffff",
        border: `1px solid ${UI.border}`,
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        fontSize: 12,
        zIndex: 10,
      }}
    >
      <label htmlFor={id} style={{ display: "block", color: "#4b5563", marginBottom: 3 }}>
        {param.label}
        {component.name && ` — ${component.name}`}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: `1px solid ${problem ? problemColor : "#d1d5db"}`,
          borderRadius: 4,
        }}
      >
        <input
          ref={input}
          id={id}
          value={value}
          onChange={(e) => {
            edited.current = true;
            setParam(component.id, param.name, e.target.value);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-invalid={problem?.level === "error" ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "4px 6px",
            border: 0,
            background: "transparent",
            font: "inherit",
            fontSize: 13,
            outline: "none",
          }}
        />
        {param.unit && <span style={{ padding: "0 6px", color: "#9ca3af" }}>{param.unit}</span>}
      </div>
      {problem && (
        <p id={`${id}-problem`} style={{ margin: "3px 0 0", color: problemColor }}>
          {problem.message}
        </p>
      )}
      {more && (
        <button
          type="button"
          onClick={() => {
            onClose();
            focusInspector();
          }}
          style={{
            marginTop: 6,
            padding: 0,
            border: 0,
            background: "none",
            color: "#2563eb",
            font: "inherit",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Plus de paramètres…
        </button>
      )}
    </div>
  );
}
