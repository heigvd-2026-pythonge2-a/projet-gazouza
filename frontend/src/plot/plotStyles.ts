import type { CSSProperties } from "react";

import { UI } from "../store";

export const PLOT_TABLE_CELL: CSSProperties = {
  padding: "3px 8px",
  borderBottom: `1px solid ${UI.border}`,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
