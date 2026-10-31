// Regenerates the three scripted constants of packages/beacon/src/demo-script.ts for the CURRENT ticket generator:
//   the demo ticket (seat 1 of "DEMO") -> its four corners -> a 6-number sequence that completes the corners on the 6th call -> "public random" strings that make the real pickNumber() return them.
// Run: bun tools/make-demo-script.ts   (prints the three lines to paste; the test packages/beacon/test/demo-script.test.ts proves them with the real game code)
import { ticketsFor } from "../packages/beacon/src/game";
import { roundEid } from "../packages/beacon/src/config";
import { pickNumber } from "../packages/beacon/src/index";
import { ticketNumbers, patternSets } from "../packages/shared/src/ticket";
import { DEMO_EID, DEMO_PID } from "../packages/beacon/src/demo-script";

const ticket = ticketsFor(roundEid(DEMO_EID, 1), DEMO_PID, 1)[0]!;
const corners = [...patternSets(ticket, "corners")[0]!].sort((a, b) => a - b);
const others = ticketNumbers(ticket).filter((n) => !corners.includes(n)).sort((a, b) => a - b);
// order: corner, other, corner, corner, other, corner  (the corners complete only on the 6th call)
const seq = [corners[0]!, others[1]!, corners[3]!, corners[1]!, others[6]!, corners[2]!];
const rand: string[] = []; const called: number[] = [];
for (let k = 0; k < 6; k++) {
  let found = "";
  for (let c = 0; c < 1_000_000 && !found; c++) { const cand = ("dedf" + k.toString(16) + "d" + c.toString(16).padStart(4, "0")).padEnd(64, "0"); if (pickNumber(DEMO_EID, k, cand, called) === seq[k]) found = cand; }
  if (!found) throw new Error("no randomness found for call " + k);
  rand.push(found); called.push(seq[k]!);
}
console.log(`ticket numbers: ${ticketNumbers(ticket).sort((a, b) => a - b).join(",")}`);
console.log(`export const DEMO_SEQ = [${seq.join(", ")}] as const;`);
console.log(`export const DEMO_CORNERS = [${[seq[0], seq[1 + 1], seq[3], seq[5]].join(", ")}] as const;`);
console.log("export const DEMO_RAND: readonly string[] = [\n" + rand.map((r) => `  "${r}",`).join("\n") + "\n];");
