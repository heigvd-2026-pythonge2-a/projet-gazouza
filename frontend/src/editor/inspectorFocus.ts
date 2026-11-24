/** Id of the properties panel, to move the focus to its first field. */
export const INSPECTOR_ID = "inspector";

/** Marks the field of the component's main value (resistance, capacitance, voltage…). */
export const VALUE_FIELD_ATTR = "data-value-field";

/** Names each field: the parameter's name, or `NAME_FIELD` for the component's SPICE name. */
export const FIELD_ATTR = "data-field";
export const NAME_FIELD = "@name";

/**
 * Sent on `window` before focusing the properties panel: the app shell leaves full screen so the
 * panel is visible (a hidden field cannot take the focus).
 */
export const SHOW_INSPECTOR_EVENT = "psice:show-inspector";

/**
 * Puts the focus on a field of the properties panel, if it shows one: the field of `param` when
 * set (null for the name), else the main value field when `value` is set and there is one, else
 * the first field. A text field gets its text selected, so typing replaces it.
 */
export function focusInspector({
  value = false,
  param,
}: { value?: boolean; param?: string | null } = {}) {
  window.dispatchEvent(new Event(SHOW_INSPECTOR_EVENT));
  // Wait for the panel to show the selected component and, if needed, for full screen to end.
  requestAnimationFrame(() => {
    const fields = `#${INSPECTOR_ID} input, #${INSPECTOR_ID} select, #${INSPECTOR_ID} textarea`;
    const named = param === undefined ? null : CSS.escape(param ?? NAME_FIELD);
    const field =
      (named !== null &&
        document.querySelector<HTMLElement>(`#${INSPECTOR_ID} [${FIELD_ATTR}="${named}"]`)) ||
      (value && document.querySelector<HTMLElement>(`#${INSPECTOR_ID} [${VALUE_FIELD_ATTR}]`)) ||
      document.querySelector<HTMLElement>(fields);
    field?.focus();
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
  });
}
