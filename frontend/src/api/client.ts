// Thin client for the FastAPI backend. Types come from src/api/schema.gen.ts,
// generated from the Pydantic contract: never edit that file by hand, run `pnpm gen:api`.
import type { components } from "./schema.gen";

export type Schematic = components["schemas"]["Schematic"];
export type NetlistResult = components["schemas"]["NetlistResult"];
export type SimulationRequest = components["schemas"]["SimulationRequest"];
export type SimulationResult = components["schemas"]["SimulationResult"];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const getHealth = () => request<{ status: string }>("/api/health");

export const generateNetlist = (body: SimulationRequest) =>
  request<NetlistResult>("/api/netlist", { method: "POST", body: JSON.stringify(body) });

export const simulate = (body: SimulationRequest) =>
  request<SimulationResult>("/api/simulate", { method: "POST", body: JSON.stringify(body) });
