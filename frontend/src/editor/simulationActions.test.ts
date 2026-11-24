import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { freshSimulation, useEditorStore } from "../store";
import { fixtureDoc, fixtureResult } from "../store/testFixtures";
import netlist from "../../../shared/fixtures/divider_op/netlist.json";
import { editorState, resetEditorStore } from "../test/editorStore";
import { exportNetlist, runSimulation } from "./simulationActions";

/** Answers the backend routes like the real one would for the divider fixture. */
function stubBackend(simulate: () => Response = () => Response.json(fixtureResult("divider_op"))) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) =>
    url === "/api/simulate" && init ? simulate() : Response.json(netlist),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

let alert: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetEditorStore();
  alert = vi.fn();
  vi.stubGlobal("alert", alert);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runSimulation (#100)", () => {
  it("simulates the schematic and keeps the result with the nodes of the netlist", async () => {
    const fetch = stubBackend();
    editorState().openDocument(fixtureDoc("divider_op"));
    const running = runSimulation();
    expect(editorState().simulating).toBe(true);
    await running;
    expect(editorState().simulating).toBe(false);
    expect(freshSimulation(editorState())?.analysis).toBe("op");
    expect(editorState().simulation?.nets).toEqual(netlist.nets);
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.analysis).toEqual({ kind: "op" });
    expect(body.schematic.version).toBe(2);
  });

  it("sends a transient analysis with its settings in seconds", async () => {
    const fetch = stubBackend(() => Response.json(fixtureResult("rc_tran")));
    editorState().openDocument(fixtureDoc("rc_tran"));
    editorState().setAnalysis({ kind: "tran", stopTime: "5m", maxStep: "10u" });
    await runSimulation();
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.analysis).toEqual({ kind: "tran", stop_time: 0.005, max_step: 1e-5 });
    // Only an operating point needs the nodes.
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("shows the errors in French, without calling the backend for invalid settings", async () => {
    const fetch = stubBackend(() => Response.json({ detail: "Erreur interne" }, { status: 500 }));
    await runSimulation();
    expect(editorState().simulationError).toMatch(/vide/);

    editorState().openDocument(fixtureDoc("rc_tran"));
    editorState().setAnalysis({ kind: "tran", stopTime: "abc" });
    await runSimulation();
    expect(editorState().simulationError).toMatch(/Durée/);
    expect(fetch).not.toHaveBeenCalled();

    editorState().setAnalysis({ stopTime: "1m" });
    await runSimulation();
    expect(editorState().simulationError).toBe("Erreur interne");
    expect(editorState().simulation).toBeNull();
  });

  it("stops when run again while it runs", async () => {
    stubBackend();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("", "AbortError")),
            ),
          ),
      ),
    );
    useEditorStore.getState().openDocument(fixtureDoc("divider_op"));
    const first = runSimulation();
    await runSimulation();
    await first;
    expect(editorState().simulating).toBe(false);
    expect(editorState().simulationError).toBeNull();
    expect(editorState().simulation).toBeNull();
  });
});

describe("exportNetlist (#114)", () => {
  it("saves the netlist in a .cir file", async () => {
    stubBackend();
    const written: unknown[] = [];
    const handle = {
      name: "schema.cir",
      createWritable: async () => ({
        write: async (data: unknown) => void written.push(data),
        close: async () => {},
      }),
    };
    const showSaveFilePicker = vi.fn(async () => handle);
    vi.stubGlobal("showSaveFilePicker", showSaveFilePicker);
    vi.stubGlobal("showOpenFilePicker", vi.fn());
    editorState().openDocument(fixtureDoc("divider_op"));
    await exportNetlist();
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "schema.cir" }),
    );
    expect(await (written[0] as Blob).text()).toBe(netlist.netlist);
  });

  it("says why there is no netlist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ netlist: "", errors: [{ code: "NO_GROUND", message: "Pas de masse." }] }),
      ),
    );
    editorState().openDocument(fixtureDoc("divider_op"));
    await exportNetlist();
    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/Pas de masse/));
  });
});
