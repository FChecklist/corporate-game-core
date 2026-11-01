// The shared page renderer for Privacy, Terms, storage notice and grievance, and for a game's rules. The words come from packages/wording (one common text);
// only the rules of a game differ between games, and they come from the game's rules book. A site never keeps its own copy of the common text.
import { LEGAL, DOCUMENTS, DOC_GAMES, TERMS_VERSION, TERMS_DATE, type LegalKind, type DocKind, type DocGameId } from "../../wording/src";
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** One section of the common text, e.g. renderLegal("privacy"). With no kind: all of them, in order. */
export function renderLegal(kind?: LegalKind): string {
  return LEGAL.filter((s) => !kind || s.id === kind)
    .map((s) => `<section class="legal" id="${s.id}"><h2>${esc(s.title)}</h2>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`).join("");
}
/** A game's rules page from its rules book (plain markdown: "# title", "## heading", numbered or dashed lines, paragraphs). The rules are the only text that differs between games. */
export function renderRules(markdown: string): string {
  const out: string[] = []; let list: string[] = [];
  const flush = (): void => { if (list.length) { out.push(`<ol class="rules">${list.join("")}</ol>`); list = []; } };
  const inline = (s: string): string => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  for (const raw of markdown.split("\n")) {
    const l = raw.trim(), h = /^(#{1,3})\s+(.*)$/.exec(l), n = /^(?:\d+[a-z]?\.|-)\s+(.*)$/.exec(l);
    if (h) { flush(); out.push(`<h${h[1]!.length + 1}>${inline(h[2]!)}</h${h[1]!.length + 1}>`); }
    else if (n) list.push(`<li>${inline(n[1]!)}</li>`);
    else if (l) { flush(); out.push(`<p>${inline(l)}</p>`); }
  }
  flush();
  return `<article class="rules-page">${out.join("")}</article>`;
}
/** One of the four common documents: Part A (common) first, then Part B with one short heading per game (all games, or only `game`). A site links to DOC_URLS and may render this; it keeps no copy. */
export function renderDocument(kind: DocKind, game?: DocGameId): string {
  const d = DOCUMENTS[kind], sec = (s: { heading: string; paragraphs: string[] }): string => `<section><h3>${esc(s.heading)}</h3>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`;
  const b = DOC_GAMES.filter((g) => !game || g.id === game).map((g) => `<section id="${kind}-${g.id}"><h3>${esc(g.name)}</h3>${d.partB[g.id].map((p) => `<p>${esc(p)}</p>`).join("")}</section>`).join("");
  return `<article class="legal-doc" id="${kind}" data-version="${TERMS_VERSION}"><h1>${esc(d.title)}</h1><p class="version">Version ${TERMS_VERSION} (${esc(TERMS_DATE)})</p><div class="part-a">${d.partA.map(sec).join("")}</div><div class="part-b"><h2>Game by game</h2>${b}</div></article>`;
}
