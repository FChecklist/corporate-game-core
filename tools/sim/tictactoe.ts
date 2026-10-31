// Tic Tac Toe simulation: random complete games (3 stages, cuts, final) through tttRules (docs/TICTACTOE_RULES_BOOK.md). Usage: bun tools/sim/tictactoe.ts --games N --seed S [--from I]
import { applyBye, keepAfter, order, pairFree, standing, tttRules, MOVE_SECONDS, STAGES, STAGE_SECONDS, SUDDEN_SECONDS, TOTAL_SECONDS, WAIT_SECONDS, WINNERS, moveClockFor, afterMissedMove, boardResult, play, type Board, type TttEvent, type TttState } from "../../packages/tictactoe/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { canJoinLate, gameNow, newClock, pause, resume, start, withLateWindow } from "../../packages/core/src";
import { badNumber, fates, int, lateJoinExpected, pick, players, playerCount, run } from "./common";

const POS = ["1st", "2nd", "3rd", "4th", "5th"];
type L = { points: number; wins: number; stage: number; bye: number[] };
run("tictactoe", "tools/sim/tictactoe.ts", (r, c) => {
  const n = playerCount(r), ids = players(n); c.players = n;
  const fate = fates(r, ids);
  let s: TttState = tttRules.init({ fate }, ids, 0);
  let clk = start(newClock()), wall = 0, paused = 0;
  const led: Record<string, L> = {}; for (const p of ids) led[p] = { points: 0, wins: 0, stage: 0, bye: [] };
  const key = (p: string): number[] => [-led[p]!.points, -led[p]!.wins, -led[p]!.stage, fate[p]!];
  const cmp = (a: number[], b: number[]): number => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return 0; };
  const sorted = (xs: string[]): string[] => [...xs].sort((a, b) => cmp(key(a), key(b)));
  const outcomes: string[] = [], allWins: { player: string; position: string }[] = [];
  const cuts: number[] = [];
  let alive = [...ids];
  const maxRounds = n <= 10 ? 8 : n <= 100 ? 5 : 3;
  for (let stage = 1; stage <= STAGES; stage++) {
    if (s.stage !== stage || s.alive.length !== alive.length) { c.v(`stage ${stage}: state says stage ${s.stage} with ${s.alive.length} alive, expected ${alive.length}`); break; }
    const stageStart = gameNow(clk, wall);
    // ---- standing: places 1..n, unique
    if (alive.length <= 50 || r() < 0.2) {
      const exp = sorted(alive); const me = pick(r, alive), st = standing(s, me), keep = keepAfter(stage, alive.length);
      if (st.place !== exp.indexOf(me) + 1 || st.of !== alive.length || st.keep !== keep || st.safe !== (st.place <= keep)) c.v(`standing(${me}) = ${JSON.stringify(st)}, expected place ${exp.indexOf(me) + 1} keep ${keep}`);
    }
    const stageByes = new Set<string>();
    const rounds = int(r, 1, maxRounds);
    for (let round = 0; round < rounds && alive.length >= 2; round++) {
      const free = [...alive], { pairs, bye } = pairFree(s, free);
      // partition
      const seenP = new Set<string>(); for (const [a, b] of pairs) { seenP.add(a); seenP.add(b); } if (bye) seenP.add(bye);
      if (seenP.size !== free.length || pairs.length * 2 + (bye ? 1 : 0) !== free.length) c.v(`stage ${stage}: pairing does not use every free player exactly once`);
      if ((free.length % 2 === 1) !== (bye !== null)) c.v(`stage ${stage}: ${free.length} free players, bye=${bye}`);
      if (bye) {
        // the lowest-ranked free player who has not had the bye this stage
        const ord = sorted(free), want = [...ord].reverse().find((p) => !led[p]!.bye.includes(stage));
        if (want && want !== bye) c.v(`stage ${stage}: bye went to ${bye}, book says ${want}`);
        // book rule 6: the sit-out point only once per player per stage; a second sit-out (everybody had one) is allowed but gives no point
        const had = led[bye]!.bye.includes(stage), before = s.stats[bye]?.points ?? 0;
        s = applyBye(s, bye); const l = led[bye]!;
        if (had && (s.stats[bye]?.points ?? 0) !== before) c.v(`stage ${stage}: ${bye} got a second bye point in the same stage`);
        if (!had) { l.points++; l.stage++; l.bye.push(stage); }
        stageByes.add(bye);
      }
      for (const [a, b] of pairs) {
        if (a === b) c.v("a player is paired with themselves");
        if (free.length >= 4 && (s.stats[a]?.lastOpp === b || s.stats[b]?.lastOpp === a)) c.v(`stage ${stage}: ${a} and ${b} meet twice in a row although ${free.length} players are free`);
      }
      const bad = int(r, 0, 2) === 0 && pairs.length ? pairs[0]![0] : null;
      // pause: nothing is recorded while paused
      if (r() < 0.1) {
        clk = pause(clk, pick(r, ["organizer", "host"] as const), wall);
        const [a, b] = pairs[0] ?? [alive[0]!, alive[1]!], res = tttRules.step(s, { type: "game", a, b, winner: "a" }, wall, clk), re2 = tttRules.step(s, { type: "stageEnd" }, wall, clk);
        if (res.state !== s || re2.state !== s || res.out.length || re2.out.length) c.v("an event was recorded while paused");
        const stay = int(r, 1, 600_000); wall += stay; paused += stay; clk = resume(clk, "organizer", wall);
      }
      // refused events change nothing
      if (bad !== null) {
        const ev: TttEvent[] = [{ type: "game", a: bad, b: bad, winner: "a" }, { type: "game", a: bad, b: "nobody", winner: "b" }];
        for (const e of ev) if (tttRules.step(s, e, wall, clk).state !== s) c.v(`a refused game event changed the state: ${JSON.stringify(e)}`);
      }
      for (const [a, b] of pairs) {
        const w = pick(r, ["a", "b", "draw"] as const), both = r() < 0.05; // both players missing = a draw
        const eff = both ? (afterMissedMove(true, true) === "draw" ? "draw" : w) : w;
        if (afterMissedMove(true, false) !== "opponent-moves" || afterMissedMove(false, true) !== "opponent-moves") c.v("afterMissedMove gave the wrong answer");
        s = tttRules.step(s, { type: "game", a, b, winner: eff }, wall, clk).state;
        const A = led[a]!, B = led[b]!;
        if (eff === "a") { A.points += 2; A.stage += 2; A.wins++; } else if (eff === "b") { B.points += 2; B.stage += 2; B.wins++; } else { A.points++; A.stage++; B.points++; B.stage++; }
        wall += 0;
      }
      for (const p of alive) { const a = s.stats[p]!, l = led[p]!; if (!a || a.points !== l.points || a.wins !== l.wins || a.stagePoints !== l.stage) { c.v(`stage ${stage}: ${p} has ${JSON.stringify(a && { p: a.points, w: a.wins, s: a.stagePoints })}, ledger ${JSON.stringify(l)}`); break; } }
      wall += 1000; // time of the games; the stage clock below is what counts
    }
    // ---- the stage clock runs out: exactly 300 s of game time, pauses excluded
    const left = STAGE_SECONDS * 1000 - (gameNow(clk, wall) - stageStart);
    if (left < 0) c.v(`stage ${stage} used more than ${STAGE_SECONDS} s`);
    wall += Math.max(0, left);
    if (gameNow(clk, wall) - stageStart !== STAGE_SECONDS * 1000) c.v(`stage ${stage} lasted ${(gameNow(clk, wall) - stageStart) / 1000} s of game time, not ${STAGE_SECONDS}`);
    // games still running at the end are draws: same as sending them as draws one by one
    const run2: { a: string; b: string }[] = [];
    if (alive.length >= 2) { const sh = [...alive].sort(() => r() - 0.5); for (let i = 0; i + 1 < sh.length && run2.length < int(r, 0, 4); i += 2) run2.push({ a: sh[i]!, b: sh[i + 1]! }); }
    let viaGames = s; for (const g of run2) viaGames = tttRules.step(viaGames, { type: "game", a: g.a, b: g.b, winner: "draw" }, wall, clk).state;
    for (const g of run2) { const A = led[g.a]!, B = led[g.b]!; A.points++; A.stage++; B.points++; B.stage++; }
    const res = tttRules.step(s, { type: "stageEnd", running: run2 }, wall, clk), res2 = tttRules.step(viaGames, { type: "stageEnd" }, wall, clk);
    if (JSON.stringify(res.state) !== JSON.stringify(res2.state) || JSON.stringify(res.out) !== JSON.stringify(res2.out)) c.v(`stage ${stage}: games still running at the stage end are not drawn`);
    const t = res.state; outcomes.push(JSON.stringify(res.out));
    const expOrder = sorted(alive);
    if (stage < STAGES) {
      const keep = Math.max(1, Math.ceil(alive.length / 2)), gone = expOrder.slice(keep);
      if (t.alive.length !== keep) c.v(`stage ${stage}: ${t.alive.length} stay of ${alive.length}, book says ${keep}`);
      if (t.alive.join() !== expOrder.slice(0, keep).join() && [...t.alive].sort().join() !== expOrder.slice(0, keep).sort().join()) c.v(`stage ${stage}: the wrong players stay`);
      const outs = res.out.filter((o) => o.kind === "out").map((o) => (o as { player: string }).player).sort();
      if (outs.join() !== [...gone].sort().join()) c.v(`stage ${stage}: out events do not match the bottom half`);
      if (t.stage !== stage + 1 || t.over) c.v(`stage ${stage}: next stage not opened`);
      if (stage === 1 && t.alive.length !== Math.max(1, Math.ceil(n / 2))) c.v(`after stage 1 ${t.alive.length} stay of ${n}, book says 50% rounded up`);
      if (stage === 2 && t.alive.length !== Math.max(1, Math.ceil(Math.max(1, Math.ceil(n / 2)) / 2))) c.v(`after stage 2 ${t.alive.length} stay of ${n}, book says 25% (half of half, rounded up)`);
      cuts.push(t.alive.length);
      for (const p of t.alive) { const st = t.stats[p]; if (!st || st.stagePoints !== 0 || st.points !== led[p]!.points || st.wins !== led[p]!.wins) { c.v(`stage ${stage}: ${p} did not carry over points and wins / reset stage points`); break; } led[p]!.stage = 0; }
      alive = [...t.alive];
    } else {
      const rk = t.ranking ?? [];
      if (!t.over) c.v("game not over after stage 3");
      if (rk.length !== alive.length || new Set(rk).size !== rk.length || rk.some((p) => !alive.includes(p))) c.v("final ranking is not a permutation of the survivors");
      for (let i = 1; i < rk.length; i++) if (cmp(key(rk[i - 1]!), key(rk[i]!)) >= 0) { c.v(`final ranking: ${rk[i - 1]} and ${rk[i]} tied or out of order`); break; }
      if (rk.join() !== expOrder.join()) c.v("final ranking differs from an independent sort of the book's chain (points, wins, last-stage points, fate)");
      const w = res.out.filter((o) => o.kind === "win") as { player: string; position: string }[]; allWins.push(...w);
      if (w.length !== Math.min(WINNERS, rk.length)) c.v(`${w.length} prizes given for ${rk.length} ranked players`);
      for (let i = 0; i < w.length; i++) { const h = w.filter((x) => x.position === POS[i]); if (h.length !== 1 || h[0]!.player !== rk[i]) c.v(`place ${POS[i]} has ${h.length} holders, ranking says ${rk[i]}`); }
      if (res.out.filter((o) => o.kind === "end").length !== 1) c.v("end not announced exactly once");
      const after = tttRules.step(t, { type: "game", a: rk[0]!, b: rk[1] ?? rk[0]!, winner: "a" }, wall, clk); if (after.state !== t || after.out.length) c.v("an event was accepted after the game was over");
      s = t;
    }
    if (stage < STAGES) s = t;
  }
  // ---- cuts: 50% then 25%
  if (n >= 2 && cuts.length === 2 && cuts[1]! > cuts[0]!) c.v("the second cut did not reduce the field");
  // ---- time: 2:00 + 3 x 5:00
  if (WAIT_SECONDS !== 120 || STAGE_SECONDS !== 300 || STAGES !== 3 || TOTAL_SECONDS !== 1020 || MOVE_SECONDS !== 10 || SUDDEN_SECONDS !== 5) c.v("a time constant differs from the book");
  if (moveClockFor(false) !== 10 || moveClockFor(true) !== 5) c.v("move clock is not 10 s / 5 s");
  if (gameNow(clk, wall) !== STAGES * STAGE_SECONDS * 1000) c.v(`play took ${gameNow(clk, wall) / 1000} s of game time, not 3 x 300 s`);
  if (wall - paused !== gameNow(clk, wall)) c.v("paused time was not taken out of game time");
  const nan = badNumber(s.stats); if (nan) c.v(`NaN or infinite number: ${nan}`);
  // ---- one single game on the nine squares: a random legal game ends in a win or a draw; refused moves are refused
  { let b: Board = Array(9).fill(null), mark: "X" | "O" = "X"; const free = () => b.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
    for (let k = 0; k < 9 && boardResult(b) === null; k++) { const sq = pick(r, free()); if (play(b, sq, mark === "X" ? "O" : "X") !== null) c.v("a move out of turn was accepted"); const nb = play(b, sq, mark); if (!nb) { c.v("a legal move was refused"); break; } if (play(nb, sq, mark === "X" ? "O" : "X") !== null) c.v("a taken square was accepted"); b = nb; mark = mark === "X" ? "O" : "X"; }
    if (boardResult(b) === null) c.v("a full game never ended"); }
  // ---- late join: closed after round 1 unless a short window was set
  const rule = withLateWindow(MANIFESTS.tictactoe.lateJoin, int(r, -50, 400)), jc = { round: int(r, 1, 30), over: false, msSinceRound1End: int(r, 0, 600_000), now: 0 };
  if (canJoinLate(rule, jc) !== lateJoinExpected(rule, jc)) c.v(`canJoinLate ${JSON.stringify(jc)} disagrees with the book`);
  return JSON.stringify([s.ranking, s.alive, s.out.length, outcomes, allWins, cuts]);
});
