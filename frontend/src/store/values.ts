// Checks of the values typed in the properties panel (#122), shown while typing. Same syntax as
// the netlist module (backend/app/netlist/values.py), which reports the same errors (BAD_VALUE,
// MILLI_SUFFIX) at simulation time: these checks only warn the user earlier. Texts in French.

import type { EditorDoc } from "./document";
import { getDef, visibleParams } from "./library";

/** Units allowed after the suffix, ignored like in SPICE ("1kOhm", "10uF"). */
const UNITS = ["ohm", "Ω", "hz", "v", "a", "s", "h", "f"];

/** A SPICE number: number, optional exponent, optional suffix, optional unit. */
const VALUE = new RegExp(
  `^(?<number>[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)(?<suffix>meg|[fpnumkgt])?(?<unit>${UNITS.join("|")})?$`,
  "i",
);

export interface ValueProblem {
  /** An error makes the simulation fail; a warning is probably not what the user meant. */
  level: "error" | "warning";
  message: string;
}

const HINT = "utilise un nombre avec un suffixe (1k, 10u, 2.2Meg)";

/**
 * What is wrong with a value typed for a parameter whose unit is `unit` ("Ω", "F"...), or null if
 * it is fine.
 */
export function valueProblem(text: string, unit = ""): ValueProblem | null {
  const value = text.trim();
  if (value === "") return { level: "error", message: "La valeur est obligatoire." };
  if (value.includes(",")) {
    const fixed = value.replace(",", ".");
    const suggestion = VALUE.test(fixed) ? ` : écris « ${fixed} »` : "";
    return {
      level: "error",
      message: `Le séparateur décimal est le point, pas la virgule${suggestion}.`,
    };
  }
  const match = VALUE.exec(value);
  if (!match?.groups) return { level: "error", message: `Valeur non reconnue : ${HINT}.` };
  const { number, suffix, unit: typedUnit } = match.groups;
  if (suffix === "M") {
    return {
      level: "warning",
      message: `« M » veut dire milli en SPICE. Pour méga, écris « ${number}Meg${typedUnit ?? ""} ».`,
    };
  }
  if (unit === "F" && suffix?.toLowerCase() === "f" && !typedUnit) {
    return {
      level: "warning",
      message: `« ${value} » se lit ${number} femto (fF). Pour des farads, écris « ${number} ».`,
    };
  }
  return null;
}

/** A value of the document that cannot be simulated. */
export interface InvalidValue {
  comp: string;
  /** SPICE name of the component (e.g. "R1"). */
  name: string;
  param: string;
  label: string;
  message: string;
}

/** The values of the parameters shown for each component that are errors (not warnings). */
export function invalidValues(doc: EditorDoc): InvalidValue[] {
  return doc.components.flatMap((c) => {
    const def = getDef(c.type);
    return visibleParams(def, c.params).flatMap((p) => {
      if (p.kind !== "value") return [];
      const problem = valueProblem(c.params[p.name] ?? "", p.unit);
      return problem?.level === "error"
        ? [
            {
              comp: c.id,
              name: c.name ?? c.id,
              param: p.name,
              label: p.label,
              message: problem.message,
            },
          ]
        : [];
    });
  });
}
