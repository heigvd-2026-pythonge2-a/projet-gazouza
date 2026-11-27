// jsdom has no 2D canvas: `getContext` returns null, and Konva cannot draw. This fake context
// accepts every call and draws nothing, so the Konva tree can be rendered and inspected in tests.

const fakeValues: Record<string, unknown> = {
  measureText: (text: string) => ({
    width: text.length * 6,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
  }),
  getImageData: (_x: number, _y: number, w: number, h: number) => ({
    data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
  }),
  createLinearGradient: () => ({ addColorStop: () => {} }),
  createRadialGradient: () => ({ addColorStop: () => {} }),
  createPattern: () => ({}),
  getLineDash: () => [],
  isPointInPath: () => false,
};

function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<PropertyKey, unknown> = { canvas };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "string" && prop in fakeValues) return fakeValues[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Makes `<canvas>.getContext("2d")` return a fake context (call once, in the test setup). */
export function installFakeCanvas() {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement) {
      return fakeContext(this);
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: () => "data:image/png;base64,",
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    value: (done: BlobCallback, type = "image/png") => done(new Blob([], { type })),
  });
}
