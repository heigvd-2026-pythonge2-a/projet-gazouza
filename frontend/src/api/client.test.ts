import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureLibrary } from "../store/testFixtures";
import {
  ApiError,
  describeDetail,
  getHealth,
  getLibrary,
  simulate,
  type SimulationRequest,
} from "./client";
import { DEMO_UNAVAILABLE } from "./demoBackend";

const request = {} as SimulationRequest;

/** Replaces fetch for one test. */
const stubFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) =>
  vi.stubGlobal("fetch", vi.fn(impl));

/** fetch that never answers, until its signal aborts it. */
const hanging = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) =>
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
  );

/** The ApiError a call fails with. */
async function failure(call: Promise<unknown>): Promise<ApiError> {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("returns the JSON of a successful answer, sent as JSON", async () => {
    stubFetch(async () => Response.json({ status: "ok" }));
    await expect(getHealth()).resolves.toEqual({ status: "ok" });
    stubFetch(async (_url, init) => {
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
      return Response.json({ analysis: "op" });
    });
    await expect(simulate(request)).resolves.toEqual({ analysis: "op" });
  });

  it("turns FastAPI's validation errors into a readable message", async () => {
    stubFetch(async () =>
      Response.json(
        {
          detail: [
            { type: "missing", loc: ["body", "schematic"], msg: "Field required" },
            { type: "missing", loc: ["body", "analysis", "kind"], msg: "Field required" },
          ],
        },
        { status: 422 },
      ),
    );
    const e = await failure(simulate(request));
    expect(e).toMatchObject({ kind: "http", status: 422 });
    expect(e.message).toBe("schematic : Field required\nanalysis.kind : Field required");
  });

  it("keeps the status when the error has no JSON", async () => {
    stubFetch(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const e = await failure(simulate(request));
    expect(e).toMatchObject({ kind: "http", status: 502 });
    expect(e.message).toMatch(/HTTP 502/);
  });

  it("tells apart an unreachable backend, a timeout and a cancellation", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await failure(getHealth())).kind).toBe("unreachable");

    stubFetch(hanging);
    const timeout = await failure(simulate(request, { timeoutMs: 20 }));
    expect(timeout.kind).toBe("timeout");
    expect(timeout.message).toMatch(/pas répondu à temps \(1 s\)/);

    const controller = new AbortController();
    const call = simulate(request, { signal: controller.signal, timeoutMs: 10_000 });
    controller.abort();
    expect((await failure(call)).kind).toBe("aborted");
  });

  it("reports an answer that is not JSON", async () => {
    stubFetch(async () => new Response("pas du JSON", { status: 200 }));
    expect((await failure(getHealth())).kind).toBe("invalid");
  });
});

describe("API client in the online demo (mode demo)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers health and the library from the fixtures, without fetch", async () => {
    vi.stubEnv("MODE", "demo");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(getHealth()).resolves.toEqual({ status: "démo" });
    await expect(getLibrary()).resolves.toEqual(fixtureLibrary());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says that the demo cannot simulate", async () => {
    vi.stubEnv("MODE", "demo");
    const error = await failure(simulate(request));
    expect(error.kind).toBe("unreachable");
    expect(error.message).toBe(DEMO_UNAVAILABLE);
  });
});

describe("describeDetail", () => {
  it("handles a message, a list, and anything else", () => {
    expect(describeDetail("Not implemented yet")).toBe("Not implemented yet");
    expect(describeDetail([{ loc: ["body"], msg: "Invalid JSON" }])).toBe("Invalid JSON");
    expect(describeDetail([])).toBeNull();
    expect(describeDetail(undefined)).toBeNull();
  });
});
