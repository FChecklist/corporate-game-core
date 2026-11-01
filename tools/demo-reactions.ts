// Builds docs/reactions-demo.html: one page with every reaction and a Play button for each. Run: bun tools/demo-reactions.ts
import { REACTIONS } from "../packages/ui/src/reactions";
const css = ["tokens.css", "components.css", "reactions.css"].map((f) => Bun.file(`packages/ui/src/${f}`).text());
const built = await Bun.build({ entrypoints: ["tools/demo-entry.ts"], minify: true, format: "iife", target: "browser" });
const js = await built.outputs[0]!.text();
const cards = REACTIONS.map((r) => `<div class="card"><b>${r.text}</b><span class="m">${r.id} - ${r.event}<br>${r.games.join(", ")}</span><button class="btn" type="button" data-id="${r.id}">Play ${r.id}</button></div>`).join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reaction pack demo</title><style>${(await Promise.all(css)).join("\n")}
body{padding:0 16px 40px}h1{font:700 22px var(--serif)}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.card{background:var(--surface);border:1px solid #0002;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px}.card b{font-size:18px}.m{font-size:12px;color:#555;min-height:32px}.btn{min-height:var(--tap)}
</style></head><body><h1>Reaction pack (${REACTIONS.length})</h1><div class="bar"><label>Organizer setting <select id="mode"><option>full</option><option>reduced</option><option>off</option></select></label><button class="btn" id="all" type="button">Play all, one by one</button></div><div class="grid">${cards}</div><script>${js}
var rx=CGC.createReactions("me");document.querySelectorAll("[data-id]").forEach(function(b){b.onclick=function(){rx.preview(b.dataset.id)}});
document.getElementById("mode").onchange=function(e){rx.setMode(e.target.value)};
document.getElementById("all").onclick=function(){var i=0;(function n(){if(i<CGC.REACTIONS.length){rx.preview(CGC.REACTIONS[i++].id);setTimeout(n,2700)}})()};
</script></body></html>`;
await Bun.write("docs/reactions-demo.html", html);
console.log(`docs/reactions-demo.html ${html.length} bytes; css+js pack ${(await Promise.all(css)).at(-1)!.length + js.length} bytes`);
