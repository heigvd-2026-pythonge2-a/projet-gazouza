import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { LibraryGate } from "./editor";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    {/* The app is shown once the component library has come from the backend. */}
    <LibraryGate>
      <App />
    </LibraryGate>
  </StrictMode>,
);
