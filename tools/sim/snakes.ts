// Snakes and Ladders simulation: random complete games through snakesRules (docs/SNAKES_RULES_BOOK.md). Usage: bun tools/sim/snakes.ts --games N --seed S [--from I]
import { checkBoard, finalRanking, ownerBoard, placeSpecials, raceOrder, snakesRules, standing, timeLimitMsFor, winnerOf, WAITING_ROOM_MS, REWARD_THROWS, type Board, type SpecialKind } from "../../packages/snakes/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { canJoinLate, gameNow, newClock, pause, resume, start, withLateWindow } from "../../packages/core/src";
import { badNumber, fates, int, lateJoinExpected, pick, players, playerCount, run, shuffle, type Rng } from "./common";

/** Independent move model from the book (rules 6-9, 28-33): the square after a roll. */
function land(b: Board, at: number, roll: number, pass: boolean): { to: number; kind?: string } | null {
  let n = at + roll;
  if (n > b.size) { if (!pass) return null; n = b.size; }
  if (b.ladders[n] !== undefined) return { to: b.ladders[n]!, kind: "ladder" };
  if (b.snakes[n] !== undefined) return { to: b.snakes[n]!, kind: "snake" };
  const sp = b.specials?.[n];
  if (sp?.kind === "upgrade") return { to: Math.min(n + (sp.n ?? 3), b.size - 1), kind: "up" };
  if (sp?.kind === "downgrade") return { to: Math.max(n - (sp.n ?? 3), 2), kind: "down" };
  return { to: n, kind: sp?.kind };
}
/** Rule 5 / 43: from every square the last square is reachable (exact finish, rolls 1-6). Reverse search over the board's own edges. */
function everySquareReachesLast(b: Board): boolean {
  const back: number[][] = Array.from({ length: b.size + 1 }, () => []);
  for (let s = 1; s < b.size; s++) for (let r = 1; r <= 6; r++) { const l = land(b, s, r, false); back[l ? l.to : s]!.push(s); }
  const seen = new Uint8Array(b.size + 1), stack = [b.size]; seen[b.size] = 1;
  while (stack.length) for (const f of back[stack.pop()!]!) if (!seen[f]) { seen[f] = 1; stack.push(f); }
  for (let s = 1; s <= b.size; s++) if (!seen[s]) return false;
  return true;
}
/** A classic board (rules 1-5) for the older per-game boards: 6-12 snakes and ladders, lengths in the book's range. May fail; the caller retries. */
function classic(r: Rng, size: number): Board | null {
  const k = size / 100, used = new Set<number>([1, size]), snakes: Record<number, number> = {}, ladders: Record<number, number> = {};
  const free = (): number => { for (;;) { const q = int(r, 2, size - 1); if (!used.has(q)) return q; } };
  const add = (to: Record<number, number>, up: boolean): void => {
    for (let t = 0; t < 200; t++) {
      const a = free(), len = up ? int(r, Math.ceil(8 * k), Math.floor(30 * k)) : int(r, Math.ceil(8 * k), Math.floor(40 * k)), b = up ? a + len : a - len;
      if (b < 2 || b >= size || used.has(b)) continue;
      used.add(a); used.add(b); to[a] = b; return;
    }
  };
  for (let i = int(r, 6, 12); i > 0; i--) add(snakes, false);
  for (let i = int(r, 6, 12); i > 0; i--) add(ladders, true);
  return { size, snakes, ladders };
}
const pool = new Map<string, Board>();
const POS = ["1st", "2nd", "3rd", "4th", "5th"];
run("snakes", "tools/sim/snakes.ts", (r, c) => {
  const n = playerCount(r), ids = players(n); c.players = n;
  // ---- the board
  let board: Board, label = "owner";
  if (r() < 0.8) {
    // a board costs about 130 ms to make, so most games take one of 300 pooled game ids (made once per run) and 1 game in 20 makes a fresh id
    const fresh = r() < 0.05, gid = fresh ? "G" + int(r, 0, 1e9) : "P" + int(r, 0, 299), hit = !fresh && pool.get(gid);
    board = hit || ownerBoard(gid); if (!fresh) pool.set(gid, board);
    if (fresh && JSON.stringify(ownerBoard(gid)) !== JSON.stringify(board)) c.v(`ownerBoard(${gid}) is not the same twice`);
    const sn = Object.entries(board.snakes), la = Object.entries(board.ladders), sp = Object.entries(board.specials ?? {});
    if (sn.length !== 30 || la.length !== 15 || sp.filter(([, x]) => x.kind === "punishment").length !== 10 || sp.filter(([, x]) => x.kind === "reward").length !== 10) c.v(`ownerBoard(${gid}) counts are not 30/15/10/10`);
    const starts = [...sn, ...la, ...sp].map(([f]) => +f); if (new Set(starts).size !== 65 || starts.includes(1) || starts.includes(100)) c.v(`ownerBoard(${gid}): squares reused or on 1/100`);
    const lens = [...sn.map(([f, t]) => +f - t), ...la.map(([f, t]) => t - +f)]; if (new Set(lens).size !== 45 || Math.min(...lens) < 3) c.v(`ownerBoard(${gid}): lengths are not 45 different values of at least 3`);
    if (board.snakes[99] !== 9 || board.ladders[31] !== 80) c.v(`ownerBoard(${gid}): longest snake/ladder wrong`);
  } else {
    label = "classic";
    let b: Board | null = null;
    for (let t = 0; t < 200 && !b; t++) { const x = classic(r, pick(r, [100, 144, 225])); if (x && checkBoard(x).length === 0) b = x; }
    if (!b) { board = ownerBoard("fallback"); label = "owner"; } else {
      board = b; const counts: Partial<Record<SpecialKind, number>> = { upgrade: int(r, 0, 4), downgrade: int(r, 0, 4), reward: int(r, 0, 4), punishment: int(r, 0, 4) };
      board = placeSpecials(b, counts, int(r, 1, 6 * b.size / 100), r);
      if (checkBoard(board).length) c.v(`classic board with specials fails its own check: ${checkBoard(board)}`);
      for (const q of Object.keys(board.specials ?? {})) if (+q === 1 || +q === board.size || board.snakes[+q] || board.ladders[+q] || Object.values(board.snakes).includes(+q) || Object.values(board.ladders).includes(+q)) c.v(`special on a used square ${q}`);
    }
  }
  if (!everySquareReachesLast(board)) c.v(`the last square is not reachable from every square (${label} board, size ${board.size})`);
  const size = board.size;
  // ---- setup
  const fate = fates(r, ids), presence = r() < 0.5, pass = r() < 0.3, survivors = r() < 0.6 ? 0 : int(r, 1, Math.max(1, Math.min(n, int(r, 1, 50)))), roundTurns = int(r, 1, 15);
  const milestones = pick(r, ["75", "50,75,90", "", "30", "60,80"]), turnLimit = r() < 0.8 ? 600 : int(r, 5, 80);
  const tl = pick(r, [7, "7", 8, "8", 5, 0, "abc", undefined, 9]); const timeLimitMs = timeLimitMsFor(tl);
  if (timeLimitMs !== (Number(tl) === 7 ? 420_000 : 480_000)) c.v(`timeLimitMsFor(${tl}) = ${timeLimitMs}, book says 7 or 8 minutes, anything else 8`);
  const setup = { board, fate, mode: presence ? "presence" : "fate", pass, survivors, roundTurns, milestones, turnLimit, timeLimitMinutes: tl };
  let s = snakesRules.init(setup, ids, 0);
  const ms = milestones.split(",").map(Number).filter(Boolean).slice(0, 3);
  // ---- oracle: the book's rules written again from scratch
  const o: Record<string, { at: number; ladders: number; missed: number; extra: number; skip: number; fin: number }> = {};
  for (const p of ids) o[p] = { at: 1, ladders: 0, missed: 0, extra: 0, skip: 0, fin: 0 };
  const oOut = new Set<string>(), oFin: string[] = [], oMile: Record<number, string> = {}, winsSeen: Record<string, string> = {};
  const better = (a: string, b: string): number => o[b]!.at - o[a]!.at || o[b]!.ladders - o[a]!.ladders || o[a]!.missed - o[b]!.missed || fate[a]! - fate[b]!;
  let clk = start(newClock()), wall = 0, paused = 0, turn = 0, gameMs = 0, overAt = -1;
  const missRate = pick(r, [0, 0.1, 0.5]), pausedTurnsSeen: number[] = [];
  for (let guard = 0; guard < 700 && !s.over; guard++) {
    if (r() < 0.12) { // pause: a turn event is ignored; a participant cannot pause
      if (pause(clk, "participant", wall).phase !== "running") c.v("a participant paused the clock");
      clk = pause(clk, pick(r, ["organizer", "host"] as const), wall);
      const rolls: Record<string, number> = {}; for (const p of ids) rolls[p] = int(r, 1, 6);
      const res = snakesRules.step(s, { type: "turn", rolls, threw: ids, gameMs: gameMs + 10_000 }, wall, clk);
      if (res.state !== s || res.out.length) c.v(`turn ${turn + 1}: a turn was played while paused`);
      const stay = int(r, 1, 300_000); wall += stay; paused += stay; clk = resume(clk, "host", wall);
      if (gameNow(clk, wall) !== gameMs) c.v(`pause leaked into game time (${gameNow(clk, wall)} vs ${gameMs})`);
    }
    turn++; wall += 10_000; gameMs = gameNow(clk, wall);
    const rolls: Record<string, number> = {}, threw: string[] = [];
    for (const p of ids) { rolls[p] = r() < 0.01 ? pick(r, [0, 7, -3]) : int(r, 1, 6); if (r() >= missRate) threw.push(p); }
    const prev = s;
    const res = snakesRules.step(s, { type: "turn", rolls, threw, gameMs }, wall, clk); s = res.state;
    if (snakesRules.step(prev, { type: "tick" }, wall, clk).state !== prev) c.v("a tick changed the state");
    if (!presence) threw.length = 0, threw.push(...ids); // fate mode: every throw happens by itself (the module ignores `threw` only in presence mode)
    // oracle turn
    const fin: string[] = [];
    for (const p of ids) {
      const w = o[p]!; if (w.fin || oOut.has(p)) continue;
      if (presence && !threw.includes(p)) { w.missed++; continue; }
      if (w.skip) { w.skip--; continue; }
      const roll = rolls[p]!; if (!roll || roll < 1 || roll > 6) continue;
      if (w.extra) w.extra--;
      const l = land(board, w.at, roll, pass); if (!l) continue;
      w.at = l.to; if (l.kind === "ladder") w.ladders++;
      if (l.kind === "reward") w.extra += REWARD_THROWS; if (l.kind === "punishment") w.skip++;
      if (w.at === size) { w.fin = turn; fin.push(p); }
    }
    fin.sort(better);
    const expWins: Record<string, string> = {};
    fin.forEach((p, i) => { if (oFin.length + i < 5) expWins[p] = POS[oFin.length + i]!; });
    oFin.push(...fin); oFin.length = Math.min(oFin.length, 5);
    for (const m of ms) if (!oMile[m]) { const hit = ids.filter((p) => o[p]!.at >= m).sort(better)[0]; if (hit) { oMile[m] = hit; expWins[hit] = (expWins[hit] ? expWins[hit] + "+" : "") + `milestone ${m}`; } }
    let gone: string[] = [];
    if (survivors && turn % roundTurns === 0) { const live = ids.filter((p) => !o[p]!.fin && !oOut.has(p)).sort(better); gone = live.slice(survivors); for (const p of gone) oOut.add(p); }
    // compare
    const got: Record<string, string> = {};
    for (const x of res.out) if (x.kind === "win") { got[x.player] = (got[x.player] ? got[x.player] + "+" : "") + x.position; if (winsSeen[x.position]) c.v(`prize ${x.position} given twice (${winsSeen[x.position]} and ${x.player})`); winsSeen[x.position] = x.player; }
    const norm = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k}:${v.split("+").sort().join("+")}`).sort().join();
    if (norm(got) !== norm(expWins)) c.v(`turn ${turn}: prizes ${norm(got)} but the book gives ${norm(expWins)}`);
    for (const p of ids) {
      const a = s.pawns[p]!, w = o[p]!;
      if (a.at !== w.at || a.ladders !== w.ladders || a.missed !== w.missed || (a.extra ?? 0) !== w.extra || (a.skip ?? 0) !== w.skip || (a.finishedTurn ?? 0) !== w.fin) { c.v(`turn ${turn}: ${p} is ${JSON.stringify(a)}, book says ${JSON.stringify(w)}`); break; }
      if (a.at < 1 || a.at > size || !Number.isInteger(a.at)) { c.v(`${p} on square ${a.at}`); break; }
      const pp = prev.pawns[p]!; if (pp.finishedTurn && (a.at !== pp.at || a.finishedTurn !== pp.finishedTurn)) { c.v(`${p} moved after finishing`); break; }
      if (prev.out.includes(p) && a.at !== pp.at) { c.v(`${p} moved after being sent out`); break; }
    }
    if (s.out.length !== oOut.size || s.out.some((p) => !oOut.has(p))) c.v(`turn ${turn}: out list differs from the book's survivors cut`);
    const outs = res.out.filter((x) => x.kind === "out").map((x) => (x as { player: string }).player); if (outs.length !== gone.length) c.v(`turn ${turn}: ${outs.length} out events, expected ${gone.length}`);
    if (s.gameMs < prev.gameMs) c.v("game time went backwards");
    const stillIn = ids.filter((p) => !o[p]!.fin && !oOut.has(p)).length, wantOver = oFin.length >= 5 || turn >= turnLimit || stillIn === 0 || gameMs >= timeLimitMs;
    if (s.over !== wantOver) c.v(`turn ${turn}: over=${s.over}, book says ${wantOver} (finishers ${oFin.length}, still in ${stillIn}, game ${gameMs} ms)`);
    if (s.over) { overAt = gameMs; if (res.out.filter((x) => x.kind === "end").length !== 1) c.v("end was not announced exactly once"); }
    if (turn % 7 === 0) { const me = pick(r, ids), st = standing(s, me); let ah = 0, bh = 0; for (const q of ids) if (q !== me) { const A = s.pawns[me]!, B = s.pawns[q]!; if (B.finishedTurn && !A.finishedTurn) ah++; else if (A.finishedTurn && !B.finishedTurn) bh++; else if (B.at > A.at) ah++; else if (B.at < A.at) bh++; } if (st.ahead !== ah || st.behind !== bh) c.v(`standing(${me}) = ${st.ahead}/${st.behind}, book says ${ah}/${bh}`); }
  }
  if (!s.over) c.v("game did not end within 700 turns");
  const after = snakesRules.step(s, { type: "turn", rolls: {}, gameMs: gameMs + 1e6 }, wall, clk); if (after.state !== s || after.out.length) c.v("a turn was played after the game was over");
  // ---- time: waiting room 120 s, then 7 or 8 minutes, about 10 minutes in all
  if (overAt > timeLimitMs) c.v(`play lasted ${overAt} ms, over the limit ${timeLimitMs}`);
  if (WAITING_ROOM_MS + Math.min(overAt, timeLimitMs) > 600_000) c.v("whole game over 10:00");
  if (![420_000, 480_000].includes(s.timeLimitMs)) c.v(`time limit ${s.timeLimitMs} is not 7 or 8 minutes`);
  if (wall - paused !== gameMs) c.v("paused time was not taken out of game time");
  // ---- milestones
  for (const m of ms) { const holders = Object.entries(s.milestoneWon).filter(([k]) => +k === m); if (holders.length > 1) c.v(`milestone ${m} has ${holders.length} holders`); if (ids.some((p) => o[p]!.at >= m) && !s.milestoneWon[m]) c.v(`milestone ${m} reached but not awarded`); }
  // ---- ranking: complete, strict, finishers first, survivors cut last
  const rk = finalRanking(s), nan = badNumber(s.pawns); if (nan) c.v(`NaN or infinite number: ${nan}`);
  if (rk.length !== n || new Set(rk).size !== n) c.v("ranking is not a permutation of the players");
  if (winnerOf(s) !== rk[0]) c.v("winnerOf is not the first of the ranking");
  const nf = s.finishers.length; if (rk.slice(0, nf).join() !== s.finishers.join() || s.finishers.join() !== oFin.join()) c.v("finishers are not first in finishing order");
  for (let i = 1; i < rk.length; i++) {
    const a = rk[i - 1]!, b = rk[i]!, A = s.pawns[a]!, B = s.pawns[b]!;
    if (i < nf) { if ((A.finishedTurn ?? 0) > (B.finishedTurn ?? 0) || ((A.finishedTurn === B.finishedTurn) && raceOrder(A, B) >= 0)) { c.v(`finishers ${a},${b} are tied or out of order`); break; } continue; }
    if (i === nf) continue;
    const ao = s.out.includes(a), bo = s.out.includes(b);
    if (ao && !bo) { c.v(`${b} (still in) ranked after ${a} (sent out)`); break; }
    if (ao === bo && raceOrder(A, B) >= 0) { c.v(`${a} and ${b} are tied or out of order (${raceOrder(A, B)})`); break; }
  }
  // ---- late join: closed after round 1 unless a short window was set
  const rule = withLateWindow(MANIFESTS.snakes.lateJoin, int(r, -50, 400)), jc = { round: int(r, 1, 30), over: false, msSinceRound1End: int(r, 0, 600_000), now: 0 };
  if (canJoinLate(rule, jc) !== lateJoinExpected(rule, jc)) c.v(`canJoinLate ${JSON.stringify(jc)} disagrees with the book`);
  return JSON.stringify([rk, s.finishers, s.out, s.milestoneWon, s.turn, s.gameMs, board]) + JSON.stringify(Object.values(s.pawns));
});
