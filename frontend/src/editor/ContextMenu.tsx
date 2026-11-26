import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { COLORS, UI } from "./theme";

export interface MenuItem {
  label: string;
  /** Keyboard shortcut shown on the right, so the user learns it. */
  shortcut?: string;
  /** Keys (`KeyboardEvent.key`) that run this item while the menu is open. */
  keys?: string[];
  disabled?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  /** Position of the click, relative to the positioned parent of the menu. */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/**
 * Menu opened at the mouse. Keyboard: arrows, Home / End, Enter, Escape, or an item's shortcut.
 * Closes on Escape, Tab, a press or the wheel outside it, or once an item is chosen.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu inside its parent (the canvas): open it up or left when there is no room.
  useLayoutEffect(() => {
    const menu = ref.current;
    const parent = menu?.offsetParent as HTMLElement | null;
    if (!menu || !parent) return;
    const fit = (at: number, size: number, room: number) =>
      at + size <= room ? at : Math.max(0, Math.min(at - size, room - size));
    setPosition({
      left: fit(x, menu.offsetWidth, parent.clientWidth),
      top: fit(y, menu.offsetHeight, parent.clientHeight),
    });
  }, [x, y]);

  const enabled = items.flatMap((item, i) => (item.disabled ? [] : [i]));

  // Focus the first item; give the focus back when the menu closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = enabled[0];
    if (first !== undefined) buttons.current[first]?.focus();
    else ref.current?.focus();
    return () => previous?.focus?.();
    // Only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    onClose();
    item.onSelect();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The editor's shortcuts must not also see these keys (Escape would clear the selection).
    e.stopPropagation();
    const current = enabled.indexOf(buttons.current.indexOf(e.target as HTMLButtonElement));
    const focus = (k: number) => {
      const i = enabled[(k + enabled.length) % enabled.length];
      if (i !== undefined) buttons.current[i]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        focus(current + 1);
        break;
      case "ArrowUp":
        focus(current < 0 ? -1 : current - 1);
        break;
      case "Home":
        focus(0);
        break;
      case "End":
        focus(-1);
        break;
      case "Escape":
      case "Tab":
        onClose();
        break;
      default: {
        const item = items.find((it) => it.keys?.includes(e.key));
        if (!item || e.ctrlKey || e.metaKey || e.altKey) return;
        choose(item);
      }
    }
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "absolute",
        left: position.left,
        top: position.top,
        zIndex: 10,
        minWidth: 180,
        padding: 4,
        background: UI.surface,
        border: `1px solid ${UI.border}`,
        borderRadius: 6,
        boxShadow: `0 4px 12px ${UI.shadow}`,
        fontSize: 13,
        outline: "none",
      }}
    >
      {items.map((item, i) => (
        <MenuButton
          key={item.label}
          item={item}
          buttonRef={(el) => {
            buttons.current[i] = el;
          }}
          onChoose={() => choose(item)}
        />
      ))}
    </div>
  );
}

function MenuButton(props: {
  item: MenuItem;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onChoose: () => void;
}) {
  const { item, buttonRef, onChoose } = props;
  const [active, setActive] = useState(false);
  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      aria-keyshortcuts={item.shortcut}
      onClick={onChoose}
      // The focus follows the mouse, so the highlighted item is always the one Enter runs.
      onMouseEnter={(e) => e.currentTarget.focus()}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        display: "flex",
        width: "100%",
        gap: 24,
        padding: "5px 10px",
        border: 0,
        borderRadius: 4,
        background: active ? UI.activeBackground : "transparent",
        color: item.disabled ? UI.faint : COLORS.symbol,
        font: "inherit",
        textAlign: "left",
        cursor: item.disabled ? "default" : "pointer",
        outline: "none",
      }}
    >
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.shortcut && <span style={{ color: UI.muted }}>{item.shortcut}</span>}
    </button>
  );
}
