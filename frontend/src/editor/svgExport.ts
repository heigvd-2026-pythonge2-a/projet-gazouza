// SVG export of the schematic (#279): the nodes of the canvas layer drawn for the image export
// (no grid, no selection, light colours) written as SVG shapes, so the SVG holds exactly what the
// PNG shows. Konva has no SVG output of its own; only the shapes the editor draws are handled:
// groups, lines, rectangles, circles and texts.

/** What is read from a Konva node (a structural subset, so plain objects can stand in for tests). */
export interface SvgSourceNode {
  getClassName(): string;
  attrs: Record<string, unknown>;
  /** Local transform of the node (position, rotation, scale), as a 2D matrix [a b c d e f]. */
  getTransform(): { getMatrix(): number[] };
  getChildren?: () => SvgSourceNode[];
}

/** Area of the schematic the SVG shows, in canvas units. */
export interface SvgFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Generic fonts: the SVG must look right wherever it is opened (Inkscape, Word). */
export const SVG_FONT = "Arial, Helvetica, sans-serif";

/** Konva's default font size and line height (`Konva.Text`). */
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_LINE_HEIGHT = 1;
/** Konva centres each line on its line box; the baseline sits about 0.35 em below the middle. */
const BASELINE_FROM_MIDDLE = 0.35;

/** Number written with at most 3 decimals, without trailing zeros. */
const num = (v: number): string => String(Math.round(v * 1000) / 1000);

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const nr = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback);

/**
 * A colour as SVG writes it: `rgba()` is split into `rgb()` and an opacity, which older SVG
 * readers (Word) understand. Null for a missing or fully transparent colour.
 */
export function paint(color: string | undefined): { color: string; opacity: number } | null {
  if (!color || color === "transparent") return null;
  const rgba = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(color);
  if (!rgba) return { color, opacity: 1 };
  const opacity = Number(rgba[4]);
  if (opacity === 0) return null;
  return { color: `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})`, opacity };
}

/** `fill` and `stroke` attributes of a shape, or null if it draws nothing (a click area). */
function paintAttrs(attrs: Record<string, unknown>, filled: boolean): string | null {
  const fill = filled ? paint(str(attrs.fill)) : null;
  const strokeWidth = nr(attrs.strokeWidth, 1);
  const stroke = strokeWidth > 0 && attrs.strokeEnabled !== false ? paint(str(attrs.stroke)) : null;
  if (!fill && !stroke) return null;
  const out: string[] = [];
  if (fill) {
    out.push(`fill="${escape(fill.color)}"`);
    if (fill.opacity < 1) out.push(`fill-opacity="${num(fill.opacity)}"`);
  } else {
    out.push('fill="none"');
  }
  if (stroke) {
    out.push(`stroke="${escape(stroke.color)}"`, `stroke-width="${num(strokeWidth)}"`);
    if (stroke.opacity < 1) out.push(`stroke-opacity="${num(stroke.opacity)}"`);
    const cap = str(attrs.lineCap);
    if (cap && cap !== "butt") out.push(`stroke-linecap="${cap}"`);
    const join = str(attrs.lineJoin);
    if (join && join !== "miter") out.push(`stroke-linejoin="${join}"`);
    if (Array.isArray(attrs.dash) && attrs.dash.length > 0 && attrs.dashEnabled !== false) {
      out.push(`stroke-dasharray="${(attrs.dash as number[]).map(num).join(" ")}"`);
    }
  }
  return out.join(" ");
}

/** ` transform="matrix(…)"`, or nothing for the identity. */
function transformAttr(node: SvgSourceNode): string {
  const m = node.getTransform().getMatrix();
  const identity = [1, 0, 0, 1, 0, 0];
  if (m.every((v, i) => Math.abs(v - (identity[i] as number)) < 1e-9)) return "";
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) {
    return ` transform="translate(${num(m[4] ?? 0)} ${num(m[5] ?? 0)})"`;
  }
  return ` transform="matrix(${m.map(num).join(" ")})"`;
}

/** The lines of a Konva text, each with its baseline and anchor. */
function textElement(attrs: Record<string, unknown>, transform: string): string | null {
  const text = str(attrs.text) ?? "";
  if (text === "") return null;
  const fill = paint(str(attrs.fill) ?? "black");
  if (!fill) return null;
  const size = nr(attrs.fontSize, DEFAULT_FONT_SIZE);
  const lineHeight = size * nr(attrs.lineHeight, DEFAULT_LINE_HEIGHT);
  const padding = nr(attrs.padding, 0);
  const width = typeof attrs.width === "number" ? attrs.width : null;
  const align = str(attrs.align) ?? "left";
  const [x, anchor] =
    width === null || align === "left"
      ? [padding, "start"]
      : align === "center"
        ? [width / 2, "middle"]
        : [width - padding, "end"];
  const style = str(attrs.fontStyle) ?? "normal";
  const font = [
    `font-size="${num(size)}"`,
    style.includes("bold") ? 'font-weight="bold"' : "",
    style.includes("italic") ? 'font-style="italic"' : "",
  ].filter(Boolean);
  const lines = text.split("\n").map((line, i) => {
    const y = padding + lineHeight * (i + 0.5) + size * BASELINE_FROM_MIDDLE;
    return `<tspan x="${num(x)}" y="${num(y)}">${escape(line)}</tspan>`;
  });
  const opacity = fill.opacity < 1 ? ` fill-opacity="${num(fill.opacity)}"` : "";
  return (
    `<text${transform} ${font.join(" ")} text-anchor="${anchor}" ` +
    `fill="${escape(fill.color)}"${opacity}>${lines.join("")}</text>`
  );
}

/** One node and its children as SVG elements (empty if it draws nothing). */
export function nodeToSvg(node: SvgSourceNode): string {
  const attrs = node.attrs;
  if (attrs.visible === false) return "";
  const opacity = nr(attrs.opacity, 1);
  if (opacity <= 0) return "";
  const transform = transformAttr(node);
  const opacityAttr = opacity < 1 ? ` opacity="${num(opacity)}"` : "";
  switch (node.getClassName()) {
    case "Layer":
    case "Group": {
      const inner = (node.getChildren?.() ?? []).map(nodeToSvg).join("");
      return inner ? `<g${transform}${opacityAttr}>${inner}</g>` : "";
    }
    case "Line": {
      const points = Array.isArray(attrs.points) ? (attrs.points as number[]) : [];
      if (points.length < 4) return "";
      const closed = attrs.closed === true;
      const look = paintAttrs(attrs, closed);
      if (!look) return "";
      const coords = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        coords.push(`${num(points[i] as number)},${num(points[i + 1] as number)}`);
      }
      const tag = closed ? "polygon" : "polyline";
      return `<${tag}${transform}${opacityAttr} points="${coords.join(" ")}" ${look}/>`;
    }
    case "Rect": {
      const look = paintAttrs(attrs, true);
      if (!look) return "";
      const radius = nr(attrs.cornerRadius, 0);
      const corner = radius > 0 ? ` rx="${num(radius)}"` : "";
      return (
        `<rect${transform}${opacityAttr} width="${num(nr(attrs.width, 0))}" ` +
        `height="${num(nr(attrs.height, 0))}"${corner} ${look}/>`
      );
    }
    case "Circle": {
      const look = paintAttrs(attrs, true);
      if (!look) return "";
      return `<circle${transform}${opacityAttr} r="${num(nr(attrs.radius, 0))}" ${look}/>`;
    }
    case "Text": {
      const element = textElement(attrs, transform);
      if (!element) return "";
      return opacity < 1 ? `<g${opacityAttr}>${element}</g>` : element;
    }
    default:
      return "";
  }
}

/**
 * A standalone SVG document of `root` (the layer of the schematic), cropped to `frame`, on a
 * white background unless `transparent`. Sizes are in pixels, one per canvas unit.
 */
export function layerToSvg(root: SvgSourceNode, frame: SvgFrame, transparent: boolean): string {
  const { x, y, width, height } = frame;
  const background = transparent
    ? ""
    : `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" fill="#ffffff"/>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(width)}" ` +
    `height="${num(height)}" viewBox="${num(x)} ${num(y)} ${num(width)} ${num(height)}">\n` +
    background +
    `<g font-family="${SVG_FONT}">${nodeToSvg(root)}</g>\n</svg>\n`
  );
}
