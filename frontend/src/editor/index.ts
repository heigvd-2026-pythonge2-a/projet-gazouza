// Public API of the editor module: the pieces the app shell lays out.
export { AnimateButton } from "./AnimationControls";
export { SchematicCanvas } from "./Editor";
export { saveRescueCopy } from "./fileActions";
export { Inspector } from "./Inspector";
export { LibraryGate } from "./LibraryGate";
export { SHOW_INSPECTOR_EVENT } from "./inspectorFocus";
export { Palette } from "./Palette";
export { StatusBar } from "./StatusBar";
export { EditorToolbar } from "./Toolbar";

// Development only: psiceDemo("rc_tran") or ?demo=rc_tran loads a fixture with its result.
// It waits for the component library, like the editor itself.
if (import.meta.env.DEV) void import("./demo").then((demo) => demo.installDemo());
