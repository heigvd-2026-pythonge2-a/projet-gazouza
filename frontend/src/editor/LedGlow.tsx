import Konva from "konva";
import { useEffect, useMemo, useRef } from "react";
import { Circle, Group, Line } from "react-konva";

import type { SimulationResult } from "../api/client";
import { ledColor, ledIntensities, type EditorDoc } from "../store";
import { getAnimationTime } from "./animationClock";
import { GRID } from "./theme";

/** The LED's triangle, as drawn by its symbol (`DIODE_BODY` in the library), in grid units. */
const TRIANGLE = [-0.7, -0.6, 0.7, -0.6, 0, 0.6].map((v) => v * GRID);

/** Rings of the halo around a lit LED: radius (grid units) and opacity at full brightness. */
const HALO = [
  { radius: 1.9, opacity: 0.12 },
  { radius: 1.4, opacity: 0.2 },
  { radius: 1, opacity: 0.3 },
];

/**
 * LEDs lit by the simulation (#294): their triangle filled with their colour and a soft halo
 * around them, as bright as their current (see `ledIntensity`). Drawn below the symbols. For a
 * transient result the brightness follows the animation time, frame by frame, without
 * re-rendering React.
 */
export function LedGlow({
  doc,
  result,
  animated,
}: {
  doc: EditorDoc;
  result: SimulationResult;
  /** Transient result being animated: the brightness follows the animation time. */
  animated: boolean;
}) {
  const leds = useMemo(() => doc.components.filter((c) => c.type === "led"), [doc]);
  const initial = useMemo(
    () => ledIntensities(doc, result, animated ? getAnimationTime() : 0),
    [doc, result, animated],
  );
  const groups = useRef(new Map<string, Konva.Group>());

  useEffect(() => {
    if (!animated) return;
    const layer = groups.current.values().next().value?.getLayer();
    if (!layer) return;
    const animation = new Konva.Animation(() => {
      const now = ledIntensities(doc, result, getAnimationTime());
      for (const [id, group] of groups.current) group.opacity(now.get(id) ?? 0);
    }, layer);
    animation.start();
    return () => {
      animation.stop();
    };
  }, [animated, doc, result]);

  return (
    <>
      {leds.map((c) => {
        const color = ledColor(c.params);
        return (
          <Group
            key={c.id}
            ref={(node) => {
              if (node) groups.current.set(c.id, node);
              else groups.current.delete(c.id);
            }}
            x={c.position.x * GRID}
            y={c.position.y * GRID}
            rotation={c.rotation}
            scaleX={c.mirror ? -1 : 1}
            opacity={initial.get(c.id) ?? 0}
            listening={false}
          >
            {HALO.map((ring) => (
              <Circle
                key={ring.radius}
                radius={ring.radius * GRID}
                fill={color}
                opacity={ring.opacity}
              />
            ))}
            <Line points={TRIANGLE} closed fill={color} opacity={0.9} />
          </Group>
        );
      })}
    </>
  );
}
