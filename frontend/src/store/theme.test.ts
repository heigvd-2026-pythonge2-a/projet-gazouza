import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  COLORS,
  cssVariable,
  cssVariables,
  loadTheme,
  PALETTES,
  parseTheme,
  saveTheme,
  systemTheme,
  THEME_STORAGE_KEY,
  UI,
  useThemeStore,
} from "./theme";

const fakeMatchMedia = (dark: boolean) =>
  vi.fn((query: string) => ({ matches: dark && query.includes("dark") }) as MediaQueryList);

beforeEach(() => {
  window.localStorage.clear();
  useThemeStore.setState({ theme: "light", chosen: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("palettes", () => {
  it("give both themes the same entries", () => {
    expect(Object.keys(PALETTES.dark).sort()).toEqual(Object.keys(PALETTES.light).sort());
  });

  it("name the CSS variables after the entries", () => {
    expect(cssVariable("gridDot")).toBe("--psice-grid-dot");
    expect(cssVariables(PALETTES.dark)["--psice-background"]).toBe(PALETTES.dark.background);
  });

  it("are used through CSS variables that exist", () => {
    const names = new Set(Object.keys(cssVariables(PALETTES.light)));
    const used = [...Object.values(COLORS), ...Object.values(UI)].flatMap((value) =>
      typeof value === "string" ? [value] : [value.color],
    );
    for (const value of used) {
      const name = /^var\((--[a-z-]+)\)$/.exec(value)?.[1];
      expect(name && names.has(name), value).toBe(true);
    }
  });
});

describe("stored choice", () => {
  it("keeps only a known theme", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("noir")).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });

  it("is read back after saving", () => {
    expect(loadTheme()).toBeNull();
    saveTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(loadTheme()).toBe("dark");
  });
});

describe("system setting", () => {
  it("is light when the browser cannot tell", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(systemTheme()).toBe("light");
  });

  it("follows prefers-color-scheme", () => {
    vi.stubGlobal("matchMedia", fakeMatchMedia(true));
    expect(systemTheme()).toBe("dark");
    vi.stubGlobal("matchMedia", fakeMatchMedia(false));
    expect(systemTheme()).toBe("light");
  });
});

describe("theme store", () => {
  it("toggles and remembers the choice", () => {
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState()).toMatchObject({ theme: "dark", chosen: true });
    expect(loadTheme()).toBe("dark");
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe("light");
    expect(loadTheme()).toBe("light");
  });

  it("follows the system until the user chooses", () => {
    useThemeStore.getState().followSystem("dark");
    expect(useThemeStore.getState().theme).toBe("dark");
    useThemeStore.getState().toggle();
    useThemeStore.getState().followSystem("dark");
    expect(useThemeStore.getState().theme).toBe("light");
  });
});

describe("applyTheme", () => {
  it("puts the colours and the colour scheme on the page", () => {
    const root = document.createElement("div");
    applyTheme("dark", root);
    expect(root.style.getPropertyValue("--psice-surface")).toBe(PALETTES.dark.surface);
    expect(root.style.colorScheme).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light", root);
    expect(root.style.getPropertyValue("--psice-surface")).toBe(PALETTES.light.surface);
  });
});
