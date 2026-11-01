// Load harness: N participants join and play against the engine reducers in-process (no network, no storage). Usage: bun tools/load.ts [1000 10000 100000]
// Reports time, throughput and memory per phase. A phase is skipped past a cap it is not meant for (reported as such).
import { newClock, start, sha256Hex, type Clock } from "../packages/core/src";
import { bingoRules, MAX_NUMBER, settleFromLog, type Card } from "../packages/bingo/src";
import { luckyDrawRules } from "../packages/luckydraw/src";
const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const SIZES = sizes.length ? sizes : [1_000, 10_000, 100_000];
const mb = (): number => { Bun.gc(true); return Math.round(process.memoryUsage().heapUsed / 1e5) / 10; };
const rows: string[] = [];
const report = (phase: string, n: number, ms: number, heap0: number, note = ""): void => {
  const line = `${phase.padEnd(26)} n=${String(n).padStart(7)} ${String(Math.round(ms)).padStart(8)} ms ${String(Math.round((n / Math.max(ms, 1)) * 1000)).padStart(10)}/s heap +${(mb() - heap0).toFixed(1)} MB ${note}`;
  rows.push(line); console.log(line);
};
// a valid card from a seed: column c takes 5 distinct numbers (4 for N) from its range
const cardFor = (seed: number): Card => {
  let x = seed * 2654435761 >>> 0; const rnd = (): number => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const cols = [0, 1, 2, 3, 4].map((c) => { const pool = Array.from({ length: 15 }, (_, i) => c * 15 + i + 1); for (let i = 14; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; } return pool.slice(0, c === 2 ? 4 : 5); });
  return [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => (c === 2 ? (r === 2 ? null : cols[2]![r < 2 ? r : r - 1]!) : cols[c]![r]!)));
};
const running = (): Clock => start(newClock());
const order = Array.from({ length: MAX_NUMBER }, (_, i) => i + 1).sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));
for (const n of SIZES) {
  console.log(`--- ${n} participants`);
  // Lucky Draw: N registrations through the reducer, then one draw
  {
    const h0 = mb(); const t0 = performance.now(), clock = running();
    let st = luckyDrawRules.init({ eid: "G", winners: 10, draw: "auto", closeAt: 1e12, idKind: "emp", cap: 100_000 }, [], 0);
    for (let i = 0; i < n; i += 1000) st = luckyDrawRules.step(st, { type: "registerMany", players: Array.from({ length: Math.min(1000, n - i) }, (_, j) => `E${i + j}`) }, 1, clock).state;
    report("luckydraw register (x1000)", n, performance.now() - t0, h0, `entries=${st.entries.length}`);
    if (n <= 10_000) { // one event at a time: each copies the list, so it grows with n squared (use registerMany or a store index in production)
      const ta = performance.now(); let one = luckyDrawRules.init({ eid: "G", winners: 10, draw: "auto", closeAt: 1e12, idKind: "emp", cap: 100_000 }, [], 0);
      for (let i = 0; i < n; i++) one = luckyDrawRules.step(one, { type: "register", player: `E${i}` }, 1, clock).state;
      report("luckydraw register (one)", n, performance.now() - ta, h0, `entries=${one.entries.length}`);
    }
    const t1 = performance.now(); const r = luckyDrawRules.step(st, { type: "tick", beacon: "ab12" }, 2e12, clock);
    report("luckydraw draw", n, performance.now() - t1, h0, `winners=${r.state.drawn?.length}`);
  }
  // Bingo: N seats, cards, init (grouping), 75 calls through the reducer
  {
    const h0 = mb(); const ids = Array.from({ length: n }, (_, i) => `${i + 1}x${sha256Hex(String(i)).slice(0, 8)}`);
    const t0 = performance.now(); const cards: Record<string, Card> = {}; ids.forEach((id, i) => { cards[id] = cardFor(i + 1); });
    report("bingo make cards", n, performance.now() - t0, h0);
    const t1 = performance.now(); const clock = running();
    let st = bingoRules.init({ order, cards, eid: "G" }, ids, 0);
    report("bingo init (grouping)", n, performance.now() - t1, h0);
    const t2 = performance.now(); let now = 120_000, wins = 0;
    for (let k = 0; k < MAX_NUMBER && !st.over; k++, now += 9_000) { const r = bingoRules.step(st, { type: "tick" }, now, clock); st = r.state; wins += r.out.filter((o) => o.kind === "win").length; }
    report("bingo 75 calls", n, performance.now() - t2, h0, `wins=${wins} over=${st.over}`);
    if (n <= 10_000) { const t3 = performance.now(); const s = settleFromLog("G", ids.map((id) => ({ id, cards: [cards[id]!] })), order, { line: 1, corners: 1, x: 1, blackout: 1 }); report("bingo settleFromLog", n, performance.now() - t3, h0, `lines=${s.length}`); }
    else console.log("bingo settleFromLog skipped past 10k (init does the same work once)");
  }
}
