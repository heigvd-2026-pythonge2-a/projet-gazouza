/** Id of the properties panel, to move the focus to its first field. */
export const INSPECTOR_ID = "inspector";

/** Puts the focus on the first field of the properties panel, if it shows one. */
export function focusInspector() {
  document.querySelector<HTMLElement>(`#${INSPECTOR_ID} input, #${INSPECTOR_ID} select`)?.focus();
}
