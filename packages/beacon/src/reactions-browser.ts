// Bundled to apps/web/public/reactions.js (window.CBReact): the shared text-only reaction pack from the common engine.
// Each word stays on screen for about 2.5 seconds (the pack's own time is shorter), in the pack's top strip, never over the main area.
import { react, setReactionMode, getReactionMode } from "../../../vendor/game-core/packages/ui/src/reactions";
const SHOW_MS = 2500;
function show(id: string): boolean {
  const ok = react(id);
  const layer = document.getElementById("rx-layer");
  const el = ok && layer ? (layer.lastElementChild as HTMLElement | null) : null;
  if (el) { const c = el.cloneNode(true) as HTMLElement; c.style.setProperty("--rxd", SHOW_MS + "ms"); el.replaceWith(c); setTimeout(() => c.remove(), SHOW_MS + 100); }
  return ok;
}
(globalThis as any).CBReact = { react: show, setReactionMode, getReactionMode };
