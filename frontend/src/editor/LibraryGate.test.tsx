import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLibrary } from "../store";
import { fixtureLibrary } from "../store/testFixtures";
import { LibraryGate } from "./LibraryGate";

const answer = (ok: boolean) =>
  ok
    ? new Response(JSON.stringify(fixtureLibrary()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    : new Response("down", { status: 502 });

beforeEach(() => setLibrary([])); // as at startup: nothing received yet
afterEach(() => {
  setLibrary(fixtureLibrary());
  vi.unstubAllGlobals();
});

describe("LibraryGate", () => {
  it("shows the app once the library has come from the backend", async () => {
    const fetchMock = vi.fn(async () => answer(true));
    vi.stubGlobal("fetch", fetchMock);
    render(<LibraryGate>éditeur prêt</LibraryGate>);

    expect(screen.getByText(/Chargement de la bibliothèque/)).toBeInTheDocument();
    expect(await screen.findByText("éditeur prêt")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/library", expect.anything());
  });

  it("says when the backend does not answer, and tries again on demand", async () => {
    const user = userEvent.setup();
    let backendUp = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(backendUp)),
    );
    render(<LibraryGate>éditeur prêt</LibraryGate>);

    expect(await screen.findByRole("alert")).toHaveTextContent("le simulateur ne répond pas");
    expect(screen.queryByText("éditeur prêt")).not.toBeInTheDocument();

    backendUp = true;
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("éditeur prêt")).toBeInTheDocument();
  });
});
