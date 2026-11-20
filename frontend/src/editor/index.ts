// Public API of the editor module: the pieces the app shell lays out.
export { SchematicCanvas } from "./Editor";
export { Inspector } from "./Inspector";
export { SHOW_INSPECTOR_EVENT } from "./inspectorFocus";
export { Palette } from "./Palette";
export { StatusBar } from "./StatusBar";
export { UndoRedoButtons } from "./UndoRedoButtons";

// Development only: psiceDemo("rc_tran") or ?demo=rc_tran loads a fixture with its result.
if (import.meta.env.DEV) void import("./demo").then((demo) => demo.installDemo());
