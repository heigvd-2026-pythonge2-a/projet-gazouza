// Simulated time of the current animation, shared between the canvas layer that advances it and
// the controls that show it. Kept outside React state: it changes on every frame.

let time = 0;
const listeners = new Set<() => void>();

export const getAnimationTime = () => time;

/** Sets the time; `notify` tells the controls to show it (not needed on every frame). */
export function setAnimationTime(t: number, notify = true) {
  time = t;
  if (notify) for (const l of listeners) l();
}

export function subscribeAnimationTime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
