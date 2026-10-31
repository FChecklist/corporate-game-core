// Luck by Chance simulation: random complete games through luckRules (docs/LUCK_RULES_BOOK.md). Usage: bun tools/sim/luck.ts --games N --seed S [--from I]
import { luckRules, pointsFor, ranking, ROUNDS, GAME_MS, WAITING_ROOM_S, type LuckState } from "../../packages/luck/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { canJoinLate, gameNow, newClock, pause, resume, start, withLateWindow } from "../../packages/core/src";
import { badNumber, fates, lateJoinExpected, int, pick, players, playerCount, run, shuffle } from "./common";

const POS = ["1st", "2nd", "3rd", "4th", "5th"];
run("luck", "tools/sim/luck.ts", (r, c) => {
  const n = playerCount(r), ids = players(n); c.players = n;
  const fate = fates(r, ids);
  let s = luckRules.init({ fate }, ids, 0);
  let clk = start(newClock()), wall = 0, paused = 0;
  const wins: { player: string; position: string }[] = [];
  // independent ledger of what each player must have
  const led: Record<string, { points: number; exact: number; fives: number; reachedAt: number }> = {};
  for (const p of ids) led[p] = { points: 0, exact: 0, fives: 0, reachedAt: 0 };
  const missRate = pick(r, [0, 0.05, 0.3, 0.9]), seen: string[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    // random pause (Organizer/Host only); a participant's try changes nothing
    if (r() < 0.15) {
      const before = JSON.stringify(clk);
      if (JSON.stringify(pause(clk, "participant", wall)) !== before || JSON.stringify(pause(clk, "cohost", wall)) !== before) c.v("a non-controller paused the clock");
      clk = pause(clk, pick(r, ["organizer", "host"] as const), wall);
      const target = int(r, 1, 6), press: Record<string, number | undefined> = {}; for (const p of ids) press[p] = int(r, 1, 6);
      const res = luckRules.step(s, { type: "round", target, press }, wall, clk);
      if (res.state !== s || res.out.length) c.v(`round ${round}: a round was played while paused`);
      const stay = int(r, 1, 120_000); wall += stay; paused += stay;
      const rs = resume(clk, "participant", wall); if (rs.phase !== "paused") c.v("a participant resumed the clock");
      clk = resume(clk, "organizer", wall);
    }
    // bad targets and a tick change nothing
    const bad = pick(r, [0, 7, -1, 2.5, NaN]);
    const noop = luckRules.step(s, { type: "round", target: bad, press: {} }, wall, clk);
    if (noop.state !== s || noop.out.length) c.v(`round ${round}: target ${bad} was accepted`);
    if (luckRules.step(s, { type: "tick" }, wall, clk).state !== s) c.v("a tick changed the state");
    const target = int(r, 1, 6), press: Record<string, number | undefined> = {};
    for (const p of ids) press[p] = r() < missRate ? undefined : r() < 0.02 ? pick(r, [0, 7, 99, 3.5]) : int(r, 1, 6); // missed presses and junk presses
    for (const p of ids) {
      const pts = pointsFor(target, press[p]), l = led[p]!;
      const want = press[p] === undefined || !Number.isInteger(press[p]) || press[p]! < 1 || press[p]! > 6 ? 0 : ({ 0: 10, 1: 5, 2: 3 } as Record<number, number>)[Math.abs(target - press[p]!)] ?? 1;
      if (pts !== want) c.v(`pointsFor(${target}, ${press[p]}) = ${pts}, book says ${want}`);
      if (want) { l.points += want; l.reachedAt = round; if (want === 10) l.exact++; if (want === 5) l.fives++; }
    }
    wall += 20_000; // 10 s press window + 10 s gap
    const res = luckRules.step(s, { type: "round", target, press }, wall, clk); s = res.state;
    for (const o of res.out) if (o.kind === "win") wins.push(o);
    if (round < ROUNDS && (s.over || s.round !== round)) { c.v(`round ${round}: state.round=${s.round} over=${s.over}`); break; }
    seen.push(res.out.map((o) => o.kind).join());
  }
  if (!s.over || s.round !== ROUNDS) c.v(`game not over after ${ROUNDS} rounds (round ${s.round})`);
  const after = luckRules.step(s, { type: "round", target: 3, press: { P0: 3 } }, wall, clk);
  if (after.state !== s || after.out.length) c.v("a round was played after the game was over");
  // scores, max 220, ledger
  const nan = badNumber(s); if (nan) c.v(`NaN or infinite number: ${nan}`);
  for (const p of ids) {
    const sc = s.scores[p]!, l = led[p]!;
    if (sc.points > 220 || sc.points < 0) c.v(`${p} has ${sc.points} points (max 220)`);
    if (sc.points !== l.points || sc.exact !== l.exact || sc.fives !== l.fives || sc.reachedAt !== l.reachedAt) c.v(`${p} score ${JSON.stringify(sc)} differs from the ledger ${JSON.stringify(l)}`);
    if (sc.fate !== fate[p]) c.v(`${p} lost its fate number`);
  }
  // strict total order: a permutation, every adjacent pair strictly ordered, and the same as an independent sort of the book's chain
  const rk = ranking(s.scores);
  if (rk.length !== n || new Set(rk).size !== n) c.v("ranking is not a permutation of the players");
  const key = (p: string): number[] => { const l = led[p]!; return [-l.points, -l.exact, -l.fives, l.reachedAt, fate[p]!]; };
  const cmp = (a: number[], b: number[]): number => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return 0; };
  for (let i = 1; i < rk.length; i++) if (cmp(key(rk[i - 1]!), key(rk[i]!)) >= 0) { c.v(`ranking places ${rk[i - 1]} before ${rk[i]} but they are tied or out of order`); break; }
  const indep = [...ids].sort((a, b) => cmp(key(a), key(b)));
  if (indep.some((p, i) => p !== rk[i])) c.v("ranking differs from an independent sort of the book's tie chain");
  // the same result under another order of the input
  const shuffled = Object.fromEntries(shuffle(r, Object.entries(s.scores))), rk2 = ranking(shuffled);
  if (rk2.some((p, i) => p !== rk[i])) c.v("ranking depends on the order players are stored");
  // prizes: the top five, each place exactly one holder
  const want = Math.min(5, n);
  if (wins.length !== want) c.v(`${wins.length} prizes were given, expected ${want}`);
  for (let i = 0; i < want; i++) { const h = wins.filter((w) => w.position === POS[i]); if (h.length !== 1 || h[0]!.player !== rk[i]) c.v(`place ${POS[i]} has ${h.length} holders (${h.map((x) => x.player)}), ranking says ${rk[i]}`); }
  if (new Set(wins.map((w) => w.player)).size !== wins.length) c.v("a player won two places");
  if (s.winner !== rk[0]) c.v("winner is not first in the ranking");
  // time: 22 x 10 s presses + 21 x 10 s gaps = 7:10, play 7:00-8:00, whole game <= 10:00
  const play = GAME_MS, whole = WAITING_ROOM_S * 1000 + play;
  if (play < 420_000 || play > 480_000) c.v(`play time ${play / 1000} s is outside 7:00-8:00`);
  if (whole > 600_000) c.v(`whole game ${whole / 1000} s is over 10:00`);
  if (gameNow(clk, wall) !== 22 * 20_000) c.v(`game time ${gameNow(clk, wall)} ms after 22 rounds, expected ${22 * 20_000}; a pause leaked into game time`);
  if (wall - paused !== gameNow(clk, wall)) c.v("paused time was not taken out of game time");
  // late join (Elimination rule: closed after round 1 unless the Organizer set a short window)
  const rule = withLateWindow(MANIFESTS.luck.lateJoin, int(r, -50, 400)), ms = int(r, 0, 600_000), rd = int(r, 1, ROUNDS);
  const jc = { round: rd, over: false, msSinceRound1End: ms, now: 0 }, ok = canJoinLate(rule, jc), exp = lateJoinExpected(rule, jc);
  if (ok !== exp) c.v(`canJoinLate round ${rd} after ${ms} ms gave ${ok}, expected ${exp}`);
  if ((rule.windowSeconds ?? 0) > 300 || (rule.windowSeconds ?? 0) < 0) c.v("late window outside 0..300 s");
  if (canJoinLate(rule, { round: 1, over: true, msSinceRound1End: 0, now: 0 })) c.v("someone joined a finished game");
  if (n === 2 || r() < 0.01) { let threw = false; try { luckRules.init({}, ["only"], 0); } catch { threw = true; } if (!threw) c.v("a game with 1 player started"); }
  return JSON.stringify([rk, wins, s.scores[rk[0]!], seen.join("|")]) + JSON.stringify(Object.values(s.scores));
});
