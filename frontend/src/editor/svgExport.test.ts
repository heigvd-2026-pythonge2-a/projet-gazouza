import { describe, expect, it } from "vitest";

import { SVG_FONT, layerToSvg, nodeToSvg, paint, type SvgSourceNode } from "./svgExport";

/** A stand-in for a Konva node: a class name, attributes, a matrix and children. */
function node(
  className: string,
  attrs: Record<string, unknown> = {},
  children: SvgSourceNode[] = [],
  matrix = [1, 0, 0, 1, 0, 0],
): SvgSourceNode {
  return {
    getClassName: () => className,
    attrs,
    getTransform: () => ({ getMatrix: () => matrix }),
    getChildren: () => children,
  };
}

const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");

describe("paint", () => {
  it("splits rgba colours, and drops the transparent ones", () => {
    expect(paint("#15803d")).toEqual({ color: "#15803d", opacity: 1 });
    expect(paint("rgba(220, 38, 38, 0.15)")).toEqual({ color: "rgb(220, 38, 38)", opacity: 0.15 });
    expect(paint("rgba(0,0,0,0)")).toBeNull();
    expect(paint("transparent")).toBeNull();
    expect(paint(undefined)).toBeNull();
  });
});

describe("nodeToSvg", () => {
  it("writes a wire as a polyline with its stroke", () => {
    const svg = nodeToSvg(
      node("Line", { points: [0, 0, 20, 0, 20, 40], stroke: "#15803d", strokeWidth: 2 }),
    );
    expect(svg).toBe(
      '<polyline points="0,0 20,0 20,40" fill="none" stroke="#15803d" stroke-width="2"/>',
    );
  });

  it("leaves out the transparent click areas and the hidden nodes", () => {
    expect(nodeToSvg(node("Rect", { width: 10, height: 10, fill: "rgba(0,0,0,0)" }))).toBe("");
    expect(nodeToSvg(node("Rect", { width: 10, height: 10, strokeWidth: 0 }))).toBe("");
    expect(nodeToSvg(node("Circle", { radius: 3, fill: "#000", visible: false }))).toBe("");
    expect(nodeToSvg(node("Group", {}, [node("Rect", { fill: "rgba(0,0,0,0)" })]))).toBe("");
    expect(nodeToSvg(node("Image", { fill: "#000" }))).toBe("");
  });

  it("keeps the transforms of the groups and the shapes", () => {
    const svg = nodeToSvg(
      node(
        "Group",
        {},
        [node("Circle", { radius: 4, fill: "#2563eb" }, [], [1, 0, 0, 1, 5, 6])],
        [0, 1, -1, 0, 100, 40],
      ),
    );
    expect(svg).toBe(
      '<g transform="matrix(0 1 -1 0 100 40)">' +
        '<circle transform="translate(5 6)" r="4" fill="#2563eb"/></g>',
    );
  });

  it("writes texts as real text, one line per tspan, aligned like the canvas", () => {
    const svg = nodeToSvg(
      node(
        "Text",
        { text: "R1\n1k<Ω>", width: 80, align: "center", fontSize: 12, fill: "#374151" },
        [],
        [1, 0, 0, 1, 10, 20],
      ),
    );
    const text = parse(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`).querySelector(
      "text",
    );
    expect(text?.getAttribute("text-anchor")).toBe("middle");
    expect(text?.getAttribute("transform")).toBe("translate(10 20)");
    const lines = [...(text?.querySelectorAll("tspan") ?? [])];
    expect(lines.map((l) => l.textContent)).toEqual(["R1", "1k<Ω>"]);
    expect(lines.map((l) => l.getAttribute("x"))).toEqual(["40", "40"]);
    expect(Number(lines[1]?.getAttribute("y"))).toBeGreaterThan(
      Number(lines[0]?.getAttribute("y")),
    );
  });

  it("marks bold texts and half-transparent groups", () => {
    expect(nodeToSvg(node("Text", { text: "5 V", fontStyle: "bold" }))).toContain(
      'font-weight="bold"',
    );
    expect(
      nodeToSvg(node("Group", { opacity: 0.5 }, [node("Circle", { radius: 1, fill: "#000" })])),
    ).toContain('opacity="0.5"');
  });
});

describe("layerToSvg", () => {
  const layer = node("Layer", {}, [
    node("Line", { points: [0, 0, 40, 0], stroke: "#15803d", strokeWidth: 2 }),
  ]);
  const frame = { x: -20, y: -20, width: 80, height: 40 };

  it("makes a well-formed SVG document cropped to the frame, on white", () => {
    const doc = parse(layerToSvg(layer, frame, false));
    expect(doc.querySelector("parsererror")).toBeNull();
    const svg = doc.documentElement;
    expect(svg.getAttribute("viewBox")).toBe("-20 -20 80 40");
    expect(svg.getAttribute("width")).toBe("80");
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
    expect(svg.querySelector("g")?.getAttribute("font-family")).toBe(SVG_FONT);
    expect(svg.querySelector("polyline")).not.toBeNull();
  });

  it("has no background when transparent", () => {
    expect(parse(layerToSvg(layer, frame, true)).querySelector("rect")).toBeNull();
  });
});
