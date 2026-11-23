// Thin client for the FastAPI backend. Types come from src/api/schema.gen.ts,
// generated from the Pydantic contract: never edit that file by hand, run `pnpm gen:api`.
import type { components } from "./schema.gen";

export type Schematic = components["schemas"]["Schematic"];
export type NetlistResult = components["schemas"]["NetlistResult"];
export type SimulationRequest = components["schemas"]["SimulationRequest"];
export type SimulationResult = components["schemas"]["SimulationResult"];
export type LibraryComponent = components["schemas"]["LibraryComponent"];

/** Longest wait for a response by default, in ms (a simulation can take a while). */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** Longest wait for the health check, in ms: the backend answers it at once when it is up. */
const HEALTH_TIMEOUT_MS = 5_000;

/**
 * Why a request failed:
 * - "unreachable": no answer at all (backend not started, network error);
 * - "timeout": no answer within the time limit;
 * - "aborted": cancelled by the caller (e.g. the user stopped a simulation);
 * - "http": the backend answered with an error status (`status`, and its `detail`);
 * - "invalid": the backend answered, but not with the expected JSON.
 */
export type ApiErrorKind = "unreachable" | "timeout" | "aborted" | "http" | "invalid";

/** A failed request. `message` is in French and can be shown to the user as is. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, for kind "http". */
  readonly status: number | null;
  /** FastAPI's `detail` (a message, or the list of validation errors), for kind "http". */
  readonly detail: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; detail?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.detail = options.detail;
  }
}

export interface RequestOptions {
  /** Cancels the request (it then fails with an `ApiError` of kind "aborted"). */
  signal?: AbortSignal;
  /** Time limit in ms (default `DEFAULT_TIMEOUT_MS`). */
  timeoutMs?: number;
}

/** Readable text for FastAPI's `detail`: a message, or a list of validation errors. */
export function describeDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;
  const lines = detail.map((d: unknown) => {
    if (typeof d !== "object" || d === null) return String(d);
    const { loc, msg } = d as { loc?: unknown; msg?: unknown };
    const where = Array.isArray(loc) ? loc.filter((p) => p !== "body").join(".") : "";
    return where ? `${where} : ${String(msg)}` : String(msg);
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const what = `${init.method ?? "GET"} ${path}`;
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error: unknown) {
    if (signal?.aborted) throw new ApiError("aborted", "Requête annulée.", { cause: error });
    if (timeout.aborted) {
      throw new ApiError(
        "timeout",
        `Le serveur de simulation n'a pas répondu à temps (${Math.ceil(timeoutMs / 1000)} s).`,
        { cause: error },
      );
    }
    throw new ApiError("unreachable", "Le serveur de simulation est injoignable.", {
      cause: error,
    });
  }

  if (!response.ok) {
    let detail: unknown = undefined;
    try {
      detail = ((await response.json()) as { detail?: unknown }).detail;
    } catch {
      // Not JSON: only the status is known.
    }
    const text = describeDetail(detail);
    throw new ApiError(
      "http",
      text ?? `Le serveur de simulation a renvoyé une erreur (HTTP ${response.status}).`,
      { status: response.status, detail },
    );
  }
  try {
    return (await response.json()) as T;
  } catch (error: unknown) {
    throw new ApiError("invalid", `Réponse illisible du serveur de simulation (${what}).`, {
      cause: error,
    });
  }
}

export const getHealth = (options?: RequestOptions) =>
  request<{ status: string }>("/api/health", {}, { timeoutMs: HEALTH_TIMEOUT_MS, ...options });

/** The component library (pins, parameters, labels), sorted by type. */
export const getLibrary = (options?: RequestOptions) =>
  request<LibraryComponent[]>("/api/library", {}, options);

export const generateNetlist = (body: SimulationRequest, options?: RequestOptions) =>
  request<NetlistResult>("/api/netlist", { method: "POST", body: JSON.stringify(body) }, options);

export const simulate = (body: SimulationRequest, options?: RequestOptions) =>
  request<SimulationResult>(
    "/api/simulate",
    { method: "POST", body: JSON.stringify(body) },
    options,
  );
