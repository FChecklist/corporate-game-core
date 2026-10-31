// Writes docs/REACTIONS_ORIGINAL.md from the pack itself. Run: bun tools/reactions-doc.ts
import { REACTIONS } from "../packages/ui/src/reactions";
const PAL = ["", "sun", "coral", "mint", "sky", "grape", "lime", "pink", "night"];
const rows = REACTIONS.map((r) => `| ${r.id} | ${r.text} | ${r.shape} | ${PAL[r.pal]} | ${r.anim}, tilt ${r.tilt} | ${r.event} |`).join("\n");
await Bun.write("docs/REACTIONS_ORIGINAL.md", `# Reaction pack: original work (0.8.0)

Everything in the Reaction pack was made for this product. Nothing is copied or traced from a sticker sheet, a stock asset, a licensed font or another product.

- **Shapes (8):** spiky burst, round pop, cloud puff, jagged zigzag, wobbly bubble, ribbon, starburst, drip. Each is a polygon computed by our own formula in \`tools/shapes.ts\` (alternating radii, sine lobes, edge steps) and written to \`reactions.css\` as \`clip-path\`. No images, no external fonts, no SVG from outside.
- **Colours (8 pairs):** sun, coral, mint, sky, grape, lime, pink, night. Each has a fill, an ink and a line colour; ink on fill is at least 4.5:1 (checked by \`tools/conformance.ts\`).
- **Lettering:** the system bold font in capitals, outlined in the pair's line colour with a hard offset shadow, tilted a few degrees (our choice per reaction).
- **Words:** our own phrases. \`tools/conformance.ts\` fails the build if a phrase or id is one of the words on the owner's do-not-copy list (the stock sheet), or is profane, or is an abbreviation.
- **Motions (10):** pop, shake, wobble, slide left, slide right, drop, zoom, spin, bounce, flip; plain CSS keyframes, small movements inside the corner strip.
- **Rules kept:** 2.2 s (2.6 s for finish and win), corner strip at most 25% of the width, one at a time with a queue of one, 15 s gap, at most 15 per 10 minutes of game time, personal vs shared, reduced motion shows the same word still, Organizer can switch it off.

Each reaction is one choice of shape + colour + phrase + motion:

| id | phrase | shape | colour | motion | event |
|---|---|---|---|---|---|
${rows}
`);
console.log(REACTIONS.length, "rows");
