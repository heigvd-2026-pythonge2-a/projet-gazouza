import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { carriesFiles, useFileDrop } from "./fileDrop";

const openDroppedFile = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./fileActions", () => ({ openDroppedFile }));

afterEach(() => {
  openDroppedFile.mockClear();
  vi.useRealTimers();
});

/** The schematic area, and a panel beside it. */
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const over = useFileDrop(ref);
  return (
    <>
      <div ref={ref} data-testid="canvas">
        {over && <span>Déposer pour ouvrir</span>}
      </div>
      <div data-testid="panel" />
    </>
  );
}

/** The `dataTransfer` of a drag from the Explorer, or from the palette. */
const files = (...list: File[]) => ({ types: ["Files"], files: list, items: [], dropEffect: "" });
const palette = () => ({ types: ["application/x-psice-component"], files: [], dropEffect: "" });

describe("carriesFiles", () => {
  it("tells a drag of files from a drag inside the page", () => {
    expect(carriesFiles(files() as unknown as DataTransfer)).toBe(true);
    expect(carriesFiles(palette() as unknown as DataTransfer)).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});

describe("useFileDrop", () => {
  it("shows where to drop while a file is over the schematic, not elsewhere", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const data = files();
    expect(fireEvent.dragOver(screen.getByTestId("canvas"), { dataTransfer: data })).toBe(false);
    expect(data.dropEffect).toBe("copy");
    expect(screen.getByText("Déposer pour ouvrir")).toBeInTheDocument();

    // Elsewhere: still caught (no navigation to the file), but refused.
    const elsewhere = files();
    expect(fireEvent.dragOver(screen.getByTestId("panel"), { dataTransfer: elsewhere })).toBe(
      false,
    );
    expect(elsewhere.dropEffect).toBe("none");
    expect(screen.queryByText("Déposer pour ouvrir")).not.toBeInTheDocument();

    // The frame goes once the drags stop coming (the file left the window).
    fireEvent.dragOver(screen.getByTestId("canvas"), { dataTransfer: files() });
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByText("Déposer pour ouvrir")).not.toBeInTheDocument();
  });

  it("opens the file dropped on the schematic, and only there", async () => {
    render(<Harness />);
    const file = new File(["{}"], "a.psice.json");
    expect(fireEvent.drop(screen.getByTestId("canvas"), { dataTransfer: files(file) })).toBe(false);
    await vi.waitFor(() => expect(openDroppedFile).toHaveBeenCalledWith(file, null));

    expect(fireEvent.drop(screen.getByTestId("panel"), { dataTransfer: files(file) })).toBe(false);
    expect(openDroppedFile).toHaveBeenCalledOnce();
  });

  it("passes the file handle when the browser gives one", async () => {
    render(<Harness />);
    const file = new File(["{}"], "a.psice.json");
    const handle = { kind: "file", name: "a.psice.json" };
    const data = { ...files(file), items: [{ getAsFileSystemHandle: async () => handle }] };
    fireEvent.drop(screen.getByTestId("canvas"), { dataTransfer: data });
    await vi.waitFor(() => expect(openDroppedFile).toHaveBeenCalledWith(file, handle));
  });

  it("leaves the drags from the palette to the canvas", () => {
    render(<Harness />);
    expect(fireEvent.dragOver(screen.getByTestId("canvas"), { dataTransfer: palette() })).toBe(
      true,
    );
    expect(fireEvent.drop(screen.getByTestId("canvas"), { dataTransfer: palette() })).toBe(true);
    expect(openDroppedFile).not.toHaveBeenCalled();
  });
});
