import { simulateTenMinutes } from "../packages/ui/src/reactions-demo";
const { rows, shown } = simulateTenMinutes();
for (const r of rows) console.log(String(r.t).padStart(4) + "s", r.id.padEnd(18), r.who.padEnd(3), r.verdict);
console.log(`${shown.length} reactions shown in 10 minutes: ${shown.join(", ")}`);
