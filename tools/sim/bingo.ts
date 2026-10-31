// Bingo simulation: random complete games through bingoRules and settleFromLog (docs/BINGO_RULES_BOOK.md). Usage: bun tools/sim/bingo.ts --games N --seed S [--from I]
import { bingoRules, prizeLines, settleFromLog, isValidCard, meets, HOUSES, HOUSE_IDS, GAPS, FIRST_CALL_DELAY_MS, MAX_NUMBER, callLabel, type Card, type House, type HouseCounts, type BingoState } from "../../packages/bingo/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { gameNow, newClock, pause, resume, start } from "../../packages/core/src";
import { badNumber, int, pick, players, playerCount, run, sha, shuffle, type Rng } from "./common";

/** A valid card: column c takes 5 different numbers (4 for N) from its range. */
const card = (r: Rng): Card => {
  const cols = [0, 1, 2, 3, 4].map((c) => shuffle(r, Array.from({ length: 15 }, (_, i) => c * 15 + i + 1)).slice(0, c === 2 ? 4 : 5));
  return [0, 1, 2, 3, 4].map((row) => [0, 1, 2, 3, 4].map((c) => (c === 2 ? (row === 2 ? null : cols[2]![row < 2 ? row : row - 1]!) : cols[c]![row]!)));
};
const fateStr = (eid: string, seat: string | number, house: string, k: number): string => sha(`CB1-TIE|${eid}|${seat}|tie|${house}|${k}`);
run("bingo", "tools/sim/bingo.ts", (r, c) => {
  const n = playerCount(r), ids = players(n); c.players = n;
  const order = shuffle(r, Array.from({ length: MAX_NUMBER }, (_, i) => i + 1));
  const cards: Record<string, Card | Card[]> = {}, all: Record<string, Card[]> = {};
  for (const p of ids) { const two = r() < 0.2, cs = two ? [card(r), card(r)] : [card(r)]; all[p] = cs; cards[p] = two ? cs : cs[0]!; }
  for (const p of ids.slice(0, 3)) for (const cd of all[p]!) if (!isValidCard(cd)) c.v("generated card rejected by isValidCard");
  // a broken card is refused (book rule 3)
  if (r() < 0.1) {
    const bad = card(r).map((row) => [...row]); const k = int(r, 0, 3);
    if (k === 0) bad[0]![0] = bad[1]![0]!; else if (k === 1) bad[2]![2] = 5; else if (k === 2) bad[3]![4] = 3; else bad[0]![1] = 99;
    if (isValidCard(bad)) c.v(`isValidCard accepted a broken card (kind ${k})`);
    let threw = false; try { bingoRules.init({ order, cards: { P0: bad }, eid: "X" }, ["P0"], 0); } catch { threw = true; } if (!threw) c.v("init accepted a broken card");
  }
  // houses: random counts within each house's maximum; sometimes the default four
  let houses: HouseCounts | undefined;
  if (r() < 0.7) { houses = {}; for (const h of HOUSE_IDS) if (r() < 0.5) houses[h] = int(r, 1, HOUSES[h].max); if (!Object.keys(houses).length) houses.line = 1; }
  if (houses && r() < 0.1) houses.line = 99; // above the maximum: capped
  const seatOn = r() < 0.7, seats: Record<string, string | number> = {};
  if (seatOn) { const nums = shuffle(r, ids.map((_, i) => 1000 + i)); ids.forEach((p, i) => { if (r() < 0.9) seats[p] = r() < 0.5 ? nums[i]! : `S${nums[i]}`; }); }
  const callRounds = order.map((_, k) => k + 1 + int(r, 0, 3) * 100); // increasing beacon round of each call
  callRounds.sort((a, b) => a - b); for (let k = 1; k < callRounds.length; k++) if (callRounds[k]! <= callRounds[k - 1]!) callRounds[k] = callRounds[k - 1]! + 1;
  const countFrom: Record<string, number> = {}; // late joiners: calls before their round do not count for them
  const lateRate = pick(r, [0, 0.05, 0.3]);
  for (const p of ids) if (r() < lateRate) countFrom[p] = pick(r, [callRounds[int(r, 0, 74)]!, callRounds[int(r, 0, 74)]! + 1, 0, 1, 99999]);
  const round = pick(r, [1, 1, 2, 3]), eid = "BG" + int(r, 0, 1e6), gap = pick(r, GAPS);
  const setup = { order, cards, eid, round, seats, countFrom, callRounds, gapSeconds: gap, ...(houses ? { housesCount: houses } : {}) };
  const hc: HouseCounts = houses ?? { line: 1, corners: 1, x: 1, blackout: 1 };
  const lines = prizeLines(hc);
  if (houses) for (const h of HOUSE_IDS) if (lines.filter((l) => l.startsWith(h + "#")).length !== Math.min(houses[h] ?? 0, HOUSES[h].max)) c.v(`prize lines for ${h} exceed the maximum ${HOUSES[h].max}`);
  let s: BingoState = bingoRules.init(setup, ids, 0);
  if (JSON.stringify(s.lines) !== JSON.stringify(lines)) c.v("prize lines differ");
  // ---- play: ticks at the exact game time of each call, with pauses; a claim changes nothing
  let clk = start(newClock()), wall = 0;
  const wins: { player: string; position: string; at: number }[] = [];
  const claimPlayer = pick(r, ids);
  let guard = 0;
  while (!s.over && guard++ < 200) {
    const due = s.nextCallAt; // game time of the next call
    if (r() < 0.12) {
      clk = pause(clk, pick(r, ["organizer", "host"] as const), wall + int(r, 0, 1000));
      const res = bingoRules.step(s, { type: "tick" }, wall + 1e7, clk), rs = bingoRules.step(s, { type: "settle" }, wall + 1e7, clk);
      if (res.state !== s || rs.state !== s) c.v(`a call or settlement happened while paused (call ${s.called})`);
      wall = (clk.frozenAt ?? wall) + int(r, 1, 200_000); clk = resume(clk, "host", wall);
    }
    // just before the call time nothing happens; at the call time exactly one number is called
    const early = bingoRules.step(s, { type: "tick" }, due - 1 + clk.pausedMs, clk);
    if (early.state !== s) c.v(`call ${s.called + 1} came before its time`);
    if (r() < 0.1 && bingoRules.step(s, { type: "claim", player: claimPlayer, house: "line", fate: 1 }, due + clk.pausedMs, clk).state !== s) c.v("a claim changed the state");
    wall = due + clk.pausedMs; if (gameNow(clk, wall) !== due) c.v("game time does not match the call schedule");
    const res = bingoRules.step(s, { type: "tick" }, wall, clk);
    if (res.state.called !== s.called + 1) { c.v(`a tick at call time called ${res.state.called - s.called} numbers`); break; }
    for (const o of res.out) if (o.kind === "win") wins.push({ player: o.player, position: o.position, at: res.state.called - 1 });
    s = res.state;
    if (s.nextCallAt !== due + gap * 1000) c.v(`next call at ${s.nextCallAt}, expected ${due + gap * 1000}`);
  }
  if (!s.over) c.v("game did not end");
  if (s.called > MAX_NUMBER) c.v(`${s.called} numbers called`);
  // first call 2 minutes after the start; gaps of the chosen length
  if (FIRST_CALL_DELAY_MS !== 120_000 || ![6, 9, 12, 15].every((g) => GAPS.includes(g)) || GAPS.length !== 4) c.v("timing constants differ from the book");
  if (bingoRules.init(setup, ids.slice(0, 1), 0).nextCallAt !== 120_000) c.v("first call is not 2 minutes after the start");
  if (callLabel(52) !== "G 52" || callLabel(1) !== "B 1" || callLabel(75) !== "O 75") c.v("call label wrong");
  // ---- oracle: settle each house from the public log with the book's words (meets / fate string), independent of settleFromLog
  const eidR = round <= 1 ? eid : `${eid}~r${round}`, seatKey = (p: string): string | number => seats[p] ?? p;
  const expWon: Record<string, { p: string; at: number }> = {};
  const heavy = n <= 40 || r() < 0.04;
  const fromList = ids.map((p) => ({ id: p, cards: all[p]!, seat: seats[p], countFrom: countFrom[p] }));
  const sett = settleFromLog(eid, fromList, order, hc, round, callRounds);
  const swin: Record<string, { p: string; at: number }> = {};
  for (const x of sett) { const key = `${x.house}#${x.ordinal}`; if (swin[key]) c.v(`${key} has two winners in settleFromLog`); swin[key] = { p: x.player, at: x.idx }; }
  if (heavy) {
    for (const h of HOUSE_IDS) {
      const ords = Math.min(hc[h] ?? 0, HOUSES[h].max); if (!ords) continue;
      const done: [number, string][] = [];
      for (const p of ids) {
        const called = new Set<number>(); let at = -1;
        for (let k = 0; k < MAX_NUMBER && at < 0; k++) { if ((callRounds[k] ?? Infinity) >= (countFrom[p] || 0)) called.add(order[k]!); if (all[p]!.some((cd) => meets(cd, h, called))) at = k; }
        if (at >= 0) done.push([at, p]);
      }
      done.sort((a, b) => a[0] - b[0]);
      let o = 1, i = 0;
      while (i < done.length && o <= ords) {
        let j = i; while (j < done.length && done[j]![0] === done[i]![0]) j++;
        const grp = done.slice(i, j).map((d) => d[1]);
        while (grp.length && o <= ords) { grp.sort((a, b) => { const fa = fateStr(eidR, seatKey(a), h, o), fb = fateStr(eidR, seatKey(b), h, o); return fa < fb ? -1 : fa > fb ? 1 : a < b ? -1 : 1; }); expWon[`${h}#${o}`] = { p: grp.shift()!, at: done[i]![0] }; o++; }
        i = j;
      }
    }
    for (const l of lines) if ((expWon[l]?.p) !== (swin[l]?.p) || expWon[l]?.at !== swin[l]?.at) c.v(`${l}: settleFromLog gives ${JSON.stringify(swin[l])}, the book gives ${JSON.stringify(expWon[l])}`);
  }
  // ---- the game agrees with settleFromLog; one winner per prize line; no sharing
  for (const l of lines) {
    const h = wins.filter((w) => w.position === l);
    if (h.length > 1) c.v(`${l} has ${h.length} winners`);
    if (h.length !== (swin[l] ? 1 : 0)) c.v(`${l}: game gave ${h.length} winners, settlement ${swin[l] ? 1 : 0}`);
    if (h[0] && swin[l] && (h[0].player !== swin[l]!.p || s.won[l] !== swin[l]!.p)) c.v(`${l}: game winner ${h[0].player}, settlement ${swin[l]!.p}`);
    if (h[0] && swin[l] && h[0].at !== swin[l]!.at) c.v(`${l} paid at call ${h[0].at + 1}, completed at call ${swin[l]!.at + 1}: settlement is not at the call`);
  }
  for (const h of HOUSE_IDS) { const hw = lines.filter((l) => l.startsWith(h + "#")).map((l) => swin[l]).filter(Boolean); if (new Set(hw.map((x) => x!.p)).size !== hw.length) c.v(`a seat won house ${h} twice`); for (let k = 1; k < hw.length; k++) if (hw[k]!.at < hw[k - 1]!.at) c.v(`${h}: a later prize line was won at an earlier call`); }
  if (wins.length !== lines.filter((l) => swin[l]).length || wins.some((w) => !lines.includes(w.position))) c.v("a prize outside the prize lines, or a missing one");
  const done = lines.every((l) => s.won[l]);
  if (!(done || s.called >= MAX_NUMBER)) c.v("game over before all lines were won and before call 75");
  if (done && s.called < MAX_NUMBER && s.called !== Math.max(...lines.map((l) => swin[l]!.at)) + 1) c.v(`all lines won but the game ended at call ${s.called}`);
  // late joiners never win on calls they did not count
  for (const x of sett) { const f = countFrom[x.player]; if (f && (callRounds[x.idx] ?? 0) < f) c.v(`${x.player} (counts from round ${f}) won ${x.house}#${x.ordinal} on call ${x.idx + 1} of round ${callRounds[x.idx]}`); }
  // after the end nothing changes
  if (bingoRules.step(s, { type: "tick" }, 1e12, clk).state !== s) c.v("the game moved after it was over");
  const nan = badNumber({ ...s, groups: undefined }); if (nan) c.v(`NaN: ${nan}`);
  void MANIFESTS;
  return JSON.stringify([s.called, s.won, wins, sett.map((x) => [x.house, x.ordinal, x.idx, x.player, x.tied ?? 0])]);
});
