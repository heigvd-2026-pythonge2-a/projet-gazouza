import { useSyncExternalStore, type CSSProperties } from "react";

import { animatable, freshSimulation, timeSpan, useEditorStore } from "../store";
import { getAnimationTime, subscribeAnimationTime } from "./animationClock";
import { COLORS, UI } from "./theme";

const SPEEDS = [0.25, 0.5, 1, 2, 4];

const control: CSSProperties = {
  font: "inherit",
  height: 22,
  padding: "0 8px",
  border: `1px solid ${UI.border}`,
  borderRadius: 4,
  background: "#ffffff",
  color: COLORS.text,
  cursor: "pointer",
};

/** Time in seconds with an SI prefix, e.g. "1,25 ms". */
function formatTime(t: number): string {
  const units: [number, string][] = [
    [1, "s"],
    [1e-3, "ms"],
    [1e-6, "µs"],
    [1e-9, "ns"],
  ];
  const [scale, unit] = units.find(([u]) => Math.abs(t) >= u) ?? [1e-9, "ns"];
  const value = (t / scale).toLocaleString("fr-CH", { maximumFractionDigits: 2 });
  return `${t === 0 ? "0" : value} ${t === 0 ? "s" : unit}`;
}

function TimeReadout({ end }: { end: number }) {
  const t = useSyncExternalStore(subscribeAnimationTime, getAnimationTime);
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      t = {formatTime(t)} / {formatTime(end)}
    </span>
  );
}

/**
 * Controls of the current animation, over the bottom-left corner of the schematic. Shown once a
 * simulation of the current schematic has succeeded; a schematic changed since then shows why
 * the animation stopped.
 */
export function AnimationControls() {
  const result = useEditorStore(freshSimulation);
  const stale = useEditorStore((s) => s.simulation !== null && freshSimulation(s) === null);
  const settings = useEditorStore((s) => s.animation);
  const setAnimation = useEditorStore((s) => s.setAnimation);

  if (!result && !stale) return null;
  const box: CSSProperties = {
    position: "absolute",
    left: 8,
    bottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 6px",
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: "rgba(255, 255, 255, 0.92)",
    fontSize: 12,
    color: COLORS.text,
  };

  if (!result) {
    return (
      <div style={{ ...box, color: UI.muted }}>
        Schéma modifié depuis la simulation : relancez-la pour animer le courant.
      </div>
    );
  }
  if (!animatable(result)) {
    return (
      <div style={box}>
        <button
          type="button"
          disabled
          title="L'animation est disponible pour les analyses .op et .tran"
          style={{ ...control, opacity: 0.5, cursor: "default" }}
        >
          Animer le courant
        </button>
      </div>
    );
  }

  const transient = result.analysis === "tran";
  const [, end] = timeSpan(result);
  return (
    <div role="group" aria-label="Animation du courant" style={box}>
      <button
        type="button"
        aria-pressed={settings.on}
        onClick={() => setAnimation({ on: !settings.on })}
        style={{
          ...control,
          ...(settings.on
            ? {
                borderColor: COLORS.selected,
                background: UI.activeBackground,
                color: COLORS.selected,
              }
            : {}),
        }}
      >
        {settings.on ? "Arrêter l'animation" : "Animer le courant"}
      </button>
      {settings.on && (
        <>
          <select
            aria-label="Sens du courant"
            value={settings.electrons ? "electrons" : "conventional"}
            onChange={(e) => setAnimation({ electrons: e.target.value === "electrons" })}
            style={control}
          >
            <option value="conventional">Sens conventionnel</option>
            <option value="electrons">Sens des électrons</option>
          </select>
          {transient && (
            <>
              <button
                type="button"
                title={settings.playing ? "Pause" : "Lecture"}
                aria-label={settings.playing ? "Pause" : "Lecture"}
                onClick={() => setAnimation({ playing: !settings.playing })}
                style={{ ...control, width: 28, padding: 0 }}
              >
                {settings.playing ? "❚❚" : "▶"}
              </button>
              <select
                aria-label="Vitesse de lecture"
                title="Vitesse de lecture"
                value={settings.speed}
                onChange={(e) => setAnimation({ speed: Number(e.target.value) })}
                style={control}
              >
                {SPEEDS.map((v) => (
                  <option key={v} value={v}>
                    ×{v.toLocaleString("fr-CH")}
                  </option>
                ))}
              </select>
              <TimeReadout end={end} />
            </>
          )}
        </>
      )}
    </div>
  );
}
