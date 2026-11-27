import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { freshSimulation, useEditorStore } from "../store";
import { fixtureDoc, fixtureResult } from "../store/testFixtures";
import netlist from "../../../shared/fixtures/divider_op/netlist.json";
import { editorState, resetEditorStore } from "../test/editorStore";
import { exportNetlist, resimulateOperatingPoint, runSimulation } from "./simulationActions";

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
    // The nodes too, so that the probe finds the node of a wire (#105).
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(editorState().simulation?.nets).toEqual(netlist.nets);
  });

  it("fetches the nodes when an error names one, to highlight its wires (#253)", async () => {
    const failed = {
      analysis: "tran",
      traces: [],
      errors: [{ code: "SINGULAR_MATRIX", message: "Flottant", targets: [{ net: "out" }] }],
    };
    const fetch = stubBackend(() => Response.json(failed));
    editorState().openDocument(fixtureDoc("divider_op"));
    await runSimulation();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(editorState().simulation?.nets).toEqual(netlist.nets);
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

  it("also stops while the nodes of an operating point are fetched", async () => {
    // The simulation answers at once; the netlist (for the nodes) only when it is aborted.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) =>
        url === "/api/simulate"
          ? Promise.resolve(Response.json(fixtureResult("divider_op")))
          : new Promise((_, reject) =>
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("", "AbortError")),
              ),
            ),
      ),
    );
    editorState().openDocument(fixtureDoc("divider_op"));
    const first = runSimulation();
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
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

describe("switches and push buttons on an operating point (#43)", () => {
  /** The divider fixture with a push button `pb` in it (not wired: only its state matters). */
  function withButton() {
    const doc = fixtureDoc("divider_op");
    editorState().openDocument(doc);
    editorState().dropComponent("push_button", { x: 40, y: 0 });
    return editorState().doc.components.at(-1)!.id;
  }

  const sentState = (fetch: ReturnType<typeof stubBackend>, call: number, id: string) => {
    const body = JSON.parse(fetch.mock.calls[call]![1]!.body as string);
    return body.schematic.components.find((c: { id: string }) => c.id === id).params.state;
  };

  it("simulates a push button held down closed, without changing the document", async () => {
    const fetch = stubBackend();
    const id = withButton();
    const doc = editorState().doc;
    editorState().pressButton(id);
    await runSimulation();
    expect(sentState(fetch, 0, id)).toBe("SW_CLOSED");
    expect(editorState().doc).toBe(doc);
  });

  it("runs the operating point again, only after one", async () => {
    const fetch = stubBackend(() => Response.json(fixtureResult("rc_tran")));
    const id = withButton();
    editorState().setAnalysis({ kind: "tran", stopTime: "5m" });
    await runSimulation();
    // The simulation and its nodes (for the probe, #105), then nothing: it is not an .op.
    expect(fetch).toHaveBeenCalledTimes(2);
    resimulateOperatingPoint();
    expect(fetch).toHaveBeenCalledTimes(2);

    stubBackend();
    editorState().setAnalysis({ kind: "op" });
    await runSimulation();
    const again = stubBackend();
    editorState().toggleSwitch(id);
    resimulateOperatingPoint();
    await vi.waitFor(() => expect(editorState().simulating).toBe(false));
    expect(sentState(again, 0, id)).toBe("SW_CLOSED");
    expect(freshSimulation(editorState())?.analysis).toBe("op");
  });

  it("stops a run still going and keeps showing the new one as running", async () => {
    let answer: (r: Response) => void = () => {};
    stubBackend(() => Response.json(fixtureResult("divider_op")));
    const id = withButton();
    await runSimulation();
    const slow = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          answer = resolve;
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", slow);
    editorState().pressButton(id);
    resimulateOperatingPoint();
    editorState().pressButton(null);
    resimulateOperatingPoint();
    await Promise.resolve();
    expect(editorState().simulating).toBe(true);
    answer(Response.json(fixtureResult("divider_op")));
  });
});
