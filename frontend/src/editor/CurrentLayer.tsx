import Konva from "konva";
import { useEffect, useMemo, useRef } from "react";
import { Layer, Shape } from "react-konva";

import type { SimulationResult } from "../api/client";
import {
  PLAYBACK_SECONDS,
  componentCurrents,
  flowNetwork,
  maxCurrent,
  solveFlows,
  timeSpan,
  type CurrentAnimation,
  type EditorDoc,
  type GridPoint,
} from "../store";
import { getAnimationTime, setAnimationTime } from "./animationClock";
import { GRID } from "./theme";

/** Distance between two dots on a conductor, in grid units. */
const SPACING = 1;
/** Speed of the dots for the largest current of the simulation, in grid units per second. */
const MAX_SPEED = 4;
/** Slowest speed of a dot that moves at all, so a small current stays visible. */
const MIN_SPEED = 0.4;
/** Below this fraction of the largest current, the current counts as zero: no dots. */
const ZERO_FRACTION = 1e-3;
const DOT_RADIUS = 2.5;
const DOT_COLOR = "#f59e0b";
/** How often the time shown by the controls is refreshed, in ms. */
const CLOCK_REFRESH = 100;

const length = (path: readonly GridPoint[]) => {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as GridPoint;
    const b = path[i] as GridPoint;
    total += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  }
  return total;
};

/** Point at distance `s` along an orthogonal (or straight) polyline. */
function pointAt(path: readonly GridPoint[], s: number): GridPoint {
  let rest = s;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as GridPoint;
    const b = path[i] as GridPoint;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= len && len > 0) {
      const f = rest / len;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    rest -= len;
  }
  return path[path.length - 1] as GridPoint;
}

/**
 * Dots moving along the components and wires, after a simulation: their speed follows the
 * magnitude of the current, their direction its sign (or the electrons' direction). A transient
 * simulation is played back in time.
 */
export function CurrentLayer({
  doc,
  result,
  settings,
}: {
  doc: EditorDoc;
  result: SimulationResult;
  settings: CurrentAnimation;
}) {
  const layerRef = useRef<Konva.Layer>(null);
  const edges = useMemo(() => flowNetwork(doc), [doc]);
  const drawn = useMemo(
    () =>
      edges
        .filter((e) => e.kind !== "link")
        .map((e) => ({ edge: e, length: length(e.path) }))
        .filter((d) => d.length > 0),
    [edges],
  );
  const imax = useMemo(() => maxCurrent(result), [result]);
  const [start, end] = useMemo(() => timeSpan(result), [result]);
  const transient = result.analysis === "tran";

  /** Where the dots of each conductor are, as a distance along it (grid units). */
  const offsets = useRef(new Map<string, number>());
  /** Dots to draw on the next frame (grid units). */
  const dots = useRef<GridPoint[]>([]);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    // A new simulation starts from the beginning of its time span.
    setAnimationTime(start);
  }, [result, start]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    let sinceRefresh = 0;
    const animation = new Konva.Animation((frame) => {
      if (!frame) return;
      const dt = Math.min(frame.timeDiff, 100) / 1000;
      const s = settingsRef.current;

      let t = getAnimationTime();
      if (transient && s.playing && end > start) {
        t += (dt * s.speed * (end - start)) / PLAYBACK_SECONDS;
        if (t > end) t = start + ((t - start) % (end - start));
        sinceRefresh += dt * 1000;
        const notify = sinceRefresh >= CLOCK_REFRESH;
        if (notify) sinceRefresh = 0;
        setAnimationTime(t, notify);
      }
      // Paused: nothing moves (the dots stay where they are).
      const moving = !transient || s.playing;

      const flows = solveFlows(edges, componentCurrents(result, t));
      const next: GridPoint[] = [];
      for (const { edge, length: len } of drawn) {
        const current = flows.get(edge.id);
        if (current === undefined || imax === 0 || Math.abs(current) < imax * ZERO_FRACTION) {
          continue;
        }
        const speed = Math.max(MIN_SPEED, (MAX_SPEED * Math.abs(current)) / imax);
        const direction = Math.sign(current) * (s.electrons ? -1 : 1);
        const offset = (offsets.current.get(edge.id) ?? 0) + (moving ? direction * speed * dt : 0);
        offsets.current.set(edge.id, offset);
        const first = ((offset % SPACING) + SPACING) % SPACING;
        for (let d = first; d <= len; d += SPACING) next.push(pointAt(edge.path, d));
      }
      dots.current = next;
    }, layer);
    animation.start();
    return () => {
      animation.stop();
    };
  }, [edges, drawn, result, imax, start, end, transient]);

  return (
    <Layer ref={layerRef} listening={false}>
      <Shape
        sceneFunc={(context) => {
          context.beginPath();
          for (const p of dots.current) {
            context.moveTo(p.x * GRID + DOT_RADIUS, p.y * GRID);
            context.arc(p.x * GRID, p.y * GRID, DOT_RADIUS, 0, Math.PI * 2);
          }
          context.setAttr("fillStyle", DOT_COLOR);
          context.fill();
        }}
      />
    </Layer>
  );
}
