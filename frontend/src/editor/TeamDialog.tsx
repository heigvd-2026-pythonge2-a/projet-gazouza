// "Invoquer l'équipe" and "À propos de Psice" (#363): one window with the four authors, their
// roles, the version, the licence and the repository. Ctrl+Shift+E opens it with the names
// arriving one by one; the status bar button opens it without the animation. Escape or a click
// closes it.

import { useEffect } from "react";
import { createPortal } from "react-dom";

import { version } from "../../package.json";
import { REPOSITORY_URL, TEAM } from "./team";
import { COLORS, UI } from "./theme";

// Each name rises after the previous one, then the roles fade in. Nothing moves for those who
// asked their system for less motion.
const ANIMATION_CSS = `
@keyframes psice-team-rise {
  from { opacity: 0; transform: translateY(12px) scale(0.96); }
  to { opacity: 1; transform: none; }
}
@keyframes psice-team-spark {
  0% { opacity: 0; transform: scale(0.4); }
  60% { opacity: 1; transform: scale(1.25); }
  100% { opacity: 1; transform: none; }
}
.psice-team-animated .psice-team-member {
  animation: psice-team-rise 420ms cubic-bezier(0.2, 0.8, 0.3, 1.2) both;
}
.psice-team-animated .psice-team-logo { animation: psice-team-spark 500ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .psice-team-animated .psice-team-member,
  .psice-team-animated .psice-team-logo { animation: none; }
}
`;

/** The big P of the logo, ending on a circuit terminal (assets/brand/psice-icon-small.svg). */
function Logo() {
  return (
    <svg
      className="psice-team-logo"
      viewBox="430 327 170 284"
      width={30}
      height={50}
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      <path
        d="M490.01 557.00V357.80H564.01A62.99 62.99 0 0 1 564.01 483.78H490.01"
        fill="none"
        stroke={COLORS.text}
        strokeWidth={60}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="490.01" cy="579.00" r="30" fill={COLORS.selected} />
    </svg>
  );
}

export function TeamDialog({ animated, onClose }: { animated: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Keep the editor's shortcuts off while the window is shown: its Escape would also clear
      // the selection.
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // In the page's body, like the unsaved changes question (CloseDialog.tsx): the status bar
  // clips what overflows it.
  return createPortal(
    <div
      data-testid="team-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.3)",
        // Outside the app's root, which sets it (App.tsx).
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        cursor: "pointer",
      }}
    >
      <style>{ANIMATION_CSS}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="psice-team-title"
        className={animated ? "psice-team-animated" : undefined}
        style={{
          width: 440,
          maxWidth: "calc(100vw - 32px)",
          padding: "18px 20px 14px",
          background: UI.surface,
          border: `1px solid ${UI.border}`,
          borderRadius: 8,
          boxShadow: `0 8px 24px ${UI.shadow}`,
          fontSize: 13,
          color: COLORS.text,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Logo />
          <div>
            <h2 id="psice-team-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {animated ? "L'équipe Psice" : "À propos de Psice"}
            </h2>
            <div style={{ color: UI.muted, fontSize: 12 }}>
              Simulateur de circuits pour débutants · version {version}
            </div>
          </div>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {TEAM.map((member, i) => (
            <li
              key={member.name}
              className="psice-team-member"
              style={{
                padding: "6px 0",
                borderTop: i === 0 ? "none" : `1px solid ${UI.border}`,
                animationDelay: `${150 + i * 220}ms`,
              }}
            >
              <div style={{ fontWeight: 600 }}>{member.name}</div>
              <div style={{ color: UI.muted, fontSize: 12 }}>{member.role}</div>
            </li>
          ))}
        </ul>
        <p style={{ margin: "12px 0 0", color: UI.muted, fontSize: 11, lineHeight: 1.5 }}>
          Projet HEIG-VD, 2026. Logiciel libre sous licence MIT : vous pouvez le copier et le
          modifier, à condition de garder les noms des auteurs.
          <br />
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            // The link opens the repository; the click must not also close the window first.
            onClick={(e) => e.stopPropagation()}
            style={{ color: COLORS.selected }}
          >
            {REPOSITORY_URL.replace("https://", "")}
          </a>
        </p>
        <div style={{ marginTop: 8, textAlign: "right", color: UI.muted, fontSize: 11 }}>
          Échap ou clic pour fermer
        </div>
      </div>
    </div>,
    document.body,
  );
}
