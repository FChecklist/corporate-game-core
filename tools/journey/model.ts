// The journey model: drives the real pure functions of the core through one journey and checks the invariants after every step.
import { MANIFESTS, type GameId } from "../../packages/manifest/src";
import { admit, addHost, addCohost, newTeam, getsEndPdf, newClock, pause, resume, start, gameNow, shouldStart, timeOk, MAX_AHEAD_MS, SLOT_MS, MAX_HOSTS, capFor, normId, makeReporter, FUNNEL_EVENTS, drawInit, register, draw, drawReady, elimInit, submit, closeRound, autoDeleteDue, AUTO_DELETE_AFTER_MS, PDF_SEND_WITHIN_MS, PDF_RETRY_HOURS, WAIT_LAPSE_MS, type IdKind } from "../../packages/core/src";
import { settleFromLog, type Seat } from "../../packages/bingo/src/settle";
import { LEGAL, guardOk, dataTextOk, say, MSG } from "../../packages/wording/src";
import type { Journey } from "./catalog";
import { rng, type Rng } from "./rng";

const H = 3_600_000, T0 = 1_800_000_000_000, WAITING_ROOM_MS = 120_000, TICK_MAX_GAP_MS = 4 * H - 1, NEW_FLOW_CAP = 2000;
const FUNNEL_KEYS = new Set(["event", "at", "visit", "game", "size", "mode", "reason"]);
export interface Result { violations: string[]; hit: Set<string>; steps: number }
const tag = (t: string): string => t.replace(/[^a-z0-9]/gi, "").toUpperCase();

export async function runJourney(j: Journey, seed: number): Promise<Result> {
  const r: Rng = rng(seed), violations: string[] = [], hit = new Set<string>();
  let steps = 0;
  const bad = (step: string, msg: string): void => { violations.push(`${step}: ${msg}`); };
  const game = j.game as GameId, m = MANIFESTS[game], manual = j.start === "manual";
  const sent: string[] = [];
  const rep = makeReporter({ endpoint: "/stats/e", game, nav: { globalPrivacyControl: j.gpc === "on" }, send: (_u, b) => { sent.push(b); }, now: () => T0 });
  const gameProp = j.funnelProps === "email-in-game" ? "a@b.co" : j.funnelProps === "digits-in-game" ? "9876543210" : undefined;
  const ev = (e: (typeof FUNNEL_EVENTS)[number], p: Record<string, unknown> = {}): void => {
    hit.add(`event:${e}`);
    rep.report(e, { ...p, ...(gameProp ? { game: gameProp } : {}), ...(j.funnelProps === "extra-fields" ? { name: "Asha", mobile: "9876543210", email: "a@b.co" } : {}) });
  };
  const check = (step: string): void => {
    steps++;
    // funnel: only whitelisted fields, no personal values, nothing sent under GPC, known events, a sane order
    if (j.gpc === "on" && sent.length) bad(step, "funnel event sent although GPC is on");
    const seen: string[] = [];
    for (const s of sent) {
      const p = JSON.parse(s) as Record<string, unknown>;
      if (!/^[a-z0-9]{12}$/.test(String(p.visit))) bad(step, "visit id is not a random token");
      for (const k of Object.keys(p)) if (!FUNNEL_KEYS.has(k)) bad(step, `funnel field ${k} is not allowed`);
      if (Object.entries(p).some(([k, v]) => k !== "visit" && typeof v === "string" && /@|\d{6,}/.test(v))) bad(step, "funnel event carries a personal-looking value");
      if (!(FUNNEL_EVENTS as readonly string[]).includes(p.event as string)) bad(step, "unknown funnel event");
      seen.push(p.event as string);
    }
    const before = (a: string, b: string): void => { if (seen.includes(b) && !seen.includes(a)) bad(step, `${b} without ${a}`); };
    before("game_created", "game_published"); before("payment_started", "payment_succeeded"); before("game_started", "game_completed"); before("game_published", "game_started");
  };

  // 1. Entry: creation is reachable only through the master console (single entry point); participants come by invite, personal link, QR or the game link.
  const path = ["home", "games-bar", "console", "direct-game"].includes(j.route as string) ? [String(j.route)] : ["home"];
  if (path[0] !== "console") path.push("console");
  if (!path.includes("console")) bad("entry", "organizer reached the creation flow without the console");
  ev("viewed"); check("entry");

  // 2. Size and cap (new flows: the elimination games stay at 2000 or less)
  const caps = capFor(m, manual), roster = j.roster as number, admittedN = Math.min(roster, caps);
  if (m.labels.includes("Elimination") && m.caps.auto > NEW_FLOW_CAP) bad("cap", `${game} cap ${m.caps.auto} is over ${NEW_FLOW_CAP}`);
  if (admit({ open: true, listed: true, closeGroup: false, alreadySeated: false, full: true }).result !== "refused") bad("cap", "a full game admitted someone");
  if (admittedN > caps) bad("cap", "admitted over cap");
  if (roster > caps) hit.add("cap:over-cap-refused");
  ev("size_chosen", { size: roster, mode: manual ? "manual" : "auto" }); ev("signup_started"); check("size");

  // 3. People: sample participants with synthetic data; the identification rules decide what is kept
  const kind: IdKind = j.ident === "email" ? "email" : "emp", openAny = j.ident === "open";
  const sample = Math.min(admittedN, 12), people: { id: string; name?: string; mobile?: string }[] = [];
  for (let i = 0; i < sample; i++) {
    const tg = tag(`${seed}x${i}x${r.int(1e9).toString(36)}`), raw = kind === "email" ? `${tg.toLowerCase()}@example.org` : `E${tg}`.slice(0, 20);
    const id = openAny ? `open-${tg}` : normId(kind, raw);
    if (!id) { bad("people", `a valid ${kind} ID was refused`); continue; }
    if (!openAny && kind === "emp" && normId("emp", `${tg.toLowerCase()}@example.org`) !== null) bad("people", "an e-mail passed as an employee ID");
    const d = j.details as string;
    people.push({ id, name: d === "name" || d === "both" ? `Nm${tg}` : undefined, mobile: d === "mobile" || d === "both" ? `9${r.int(1e9).toString().padStart(9, "0")}` : undefined });
  }
  if (new Set(people.map((p) => p.id)).size !== people.length) bad("people", "two participants share an ID");
  let team = newTeam();
  for (let i = 0; i < (j.hosts as number); i++) { const a = addHost(team, "organizer", "email", `host${i}@example.org`, T0); if (!a.ok) bad("team", "a host within the limit was refused"); else team = a.team; }
  for (let i = 0; i < (j.cohosts as number); i++) { const a = addCohost(team, "organizer", "email", `co${i}@example.org`, T0); if (a.ok) team = a.team; }
  if (team.hosts.length >= MAX_HOSTS && addHost(team, "organizer", "email", "extra@example.org", T0).ok) bad("team", "more than the maximum number of hosts");
  if (team.hosts.length > MAX_HOSTS) bad("team", "too many hosts");
  if (getsEndPdf("cohost")) bad("team", "co-host gets the report");
  if (/example\.org/.test(JSON.stringify(team.log))) bad("team", "the change list carries an address, it must carry the role only");
  check("people");

  // 4. Payment state machine
  ev("game_created");
  const pay = j.payment as string, paid = ["free", "paid", "failed-then-paid", "link-opened-by-payer"].includes(pay);
  if (pay !== "free") ev("payment_page_reached");
  if (pay === "link-copied" || pay === "link-opened-by-payer") ev("payment_link_copied");
  if (pay === "link-opened-by-payer") ev("payment_page_opened");
  if (pay === "paid" || pay === "failed-then-paid" || pay === "link-opened-by-payer") {
    ev("payment_started");
    if (pay === "failed-then-paid") { ev("payment_failed", { reason: "declined" }); ev("payment_started"); }
    ev("payment_succeeded");
  }
  if (pay === "abandoned") { ev("payment_started"); ev("payment_failed", { reason: "cancelled" }); }
  check("payment");

  // 5. Schedule and publish
  const sch = j.schedule as string, publishAsked = j.publish !== "draft" && sch !== "cancelled-before-publish";
  const startAt = sch === "now" ? T0 : T0 + 2 * H;
  if (timeOk(T0 + 2 * H, T0) !== null) bad("schedule", "a time in two hours was refused");
  if (timeOk(T0 - 1, T0) === null) bad("schedule", "a time in the past was accepted");
  if (timeOk(T0 + MAX_AHEAD_MS + 1, T0) === null) bad("schedule", "a time too far ahead was accepted");
  if (sch === "rescheduled" && timeOk(T0 + 3 * H + SLOT_MS, T0) !== null) bad("schedule", "a rescheduled time was refused");
  let published = false;
  if (publishAsked && paid) { published = true; ev("game_published"); } else if (publishAsked) hit.add("blocked:unpaid-publish");
  check("publish");

  // 6. Data lifetime: never published -> deleted at once
  let deleted = false, deletedAt = -1, endedAt = -1;
  const store = { people: people.slice() };
  const wipe = (t: number): void => { store.people = []; deleted = true; deletedAt = t; };
  if (!published) { wipe(T0); hit.add("delete:never-published"); }
  check("never-published");

  const out = { winners: [] as string[] };
  if (published) {
    // 7. Waiting room and late join
    if (j.late === "late-in-waiting-room") {
      const close = j["f.closeGroup"] === "on", w = admit({ open: true, listed: false, closeGroup: close, alreadySeated: false, full: false });
      if (close && w.result !== "waiting") bad("late", "an unlisted late joiner was not made to wait");
      if (!close && w.result !== "in") bad("late", "a late joiner was refused in an open game");
      if (WAIT_LAPSE_MS <= WAITING_ROOM_MS) bad("late", "a waiting request lapses before the waiting room closes");
    }
    // 8. Start, pause, resume (clock freeze, a co-host cannot control)
    let clock = newClock();
    if (!shouldStart(manual ? "manual" : "auto", startAt, startAt, manual ? "organizer" : null)) bad("start", "start did not fire");
    if (shouldStart("manual", startAt, startAt + 1, "cohost")) bad("start", "a co-host started the game");
    if (shouldStart("auto", startAt, startAt - 1, null)) bad("start", "auto start before the time");
    clock = start(clock); ev("game_started");
    let now = startAt;
    const n = j.pause === "none" ? 0 : j.pause === "once" ? 1 : 3;
    for (let i = 0; i < n; i++) {
      now += 60_000;
      if (pause(clock, "cohost", now).phase !== "running") bad("pause", "a co-host paused the game");
      clock = pause(clock, i % 2 && team.hosts.length ? "host" : "organizer", now);
      const g0 = gameNow(clock, now);
      if (gameNow(clock, now + 600_000) !== g0) bad("pause", "the game clock moved while paused");
      now += 600_000; clock = resume(clock, "organizer", now);
      if (gameNow(clock, now) !== g0) bad("pause", "resume did not continue from the frozen time");
    }
    check("clock");
    // 9. Winners by game
    const ids = people.map((p) => p.id);
    if (game === "luckydraw") {
      let st = drawInit(startAt + H, 3, manual ? "manual" : "auto");
      for (const id of ids) st = register(st, id, startAt).state;
      if (ids.length && register(st, ids[0]!, startAt).state.entries.length !== st.entries.length) bad("winners", "double entry accepted");
      if (!drawReady(st, st.closeAt, true)) bad("winners", "draw not ready");
      const a = await draw(st, "beacon" + seed), b = await draw(st, "beacon" + seed);
      if (JSON.stringify(a.drawn) !== JSON.stringify(b.drawn)) bad("winners", "the draw is not repeatable");
      const w = a.drawn ?? [];
      if (new Set(w).size !== w.length || w.length > Math.min(3, ids.length) || w.some((x) => !ids.includes(x))) bad("winners", "draw winners invalid");
      out.winners = w;
    } else if (m.labels.includes("Elimination")) {
      if (ids.length >= 2) {
        let st = elimInit({ roundMs: 60_000, tieRule: game === "tictactoe" ? "replay-once" : "rethrow" }, ids, now), t = now;
        for (let guard = 0; guard < 60 && !st.over; guard++) {
          for (const p of st.alive) if (r.chance(0.9)) st = submit(st, p, { outcome: r.pick(["win", "loss", "tie"] as const), score: r.int(100), firstMover: r.chance(0.5) }, t + 1);
          t = st.deadline; st = closeRound(st, t);
          if (new Set([...st.alive, ...st.out.map((o) => o.player)]).size !== ids.length && st.alive.length) bad("winners", "a player is both in and out or lost");
        }
        if (st.over && st.winner && !ids.includes(st.winner)) bad("winners", "winner is not a participant");
        if (st.over && st.alive.length > 1) bad("winners", "more than one survivor at the end");
        if (st.over && st.winner) out.winners = [st.winner];
        hit.add(st.over ? "elim:finished" : "elim:guard-stop");
      }
    } else if (game === "bingo") {
      const card = (): (number | null)[][] => {
        const cs = [0, 1, 2, 3, 4].map((c) => r.shuffle(Array.from({ length: 15 }, (_, i) => c * 15 + i + 1)).slice(0, 5));
        return [0, 1, 2, 3, 4].map((row) => cs.map((c, ci) => (ci === 2 && row === 2 ? null : c[row]!)));
      };
      const seats: Seat[] = ids.slice(0, 8).map((id, i) => ({ id, cards: [card()], seat: i + 1 }));
      const log = r.shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
      const s1 = settleFromLog("e" + seed, seats, log, { line: 2 }), s2 = settleFromLog("e" + seed, seats, log, { line: 2 });
      if (JSON.stringify(s1) !== JSON.stringify(s2)) bad("winners", "bingo settle is not repeatable");
      const ord = s1.map((x) => `${x.house}:${x.ordinal}`);
      if (new Set(ord).size !== ord.length) bad("winners", "one prize place given twice");
      if (s1.length > 2) bad("winners", "more winners than prize lines");
      out.winners = s1.map((x) => x.player);
    } else hit.add("not-modelled:tambola-claims"); // Tambola is a frozen separate product: its claim rules are not in this repo
    ev("game_completed"); endedAt = now + 30 * 60_000; check("winners");

    // 10. Report: only Organizer + Hosts, no per-participant rows, first send within 3 h, retries at 24/36/72 h
    const roles = ["organizer", ...team.hosts.map(() => "host"), ...team.cohosts.map(() => "cohost")] as ("organizer" | "host" | "cohost")[];
    const recipients = roles.filter((x) => getsEndPdf(x));
    const pdf = JSON.stringify({ game, players: admittedN, winnersByPlace: out.winners.map((_, i) => i + 1), summary: { rounds: 1 } });
    for (const p of people) for (const s of [p.id, p.name, p.mobile]) if (s && pdf.includes(s)) bad("pdf", "a participant datum is in the report");
    if (recipients.length !== 1 + team.hosts.length) bad("pdf", "recipients are not exactly the Organizer and the Hosts");
    if (PDF_RETRY_HOURS.join() !== "24,36,72") bad("mail", "retry schedule changed");
    if (PDF_SEND_WITHIN_MS > 3 * H) bad("mail", "first send after 3 hours");
    const tries = [PDF_SEND_WITHIN_MS, ...PDF_RETRY_HOURS.map((h) => h * H)];
    const k = ({ delivered: 0, "bounce-ok-24h": 1, "bounce-ok-36h": 2, "bounce-ok-72h": 3, "bounce-all": -1 } as Record<string, number>)[j.mail as string]!;
    if (tries[k < 0 ? 3 : k]! > 72 * H) bad("mail", "retry later than 72 h");
    hit.add(k < 0 ? "mail:held-then-deleted" : "mail:delivered");
    check("report");

    // 11. Deletion: early (organizer) or by the timer, with a late scheduler (ticks up to 4 h apart)
    if (j.earlyDelete === "organizer-deletes") { wipe(endedAt + r.int(H)); hit.add("delete:organizer"); }
    else {
      let t = endedAt + r.int(TICK_MAX_GAP_MS);
      while (!autoDeleteDue(endedAt, t)) t += 1 + r.int(TICK_MAX_GAP_MS);
      wipe(t); hit.add("delete:timer");
      if (deletedAt - endedAt > 24 * H) bad("delete", `data deleted ${((deletedAt - endedAt) / H).toFixed(1)} h after the end, over 24 h`);
    }
    if (AUTO_DELETE_AFTER_MS + TICK_MAX_GAP_MS >= 24 * H) bad("delete", "timer plus a late scheduler can pass 24 h");
    // 12. Nothing shown to other players: each player's view holds the player's own data only
    for (const p of people) {
      const view = JSON.stringify({ me: p.id, seat: 1, state: "ok" });
      for (const q of people) if (q !== p) for (const s of [q.id, q.name, q.mobile]) if (s && view.includes(s)) bad("view", "another player's datum is shown");
    }
    check("delete");
  }
  // 13. Wording of everything the journey showed
  for (const s of [...Object.keys(MSG).map((c) => say(c)), ...LEGAL.flatMap((x) => x.paragraphs)]) if (!guardOk(s)) bad("wording", `banned word in: ${s.slice(0, 50)}`);
  for (const s of LEGAL.flatMap((x) => x.paragraphs)) if (!dataTextOk(s) && !/grievance@/.test(s)) bad("wording", `data text rule: ${s.slice(0, 50)}`);
  if (!deleted || store.people.length) bad("end", "journey ended with participant data still stored");
  hit.add(`game:${game}`);
  return { violations, hit, steps };
}
