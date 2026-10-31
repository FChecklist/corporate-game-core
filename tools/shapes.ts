// Draws the eight original reaction shapes as polygons (percent of the box) from our own formulas and writes them into reactions.css between the shapes markers.
// Run: bun tools/shapes.ts. Nothing here is traced from any sticker sheet or stock asset.
const pt = (x: number, y: number): string => `${x.toFixed(1)}% ${y.toFixed(1)}%`;
const radial = (n: number, r: (i: number, a: number) => number, off = -Math.PI / 2): string[] =>
  Array.from({ length: n }, (_, i) => { const a = off + (i / n) * 2 * Math.PI, k = r(i, a); return pt(50 + k * Math.cos(a), 50 + k * Math.sin(a)); });
const SHAPES: Record<string, string[]> = {
  burst: radial(24, (i) => (i % 2 ? 31 : 50)),                                  // spiky burst: 12 sharp spikes
  pop: radial(36, () => 49),                                                    // round pop
  puff: radial(60, (_, a) => 41 + 9 * Math.abs(Math.sin(3 * a))),               // cloud puff: six soft lobes
  zigzag: [...Array.from({ length: 11 }, (_, i) => pt(i * 10, i % 2 ? 14 : 0)), ...Array.from({ length: 11 }, (_, i) => pt(100 - i * 10, i % 2 ? 86 : 100))], // jagged top and bottom edges
  wobble: radial(48, (_, a) => 44 + 5 * Math.sin(5 * a + 1)),                   // wobbly bubble
  ribbon: ["4% 12%", "96% 12%", "100% 12%", "91% 50%", "100% 88%", "96% 88%", "4% 88%", "0% 88%", "9% 50%", "0% 12%"], // banner with forked ends
  star: radial(20, (i) => (i % 2 ? 36 : 50)),                                   // starburst: ten points, wide inner body for the word
  drip: ["0% 0%", "100% 0%", "100% 78%", "92% 78%", "88% 100%", "84% 78%", "62% 78%", "58% 92%", "54% 78%", "32% 78%", "28% 100%", "24% 78%", "0% 78%"], // flat top, three drips
};
const css = Object.entries(SHAPES).map(([k, v]) => `.rx.sh-${k}::before{clip-path:polygon(${v.join(",")})}`).join("\n");
const p = "packages/ui/src/reactions.css", s = await Bun.file(p).text();
const a = s.indexOf("/* shapes:start */"), b = s.indexOf("/* shapes:end */");
await Bun.write(p, s.slice(0, a) + "/* shapes:start */\n" + css + "\n" + s.slice(b));
console.log(`${Object.keys(SHAPES).length} shapes written to ${p}`);
