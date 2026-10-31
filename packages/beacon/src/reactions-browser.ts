// Bundled to apps/web/public/reactions.js (window.CBReact): the shared text-only reaction pack from the common engine.
import { react, setReactionMode, getReactionMode } from "../../../vendor/game-core/packages/ui/src/reactions";
(globalThis as any).CBReact = { react, setReactionMode, getReactionMode };
