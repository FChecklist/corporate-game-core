// @bun
// common/runner.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, unlinkSync } from "fs";
import { hostname } from "os";

// common/rng.ts
var mix32 = (x) => {
  x = Math.imul(x ^ x >>> 16, 2246822507);
  x = Math.imul(x ^ x >>> 13, 3266489909);
  return (x ^ x >>> 16) >>> 0;
};
var hashStr = (s, salt = 0) => {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0;i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return mix32(h);
};

class Rng {
  a;
  b;
  c;
  d;
  constructor(seed, salt = 0) {
    const lo = seed >>> 0, hi = Math.floor(seed / 4294967296) >>> 0;
    this.a = mix32(lo ^ 2654435769);
    this.b = mix32(hi + 2246822507 + salt);
    this.c = mix32(lo + hi * 31 + salt * 17 + 19088743);
    this.d = 1;
    for (let i = 0;i < 12; i++)
      this.u32();
  }
  u32() {
    const t = (this.a + this.b | 0) + this.d | 0;
    this.d = this.d + 1 | 0;
    this.a = this.b ^ this.b >>> 9;
    this.b = this.c + (this.c << 3) | 0;
    this.c = this.c << 21 | this.c >>> 11;
    this.c = this.c + t | 0;
    return t >>> 0;
  }
  float() {
    return this.u32() / 4294967296;
  }
  int(lo, hi) {
    return hi <= lo ? lo : lo + Math.floor(this.float() * (hi - lo + 1));
  }
  chance(p) {
    return this.float() < p;
  }
  pick(xs) {
    return xs[Math.floor(this.float() * xs.length)];
  }
  weighted(xs) {
    let tot = 0;
    for (const x of xs)
      tot += x[1];
    let r = this.float() * tot;
    for (const x of xs) {
      r -= x[1];
      if (r < 0)
        return x[0];
    }
    return xs[xs.length - 1][0];
  }
  shuffle(xs) {
    const o = xs.slice();
    for (let i = o.length - 1;i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      const t = o[i];
      o[i] = o[j];
      o[j] = t;
    }
    return o;
  }
  sample(xs, k) {
    return this.shuffle(xs).slice(0, Math.max(0, Math.min(k, xs.length)));
  }
  hex(nBytes) {
    let s = "";
    for (let i = 0;i < nBytes; i++)
      s += (this.u32() & 255).toString(16).padStart(2, "0");
    return s;
  }
  fork(label) {
    return new Rng(this.u32(), hashStr(label));
  }
}

// common/runner.ts
var M = 16384;
var P = 14;
var paramHash = (key) => [hashStr(key, 0), hashStr(key, 1540483477)];
var clz32 = (x) => x === 0 ? 32 : Math.clz32(x);
function hllAdd(reg, h1, h2) {
  const j = h1 >>> 32 - P;
  const r = clz32(h2) + 1;
  if (r > reg[j])
    reg[j] = r;
}
function hllEstimate(reg) {
  let sum = 0, zeros = 0;
  for (let j = 0;j < M; j++) {
    const v = reg[j];
    sum += Math.pow(2, -v);
    if (v === 0)
      zeros++;
  }
  const alpha = 0.7213 / (1 + 1.079 / M);
  let est = alpha * M * M / sum;
  if (est <= 2.5 * M && zeros > 0)
    est = M * Math.log(M / zeros);
  return Math.round(est);
}
var arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
};
var flag = (name) => process.argv.includes("--" + name);
var num = (name, def) => {
  const v = arg(name);
  return v === undefined ? def : Number(v);
};
var sleepSync = (ms) => {
  if (ms > 0)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
var writeAtomic = (path, text) => {
  const t = path + ".tmp";
  writeFileSync(t, text);
  renameSync(t, path);
};
function safeRun(run, seed, trace) {
  try {
    return run(seed, trace);
  } catch (e) {
    const err = e;
    return { params: { seed, crashed: true }, dims: { crash: "yes" }, checks: 1, fails: [{ rule: "CRASH", sentence: "The real engine threw an error on input the product can produce.", detail: String(err?.stack ?? err).split(`
`).slice(0, 4).join(" | ") }] };
  }
}
function main(meta, run) {
  const ex = arg("explain") !== undefined || flag("explain");
  if (ex) {
    const seed = num("seed", 0);
    const lines = [];
    const r = safeRun(run, seed, (s) => lines.push(s));
    console.log(JSON.stringify({ game: meta.game, sha: meta.sha, seed, params: r.params, dims: r.dims, checks: r.checks, fails: r.fails }, null, 1));
    for (const l of lines)
      console.log("  | " + l);
    process.exit(r.fails.length ? 1 : 0);
  }
  const det = num("determinism", 0);
  if (det > 0) {
    let bad = 0;
    const from = num("from", 0);
    for (let s = from;s < from + det; s++) {
      const a = JSON.stringify(safeRun(run, s, () => {})), b = JSON.stringify(safeRun(run, s, () => {}));
      if (a !== b) {
        bad++;
        if (bad <= 5)
          console.log("NOT DETERMINISTIC at seed", s);
      }
    }
    console.log(`determinism check: ${det} seeds run twice, ${bad} differed`);
    process.exit(bad ? 1 : 0);
  }
  const from = num("from", 0), count = num("count", 1e5), tag = arg("tag", "real");
  const outRoot = arg("out", "out"), dir = `${outRoot}/${meta.game}/${tag}`;
  mkdirSync(dir, { recursive: true });
  const base = `${dir}/chunk-${from}-${count}`;
  const ckptEvery = num("ckpt-every", 20000), duty = Math.min(1, Math.max(0.05, num("duty", 1)));
  const stopFile = arg("stop-file"), maxMin = num("max-minutes", 0), storeFails = num("store-fails", 60), exactLimit = num("exact-limit", 300000);
  const reg = new Uint8Array(M);
  const exact = count <= exactLimit ? new Set : null;
  let st = { game: meta.game, sha: meta.sha, tag, from, count, doneUpTo: from, scenarios: 0, assertions: 0, failedScenarios: 0, failItems: 0, crashes: 0, byRule: {}, byDim: {}, hll: [], distinctExact: null, elapsedMs: 0, host: hostname(), runtime: typeof Bun !== "undefined" ? "bun " + Bun.version : "node " + process.version, startedAt: new Date().toISOString(), finishedAt: null, complete: false };
  if (existsSync(base + ".json") && !flag("force")) {
    console.log("chunk already complete:", base + ".json");
    return;
  }
  if (existsSync(base + ".partial.json") && flag("resume")) {
    st = JSON.parse(readFileSync(base + ".partial.json", "utf8"));
    reg.set(st.hll);
    if (exact)
      console.log("note: resumed run; the exact distinct count covers only the part after the resume");
    console.log(`resuming ${base} at ${st.doneUpTo}`);
  }
  const save = (final) => {
    st.hll = Array.from(reg);
    st.distinctExact = exact ? exact.size : null;
    st.finishedAt = final ? new Date().toISOString() : null;
    st.complete = final && st.doneUpTo >= from + count;
    writeAtomic(final && st.complete ? base + ".json" : base + ".partial.json", JSON.stringify(st));
    if (final && st.complete) {
      try {
        unlinkSync(base + ".partial.json");
      } catch {}
    }
  };
  const t0 = Date.now(), prevElapsed = st.elapsedMs, end = from + count;
  let batchStart = Date.now(), lastLog = Date.now(), stopped = "";
  const noop = () => {};
  for (let seed = st.doneUpTo;seed < end; seed++) {
    const r = safeRun(run, seed, noop);
    st.scenarios++;
    st.assertions += r.checks;
    const key = typeof r.params === "string" ? r.params : JSON.stringify(r.params);
    const [h1, h2] = paramHash(key);
    hllAdd(reg, h1, h2);
    if (exact)
      exact.add(h1 * 2097152 + (h2 >>> 11));
    const failed = r.fails.length > 0;
    if (failed) {
      st.failedScenarios++;
      st.failItems += r.fails.length;
      const seen = new Set;
      for (const f of r.fails) {
        if (f.rule === "CRASH")
          st.crashes++;
        const e = st.byRule[f.rule] ??= { sentence: f.sentence, items: 0, scenarios: 0, seeds: [] };
        e.items++;
        if (!seen.has(f.rule)) {
          seen.add(f.rule);
          e.scenarios++;
          if (e.seeds.length < 10)
            e.seeds.push(seed);
          if (e.scenarios <= storeFails)
            appendFileSync(`${dir}/failures.jsonl`, JSON.stringify({ game: meta.game, sha: meta.sha, tag, seed, rule: f.rule, sentence: f.sentence, params: r.params, dims: r.dims, detail: f.detail, repro: `bun dist/${meta.game}.js --seed ${seed} --explain` }) + `
`);
        }
      }
    }
    for (const d in r.dims) {
      const m = st.byDim[d] ??= {};
      const v = String(r.dims[d]);
      let c = m[v];
      if (!c) {
        if (Object.keys(m).length >= 400) {
          c = m["(other)"] ??= [0, 0];
        } else
          c = m[v] = [0, 0];
      }
      c[0]++;
      if (failed)
        c[1]++;
    }
    st.doneUpTo = seed + 1;
    const n = st.doneUpTo - from;
    if (n % 500 === 0) {
      const now = Date.now();
      if (duty < 1) {
        sleepSync(Math.round((now - batchStart) * (1 / duty - 1)));
      }
      batchStart = Date.now();
      if (now - lastLog > 15000) {
        console.log(`[${new Date().toISOString().slice(11, 19)}] ${meta.game} ${n}/${count}  fails ${st.failedScenarios}  ${(st.scenarios / ((now - t0 + 1) / 1000)).toFixed(0)}/s`);
        lastLog = now;
      }
      if (n % ckptEvery === 0) {
        st.elapsedMs = prevElapsed + Date.now() - t0;
        save(false);
      }
      if (stopFile && existsSync(stopFile)) {
        stopped = "stop file " + stopFile;
        break;
      }
      if (maxMin > 0 && Date.now() - t0 > maxMin * 60000) {
        stopped = "max minutes";
        break;
      }
    }
  }
  st.elapsedMs = prevElapsed + Date.now() - t0;
  save(true);
  console.log(`${stopped ? "STOPPED (" + stopped + ") " : "done "}${meta.game}: ${st.scenarios} scenarios, ${st.assertions} checks, ${st.failedScenarios} failing scenarios, ${st.crashes} crashes, distinct ~${st.distinctExact ?? hllEstimate(reg)}, ${(st.elapsedMs / 1000).toFixed(1)} s${st.complete ? "" : " (partial: rerun with --resume)"}`);
  process.exit(stopped ? 3 : 0);
}

// games/snakes/common.ts
var RULES = {
  "T-01": "A board follows the hard limits: every snake drops and every ladder rises by an allowed length, nothing starts on the first or ends on the last square, no square is used twice, and no ladder goes from the first row into the last two rows. (SPEC s3; board.ts boardProblem)",
  "T-02": "The engine's legality check agrees with a hand-written check on good boards and on deliberately broken boards (every broken board is refused). (SPEC s3; board.ts boardProblem)",
  "T-03": "Nobody can be trapped: from every square a pawn can stand on, the last square can be reached. (SPEC s3 last bullet; board.ts everySquareReachesEnd)",
  "T-04": "A generated board has the asked number of snakes and ladders, and is exactly the same every time it is made from the same game, seat and beacon value (and different for another seat). (SPEC s3 'generated from (game id, seat, B0)'; board.ts generateBoard)",
  "T-05": "Every generated board is equally hard: expected throws within 5% of the target (40 / 54 / 80) and the chance to finish within 20 / 30 / 52 throws inside 7%-25%. (SPEC s3 fairness band; GATES)",
  "T-06": "A board is refused (error) unless it has a real beacon value, a valid size (100, 144, 225) and 6 to 12 snakes and as many ladders. (board.ts generateBoard)",
  "T-07": "The dice are public maths: roll = 1 + (hash of game, seat, turn and beacon value, mod 6), always 1 to 6, equal to the hand-recomputed value, and impossible without a real beacon value. (SPEC s4; play.ts rollFor)",
  "T-08": "The dice are fair: over a few hundred rolls every face shows up about equally often. (SPEC s14 'Dice')",
  "T-09": "One throw: new square = old + roll; a snake head or ladder bottom jumps to the other end; a throw past the last square is not used (exact finish) or finishes (reach-or-pass). (SPEC s4 Movement; play.ts step)",
  "T-10": "A pawn's whole run (square after every turn, ladders, snakes, missed turns, biggest climb, comeback) equals the hand re-play of its dice, and a finished pawn stays finished. (SPEC s4, s6; play.ts advance)",
  "T-20": "In a race every player's square after every turn equals the hand re-play of the dice on that player's own board (missed turns in presence play included). (SPEC s4; race.ts playRace)",
  "T-21": "A race ends exactly when the asked number of players are home (in a team race: when a team is home) or at the turn limit, and not a turn earlier or later. (SPEC s7; race.ts playRace)",
  "T-22": "The ranking has no ties: every place 1..N is used once, in the order finished earlier, higher square, more ladders, fewer missed turns, fate; the order of the player list changes nothing. (SPEC s6.3 and s6.6; race.ts orderPlayers)",
  "T-23": "Every tie in the top-10 list gets a one-line note that names the measure that decided it, and a player who tied nobody gets no note. (SPEC s6.6; race.ts rankPlayers)",
  "T-24": "Milestone, end (finish), biggest-climb, comeback and never-missed prizes go to exactly the player the rules name, a prize is never shared, and a tie is broken the same way every time. (SPEC s6; race.ts settleRace)",
  "T-25": "With one-prize-per-person on nobody wins two prizes (and prizes wait for the end); with it off the winners are exactly those the rules name. (SPEC s6.5; race.ts settleRace)",
  "T-26": "Team race: players are dealt into the asked number of teams (sizes differ by at most one, every player in exactly one team) and the team table and team prizes follow the rules. (config.ts PRIZE_HOUSES team; race.ts teamTable)",
  "T-27": "The crowd picture adds up: the bands hold exactly the number of players, and 'ahead of N%' is the share of players on a lower square. (SPEC s5; race.ts crowdOf)",
  "T-28": "The spectator view shows only places, nicknames and squares: no board, seed or dice, and at most ten leaders. (SPEC s5; view.ts spectatorView)",
  "T-29": "Presence play: a throw counts only from the registered phone, inside the window of its own turn, by the collector's clock; early, late, wrong-phone and unknown-seat claims are refused with their reason and a duplicate counts once. (SPEC s8-9; view.ts acceptThrow)",
  "T-30": "A spectator never throws; a player does. (view.ts mayThrow)",
  "T-31": "The settings path works end to end: validated organizer settings give the race or table that was asked for (players, board, milestones, turn limit, end prizes, play mode, one-prize-per-person, teams). (config.ts + game.ts raceCfgOf / tableCfgOf)",
  "T-40": "Table game: the sealed turn order is a fixed permutation of the seats, lowest fate number first, the same every time. (table.ts turnOrder)",
  "T-41": "Table game: pawns throw one at a time in that order, skipping pawns already home; throw k uses beacon value k; and who is next is right at every stop. (table.ts playTable)",
  "T-42": "Table game: it ends when the asked number of pawns are home or at the throw limit; the ranking has no ties; prizes follow the order of arrival (and the first pawn on or past the milestone). (table.ts rankTable / settleTable)",
  "T-50": "Valid organizer settings are accepted, kept in their short form (defaults dropped), and read back to the same settings. (config.ts validateCfg; lifecycle.ts cfgOfRow)",
  "T-51": "Invalid organizer settings are refused with a plain message, never a crash, and nothing is half-saved or changed in the inputs. (config.ts validateCfg)",
  "T-52": "The prize table matches the documentation: milestone up to 3 winners, end prizes up to 5, team up to 3, climb / comeback / never-missed 1 each. (SPEC s6; config.ts PRIZE_HOUSES)",
  "T-53": "The phones' agreement rule: half of a tiny game (at least 1), 5% (3 to 25) of a bigger one, never more than the people; the number of phones asked to report always covers it. (config.ts quorumFor / votersFor; winners.ts)",
  "T-54": "Race and table settings are refused with a plain message when the player count, turn limit, end prizes, milestones, teams or table size are out of range, and accepted when inside. (race.ts validateRaceCfg; table.ts validateTableCfg)",
  "T-60": "Turn timing: a 10 s window is 6 rounds per turn (4 to the beacon value, 2 for the reveal); a break or a pause pushes every later turn by exactly its whole length and no turn opens inside a pause; after a stop no turn opens. (schedule.ts; game.ts callRoundR)",
  "T-61": "The signed control log is applied by the rules (enough lead rounds, one pause at a time, resume only while paused, extend only a running pause later, nothing after a stop); pause intervals and the stop round equal the hand model. (control.ts resolveControl; ZSD)",
  "T-62": "Duplicates, replays and reordering of the log change nothing; forged, wrong-game and malformed messages are dropped; real Ed25519 signing and checking work and a changed message fails. (control.ts acceptLogDetailed / verifyControlSig)",
  "T-63": "A phone's view of the control log is live while fresh, 'hold' when the endpoint is silent and 'blind' only after a long unbroken run of failures; the lead given to a pause always exceeds the time a phone may keep revealing turns. (control.ts ControlTracker / deriveSafety)",
  "T-64": "Lucky draw: the winners are the n lowest hash ranks among distinct eligible players, the same in any list order; Organizer, Host, Co-host and recently removed people never win. (game.ts luckyWinners / luckyEligible)",
  "T-65": "A brand break shows from the end of the turn before it for its stated length, no turn opens while it shows, and the lucky draw uses the round the break ends. (game.ts activeBreak / luckyRound)",
  "T-70": "Invite-link codes for Organizer, Host, Co-host and guest round-trip, never collide, and unknown codes are refused. (people.ts parseFrom / fromCodeOf)",
  "T-71": "A participant id is read as '<seat>x<hex>' and nothing else. (seat.ts seatOfPid)",
  "T-72": "Employee and e-mail IDs: every spelling of one employee ID cleans to the same text, over-long IDs and e-mails in the ID box are refused, and the two code copies (edge and common engine) agree. (people.ts cleanEmpId / normId; vendor core ids.ts)",
  "T-73": "A cleaned name has no markup, no control or invisible characters, no leading spreadsheet-formula character, at most 60 characters, and never starts or ends with a space. (people.ts cleanName)",
  "T-74": "Roles: only the Organizer, or a Host whose key is approved, can pause and resume; everyone else is refused with the plain message; a pause freezes the game clock and every change is logged by role only. (engine.ts applyPause; core roles.ts / modes.ts)",
  "T-75": "Helpers: up to 5 Hosts (only the Organizer adds one), Co-hosts added by the Organizer or a Host, no duplicates, a Host controls the clock only after the Organizer approves the key, Co-host list limit 10 to 1000 (default 100). (core people.ts; people.ts COHOST_LIMIT_*)",
  "T-76": "Joining: one person one seat; a closed, full or already-seated join is refused; a close group sends unlisted people to the waiting room; a family pass is 4 seats, the same as the invite limit per person. (core roles.ts admit / FAMILY_SEATS; config.ts MAX_INVITES_PER_PERSON)",
  "T-77": "Game life: guests' data goes 20 hours after the end, the report link stops 19 hours after (before the deletion), everything goes at 00:00 IST at the end of day 365; the round clock of the stored game agrees with the beacon's. (lifecycle.ts)",
  "T-80": "Common engine (flag): a throw round moves pawns by the rules (ladders, snakes, reward / punishment / upgrade / downgrade squares), gives the first five finishers places 1 to 5, awards each milestone to the first pawn, cuts survivors at round end, ends the game on its conditions, and a paused clock freezes it. (vendor snakes index.ts step)",
  "T-81": "Common engine (flag): the final ranking lists every player once and never ties; the owner board is sound. (vendor snakes index.ts finalRanking / checkOwnerBoard)"
};

class Ctx {
  trace;
  tr;
  fails = [];
  checks = 0;
  dims = {};
  constructor(trace, tr) {
    this.trace = trace;
    this.tr = tr;
  }
  ok(cond, rule, detail) {
    this.checks++;
    if (cond)
      return;
    let d;
    try {
      d = detail ? detail() : undefined;
    } catch (e) {
      d = "detail failed: " + String(e);
    }
    if (typeof d === "string" && d.length > 400)
      d = d.slice(0, 400) + "...";
    this.fails.push({ rule, sentence: RULES[rule] ?? rule, detail: d });
  }
  t(f) {
    if (this.tr)
      this.trace(f());
  }
  dim(k, v) {
    this.dims[k] = v;
  }
}
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var numsEq = (a, b) => {
  if (a.length !== b.length)
    return false;
  for (let i = 0;i < a.length; i++)
    if (a[i] !== b[i])
      return false;
  return true;
};
var BANK = [
  { name: "100-9x9-exact", board: { size: 100, snakes: 9, ladders: 9, finish: "exact" }, w: 40, U: 12, S: 12 },
  { name: "100-9x9-pass", board: { size: 100, snakes: 9, ladders: 9, finish: "pass" }, w: 10, U: 4, S: 10 },
  { name: "100-6x6-exact", board: { size: 100, snakes: 6, ladders: 6, finish: "exact" }, w: 5, U: 3, S: 8 },
  { name: "100-12x12-exact", board: { size: 100, snakes: 12, ladders: 12, finish: "exact" }, w: 5, U: 3, S: 8 },
  { name: "144-9x9-exact", board: { size: 144, snakes: 9, ladders: 9, finish: "exact" }, w: 8, U: 3, S: 8 },
  { name: "144-10x8-pass", board: { size: 144, snakes: 10, ladders: 8, finish: "pass" }, w: 4, U: 2, S: 8 },
  { name: "225-9x9-exact", board: { size: 225, snakes: 9, ladders: 9, finish: "exact" }, w: 5, U: 2, S: 6 },
  { name: "225-8x8-pass", board: { size: 225, snakes: 8, ladders: 8, finish: "pass" }, w: 3, U: 2, S: 6 },
  { name: "100-8x10-exact", board: { size: 100, snakes: 8, ladders: 10, finish: "exact" }, w: 3, U: 2, S: 6 },
  { name: "100-10x8-pass", board: { size: 100, snakes: 10, ladders: 8, finish: "pass" }, w: 3, U: 2, S: 6 }
];
var BANK_W = BANK.map((b, i) => [i, b.w]);
var ID_FORMATS = [(u) => `SL${u}`, (u) => `snk-${(u * 7919).toString(16)}`, (u) => `G${1e4 + u * 37}`, (u) => `corp_snakes_${u}`, (u) => `Q${"x".repeat(1 + u % 30)}${u}`, (u) => `SNK-2026-${u}-A`];
function universe(ci, u) {
  const k = ci * 100 + u;
  return { game: ID_FORMATS[k % ID_FORMATS.length](k), b0: new Rng(7000 + k, 11).hex(32) };
}
function betasOf(beaconSeed, n) {
  const r = new Rng(beaconSeed, 99), o = [];
  for (let i = 0;i < n; i++)
    o.push(r.hex(32));
  return o;
}
var bucketN = (n) => n === 2 ? "2" : n <= 5 ? "3-5" : n <= 8 ? "6-8" : n <= 12 ? "9-12" : n <= 40 ? "13-40" : n <= 300 ? "41-300" : "300+";

// node_modules/@noble/hashes/esm/cryptoNode.js
import * as nc from "crypto";
var crypto2 = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && ("randomBytes" in nc) ? nc : undefined;

// node_modules/@noble/hashes/esm/utils.js
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean(...arrays) {
  for (let i = 0;i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0;i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0;ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === undefined || n2 === undefined) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0;i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0;i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
class Hash {
}
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes(bytesLength = 32) {
  if (crypto2 && typeof crypto2.getRandomValues === "function") {
    return crypto2.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto2 && typeof crypto2.randomBytes === "function") {
    return Uint8Array.from(crypto2.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE);
  const _32n = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE ? 4 : 0;
  const l = isLE ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE);
  view.setUint32(byteOffset + l, wl, isLE);
}
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}

class HashMD extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0;pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (;blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos;i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0;i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor);
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
}
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0;i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// node_modules/@noble/hashes/esm/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);

class SHA256 extends HashMD {
  constructor(outputLen = 32) {
    super(64, outputLen, 8, false);
    this.A = SHA256_IV[0] | 0;
    this.B = SHA256_IV[1] | 0;
    this.C = SHA256_IV[2] | 0;
    this.D = SHA256_IV[3] | 0;
    this.E = SHA256_IV[4] | 0;
    this.F = SHA256_IV[5] | 0;
    this.G = SHA256_IV[6] | 0;
    this.H = SHA256_IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0;i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16;i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0;i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
}
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);

class SHA512 extends HashMD {
  constructor(outputLen = 64) {
    super(128, outputLen, 16, false);
    this.Ah = SHA512_IV[0] | 0;
    this.Al = SHA512_IV[1] | 0;
    this.Bh = SHA512_IV[2] | 0;
    this.Bl = SHA512_IV[3] | 0;
    this.Ch = SHA512_IV[4] | 0;
    this.Cl = SHA512_IV[5] | 0;
    this.Dh = SHA512_IV[6] | 0;
    this.Dl = SHA512_IV[7] | 0;
    this.Eh = SHA512_IV[8] | 0;
    this.El = SHA512_IV[9] | 0;
    this.Fh = SHA512_IV[10] | 0;
    this.Fl = SHA512_IV[11] | 0;
    this.Gh = SHA512_IV[12] | 0;
    this.Gl = SHA512_IV[13] | 0;
    this.Hh = SHA512_IV[14] | 0;
    this.Hl = SHA512_IV[15] | 0;
  }
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i = 0;i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16;i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0;i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}
var sha256 = /* @__PURE__ */ createHasher(() => new SHA256);
var sha512 = /* @__PURE__ */ createHasher(() => new SHA512);

// node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

// src-snakes-33ed474/packages/beacon/src/board.ts
var BOARD_SIZES = [100, 144, 225];
var DEFAULT_SIZE = 100;
var defaultBoardCfg = () => ({ size: DEFAULT_SIZE, snakes: 9, ladders: 9, finish: "exact" });
var MIN_PER_KIND = 6;
var MAX_PER_KIND = 12;
var sideOf = (size) => Math.round(Math.sqrt(size));
var targetTurnsFor = (size, override) => override ?? (size === 144 ? 54 : size === 225 ? 80 : 40);
var BAND_TOLERANCE = 0.05;
var SPREAD_BAND = { lo: 0.07, hi: 0.25 };
var spreadTurns = (size) => size === 144 ? 30 : size === 225 ? 52 : 20;
function limits(size) {
  const f = sideOf(size) / 10;
  return { minRise: Math.ceil(8 * f), maxRise: Math.floor(30 * f), minDrop: Math.ceil(8 * f), maxDrop: Math.floor(40 * f) };
}
var resolve = (b, sq) => b.snakes[sq] ?? b.ladders[sq] ?? sq;
function seededStream(seed) {
  let counter = 0, buf = new Uint8Array(0), pos = 0;
  const refill = () => {
    buf = sha2562(utf8ToBytes(`${seed}|${counter++}`));
    pos = 0;
  };
  return (n) => {
    const limit = Math.floor(4294967296 / n) * n;
    for (;; ) {
      if (pos + 4 > buf.length)
        refill();
      const v = (buf[pos] << 24 | buf[pos + 1] << 16 | buf[pos + 2] << 8 | buf[pos + 3]) >>> 0;
      pos += 4;
      if (v < limit)
        return v % n;
    }
  };
}
function nextOf(b, s, r, finish) {
  const t = s + r;
  if (t > b.size)
    return finish === "pass" ? b.size : s;
  return resolve(b, t);
}
function boardProblem(b) {
  const L = limits(b.size), side = sideOf(b.size), used = new Set;
  const mark = (x) => {
    if (used.has(x))
      return false;
    used.add(x);
    return true;
  };
  for (const [h, t] of Object.entries(b.snakes).map(([k, v]) => [Number(k), v])) {
    if (h <= 1 || h >= b.size)
      return `snake head ${h} is on the first or last square`;
    if (!(t >= 1 && t < h))
      return `snake ${h} does not go down`;
    if (h - t < L.minDrop || h - t > L.maxDrop)
      return `snake ${h} drops ${h - t}, outside ${L.minDrop} to ${L.maxDrop}`;
    if (!mark(h) || !mark(t))
      return `a square is used twice (snake ${h})`;
  }
  for (const [bo, t] of Object.entries(b.ladders).map(([k, v]) => [Number(k), v])) {
    if (bo <= 1 || t >= b.size)
      return `ladder ${bo} starts on the first square or ends on the last`;
    if (!(t > bo))
      return `ladder ${bo} does not go up`;
    if (t - bo < L.minRise || t - bo > L.maxRise)
      return `ladder ${bo} rises ${t - bo}, outside ${L.minRise} to ${L.maxRise}`;
    if (Math.ceil(bo / side) <= 1 && Math.ceil(t / side) >= side - 1)
      return `ladder ${bo} goes from the first row to the last two rows`;
    if (!mark(bo) || !mark(t))
      return `a square is used twice (ladder ${bo})`;
  }
  return null;
}
function everySquareReachesEnd(b, finish = "exact") {
  const n = b.size, rev = Array.from({ length: n + 1 }, () => []);
  for (let s = 1;s < n; s++)
    for (let r = 1;r <= 6; r++) {
      const t = nextOf(b, s, r, finish);
      if (t !== s)
        rev[t].push(s);
    }
  const seen = new Uint8Array(n + 1);
  seen[n] = 1;
  const q = [n];
  while (q.length) {
    const x = q.pop();
    for (const p of rev[x])
      if (!seen[p]) {
        seen[p] = 1;
        q.push(p);
      }
  }
  for (let s = 1;s < n; s++)
    if (!seen[s] && b.snakes[s] === undefined && b.ladders[s] === undefined)
      return false;
  return true;
}
function expectedTurns(b, finish = "exact") {
  const n = b.size - 1;
  const A = new Float64Array(n * (n + 1));
  const idx = (i, j) => i * (n + 1) + j;
  for (let s = 1;s <= n; s++) {
    const i = s - 1;
    A[idx(i, i)] = (A[idx(i, i)] ?? 0) + 1;
    A[idx(i, n)] = 1;
    for (let r = 1;r <= 6; r++) {
      const t = nextOf(b, s, r, finish);
      if (t < b.size)
        A[idx(i, t - 1)] = (A[idx(i, t - 1)] ?? 0) - 1 / 6;
    }
  }
  for (let c = 0;c < n; c++) {
    let p = c, best = Math.abs(A[idx(c, c)]);
    for (let r = c + 1;r < n; r++) {
      const v = Math.abs(A[idx(r, c)]);
      if (v > best) {
        best = v;
        p = r;
      }
    }
    if (best < 0.000000000001)
      return Infinity;
    if (p !== c)
      for (let j = c;j <= n; j++) {
        const t = A[idx(c, j)];
        A[idx(c, j)] = A[idx(p, j)];
        A[idx(p, j)] = t;
      }
    const d = A[idx(c, c)];
    for (let r = c + 1;r < n; r++) {
      const f = A[idx(r, c)] / d;
      if (f === 0)
        continue;
      for (let j = c;j <= n; j++)
        A[idx(r, j)] -= f * A[idx(c, j)];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1;i >= 0; i--) {
    let s = A[idx(i, n)];
    for (let j = i + 1;j < n; j++)
      s -= A[idx(i, j)] * x[j];
    x[i] = s / A[idx(i, i)];
  }
  return x[0];
}
function finishWithin(b, turns, finish = "exact") {
  let dist = new Float64Array(b.size + 1);
  dist[1] = 1;
  for (let t = 0;t < turns; t++) {
    const nd = new Float64Array(b.size + 1);
    nd[b.size] = dist[b.size];
    for (let s = 1;s < b.size; s++) {
      const p = dist[s];
      if (!p)
        continue;
      for (let r = 1;r <= 6; r++)
        nd[nextOf(b, s, r, finish)] += p / 6;
    }
    dist = nd;
  }
  return dist[b.size];
}
function candidate(rand, cfg) {
  const size = cfg.size, side = sideOf(size), L = limits(size), used = new Set, snakes = {}, ladders = {};
  const free = (x) => !used.has(x);
  for (let i = 0;i < cfg.ladders; i++) {
    let ok = false;
    for (let tries = 0;tries < 60 && !ok; tries++) {
      const bo = 2 + rand(size - 3), rise = L.minRise + rand(L.maxRise - L.minRise + 1), top = bo + rise;
      if (top >= size || !free(bo) || !free(top) || bo === top)
        continue;
      if (Math.ceil(bo / side) <= 1 && Math.ceil(top / side) >= side - 1)
        continue;
      used.add(bo);
      used.add(top);
      ladders[bo] = top;
      ok = true;
    }
    if (!ok)
      return null;
  }
  for (let i = 0;i < cfg.snakes; i++) {
    let ok = false;
    for (let tries = 0;tries < 60 && !ok; tries++) {
      const h = 2 + rand(size - 3), drop = L.minDrop + rand(L.maxDrop - L.minDrop + 1), tail = h - drop;
      if (tail < 1 || !free(h) || !free(tail))
        continue;
      used.add(h);
      used.add(tail);
      snakes[h] = tail;
      ok = true;
    }
    if (!ok)
      return null;
  }
  return { size, snakes, ladders };
}
var isHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);
function generateBoard(gameId, seat, b0Hex, cfg = defaultBoardCfg()) {
  if (!isHex64(b0Hex))
    throw new Error("A board can only be made from the published beacon value B0.");
  if (!BOARD_SIZES.includes(cfg.size))
    throw new Error("Board size must be 100, 144 or 225.");
  if (cfg.snakes < MIN_PER_KIND || cfg.snakes > MAX_PER_KIND || cfg.ladders < MIN_PER_KIND || cfg.ladders > MAX_PER_KIND)
    throw new Error(`A board has ${MIN_PER_KIND} to ${MAX_PER_KIND} snakes and as many ladders.`);
  const rand = seededStream(`SL1|board|${gameId}|${seat}|${b0Hex.toLowerCase()}`);
  const target = targetTurnsFor(cfg.size, cfg.targetTurns), lo = target * (1 - BAND_TOLERANCE), hi = target * (1 + BAND_TOLERANCE);
  for (let attempt = 1;attempt <= 5000; attempt++) {
    const c = candidate(rand, cfg);
    if (!c || boardProblem(c) || !everySquareReachesEnd(c, cfg.finish))
      continue;
    const e = expectedTurns(c, cfg.finish);
    if (!(e >= lo && e <= hi))
      continue;
    const w = finishWithin(c, spreadTurns(cfg.size), cfg.finish);
    if (w < SPREAD_BAND.lo || w > SPREAD_BAND.hi)
      continue;
    return { ...c, side: sideOf(cfg.size), expectedTurns: e, within20: w, attempts: attempt };
  }
  throw new Error("No fair board found for this seed.");
}
var boardKey = (b) => bytesToHex(sha2562(utf8ToBytes(JSON.stringify([Object.entries(b.snakes).sort((x, y) => +x[0] - +y[0]), Object.entries(b.ladders).sort((x, y) => +x[0] - +y[0])])))).slice(0, 16);
// src-snakes-33ed474/packages/beacon/src/play.ts
function rollFor(gameId, seat, turn, bt) {
  if (!isHex64(bt))
    throw new Error("A roll can only be made from the published beacon value of its turn.");
  if (!Number.isInteger(turn) || turn < 0)
    throw new Error("Bad turn number.");
  const h = sha2562(utf8ToBytes(`SL1|roll|${gameId}|${seat}|${turn}|${bt.toLowerCase()}`));
  let v = 0n;
  for (const b of h)
    v = v << 8n | BigInt(b);
  return 1 + Number(v % 6n);
}
var fateOf = (gameId, seat, label) => {
  const h = sha2562(utf8ToBytes(`SL1-TIE|${gameId}|${seat}|tie|${label}`));
  let s = "";
  for (const b of h)
    s += b.toString(16).padStart(2, "0");
  return s;
};
function step(board, from, roll, finish = "exact") {
  if (!Number.isInteger(roll) || roll < 1 || roll > 6)
    throw new Error("A roll is 1 to 6.");
  const t = from + roll;
  if (t > board.size) {
    if (finish === "pass")
      return { from, roll, landed: board.size, to: board.size, kind: "finish" };
    return { from, roll, landed: from, to: from, kind: "overshoot" };
  }
  const to = resolve(board, t);
  const kind = t === board.size ? "finish" : board.ladders[t] !== undefined ? "ladder" : board.snakes[t] !== undefined ? "snake" : "move";
  return { from, roll, landed: t, to, kind };
}
var newRun = (seat) => ({ seat, pos: [], finishedTurn: null, ladders: 0, snakes: 0, missed: 0, bestClimb: 0, bestComeback: 0, history: [], _pending: [] });
var squareOf = (r) => r.pos.length ? r.pos[r.pos.length - 1] : 1;
function advance(board, run, roll, finish = "exact") {
  const t = run.pos.length, cur = squareOf(run);
  if (run.finishedTurn !== null) {
    run.pos.push(cur);
    return run;
  }
  if (roll === null) {
    run.missed++;
    run.pos.push(cur);
    return run;
  }
  const s = step(board, cur, roll, finish);
  run.history.push(s);
  run.pos.push(s.to);
  if (s.kind === "ladder") {
    run.ladders++;
    run.bestClimb = Math.max(run.bestClimb, s.to - s.landed);
  }
  if (s.kind === "snake") {
    run.snakes++;
    run._pending.push({ before: cur, drop: s.landed - s.to });
  }
  if (s.to === board.size)
    run.finishedTurn = t;
  for (let i = run._pending.length - 1;i >= 0; i--) {
    const p = run._pending[i];
    if (s.to >= p.before) {
      run.bestComeback = Math.max(run.bestComeback, p.drop);
      run._pending.splice(i, 1);
    }
  }
  return run;
}
function runFrom(board, seat, rolls, finish = "exact") {
  const r = newRun(seat);
  for (const x of rolls)
    advance(board, r, x, finish);
  return r;
}
// src-snakes-33ed474/packages/beacon/src/race.ts
var DEFAULT_TURN_CAP = 26;
var MAX_TURN_CAP = 150;
var DEFAULT_END_PRIZES = 5;
var MAX_END_PRIZES = 5;
var DEFAULT_MILESTONE = 75;
var defaultRaceCfg = (gameId, players) => ({ gameId, players, board: defaultBoardCfg(), milestones: [DEFAULT_MILESTONE], turnCap: DEFAULT_TURN_CAP, endPrizes: DEFAULT_END_PRIZES, play: "fate", exclusive: false });
var boardCache = new Map;
function boardOf(cfg, seat, b0) {
  const key = `${cfg.gameId}|${seat}|${b0}|${cfg.board.size}|${cfg.board.snakes}|${cfg.board.ladders}|${cfg.board.finish}|${cfg.board.targetTurns ?? ""}`;
  let b = boardCache.get(key);
  if (!b) {
    if (boardCache.size > 30000)
      boardCache.clear();
    b = generateBoard(cfg.gameId, seat, b0, cfg.board);
    boardCache.set(key, b);
  }
  return b;
}
function validateRaceCfg(c) {
  if (!Number.isInteger(c.players) || c.players < 2 || c.players > 1e4)
    return "A game has 2 to 10,000 players.";
  if (!Number.isInteger(c.turnCap) || c.turnCap < 10 || c.turnCap > MAX_TURN_CAP)
    return `The turn limit is 10 to ${MAX_TURN_CAP}.`;
  if (!Number.isInteger(c.endPrizes) || c.endPrizes < 1 || c.endPrizes > MAX_END_PRIZES)
    return "1 to 5 players can win an end prize.";
  if (!Array.isArray(c.milestones) || c.milestones.length > 3 || c.milestones.some((m) => !Number.isInteger(m) || m < 2 || m >= c.board.size))
    return "A milestone is a square between 2 and the one before the last. At most 3 milestones.";
  if (new Set(c.milestones).size !== c.milestones.length)
    return "Two milestones cannot be the same square.";
  if (c.play !== "fate" && c.play !== "presence")
    return "Play mode is fate or presence.";
  if (c.teams !== undefined && (!Number.isInteger(c.teams) || c.teams < 2 || c.teams > 10 || c.teams > c.players))
    return "A team race has 2 to 10 teams, and no more teams than players.";
  return null;
}
function playRace(cfg, input) {
  const err = validateRaceCfg(cfg);
  if (err)
    throw new Error(err);
  const boards = [], runs = [];
  for (let s = 1;s <= cfg.players; s++) {
    boards.push(boardOf(cfg, s, input.b0));
    runs.push(newRun(s));
  }
  const st = { cfg, b0: input.b0, runs, boards, turnsPlayed: 0, ended: false, endReason: "running", finishedCount: 0 };
  for (let t = 0;t < input.betas.length && !st.ended; t++) {
    const bt = input.betas[t];
    for (let s = 1;s <= cfg.players; s++) {
      const run = runs[s - 1];
      const throws = cfg.play === "fate" || (input.thrown ? input.thrown(s, t) : false);
      advance(boards[s - 1], run, throws ? rollFor(cfg.gameId, s, t, bt) : null, cfg.board.finish);
    }
    st.turnsPlayed = t + 1;
    st.finishedCount = runs.reduce((n, r) => n + (r.finishedTurn !== null ? 1 : 0), 0);
    if (cfg.teams) {
      if (teamsFinished(cfg, st).length > 0) {
        st.ended = true;
        st.endReason = "finishers";
      }
    } else if (st.finishedCount >= cfg.endPrizes) {
      st.ended = true;
      st.endReason = "finishers";
    }
    if (!st.ended && st.turnsPlayed >= cfg.turnCap) {
      st.ended = true;
      st.endReason = "cap";
    }
  }
  return st;
}
var KEYS = ["finished earlier", "a higher square", "more ladders climbed", "fewer turns missed", "chance"];
function compareChain(gameId, a, b, label) {
  const fa = a.finishedTurn ?? Infinity, fb = b.finishedTurn ?? Infinity;
  if (fa !== fb)
    return { order: fa < fb ? -1 : 1, key: 0 };
  const sa = squareOf(a), sb = squareOf(b);
  if (sa !== sb)
    return { order: sa > sb ? -1 : 1, key: 1 };
  if (a.ladders !== b.ladders)
    return { order: a.ladders > b.ladders ? -1 : 1, key: 2 };
  if (a.missed !== b.missed)
    return { order: a.missed < b.missed ? -1 : 1, key: 3 };
  const x = fateOf(gameId, a.seat, label), y = fateOf(gameId, b.seat, label);
  return { order: x < y ? -1 : x > y ? 1 : a.seat < b.seat ? -1 : 1, key: 4 };
}
function orderPlayers(st) {
  const label = "rank";
  return [...st.runs].sort((a, b) => compareChain(st.cfg.gameId, a, b, label).order);
}
function rankPlayers(st, n = 10) {
  const all = orderPlayers(st), out = [];
  const label = "rank";
  for (let i = 0;i < Math.min(n, all.length); i++) {
    const r = all[i];
    let note = "";
    const level = (x) => r.finishedTurn !== null ? x.finishedTurn === r.finishedTurn : x.finishedTurn === null && squareOf(x) === squareOf(r);
    const group = all.filter(level);
    if (group.length > 1) {
      let deepest = 0;
      for (let j = 1;j < group.length; j++)
        deepest = Math.max(deepest, compareChain(st.cfg.gameId, group[j - 1], group[j], label).key);
      const where = r.finishedTurn !== null ? `finished on turn ${r.finishedTurn + 1}` : `are on square ${squareOf(r)}`;
      note = `${group.length} players ${where}; decided by ${KEYS[Math.max(deepest, 2)]}`;
      if (r.finishedTurn !== null && deepest < 2)
        note = `${group.length} players ${where}; decided by ${KEYS[2]}`;
    }
    out.push({ rank: i + 1, seat: r.seat, finishedTurn: r.finishedTurn, square: squareOf(r), ladders: r.ladders, missed: r.missed, note });
  }
  return out;
}
function reachTurn(r, m) {
  for (let t = 0;t < r.pos.length; t++)
    if (r.pos[t] >= m)
      return t;
  return -1;
}
function candidates(st, pattern, ordinal) {
  const g = st.cfg.gameId, runs = st.runs;
  const endTurn = Math.max(0, st.turnsPlayed - 1);
  if (pattern === "finish") {
    const fin = runs.filter((r) => r.finishedTurn !== null).sort((a, b) => compareChain(g, a, b, "finish").order);
    if (ordinal > st.cfg.endPrizes)
      return [];
    return fin.map((r) => {
      const same = fin.filter((x) => x.finishedTurn === r.finishedTurn).length;
      return { seat: r.seat, idx: r.finishedTurn, ...same > 1 ? { tied: same } : {} };
    });
  }
  if (pattern === "milestone") {
    const ms = [...st.cfg.milestones].sort((a, b) => a - b), m = ms[ordinal - 1];
    if (m === undefined)
      return [];
    const reached = runs.map((r) => ({ r, t: reachTurn(r, m) })).filter((x) => x.t >= 0);
    reached.sort((a, b) => a.t - b.t || squareOf(b.r) - squareOf(a.r) || (fateOf(g, a.r.seat, `milestone${ordinal}`) < fateOf(g, b.r.seat, `milestone${ordinal}`) ? -1 : 1));
    return reached.map((x) => {
      const same = reached.filter((y) => y.t === x.t).length;
      return { seat: x.r.seat, idx: x.t, ...same > 1 ? { tied: same } : {} };
    });
  }
  if (!st.ended)
    return [];
  if (pattern === "climb" || pattern === "comeback") {
    const val = (r) => pattern === "climb" ? r.bestClimb : r.bestComeback;
    const c = runs.filter((r) => val(r) > 0).sort((a, b) => val(b) - val(a) || (fateOf(g, a.seat, pattern) < fateOf(g, b.seat, pattern) ? -1 : 1));
    return c.map((r) => {
      const same = c.filter((x) => val(x) === val(r)).length;
      return { seat: r.seat, idx: endTurn, ...same > 1 ? { tied: same } : {} };
    });
  }
  if (pattern === "nevermissed") {
    if (st.cfg.play !== "presence")
      return [];
    const c = runs.filter((r) => r.missed === 0).sort((a, b) => fateOf(g, a.seat, pattern) < fateOf(g, b.seat, pattern) ? -1 : 1);
    return c.map((r) => ({ seat: r.seat, idx: endTurn, ...c.length > 1 ? { tied: c.length } : {} }));
  }
  return [];
}
function settleRace(st, lines, pidOf = (s) => String(s), round = 1) {
  if (st.cfg.teams)
    return settleTeams(st, lines, pidOf, round);
  const out = [], won = new Set;
  if (st.cfg.exclusive && !st.ended)
    return out;
  for (const l of lines) {
    if (l.pattern === "team")
      continue;
    const cand = candidates(st, l.pattern, l.ordinal);
    let pick;
    if (l.pattern === "finish")
      pick = cand.filter((c) => !st.cfg.exclusive || !won.has(c.seat))[st.cfg.exclusive ? 0 : l.ordinal - 1];
    else
      pick = cand.find((c) => !st.cfg.exclusive || !won.has(c.seat));
    if (l.pattern === "finish" && st.cfg.exclusive) {
      const free = cand.filter((c) => !won.has(c.seat));
      pick = free[0];
    }
    if (!pick)
      continue;
    won.add(pick.seat);
    out.push({ pattern: l.pattern, ordinal: l.ordinal, idx: pick.idx, pids: [pidOf(pick.seat)], round, ...pick.tied ? { tied: pick.tied } : {} });
  }
  return out;
}
function teamsOf(cfg, b0) {
  const seats = Array.from({ length: cfg.players }, (_, i) => i + 1).sort((a, b) => {
    const x = fateOf(cfg.gameId, a, `team|${b0}`), y = fateOf(cfg.gameId, b, `team|${b0}`);
    return x < y ? -1 : x > y ? 1 : a - b;
  });
  const o = new Array(cfg.players);
  seats.forEach((s, i) => {
    o[s - 1] = i % cfg.teams;
  });
  return o;
}
function teamTable(cfg, st, teamOf) {
  const n = cfg.teams, rows = Array.from({ length: n }, (_, t) => ({ team: t, members: [], finishedTurn: null, avgSquare: 0, ladders: 0, missed: 0, rank: 0, note: "" }));
  for (const r of st.runs) {
    const t = rows[teamOf[r.seat - 1]];
    t.members.push(r.seat);
    t.avgSquare += squareOf(r);
    t.ladders += r.ladders;
    t.missed += r.missed;
  }
  for (const t of rows) {
    const rs = t.members.map((s) => st.runs[s - 1]);
    t.avgSquare = t.members.length ? t.avgSquare / t.members.length : 0;
    t.finishedTurn = rs.length && rs.every((r) => r.finishedTurn !== null) ? Math.max(...rs.map((r) => r.finishedTurn)) : null;
    t.ladders = t.members.length ? t.ladders / t.members.length : 0;
    t.missed = t.members.length ? t.missed / t.members.length : 0;
  }
  const cmp = (a, b) => {
    const fa = a.finishedTurn ?? Infinity, fb = b.finishedTurn ?? Infinity;
    if (fa !== fb)
      return { order: fa < fb ? -1 : 1, key: 0 };
    if (a.avgSquare !== b.avgSquare)
      return { order: a.avgSquare > b.avgSquare ? -1 : 1, key: 1 };
    if (a.ladders !== b.ladders)
      return { order: a.ladders > b.ladders ? -1 : 1, key: 2 };
    if (a.missed !== b.missed)
      return { order: a.missed < b.missed ? -1 : 1, key: 3 };
    const x = fateOf(cfg.gameId, `team${a.team}`, "teamrank"), y = fateOf(cfg.gameId, `team${b.team}`, "teamrank");
    return { order: x < y ? -1 : x > y ? 1 : a.team - b.team, key: 4 };
  };
  rows.sort((a, b) => cmp(a, b).order);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    const level = rows.filter((x) => r.finishedTurn !== null ? x.finishedTurn === r.finishedTurn : x.finishedTurn === null && x.avgSquare === r.avgSquare);
    if (level.length > 1) {
      let d = 0;
      for (let j = 1;j < level.length; j++)
        d = Math.max(d, cmp(level[j - 1], level[j]).key);
      r.note = `${level.length} teams level; decided by ${KEYS[Math.max(d, 2)]}`;
    }
  });
  return rows;
}
function teamsFinished(cfg, st) {
  if (!cfg.teams)
    return [];
  return teamTable(cfg, st, teamsOf(cfg, st.b0)).filter((r) => r.finishedTurn !== null).map((r) => r.team);
}
function settleTeams(st, lines, pidOf, round) {
  const out = [], cfg = st.cfg, table = teamTable(cfg, st, teamsOf(cfg, st.b0));
  if (!st.ended)
    return out;
  for (const l of lines) {
    if (l.pattern !== "team")
      continue;
    const row = table[l.ordinal - 1];
    if (!row)
      continue;
    out.push({ pattern: "team", ordinal: l.ordinal, idx: Math.max(0, st.turnsPlayed - 1), pids: row.members.map(pidOf), round, ...row.note ? { tied: 2 } : {} });
  }
  return out;
}
function crowdOf(st, bandCount = 10) {
  const size = st.cfg.board.size, bands = new Array(bandCount).fill(0), per = size / bandCount;
  const sq = st.runs.map(squareOf);
  for (const s of sq)
    bands[Math.min(bandCount - 1, Math.floor((s - 1) / per))]++;
  const sorted = [...sq].sort((a, b) => a - b);
  const lower = (x) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const m = lo + hi >> 1;
      if (sorted[m] < x)
        lo = m + 1;
      else
        hi = m;
    }
    return lo;
  };
  return { players: st.runs.length, turn: st.turnsPlayed, bands, finished: st.finishedCount, aheadOf: (seat) => Math.round(100 * lower(squareOf(st.runs[seat - 1])) / Math.max(1, st.runs.length)) };
}
// src-snakes-33ed474/packages/beacon/src/table.ts
var defaultTableCfg = (gameId, players) => ({ gameId, players, board: defaultBoardCfg(), winners: Math.min(3, players - 1), maxThrows: 600 });
function validateTableCfg(c) {
  if (!Number.isInteger(c.players) || c.players < 2 || c.players > 20)
    return "A table game has 2 to 20 players.";
  if (!Number.isInteger(c.winners) || c.winners < 1 || c.winners > Math.min(3, c.players - 1))
    return "1 to 3 players win, and at least one player is left over.";
  if (!Number.isInteger(c.maxThrows) || c.maxThrows < c.players * 5)
    return "The throw limit is too small.";
  return null;
}
function turnOrder(gameId, players, b0) {
  return Array.from({ length: players }, (_, i) => i + 1).sort((a, b) => {
    const x = fateOf(gameId, a, `order|${b0}`), y = fateOf(gameId, b, `order|${b0}`);
    return x < y ? -1 : x > y ? 1 : a - b;
  });
}
function playTable(cfg, input) {
  const err = validateTableCfg(cfg);
  if (err)
    throw new Error(err);
  const board = generateBoard(cfg.gameId, "table", input.b0, cfg.board), order = turnOrder(cfg.gameId, cfg.players, input.b0);
  const runs = Array.from({ length: cfg.players }, (_, i) => newRun(i + 1));
  const st = { cfg, board, order, runs, throws: 0, finishedOrder: [], finishThrow: new Map, milestoneIdx: new Map, whoseTurn: order[0], ended: false, endReason: "running" };
  let ptr = 0;
  const skipDone = () => {
    let g = 0;
    while (runs[order[ptr % order.length] - 1].finishedTurn !== null && g++ < order.length)
      ptr++;
  };
  for (let k = 0;k < input.betas.length && !st.ended; k++) {
    skipDone();
    const seat = order[ptr % order.length], run = runs[seat - 1];
    const roll = input.absent?.(seat, k) ? null : rollFor(cfg.gameId, seat, k, input.betas[k]);
    advance(board, run, roll, cfg.board.finish);
    if (run.finishedTurn !== null && !st.finishThrow.has(seat)) {
      st.finishedOrder.push(seat);
      st.finishThrow.set(seat, k);
    }
    if (cfg.milestone !== undefined && !st.milestoneIdx.has(seat) && squareOf(run) >= cfg.milestone)
      st.milestoneIdx.set(seat, k);
    st.throws = k + 1;
    ptr++;
    if (st.finishedOrder.length >= cfg.winners) {
      st.ended = true;
      st.endReason = "winners";
    } else if (st.throws >= cfg.maxThrows) {
      st.ended = true;
      st.endReason = "cap";
    }
  }
  skipDone();
  st.whoseTurn = st.ended ? null : order[ptr % order.length];
  return st;
}
function rankTable(st) {
  const fin = st.finishedOrder.map((s) => st.runs[s - 1]);
  const rest = st.runs.filter((r) => !st.finishThrow.has(r.seat)).sort((a, b) => squareOf(b) - squareOf(a) || b.ladders - a.ladders || a.missed - b.missed || (fateOf(st.cfg.gameId, a.seat, "tablerank") < fateOf(st.cfg.gameId, b.seat, "tablerank") ? -1 : 1));
  return [...fin, ...rest].map((r, i) => ({ rank: i + 1, seat: r.seat, finishedAtThrow: st.finishThrow.get(r.seat) ?? null, square: squareOf(r) }));
}
function settleTable(st, lines, pidOf = (s) => String(s), round = 1) {
  const out = [];
  for (const l of lines) {
    if (l.pattern === "finish") {
      const seat = st.finishedOrder[l.ordinal - 1];
      if (seat !== undefined)
        out.push({ pattern: "finish", ordinal: l.ordinal, idx: st.finishThrow.get(seat), pids: [pidOf(seat)], round });
    } else if (l.pattern === "milestone" && l.ordinal === 1) {
      const first = [...st.milestoneIdx.entries()].sort((a, b) => a[1] - b[1])[0];
      if (first)
        out.push({ pattern: "milestone", ordinal: 1, idx: first[1], pids: [pidOf(first[0])], round });
    }
  }
  return out;
}
// src-snakes-33ed474/packages/beacon/src/view.ts
var mayThrow = (role) => role === "player";
function spectatorView(st, nick = (s) => `Player ${s}`) {
  if ("order" in st) {
    const rows = rankTable(st).slice(0, 10), size = st.board.size, bands = new Array(10).fill(0);
    for (const r of st.runs)
      bands[Math.min(9, Math.floor((squareOf(r) - 1) / (size / 10)))]++;
    return { kind: "table", turn: st.throws, ended: st.ended, players: st.runs.length, finished: st.finishedOrder.length, bands, leaders: rows.map((r) => ({ rank: r.rank, name: nick(r.seat), square: r.square, finished: r.finishedAtThrow !== null })) };
  }
  const c = crowdOf(st), rows = rankPlayers(st, 10);
  return { kind: st.cfg.teams ? "team" : "race", turn: st.turnsPlayed, ended: st.ended, players: c.players, finished: c.finished, bands: c.bands, leaders: rows.map((r) => ({ rank: r.rank, name: nick(r.seat), square: r.square, finished: r.finishedTurn !== null })) };
}
function acceptThrow(c, registered, win) {
  const dev = registered(c.seat);
  if (dev === undefined)
    return { ok: false, reason: "unknown seat" };
  if (dev !== c.device)
    return { ok: false, reason: "wrong device" };
  if (c.arrivalMs < win.openMs)
    return { ok: false, reason: "window not open yet" };
  if (c.arrivalMs >= win.openMs + win.windowSec * 1000)
    return { ok: false, reason: "window closed" };
  return { ok: true };
}

class ThrowRecord {
  seen = new Set;
  perTurn = new Map;
  count = 0;
  add(seat, turn) {
    const k = `${seat}:${turn}`;
    if (this.seen.has(k))
      return false;
    this.seen.add(k);
    this.count++;
    this.perTurn.set(turn, (this.perTurn.get(turn) ?? 0) + 1);
    return true;
  }
  thrown = (seat, turn) => this.seen.has(`${seat}:${turn}`);
  throwsIn(turn) {
    return this.perTurn.get(turn) ?? 0;
  }
}
// src-snakes-33ed474/packages/beacon/src/seat.ts
var seatOfPid = (pid) => {
  const m = /^(\d{1,7})x[0-9a-f]{8,}$/.exec(pid);
  const s = m ? Number(m[1]) : 0;
  return s >= 1 ? s : null;
};
// node_modules/@noble/curves/esm/utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function _abool2(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}"`;
    throw new Error(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function _abytes2(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== undefined;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  abytes(bytes);
  return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
  return hexToBytes(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function equalBytes(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0;i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  let len;
  for (len = 0;n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function _validateObject(object, fields, optFields = {}) {
  if (!object || typeof object !== "object")
    throw new Error("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    const val = object[fieldName];
    if (isOpt && val === undefined)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
  Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
var notImplemented = () => {
  throw new Error("not implemented");
};
function memoized(fn) {
  const map = new WeakMap;
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== undefined)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// node_modules/@noble/curves/esm/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow2(x, power, modulo) {
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
  if (!Fp.eql(Fp.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp, n) {
  const p1div4 = (Fp.ORDER + _1n2) / _4n;
  const root = Fp.pow(n, p1div4);
  assertIsSquare(Fp, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const p5div8 = (Fp.ORDER - _5n) / _8n;
  const n2 = Fp.mul(n, _2n);
  const v = Fp.pow(n2, p5div8);
  const nv = Fp.mul(n, v);
  const i = Fp.mul(Fp.mul(nv, _2n), v);
  const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
  assertIsSquare(Fp, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return (Fp, n) => {
    let tv1 = Fp.pow(n, c4);
    let tv2 = Fp.mul(tv1, c1);
    const tv3 = Fp.mul(tv1, c2);
    const tv4 = Fp.mul(tv1, c3);
    const e1 = Fp.eql(Fp.sqr(tv2), n);
    const e2 = Fp.eql(Fp.sqr(tv3), n);
    tv1 = Fp.cmov(tv1, tv2, e1);
    tv2 = Fp.cmov(tv4, tv3, e2);
    const e3 = Fp.eql(Fp.sqr(tv2), n);
    const root = Fp.cmov(tv1, tv2, e3);
    assertIsSquare(Fp, root, n);
    return root;
  };
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1000)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    if (Fp.is0(n))
      return n;
    if (FpLegendre(Fp, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp.mul(Fp.ONE, cc);
    let t = Fp.pow(n, Q);
    let R = Fp.pow(n, Q1div2);
    while (!Fp.eql(t, Fp.ONE)) {
      if (Fp.is0(t))
        return Fp.ZERO;
      let i = 1;
      let t_tmp = Fp.sqr(t);
      while (!Fp.eql(t_tmp, Fp.ONE)) {
        i++;
        t_tmp = Fp.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = Fp.pow(c, exponent);
      M = i;
      c = Fp.sqr(b);
      t = Fp.mul(t, c);
      R = Fp.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  _validateObject(field, opts);
  return field;
}
function FpPow(Fp, num, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp.ONE;
  if (power === _1n2)
    return num;
  let p = Fp.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = Fp.mul(p, d);
    d = Fp.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : undefined);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp.mul(acc, num);
  }, Fp.ONE);
  const invertedAcc = Fp.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = Fp.mul(acc, inverted[i]);
    return Fp.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  const p1mod2 = (Fp.ORDER - _1n2) / _2n;
  const powered = Fp.pow(n, p1mod2);
  const yes = Fp.eql(powered, Fp.ONE);
  const zero = Fp.eql(powered, Fp.ZERO);
  const no = Fp.eql(powered, Fp.neg(Fp.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== undefined)
    anumber(nBitLength);
  const _nBitLength = nBitLength !== undefined ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLenOrOpts, isLE = false, opts = {}) {
  if (ORDER <= _0n2)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  let _nbitLength = undefined;
  let _sqrt = undefined;
  let modFromBytes = false;
  let allowedLengths = undefined;
  if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
    if (opts.sqrt || isLE)
      throw new Error("cannot specify opts in two arguments");
    const _opts = bitLenOrOpts;
    if (_opts.BITS)
      _nbitLength = _opts.BITS;
    if (_opts.sqrt)
      _sqrt = _opts.sqrt;
    if (typeof _opts.isLE === "boolean")
      isLE = _opts.isLE;
    if (typeof _opts.modFromBytes === "boolean")
      modFromBytes = _opts.modFromBytes;
    allowedLengths = _opts.allowedLengths;
  } else {
    if (typeof bitLenOrOpts === "number")
      _nbitLength = bitLenOrOpts;
    if (opts.sqrt)
      _sqrt = opts.sqrt;
  }
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    isLE,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n2,
    ONE: _1n2,
    allowedLengths,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n2 <= num && num < ORDER;
    },
    is0: (num) => num === _0n2,
    isValidNot0: (num) => !f.is0(num) && f.isValid(num),
    isOdd: (num) => (num & _1n2) === _1n2,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: _sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num) => isLE ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes, skipValidation = true) => {
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      if (modFromBytes)
        scalar = mod(scalar, ORDER);
      if (!skipValidation) {
        if (!f.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    },
    invertBatch: (lst) => FpInvertBatch(f, lst),
    cmov: (a, b, c) => c ? b : a
  });
  return Object.freeze(f);
}

// node_modules/@noble/curves/esm/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes = new WeakMap;
var pointWindowSizes = new WeakMap;
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}

class wNAF {
  constructor(Point, bits) {
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.Fn = Point.Fn;
    this.bits = bits;
  }
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window = 0;window < windows; window++) {
      base = p;
      points.push(base);
      for (let i = 1;i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window = 0;window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window = 0;window < wo.windows; window++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  createCache(P, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
}
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints(points, c);
  validateMSMScalars(scalars, fieldN);
  const plength = points.length;
  const slength = scalars.length;
  if (plength !== slength)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen(BigInt(plength));
  let windowSize = 1;
  if (wbits > 12)
    windowSize = wbits - 3;
  else if (wbits > 4)
    windowSize = wbits - 2;
  else if (wbits > 0)
    windowSize = 2;
  const MASK = bitMask(windowSize);
  const buckets = new Array(Number(MASK) + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits;i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0;j < slength; j++) {
      const scalar = scalars[j];
      const wbits = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits] = buckets[wbits].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero;j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0;j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE });
  }
}
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === undefined)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}

// node_modules/@noble/curves/esm/abstract/edwards.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _8n2 = BigInt(8);
function isEdValidXY(Fp, CURVE, x, y) {
  const x2 = Fp.sqr(x);
  const y2 = Fp.sqr(y);
  const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
  const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
  return Fp.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  const validated = _createCurveFields("edwards", params, extraOpts, extraOpts.FpFnLE);
  const { Fp, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  _validateObject(extraOpts, {}, { uvRatio: "function" });
  const MASK = _2n2 << BigInt(Fn.BYTES * 8) - _1n4;
  const modP = (n) => Fp.create(n);
  const uvRatio = extraOpts.uvRatio || ((u, v) => {
    try {
      return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  });
  if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aextpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ExtendedPoint expected");
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? _8n2 : Fp.inv(Z);
    const x = modP(X * iz);
    const y = modP(Y * iz);
    const zz = Fp.mul(Z, iz);
    if (is0)
      return { x: _0n4, y: _1n4 };
    if (zz !== _1n4)
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    const { a, d } = CURVE;
    if (p.is0())
      throw new Error("bad point: ZERO");
    const { X, Y, Z, T } = p;
    const X2 = modP(X * X);
    const Y2 = modP(Y * Y);
    const Z2 = modP(Z * Z);
    const Z4 = modP(Z2 * Z2);
    const aX2 = modP(X2 * a);
    const left = modP(Z2 * modP(aX2 + Y2));
    const right = modP(Z4 + modP(d * modP(X2 * Y2)));
    if (left !== right)
      throw new Error("bad point: equation left != right (1)");
    const XY = modP(X * Y);
    const ZT = modP(Z * T);
    if (XY !== ZT)
      throw new Error("bad point: equation left != right (2)");
    return true;
  });

  class Point {
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, _1n4, modP(x * y));
    }
    static fromBytes(bytes, zip215 = false) {
      const len = Fp.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes(_abytes2(bytes, len, "point"));
      _abool2(zip215, "zip215");
      const normed = copyBytes(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp.ORDER;
      aInRange("point.y", y, _0n4, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n4);
      const v = modP(d * y2 - a);
      let { isValid, value: x } = uvRatio(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = (x & _1n4) === _1n4;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n4 && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = modP(-x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(bytes, zip215 = false) {
      return Point.fromBytes(ensureBytes("point", bytes), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_2n2);
      return this;
    }
    assertValidity() {
      assertValidMemo(this);
    }
    equals(other) {
      aextpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = modP(X1 * Z2);
      const X2Z1 = modP(X2 * Z1);
      const Y1Z2 = modP(Y1 * Z2);
      const Y2Z1 = modP(Y2 * Z1);
      return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(modP(-this.X), this.Y, this.Z, modP(-this.T));
    }
    double() {
      const { a } = CURVE;
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = modP(X1 * X1);
      const B = modP(Y1 * Y1);
      const C = modP(_2n2 * modP(Z1 * Z1));
      const D = modP(a * A);
      const x1y1 = X1 + Y1;
      const E = modP(modP(x1y1 * x1y1) - A - B);
      const G = D + B;
      const F = G - C;
      const H = D - B;
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    add(other) {
      aextpoint(other);
      const { a, d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = modP(X1 * X2);
      const B = modP(Y1 * Y2);
      const C = modP(T1 * d * T2);
      const D = modP(Z1 * Z2);
      const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
      const F = D - C;
      const G = D + C;
      const H = modP(B - a * A);
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new Error("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.cached(this, scalar, (p) => normalizeZ(Point, p));
      return normalizeZ(Point, [p, f])[0];
    }
    multiplyUnsafe(scalar, acc = Point.ZERO) {
      if (!Fn.isValid(scalar))
        throw new Error("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n4)
        return Point.ZERO;
      if (this.is0() || scalar === _1n4)
        return this;
      return wnaf.unsafe(this, scalar, (p) => normalizeZ(Point, p), acc);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    isTorsionFree() {
      return wnaf.unsafe(this, CURVE.n).is0();
    }
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp.toBytes(y);
      bytes[bytes.length - 1] |= x & _1n4 ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    get ex() {
      return this.X;
    }
    get ey() {
      return this.Y;
    }
    get ez() {
      return this.Z;
    }
    get et() {
      return this.T;
    }
    static normalizeZ(points) {
      return normalizeZ(Point, points);
    }
    static msm(points, scalars) {
      return pippenger(Point, Fn, points, scalars);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    toRawBytes() {
      return this.toBytes();
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n4, modP(CURVE.Gx * CURVE.Gy));
  Point.ZERO = new Point(_0n4, _1n4, _1n4, _0n4);
  Point.Fp = Fp;
  Point.Fn = Fn;
  const wnaf = new wNAF(Point, Fn.BITS);
  Point.BASE.precompute(8);
  return Point;
}

class PrimeEdwardsPoint {
  constructor(ep) {
    this.ep = ep;
  }
  static fromBytes(_bytes) {
    notImplemented();
  }
  static fromHex(_hex) {
    notImplemented();
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  clearCofactor() {
    return this;
  }
  assertValidity() {
    this.ep.assertValidity();
  }
  toAffine(invertedZ) {
    return this.ep.toAffine(invertedZ);
  }
  toHex() {
    return bytesToHex(this.toBytes());
  }
  toString() {
    return this.toHex();
  }
  isTorsionFree() {
    return true;
  }
  isSmallOrder() {
    return false;
  }
  add(other) {
    this.assertSame(other);
    return this.init(this.ep.add(other.ep));
  }
  subtract(other) {
    this.assertSame(other);
    return this.init(this.ep.subtract(other.ep));
  }
  multiply(scalar) {
    return this.init(this.ep.multiply(scalar));
  }
  multiplyUnsafe(scalar) {
    return this.init(this.ep.multiplyUnsafe(scalar));
  }
  double() {
    return this.init(this.ep.double());
  }
  negate() {
    return this.init(this.ep.negate());
  }
  precompute(windowSize, isLazy) {
    return this.init(this.ep.precompute(windowSize, isLazy));
  }
  toRawBytes() {
    return this.toBytes();
  }
}
function eddsa(Point, cHash, eddsaOpts = {}) {
  if (typeof cHash !== "function")
    throw new Error('"hash" function param is required');
  _validateObject(eddsaOpts, {}, {
    adjustScalarBytes: "function",
    randomBytes: "function",
    domain: "function",
    prehash: "function",
    mapToCurve: "function"
  });
  const { prehash } = eddsaOpts;
  const { BASE, Fp, Fn } = Point;
  const randomBytes2 = eddsaOpts.randomBytes || randomBytes;
  const adjustScalarBytes = eddsaOpts.adjustScalarBytes || ((bytes) => bytes);
  const domain = eddsaOpts.domain || ((data, ctx, phflag) => {
    _abool2(phflag, "phflag");
    if (ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  });
  function modN_LE(hash) {
    return Fn.create(bytesToNumberLE(hash));
  }
  function getPrivateScalar(key) {
    const len = lengths.secretKey;
    key = ensureBytes("private key", key, len);
    const hashed = ensureBytes("hashed private key", cHash(key), 2 * len);
    const head = adjustScalarBytes(hashed.slice(0, len));
    const prefix = hashed.slice(len, 2 * len);
    const scalar = modN_LE(head);
    return { head, prefix, scalar };
  }
  function getExtendedPublicKey(secretKey) {
    const { head, prefix, scalar } = getPrivateScalar(secretKey);
    const point = BASE.multiply(scalar);
    const pointBytes = point.toBytes();
    return { head, prefix, scalar, point, pointBytes };
  }
  function getPublicKey(secretKey) {
    return getExtendedPublicKey(secretKey).pointBytes;
  }
  function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
    const msg = concatBytes(...msgs);
    return modN_LE(cHash(domain(msg, ensureBytes("context", context), !!prehash)));
  }
  function sign(msg, secretKey, options = {}) {
    msg = ensureBytes("message", msg);
    if (prehash)
      msg = prehash(msg);
    const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
    const r = hashDomainToScalar(options.context, prefix, msg);
    const R = BASE.multiply(r).toBytes();
    const k = hashDomainToScalar(options.context, R, pointBytes, msg);
    const s = Fn.create(r + k * scalar);
    if (!Fn.isValid(s))
      throw new Error("sign failed: invalid s");
    const rs = concatBytes(R, Fn.toBytes(s));
    return _abytes2(rs, lengths.signature, "result");
  }
  const verifyOpts = { zip215: true };
  function verify(sig, msg, publicKey, options = verifyOpts) {
    const { context, zip215 } = options;
    const len = lengths.signature;
    sig = ensureBytes("signature", sig, len);
    msg = ensureBytes("message", msg);
    publicKey = ensureBytes("publicKey", publicKey, lengths.publicKey);
    if (zip215 !== undefined)
      _abool2(zip215, "zip215");
    if (prehash)
      msg = prehash(msg);
    const mid = len / 2;
    const r = sig.subarray(0, mid);
    const s = bytesToNumberLE(sig.subarray(mid, len));
    let A, R, SB;
    try {
      A = Point.fromBytes(publicKey, zip215);
      R = Point.fromBytes(r, zip215);
      SB = BASE.multiplyUnsafe(s);
    } catch (error) {
      return false;
    }
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
    const RkA = R.add(A.multiplyUnsafe(k));
    return RkA.subtract(SB).clearCofactor().is0();
  }
  const _size = Fp.BYTES;
  const lengths = {
    secretKey: _size,
    publicKey: _size,
    signature: 2 * _size,
    seed: _size
  };
  function randomSecretKey(seed = randomBytes2(lengths.seed)) {
    return _abytes2(seed, lengths.seed, "seed");
  }
  function keygen(seed) {
    const secretKey = utils.randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  }
  function isValidSecretKey(key) {
    return isBytes(key) && key.length === Fn.BYTES;
  }
  function isValidPublicKey(key, zip215) {
    try {
      return !!Point.fromBytes(key, zip215);
    } catch (error) {
      return false;
    }
  }
  const utils = {
    getExtendedPublicKey,
    randomSecretKey,
    isValidSecretKey,
    isValidPublicKey,
    toMontgomery(publicKey) {
      const { y } = Point.fromBytes(publicKey);
      const size = lengths.publicKey;
      const is25519 = size === 32;
      if (!is25519 && size !== 57)
        throw new Error("only defined for 25519 and 448");
      const u = is25519 ? Fp.div(_1n4 + y, _1n4 - y) : Fp.div(y - _1n4, y + _1n4);
      return Fp.toBytes(u);
    },
    toMontgomerySecret(secretKey) {
      const size = lengths.secretKey;
      _abytes2(secretKey, size);
      const hashed = cHash(secretKey.subarray(0, size));
      return adjustScalarBytes(hashed).subarray(0, size);
    },
    randomPrivateKey: randomSecretKey,
    precompute(windowSize = 8, point = Point.BASE) {
      return point.precompute(windowSize, false);
    }
  };
  return Object.freeze({
    keygen,
    getPublicKey,
    sign,
    verify,
    utils,
    Point,
    lengths
  });
}
function _eddsa_legacy_opts_to_new(c) {
  const CURVE = {
    a: c.a,
    d: c.d,
    p: c.Fp.ORDER,
    n: c.n,
    h: c.h,
    Gx: c.Gx,
    Gy: c.Gy
  };
  const Fp = c.Fp;
  const Fn = Field(CURVE.n, c.nBitLength, true);
  const curveOpts = { Fp, Fn, uvRatio: c.uvRatio };
  const eddsaOpts = {
    randomBytes: c.randomBytes,
    adjustScalarBytes: c.adjustScalarBytes,
    domain: c.domain,
    prehash: c.prehash,
    mapToCurve: c.mapToCurve
  };
  return { CURVE, curveOpts, hash: c.hash, eddsaOpts };
}
function _eddsa_new_output_to_legacy(c, eddsa) {
  const Point = eddsa.Point;
  const legacy = Object.assign({}, eddsa, {
    ExtendedPoint: Point,
    CURVE: c,
    nBitLength: Point.Fn.BITS,
    nByteLength: Point.Fn.BYTES
  });
  return legacy;
}
function twistedEdwards(c) {
  const { CURVE, curveOpts, hash, eddsaOpts } = _eddsa_legacy_opts_to_new(c);
  const Point = edwards(CURVE, curveOpts);
  const EDDSA = eddsa(Point, hash, eddsaOpts);
  return _eddsa_new_output_to_legacy(c, EDDSA);
}

// node_modules/@noble/curves/esm/ed25519.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n5 = /* @__PURE__ */ BigInt(0);
var _1n5 = BigInt(1);
var _2n3 = BigInt(2);
var _3n2 = BigInt(3);
var _5n2 = BigInt(5);
var _8n3 = BigInt(8);
var ed25519_CURVE_p = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow2(b2, _2n3, P) * b2 % P;
  const b5 = pow2(b4, _1n5, P) * x % P;
  const b10 = pow2(b5, _5n2, P) * b5 % P;
  const b20 = pow2(b10, _10n, P) * b10 % P;
  const b40 = pow2(b20, _20n, P) * b20 % P;
  const b80 = pow2(b40, _40n, P) * b40 % P;
  const b160 = pow2(b80, _80n, P) * b80 % P;
  const b240 = pow2(b160, _80n, P) * b80 % P;
  const b250 = pow2(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow2(b250, _2n3, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P);
  const v7 = mod(v3 * v3 * v, P);
  const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow, P);
  const vx2 = mod(v * x * x, P);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var Fp = /* @__PURE__ */ (() => Field(ed25519_CURVE.p, { isLE: true }))();
var Fn = /* @__PURE__ */ (() => Field(ed25519_CURVE.n, { isLE: true }))();
var ed25519Defaults = /* @__PURE__ */ (() => ({
  ...ed25519_CURVE,
  Fp,
  hash: sha512,
  adjustScalarBytes,
  uvRatio
}))();
var ed25519 = /* @__PURE__ */ (() => twistedEdwards(ed25519Defaults))();
var SQRT_M1 = ED25519_SQRT_M1;
var SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt("25063068953384623474111414158702152701244531502492656460079210482610430750235");
var INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt("54469307008909316920995813868745141605393597292927456921205312896311721017578");
var ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt("1159843021668779879193775521855586647937357759715417654439879720876111806838");
var D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt("40440834346308536858101042469323190826248399146238708352240133220865137265952");
var invertSqrt = (number) => uvRatio(_1n5, number);
var MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var bytes255ToNumberLE = (bytes) => ed25519.Point.Fp.create(bytesToNumberLE(bytes) & MAX_255B);
function calcElligatorRistrettoMap(r0) {
  const { d } = ed25519_CURVE;
  const P = ed25519_CURVE_p;
  const mod = (n) => Fp.create(n);
  const r = mod(SQRT_M1 * r0 * r0);
  const Ns = mod((r + _1n5) * ONE_MINUS_D_SQ);
  let c = BigInt(-1);
  const D = mod((c - d * r) * mod(r + d));
  let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D);
  let s_ = mod(s * r0);
  if (!isNegativeLE(s_, P))
    s_ = mod(-s_);
  if (!Ns_D_is_sq)
    s = s_;
  if (!Ns_D_is_sq)
    c = r;
  const Nt = mod(c * (r - _1n5) * D_MINUS_ONE_SQ - D);
  const s2 = s * s;
  const W0 = mod((s + s) * D);
  const W1 = mod(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod(_1n5 - s2);
  const W3 = mod(_1n5 + s2);
  return new ed25519.Point(mod(W0 * W3), mod(W2 * W1), mod(W1 * W3), mod(W0 * W2));
}
function ristretto255_map(bytes) {
  abytes(bytes, 64);
  const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
  const R1 = calcElligatorRistrettoMap(r1);
  const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
  const R2 = calcElligatorRistrettoMap(r2);
  return new _RistrettoPoint(R1.add(R2));
}

class _RistrettoPoint extends PrimeEdwardsPoint {
  constructor(ep) {
    super(ep);
  }
  static fromAffine(ap) {
    return new _RistrettoPoint(ed25519.Point.fromAffine(ap));
  }
  assertSame(other) {
    if (!(other instanceof _RistrettoPoint))
      throw new Error("RistrettoPoint expected");
  }
  init(ep) {
    return new _RistrettoPoint(ep);
  }
  static hashToCurve(hex) {
    return ristretto255_map(ensureBytes("ristrettoHash", hex, 64));
  }
  static fromBytes(bytes) {
    abytes(bytes, 32);
    const { a, d } = ed25519_CURVE;
    const P = ed25519_CURVE_p;
    const mod = (n) => Fp.create(n);
    const s = bytes255ToNumberLE(bytes);
    if (!equalBytes(Fp.toBytes(s), bytes) || isNegativeLE(s, P))
      throw new Error("invalid ristretto255 encoding 1");
    const s2 = mod(s * s);
    const u1 = mod(_1n5 + a * s2);
    const u2 = mod(_1n5 - a * s2);
    const u1_2 = mod(u1 * u1);
    const u2_2 = mod(u2 * u2);
    const v = mod(a * d * u1_2 - u2_2);
    const { isValid, value: I } = invertSqrt(mod(v * u2_2));
    const Dx = mod(I * u2);
    const Dy = mod(I * Dx * v);
    let x = mod((s + s) * Dx);
    if (isNegativeLE(x, P))
      x = mod(-x);
    const y = mod(u1 * Dy);
    const t = mod(x * y);
    if (!isValid || isNegativeLE(t, P) || y === _0n5)
      throw new Error("invalid ristretto255 encoding 2");
    return new _RistrettoPoint(new ed25519.Point(x, y, _1n5, t));
  }
  static fromHex(hex) {
    return _RistrettoPoint.fromBytes(ensureBytes("ristrettoHex", hex, 32));
  }
  static msm(points, scalars) {
    return pippenger(_RistrettoPoint, ed25519.Point.Fn, points, scalars);
  }
  toBytes() {
    let { X, Y, Z, T } = this.ep;
    const P = ed25519_CURVE_p;
    const mod = (n) => Fp.create(n);
    const u1 = mod(mod(Z + Y) * mod(Z - Y));
    const u2 = mod(X * Y);
    const u2sq = mod(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod(u1 * u2sq));
    const D1 = mod(invsqrt * u1);
    const D2 = mod(invsqrt * u2);
    const zInv = mod(D1 * D2 * T);
    let D;
    if (isNegativeLE(T * zInv, P)) {
      let _x = mod(Y * SQRT_M1);
      let _y = mod(X * SQRT_M1);
      X = _x;
      Y = _y;
      D = mod(D1 * INVSQRT_A_MINUS_D);
    } else {
      D = D2;
    }
    if (isNegativeLE(X * zInv, P))
      Y = mod(-Y);
    let s = mod((Z - Y) * D);
    if (isNegativeLE(s, P))
      s = mod(-s);
    return Fp.toBytes(s);
  }
  equals(other) {
    this.assertSame(other);
    const { X: X1, Y: Y1 } = this.ep;
    const { X: X2, Y: Y2 } = other.ep;
    const mod = (n) => Fp.create(n);
    const one = mod(X1 * Y2) === mod(Y1 * X2);
    const two = mod(Y1 * Y2) === mod(X1 * X2);
    return one || two;
  }
  is0() {
    return this.equals(_RistrettoPoint.ZERO);
  }
}
_RistrettoPoint.BASE = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.BASE))();
_RistrettoPoint.ZERO = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.ZERO))();
_RistrettoPoint.Fp = /* @__PURE__ */ (() => Fp)();
_RistrettoPoint.Fn = /* @__PURE__ */ (() => Fn)();

// src-snakes-33ed474/packages/beacon/src/control.ts
var PERIOD_SEC = 3;
var MAX_TIMED_PAUSE_ROUNDS = 28800;
var hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
var unhex = (h) => {
  if (!/^([0-9a-f]{2})+$/i.test(h))
    throw new Error("bad hex");
  return Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
};
var subtle = () => globalThis.crypto && ("subtle" in globalThis.crypto) ? globalThis.crypto.subtle : null;
function canonicalBytes(m) {
  if (/[|\s]/.test(m.engagementId) || !m.engagementId)
    throw new Error("engagementId must be non-empty with no spaces or |");
  return new TextEncoder().encode(`CBCTL1|${m.engagementId}|${m.seq}|${m.action}|${m.atBeaconRound}|${m.signedAtRound}|${m.untilRound ?? "-"}`);
}
function signControlWithSecret(secretHex, m) {
  return { ...m, sig: hex(ed25519.sign(canonicalBytes(m), unhex(secretHex))) };
}
var publicKeyFromSecret = (secretHex) => hex(ed25519.getPublicKey(unhex(secretHex)));
async function verifyControlSig(pubKeyHex, m) {
  try {
    if (!/^[0-9a-f]{128}$/i.test(m.sig))
      return false;
    const msg = canonicalBytes(m), sig = unhex(m.sig), pub = unhex(pubKeyHex);
    const s = subtle();
    if (s) {
      try {
        const k = await s.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
        return await s.verify({ name: "Ed25519" }, k, sig, msg);
      } catch {}
    }
    return ed25519.verify(sig, msg, pub);
  } catch {
    return false;
  }
}
var isInt = (n) => Number.isSafeInteger(n) && n >= 0;
function wellFormed(x) {
  return !!x && typeof x === "object" && typeof x.engagementId === "string" && isInt(x.seq) && x.seq >= 1 && ["pause", "resume", "extend", "stop"].includes(x.action) && isInt(x.atBeaconRound) && isInt(x.signedAtRound) && (x.untilRound === undefined || isInt(x.untilRound)) && typeof x.sig === "string";
}
async function acceptLogDetailed(cfg, engagementId, incoming, known = []) {
  const bySeq = new Map;
  for (const m of known)
    bySeq.set(m.seq, m);
  const list = Array.isArray(incoming) ? incoming : [];
  let forged = 0;
  for (const raw of list.slice(0, 500)) {
    if (!wellFormed(raw) || raw.engagementId !== engagementId) {
      forged++;
      continue;
    }
    const have = bySeq.get(raw.seq);
    if (have) {
      if (have.sig !== raw.sig)
        forged++;
      continue;
    }
    if (await verifyControlSig(cfg.pubKey, raw))
      bySeq.set(raw.seq, raw);
    else
      forged++;
  }
  const log = [];
  for (let s = 1;bySeq.has(s); s++)
    log.push(bySeq.get(s));
  return { log, forged };
}
var effEnd = (c, maxPause) => Math.min(c.endedAt ?? Infinity, c.until ?? c.start + maxPause);
function check(m, cfg, cur, stopped) {
  if (stopped)
    return "engagement already stopped";
  if (m.signedAtRound > m.atBeaconRound)
    return "takes effect before it was signed";
  const lead = m.atBeaconRound - m.signedAtRound;
  const paused = cur && cur.start <= m.atBeaconRound && m.atBeaconRound < effEnd(cur, cfg.maxPauseRounds);
  switch (m.action) {
    case "pause":
      if (lead < cfg.leadRounds)
        return `pause needs at least ${cfg.leadRounds} rounds of lead`;
      if (cur && m.atBeaconRound < effEnd(cur, cfg.maxPauseRounds))
        return "already paused";
      if (m.untilRound !== undefined && (m.untilRound <= m.atBeaconRound || m.untilRound - m.atBeaconRound > MAX_TIMED_PAUSE_ROUNDS))
        return "bad pause end";
      return null;
    case "resume":
      if (!paused || !cur)
        return "not paused";
      if (lead < 1)
        return "resume must be after it was signed";
      return m.atBeaconRound > cur.start ? null : "resume before the pause began";
    case "extend":
      if (!cur || !paused)
        return "not paused";
      if (cur.endedAt !== null)
        return "pause already ending";
      if (lead < cfg.leadRounds)
        return `extend needs at least ${cfg.leadRounds} rounds of lead`;
      if (m.untilRound === undefined || m.untilRound - m.atBeaconRound > MAX_TIMED_PAUSE_ROUNDS)
        return "extend needs a sensible end round";
      return m.untilRound > effEnd(cur, cfg.maxPauseRounds) ? null : "extend must move the end later";
    case "stop":
      return lead >= cfg.leadRounds ? null : `stop needs at least ${cfg.leadRounds} rounds of lead`;
  }
}
function resolveControl(cfg, log) {
  const ivs = [];
  let cur = null, stop = null, applied = 0;
  const ignored = [];
  for (const m of [...log].sort((a, b) => a.seq - b.seq)) {
    const why = check(m, cfg, cur, stop !== null);
    if (why) {
      ignored.push({ seq: m.seq, why });
      continue;
    }
    applied++;
    if (m.action === "pause") {
      cur = { start: m.atBeaconRound, until: m.untilRound ?? null, endedAt: null };
      ivs.push(cur);
    } else if (m.action === "resume")
      cur.endedAt = m.atBeaconRound;
    else if (m.action === "extend")
      cur.until = m.untilRound;
    else
      stop = m.atBeaconRound;
  }
  return { intervals: ivs.map((c) => ({ start: c.start, end: effEnd(c, cfg.maxPauseRounds) })), stopRound: stop, ignored, applied };
}
var pausedAt = (s, round) => s.intervals.some((i) => round >= i.start && round < i.end);
function callRound(s, startRound, strideRounds, k) {
  let a = startRound + k * strideRounds;
  for (const i of s.intervals)
    if (a >= i.start)
      a += i.end - i.start;
  return s.stopRound !== null && a >= s.stopRound ? null : a;
}
function deriveSafety(i) {
  const ceil3 = (s) => Math.ceil(s / PERIOD_SEC);
  const worst = i.pollMaxSec + i.cacheTtlSec + i.latencySec;
  const holdAfter = ceil3(worst + i.missedPollsTolerated * i.pollMaxSec);
  const lead = holdAfter + ceil3(i.cacheTtlSec) + 2;
  return { holdAfterRounds: holdAfter, leadRounds: lead, giveUpRounds: Math.max(holdAfter * 6, 60), worstNormalAgeSec: worst, pollMaxSec: i.pollMaxSec };
}
var SAFETY_STANDARD = deriveSafety({ pollMaxSec: 12, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 });
var SAFETY_FAST = deriveSafety({ pollMaxSec: 7, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 });
var SAFETY_LEAN30 = deriveSafety({ pollMaxSec: 36, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 });
var SAFETY_LEAN60 = deriveSafety({ pollMaxSec: 72, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 });
var PAUSE_MAX_PARTICIPANTS = 2000;
function safetyForCap(cap, fast = false) {
  if (cap <= 250)
    return fast ? SAFETY_FAST : SAFETY_STANDARD;
  if (cap <= 1000)
    return SAFETY_LEAN30;
  if (cap <= PAUSE_MAX_PARTICIPANTS)
    return SAFETY_LEAN60;
  return null;
}

class ControlTracker {
  cfg;
  engagementId;
  safety;
  log = [];
  lastGoodRound;
  failingSince = null;
  resolved;
  constructor(cfg, engagementId, safety, joinedAtRound) {
    this.cfg = cfg;
    this.engagementId = engagementId;
    this.safety = safety;
    this.lastGoodRound = joinedAtRound - safety.holdAfterRounds - 1;
    this.resolved = resolveControl(cfg, []);
  }
  get state() {
    return this.resolved;
  }
  async ingest(nowRound, body) {
    const b = body;
    if (!b || typeof b !== "object" || b.engagementId !== this.engagementId || !Array.isArray(b.messages))
      return this.failed(nowRound);
    const { log, forged } = await acceptLogDetailed(this.cfg, this.engagementId, b.messages, this.log);
    if (forged > 0)
      return this.failed(nowRound);
    if (log.length !== this.log.length) {
      this.log = log;
      this.resolved = resolveControl(this.cfg, log);
    }
    this.lastGoodRound = nowRound;
    this.failingSince = null;
    return true;
  }
  failed(nowRound) {
    if (this.failingSince === null)
      this.failingSince = nowRound;
    return false;
  }
  mode(nowRound) {
    if (nowRound - this.lastGoodRound <= this.safety.holdAfterRounds)
      return "live";
    return this.failingSince !== null && nowRound - this.failingSince >= this.safety.giveUpRounds ? "blind" : "hold";
  }
  callRound(startRound, strideRounds, k) {
    return callRound(this.resolved, startRound, strideRounds, k);
  }
}

// src-snakes-33ed474/packages/beacon/src/index.ts
var QUICKNET = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  publicKey: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesisSec: 1692803367,
  periodSec: 3,
  mirrors: [
    "https://api.drand.sh",
    "https://api2.drand.sh",
    "https://api3.drand.sh",
    "https://drand.cloudflare.com"
  ]
};
var downUntil = new Map;
var roundTimeMs = (r, net = QUICKNET) => (net.genesisSec + (r - 1) * net.periodSec) * 1000;
var roundAt = (utcMs, net = QUICKNET) => Math.floor((utcMs / 1000 - net.genesisSec) / net.periodSec) + 1;

// src-snakes-33ed474/packages/beacon/src/schedule.ts
var ROUND_SEC = QUICKNET.periodSec;
var DEFAULT_WINDOW = 10;
var REVEAL_ROUNDS = 2;
var LEAD_ROUNDS = 39;
var betaOffset = (windowSec) => Math.floor(windowSec / ROUND_SEC) + 1;
var turnRounds = (windowSec) => betaOffset(windowSec) + REVEAL_ROUNDS;
var shiftOf = (breaks, t) => breaks.reduce((s, b) => s + (b.after <= t ? b.seconds / ROUND_SEC : 0), 0);
function openRoundOf(st, first, windowSec, breaks, t) {
  let a = first + t * turnRounds(windowSec) + shiftOf(breaks, t);
  if (st) {
    for (const i of st.intervals)
      if (a >= i.start)
        a += i.end - i.start;
    if (st.stopRound !== null && a >= st.stopRound)
      return null;
  }
  return a;
}
var betaRoundOf = (st, first, windowSec, breaks, t) => {
  const o = openRoundOf(st, first, windowSec, breaks, t);
  return o === null ? null : o + betaOffset(windowSec);
};
// src-snakes-33ed474/packages/beacon/src/config.ts
var PRIZE_HOUSES = [
  { id: "milestone", label: "Milestone", how: "The first player on or past the milestone square. Up to 3 milestone squares.", max: 3, kind: "set", dflt: true, squares: "set by the organizer" },
  { id: "finish", label: "Reach the end", how: "Land exactly on the last square. The first five players home win 1st to 5th.", max: 5, kind: "set", dflt: true, squares: "the last square" },
  { id: "team", label: "Team win", how: "Team race only. The best three teams win 1st to 3rd.", max: 3, kind: "set", squares: "all team members" },
  { id: "climb", label: "Biggest climb", how: "The player who took the biggest single ladder.", max: 1, kind: "set", squares: "one ladder" },
  { id: "comeback", label: "Comeback", how: "The biggest fall down a snake that the player then made up.", max: 1, kind: "set", squares: "one snake" },
  { id: "nevermissed", label: "Never missed", how: "Presence mode only. A player who threw in every turn, picked by fate.", max: 1, kind: "set", squares: "every turn" }
];
var HOUSES_LINE = PRIZE_HOUSES.map((h) => `${h.id} = ${h.label} (${h.max === 1 ? "1 winner" : `up to ${h.max} winners`})`).join(", ");
var HOUSES_HELP_LIST = PRIZE_HOUSES.map((h) => `${h.id}: ${h.label}. ${h.how} ${h.max === 1 ? "1 winner." : `Up to ${h.max} winners.`}`);
var HOUSES_HELP = HOUSES_HELP_LIST.join(String.fromCharCode(10));
var HOUSE_ORDER = PRIZE_HOUSES.map((h) => h.id);
var HOUSE_BY_ID = new Map(PRIZE_HOUSES.map((h) => [h.id, h]));
var houseLabel = (id) => HOUSE_BY_ID.get(id)?.label ?? id;
var maxWinnersFor = (id) => HOUSE_BY_ID.get(id)?.max ?? 1;
var LEGACY_MAX_ORDINAL = 3;
var INVITE_CATEGORIES = [
  { id: "family", label: "Family members" },
  { id: "colleagues", label: "Colleagues" },
  { id: "friends", label: "Friends" },
  { id: "dealers", label: "Dealers" },
  { id: "vendors", label: "Vendors" },
  { id: "customers", label: "Customers" },
  { id: "partners", label: "Business partners" },
  { id: "franchisees", label: "Franchisees" },
  { id: "neighbours", label: "Neighbours and community" },
  { id: "guests", label: "Other guests" }
];
var BRAND_COLORS = ["#0B3D91", "#1B7F5C", "#B3261E", "#6A1B9A", "#C26A00", "#00798C", "#37474F", "#AD1457"];
var BRAND_NAME_MAX = 40;
var BRAND_LOGO_MAX_BYTES = 30 * 1024;
var LOGO_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
var LOGO_MAX_RATIO = 4;
var LOGO_STORED_MIN_SIDE = 48;
var LOGO_STORED_MAX_SIDE = 192;
function logoSize(raw, kind) {
  const b = (i) => raw.charCodeAt(i);
  if (kind === "png")
    return raw.length >= 24 ? { w: (b(16) << 24 | b(17) << 16 | b(18) << 8 | b(19)) >>> 0, h: (b(20) << 24 | b(21) << 16 | b(22) << 8 | b(23)) >>> 0 } : null;
  if (kind === "jpeg") {
    let i = 2;
    while (i + 9 < raw.length) {
      if (b(i) !== 255) {
        i++;
        continue;
      }
      const m = b(i + 1);
      if (m === 255) {
        i++;
        continue;
      }
      if (m >= 192 && m <= 207 && m !== 196 && m !== 200 && m !== 204)
        return { h: b(i + 5) << 8 | b(i + 6), w: b(i + 7) << 8 | b(i + 8) };
      i += 2 + (b(i + 2) << 8 | b(i + 3));
    }
    return null;
  }
  if (kind === "webp") {
    const t = raw.slice(12, 16);
    if (t === "VP8 " && raw.length >= 30)
      return { w: (b(26) | b(27) << 8) & 16383, h: (b(28) | b(29) << 8) & 16383 };
    if (t === "VP8L" && raw.length >= 25) {
      const v = b(21) | b(22) << 8 | b(23) << 16 | b(24) * 16777216;
      return { w: (v & 16383) + 1, h: (v >>> 14 & 16383) + 1 };
    }
    if (t === "VP8X" && raw.length >= 30)
      return { w: (b(24) | b(25) << 8 | b(26) << 16) + 1, h: (b(27) | b(28) << 8 | b(29) << 16) + 1 };
  }
  return null;
}
var LOGO_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
function checkBrandLogo(v) {
  if (typeof v !== "string" || v.length > Math.ceil(BRAND_LOGO_MAX_BYTES / 3) * 4 + 40)
    return { ok: false, error: `The logo must be a PNG, JPEG or WebP picture of at most ${BRAND_LOGO_MAX_BYTES / 1024} KB.` };
  const m = LOGO_RE.exec(v);
  if (!m || m[2].length % 4 !== 0)
    return { ok: false, error: "The logo must be a PNG, JPEG or WebP picture." };
  let raw;
  try {
    raw = atob(m[2]);
  } catch {
    return { ok: false, error: "The logo picture could not be read." };
  }
  if (raw.length > BRAND_LOGO_MAX_BYTES)
    return { ok: false, error: `The logo is too big. Keep it under ${BRAND_LOGO_MAX_BYTES / 1024} KB.` };
  const b = (i) => raw.charCodeAt(i);
  const real = raw.length >= 12 && b(0) === 137 && b(1) === 80 && b(2) === 78 && b(3) === 71 ? "png" : raw.length >= 3 && b(0) === 255 && b(1) === 216 && b(2) === 255 ? "jpeg" : raw.length >= 12 && raw.slice(0, 4) === "RIFF" && raw.slice(8, 12) === "WEBP" ? "webp" : "";
  if (!real || real !== m[1])
    return { ok: false, error: "The logo must really be a PNG, JPEG or WebP picture." };
  const d = logoSize(raw, real);
  if (!d || !d.w || !d.h)
    return { ok: false, error: "The logo picture could not be read." };
  const long = Math.max(d.w, d.h), short = Math.min(d.w, d.h);
  if (long > LOGO_STORED_MAX_SIDE)
    return { ok: false, error: `The logo is too large. Its longest side may be at most ${LOGO_STORED_MAX_SIDE} pixels.` };
  if (long < LOGO_STORED_MIN_SIDE)
    return { ok: false, error: `The logo is too small. Its longest side must be at least ${LOGO_STORED_MIN_SIDE} pixels.` };
  if (long > short * LOGO_MAX_RATIO)
    return { ok: false, error: `The logo is too long and thin. It may be at most ${LOGO_MAX_RATIO} times wider than tall.` };
  return { ok: true, bytes: raw.length };
}
var MAX_INVITES_PER_PERSON = 4;
var defaultInvites = () => ({ on: false, per: 4, cats: ["family", "colleagues"] });
var VERIFY_MODES = ["mobile", "id", "either", "both"];
var quorumFor = (people) => people <= 6 ? Math.max(1, Math.ceil(people / 2)) : Math.min(25, Math.max(3, Math.ceil(people * 0.05)));
var votersFor = (people) => people <= 12 ? people : 4 * quorumFor(people);
var MAX_ROUNDS = 1;
var MAX_CALLS = MAX_TURN_CAP;
var GRACE_ROUNDS = 40;
var roundEid = (eid, round) => round <= 1 ? eid : `${eid}~r${round}`;
var PATTERN_ORDER = PRIZE_HOUSES.filter((h) => h.dflt).map((h) => h.id);
var MAX_MID_PER_TICKET = 3;
var maxMidFor = (tickets) => MAX_MID_PER_TICKET * tickets;
var maxEdgeFor = (tickets) => tickets;
var brandMomentsFor = (tickets) => 5 * tickets;
var OPENING_WINDOW_SECONDS = GRACE_ROUNDS * 3;
var autoAfter = (n, k) => Math.min(DEFAULT_TURN_CAP - 1, Math.max(1, Math.round(DEFAULT_TURN_CAP * k / (n + 1))));
var MAX_REWARD_LINES = Math.max(30, PRIZE_HOUSES.reduce((n, h) => n + h.max, 0));
var MAX_ORDINAL = Math.max(LEGACY_MAX_ORDINAL, ...PRIZE_HOUSES.map((h) => h.max));
var KINDS = new Set(["file", "youtube", "slides", "speech", "lucky"]);
var LUCKY_WINNERS = [1, 3, 5, 10];
var defaultRewards = () => [{ pattern: "milestone", scope: "ticket", ordinal: 1, text: "" }, ...[1, 2, 3, 4, 5].map((ordinal) => ({ pattern: "finish", scope: "ticket", ordinal, text: "" }))];
var defaultCfg = () => ({ tickets: 1, rewards: defaultRewards(), breaks: [], rounds: 1, invites: defaultInvites(), opening: [], closing: [] });
var keyOfLine = (l) => l.pattern;
var keysInPlay = (rewards) => {
  const seen = new Set;
  const order = HOUSE_ORDER;
  for (const l of rewards)
    seen.add(keyOfLine(l));
  return order.filter((k) => seen.has(k));
};
var linesFor = (rewards, key) => rewards.filter((l) => keyOfLine(l) === key).sort((a, b) => a.ordinal - b.ordinal);
var breakShift = (breaks, k) => breaks.reduce((s, b) => s + (b.after <= k ? b.seconds / 3 : 0), 0);
var cleanText = (s, max) => typeof s === "string" ? s.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
var YT = /^https:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;
var SITE_MEDIA = /^\/[A-Za-z0-9._-]{1,80}\.(mp4|webm|m4a|mp3)$/i;
var DEFAULT_TZ = "Asia/Kolkata";
var isTimeZone = (z) => {
  if (typeof z !== "string" || z.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(z))
    return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};
function validateCfg(input, base = defaultCfg(), opts = {}) {
  const cfg = { tickets: base.tickets, rewards: base.rewards, breaks: base.breaks, rounds: base.rounds ?? 1, invites: base.invites ?? defaultInvites(), opening: base.opening ?? [], closing: base.closing ?? [], ...base.verify ? { verify: base.verify } : {}, ...base.employeesOnly ? { employeesOnly: true } : {}, ...base.idKind === "email" ? { idKind: "email" } : {}, ...base.name ? { name: base.name } : {}, ...base.brand ? { brand: base.brand } : {}, ...base.mark ? { mark: base.mark } : {}, ...base.join ? { join: base.join } : {}, ...base.tz ? { tz: base.tz } : {}, ...base.mode ? { mode: base.mode } : {}, ...base.play ? { play: base.play } : {}, ...base.board ? { board: base.board } : {}, ...base.milestones ? { milestones: base.milestones } : {}, ...base.turnCap ? { turnCap: base.turnCap } : {}, ...base.endPrizes ? { endPrizes: base.endPrizes } : {}, ...base.exclusive ? { exclusive: base.exclusive } : {}, ...base.teams ? { teams: base.teams } : {}, ...base.theme ? { theme: base.theme } : {} };
  if (input.rounds !== undefined) {
    if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > MAX_ROUNDS)
      return { ok: false, error: "A game has one round. To play again, use Play again: it makes a new game with the same settings." };
    cfg.rounds = input.rounds;
  }
  if (input.tickets !== undefined) {
    if (input.tickets !== 1)
      return { ok: false, error: "Each player has one pawn." };
    cfg.tickets = 1;
  }
  if (input.rewards !== undefined) {
    if (!Array.isArray(input.rewards) || input.rewards.length < 1 || input.rewards.length > MAX_REWARD_LINES)
      return { ok: false, error: `Add between 1 and ${MAX_REWARD_LINES} rewards.` };
    const out = [];
    const seen = new Set;
    for (const r of input.rewards) {
      const pattern = r?.pattern;
      const scope = "ticket";
      const ordinal = r?.ordinal === undefined ? 1 : r.ordinal;
      if (!HOUSE_ORDER.includes(pattern))
        return { ok: false, error: "Unknown prize in the rewards." };
      if (!Number.isInteger(ordinal) || ordinal < 1)
        return { ok: false, error: "A winner number must be 1 or more." };
      const most = Math.max(maxWinnersFor(pattern), opts.stored ? LEGACY_MAX_ORDINAL : 0);
      const kept = base.rewards.some((x) => x.pattern === pattern && x.scope === scope && x.ordinal === ordinal);
      if (ordinal > most && !kept)
        return { ok: false, error: `${houseLabel(pattern)} can have ${most === 1 ? "only 1 winner" : `at most ${most} winners`}. Please remove the extra ones.` };
      const id = `${scope}:${pattern}#${ordinal}`;
      if (seen.has(id))
        return { ok: false, error: "The same reward is listed twice." };
      seen.add(id);
      out.push({ pattern, scope, ordinal, text: cleanText(r?.text, 80) });
    }
    for (const l of out)
      if (l.ordinal > 1 && !out.some((x) => x.pattern === l.pattern && x.scope === l.scope && x.ordinal === l.ordinal - 1))
        return { ok: false, error: "A 2nd, 3rd... reward needs the one before it. Note that sending rewards REPLACES the whole list, so send every reward line each time, with ordinals starting at 1 for each house." };
    cfg.rewards = out;
  }
  if (cfg.rewards.length === 0)
    cfg.rewards = defaultRewards();
  if (input.breaks !== undefined) {
    if (!Array.isArray(input.breaks) || input.breaks.length > maxMidFor(cfg.tickets))
      return { ok: false, error: `At most ${maxMidFor(cfg.tickets)} brand moments during the game with ${cfg.tickets} card${cfg.tickets === 1 ? "" : "s"} per person (lucky draws count too).` };
    const out = [];
    for (const b of input.breaks) {
      const auto = b?.auto === true || b?.after === undefined || b?.after === null || b?.after === "";
      const after = auto ? 0 : b?.after, seconds = auto && (b?.seconds === undefined || b?.seconds === null || b?.seconds === "") ? 60 : b?.seconds, kind = b?.kind;
      if (!auto && (!Number.isInteger(after) || after < 1 || after > MAX_CALLS - 1))
        return { ok: false, error: `A break starts after 1 to ${MAX_CALLS - 1} turns have been played.` };
      if (!Number.isInteger(seconds) || seconds < 15 || seconds > 600 || seconds % 3)
        return { ok: false, error: "A break lasts 15 to 600 seconds, in steps of 3." };
      if (!KINDS.has(kind))
        return { ok: false, error: "A break is a file, a YouTube link, slides, a speech or a lucky draw." };
      const winners = kind === "lucky" ? b?.winners === undefined ? 3 : b.winners : undefined;
      if (kind === "lucky" && !LUCKY_WINNERS.includes(winners))
        return { ok: false, error: "A lucky draw picks 1, 3, 5 or 10 people." };
      const style = kind === "lucky" ? b?.style === undefined || b.style === "" ? "draw" : b.style : undefined;
      if (kind === "lucky" && style !== "draw" && style !== "scratch")
        return { ok: false, error: "A lucky draw is shown as a draw or as a scratch card." };
      if (kind !== "lucky" && b?.style !== undefined && b.style !== "")
        return { ok: false, error: "Only a lucky draw has a style." };
      const title = cleanText(b?.title, 80);
      if (title.length < 2)
        return { ok: false, error: "Give each break a short title." };
      let mediaUrl;
      if (b?.mediaUrl !== undefined && b.mediaUrl !== "") {
        if (typeof b.mediaUrl !== "string" || b.mediaUrl.length > 300 || !(/^https:\/\/[^\s<>"'`]+$/i.test(b.mediaUrl) || SITE_MEDIA.test(b.mediaUrl)))
          return { ok: false, error: "The link must start with https:// and have no spaces." };
        if (kind === "youtube" && !YT.test(b.mediaUrl))
          return { ok: false, error: "That is not a YouTube video link (a youtube.com or youtu.be address). Copy it again from the YouTube Share button, or use a video file link instead." };
        mediaUrl = b.mediaUrl;
      }
      if ((kind === "file" || kind === "youtube") && !mediaUrl)
        return { ok: false, error: "This kind of break needs a link." };
      if (kind === "lucky" && mediaUrl)
        return { ok: false, error: "A lucky draw has no link." };
      out.push({ after, seconds, kind, title, ...mediaUrl ? { mediaUrl } : {}, ...winners ? { winners } : {}, ...style === "scratch" ? { style } : {}, ...auto ? { auto: true } : {} });
    }
    {
      const nAuto = out.filter((x) => x.auto).length;
      let k = 0;
      for (const x of out)
        if (x.auto)
          x.after = autoAfter(nAuto, ++k);
    }
    out.sort((a, b) => a.after - b.after);
    for (let i = 1;i < out.length; i++)
      if (out[i].after === out[i - 1].after)
        return { ok: false, error: "Two breaks cannot start at the same turn." };
    cfg.breaks = out;
  }
  if (input.mark !== undefined) {
    if (input.mark !== "auto" && input.mark !== "tap")
      return { ok: false, error: "Marking is not used in this game." };
    if (input.mark === "tap")
      cfg.mark = "tap";
    else
      delete cfg.mark;
  }
  if (input.join !== undefined) {
    if (input.join !== "name" && input.join !== "phone")
      return { ok: false, error: 'Joining is "name" (guests type their name) or "phone" (guests also give a mobile number).' };
    if (input.join === "phone")
      cfg.join = "phone";
    else
      delete cfg.join;
  }
  if (input.tz !== undefined) {
    if (input.tz === null || input.tz === "")
      delete cfg.tz;
    else if (isTimeZone(input.tz)) {
      if (input.tz === DEFAULT_TZ)
        delete cfg.tz;
      else
        cfg.tz = input.tz;
    } else
      return { ok: false, error: "That time zone is not known. Use a name such as America/New_York or Asia/Kolkata." };
  }
  if (input.name !== undefined) {
    const nm = cleanText(input.name, 60);
    if (nm)
      cfg.name = nm;
    else
      delete cfg.name;
  }
  if (input.brand !== undefined) {
    const bd = input.brand;
    if (bd === null || typeof bd === "object" && !Array.isArray(bd) && Object.keys(bd).length === 0)
      delete cfg.brand;
    else {
      if (typeof bd !== "object" || Array.isArray(bd))
        return { ok: false, error: "The brand needs a name and a colour." };
      for (const k of Object.keys(bd))
        if (k !== "name" && k !== "color" && k !== "logo")
          return { ok: false, error: "The brand has only a name, a colour and a logo." };
      const nm = typeof bd.name === "string" ? bd.name.replace(/[<>`"'&\\]/g, "").replace(/\s+/g, " ").trim() : "";
      if (nm.length < 1 || nm.length > BRAND_NAME_MAX)
        return { ok: false, error: `The brand name is 1 to ${BRAND_NAME_MAX} characters.` };
      const color = typeof bd.color === "string" ? bd.color.trim().toUpperCase() : "";
      if (!BRAND_COLORS.includes(color))
        return { ok: false, error: "Pick one of the brand colours from the list." };
      let logo;
      if (bd.logo !== undefined && bd.logo !== null && bd.logo !== "") {
        const lg = checkBrandLogo(bd.logo);
        if (!lg.ok)
          return lg;
        logo = bd.logo;
      }
      cfg.brand = { name: nm, color, ...logo ? { logo } : {} };
    }
  }
  for (const [field, label, max, isOpening] of [["opening", "before the game starts", maxEdgeFor(cfg.tickets), true], ["closing", "at the end of the game", maxEdgeFor(cfg.tickets), false]]) {
    const raw = input[field];
    if (raw === undefined)
      continue;
    if (!Array.isArray(raw) || raw.length > max)
      return { ok: false, error: `At most ${max} brand moment${max === 1 ? "" : "s"} ${label} with ${cfg.tickets} card${cfg.tickets === 1 ? "" : "s"} per person.` };
    const slots = [];
    for (const b of raw) {
      const kind = b?.kind;
      if (kind === "lucky")
        return { ok: false, error: "A lucky draw can only be placed during the game." };
      if (!KINDS.has(kind))
        return { ok: false, error: "A brand moment is a message, slides, a YouTube link or a video or audio file." };
      const title = cleanText(b?.title, 80);
      if (title.length < 2)
        return { ok: false, error: "Give each brand moment a short message or title." };
      let mediaUrl;
      if (b?.mediaUrl !== undefined && b.mediaUrl !== "") {
        if (typeof b.mediaUrl !== "string" || b.mediaUrl.length > 300 || !(/^https:\/\/[^\s<>"'`]+$/i.test(b.mediaUrl) || SITE_MEDIA.test(b.mediaUrl)))
          return { ok: false, error: "The link must start with https:// and have no spaces." };
        if (kind === "youtube" && !YT.test(b.mediaUrl))
          return { ok: false, error: "That is not a YouTube video link (a youtube.com or youtu.be address). Copy it again from the YouTube Share button, or use a video file link instead." };
        mediaUrl = b.mediaUrl;
      }
      if ((kind === "file" || kind === "youtube") && !mediaUrl)
        return { ok: false, error: "This kind of brand moment needs a link." };
      let seconds;
      if (isOpening) {
        seconds = b?.seconds === undefined || b?.seconds === null || b?.seconds === "" ? 60 : b.seconds;
        if (!Number.isInteger(seconds) || seconds < 15 || seconds > OPENING_WINDOW_SECONDS || seconds % 3)
          return { ok: false, error: `An opening lasts 15 to ${OPENING_WINDOW_SECONDS} seconds, in steps of 3 (for example 30, 60 or 90). A time left empty counts as 60.` };
      }
      slots.push({ kind, title, ...mediaUrl ? { mediaUrl } : {}, ...seconds !== undefined ? { seconds } : {} });
    }
    if (isOpening && slots.reduce((t, x) => t + (x.seconds ?? 0), 0) > OPENING_WINDOW_SECONDS)
      return { ok: false, error: `Openings must fit together in the ${OPENING_WINDOW_SECONDS / 60} minutes before the first turn. An opening with no time counts as 60 seconds.` };
    if (isOpening)
      cfg.opening = slots;
    else
      cfg.closing = slots;
  }
  if (input.mode !== undefined) {
    if (input.mode !== "race" && input.mode !== "team" && input.mode !== "table")
      return { ok: false, error: 'The game type is "race", "team" or "table".' };
    if (input.mode === "race")
      delete cfg.mode;
    else
      cfg.mode = input.mode;
  }
  if (input.play !== undefined) {
    if (input.play !== "fate" && input.play !== "presence")
      return { ok: false, error: 'Play is "fate" (every throw is automatic) or "presence" (a player who does not throw in time misses the turn).' };
    if (input.play === "fate")
      delete cfg.play;
    else
      cfg.play = "presence";
  }
  if (input.board !== undefined) {
    const bd = input.board;
    if (bd === null)
      delete cfg.board;
    else {
      if (typeof bd !== "object" || Array.isArray(bd))
        return { ok: false, error: "The board needs a size, snakes, ladders and a finish rule." };
      const size = bd.size ?? 100, snakes = bd.snakes ?? 9, ladders = bd.ladders ?? 9, finish = bd.finish ?? "exact";
      if (!BOARD_SIZES.includes(size))
        return { ok: false, error: "The board has 100, 144 or 225 squares." };
      if (!Number.isInteger(snakes) || !Number.isInteger(ladders) || snakes < MIN_PER_KIND || snakes > MAX_PER_KIND || ladders < MIN_PER_KIND || ladders > MAX_PER_KIND)
        return { ok: false, error: `A board has ${MIN_PER_KIND} to ${MAX_PER_KIND} snakes and ${MIN_PER_KIND} to ${MAX_PER_KIND} ladders.` };
      if (finish !== "exact" && finish !== "pass")
        return { ok: false, error: 'The finish is "exact" (the exact roll) or "pass" (reach or pass the last square).' };
      if (size === 100 && snakes === 9 && ladders === 9 && finish === "exact")
        delete cfg.board;
      else
        cfg.board = { size, snakes, ladders, finish };
    }
  }
  if (input.milestones !== undefined) {
    const ms = input.milestones;
    if (ms === null)
      delete cfg.milestones;
    else {
      const size = cfg.board?.size ?? 100;
      if (!Array.isArray(ms) || ms.length < 1 || ms.length > 3 || ms.some((m) => !Number.isInteger(m) || m < 2 || m >= size) || new Set(ms).size !== ms.length)
        return { ok: false, error: `A milestone is a square from 2 to ${size - 1}. Give 1 to 3 different squares.` };
      const sorted = [...ms].sort((a, b) => a - b);
      if (sorted.length === 1 && sorted[0] === DEFAULT_MILESTONE)
        delete cfg.milestones;
      else
        cfg.milestones = sorted;
    }
  }
  if (input.timeLimit !== undefined && input.timeLimit !== null && input.turnCap === undefined) {
    const m = input.timeLimit;
    if (m === 8)
      delete cfg.turnCap;
    else if (m === 7)
      cfg.turnCap = 23;
    else
      return { ok: false, error: "The time limit is 7 or 8 minutes." };
  }
  if (input.turnCap !== undefined) {
    const v = input.turnCap;
    if (v === null || v === DEFAULT_TURN_CAP)
      delete cfg.turnCap;
    else if (!Number.isInteger(v) || v < 10 || v > MAX_TURN_CAP)
      return { ok: false, error: `The turn limit is 10 to ${MAX_TURN_CAP}.` };
    else
      cfg.turnCap = v;
  }
  if (input.endPrizes !== undefined) {
    const v = input.endPrizes;
    if (v === null || v === DEFAULT_END_PRIZES)
      delete cfg.endPrizes;
    else if (!Number.isInteger(v) || v < 1 || v > MAX_END_PRIZES)
      return { ok: false, error: `The game can end when 1 to ${MAX_END_PRIZES} players are home.` };
    else
      cfg.endPrizes = v;
  }
  if (input.exclusive !== undefined) {
    if (input.exclusive === true)
      cfg.exclusive = true;
    else if (input.exclusive === false || input.exclusive === null)
      delete cfg.exclusive;
    else
      return { ok: false, error: "One prize per person is on (true) or off (false)." };
  }
  if (input.teams !== undefined) {
    const v = input.teams;
    if (v === null)
      delete cfg.teams;
    else if (!Number.isInteger(v) || v < 2 || v > 10)
      return { ok: false, error: "A team race has 2 to 10 teams." };
    else
      cfg.teams = v;
  }
  if (input.theme !== undefined) {
    if (input.theme !== "jungle" && input.theme !== "career")
      return { ok: false, error: 'The look is "jungle" or "career".' };
    if (input.theme === "career")
      cfg.theme = "career";
    else
      delete cfg.theme;
  }
  if (cfg.mode === "team" !== (cfg.teams !== undefined) && (input.mode !== undefined || input.teams !== undefined))
    return { ok: false, error: cfg.mode === "team" ? "A team race needs the number of teams (2 to 10)." : "Teams only exist in a team race." };
  if (cfg.rewards.some((l) => l.pattern === "team") && cfg.mode !== "team")
    return { ok: false, error: "The team prize belongs to a team race." };
  if (cfg.rewards.some((l) => l.pattern === "nevermissed") && cfg.play !== "presence")
    return { ok: false, error: "The never-missed prize belongs to presence play." };
  if (cfg.milestones && cfg.milestones.some((m) => m >= (cfg.board?.size ?? 100)))
    return { ok: false, error: "A milestone must be before the last square." };
  if (cfg.rewards.some((l) => l.pattern === "milestone" && l.ordinal > (cfg.milestones ?? [DEFAULT_MILESTONE]).length))
    return { ok: false, error: "Each milestone prize needs its own milestone square." };
  {
    const t = cfg.tickets;
    if (cfg.breaks.length > maxMidFor(t) || cfg.opening.length > maxEdgeFor(t) || cfg.closing.length > maxEdgeFor(t))
      return { ok: false, error: `With ${t} card${t === 1 ? "" : "s"} per person you can use ${brandMomentsFor(t)} brand moments: ${maxEdgeFor(t)} before the game, ${maxMidFor(t)} during it and ${maxEdgeFor(t)} at the end. Please switch some off.` };
  }
  if (input.verify !== undefined) {
    if (!VERIFY_MODES.includes(input.verify))
      return { ok: false, error: "What a person must give: choose mobile number, employee ID, mobile number or employee ID, or both." };
    if (input.verify === "mobile")
      delete cfg.verify;
    else
      cfg.verify = input.verify;
  }
  if (input.engine !== undefined) {
    if (typeof input.engine !== "boolean")
      return { ok: false, error: "The new rules: say yes or no." };
    if (input.engine)
      cfg.engine = true;
    else {
      delete cfg.engine;
      delete cfg.survivors;
      delete cfg.roundTurns;
    }
  }
  if (input.survivors !== undefined) {
    if (!Number.isInteger(input.survivors) || input.survivors < 0 || input.survivors > 2000)
      return { ok: false, error: "Players who stay in after each round: a whole number from 0 to 2000 (0 = nobody is sent out)." };
    if (input.survivors && cfg.engine)
      cfg.survivors = input.survivors;
    else
      delete cfg.survivors;
  }
  if (input.roundTurns !== undefined) {
    if (!Number.isInteger(input.roundTurns) || input.roundTurns < 1 || input.roundTurns > 60)
      return { ok: false, error: "Turns in a round: a whole number from 1 to 60." };
    if (input.roundTurns !== 10 && cfg.engine)
      cfg.roundTurns = input.roundTurns;
    else
      delete cfg.roundTurns;
  }
  if (input.idKind !== undefined) {
    if (input.idKind !== "email" && input.idKind !== "emp")
      return { ok: false, error: "What the ID is: an employee ID or an Email ID." };
    if (input.idKind === "email")
      cfg.idKind = "email";
    else
      delete cfg.idKind;
  }
  if (input.employeesOnly !== undefined) {
    if (typeof input.employeesOnly !== "boolean")
      return { ok: false, error: "Employees only: say yes or no." };
    if (input.employeesOnly)
      cfg.employeesOnly = true;
    else
      delete cfg.employeesOnly;
  }
  if (input.invites !== undefined) {
    const v = input.invites;
    if (!v || typeof v !== "object" || typeof v.on !== "boolean")
      return { ok: false, error: "Invites: say whether they are on or off." };
    const per = v.per === undefined ? cfg.invites.per : v.per;
    if (!Number.isInteger(per) || per < 1 || per > MAX_INVITES_PER_PERSON)
      return { ok: false, error: `Each person can invite 1 to ${MAX_INVITES_PER_PERSON} people.` };
    const cats = v.cats === undefined ? cfg.invites.cats : v.cats;
    if (!Array.isArray(cats) || cats.some((c) => !INVITE_CATEGORIES.some((k) => k.id === c)))
      return { ok: false, error: "Pick the kinds of guests from the list." };
    const uniq = [...new Set(cats)];
    if (v.on && uniq.length < 1)
      return { ok: false, error: "Pick at least one kind of guest people may invite." };
    cfg.invites = { on: v.on, per, cats: uniq };
  }
  if (cfg.employeesOnly) {
    cfg.invites = { on: false, per: cfg.invites.per, cats: cfg.invites.cats };
    cfg.join = "phone";
  }
  return { ok: true, cfg };
}
var GAME_FIELDS = ["mode", "play", "board", "milestones", "turnCap", "timeLimit", "endPrizes", "exclusive", "teams", "theme"];
var gameFields = (src) => {
  const o = {};
  if (src && typeof src === "object") {
    for (const k of GAME_FIELDS)
      if (src[k] !== undefined)
        o[k] = src[k];
  }
  return o;
};
var gameOut = (c) => {
  const o = {};
  for (const k of GAME_FIELDS)
    if (c[k] !== undefined)
      o[k] = c[k];
  return o;
};

// src-snakes-33ed474/packages/beacon/src/game.ts
function raceCfgOf(eid, cfg, players, round = 1) {
  const board = cfg.board ? { size: cfg.board.size, snakes: cfg.board.snakes, ladders: cfg.board.ladders, finish: cfg.board.finish } : defaultBoardCfg();
  return {
    ...defaultRaceCfg(roundEid(eid, round), players),
    board,
    milestones: cfg.milestones ?? [DEFAULT_MILESTONE],
    turnCap: cfg.turnCap ?? DEFAULT_TURN_CAP,
    endPrizes: cfg.endPrizes ?? DEFAULT_END_PRIZES,
    play: cfg.play ?? "fate",
    exclusive: cfg.exclusive === true,
    ...cfg.mode === "team" && cfg.teams ? { teams: cfg.teams } : {}
  };
}
function tableCfgOf(eid, cfg, players, round = 1) {
  const board = cfg.board ? { size: cfg.board.size, snakes: cfg.board.snakes, ladders: cfg.board.ladders, finish: cfg.board.finish } : defaultBoardCfg();
  const winners = Math.max(1, Math.min(cfg.endPrizes ?? 3, 3, players - 1));
  return { ...defaultTableCfg(roundEid(eid, round), players), board, winners, milestone: (cfg.milestones ?? [DEFAULT_MILESTONE])[0] };
}
function playGame(eid, cfg, players, input, round = 1) {
  if (cfg.mode === "table")
    return { kind: "table", st: playTable(tableCfgOf(eid, cfg, players, round), input) };
  return { kind: "race", st: playRace(raceCfgOf(eid, cfg, players, round), input) };
}
function settleGame(g, cfg, pids, round = 1) {
  const pidOf = (seat) => pids[seat - 1] ?? String(seat);
  const lines = cfg.rewards;
  return g.kind === "table" ? settleTable(g.st, lines, pidOf, round) : settleRace(g.st, lines, pidOf, round);
}
function callRoundR(st, start, strideRounds, breaks, round, k) {
  if (round !== 1)
    return null;
  let a = start + k * strideRounds + breaks.reduce((s, b) => s + (b.after <= k ? b.seconds / ROUND_SEC : 0), 0);
  if (st) {
    for (const i of st.intervals)
      if (a >= i.start)
        a += i.end - i.start;
    if (st.stopRound !== null && a >= st.stopRound)
      return null;
  }
  return a;
}
var callRoundFull = (st, start, stride, breaks, k) => callRoundR(st, start, stride, breaks, 1, k);
function luckyRound(st, start, stride, breaks, b) {
  const prev = callRoundFull(st, start, stride, breaks, b.after - 1);
  return prev === null ? null : prev + betaOffsetOfStride(stride) + b.seconds / ROUND_SEC;
}
var betaOffsetOfStride = (stride) => stride;
function activeBreak(st, start, stride, breaks, nowRound) {
  for (const b of breaks) {
    const prev = callRoundFull(st, start, stride, breaks, b.after - 1);
    if (prev === null)
      continue;
    const from = prev + stride, to = from + b.seconds / ROUND_SEC;
    if (nowRound >= from && nowRound < to)
      return { brk: b, endsAtRound: to };
  }
  return null;
}
function luckyWinners(engagementId, breakAfter, randomnessHex, pids, n) {
  const rank = (pid) => bytesToHex(sha2562(utf8ToBytes(`SL1-LUCKY|${engagementId}|${breakAfter}|${randomnessHex}|${pid}`)));
  return [...new Set(pids)].map((pid) => [rank(pid), pid]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).slice(0, Math.max(0, n)).map((x) => x[1]);
}
var LUCKY_REMOVAL_MARGIN_MS = 30000;
function luckyEligible(seats, drawMs) {
  return seats.filter((s) => !s.ex && !(typeof s.removedMs === "number" && s.removedMs + LUCKY_REMOVAL_MARGIN_MS <= drawMs)).map((s) => s.pid);
}
// src-snakes-33ed474/apps/edge/src/pii.ts
var enc = new TextEncoder;
var dec = new TextDecoder;
var AAD = enc.encode("corporate-snakes-and-ladders/pii/v1");
var keys = new Map;
// src-snakes-33ed474/apps/edge/src/phonekit.ts
var KNOWN_DIAL = new Set("1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 509 590 591 592 593 594 595 596 597 598 599 670 673 674 675 676 677 678 679 680 682 685 686 687 688 689 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998".split(" "));

// src-snakes-33ed474/apps/edge/src/checkin.ts
var CHECKIN_FROM_MS = Date.UTC(2026, 9, 23, 10, 0, 0);
var CHECKIN_OPENS_BEFORE_MS = 5 * 60000;
var CHECKIN_LOCK_MS = 10 * 60000;
var checkinRequired = (_e) => false;
var checkinOpensMs = (startMs) => startMs - CHECKIN_OPENS_BEFORE_MS;
var seatOfPidText = (pid) => {
  const m = /^(\d{1,6})x/.exec(String(pid));
  return m ? Number(m[1]) : null;
};
var ticketId = (eid, seat) => `${eid}-T${String(seat).padStart(4, "0")}`;

// src-snakes-33ed474/apps/edge/src/emailclean.ts
var cleanEmail = (raw) => String(raw ?? "").normalize("NFKC").trim().replace(/[\s\u200B-\u200D\u2060\uFEFF\u0085\u2028\u2029]+/g, "").toLowerCase();
// src-snakes-33ed474/apps/edge/src/people.ts
var COHOST_FROM = 1e9;
var HOST_FROM = 1500000000;
var ORG_FROM = 1900000000;
var COHOST_LIMIT_DEFAULT = 100;
var COHOST_LIMIT_MIN = 10;
var COHOST_LIMIT_MAX = 1000;
var encoder = new TextEncoder;
var cleanEmpId = (raw) => String(raw ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
var normEmp = (raw, clean = false) => {
  if (clean) {
    const typed = String(raw ?? "").trim();
    if (!typed)
      return "";
    const s = cleanEmpId(typed);
    return s && s.length <= 30 ? s : null;
  }
  const s = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
  if (!s)
    return "";
  return /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(s) ? s : null;
};
var looksLikeEmail = (raw) => String(raw ?? "").normalize("NFKC").includes("@");
var EMAIL_ID_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
var normId = (raw, kind, clean = false) => {
  if (kind === "email") {
    const k = cleanEmail(raw);
    if (!k)
      return "";
    return EMAIL_ID_RE.test(k) && k.length <= 254 ? k : null;
  }
  if (looksLikeEmail(raw))
    return null;
  return normEmp(raw, clean);
};
var cleanName = (n) => typeof n === "string" ? Array.from(n).filter((ch) => {
  const c = ch.charCodeAt(0);
  return !(c < 32 || c === 127 || c >= 8203 && c <= 8207 || c === 8232 || c === 8233 || c === 65279);
}).join("").replace(/[<>`]/g, "").replace(/\s+/g, " ").replace(/^[=+\-@\s]+/, "").trim().slice(0, 60) : "";
function parseFrom(from) {
  if (!Number.isInteger(from) || from < 1)
    return null;
  const f = from;
  if (f === ORG_FROM)
    return { kind: "org" };
  if (f >= HOST_FROM && f < HOST_FROM + 268435456)
    return { kind: "host", hex: (f - HOST_FROM).toString(16).padStart(7, "0") };
  if (f >= COHOST_FROM && f < COHOST_FROM + 268435456)
    return { kind: "cohost", hex: (f - COHOST_FROM).toString(16).padStart(7, "0") };
  if (f < COHOST_FROM)
    return { kind: "guest", seq: f };
  return null;
}
function fromCodeOf(inviter) {
  if (inviter === "o")
    return ORG_FROM;
  const [k, v] = inviter.split(":");
  if (k === "h")
    return HOST_FROM + parseInt(v, 16);
  if (k === "c")
    return COHOST_FROM + parseInt(v, 16);
  if (k === "s")
    return Number(v);
  return null;
}
var inviterOf = (o) => o.kind === "org" ? "o" : o.kind === "host" ? "h:" + o.hex : o.kind === "cohost" ? "c:" + o.hex : "s:" + o.seq;
var srcOf = (inviter) => inviter.startsWith("c:") ? "co:" + inviter.slice(2) : inviter.startsWith("h:") ? "ho:" + inviter.slice(2) : "link";
// src-snakes-33ed474/vendor/game-core/packages/manifest/src/games.ts
var both = ["auto", "manual"];
var claimGame = (id, title) => ({
  id,
  title,
  labels: ["Claim"],
  caps: { auto: 1e5, manual: 1000 },
  startModes: [...both],
  playModes: ["auto-called", "host-called"],
  goldenButton: "Claim",
  name: id,
  pauseSupport: true,
  claimType: "player-presses",
  prizePositions: ["early5", "top", "mid", "bot", "full"],
  prizeModes: [...both],
  rehearsalMax: 20,
  lateJoin: { kind: "until-end" },
  organizerFinalSay: true
});
var eliminationGame = (id, title) => ({
  id,
  title,
  labels: ["Elimination"],
  caps: { auto: 2000 },
  startModes: [...both],
  playModes: ["start-only"],
  goldenButton: "You won",
  name: id,
  pauseSupport: true,
  claimType: "auto",
  prizePositions: ["1st", "2nd", "3rd", "4th", "5th"],
  prizeModes: [...both],
  rehearsalMax: 10,
  lateJoin: { kind: "none-after-round-1" },
  organizerFinalSay: false
});
var MANIFESTS = {
  tambola: claimGame("tambola", "Corporate Tambola"),
  bingo: claimGame("bingo", "Corporate Bingo"),
  tictactoe: eliminationGame("tictactoe", "Tic Tac Toe"),
  snakes: eliminationGame("snakes", "Snakes and Ladders"),
  luck: eliminationGame("luck", "Luck by Chance"),
  luckydraw: {
    id: "luckydraw",
    title: "Lucky Draw",
    labels: ["Lucky Draw"],
    caps: { auto: 1e5 },
    startModes: [...both],
    playModes: ["start-only"],
    goldenButton: "You won",
    name: "luckydraw",
    pauseSupport: true,
    claimType: "auto",
    prizePositions: ["1st", "2nd", "3rd"],
    prizeModes: [...both],
    rehearsalMax: 10,
    lateJoin: { kind: "until-draw" },
    organizerFinalSay: false
  }
};
var GAME_IDS = Object.keys(MANIFESTS);
// src-snakes-33ed474/vendor/game-core/packages/snakes/src/index.ts
function checkBoard(b, perKind = [6, 12]) {
  const bad = [], last = b.size, sn = Object.entries(b.snakes).map(([f, t]) => [+f, t]), la = Object.entries(b.ladders).map(([f, t]) => [+f, t]);
  const k = last / 100;
  if (sn.length < perKind[0] || sn.length > perKind[1] || la.length < perKind[0] || la.length > perKind[1])
    bad.push("a board has 6 to 12 snakes and 6 to 12 ladders");
  const used = new Set;
  for (const [f, t] of [...sn, ...la]) {
    if (f === 1 || t === last || f === last)
      bad.push("no snake or ladder starts on square 1 or ends on the last square");
    if (used.has(f) || used.has(t))
      bad.push("no square is used twice");
    used.add(f);
    used.add(t);
  }
  for (const [f, t] of la)
    if (t - f < 8 * k || t - f > 30 * k)
      bad.push("a ladder climbs 8 to 30 squares");
  for (const [f, t] of sn)
    if (f - t < 8 * k || f - t > 40 * k)
      bad.push("a snake drops 8 to 40 squares");
  for (const [q, sp] of Object.entries(b.specials ?? {})) {
    const f = +q;
    if (f === 1 || f === last)
      bad.push("a special square is never on square 1 or the last square");
    if (used.has(f))
      bad.push("no square is used twice");
    used.add(f);
    if ((sp.kind === "upgrade" || sp.kind === "downgrade") && !(Number.isInteger(sp.n) && sp.n >= 1 && sp.n <= 6 * k))
      bad.push("an upgrade or downgrade moves 1 to 6 squares (scaled on larger boards)");
  }
  if (!reachable(b))
    bad.push("nobody may be trapped");
  return [...new Set(bad)];
}
function reachable(b) {
  const next = (s, r) => {
    const n = s + r;
    return n > b.size ? s : b.snakes[n] ?? b.ladders[n] ?? specialTo(b, n) ?? n;
  };
  const can = new Set([b.size]);
  for (let changed = true;changed; ) {
    changed = false;
    for (let s = 1;s < b.size; s++)
      if (!can.has(s) && [1, 2, 3, 4, 5, 6].some((r) => can.has(next(s, r)))) {
        can.add(s);
        changed = true;
      }
  }
  return Array.from({ length: b.size }, (_, i) => i + 1).every((s) => can.has(s));
}
function specialTo(b, n) {
  const sp = b.specials?.[n];
  if (!sp || sp.kind !== "upgrade" && sp.kind !== "downgrade")
    return;
  return sp.kind === "upgrade" ? Math.min(n + (sp.n ?? 3), b.size - 1) : Math.max(n - (sp.n ?? 3), 2);
}
var OWNER_COUNTS = { snakes: 10, ladders: 10, penalty: 5, reward: 5 };
var REWARD_THROWS = 2;
function squareXY(n) {
  const row = Math.floor((n - 1) / 10), i = (n - 1) % 10;
  return { col: row % 2 === 0 ? i : 9 - i, row };
}
var seeded = (seed) => {
  let h = 2166136261;
  for (let i = 0;i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = h + 1831565813 | 0;
    let t = Math.imul(h ^ h >>> 15, h | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};
var rowOf = (q) => Math.floor((q - 1) / 10);
var isFlat = (a, b) => {
  const rd = Math.abs(rowOf(a) - rowOf(b)), cd = Math.abs(squareXY(a).col - squareXY(b).col);
  return rd < 2 || cd > 2.5 * rd;
};
var MAX_SPAN_ROWS = 5;
var MIN_CLEAR = 0.5;
var PTS = Array.from({ length: 101 }, (_, q) => {
  const { col, row } = squareXY(Math.max(1, q));
  return [col, row];
});
var pt = (q) => PTS[q];
function lineGap(a, b) {
  const [p1, p2, p3, p4] = [pt(a[0]), pt(a[1]), pt(b[0]), pt(b[1])];
  const cr = (o, u, v) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  if (cr(p1, p2, p3) * cr(p1, p2, p4) < 0 && cr(p3, p4, p1) * cr(p3, p4, p2) < 0)
    return 0;
  const dp = (p, s, e) => {
    const dx = e[0] - s[0], dy = e[1] - s[1], u = Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - (s[0] + u * dx), p[1] - (s[1] + u * dy));
  };
  return Math.min(dp(p1, p3, p4), dp(p2, p3, p4), dp(p3, p1, p2), dp(p4, p1, p2));
}
function crossings(b) {
  const all = [...Object.entries(b.snakes), ...Object.entries(b.ladders)].map(([f, t]) => [+f, t]);
  let n = 0;
  for (let i = 0;i < all.length; i++)
    for (let j = i + 1;j < all.length; j++)
      if (lineGap(all[i], all[j]) < MIN_CLEAR / 1.3)
        n++;
  return n;
}
var boardMemo = new Map;
function ownerBoard(gameId) {
  const hit = boardMemo.get(gameId);
  if (hit)
    return { ...hit, snakes: { ...hit.snakes }, ladders: { ...hit.ladders }, specials: { ...hit.specials } };
  const b = makeOwnerBoard(gameId);
  if (boardMemo.size > 50)
    boardMemo.clear();
  boardMemo.set(gameId, b);
  return { ...b, snakes: { ...b.snakes }, ladders: { ...b.ladders }, specials: { ...b.specials } };
}
function makeOwnerBoard(gameId) {
  for (let attempt = 0;attempt < 3000; attempt++) {
    const r = seeded(gameId + "#" + attempt), pick = (n) => Math.floor(r() * n);
    const kinds = Array.from({ length: 20 }, (_, i) => i % 2 === 0), spans = kinds.map((_, i) => i % 5 === 0 || i % 5 === 4 ? 2 : pick(12) === 0 ? 5 : 2 + pick(3));
    const segs = [];
    const cand = (i) => {
      const s = kinds[i], sp = spans[i], f = s ? 21 + pick(79) : 2 + pick(78), tr = s ? rowOf(f) - sp : rowOf(f) + sp;
      if (tr < 0 || tr > 9)
        return null;
      const tc = Math.max(0, Math.min(9, squareXY(f).col + pick(5) - 2)), t = tr * 10 + 1 + (tr % 2 ? 9 - tc : tc);
      if (t < 2 || t > 99 || isFlat(f, t) || Math.min(4, Math.floor((rowOf(f) + rowOf(t)) / 4)) !== i % 5)
        return null;
      for (let j = 0;j < segs.length; j++)
        if (j !== i && segs[j]) {
          const o = segs[j];
          if (o.f === f || o.f === t || o.t === f || o.t === t)
            return null;
        }
      return { s, f, t };
    };
    const conflicts = (i, c) => segs.reduce((n, o, j) => n + (j !== i && o && lineGap([o.f, o.t], [c.f, c.t]) < MIN_CLEAR ? 1 : 0), 0);
    for (let i = 0;i < 20; i++) {
      let c = null, bc = 1e9;
      for (let k = 0;k < 40; k++) {
        const x = cand(i);
        if (!x)
          continue;
        const n = conflicts(i, x);
        if (n < bc) {
          bc = n;
          c = x;
          if (!n)
            break;
        }
      }
      if (!c)
        break;
      segs.push(c);
    }
    if (segs.length < 20)
      continue;
    const cnt = segs.map((c, i) => conflicts(i, c));
    let done = false;
    for (let step = 0;step < 500 && !done; step++) {
      const bad = [];
      for (let i = 0;i < 20; i++)
        if (cnt[i])
          bad.push(i);
      if (!bad.length) {
        done = true;
        break;
      }
      const i = bad[pick(bad.length)];
      let best = null, bc = 1e9;
      for (let k = 0;k < 14; k++) {
        const c = cand(i);
        if (!c)
          continue;
        const n = conflicts(i, c);
        if (n < bc) {
          bc = n;
          best = c;
        }
      }
      if (best && (bc <= cnt[i] || pick(20) === 0)) {
        const old = segs[i];
        segs[i] = best;
        for (let j = 0;j < 20; j++)
          if (j !== i) {
            const was = lineGap([old.f, old.t], [segs[j].f, segs[j].t]) < MIN_CLEAR, now = lineGap([best.f, best.t], [segs[j].f, segs[j].t]) < MIN_CLEAR;
            if (was !== now) {
              cnt[j] += now ? 1 : -1;
              cnt[i] += now ? 1 : -1;
            }
          }
      }
    }
    if (!done)
      continue;
    const bands = [0, 0, 0, 0, 0];
    for (const c of segs)
      bands[Math.min(4, Math.floor((rowOf(c.f) + rowOf(c.t)) / 4))]++;
    if (bands.some((n) => n < 2))
      continue;
    const used = new Set([1, 100]), snakes = {}, ladders = {};
    for (const c of segs) {
      used.add(c.f);
      used.add(c.t);
      (c.s ? snakes : ladders)[c.f] = c.t;
    }
    const free = shufq(Array.from({ length: 98 }, (_, i) => i + 2).filter((q) => !used.has(q)), r), far = (q) => segs.every((c) => lineGap([c.f, c.t], [q, q]) >= 0.8);
    const spots = [...free.filter(far), ...free.filter((q) => !far(q))].slice(0, 10), specials = {};
    spots.forEach((q, i) => {
      specials[q] = { kind: i < 5 ? "punishment" : "reward" };
    });
    const b = { size: 100, snakes, ladders, specials };
    if (!checkOwnerBoard(b).length)
      return b;
  }
  throw new Error("no sound board for this game id");
}
var shufq = (a, r) => {
  for (let i = a.length - 1;i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function checkOwnerBoard(b) {
  const bad = [], sn = Object.entries(b.snakes).map(([f, t]) => [+f, t]), la = Object.entries(b.ladders).map(([f, t]) => [+f, t]), sp = Object.entries(b.specials ?? {});
  if (b.size !== 100)
    bad.push("the board has 100 squares");
  if (sn.length !== OWNER_COUNTS.snakes || la.length !== OWNER_COUNTS.ladders || sp.filter(([, v]) => v.kind === "punishment").length !== OWNER_COUNTS.penalty || sp.filter(([, v]) => v.kind === "reward").length !== OWNER_COUNTS.reward)
    bad.push("10 snakes, 10 ladders, 5 penalty and 5 reward squares");
  const starts = [...sn.map(([f]) => f), ...la.map(([f]) => f), ...sp.map(([q]) => +q)];
  if (new Set(starts).size !== starts.length)
    bad.push("no square is used twice");
  if (starts.some((q) => q === 1 || q === 100))
    bad.push("nothing sits on square 1 or 100");
  const ends = [...sn.map(([, t]) => t), ...la.map(([, t]) => t)];
  if (ends.some((t) => starts.includes(t) || t < 2 || t > 99))
    bad.push("a snake or ladder ends on a plain square");
  if (new Set(ends).size !== ends.length)
    bad.push("no two snakes or ladders end on the same square");
  const lens = [...sn.map(([f, t]) => f - t), ...la.map(([f, t]) => t - f)];
  if (lens.some((d) => d < 3))
    bad.push("every snake and ladder is at least 3 squares long");
  if ([...sn, ...la].some(([f, t]) => isFlat(f, t)))
    bad.push("no flat snake or ladder: the start and the end are at least 2 rows apart and not nearly level");
  if ([...sn, ...la].some(([f, t]) => Math.abs(rowOf(f) - rowOf(t)) > MAX_SPAN_ROWS))
    bad.push("every snake and ladder is short: at most 5 rows from start to end");
  if (sn.some(([f, t]) => t >= f) || la.some(([f, t]) => t <= f))
    bad.push("snakes go down and ladders go up");
  if (crossings(b) > 0)
    bad.push("no snake or ladder crosses another (crossings: " + crossings(b) + ")");
  const bands = [0, 0, 0, 0, 0];
  for (const [f, t] of [...sn, ...la])
    bands[Math.min(4, Math.floor((rowOf(f) + rowOf(t)) / 4))]++;
  if (bands.some((n) => n < 2))
    bad.push("snakes and ladders are spread over the whole board");
  if (!reachable(b))
    bad.push("nobody may be trapped");
  return [...new Set(bad)];
}
function noteFor(r) {
  if (r.ladder)
    return `Ladder! Up to ${r.to}`;
  if (r.snake)
    return `Snake! Down to ${r.to}`;
  if (r.special === "upgrade")
    return `Upgrade! Forward ${r.n} to ${r.to}`;
  if (r.special === "downgrade")
    return `Downgrade! Back ${r.n} to ${r.to}`;
  if (r.special === "reward")
    return `Reward! ${REWARD_THROWS} extra throws`;
  if (r.special === "punishment")
    return "Punishment! You lose your next throw";
  return "";
}
function move(b, at, roll, pass = false) {
  let n = at + roll;
  if (n > b.size) {
    if (!pass)
      return { to: at, ladder: false, snake: false };
    n = b.size;
  }
  if (b.ladders[n])
    return { to: b.ladders[n], ladder: true, snake: false };
  if (b.snakes[n])
    return { to: b.snakes[n], ladder: false, snake: true };
  const sp = b.specials?.[n];
  if (sp)
    return { to: specialTo(b, n) ?? n, ladder: false, snake: false, special: sp.kind, n: sp.n };
  return { to: n, ladder: false, snake: false };
}
var timeLimitMsFor = (minutes) => (Number(minutes) === 7 ? 7 : 8) * 60000;
var setupFields = [
  { key: "timeLimitMinutes", label: "Game length in minutes", kind: "choice", choices: ["7", "8"], default: "8", help: "The game ends when this time is up (7 or 8 minutes). Time does not run while paused." },
  { key: "turnLimit", label: "Most turns (safety stop)", kind: "number", default: 600, advanced: true },
  { key: "mode", label: "How throws happen", kind: "choice", choices: ["fate", "presence"], default: "fate" },
  { key: "milestones", label: "Milestone squares", kind: "text", default: "75", advanced: true },
  { key: "upgradeSquares", label: "Upgrade squares", kind: "number", default: 0, advanced: true, help: "0 = none. Landing on one jumps the pawn forward a few squares." },
  { key: "downgradeSquares", label: "Downgrade squares", kind: "number", default: 0, advanced: true, help: "0 = none. Landing on one steps the pawn back a few squares." },
  { key: "rewardSquares", label: "Reward squares", kind: "number", default: 0, advanced: true, help: "0 = none. Landing on one gives one extra throw." },
  { key: "punishmentSquares", label: "Punishment squares", kind: "number", default: 0, advanced: true, help: "0 = none. Landing on one loses the next throw." },
  { key: "specialN", label: "Squares for an upgrade or downgrade", kind: "number", default: 3, advanced: true },
  { key: "survivors", label: "Players who stay in after each round", kind: "number", default: 0, help: "0 = nobody is sent out. Otherwise the front runners stay in; the rest are out." },
  { key: "roundTurns", label: "Turns in a round", kind: "number", default: 10, advanced: true },
  { key: "pass", label: "Reach or pass finishes", kind: "toggle", default: false, advanced: true }
];
var byId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var raceOrder = (a, b) => b.at - a.at || b.ladders - a.ladders || a.missed - b.missed || a.fate - b.fate;
var snakesRules = {
  manifest: MANIFESTS.snakes,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: (s) => ["1st", "2nd", "3rd", "4th", "5th", ...String(s.milestones ?? "75").split(",").filter(Boolean).map((m) => `milestone ${m}`)],
  lateJoin: MANIFESTS.snakes.lateJoin,
  init(setup, players) {
    const shared = setup.board, boards = shared ? Object.fromEntries(players.map((p) => [p, shared])) : setup.boards ?? {}, fate = setup.fate ?? {}, pawns = {};
    for (const p of players) {
      if (!boards[p])
        throw new Error("every player needs a board");
      pawns[p] = { at: 1, ladders: 0, missed: 0, fate: fate[p] ?? 0 };
    }
    return {
      boards,
      pawns,
      turn: 0,
      turnLimit: Number(setup.turnLimit ?? 600),
      pass: !!setup.pass,
      presence: setup.mode === "presence",
      finishers: [],
      survivors: Math.max(0, Math.floor(Number(setup.survivors ?? 0))),
      roundTurns: Math.max(1, Math.floor(Number(setup.roundTurns ?? 10))),
      out: [],
      milestones: String(setup.milestones ?? "75").split(",").map(Number).filter(Boolean).slice(0, 3),
      milestoneWon: {},
      over: false,
      timeLimitMs: timeLimitMsFor(setup.timeLimitMinutes),
      gameMs: 0,
      settledMs: 0
    };
  },
  step(s, e, _now, clock) {
    if (s.over || e.type !== "turn" || clock.phase === "paused")
      return { state: s, out: [] };
    const pawns = {}, out = [], turn = e.only ? s.turn : s.turn + 1;
    for (const [p, w] of Object.entries(s.pawns))
      pawns[p] = { ...w };
    for (const p of Object.keys(pawns)) {
      const w = pawns[p];
      if (e.only && p !== e.only)
        continue;
      if (w.finishedTurn || s.out.includes(p))
        continue;
      if (s.presence && !e.threw?.includes(p)) {
        w.missed++;
        continue;
      }
      if (w.skip) {
        w.skip--;
        w.note = "You lose this throw";
        continue;
      }
      const roll = e.rolls[p];
      if (!roll || roll < 1 || roll > 6)
        continue;
      if (w.extra)
        w.extra--;
      const r = move(s.boards[p], w.at, roll, s.pass);
      w.at = r.to;
      if (r.ladder)
        w.ladders++;
      w.note = noteFor(r);
      if (r.special === "reward")
        w.extra = (w.extra ?? 0) + REWARD_THROWS;
      if (r.special === "punishment")
        w.skip = (w.skip ?? 0) + 1;
      if (w.at === s.boards[p].size)
        w.finishedTurn = turn;
    }
    const fin = Object.keys(pawns).filter((p) => pawns[p].finishedTurn === turn).sort((a, b) => raceOrder(pawns[a], pawns[b]) || byId(a, b));
    const finishers = [...s.finishers, ...fin].slice(0, 5);
    fin.forEach((p, i) => {
      if (s.finishers.length + i < 5)
        out.push({ kind: "win", player: p, position: ["1st", "2nd", "3rd", "4th", "5th"][s.finishers.length + i] });
    });
    const milestoneWon = { ...s.milestoneWon };
    for (const m of s.milestones)
      if (!milestoneWon[m]) {
        const hit = Object.keys(pawns).filter((p) => pawns[p].at >= m).sort((a, b) => raceOrder(pawns[a], pawns[b]) || byId(a, b))[0];
        if (hit) {
          milestoneWon[m] = hit;
          out.push({ kind: "win", player: hit, position: `milestone ${m}` });
        }
      }
    let outList = s.out;
    if (s.survivors && !e.only && turn % s.roundTurns === 0) {
      const live = Object.keys(pawns).filter((p) => !pawns[p].finishedTurn && !outList.includes(p)).sort((a, b) => raceOrder(pawns[a], pawns[b]) || byId(a, b));
      const gone = live.slice(s.survivors);
      for (const p of gone)
        out.push({ kind: "out", player: p, why: "behind the front runners" });
      if (gone.length)
        outList = [...outList, ...gone];
      out.push({ kind: "round", n: turn / s.roundTurns + 1, alive: live.length - gone.length });
    }
    const stillIn = Object.keys(pawns).filter((p) => !pawns[p].finishedTurn && !outList.includes(p)).length;
    const gameMs = Math.max(s.gameMs, e.gameMs ?? s.gameMs), over = finishers.length >= 5 || turn >= s.turnLimit || stillIn === 0 || gameMs >= s.timeLimitMs;
    return { state: { ...s, pawns, turn, finishers, milestoneWon, out: outList, over, gameMs, settledMs: gameMs }, out: [...out, ...over ? [{ kind: "end" }] : []] };
  }
};
var finalRanking = (s) => {
  const rest = Object.keys(s.pawns).filter((p) => !s.finishers.includes(p)), byRace = (a, b) => raceOrder(s.pawns[a], s.pawns[b]) || byId(a, b);
  return [...s.finishers, ...rest.filter((p) => !s.out?.includes(p)).sort(byRace), ...rest.filter((p) => s.out?.includes(p)).sort(byRace)];
};

// src-snakes-33ed474/vendor/game-core/packages/core/src/roles.ts
var canControlClock = (r) => r === "organizer" || r === "host";
var canEditSetup = (r) => r === "organizer";
var getsEndPdf = (r) => r === "organizer" || r === "host";
var isPlayer = (r) => r === "participant" || r === "family";
var FAMILY_SEATS = 4;
function admit(j) {
  if (!j.open)
    return { result: "refused", why: "This game is not open yet." };
  if (j.alreadySeated)
    return { result: "refused", why: "This ID already has a seat in this game." };
  if (j.full)
    return { result: "refused", why: "This game is full." };
  if (j.closeGroup && !j.listed)
    return { result: "waiting" };
  return { result: "in" };
}
var WAIT_LAPSE_MS = 30 * 60000;
var logChange = (log, role, what, at = Date.now()) => [...log, { at, role, what }];

// src-snakes-33ed474/vendor/game-core/packages/core/src/modes.ts
var newClock = () => ({ phase: "waiting", frozenAt: null, pausedMs: 0, pauses: [] });
var gameNow = (c, now) => (c.frozenAt ?? now) - c.pausedMs;
function pause(c, role, now) {
  if (!canControlClock(role) || c.phase !== "running")
    return c;
  return { ...c, phase: "paused", frozenAt: now, pauses: [...c.pauses, { role, from: now }] };
}
function resume(c, role, now) {
  if (!canControlClock(role) || c.phase !== "paused" || c.frozenAt === null)
    return c;
  const pauses = c.pauses.map((p, i) => i === c.pauses.length - 1 ? { ...p, to: now } : p);
  return { ...c, phase: "running", frozenAt: null, pausedMs: c.pausedMs + (now - c.frozenAt), pauses };
}
var start = (c) => c.phase === "waiting" ? { ...c, phase: "running" } : c;
var end = (c) => ({ ...c, phase: "over", frozenAt: null });
// src-snakes-33ed474/apps/edge/src/engine.ts
var GOLDEN_LABEL = snakesRules.goldenButton;
var freshPause = () => ({ clock: newClock(), log: [] });
function applyPause(st, action, role, hostKeyOk, now) {
  if (!canControlClock(role) || role === "host" && !hostKeyOk)
    return { ok: false, error: "Only the Organizer, or a Host the Organizer has set up with a key, can pause or resume the game." };
  const clock = action === "pause" ? pause(st.clock, role, now) : resume(st.clock, role, now);
  if (clock === st.clock)
    return { ok: false, error: action === "pause" ? "The game is not running, so it cannot be paused." : "The game is not paused." };
  return { ok: true, st: { clock, log: logChange(st.log, role, action, now) } };
}
var engineNow = (st, now) => gameNow(st.clock, now);
// src-snakes-33ed474/apps/edge/src/audit.ts
var GENESIS = "0".repeat(64);
var enc2 = new TextEncoder;

// src-snakes-33ed474/apps/edge/src/mode.ts
var cache = new WeakMap;

// src-snakes-33ed474/apps/edge/src/analytics-core.ts
var ready = new WeakSet;
var GAME_PATHS = ["/", "/legal", "/terms", "/dpa", "/subprocessors", "/partner-terms", "/organizer-guide", "/partner", "/signin", "/pay"];
var GAME_ACTS = ["pack", "create", "cur", "signin_open", "signin_submit", "start_open", "start_submit", "partner_click", "nav", "legal_click"];
var game = (key, name, hosts) => ({ key, name, hosts, paths: GAME_PATHS, acts: GAME_ACTS });
var SITES = [
  { key: "home", name: "Corporate Games home", hosts: ["home.corporatetambola.com"] },
  game("tambola", "Corporate Tambola", ["housie.corporatetambola.com", "corporatetambola.com", "www.corporatetambola.com"]),
  game("bingo", "Corporate Bingo", ["bingo.corporatetambola.com"]),
  game("snakes", "Corporate Snakes and Ladders", ["snakes.corporatetambola.com"]),
  game("luck", "Corporate Luck by Chance", ["luck.corporatetambola.com"]),
  game("tictactoe", "Corporate Tic Tac Toe", ["tictactoe.corporatetambola.com"]),
  game("luckydraw", "Corporate Lucky Draw", ["luckydraw.corporatetambola.com"]),
  { key: "console", name: "Corporate Games master console", hosts: ["console.corporatetambola.com"], paths: ["/", "/signin"] },
  { key: "dpdp", name: "VERIDIAN DPDP", hosts: ["veridian-aios.com", "www.veridian-aios.com", "app.veridian-aios.com", "dpdp.veridian-aios.com"], skip: ["/app", "/act", "/unsubscribe", "/p", "/copy", "/ai", "/api"] },
  { key: "townhall", name: "Townhall Records", hosts: ["townhall-records.com", "www.townhall-records.com"], skip: ["/api"] },
  { key: "startup", name: "Startup Coach", hosts: ["startup.rajatsir.com"], skip: ["/api"] },
  { key: "rajatsir", name: "rajatsir.com", hosts: ["www.rajatsir.com", "rajatsir.com"], skip: ["/api"] }
];
var enc3 = new TextEncoder;
var hmacKeys = new Map;
var rate = new Map;

// src-snakes-33ed474/apps/edge/src/visits.ts
var STEPS = ["visit", "pricing", "size", "create", "account", "published", "paid"];
var STAGE = Object.fromEntries(STEPS.map((s, i) => [s, i]));
var PUBLIC_PATHS = new Set(["/", "/legal", "/terms", "/dpa", "/subprocessors", "/partner-terms", "/organizer-guide", "/partner", "/signin", "/pay"]);
var ACTIONS = new Set(["pack", "create", "cur", "signin_open", "signin_submit", "start_open", "start_submit", "partner_click", "nav", "legal_click"]);
var enc4 = new TextEncoder;
var hmacKeys2 = new Map;
var rate2 = new Map;

// src-snakes-33ed474/vendor/game-core/packages/core/src/funnel.ts
var FUNNEL_EVENTS = ["viewed", "size_chosen", "signup_started", "game_created", "game_published", "payment_page_reached", "payment_page_opened", "payment_link_copied", "payment_started", "payment_succeeded", "payment_failed", "game_started", "game_completed"];

// src-snakes-33ed474/apps/edge/src/funnel.ts
var PAGE_EVENTS = new Set(["viewed", "size_chosen", "signup_started", "payment_page_reached", "payment_page_opened", "payment_link_copied"]);
var SERVER_EVENTS = new Set(["game_created", "game_published", "payment_started", "payment_succeeded", "payment_failed", "game_started", "game_completed"]);
var MAIN_LINE = FUNNEL_EVENTS.filter((e) => e !== "payment_failed");
var ready2 = new WeakSet;

// src-snakes-33ed474/packages/billing/src/index.ts
var BRANDS = {
  corporate_snakes_and_ladders: { id: "corporate_snakes_and_ladders", name: "Corporate Snakes and Ladders", domain: "corporate-snakes-and-ladders.example", invoicePrefix: "CB", theme: "#0B5D5B", line: "Live engagement software" },
  dpdp: { id: "dpdp", name: "dpdp.VERIDIAN-AIOS.COM", domain: "dpdp.veridian-aios.com", invoicePrefix: "DPDP", theme: "#0E7C6E", line: "Data protection compliance software" },
  projexa: { id: "projexa", name: "projexa-ai.com", domain: "projexa-ai.com", invoicePrefix: "PXA", theme: "#1C2B3A", line: "Project management software" },
  dewberry: { id: "dewberry", name: "dewberry.in", domain: "dewberry.in", invoicePrefix: "DEW", theme: "#5B3A8C", line: "Software solutions" }
};

// src-snakes-33ed474/apps/edge/src/ledgerc.ts
var SITE_CODE = "SNL";
var LEDGERC_SCHEMA = [
  `ALTER TABLE payment ADD COLUMN txn_id TEXT`,
  `ALTER TABLE payment ADD COLUMN fee_minor INTEGER`,
  `ALTER TABLE payment ADD COLUMN tax_minor INTEGER`,
  `ALTER TABLE payment ADD COLUMN method TEXT`,
  `ALTER TABLE payment ADD COLUMN bank TEXT`,
  `ALTER TABLE payment ADD COLUMN card_network TEXT`,
  `ALTER TABLE payment ADD COLUMN card_type TEXT`,
  `ALTER TABLE payment ADD COLUMN rrn TEXT`,
  `UPDATE payment SET txn_id='${SITE_CODE}-' || id WHERE txn_id IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payment_txn ON payment (txn_id) WHERE txn_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS payment_attempt (rzp_payment_id TEXT PRIMARY KEY, payment_id TEXT, rzp_order_id TEXT, txn_id TEXT, status TEXT NOT NULL, currency TEXT, amount_minor INTEGER, method TEXT, bank TEXT, card_network TEXT, card_type TEXT, card_last4 TEXT, vpa_masked TEXT, rrn TEXT, error_code TEXT, error_description TEXT, error_reason TEXT, fee_minor INTEGER, tax_minor INTEGER, authorized_ms INTEGER, captured_ms INTEGER, failed_ms INTEGER, event_ms INTEGER, created_ms INTEGER, updated_ms INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS payment_attempt_payment ON payment_attempt (payment_id)`,
  `CREATE TABLE IF NOT EXISTS event_seen (rzp_event_id TEXT PRIMARY KEY, event TEXT, seen_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS payment_refund (rzp_refund_id TEXT PRIMARY KEY, rzp_payment_id TEXT NOT NULL, payment_id TEXT, txn_id TEXT, currency TEXT, amount_minor INTEGER NOT NULL, status TEXT, created_ms INTEGER, updated_ms INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS payment_refund_payment ON payment_refund (rzp_payment_id)`,
  `ALTER TABLE commission ADD COLUMN synced_ms INTEGER`,
  `ALTER TABLE commission ADD COLUMN sync_status TEXT`,
  `ALTER TABLE commission ADD COLUMN sync_try_ms INTEGER`,
  `ALTER TABLE commission ADD COLUMN sync_error TEXT`,
  `CREATE TABLE IF NOT EXISTS ledger_state (k TEXT PRIMARY KEY, v TEXT NOT NULL)`
];
var COMMISSION_RETRY_MS = 10 * 60000;
var NOT_TEST = `(p.is_test=0 OR p.product_type='payment_test')`;
var REAL = `p.rzp_payment_id IS NOT NULL AND ${NOT_TEST}`;
var SUMMARY_EVERY_MS = 30 * 60000;
var SUMMARY_RETRY_MS = 5 * 60000;

// src-snakes-33ed474/apps/edge/src/hostsetup.ts
var HOST_LINK_TTL_MS = 7 * 86400000;
var encoder2 = new TextEncoder;

// src-snakes-33ed474/apps/edge/src/ai-link.ts
var SETTINGS_BODY = `{startRound?, callSeconds?: 6|9|12|15, cap?, closed?: true|false (invite-only), tickets?: 1|2 (cards per person), mark?: auto|tap, join?: name|phone (name = guests type only their name, the default), tz?: an IANA time zone such as America/New_York (how times are worded), rounds?: 1-5, rewards?: [{pattern: ${PRIZE_HOUSES.map((h) => h.id).join("|")}, ordinal?: 1 up to the house maximum (see Houses), text}], breaks?: [{after?: 1-74 (leave it out and the software spreads the breaks evenly), seconds?: 15-600 in steps of 3 (default 60), kind: file|youtube|slides|speech|lucky, title, mediaUrl?: https link (not for lucky), winners?: 1|3|5|10 (lucky only), style?: draw|scratch (lucky only)}], opening?: [{kind: file|youtube|slides|speech, title, mediaUrl?: https link, seconds?: 15-120 in steps of 3 (default 60)}], closing?: [{kind: file|youtube|slides|speech, title, mediaUrl?: https link}], invites?: {on: true|false, per?: 1-4 people each person may invite, cats?: [ids of guest kinds, see section 1]}}`;

// src-snakes-33ed474/apps/edge/src/mails.ts
var LINK_MAIL_TTL_MS = 24 * 3600000;

// src-snakes-33ed474/apps/edge/src/helpdesk.ts
var TMP_KEY_MS = 30 * 60000;
var RESEND_MS = 10 * 60000;
var HELPER_MANUAL_NOTE = [
  "YOU ARE A HELP DESK HELPER.",
  "You prepare games for the Organizer who allowed you. You create the game and set it up with your normal functions. You never publish and never pay: only the Organizer publishes, with one tap, and pays.",
  'When the game is ready, ask the Organizer to publish: call POST /api/helpdesk/request-publish with {"eid": "<the game id>"} (or tell the helper to tap Ask the Organizer to publish). The Organizer gets an e-mail with a short summary and a button. Do not give out any link yourself.',
  "After the Organizer publishes, the helper becomes a Host of that game and gets a Host link by e-mail."
].join(`
`);

// src-snakes-33ed474/apps/edge/src/testlogins.ts
var TEST_LOGINS = new Set(["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in"]);

// src-snakes-33ed474/apps/edge/src/paylink.ts
var PAYLINK_TTL_MS = 7 * 86400000;

// src-snakes-33ed474/apps/edge/src/payfirst.ts
var INVOICE_AFTER_MS = 15 * 60000;

// src-snakes-33ed474/apps/edge/src/pay.ts
var brand = BRANDS.corporate_snakes_and_ladders;
var OUTBOX_KEEP_MS = 3 * 86400000;

// src-snakes-33ed474/apps/edge/src/credit.ts
var PAYER_KINDS = new Set(["master", "host", "cohost"]);

// src-snakes-33ed474/apps/edge/src/cancel.ts
var PAID_WINDOW_MS = 365 * 86400000;
var RESCHEDULE_WINDOW_MS = PAID_WINDOW_MS;
var rescheduleUntilMs = (cancelledMs) => cancelledMs + RESCHEDULE_WINDOW_MS;

// src-snakes-33ed474/apps/edge/src/lifecycle.ts
var GENESIS2 = 1692803367;
var roundMs = (r) => (GENESIS2 + (r - 1) * 3) * 1000;
var PURGE_AFTER_MS = 20 * 3600000;
var REPORT_LINK_MS = 19 * 3600000;
var REPORT_AFTER_MS = 3 * 60000;
var UNPLAYED_WARN_MS = 6 * 3600000;
var SETTINGS_KEEP_MS = 30 * 86400000;
var MAX_AHEAD_MS = 30 * 86400000;
var IST = 5.5 * 3600000;
var DAY = 86400000;
var NAMES = Object.fromEntries(PRIZE_HOUSES.map((h) => [h.id, h.label]));
var fullDeleteAt = (endMs) => {
  const t = endMs + 365 * DAY;
  const istDay = Math.floor((t + IST) / DAY);
  return (istDay + 1) * DAY - IST;
};
var personalDeleteAt = (endMs) => endMs + PURGE_AFTER_MS;
var reportLinkUntil = (endMs) => endMs + REPORT_LINK_MS;
function cfgOfRow(e) {
  try {
    const j = e.config ? JSON.parse(e.config) : {};
    const v = validateCfg({ tickets: e.tickets ?? 1, rewards: j.rewards, breaks: j.breaks, rounds: j.rounds, invites: j.invites, mark: j.mark, join: j.join, tz: j.tz, verify: j.verify, employeesOnly: j.employeesOnly, ...gameFields(j) }, undefined, { stored: true });
    if (v.ok)
      return v.cfg;
  } catch {}
  return validateCfg({}).cfg;
}
// src-snakes-33ed474/vendor/game-core/packages/core/src/ids.ts
var EMP_MAX = 30;
var cleanEmpId2 = (raw) => String(raw ?? "").normalize("NFKC").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
var normEmail = (raw) => String(raw ?? "").normalize("NFKC").replace(/[\s\u200b-\u200d\u2060\ufeff\u0085\u2028\u2029]/g, "").toLowerCase();
var looksLikeEmail2 = (raw) => String(raw ?? "").normalize("NFKC").includes("@");
function normEmp2(raw) {
  if (String(raw ?? "").trim() === "")
    return "";
  if (looksLikeEmail2(raw))
    return null;
  const s = cleanEmpId2(raw);
  return s && s.length <= EMP_MAX ? s : null;
}
var normId2 = (kind, raw) => kind === "email" ? normEmail(raw) || null : normEmp2(raw) || null;

// src-snakes-33ed474/vendor/game-core/packages/core/src/people.ts
var MAX_HOSTS = 5;
var COHOST_LIST_DEFAULT = 100;
var COHOST_LIST_MIN = 10;
var COHOST_LIST_MAX = 1000;
var PEOPLE_ROWS = [
  { id: "addHost", label: "Add a Host", help: "A Host can run the game with you. Up to 5.", who: ["organizer"] },
  { id: "addCohost", label: "Add a Co-host", help: "A Co-host invites people with their own link.", who: ["organizer", "host"] }
];
var newTeam = () => ({ hosts: [], cohosts: [], log: [] });
var add2 = (t, by, kind, raw, role, now) => {
  const row = PEOPLE_ROWS.find((r) => r.id === (role === "host" ? "addHost" : "addCohost"));
  if (!row.who.includes(by))
    return { ok: false, why: role === "host" ? "Only the Organizer can add a Host." : "Only the Organizer or a Host can add a Co-host." };
  const id = normId2(kind, raw);
  if (!id)
    return { ok: false, why: kind === "email" ? "That e-mail does not look right." : "That employee ID does not look right." };
  if ([...t.hosts, ...t.cohosts].some((h) => h.id === id))
    return { ok: false, why: "This person already has a role in this game." };
  if (role === "host" && t.hosts.length >= MAX_HOSTS)
    return { ok: false, why: `A game can have up to ${MAX_HOSTS} Hosts.` };
  const h = { id, role, keyApproved: false };
  return { ok: true, team: { ...t, [role === "host" ? "hosts" : "cohosts"]: [...role === "host" ? t.hosts : t.cohosts, h], log: logChange(t.log, by, `${role === "host" ? "Host" : "Co-host"} added`, now) } };
};
var addHost = (t, by, kind, raw, now) => add2(t, by, kind, raw, "host", now);
var addCohost = (t, by, kind, raw, now) => add2(t, by, kind, raw, "cohost", now);
function approveHostKey(t, by, hostId, now) {
  if (by !== "organizer")
    return { ok: false, why: "Only the Organizer can approve a Host key." };
  const h = t.hosts.find((x) => x.id === hostId);
  if (!h)
    return { ok: false, why: "That Host is not in this game." };
  if (h.keyApproved)
    return { ok: true, team: t };
  return { ok: true, team: { ...t, hosts: t.hosts.map((x) => x === h ? { ...x, keyApproved: true } : x), log: logChange(t.log, by, "Host key approved", now) } };
}
var hostMayControl = (t, hostId) => !!t.hosts.find((h) => h.id === hostId)?.keyApproved;
var cohostLimitOk = (n) => Number.isInteger(n) && n >= COHOST_LIST_MIN && n <= COHOST_LIST_MAX;
// games/snakes/oracle.ts
import { createHash } from "crypto";
var sha = (s) => createHash("sha256").update(s).digest();
var shaHex = (s) => createHash("sha256").update(s).digest("hex");
function rollO(game, seat, turn, bt) {
  const d = sha(`SL1|roll|${game}|${seat}|${turn}|${bt.toLowerCase()}`);
  let sum = 0;
  for (let i = 0;i < 32; i++)
    sum += d[i];
  const m3 = sum % 3, m2 = d[31] & 1;
  for (let v = 0;v < 6; v++)
    if (v % 2 === m2 && v % 3 === m3)
      return v + 1;
  return 0;
}

class Fate {
  game;
  m = new Map;
  constructor(game) {
    this.game = game;
  }
  of(seat, label) {
    const k = seat + "|" + label;
    let b = this.m.get(k);
    if (!b) {
      b = sha(`SL1-TIE|${this.game}|${seat}|tie|${label}`);
      this.m.set(k, b);
    }
    return b;
  }
  cmp(a, b, label) {
    return Buffer.compare(this.of(a, label), this.of(b, label));
  }
}
var LIMITS = { 100: [8, 30, 8, 40], 144: [10, 36, 10, 48], 225: [12, 45, 12, 60] };
var sideO = (size) => size === 100 ? 10 : size === 144 ? 12 : size === 225 ? 15 : Math.round(Math.sqrt(size));
var size_ = (b) => b.size;
function boardFaults(b) {
  const out = new Set, L = LIMITS[b.size], side = sideO(b.size), used = new Map;
  if (!L) {
    out.add("size");
    return [...out];
  }
  const use = (x) => {
    used.set(x, (used.get(x) ?? 0) + 1);
  };
  for (const hs of Object.keys(b.snakes)) {
    const h = Number(hs), t = b.snakes[h];
    if (h <= 1 || h >= b.size)
      out.add("ends");
    if (!(t >= 1 && t < h))
      out.add("direction");
    else if (h - t < L[2] || h - t > L[3])
      out.add("length");
    use(h);
    use(t);
  }
  for (const bs of Object.keys(b.ladders)) {
    const bo = Number(bs), t = b.ladders[bo];
    if (bo <= 1 || t >= b.size)
      out.add("ends");
    if (!(t > bo))
      out.add("direction");
    else if (t - bo < L[0] || t - bo > L[1])
      out.add("length");
    if (bo <= side && t > size_(b) - 2 * side)
      out.add("rowjump");
    use(bo);
    use(t);
  }
  for (const c of used.values())
    if (c > 1)
      out.add("overlap");
  return [...out];
}
function allReachEnd(b, finish) {
  const n = b.size, can = new Uint8Array(n + 1);
  can[n] = 1;
  const nxt = (s, r) => {
    const t = s + r;
    if (t > n)
      return finish === "pass" ? n : s;
    return b.snakes[t] ?? b.ladders[t] ?? t;
  };
  for (let changed = true;changed; ) {
    changed = false;
    for (let s = n - 1;s >= 1; s--) {
      if (can[s])
        continue;
      for (let r = 1;r <= 6; r++)
        if (can[nxt(s, r)]) {
          can[s] = 1;
          changed = true;
          break;
        }
    }
  }
  for (let s = 1;s < n; s++)
    if (!can[s] && b.snakes[s] === undefined && b.ladders[s] === undefined)
      return false;
  return true;
}
function expectedO(b, finish) {
  const n = b.size, E = new Float64Array(n + 1);
  const nxt = (s, r) => {
    const t = s + r;
    if (t > n)
      return finish === "pass" ? n : s;
    return b.snakes[t] ?? b.ladders[t] ?? t;
  };
  for (let it = 0;it < 20000; it++) {
    let delta = 0;
    for (let s = n - 1;s >= 1; s--) {
      let a = 0;
      for (let r = 1;r <= 6; r++)
        a += E[nxt(s, r)];
      const v = 1 + a / 6;
      delta = Math.max(delta, Math.abs(v - E[s]));
      E[s] = v;
    }
    if (delta < 0.00000000001)
      break;
  }
  return E[1];
}
function withinO(b, finish, turns) {
  const n = b.size;
  let p = new Float64Array(n + 1);
  p[1] = 1;
  for (let t = 0;t < turns; t++) {
    const q = new Float64Array(n + 1);
    q[n] = p[n];
    for (let s = 1;s < n; s++) {
      if (!p[s])
        continue;
      for (let r = 1;r <= 6; r++) {
        const x = s + r;
        const to = x > n ? finish === "pass" ? n : s : b.snakes[x] ?? b.ladders[x] ?? x;
        q[to] += p[s] / 6;
      }
    }
    p = q;
  }
  return p[n];
}
function stepO(b, from, roll, finish) {
  const t = from + roll;
  if (t > b.size)
    return finish === "pass" ? { to: b.size, kind: "finish" } : { to: from, kind: "overshoot" };
  if (t === b.size)
    return { to: b.size, kind: "finish" };
  if (b.ladders[t] !== undefined)
    return { to: b.ladders[t], kind: "ladder" };
  if (b.snakes[t] !== undefined)
    return { to: b.snakes[t], kind: "snake" };
  return { to: t, kind: "move" };
}

class PawnO {
  seat;
  pos = [];
  cur = 1;
  fin = null;
  lad = 0;
  sn = 0;
  missed = 0;
  bestClimb = 0;
  events = [];
  kinds = [];
  rolls = [];
  constructor(seat) {
    this.seat = seat;
  }
  push(b, finish, roll) {
    const t = this.pos.length;
    if (this.fin !== null) {
      this.pos.push(this.cur);
      return;
    }
    if (roll === null) {
      this.missed++;
      this.pos.push(this.cur);
      return;
    }
    const s = stepO(b, this.cur, roll, finish);
    this.kinds.push(s.kind);
    this.rolls.push(roll);
    if (s.kind === "ladder") {
      this.lad++;
      this.bestClimb = Math.max(this.bestClimb, s.to - (this.cur + roll));
    }
    if (s.kind === "snake") {
      this.sn++;
      this.events.push({ snakeAt: t, before: this.cur, drop: this.cur + roll - s.to });
    }
    this.cur = s.to;
    this.pos.push(this.cur);
    if (this.cur === b.size)
      this.fin = t;
  }
  get bestComeback() {
    let best = 0;
    for (const e of this.events) {
      let back = false;
      for (let j = e.snakeAt + 1;j < this.pos.length; j++)
        if (this.pos[j] >= e.before) {
          back = true;
          break;
        }
      if (back)
        best = Math.max(best, e.drop);
    }
    return best;
  }
  reach(m) {
    for (let t = 0;t < this.pos.length; t++)
      if (this.pos[t] >= m)
        return t;
    return -1;
  }
}
function chainKey(fate, label, a, b) {
  const fa = a.fin ?? Infinity, fb = b.fin ?? Infinity;
  if (fa !== fb)
    return { order: fa < fb ? -1 : 1, key: 0 };
  if (a.cur !== b.cur)
    return { order: a.cur > b.cur ? -1 : 1, key: 1 };
  if (a.lad !== b.lad)
    return { order: a.lad > b.lad ? -1 : 1, key: 2 };
  if (a.missed !== b.missed)
    return { order: a.missed < b.missed ? -1 : 1, key: 3 };
  const c = fate.cmp(a.seat, b.seat, label);
  return { order: c !== 0 ? c : a.seat - b.seat, key: 4 };
}
var orderO = (fate, label, pawns) => [...pawns].sort((a, b) => chainKey(fate, label, a, b).order);
var KEY_TEXT = ["finished earlier", "a higher square", "more ladders climbed", "fewer turns missed", "chance"];
var sameCount = (xs, f, v) => xs.filter((x) => f(x) === v).length;
function settleO(fate, st, lines, pidOf) {
  const out = [], won = new Set;
  if (st.exclusive && !st.ended)
    return out;
  const endTurn = Math.max(0, st.turnsPlayed - 1);
  for (const l of lines) {
    if (l.pattern === "team")
      continue;
    let cand = [];
    if (l.pattern === "finish") {
      if (l.ordinal <= st.endPrizes) {
        const fin = orderO(fate, "finish", st.pawns.filter((p) => p.fin !== null));
        cand = fin.map((p) => {
          const same = sameCount(fin, (x) => x.fin, p.fin);
          return { p, idx: p.fin, ...same > 1 ? { tied: same } : {} };
        });
      }
    } else if (l.pattern === "milestone") {
      const m = [...st.milestones].sort((a, b) => a - b)[l.ordinal - 1];
      if (m !== undefined) {
        const reached = st.pawns.map((p) => ({ p, t: p.reach(m) })).filter((x) => x.t >= 0);
        reached.sort((a, b) => a.t - b.t || b.p.cur - a.p.cur || fate.cmp(a.p.seat, b.p.seat, "milestone" + l.ordinal));
        cand = reached.map((x) => {
          const same = sameCount(reached, (y) => y.t, x.t);
          return { p: x.p, idx: x.t, ...same > 1 ? { tied: same } : {} };
        });
      }
    } else if (st.ended && (l.pattern === "climb" || l.pattern === "comeback")) {
      const val = (p) => l.pattern === "climb" ? p.bestClimb : p.bestComeback;
      const c = st.pawns.filter((p) => val(p) > 0).sort((a, b) => val(b) - val(a) || fate.cmp(a.seat, b.seat, l.pattern));
      cand = c.map((p) => {
        const same = c.filter((x) => val(x) === val(p)).length;
        return { p, idx: endTurn, ...same > 1 ? { tied: same } : {} };
      });
    } else if (st.ended && l.pattern === "nevermissed") {
      if (st.presence) {
        const c = st.pawns.filter((p) => p.missed === 0).sort((a, b) => fate.cmp(a.seat, b.seat, "nevermissed"));
        cand = c.map((p) => ({ p, idx: endTurn, ...c.length > 1 ? { tied: c.length } : {} }));
      }
    }
    let pick;
    if (l.pattern === "finish" && !st.exclusive)
      pick = cand[l.ordinal - 1];
    else
      pick = cand.find((c) => !st.exclusive || !won.has(c.p.seat));
    if (!pick)
      continue;
    won.add(pick.p.seat);
    out.push({ pattern: l.pattern, ordinal: l.ordinal, idx: pick.idx, pids: [pidOf(pick.p.seat)], ...pick.tied ? { tied: pick.tied } : {} });
  }
  return out;
}
function teamsO(fate, players, teams, b0) {
  const seats = Array.from({ length: players }, (_, i) => i + 1).sort((a, b) => fate.cmp(a, b, `team|${b0}`) || a - b);
  const o = new Array(players);
  seats.forEach((s, i) => {
    o[s - 1] = i % teams;
  });
  return o;
}
function teamTableO(game, pawns, teamOf, teams) {
  const fate = new Fate(game), rows = Array.from({ length: teams }, (_, t) => ({ team: t, members: [], fin: null, avgSquare: 0, ladders: 0, missed: 0 }));
  for (const p of pawns) {
    const r = rows[teamOf[p.seat - 1]];
    r.members.push(p.seat);
    r.avgSquare += p.cur;
    r.ladders += p.lad;
    r.missed += p.missed;
  }
  for (const r of rows) {
    const ps = r.members.map((s) => pawns[s - 1]);
    r.avgSquare = r.members.length ? r.avgSquare / r.members.length : 0;
    r.ladders = r.members.length ? r.ladders / r.members.length : 0;
    r.missed = r.members.length ? r.missed / r.members.length : 0;
    r.fin = ps.length && ps.every((p) => p.fin !== null) ? Math.max(...ps.map((p) => p.fin)) : null;
  }
  return rows.sort((a, b) => {
    const fa = a.fin ?? Infinity, fb = b.fin ?? Infinity;
    if (fa !== fb)
      return fa < fb ? -1 : 1;
    if (a.avgSquare !== b.avgSquare)
      return a.avgSquare > b.avgSquare ? -1 : 1;
    if (a.ladders !== b.ladders)
      return a.ladders > b.ladders ? -1 : 1;
    if (a.missed !== b.missed)
      return a.missed < b.missed ? -1 : 1;
    return fate.cmp(`team${a.team}`, `team${b.team}`, "teamrank") || a.team - b.team;
  });
}
function tableO(fate, b, finish, players, winners, maxThrows, milestone, b0, betas, absent) {
  const order = Array.from({ length: players }, (_, i) => i + 1).sort((a, c) => fate.cmp(a, c, `order|${b0}`) || a - c);
  const pawns = Array.from({ length: players }, (_, i) => new PawnO(i + 1));
  const queue = [...order];
  let at = 0;
  const t = { order, pawns, throws: 0, finishedOrder: [], finishThrow: new Map, milestoneIdx: new Map, whoseTurn: order[0], ended: false, reason: "running" };
  for (let k = 0;k < betas.length && !t.ended; k++) {
    const seat = queue[at], p = pawns[seat - 1];
    p.push(b, finish, absent?.(seat, k) ? null : rollO(fate.game, seat, k, betas[k]));
    if (p.fin !== null) {
      t.finishedOrder.push(seat);
      t.finishThrow.set(seat, k);
      queue.splice(at, 1);
      if (at >= queue.length)
        at = 0;
    } else
      at = (at + 1) % queue.length;
    if (milestone !== undefined && !t.milestoneIdx.has(seat) && p.cur >= milestone)
      t.milestoneIdx.set(seat, k);
    t.throws = k + 1;
    if (t.finishedOrder.length >= winners) {
      t.ended = true;
      t.reason = "winners";
    } else if (t.throws >= maxThrows) {
      t.ended = true;
      t.reason = "cap";
    }
  }
  t.whoseTurn = t.ended ? null : queue[at] ?? null;
  return t;
}
function tableRankO(fate, t) {
  const rest = t.pawns.filter((p) => !t.finishThrow.has(p.seat)).sort((a, b) => b.cur - a.cur || b.lad - a.lad || a.missed - b.missed || fate.cmp(a.seat, b.seat, "tablerank"));
  return [...t.finishedOrder, ...rest.map((p) => p.seat)];
}
function openByCounting(intervals, stop, v) {
  const pausedBefore = (r) => {
    let c = 0;
    for (const i of intervals)
      c += Math.max(0, Math.min(r, i.end) - i.start);
    return c;
  };
  let r = v;
  for (let guard = 0;guard < 1e4; guard++) {
    const iv = intervals.find((i) => r >= i.start && r < i.end);
    if (iv) {
      r = iv.end;
      continue;
    }
    const u = r - pausedBefore(r);
    if (u === v)
      break;
    r += v - u;
  }
  return stop !== null && r >= stop ? null : r;
}
var mNew = (max, lead) => ({ pauses: [], stop: null, ignored: [], max, lead });
var mEnd = (p, max) => Math.min(p.ended ?? Infinity, p.until ?? p.start + max);
var MAX_TIMED = 28800;
function mApply(s, m) {
  const cur = s.pauses.length ? s.pauses[s.pauses.length - 1] : null;
  const lead = m.at - m.signedAt;
  const bad = () => {
    s.ignored.push(m.seq);
    return false;
  };
  if (s.stop !== null)
    return bad();
  if (m.signedAt > m.at)
    return bad();
  const pausedNow = cur !== null && cur.start <= m.at && m.at < mEnd(cur, s.max);
  if (m.action === "pause") {
    if (lead < s.lead)
      return bad();
    if (cur !== null && m.at < mEnd(cur, s.max))
      return bad();
    if (m.until !== undefined && (m.until <= m.at || m.until - m.at > MAX_TIMED))
      return bad();
    s.pauses.push({ start: m.at, until: m.until ?? null, ended: null });
    return true;
  }
  if (m.action === "resume") {
    if (!pausedNow || cur === null)
      return bad();
    if (lead < 1)
      return bad();
    if (!(m.at > cur.start))
      return bad();
    cur.ended = m.at;
    return true;
  }
  if (m.action === "extend") {
    if (!pausedNow || cur === null)
      return bad();
    if (cur.ended !== null)
      return bad();
    if (lead < s.lead)
      return bad();
    if (m.until === undefined || m.until - m.at > MAX_TIMED)
      return bad();
    if (!(m.until > mEnd(cur, s.max)))
      return bad();
    cur.until = m.until;
    return true;
  }
  if (lead < s.lead)
    return bad();
  s.stop = m.at;
  return true;
}
var mIntervals = (s) => s.pauses.map((p) => ({ start: p.start, end: mEnd(p, s.max) }));

// games/snakes/bank.ts
var boardStats = { made: 0, ms: 0 };
var madeKeys = new Set;
var bankBoard = (ci, u, seat) => {
  const un = universe(ci, u), k = `${ci}/${u}/${seat}`;
  if (madeKeys.has(k))
    return boardOf({ gameId: un.game, board: BANK[ci].board }, seat, un.b0);
  const t0 = performance.now(), b = boardOf({ gameId: un.game, board: BANK[ci].board }, seat, un.b0);
  madeKeys.add(k);
  boardStats.made++;
  boardStats.ms += performance.now() - t0;
  return b;
};
var facts = new WeakMap;
function factsOf(b, finish, spreadTurns) {
  let f = facts.get(b);
  if (!f) {
    f = { faults: boardFaults(b), reach: allReachEnd(b, finish), E: expectedO(b, finish), W: withinO(b, finish, spreadTurns) };
    facts.set(b, f);
  }
  return f;
}
function cheapBoard(r, size, snakes, ladders, finish) {
  const L = LIMITS[size], side = sideO(size);
  for (let attempt = 0;attempt < 40; attempt++) {
    const used = new Set, sn = {}, la = {};
    let ok = true;
    for (let i = 0;i < ladders && ok; i++) {
      ok = false;
      for (let k = 0;k < 60 && !ok; k++) {
        const bo = r.int(2, size - 2), top = bo + r.int(L[0], L[1]);
        if (top >= size || used.has(bo) || used.has(top) || bo <= side && top > size - 2 * side)
          continue;
        used.add(bo);
        used.add(top);
        la[bo] = top;
        ok = true;
      }
    }
    for (let i = 0;i < snakes && ok; i++) {
      ok = false;
      for (let k = 0;k < 60 && !ok; k++) {
        const h = r.int(2, size - 1), tail = h - r.int(L[2], L[3]);
        if (tail < 1 || used.has(h) || used.has(tail))
          continue;
        used.add(h);
        used.add(tail);
        sn[h] = tail;
        ok = true;
      }
    }
    if (!ok)
      continue;
    const b = { size, snakes: sn, ladders: la };
    if (boardFaults(b).length === 0 && allReachEnd(b, finish))
      return b;
  }
  return null;
}

// games/snakes/k_walk.ts
var checkedDeterminism = new Set;
function checkBankBoard(c, ci, u, seat, bd, deep = false) {
  const cfg = BANK[ci].board, finish = cfg.finish, F = factsOf(bd, finish, spreadTurns(cfg.size));
  c.ok(F.faults.length === 0, "T-01", () => ({ faults: F.faults, ci, u, seat }));
  c.ok(boardProblem(bd) === null, "T-02", () => boardProblem(bd));
  c.ok(F.reach, "T-03", () => "oracle: a square cannot reach the end");
  c.ok(everySquareReachesEnd(bd, finish) === F.reach, "T-03", () => "engine and oracle disagree on traps");
  c.ok(Object.keys(bd.snakes).length === cfg.snakes && Object.keys(bd.ladders).length === cfg.ladders, "T-04", () => ({ s: Object.keys(bd.snakes).length, l: Object.keys(bd.ladders).length }));
  c.ok(bd.size === cfg.size && bd.side === sideO(cfg.size), "T-04");
  const target = targetTurnsFor(cfg.size), lo = target * (1 - BAND_TOLERANCE), hi = target * (1 + BAND_TOLERANCE);
  c.ok(F.E >= lo - 0.000001 && F.E <= hi + 0.000001, "T-05", () => ({ oracleExpectedTurns: F.E, lo, hi }));
  c.ok(Math.abs(bd.expectedTurns - F.E) <= 0.000001 * F.E, "T-05", () => ({ engine: bd.expectedTurns, oracle: F.E }));
  c.ok(F.W >= SPREAD_BAND.lo - 0.000000001 && F.W <= SPREAD_BAND.hi + 0.000000001, "T-05", () => ({ within: F.W }));
  c.ok(Math.abs(bd.within20 - F.W) <= 0.000000001, "T-05", () => ({ engine: bd.within20, oracle: F.W }));
  const S = BANK[ci].S;
  if (S > 1) {
    const o = seat % S + 1;
    c.ok(boardKey(bankBoard(ci, u, o)) !== boardKey(bd), "T-04", () => ({ seat, other: o }));
  }
  const key = `${ci}|${u}|${seat}`;
  if (deep) {
    const un = universe(ci, u), again = generateBoard(un.game, seat, un.b0, cfg);
    c.ok(same(again, bd), "T-04", () => "the same game, seat and B0 made a different board the second time");
    c.ok(boardKey(generateBoard(un.game, seat, un.b0.toUpperCase(), cfg)) === boardKey(bd), "T-04", () => "upper-case B0 gave another board");
  }
}
var SHAPE = (r) => [r.pos.join(","), r.ladders, r.snakes, r.missed, r.bestClimb, r.bestComeback, r.finishedTurn];
function kindWalk(r, c) {
  const useBank = r.chance(0.85);
  let b, finish, game, seat, params;
  if (useBank) {
    const ci = r.weighted(BANK_W), u = r.int(0, BANK[ci].U - 1);
    seat = r.int(1, BANK[ci].S);
    const bd = bankBoard(ci, u, seat);
    b = bd;
    finish = BANK[ci].board.finish;
    game = universe(ci, u).game;
    c.dim("board", `${bd.size}${finish[0]}`);
    checkBankBoard(c, ci, u, seat, bd, r.chance(0.004));
    params = { ci, u, seat };
  } else {
    const size = r.weighted([[100, 55], [144, 25], [225, 20]]), bseed = r.u32();
    finish = r.pick(["exact", "pass"]);
    const nb = cheapBoard(new Rng(bseed, 6), size, r.int(6, 12), r.int(6, 12), finish);
    if (!nb) {
      c.dim("board", "none");
      return { skipped: bseed };
    }
    b = nb;
    game = `G${bseed}`;
    seat = r.int(1, 1e4);
    c.dim("board", `${size}${finish[0]}`);
    c.ok(boardFaults(b).length === 0 && boardProblem(b) === null && allReachEnd(b, finish) && everySquareReachesEnd(b, finish), "T-02", () => ({ faults: boardFaults(b), problem: boardProblem(b) }));
    params = { cheap: bseed, size, finish };
  }
  const turns = r.chance(0.2) ? r.int(40, 120) : r.int(1, 45), missP = r.weighted([[0, 62], [0.15, 14], [0.5, 14], [0.9, 10]]), bs = r.u32();
  c.dim("turns", turns <= 10 ? "1-10" : turns <= 30 ? "11-30" : turns <= 45 ? "31-45" : "46-120");
  c.dim("missed", missP);
  const betas = betasOf(bs, turns), run = newRun(seat), pw = new PawnO(seat), rolls = [];
  for (let t = 0;t < turns; t++) {
    const roll = rollFor(game, seat, t, betas[t]), ro = rollO(game, seat, t, betas[t]);
    c.ok(roll === ro && roll >= 1 && roll <= 6, "T-07", () => ({ t, engine: roll, oracle: ro }));
    const use = missP === 0 || r.float() >= missP ? roll : null;
    rolls.push(use);
    advance(b, run, use, finish);
    pw.push(b, finish, use === null ? null : ro);
    c.ok(squareOf(run) === pw.cur, "T-10", () => ({ t, engine: squareOf(run), oracle: pw.cur }));
  }
  const mine = { pos: pw.pos, ladders: pw.lad, snakes: pw.sn, missed: pw.missed, bestClimb: pw.bestClimb, bestComeback: pw.bestComeback, finishedTurn: pw.fin };
  c.ok(same(SHAPE(run), SHAPE(mine)), "T-10", () => ({ engine: SHAPE(run), oracle: SHAPE(mine) }));
  const rr = runFrom(b, seat, rolls, finish);
  c.ok(same(SHAPE(rr), SHAPE(mine)) && rr.history.length === pw.rolls.length, "T-10", () => "runFrom differs from the oracle replay");
  c.ok(run.history.every((s, i) => s.roll === pw.rolls[i] && s.kind !== undefined), "T-10", () => "history rolls differ");
  if (pw.fin !== null) {
    const sq = squareOf(run), ft = run.finishedTurn;
    advance(b, run, 6, finish);
    advance(b, run, null, finish);
    c.ok(squareOf(run) === b.size && sq === b.size && run.finishedTurn === ft && run.pos.length === turns + 2, "T-10", () => "a finished pawn moved");
  } else
    c.ok(squareOf(run) < b.size && run.finishedTurn === null, "T-10", () => "unfinished pawn on the last square");
  for (let i = 0;i < 10; i++) {
    const from = r.int(1, b.size - 1), roll = r.int(1, 6), e = step(b, from, roll, finish), o = stepO(b, from, roll, finish);
    c.ok(e.to === o.to && e.kind === o.kind && e.from === from && e.roll === roll, "T-09", () => ({ from, roll, engine: e, oracle: o }));
    if (e.kind === "overshoot")
      c.ok(finish === "exact" && from + roll > b.size && e.to === from, "T-09", () => ({ from, roll, e }));
    if (e.kind === "finish")
      c.ok(e.to === b.size, "T-09");
  }
  for (const bad of [0, 7, -1, 1.5, NaN]) {
    let threw = false;
    try {
      step(b, 5, bad, finish);
    } catch {
      threw = true;
    }
    c.ok(threw, "T-09", () => ({ roll: bad }));
  }
  let t1 = false, t2 = false, t3 = false;
  try {
    rollFor(game, seat, 0, "not-a-beacon-value");
  } catch {
    t1 = true;
  }
  try {
    rollFor(game, seat, -1, betas[0] ?? "a".repeat(64));
  } catch {
    t2 = true;
  }
  try {
    rollFor(game, seat, 1.5, betas[0] ?? "a".repeat(64));
  } catch {
    t3 = true;
  }
  c.ok(t1 && t2 && t3, "T-07", () => ({ t1, t2, t3 }));
  if (betas.length)
    c.ok(rollFor(game, seat, 0, betas[0].toUpperCase()) === rollFor(game, seat, 0, betas[0]), "T-07", () => "upper-case beacon value gave another roll");
  return { ...params, bs, turns, missP };
}
function kindCorrupt(r, c) {
  const size = r.weighted([[100, 55], [144, 25], [225, 20]]), finish = r.pick(["exact", "pass"]), bseed = r.u32(), L = LIMITS[size], side = sideO(size);
  c.dim("board", `${size}${finish[0]}`);
  const base = cheapBoard(new Rng(bseed, 6), size, r.int(6, 12), r.int(6, 12), finish);
  if (!base)
    return { skipped: bseed };
  const mode = r.weighted([["targeted", 40], ["random", 35], ["trap", 25]]);
  const cp = () => ({ size, snakes: { ...base.snakes }, ladders: { ...base.ladders } });
  const pickKey = (o) => Number(r.pick(Object.keys(o)));
  c.dim("corruption", mode);
  if (mode === "targeted") {
    const m = r.int(0, 10), b = cp(), s = pickKey(b.snakes), l = pickKey(b.ladders);
    switch (m) {
      case 0: {
        const t = b.snakes[s];
        delete b.snakes[s];
        b.snakes[1] = t;
        break;
      }
      case 1: {
        const t = b.snakes[s];
        delete b.snakes[s];
        b.snakes[size] = t;
        break;
      }
      case 2: {
        const t = b.snakes[s];
        delete b.snakes[s];
        b.snakes[t] = s;
        break;
      }
      case 3: {
        const h = s;
        delete b.snakes[s];
        b.snakes[h] = h - (L[2] - 1);
        break;
      }
      case 4: {
        const h = s;
        delete b.snakes[s];
        b.snakes[h] = h - (L[3] + 1);
        break;
      }
      case 5: {
        const t = b.ladders[l];
        delete b.ladders[l];
        b.ladders[1] = t;
        break;
      }
      case 6: {
        const bo = l;
        b.ladders[bo] = size;
        break;
      }
      case 7: {
        const t = b.ladders[l];
        delete b.ladders[l];
        b.ladders[t] = l;
        break;
      }
      case 8:
        b.ladders[l] = l + (L[0] - 1);
        break;
      case 9:
        b.ladders[l] = l + (L[1] + 1);
        break;
      default: {
        const sq = r.pick(Object.keys(b.snakes).map(Number));
        delete b.ladders[l];
        b.ladders[sq] = sq + L[0];
        break;
      }
    }
    c.ok(boardProblem(b) !== null, "T-02", () => ({ mutation: m, size }));
    c.ok(boardFaults(b).length > 0, "T-02", () => ({ mutation: m, size, note: "oracle accepts a broken board" }));
    return { bseed, size, finish, mode, m };
  }
  if (mode === "random") {
    const b = cp(), k = r.int(1, 3);
    for (let i = 0;i < k; i++) {
      const isSnake = r.chance(0.5), o = isSnake ? b.snakes : b.ladders, key = pickKey(o), v = o[key], nv = r.chance(0.5) ? r.int(1, size) : v + r.int(-3, 3) * r.pick([1, 1, 8, 30]);
      if (r.chance(0.5))
        o[key] = nv;
      else {
        delete o[key];
        o[nv] = v;
      }
    }
    const e = boardProblem(b) !== null, o = boardFaults(b).length > 0;
    c.ok(e === o, "T-02", () => ({ engineRefuses: e, oracleRefuses: o, snakes: b.snakes, ladders: b.ladders }));
    if (!e)
      c.ok(everySquareReachesEnd(b, finish) === allReachEnd(b, finish), "T-03", () => "engine and oracle disagree on traps");
    return { bseed, size, finish, mode, k };
  }
  const heads = new Set, want = r.int(4, 8), contiguous = r.chance(0.5), start = size - 1 - (contiguous ? 5 : r.int(5, 8));
  if (contiguous)
    for (let i = 0;i < 6; i++)
      heads.add(size - 1 - i);
  else
    while (heads.size < want)
      heads.add(r.int(size - 9, size - 1));
  const used = new Set(heads), tr = { size, snakes: {}, ladders: {} };
  for (const h of heads) {
    for (let k = 0;k < 50; k++) {
      const t = h - r.int(L[2], L[3]);
      if (t >= 1 && !used.has(t)) {
        used.add(t);
        tr.snakes[h] = t;
        break;
      }
    }
  }
  const e = everySquareReachesEnd(tr, finish), o = allReachEnd(tr, finish);
  c.ok(e === o, "T-03", () => ({ engine: e, oracle: o, heads: [...heads] }));
  if (contiguous && Object.keys(tr.snakes).length === 6) {
    c.ok(!e && !o, "T-03", () => ({ engine: e, oracle: o, note: "six snake heads in a row on the last squares trap everyone" }));
  }
  return { bseed, size, finish, mode, heads: [...heads] };
}
function kindDice(r, c) {
  const game = "D" + r.hex(4), seat = r.int(1, 1e4), bs = r.u32(), n = 600, betas = betasOf(bs, 1), counts = [0, 0, 0, 0, 0, 0];
  const rr = new Rng(bs, 8);
  for (let t = 0;t < n; t++) {
    const bt = rr.hex(32), v = rollFor(game, seat, t, bt);
    counts[v - 1]++;
    c.ok(v === rollO(game, seat, t, bt), "T-07", () => ({ t, bt }));
  }
  let chi = 0;
  for (const k of counts)
    chi += (k - n / 6) * (k - n / 6) / (n / 6);
  c.ok(chi < 40, "T-08", () => ({ counts, chi }));
  c.ok(counts.every((k) => k > 0), "T-08", () => counts);
  let allSame = true;
  const bt = betas[0];
  const first = rollFor(game, 1, 0, bt);
  for (let s = 2;s <= 40; s++)
    if (rollFor(game, s, 0, bt) !== first) {
      allSame = false;
      break;
    }
  c.ok(!allSame, "T-08", () => "40 seats got the same roll from one beacon value");
  return { game, seat, bs };
}

// games/snakes/k_race.ts
var MAXP = [120, 12, 10, 10, 10, 10, 8, 8, 8, 8];
var pidFor = (salt, seat) => `${seat}x${mix32(salt + seat * 40503).toString(16).padStart(8, "0")}`;
var norm = (xs) => xs.map((s) => [s.pattern, s.ordinal, s.idx, s.pids.join("+"), s.tied ?? 0]);
function pickLines(r, nMilestones, endPrizes, teams, presence) {
  if (r.chance(0.4) && !teams)
    return { lines: [{ pattern: "milestone", ordinal: 1 }, ...[1, 2, 3, 4, 5].map((o) => ({ pattern: "finish", ordinal: o }))], label: "default" };
  const out = [];
  const add = (p, k) => {
    for (let o = 1;o <= k; o++)
      out.push({ pattern: p, ordinal: o });
  };
  if (r.chance(0.7))
    add("milestone", r.int(1, nMilestones));
  if (r.chance(0.75))
    add("finish", r.int(1, 5));
  if (teams && r.chance(0.9))
    add("team", r.int(1, 3));
  if (r.chance(0.4))
    add("climb", 1);
  if (r.chance(0.4))
    add("comeback", 1);
  if (presence && r.chance(0.5))
    add("nevermissed", 1);
  if (!out.length)
    add("finish", 1);
  return { lines: r.chance(0.3) ? r.shuffle(out) : out, label: "custom" };
}
function oracleTeamNote(rows, i) {
  const x = rows[i];
  return rows.filter((y) => x.fin !== null ? y.fin === x.fin : y.fin === null && y.avgSquare === x.avgSquare).length > 1;
}
function kindRace(r, c, seed) {
  const nb = r.weighted([[2, 6], [3, 10], [4, 10], [5, 10], [6, 9], [7, 7], [8, 6], [9, 4], [10, 4], [11, 3], [12, 3], [20, 7], [60, 6]]);
  const n = nb === 20 ? r.int(13, 40) : nb === 60 ? r.chance(0.8) ? r.int(41, 70) : r.int(71, 120) : nb;
  const ci = n > 12 ? 0 : r.weighted(BANK_W), u = n > 12 ? 0 : r.int(0, BANK[ci].U - 1), nn = Math.min(n, MAXP[ci]), un = universe(ci, u), bc = BANK[ci].board, { size, finish } = bc;
  const players = nn;
  const turnCap0 = r.weighted([[10, 14], [12, 8], [15, 10], [20, 12], [26, 30], [40, 10], [60, 8], [100, 5], [150, 3]]), turnCap = players > 40 ? 10 + turnCap0 % 3 : players > 12 ? Math.min(turnCap0, 15) : turnCap0;
  const msn = r.weighted([[0, 35], [1, 35], [2, 15], [3, 15]]);
  const milestones = msn === 0 ? [75] : Array.from(new Set(Array.from({ length: msn }, () => r.int(2, size - 1)))).sort((a, b) => a - b);
  const endPrizes = r.weighted([[5, 32], [1, 14], [2, 14], [3, 20], [4, 20]]), play = r.chance(0.38) ? "presence" : "fate", exclusive = r.chance(0.3);
  const teams = players >= 4 && r.chance(0.13) ? r.int(2, Math.min(10, players)) : undefined;
  const cfg = { gameId: un.game, players, board: bc, milestones, turnCap, endPrizes, play, exclusive, ...teams ? { teams } : {} };
  c.dim("board", `${size}${finish[0]}`);
  c.dim("mode", teams ? "team" : "race");
  c.dim("play", play);
  c.dim("players", bucketN(players));
  c.dim("exclusive", exclusive);
  c.ok(validateRaceCfg(cfg) === null, "T-54", () => validateRaceCfg(cfg));
  const bs = r.u32(), L = r.chance(0.2) ? r.int(1, turnCap) : turnCap, betas = betasOf(bs, L), salt = r.u32();
  let thrown;
  let oracleThrown;
  const okPairs = new Set;
  let claimsMode = false;
  if (play === "presence") {
    const pThrow = r.weighted([[1, 10], [0.97, 30], [0.8, 25], [0.5, 20], [0.2, 10], [0, 5]]);
    claimsMode = r.chance(0.55);
    c.dim("pThrow", pThrow);
    if (!claimsMode) {
      thrown = (s, t) => mix32(mix32(salt + s) + t * 7919) % 1000 < pThrow * 1000;
    } else {
      const rec = new ThrowRecord, dev = (s) => `dev${s}x${(salt % 997).toString(16)}`, registered = (s) => s >= 1 && s <= players ? dev(s) : undefined, perTurn = new Array(L).fill(0);
      for (let t = 0;t < L; t++) {
        const win = { openMs: 1700000000000 + t * 18000, windowSec: 10 };
        for (let s = 1;s <= players; s++) {
          if (r.float() >= pThrow)
            continue;
          const kind = r.weighted([["ok", 86], ["early", 3], ["late", 4], ["wrong", 3], ["unknown", 4]]);
          const seat = kind === "unknown" ? players + r.int(1, 5) : s, device = kind === "wrong" ? dev(s === 1 ? 2 : s - 1) + "z" : dev(s);
          const arrivalMs = kind === "early" ? win.openMs - r.int(1, 5000) : kind === "late" ? win.openMs + win.windowSec * 1000 + r.int(0, 3000) : win.openMs + r.int(0, win.windowSec * 1000 - 1);
          const got = acceptThrow({ seat, turn: t, device, arrivalMs }, registered, win);
          const want = kind === "ok" ? "ok" : kind === "early" ? "window not open yet" : kind === "late" ? "window closed" : kind === "wrong" ? "wrong device" : "unknown seat";
          c.ok((got.ok ? "ok" : got.reason) === want, "T-29", () => ({ kind, got, arrivalMs, win }));
          if (got.ok) {
            c.ok(rec.add(s, t) === true, "T-29", () => "first throw refused");
            okPairs.add(s + ":" + t);
            perTurn[t]++;
            if (r.chance(0.08))
              c.ok(rec.add(s, t) === false, "T-29", () => "a repeated throw counted twice");
          }
        }
        c.ok(acceptThrow({ seat: 1, turn: t, device: dev(1), arrivalMs: win.openMs }, registered, win).ok === true, "T-29", () => "arrival at the opening instant refused");
        c.ok(acceptThrow({ seat: 1, turn: t, device: dev(1), arrivalMs: win.openMs + win.windowSec * 1000 }, registered, win).ok === false, "T-29", () => "arrival at the closing instant accepted");
      }
      c.ok(rec.count === okPairs.size, "T-29", () => ({ count: rec.count, oracle: okPairs.size }));
      for (let t = 0;t < Math.min(L, 6); t++)
        c.ok(rec.throwsIn(t) === perTurn[t], "T-29", () => ({ t, engine: rec.throwsIn(t), oracle: perTurn[t] }));
      thrown = rec.thrown;
      oracleThrown = (s, t) => okPairs.has(s + ":" + t);
    }
  }
  c.dim("claims", play === "presence" ? claimsMode ? "collector" : "pattern" : "none");
  const st = playRace(cfg, { b0: un.b0, betas, ...thrown ? { thrown } : {} });
  const fate = new Fate(cfg.gameId), pawns = Array.from({ length: players }, (_, i) => new PawnO(i + 1));
  const teamOf = teams ? teamsO(fate, players, teams, un.b0) : null;
  let turnsPlayed = 0, ended = false, reason = "running", finCount = 0;
  const teamDone = () => {
    if (!teamOf || !teams)
      return false;
    const left = new Array(teams).fill(0);
    for (const p of pawns)
      if (p.fin === null)
        left[teamOf[p.seat - 1]]++;
    return left.some((x, ti) => x === 0 && teamOf.includes(ti));
  };
  for (let t = 0;t < L && !ended; t++) {
    for (let s = 1;s <= players; s++) {
      const throws = play === "fate" || (oracleThrown ?? thrown ? (oracleThrown ?? thrown)(s, t) : false);
      pawns[s - 1].push(st.boards[s - 1], finish, throws ? rollO(cfg.gameId, s, t, betas[t]) : null);
    }
    turnsPlayed = t + 1;
    finCount = 0;
    for (const p of pawns)
      if (p.fin !== null)
        finCount++;
    if (teams) {
      if (teamDone()) {
        ended = true;
        reason = "finishers";
      }
    } else if (finCount >= endPrizes) {
      ended = true;
      reason = "finishers";
    }
    if (!ended && turnsPlayed >= turnCap) {
      ended = true;
      reason = "cap";
    }
  }
  c.dim("end", reason);
  c.ok(st.turnsPlayed === turnsPlayed && st.ended === ended && st.endReason === reason && st.finishedCount === finCount, "T-21", () => ({ engine: [st.turnsPlayed, st.ended, st.endReason, st.finishedCount], oracle: [turnsPlayed, ended, reason, finCount], cfg: { turnCap, endPrizes, teams, L } }));
  let posOk = true, firstBad = -1;
  for (let s = 0;s < players; s++) {
    const run = st.runs[s], p = pawns[s];
    if (!numsEq(run.pos, p.pos) || run.ladders !== p.lad || run.snakes !== p.sn || run.missed !== p.missed || run.bestClimb !== p.bestClimb || run.bestComeback !== p.bestComeback || (run.finishedTurn ?? null) !== p.fin) {
      posOk = false;
      firstBad = s + 1;
      break;
    }
  }
  c.ok(posOk, "T-20", () => ({ seat: firstBad, engine: st.runs[firstBad - 1], oracle: pawns[firstBad - 1] }));
  c.ok(players === st.runs.length && players === st.boards.length, "T-20");
  if (play === "presence")
    c.ok(pawns.every((p) => p.pos.length === turnsPlayed) && pawns.every((p) => p.missed <= turnsPlayed), "T-20");
  const ordO = orderO(fate, "rank", pawns), ordE = orderPlayers(st);
  c.ok(numsEq(ordE.map((x) => x.seat), ordO.map((x) => x.seat)), "T-22", () => ({ engine: ordE.slice(0, 8).map((x) => x.seat), oracle: ordO.slice(0, 8).map((x) => x.seat) }));
  c.ok(new Set(ordE.map((x) => x.seat)).size === players, "T-22", () => "a player is listed twice or missing");
  const shuffled = orderPlayers({ ...st, runs: r.shuffle(st.runs) });
  c.ok(numsEq(shuffled.map((x) => x.seat), ordE.map((x) => x.seat)), "T-22", () => "the order of the player list changed the ranking");
  for (let i = 1;i < Math.min(players, 12); i++) {
    const a = ordO[i - 1], b = ordO[i];
    c.ok(chainKey(fate, "rank", a, b).order < 0, "T-22", () => ({ i, a: a.seat, b: b.seat }));
  }
  const top = rankPlayers(st, 10);
  c.ok(top.length === Math.min(10, players), "T-22", () => top.length);
  for (let i = 0;i < top.length; i++) {
    const row = top[i], p = ordO[i];
    c.ok(row.rank === i + 1 && row.seat === p.seat && row.square === p.cur && row.ladders === p.lad && row.missed === p.missed && (row.finishedTurn ?? null) === p.fin, "T-22", () => ({ i, row, oracle: p.seat }));
    const lvl = (x) => p.fin !== null ? x.fin === p.fin : x.fin === null && x.cur === p.cur, group = ordO.filter(lvl);
    if (group.length > 1) {
      let deepest = 0;
      for (let j = 1;j < group.length; j++)
        deepest = Math.max(deepest, chainKey(fate, "rank", group[j - 1], group[j]).key);
      const where = p.fin !== null ? `finished on turn ${p.fin + 1}` : `are on square ${p.cur}`;
      c.ok(row.note === `${group.length} players ${where}; decided by ${KEY_TEXT[Math.max(deepest, 2)]}`, "T-23", () => ({ i, note: row.note, group: group.length, deepest }));
    } else
      c.ok(row.note === "", "T-23", () => ({ i, note: row.note }));
  }
  const pids = Array.from({ length: players }, (_, i) => pidFor(salt, i + 1)), pidOf = (s) => pids[s - 1];
  const { lines, label } = pickLines(r, milestones.length, endPrizes, !!teams, play === "presence");
  c.dim("prizes", label);
  const got = settleRace(st, lines.map((l) => ({ pattern: l.pattern, ordinal: l.ordinal })), pidOf);
  let want;
  let teamRows = null;
  if (teams && teamOf) {
    teamRows = teamTableO(cfg.gameId, pawns, teamOf, teams);
    want = [];
    if (ended)
      for (const l of lines) {
        if (l.pattern !== "team")
          continue;
        const row = teamRows[l.ordinal - 1];
        if (!row)
          continue;
        want.push({ pattern: "team", ordinal: l.ordinal, idx: Math.max(0, turnsPlayed - 1), pids: row.members.map(pidOf), ...oracleTeamNote(teamRows, l.ordinal - 1) ? { tied: 2 } : {} });
      }
    const dealt = teamsOf(cfg, un.b0), sizes = new Array(teams).fill(0);
    for (const t of dealt)
      sizes[t]++;
    c.ok(numsEq(dealt, teamOf) && Math.max(...sizes) - Math.min(...sizes) <= 1 && dealt.every((t) => t >= 0 && t < teams), "T-26", () => ({ dealt, teamOf, sizes }));
    const tt = teamTable(cfg, st, dealt);
    c.ok(numsEq(tt.map((x) => x.team), teamRows.map((x) => x.team)), "T-26", () => ({ engine: tt.map((x) => x.team), oracle: teamRows.map((x) => x.team) }));
    for (let i = 0;i < tt.length; i++) {
      const e = tt[i], o = teamRows[i];
      c.ok(e.rank === i + 1 && numsEq(e.members, o.members) && e.finishedTurn === o.fin && Math.abs(e.avgSquare - o.avgSquare) < 0.000000001 && Math.abs(e.ladders - o.ladders) < 0.000000001 && Math.abs(e.missed - o.missed) < 0.000000001 && e.note !== "" === oracleTeamNote(teamRows, i), "T-26", () => ({ i, engine: e, oracle: o }));
    }
    c.ok(tt.reduce((a, x) => a + x.members.length, 0) === players, "T-26");
  } else {
    want = settleO(fate, { pawns, turnsPlayed, ended, endPrizes, milestones, presence: play === "presence", exclusive }, lines, pidOf);
  }
  c.ok(same(norm(got), norm(want)), exclusive ? "T-25" : teams ? "T-26" : "T-24", () => ({ engine: norm(got), oracle: norm(want), exclusive, ended }));
  if (exclusive && !teams) {
    const w = new Map;
    for (const s of got)
      for (const p of s.pids)
        w.set(p, (w.get(p) ?? 0) + 1);
    c.ok([...w.values()].every((k) => k === 1), "T-25", () => ({ got: norm(got) }));
    if (!ended)
      c.ok(got.length === 0, "T-25", () => "a prize was given before the end although one-prize-per-person is on");
  }
  if (!teams && !exclusive) {
    const first = pawns.filter((p) => p.fin !== null).sort((a, b) => a.fin - b.fin)[0];
    const f1 = got.find((x) => x.pattern === "finish" && x.ordinal === 1);
    if (first && f1)
      c.ok(f1.idx === first.fin, "T-24", () => ({ f1, first: first.fin }));
  }
  const view = spectatorView(st, (s) => `n${s}`), crowd = crowdOf(st), bands = new Array(10).fill(0);
  for (const p of pawns)
    bands[Math.min(9, Math.floor((p.cur - 1) * 10 / size))]++;
  c.ok(numsEq(crowd.bands, bands) && numsEq(view.bands, bands) && bands.reduce((a, b) => a + b, 0) === players, "T-27", () => ({ engine: crowd.bands, oracle: bands }));
  c.ok(crowd.players === players && crowd.turn === turnsPlayed && crowd.finished === finCount, "T-27");
  for (let k = 0;k < 4; k++) {
    const s = r.int(1, players), lower = pawns.filter((p) => p.cur < pawns[s - 1].cur).length;
    c.ok(crowd.aheadOf(s) === Math.round(100 * lower / Math.max(1, players)), "T-27", () => ({ s, engine: crowd.aheadOf(s), lower }));
  }
  c.ok(same(Object.keys(view).sort(), ["bands", "ended", "finished", "kind", "leaders", "players", "turn"]) && view.leaders.length === Math.min(10, players), "T-28", () => Object.keys(view));
  const js = JSON.stringify(view);
  c.ok(!js.includes(un.b0) && !js.includes(un.game) && !js.includes(betas[0] ?? "~~") && view.leaders.every((l, i) => same(Object.keys(l).sort(), ["finished", "name", "rank", "square"]) && l.name === `n${ordO[i].seat}` && l.square === ordO[i].cur && l.finished === (ordO[i].fin !== null)), "T-28", () => view);
  c.ok(view.kind === (teams ? "team" : "race") && view.turn === turnsPlayed && view.ended === ended && view.players === players && view.finished === finCount, "T-28", () => view);
  c.ok(mayThrow("player") && !mayThrow("spectator"), "T-30");
  if (!teams && r.chance(0.5)) {
    const v = validateCfg({ ...bc.size === 100 && bc.snakes === 9 && bc.ladders === 9 && bc.finish === "exact" ? {} : { board: bc }, milestones, turnCap, endPrizes, play, ...exclusive ? { exclusive: true } : {} }, defaultCfg());
    c.ok(v.ok, "T-31", () => v);
    if (v.ok) {
      const rc = raceCfgOf(un.game, v.cfg, players), eq = { ...cfg };
      delete eq.teams;
      c.ok(same(rc, eq), "T-31", () => ({ made: rc, expected: eq }));
      const g = playGame(un.game, v.cfg, players, { b0: un.b0, betas, ...thrown ? { thrown } : {} });
      c.ok(g.kind === "race" && same(g.st.runs.map((x) => x.pos), st.runs.map((x) => x.pos)), "T-31", () => "playGame differs from playRace");
      if (g.kind === "race")
        c.ok(same(norm(settleGame(g, v.cfg, pids)), norm(settleRace(g.st, v.cfg.rewards, pidOf))), "T-31", () => "settleGame differs from settleRace");
    }
  }
  return { ci, u, players, cfg: { turnCap, endPrizes, milestones, play, exclusive, teams }, bs, L, salt, claimsMode, lines: lines.map((l) => l.pattern + l.ordinal).join(",") };
}
function kindTable(r, c) {
  const ci = r.weighted([[0, 45], [1, 12], [2, 10], [3, 10], [4, 23]]), u = r.int(0, BANK[ci].U - 1), un = universe(ci, u), bc = BANK[ci].board, finish = bc.finish;
  const n = r.weighted([[2, 9], [3, 12], [4, 12], [5, 12], [6, 10], [7, 8], [8, 8], [10, 8], [12, 8], [16, 7], [20, 6]]), winners = r.int(1, Math.min(3, n - 1));
  const via = r.chance(0.6) ? "game" : "direct", ep = r.int(1, 5), ms = r.chance(0.5) ? [r.int(2, bc.size - 1)] : undefined;
  c.dim("board", `${bc.size}${finish[0]}`);
  c.dim("mode", "table");
  c.dim("players", bucketN(n));
  c.dim("via", via);
  let cfg, eng = null;
  if (via === "game") {
    const v = validateCfg({ mode: "table", ...bc.size === 100 && bc.snakes === 9 && bc.ladders === 9 && bc.finish === "exact" ? {} : { board: bc }, endPrizes: ep, ...ms ? { milestones: ms } : {} }, defaultCfg());
    if (!v.ok) {
      c.ok(false, "T-31", () => v);
      return { ci, u, n, bad: true };
    }
    eng = v.cfg;
    cfg = tableCfgOf(un.game, v.cfg, n);
    const want = { gameId: roundEid(un.game, 1), players: n, winners: Math.max(1, Math.min(ep, 3, n - 1)), maxThrows: 600, milestone: ms ? ms[0] : 75 };
    c.ok(cfg.players === n && cfg.gameId === want.gameId && cfg.winners === want.winners && cfg.maxThrows === 600 && cfg.milestone === want.milestone && same(cfg.board, bc), "T-31", () => ({ made: cfg, want }));
  } else {
    cfg = { gameId: un.game, players: n, board: bc, winners, maxThrows: r.chance(0.4) ? 600 : r.int(5 * n, 5 * n + 150), ...ms ? { milestone: ms[0] } : {} };
  }
  c.ok(validateTableCfg(cfg) === null, "T-54", () => validateTableCfg(cfg));
  const bs = r.u32(), L = Math.min(cfg.maxThrows, r.chance(0.3) ? r.int(1, cfg.maxThrows) : cfg.maxThrows, 420), betas = betasOf(bs, L), salt = r.u32(), pAbs = r.weighted([[0, 70], [0.1, 15], [0.5, 15]]);
  const absent = pAbs > 0 ? (s, k) => mix32(salt ^ Math.imul(s, 977) ^ Math.imul(k, 131)) % 1000 < pAbs * 1000 : undefined;
  c.dim("absent", pAbs);
  let st;
  if (via === "game") {
    const g = playGame(un.game, eng, n, { b0: un.b0, betas, ...absent ? { absent } : {} });
    if (g.kind !== "table") {
      c.ok(false, "T-31", () => "playGame gave a race for a table game");
      return { ci, u, n };
    }
    st = g.st;
  } else
    st = playTable(cfg, { b0: un.b0, betas, ...absent ? { absent } : {} });
  const fate = new Fate(cfg.gameId), t = tableO(fate, st.board, finish, n, cfg.winners, cfg.maxThrows, cfg.milestone, un.b0, betas, absent);
  c.dim("end", st.endReason);
  c.ok(numsEq(st.order, t.order) && numsEq(turnOrder(cfg.gameId, n, un.b0), t.order), "T-40", () => ({ engine: st.order, oracle: t.order }));
  c.ok(new Set(st.order).size === n && st.order.every((s) => s >= 1 && s <= n), "T-40", () => st.order);
  c.ok(numsEq(turnOrder(cfg.gameId, n, un.b0), turnOrder(cfg.gameId, n, un.b0)), "T-40");
  let ok = numsEq(st.finishedOrder, t.finishedOrder) && st.throws === t.throws && st.ended === t.ended && st.endReason === t.reason && st.whoseTurn === t.whoseTurn && same([...st.finishThrow.entries()], [...t.finishThrow.entries()]) && same([...st.milestoneIdx.entries()].sort(), [...t.milestoneIdx.entries()].sort());
  c.ok(ok, "T-41", () => ({ engine: [st.finishedOrder, st.throws, st.ended, st.endReason, st.whoseTurn], oracle: [t.finishedOrder, t.throws, t.ended, t.reason, t.whoseTurn] }));
  let bad = -1;
  for (let s = 0;s < n; s++) {
    const run = st.runs[s], p = t.pawns[s];
    if (!numsEq(run.pos, p.pos) || run.missed !== p.missed || run.ladders !== p.lad || (run.finishedTurn ?? null) !== p.fin) {
      bad = s + 1;
      break;
    }
  }
  c.ok(bad < 0, "T-41", () => ({ seat: bad, engine: st.runs[bad - 1]?.pos, oracle: t.pawns[bad - 1]?.pos }));
  c.ok(st.ended ? st.endReason === "winners" ? st.finishedOrder.length >= cfg.winners : st.throws >= cfg.maxThrows : st.finishedOrder.length < cfg.winners && st.throws < cfg.maxThrows, "T-42", () => ({ ended: st.ended, reason: st.endReason, fin: st.finishedOrder.length, winners: cfg.winners, throws: st.throws }));
  c.ok(st.whoseTurn === null ? st.ended : !st.ended && st.runs[st.whoseTurn - 1].finishedTurn === null, "T-41", () => ({ whose: st.whoseTurn, ended: st.ended }));
  const rank = rankTable(st), rO = tableRankO(fate, t);
  c.ok(numsEq(rank.map((x) => x.seat), rO) && rank.every((x, i) => x.rank === i + 1) && new Set(rank.map((x) => x.seat)).size === n, "T-42", () => ({ engine: rank.map((x) => x.seat).slice(0, 10), oracle: rO.slice(0, 10) }));
  c.ok(rank.every((x) => x.finishedAtThrow === (t.finishThrow.get(x.seat) ?? null) && x.square === t.pawns[x.seat - 1].cur), "T-42");
  const lines = [{ pattern: "milestone", ordinal: 1 }, { pattern: "finish", ordinal: 1 }, { pattern: "finish", ordinal: 2 }, { pattern: "finish", ordinal: 3 }, { pattern: "finish", ordinal: 4 }, { pattern: "climb", ordinal: 1 }, { pattern: "milestone", ordinal: 2 }];
  const pids = Array.from({ length: n }, (_, i) => pidFor(salt, i + 1)), got = settleTable(st, lines, (s) => pids[s - 1]);
  const want = [];
  for (const l of lines) {
    if (l.pattern === "finish") {
      const seat = t.finishedOrder[l.ordinal - 1];
      if (seat !== undefined)
        want.push({ pattern: "finish", ordinal: l.ordinal, idx: t.finishThrow.get(seat), pids: [pids[seat - 1]] });
    } else if (l.pattern === "milestone" && l.ordinal === 1 && cfg.milestone !== undefined) {
      let best = null;
      for (const e of t.milestoneIdx)
        if (!best || e[1] < best[1])
          best = e;
      if (best)
        want.push({ pattern: "milestone", ordinal: 1, idx: best[1], pids: [pids[best[0] - 1]] });
    }
  }
  c.ok(same(norm(got), norm(want)), "T-42", () => ({ engine: norm(got), oracle: norm(want) }));
  c.ok(got.length === 0 || got.every((x) => x.round === 1), "T-42");
  const view = spectatorView(st), bands = new Array(10).fill(0);
  for (const p of t.pawns)
    bands[Math.min(9, Math.floor((p.cur - 1) * 10 / bc.size))]++;
  c.ok(view.kind === "table" && numsEq(view.bands, bands) && view.turn === t.throws && view.players === n && view.finished === t.finishedOrder.length && view.leaders.length === Math.min(10, n) && !JSON.stringify(view).includes(un.b0), "T-28", () => view);
  return { ci, u, n, via, cfg: { winners: cfg.winners, maxThrows: cfg.maxThrows, milestone: cfg.milestone }, bs, L, salt, pAbs, ep, ms };
}

// games/snakes/k_cfg.ts
var clean80 = (s, max = 80) => s.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
function validSettings(r) {
  const input = {}, exp = {};
  const size = r.pick([100, 144, 225]);
  if (r.chance(0.6)) {
    const bd = {}, pick = (k, v) => {
      if (r.chance(0.8))
        bd[k] = v;
    };
    pick("size", size);
    pick("snakes", r.int(6, 12));
    pick("ladders", r.int(6, 12));
    pick("finish", r.pick(["exact", "pass"]));
    input.board = bd;
    const e = { size: bd.size ?? 100, snakes: bd.snakes ?? 9, ladders: bd.ladders ?? 9, finish: bd.finish ?? "exact" };
    exp.board = e.size === 100 && e.snakes === 9 && e.ladders === 9 && e.finish === "exact" ? undefined : e;
  } else if (r.chance(0.1)) {
    input.board = null;
    exp.board = undefined;
  }
  const bsz = input.board ? exp.board ? exp.board.size : 100 : 100;
  const mode = r.weighted([["race", 55], ["team", 17], ["table", 28]]);
  if (mode !== "race" || r.chance(0.3))
    input.mode = mode;
  if (mode === "team") {
    input.teams = r.int(2, 10);
    exp.teams = input.teams;
  }
  exp.mode = mode === "race" ? undefined : mode;
  if (mode === "race" && r.chance(0.05)) {
    input.teams = null;
  }
  const play = r.chance(0.4) ? "presence" : "fate";
  if (play === "presence" || r.chance(0.4))
    input.play = play;
  exp.play = play === "presence" ? "presence" : undefined;
  let nMs = 1;
  if (r.chance(0.6)) {
    const k = r.int(1, 3), ms = Array.from(new Set(Array.from({ length: k }, () => r.int(2, bsz - 1))));
    input.milestones = r.shuffle(ms);
    nMs = ms.length;
    const sorted = [...ms].sort((a, b) => a - b);
    exp.milestones = sorted.length === 1 && sorted[0] === DEFAULT_MILESTONE ? undefined : sorted;
  } else if (r.chance(0.1)) {
    input.milestones = null;
    exp.milestones = undefined;
  }
  if (r.chance(0.6)) {
    input.turnCap = r.pick([10, 11, 25, 26, 27, 60, 100, 149, 150]);
    exp.turnCap = input.turnCap === DEFAULT_TURN_CAP ? undefined : input.turnCap;
  }
  if (r.chance(0.5)) {
    input.endPrizes = r.int(1, MAX_END_PRIZES);
    exp.endPrizes = input.endPrizes === DEFAULT_END_PRIZES ? undefined : input.endPrizes;
  }
  if (r.chance(0.5)) {
    input.exclusive = r.pick([true, false, null]);
    exp.exclusive = input.exclusive === true ? true : undefined;
  }
  if (r.chance(0.7)) {
    const lines = [], text = () => r.chance(0.5) ? "" : r.pick(["Gift hamper", " <b>Voucher</b> ", "A  very   long prize ".repeat(8), "Trophy`"]);
    const add = (p, k) => {
      for (let o = 1;o <= k; o++)
        lines.push({ pattern: p, ordinal: o, text: text() });
    };
    if (r.chance(0.7))
      add("milestone", r.int(1, nMs));
    if (r.chance(0.8))
      add("finish", r.int(1, 5));
    if (mode === "team" && r.chance(0.8))
      add("team", r.int(1, 3));
    if (r.chance(0.4))
      add("climb", 1);
    if (r.chance(0.4))
      add("comeback", 1);
    if (play === "presence" && r.chance(0.5))
      add("nevermissed", 1);
    if (!lines.length)
      add("finish", 1);
    input.rewards = lines;
    exp.rewards = lines.map((l) => ({ pattern: l.pattern, scope: "ticket", ordinal: l.ordinal, text: clean80(l.text) }));
  }
  if (r.chance(0.4)) {
    const k = r.int(0, 3), afters = r.sample(Array.from({ length: 40 }, (_, i) => i + 1), k).sort((a, b) => a - b), br = [];
    for (const a of afters) {
      const kind = r.pick(["speech", "slides", "lucky", "file", "youtube"]), b = { after: a, seconds: 3 * r.int(5, 200), kind, title: r.pick(["Welcome", "A word from the CEO", "Lucky draw!", "<i>Break</i>"]) };
      if (kind === "file")
        b.mediaUrl = "https://example.com/v.mp4";
      if (kind === "youtube")
        b.mediaUrl = r.pick(["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://m.youtube.com/watch?v=x"]);
      if (kind === "lucky") {
        if (r.chance(0.6))
          b.winners = r.pick(LUCKY_WINNERS);
        if (r.chance(0.5))
          b.style = r.pick(["draw", "scratch"]);
      }
      br.push(b);
    }
    input.breaks = br;
    exp.breaks = br.map((b) => ({ after: b.after, seconds: b.seconds, kind: b.kind, title: clean80(b.title), ...b.mediaUrl ? { mediaUrl: b.mediaUrl } : {}, ...b.kind === "lucky" ? { winners: b.winners ?? 3 } : {}, ...b.kind === "lucky" && b.style === "scratch" ? { style: "scratch" } : {} }));
  }
  if (r.chance(0.3)) {
    const on = r.chance(0.6), cats = r.sample(INVITE_CATEGORIES.map((x) => x.id), r.int(on ? 1 : 0, 4));
    input.invites = { on, per: r.int(1, MAX_INVITES_PER_PERSON), cats: r.chance(0.2) ? [...cats, ...cats] : cats };
    exp.invites = { on, per: input.invites.per, cats: [...new Set(input.invites.cats)] };
  }
  if (r.chance(0.3)) {
    input.verify = r.pick(VERIFY_MODES);
    exp.verify = input.verify === "mobile" ? undefined : input.verify;
  }
  if (r.chance(0.3)) {
    input.tz = r.pick(["Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Tokyo", "", null]);
    exp.tz = input.tz && input.tz !== "Asia/Kolkata" ? input.tz : undefined;
  }
  if (r.chance(0.3)) {
    input.name = r.pick(["Spring Offsite", "  Q3  <b>kickoff</b>  ", "", "x".repeat(80)]);
    const nm = clean80(input.name, 60);
    exp.name = nm || undefined;
  }
  if (r.chance(0.2)) {
    input.join = r.pick(["name", "phone"]);
    exp.join = input.join === "phone" ? "phone" : undefined;
  }
  if (r.chance(0.15)) {
    input.theme = r.pick(["jungle", "career"]);
    exp.theme = input.theme === "career" ? "career" : undefined;
  }
  if (r.chance(0.2)) {
    input.brand = { name: r.pick(["Acme", "  Big  Co  "]), color: r.pick(BRAND_COLORS).toLowerCase() };
  }
  if (r.chance(0.1)) {
    input.employeesOnly = true;
    exp.employeesOnly = true;
    exp.join = "phone";
  }
  return { input, exp };
}
var URL_OK = "https://example.com/v.mp4";
var R = (extra = {}) => ({ rewards: [{ pattern: "finish", ordinal: 1 }], ...extra });
var INVALID = [
  ["rounds 0", () => ({ rounds: 0 })],
  ["rounds 2", () => ({ rounds: 2 })],
  ["rounds 1.5", () => ({ rounds: 1.5 })],
  ["tickets 2", () => ({ tickets: 2 })],
  ["tickets 0", () => ({ tickets: 0 })],
  ["rewards empty", () => ({ rewards: [] })],
  ["rewards not a list", () => ({ rewards: "finish" })],
  ["rewards 31", () => ({ rewards: Array.from({ length: 31 }, () => ({ pattern: "finish", ordinal: 1 })) })],
  ["unknown prize", () => ({ rewards: [{ pattern: "jackpot", ordinal: 1 }] })],
  ["ordinal 0", () => R({ rewards: [{ pattern: "finish", ordinal: 0 }] })],
  ["ordinal 1.5", () => R({ rewards: [{ pattern: "finish", ordinal: 1.5 }] })],
  ["ordinal text", () => R({ rewards: [{ pattern: "finish", ordinal: "2" }] })],
  ["finish #6", () => ({ rewards: [1, 2, 3, 4, 5, 6].map((o) => ({ pattern: "finish", ordinal: o })) })],
  ["milestone #4", () => ({ milestones: [10, 20, 30], rewards: [1, 2, 3, 4].map((o) => ({ pattern: "milestone", ordinal: o })) })],
  ["climb #2", () => ({ rewards: [{ pattern: "climb", ordinal: 1 }, { pattern: "climb", ordinal: 2 }] })],
  ["comeback #2", () => ({ rewards: [{ pattern: "comeback", ordinal: 1 }, { pattern: "comeback", ordinal: 2 }] })],
  ["same reward twice", () => ({ rewards: [{ pattern: "finish", ordinal: 1 }, { pattern: "finish", ordinal: 1 }] })],
  ["2nd without 1st", () => ({ rewards: [{ pattern: "finish", ordinal: 2 }] })],
  ["4 breaks", () => ({ breaks: [10, 20, 30, 40].map((a) => ({ after: a, seconds: 30, kind: "speech", title: "Hello" })) })],
  ["break after 0", () => ({ breaks: [{ after: 0, seconds: 30, kind: "speech", title: "Hello" }] })],
  ["break after 150", () => ({ breaks: [{ after: 150, seconds: 30, kind: "speech", title: "Hello" }] })],
  ["break 12 s", () => ({ breaks: [{ after: 5, seconds: 12, kind: "speech", title: "Hello" }] })],
  ["break 31 s", () => ({ breaks: [{ after: 5, seconds: 31, kind: "speech", title: "Hello" }] })],
  ["break 603 s", () => ({ breaks: [{ after: 5, seconds: 603, kind: "speech", title: "Hello" }] })],
  ["break kind", () => ({ breaks: [{ after: 5, seconds: 30, kind: "dance", title: "Hello" }] })],
  ["youtube no link", () => ({ breaks: [{ after: 5, seconds: 30, kind: "youtube", title: "Hello" }] })],
  ["file no link", () => ({ breaks: [{ after: 5, seconds: 30, kind: "file", title: "Hello" }] })],
  ["youtube other site", () => ({ breaks: [{ after: 5, seconds: 30, kind: "youtube", title: "Hello", mediaUrl: "https://youtube.com.evil.example/x" }] })],
  ["lucky with link", () => ({ breaks: [{ after: 5, seconds: 30, kind: "lucky", title: "Hello", mediaUrl: URL_OK }] })],
  ["lucky 2 winners", () => ({ breaks: [{ after: 5, seconds: 30, kind: "lucky", title: "Hello", winners: 2 }] })],
  ["lucky bad style", () => ({ breaks: [{ after: 5, seconds: 30, kind: "lucky", title: "Hello", style: "fancy" }] })],
  ["style on speech", () => ({ breaks: [{ after: 5, seconds: 30, kind: "speech", title: "Hello", style: "draw" }] })],
  ["break title 1 char", () => ({ breaks: [{ after: 5, seconds: 30, kind: "speech", title: "H" }] })],
  ["two breaks same turn", () => ({ breaks: [{ after: 5, seconds: 30, kind: "speech", title: "Hello" }, { after: 5, seconds: 30, kind: "slides", title: "World" }] })],
  ["http link", () => ({ breaks: [{ after: 5, seconds: 30, kind: "file", title: "Hello", mediaUrl: "http://example.com/v.mp4" }] })],
  ["link with space", () => ({ breaks: [{ after: 5, seconds: 30, kind: "file", title: "Hello", mediaUrl: "https://example.com/a b.mp4" }] })],
  ["opening 2", () => ({ opening: [{ kind: "speech", title: "Hi", seconds: 30 }, { kind: "speech", title: "Hi", seconds: 30 }] })],
  ["opening 12 s", () => ({ opening: [{ kind: "speech", title: "Hi", seconds: 12 }] })],
  ["opening 123 s", () => ({ opening: [{ kind: "speech", title: "Hi", seconds: 123 }] })],
  ["opening lucky", () => ({ opening: [{ kind: "lucky", title: "Hi" }] })],
  ["closing 2", () => ({ closing: [{ kind: "speech", title: "Hi" }, { kind: "speech", title: "Hi" }] })],
  ["mark bad", () => ({ mark: "swipe" })],
  ["join bad", () => ({ join: "email" })],
  ["tz unknown", () => ({ tz: "Mars/Olympus" })],
  ["tz odd", () => ({ tz: "../etc" })],
  ["brand 1 key", () => ({ brand: { name: "Acme", color: "#0B3D91", extra: 1 } })],
  ["brand colour", () => ({ brand: { name: "Acme", color: "#123456" } })],
  ["brand name empty", () => ({ brand: { name: "", color: "#0B3D91" } })],
  ["brand name 41", () => ({ brand: { name: "x".repeat(41), color: "#0B3D91" } })],
  ["mode", () => ({ mode: "duel" })],
  ["play", () => ({ play: "auto" })],
  ["board size 99", () => ({ board: { size: 99 } })],
  ["board snakes 5", () => ({ board: { snakes: 5 } })],
  ["board snakes 13", () => ({ board: { snakes: 13 } })],
  ["board ladders 5", () => ({ board: { ladders: 5 } })],
  ["board ladders 13", () => ({ board: { ladders: 13 } })],
  ["board snakes 6.5", () => ({ board: { snakes: 6.5 } })],
  ["board finish", () => ({ board: { finish: "bounce" } })],
  ["board a list", () => ({ board: [100] })],
  ["milestones empty", () => ({ milestones: [] })],
  ["milestones 4", () => ({ milestones: [10, 20, 30, 40] })],
  ["milestone 1", () => ({ milestones: [1] })],
  ["milestone 100", () => ({ milestones: [100] })],
  ["milestone dup", () => ({ milestones: [50, 50] })],
  ["milestone 2.5", () => ({ milestones: [2.5] })],
  ["milestone text", () => ({ milestones: ["75"] })],
  ["milestone 144 on 144", () => ({ board: { size: 144 }, milestones: [144] })],
  ["milestone 150 on 144", () => ({ board: { size: 144 }, milestones: [150] })],
  ["turnCap 9", () => ({ turnCap: 9 })],
  ["turnCap 151", () => ({ turnCap: 151 })],
  ["turnCap 10.5", () => ({ turnCap: 10.5 })],
  ["turnCap text", () => ({ turnCap: "30" })],
  ["endPrizes 0", () => ({ endPrizes: 0 })],
  ["endPrizes 6", () => ({ endPrizes: 6 })],
  ["endPrizes 2.5", () => ({ endPrizes: 2.5 })],
  ["exclusive text", () => ({ exclusive: "yes" })],
  ["teams 1", () => ({ mode: "team", teams: 1 })],
  ["teams 11", () => ({ mode: "team", teams: 11 })],
  ["teams 2.5", () => ({ mode: "team", teams: 2.5 })],
  ["team mode no teams", () => ({ mode: "team" })],
  ["teams in a race", () => ({ mode: "race", teams: 3 })],
  ["teams alone", () => ({ teams: 3 })],
  ["team prize in a race", () => ({ rewards: [{ pattern: "team", ordinal: 1 }] })],
  ["never missed in fate", () => ({ rewards: [{ pattern: "nevermissed", ordinal: 1 }] })],
  ["milestone line w/o square", () => ({ rewards: [{ pattern: "milestone", ordinal: 1 }, { pattern: "milestone", ordinal: 2 }] })],
  ["theme", () => ({ theme: "space" })],
  ["verify", () => ({ verify: "face" })],
  ["engine text", () => ({ engine: "yes" })],
  ["survivors -1", () => ({ engine: true, survivors: -1 })],
  ["survivors 2001", () => ({ engine: true, survivors: 2001 })],
  ["roundTurns 0", () => ({ roundTurns: 0 })],
  ["roundTurns 61", () => ({ roundTurns: 61 })],
  ["idKind", () => ({ idKind: "phone" })],
  ["employeesOnly text", () => ({ employeesOnly: "yes" })],
  ["invites no flag", () => ({ invites: { per: 2 } })],
  ["invites per 0", () => ({ invites: { on: true, per: 0 } })],
  ["invites per 5", () => ({ invites: { on: true, per: MAX_INVITES_PER_PERSON + 1 } })],
  ["invites cat", () => ({ invites: { on: true, per: 2, cats: ["aliens"] } })],
  ["invites on, no cats", () => ({ invites: { on: true, per: 2, cats: [] } })],
  ["timeLimit 9", () => ({ timeLimit: 9 })]
];
var BOUNDS = [
  ["turnCap", { turnCap: 10 }, { turnCap: 9 }],
  ["turnCap", { turnCap: 150 }, { turnCap: 151 }],
  ["endPrizes", { endPrizes: 1 }, { endPrizes: 0 }],
  ["endPrizes", { endPrizes: 5 }, { endPrizes: 6 }],
  ["snakes", { board: { snakes: 6 } }, { board: { snakes: 5 } }],
  ["snakes", { board: { snakes: 12 } }, { board: { snakes: 13 } }],
  ["ladders", { board: { ladders: 6 } }, { board: { ladders: 5 } }],
  ["ladders", { board: { ladders: 12 } }, { board: { ladders: 13 } }],
  ["milestone", { milestones: [2] }, { milestones: [1] }],
  ["milestone", { milestones: [99] }, { milestones: [100] }],
  ["milestone", { board: { size: 144 }, milestones: [143] }, { board: { size: 144 }, milestones: [144] }],
  ["milestone", { board: { size: 225 }, milestones: [224] }, { board: { size: 225 }, milestones: [225] }],
  ["milestones count", { milestones: [10, 20, 30] }, { milestones: [10, 20, 30, 40] }],
  ["teams", { mode: "team", teams: 2 }, { mode: "team", teams: 1 }],
  ["teams", { mode: "team", teams: 10 }, { mode: "team", teams: 11 }],
  ["break", { breaks: [{ after: 1, seconds: 15, kind: "speech", title: "Hi" }] }, { breaks: [{ after: 0, seconds: 15, kind: "speech", title: "Hi" }] }],
  ["break", { breaks: [{ after: 149, seconds: 600, kind: "speech", title: "Hi" }] }, { breaks: [{ after: 150, seconds: 600, kind: "speech", title: "Hi" }] }],
  ["break", { breaks: [{ after: 5, seconds: 15, kind: "speech", title: "Hi" }] }, { breaks: [{ after: 5, seconds: 12, kind: "speech", title: "Hi" }] }],
  ["break", { breaks: [{ after: 5, seconds: 600, kind: "speech", title: "Hi" }] }, { breaks: [{ after: 5, seconds: 603, kind: "speech", title: "Hi" }] }],
  ["opening", { opening: [{ kind: "speech", title: "Hi", seconds: 120 }] }, { opening: [{ kind: "speech", title: "Hi", seconds: 123 }] }],
  ["opening", { opening: [{ kind: "speech", title: "Hi", seconds: 15 }] }, { opening: [{ kind: "speech", title: "Hi", seconds: 12 }] }],
  ["invites per", { invites: { on: true, per: 4, cats: ["family"] } }, { invites: { on: true, per: 5, cats: ["family"] } }],
  ["invites per", { invites: { on: true, per: 1, cats: ["family"] } }, { invites: { on: true, per: 0, cats: ["family"] } }],
  ["survivors", { engine: true, survivors: 2000 }, { engine: true, survivors: 2001 }],
  ["roundTurns", { engine: true, roundTurns: 60 }, { engine: true, roundTurns: 61 }],
  ["brand name", { brand: { name: "x".repeat(40), color: "#0B3D91" } }, { brand: { name: "x".repeat(41), color: "#0B3D91" } }]
];
var baseRace = () => ({ gameId: "G1", players: 10, board: { size: 100, snakes: 9, ladders: 9, finish: "exact" }, milestones: [75], turnCap: 26, endPrizes: 5, play: "fate", exclusive: false });
var RACE_BAD = [
  ["players 1", { players: 1 }],
  ["players 0", { players: 0 }],
  ["players -3", { players: -3 }],
  ["players 10001", { players: 10001 }],
  ["players 2.5", { players: 2.5 }],
  ["players NaN", { players: NaN }],
  ["turnCap 9", { turnCap: 9 }],
  ["turnCap 151", { turnCap: 151 }],
  ["turnCap 10.5", { turnCap: 10.5 }],
  ["endPrizes 0", { endPrizes: 0 }],
  ["endPrizes 6", { endPrizes: 6 }],
  ["endPrizes 2.5", { endPrizes: 2.5 }],
  ["milestone 1", { milestones: [1] }],
  ["milestone 100", { milestones: [100] }],
  ["milestone 0", { milestones: [0] }],
  ["milestones dup", { milestones: [75, 75] }],
  ["milestone 2.5", { milestones: [2.5] }],
  ["milestones 4", { milestones: [10, 20, 30, 40] }],
  ["milestones text", { milestones: "75" }],
  ["play", { play: "auto" }],
  ["teams 1", { teams: 1 }],
  ["teams 11", { teams: 11 }],
  ["teams 2.5", { teams: 2.5 }],
  ["teams > players", { players: 4, teams: 5 }]
];
var RACE_OK = [
  ["players 2", { players: 2 }],
  ["players 10000", { players: 1e4 }],
  ["turnCap 10", { turnCap: 10 }],
  ["turnCap 150", { turnCap: 150 }],
  ["endPrizes 1", { endPrizes: 1 }],
  ["endPrizes 5", { endPrizes: 5 }],
  ["milestone 2", { milestones: [2] }],
  ["milestone 99", { milestones: [99] }],
  ["milestones 3", { milestones: [10, 20, 30] }],
  ["presence", { play: "presence" }],
  ["teams 2", { teams: 2 }],
  ["teams 10", { teams: 10 }],
  ["teams = players", { players: 6, teams: 6 }],
  ["board 144 m 143", { board: { size: 144, snakes: 9, ladders: 9, finish: "exact" }, milestones: [143] }]
];
var TABLE_BAD = [
  ["players 1", { players: 1, winners: 1 }],
  ["players 21", { players: 21 }],
  ["players 2.5", { players: 2.5 }],
  ["winners 0", { winners: 0 }],
  ["winners 4", { players: 10, winners: 4 }],
  ["winners = players", { players: 2, winners: 2 }],
  ["winners 3 of 3", { players: 3, winners: 3 }],
  ["winners 2.5", { winners: 2.5 }],
  ["maxThrows 5n-1", { players: 8, maxThrows: 39 }],
  ["maxThrows NaN", { maxThrows: NaN }],
  ["maxThrows text", { maxThrows: "600" }]
];
var TABLE_OK = [
  ["players 2", { players: 2, winners: 1 }],
  ["players 20", { players: 20, winners: 3 }],
  ["winners 3 of 4", { players: 4, winners: 3 }],
  ["maxThrows 5n", { players: 8, winners: 2, maxThrows: 40 }],
  ["maxThrows 600", { players: 20, winners: 3, maxThrows: 600 }]
];
var baseTable = () => ({ gameId: "G1", players: 6, board: { size: 100, snakes: 9, ladders: 9, finish: "exact" }, winners: 2, maxThrows: 600 });
var quorumO = (p) => p <= 6 ? Math.max(1, Math.ceil(p / 2)) : Math.min(25, Math.max(3, Math.ceil(p * 0.05)));
var votersO = (p) => p <= 12 ? p : 4 * quorumO(p);
function kindCfg(r, c) {
  const parts = r.sample(["valid", "invalid", "bounds", "race", "table", "quorum", "prizes", "board"], r.int(2, 4));
  if (!parts.includes("valid") && r.chance(0.5))
    parts.push("valid");
  const tag = [];
  for (const part of parts) {
    if (part === "valid") {
      const { input, exp } = validSettings(r), before = JSON.stringify(input), res = validateCfg(input, defaultCfg());
      tag.push("valid:" + hashStr(before).toString(36));
      c.ok(res.ok === true, "T-50", () => ({ input, res }));
      c.ok(JSON.stringify(input) === before, "T-51", () => "validateCfg changed its input");
      if (!res.ok)
        continue;
      const cfg = res.cfg;
      for (const k of ["mode", "board", "milestones", "turnCap", "endPrizes", "play", "exclusive", "teams", "theme", "verify", "tz", "name", "join", "employeesOnly"]) {
        if (!(k in exp))
          continue;
        c.ok(same(cfg[k], exp[k]), "T-50", () => ({ field: k, got: cfg[k], expected: exp[k] }));
      }
      if (exp.rewards)
        c.ok(same(cfg.rewards, exp.rewards), "T-50", () => ({ got: cfg.rewards, expected: exp.rewards }));
      if (exp.breaks)
        c.ok(same(cfg.breaks.map((b) => ({ ...b })), exp.breaks), "T-50", () => ({ got: cfg.breaks, expected: exp.breaks }));
      if (exp.invites && !input.employeesOnly)
        c.ok(same(cfg.invites, exp.invites), "T-50", () => ({ got: cfg.invites, expected: exp.invites }));
      if (input.employeesOnly)
        c.ok(cfg.employeesOnly === true && cfg.invites.on === false && cfg.join === "phone", "T-50", () => cfg);
      if (input.brand)
        c.ok(cfg.brand && /^[0-9A-F#]{7}$/.test(cfg.brand.color) && !/\s{2}/.test(cfg.brand.name) && cfg.brand.name === cfg.brand.name.trim(), "T-50", () => cfg.brand);
      c.ok(cfg.turnCap !== DEFAULT_TURN_CAP && cfg.endPrizes !== DEFAULT_END_PRIZES && cfg.play !== "fate" && cfg.mode !== "race" && cfg.exclusive !== false, "T-50", () => cfg);
      const back = cfgOfRow({ tickets: 1, config: JSON.stringify(cfg) });
      for (const k of ["rewards", "breaks", "invites", "mark", "join", "tz", "verify", "employeesOnly", "mode", "play", "board", "milestones", "turnCap", "endPrizes", "exclusive", "teams", "theme"])
        c.ok(same(back[k], cfg[k]), "T-50", () => ({ field: k, stored: cfg[k], back: back[k] }));
      const go = gameOut(cfg), gf = gameFields(go);
      c.ok(same(go, gf), "T-50", () => ({ go, gf }));
      const again = validateCfg({ rewards: cfg.rewards, breaks: cfg.breaks, ...gameFields(go) }, defaultCfg());
      c.ok(again.ok, "T-50", () => again);
    } else if (part === "invalid") {
      for (let i = 0;i < 3; i++) {
        const [label, mk] = r.pick(INVALID), input = mk(), before = JSON.stringify(input);
        let res = null, threw = false;
        try {
          res = validateCfg(input, defaultCfg());
        } catch {
          threw = true;
        }
        tag.push("bad:" + label);
        c.ok(!threw, "T-51", () => ({ label, note: "validateCfg threw" }));
        c.ok(res !== null && res.ok === false && typeof res.error === "string" && res.error.length > 5, "T-51", () => ({ label, res }));
        c.ok(JSON.stringify(input) === before, "T-51", () => ({ label, note: "input changed" }));
      }
    } else if (part === "bounds") {
      for (let i = 0;i < 3; i++) {
        const [label, good, bad] = r.pick(BOUNDS), g = validateCfg(JSON.parse(JSON.stringify(good)), defaultCfg()), b = validateCfg(JSON.parse(JSON.stringify(bad)), defaultCfg());
        tag.push("b:" + label);
        c.ok(g.ok === true, "T-50", () => ({ label, good, g }));
        c.ok(b.ok === false, "T-51", () => ({ label, bad, b }));
      }
    } else if (part === "race") {
      for (let i = 0;i < 4; i++) {
        const bad = i % 2 === 0, [label, patch] = bad ? r.pick(RACE_BAD) : r.pick(RACE_OK), cfg = { ...baseRace(), ...patch }, msg = validateRaceCfg(cfg);
        tag.push("race:" + label);
        c.ok(bad ? typeof msg === "string" && msg.length > 5 : msg === null, "T-54", () => ({ label, msg }));
        if (bad) {
          let thrown = null;
          try {
            playRace(cfg, { b0: "a".repeat(64), betas: [] });
          } catch (e) {
            thrown = e.message;
          }
          c.ok(thrown === msg, "T-54", () => ({ label, thrown, msg }));
        }
      }
      c.ok(validateRaceCfg({ ...baseRace(), board: { size: 144, snakes: 9, ladders: 9, finish: "exact" }, milestones: [100] }) === null && validateRaceCfg({ ...baseRace(), board: { size: 144, snakes: 9, ladders: 9, finish: "exact" }, milestones: [144] }) !== null, "T-54", () => "milestone limit does not follow the board size");
    } else if (part === "table") {
      for (let i = 0;i < 4; i++) {
        const bad = i % 2 === 0, [label, patch] = bad ? r.pick(TABLE_BAD) : r.pick(TABLE_OK), cfg = { ...baseTable(), ...patch }, msg = validateTableCfg(cfg);
        tag.push("table:" + label);
        c.ok(bad ? typeof msg === "string" && msg.length > 5 : msg === null, "T-54", () => ({ label, msg }));
        if (bad) {
          let thrown = null;
          try {
            playTable(cfg, { b0: "a".repeat(64), betas: [] });
          } catch (e) {
            thrown = e.message;
          }
          c.ok(thrown === msg, "T-54", () => ({ label, thrown, msg }));
        }
      }
    } else if (part === "quorum") {
      for (let i = 0;i < 6; i++) {
        const p = r.chance(0.5) ? r.int(1, 30) : r.chance(0.5) ? r.int(31, 600) : r.pick([100, 120, 500, 501, 520, 521, 1000, 1001, 2000, 2001, 5000]);
        c.ok(quorumFor(p) === quorumO(p) && votersFor(p) === votersO(p), "T-53", () => ({ people: p, quorum: quorumFor(p), voters: votersFor(p), expected: [quorumO(p), votersO(p)] }));
        c.ok(quorumFor(p) >= 1 && quorumFor(p) <= p && votersFor(p) >= quorumFor(p) && votersFor(p) <= Math.max(p, 4 * quorumFor(p)) && (p <= 12 ? votersFor(p) === p : votersFor(p) <= p), "T-53", () => ({ people: p, quorum: quorumFor(p), voters: votersFor(p) }));
      }
      for (let i = 0;i < 3; i++) {
        const n = r.int(1, 8), k = r.int(1, 30);
        c.ok(autoAfter(n, k) === Math.min(DEFAULT_TURN_CAP - 1, Math.max(1, Math.round(DEFAULT_TURN_CAP * k / (n + 1)))), "T-50", () => ({ n, k }));
      }
      {
        const bks = [{ after: 3, seconds: 30 }, { after: 8, seconds: 60 }, { after: 12, seconds: 15 }], k = r.int(0, 15);
        c.ok(breakShift(bks, k) === bks.reduce((s, b) => s + (b.after <= k ? b.seconds / 3 : 0), 0), "T-60", () => ({ k }));
      }
    } else if (part === "prizes") {
      const exp = { milestone: [3, "set"], finish: [5, "set"], team: [3, "set"], climb: [1, "set"], comeback: [1, "set"], nevermissed: [1, "set"] };
      c.ok(PRIZE_HOUSES.length === 6 && PRIZE_HOUSES.every((h) => exp[h.id] && exp[h.id][0] === h.max && maxWinnersFor(h.id) === h.max), "T-52", () => PRIZE_HOUSES.map((h) => [h.id, h.max]));
      c.ok(same([...HOUSE_ORDER], ["milestone", "finish", "team", "climb", "comeback", "nevermissed"]) && maxWinnersFor("nothing") === 1, "T-52", () => [...HOUSE_ORDER]);
      c.ok(PRIZE_HOUSES.filter((h) => h.dflt).map((h) => h.id).join() === "milestone,finish", "T-52");
      c.ok(MAX_REWARD_LINES === 30 && MAX_ORDINAL === 5 && same(defaultRewards().map((l) => l.pattern + l.ordinal), ["milestone1", "finish1", "finish2", "finish3", "finish4", "finish5"]), "T-52", () => ({ MAX_REWARD_LINES, MAX_ORDINAL }));
      const lines = r.sample([{ pattern: "finish", scope: "ticket", ordinal: 2, text: "" }, { pattern: "finish", scope: "ticket", ordinal: 1, text: "" }, { pattern: "climb", scope: "ticket", ordinal: 1, text: "" }, { pattern: "milestone", scope: "ticket", ordinal: 1, text: "" }, { pattern: "team", scope: "ticket", ordinal: 1, text: "" }], r.int(1, 5));
      const ks = keysInPlay(lines), idx = ks.map((k) => HOUSE_ORDER.indexOf(k));
      c.ok(idx.every((x, i) => i === 0 || idx[i - 1] < x) && new Set(ks).size === ks.length, "T-52", () => ks);
      c.ok(linesFor(lines, "finish").every((l, i, a) => i === 0 || a[i - 1].ordinal <= l.ordinal), "T-52");
      const legacy = { rewards: [1, 2, 3].map((o) => ({ pattern: "climb", ordinal: o })) };
      c.ok(validateCfg(legacy, defaultCfg()).ok === false && validateCfg(legacy, defaultCfg(), { stored: true }).ok === true, "T-50", () => "stored games keep up to 3 winners");
      c.ok(MAX_ROUNDS === 1 && MAX_CALLS === MAX_TURN_CAP && GRACE_ROUNDS === 40 && OPENING_WINDOW_SECONDS === 120 && MAX_MID_PER_TICKET === 3, "T-50");
    } else {
      const ok = "ab".repeat(32), cases = [
        ["b0 not hex", () => generateBoard("G", 1, "xyz"), true],
        ["b0 63 chars", () => generateBoard("G", 1, ok.slice(1)), true],
        ["b0 g", () => generateBoard("G", 1, "g".repeat(64)), true],
        ["b0 number", () => generateBoard("G", 1, 5), true],
        ["size 99", () => generateBoard("G", 1, ok, { size: 99, snakes: 9, ladders: 9, finish: "exact" }), true],
        ["size 0", () => generateBoard("G", 1, ok, { size: 0, snakes: 9, ladders: 9, finish: "exact" }), true],
        ["snakes 5", () => generateBoard("G", 1, ok, { size: 100, snakes: 5, ladders: 9, finish: "exact" }), true],
        ["snakes 13", () => generateBoard("G", 1, ok, { size: 100, snakes: 13, ladders: 9, finish: "exact" }), true],
        ["ladders 5", () => generateBoard("G", 1, ok, { size: 100, snakes: 9, ladders: 5, finish: "exact" }), true],
        ["ladders 13", () => generateBoard("G", 1, ok, { size: 100, snakes: 9, ladders: 13, finish: "exact" }), true]
      ];
      for (const [label, fn] of r.sample(cases, 4)) {
        let threw = false;
        try {
          fn();
        } catch {
          threw = true;
        }
        tag.push("board:" + label);
        c.ok(threw, "T-06", () => ({ label }));
      }
      c.ok(isHex64("a".repeat(64)) && isHex64("A".repeat(64)) && !isHex64("a".repeat(63)) && !isHex64("a".repeat(65)) && !isHex64("g".repeat(64)) && !isHex64(null) && !isHex64(12), "T-06");
      c.ok(same([...BOARD_SIZES], [100, 144, 225]) && MIN_PER_KIND === 6 && MAX_PER_KIND === 12, "T-06");
    }
  }
  c.dim("cfgParts", parts.length);
  return { parts, tag: tag.join("|") };
}

// games/snakes/k_sched.ts
import { createHash as createHash2, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "crypto";
var STRIDE = (w) => Math.floor(w / 3) + 1 + 2;
function genLog(r, lead, max, first) {
  const m = mNew(max, lead), log = [], count = r.int(0, 9);
  let cursor = first + r.int(0, 100), applied = 0;
  for (let seq = 1;seq <= count; seq++) {
    const cur = m.pauses.length ? m.pauses[m.pauses.length - 1] : null;
    const action = r.weighted([["pause", 38], ["resume", 24], ["extend", 16], ["stop", 8], ["resume", 14]]);
    const signedAt = cursor + r.int(0, 5);
    let leadUsed = r.pick([lead - 1, lead, lead, lead + 1, lead + r.int(0, 30), 0, 1, 2]);
    let at = signedAt + Math.max(0, leadUsed), until;
    if (action === "resume" && cur) {
      at = r.chance(0.8) ? cur.start + r.int(0, 60) : signedAt + r.int(-2, 5);
      leadUsed = at - signedAt;
    }
    if (r.chance(0.04))
      at = signedAt - r.int(1, 3);
    if (action === "pause") {
      if (r.chance(0.55))
        until = at + r.pick([1, 5, 20, 80, 0, -3, MAX_TIMED, MAX_TIMED + 1]);
    }
    if (action === "extend") {
      const end = cur ? Math.min(cur.ended ?? Infinity, cur.until ?? cur.start + max) : at;
      until = r.chance(0.9) ? (Number.isFinite(end) ? end : at) + r.pick([-5, 0, 1, 10, 60, MAX_TIMED, MAX_TIMED + 5]) : undefined;
    }
    const msg = { seq, action, at: Math.max(0, at), signedAt, ...until !== undefined && until >= 0 ? { until } : {} };
    if (mApply(m, msg))
      applied++;
    log.push({ engagementId: "E1", seq, action, atBeaconRound: msg.at, signedAtRound: msg.signedAt, ...msg.until !== undefined ? { untilRound: msg.until } : {}, sig: "" });
    cursor = Math.max(cursor, signedAt) + r.int(0, 8);
  }
  return { log, model: m, applied };
}
function kindSched(r, c) {
  const parts = r.sample(["open", "ctl", "lucky", "safety", "tracker", "peek"], r.int(2, 3));
  const tag = [];
  for (const part of parts) {
    if (part === "open" || part === "ctl") {
      const lead = r.chance(0.5) ? SAFETY_STANDARD.leadRounds : r.int(3, 70), max = r.pick([600, 600, 200, 1000, 28800]), first = r.int(30000000, 40000000);
      const windowSec = r.chance(0.8) ? DEFAULT_WINDOW : r.pick([5, 9, 15, 20, 30, 45]);
      const { log, model, applied } = genLog(r, lead, max, first), cfg = { pubKey: "00".repeat(32), maxPauseRounds: max, leadRounds: lead };
      const shuffled = r.chance(0.5) ? r.shuffle(log) : log, st = resolveControl(cfg, shuffled), ivs = mIntervals(model);
      tag.push(part, log.length, windowSec);
      c.ok(same(st.intervals, ivs) && st.stopRound === model.stop && st.applied === applied && same(st.ignored.map((x) => x.seq), model.ignored), "T-61", () => ({ engine: st, model: { ivs, stop: model.stop, applied, ignored: model.ignored }, log }));
      c.ok(st.ignored.every((x) => typeof x.why === "string" && x.why.length > 3) && applied + model.ignored.length === log.length, "T-61");
      for (let i = 0;i < st.intervals.length; i++) {
        const v = st.intervals[i];
        c.ok(v.end > v.start && (i === 0 || st.intervals[i - 1].end <= v.start), "T-61", () => st.intervals);
      }
      for (let k = 0;k < 6; k++) {
        const x = first + r.int(0, 400), inside = ivs.some((v) => x >= v.start && x < v.end);
        c.ok(pausedAt(st, x) === inside, "T-61", () => ({ x, ivs }));
      }
      if (part === "ctl") {
        const dup = resolveControl(cfg, [...log, ...log].sort((a, b) => a.seq - b.seq)), rev = resolveControl(cfg, [...log].reverse());
        c.ok(same(rev.intervals, st.intervals) && rev.stopRound === st.stopRound && same(rev.ignored, st.ignored), "T-62", () => "the order of the log changed the result");
        c.ok(dup.stopRound === st.stopRound && same(dup.intervals.slice(0, st.intervals.length), st.intervals), "T-62", () => "repeating the log changed the intervals");
        if (log.length && model.stop !== null) {
          const ext = resolveControl(cfg, [...log, { engagementId: "E1", seq: log.length + 1, action: "pause", atBeaconRound: model.stop + 500, signedAtRound: model.stop - 200, sig: "" }]);
          c.ok(ext.stopRound === model.stop && ext.intervals.length === st.intervals.length, "T-61", () => "a message after a stop took effect");
        }
      }
      if (part === "open") {
        const breaks = [], nb = r.weighted([[0, 45], [1, 25], [2, 15], [3, 15]]), afters = r.sample(Array.from({ length: 25 }, (_, i) => i + 1), nb).sort((a, b) => a - b);
        for (const a of afters)
          breaks.push({ after: a, seconds: 3 * r.int(5, 200), kind: r.pick(["speech", "slides", "lucky"]), title: "Break" });
        const useSt = r.chance(0.75) ? st : null, stride = turnRounds(windowSec), cap = r.pick([10, 26, 26, 60, 150]);
        c.ok(betaOffset(windowSec) === Math.floor(windowSec / 3) + 1 && stride === STRIDE(windowSec) && ROUND_SEC === 3 && DEFAULT_WINDOW === 10 && REVEAL_ROUNDS === 2 && LEAD_ROUNDS === 39, "T-60", () => ({ windowSec, stride }));
        c.ok(turnRounds(10) === 6 && betaOffset(10) === 4, "T-60");
        const shift = (t) => breaks.reduce((s, b) => s + (b.after <= t ? b.seconds / 3 : 0), 0);
        const opens = [];
        for (let t = 0;t < cap + 3; t++) {
          const eo = openRoundOf(useSt, first, windowSec, breaks, t), v = first + t * stride + shift(t), oo = useSt ? openByCounting(ivs, model.stop, v) : v;
          opens.push(eo);
          c.ok(eo === oo, "T-60", () => ({ t, engine: eo, oracle: oo, v, ivs, stop: model.stop, breaks }));
          if (t < 8 || t > cap)
            c.ok(callRoundR(useSt, first, stride, breaks, 1, t) === eo && callRoundFull(useSt, first, stride, breaks, t) === eo && callRoundR(useSt, first, stride, breaks, 2, t) === null, "T-60", () => ({ t }));
          const b = betaRoundOf(useSt, first, windowSec, breaks, t);
          c.ok(b === (eo === null ? null : eo + betaOffset(windowSec)), "T-60", () => ({ t, b, eo }));
          if (eo !== null && useSt)
            c.ok(!ivs.some((v2) => eo >= v2.start && eo < v2.end), "T-60", () => ({ t, eo, ivs }));
        }
        let seenNull = false;
        for (let t = 0;t < opens.length; t++) {
          const o = opens[t];
          if (o === null)
            seenNull = true;
          else
            c.ok(!seenNull, "T-60", () => "a turn opens after a stop");
          if (t > 0 && o !== null && opens[t - 1] !== null)
            c.ok(o - opens[t - 1] >= stride, "T-60", () => ({ t, gap: o - opens[t - 1], stride }));
        }
        if (!useSt || ivs.length === 0 && model.stop === null)
          for (let t = 1;t < opens.length; t++)
            c.ok(opens[t] - opens[t - 1] === stride + breaks.filter((b2) => b2.after === t).reduce((s, b2) => s + b2.seconds / 3, 0), "T-60", () => ({ t }));
        for (const b of breaks) {
          const prev = openRoundOf(useSt, first, windowSec, breaks, b.after - 1), lr = luckyRound(useSt, first, stride, breaks, b);
          if (prev === null) {
            c.ok(lr === null, "T-65", () => ({ b, lr }));
            continue;
          }
          const from = prev + stride, to = from + b.seconds / 3;
          c.ok(lr === to, "T-65", () => ({ b, lr, to }));
          const a0 = activeBreak(useSt, first, stride, breaks, from), a1 = activeBreak(useSt, first, stride, breaks, to - 1), a2 = activeBreak(useSt, first, stride, breaks, to), a3 = activeBreak(useSt, first, stride, breaks, from - 1);
          c.ok(a0?.brk.after === b.after && a0.endsAtRound === to && a1?.brk.after === b.after, "T-65", () => ({ from, to, a0, a1 }));
          c.ok(a2?.brk.after !== b.after && a3?.brk.after !== b.after, "T-65", () => ({ a2, a3 }));
          for (const o of opens)
            if (o !== null)
              c.ok(!(o >= from && o < to), "T-65", () => ({ open: o, from, to }));
        }
      }
    } else if (part === "lucky") {
      const eid = "E" + r.hex(3), after = r.int(1, 25), rand = r.hex(32), nP = r.pick([0, 1, 2, 5, 12, 40, 150]), pids = [];
      for (let i = 0;i < nP; i++)
        pids.push(r.chance(0.08) && pids.length ? pids[r.int(0, pids.length - 1)] : `${r.int(1, 900)}x${r.hex(4)}`);
      const n = r.pick([1, 3, 5, 10, 0, -2, 50]);
      tag.push("lucky", nP, n);
      const got = luckyWinners(eid, after, rand, pids, n), distinct = [...new Set(pids)];
      const ranked = distinct.map((p) => [shaHex(`SL1-LUCKY|${eid}|${after}|${rand}|${p}`), p]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0), want = ranked.slice(0, Math.max(0, n)).map((x) => x[1]);
      c.ok(same(got, want), "T-64", () => ({ got, want }));
      c.ok(new Set(got).size === got.length && got.length === Math.min(Math.max(0, n), distinct.length) && got.every((p) => distinct.includes(p)), "T-64", () => got);
      c.ok(same(luckyWinners(eid, after, rand, r.shuffle(pids), n), got), "T-64", () => "the order of the list changed the winners");
      const draw = r.int(1700000000000, 1800000000000), seats = [];
      for (let i = 0;i < r.int(0, 12); i++)
        seats.push({ pid: `p${i}`, ...r.chance(0.25) ? { ex: true } : r.chance(0.15) ? { ex: false } : {}, ...r.chance(0.5) ? { removedMs: r.pick([draw - LUCKY_REMOVAL_MARGIN_MS, draw - LUCKY_REMOVAL_MARGIN_MS + 1, draw - LUCKY_REMOVAL_MARGIN_MS - 1, draw - 1, draw, draw + 5000, draw - 1e5, null, "soon"]) } : {} });
      const el = luckyEligible(seats, draw), wantEl = seats.filter((s) => !s.ex && !(typeof s.removedMs === "number" && s.removedMs + 30000 <= draw)).map((s) => s.pid);
      c.ok(LUCKY_REMOVAL_MARGIN_MS === 30000 && same(el, wantEl), "T-64", () => ({ el, wantEl, seats }));
    } else if (part === "safety") {
      const inp = { pollMaxSec: r.int(1, 120), cacheTtlSec: r.int(0, 10), latencySec: r.int(0, 10), missedPollsTolerated: r.int(0, 3) }, s = deriveSafety(inp);
      const ceil3 = (x) => Math.ceil(x / 3), worst = inp.pollMaxSec + inp.cacheTtlSec + inp.latencySec, hold = ceil3(worst + inp.missedPollsTolerated * inp.pollMaxSec), lead = hold + ceil3(inp.cacheTtlSec) + 2;
      tag.push("safety", inp.pollMaxSec);
      c.ok(s.holdAfterRounds === hold && s.leadRounds === lead && s.giveUpRounds === Math.max(hold * 6, 60) && s.worstNormalAgeSec === worst && s.pollMaxSec === inp.pollMaxSec, "T-63", () => ({ s, hold, lead }));
      c.ok(s.leadRounds * 3 > s.holdAfterRounds * 3 + inp.cacheTtlSec && s.leadRounds > s.holdAfterRounds, "T-63", () => ({ s, inp }));
      for (const [name, sf] of [["std", SAFETY_STANDARD], ["fast", SAFETY_FAST], ["l30", SAFETY_LEAN30], ["l60", SAFETY_LEAN60]])
        c.ok(sf.leadRounds * 3 > sf.holdAfterRounds * 3 + 3 && sf.giveUpRounds >= 60, "T-63", () => ({ name, sf }));
      const formula = (poll) => {
        const h = Math.ceil((poll + 3 + 3 + poll) / 3);
        return { hold: h, lead: h + 1 + 2, give: Math.max(h * 6, 60) };
      };
      for (const [sf, poll] of [[SAFETY_STANDARD, 12], [SAFETY_FAST, 7], [SAFETY_LEAN30, 36], [SAFETY_LEAN60, 72]]) {
        const f = formula(poll);
        c.ok(sf.holdAfterRounds === f.hold && sf.leadRounds === f.lead && sf.giveUpRounds === f.give && sf.pollMaxSec === poll, "T-63", () => ({ sf, f }));
      }
      c.ok(SAFETY_STANDARD.leadRounds === 13 && LEAD_ROUNDS === 39, "T-63", () => ({ SAFETY_STANDARD, LEAD_ROUNDS }));
      const cap = r.pick([0, 1, 100, 250, 251, 500, 1000, 1001, 1500, 2000, 2001, 5000]), fast = r.chance(0.5), got = safetyForCap(cap, fast);
      const want = cap <= 250 ? fast ? SAFETY_FAST : SAFETY_STANDARD : cap <= 1000 ? SAFETY_LEAN30 : cap <= 2000 ? SAFETY_LEAN60 : null;
      c.ok(got === want, "T-63", () => ({ cap, fast, got }));
    } else if (part === "tracker") {
      const safety = r.pick([SAFETY_STANDARD, SAFETY_FAST, SAFETY_LEAN30, SAFETY_LEAN60]), joined = r.int(1000, 1e5), cfg = { pubKey: "00".repeat(32), maxPauseRounds: 600, leadRounds: safety.leadRounds };
      const t = new ControlTracker(cfg, "E1", safety, joined);
      tag.push("tracker", safety.holdAfterRounds);
      c.ok(t.mode(joined) === "hold" && t.failingSince === null && t.log.length === 0 && t.state.intervals.length === 0 && t.state.stopRound === null, "T-63", () => ({ mode: t.mode(joined) }));
      const good = joined + r.int(0, 50);
      t.lastGoodRound = good;
      const fails = r.int(0, 4);
      let first = null, at = good + r.int(0, 30);
      for (let i = 0;i < fails; i++) {
        at += r.int(0, 40);
        const how = r.int(0, 3);
        if (how === 0)
          t.ingest(at, null);
        else if (how === 1)
          t.ingest(at, { engagementId: "other", messages: [] });
        else if (how === 2)
          t.ingest(at, { engagementId: "E1", messages: "no" });
        else
          t.failed(at);
        if (first === null)
          first = at;
      }
      c.ok(t.failingSince === first && t.lastGoodRound === good, "T-63", () => ({ failingSince: t.failingSince, first, good }));
      for (let k = 0;k < 5; k++) {
        const now = at + r.int(0, safety.giveUpRounds * 2 + 10), live = now - good <= safety.holdAfterRounds, want = live ? "live" : first !== null && now - first >= safety.giveUpRounds ? "blind" : "hold";
        c.ok(t.mode(now) === want, "T-63", () => ({ now, good, first, hold: safety.holdAfterRounds, giveUp: safety.giveUpRounds, got: t.mode(now), want }));
      }
      c.ok(t.mode(good) === "live" && t.mode(good + safety.holdAfterRounds) === "live" && t.mode(good + safety.holdAfterRounds + 1) !== "live", "T-63", () => ({ good }));
    } else {
      const peek = typeof Bun !== "undefined" ? Bun.peek : null;
      const cfg = { pubKey: "00".repeat(32), maxPauseRounds: 600, leadRounds: 13 };
      const mk = (seq, sig, eid = "E1") => ({ engagementId: eid, seq, action: "pause", atBeaconRound: 100 + seq, signedAtRound: 10, sig });
      const seqs = r.sample([1, 2, 3, 4, 5, 6, 7, 8], r.int(0, 8)), known = seqs.map((s) => mk(s, "k" + s));
      let forged = 0;
      const incoming = [];
      for (let i = 0;i < r.int(0, 8); i++) {
        const kind = r.int(0, 5);
        if (kind === 0) {
          incoming.push(null);
          forged++;
        } else if (kind === 1) {
          incoming.push({ seq: 0, action: "pause" });
          forged++;
        } else if (kind === 2) {
          incoming.push(mk(r.int(1, 8), "z", "other"));
          forged++;
        } else if (kind === 3) {
          incoming.push({ ...mk(r.int(1, 8), "z"), action: "dance" });
          forged++;
        } else if (kind === 4 && known.length) {
          const k = r.pick(known);
          incoming.push({ ...k });
        } else if (known.length) {
          const k = r.pick(known);
          incoming.push({ ...k, sig: k.sig + "x" });
          forged++;
        } else {
          incoming.push("junk");
          forged++;
        }
      }
      tag.push("peek", known.length, incoming.length);
      if (peek) {
        const got = peek(acceptLogDetailed(cfg, "E1", incoming, known));
        if (got && typeof got.then === "function")
          c.ok(false, "T-62", () => "the log code needed a signature check for messages that cannot pass one");
        else {
          const g = got, have = new Set(seqs), prefix = [];
          for (let s = 1;have.has(s); s++)
            prefix.push(s);
          c.ok(g.forged === forged && numsEq(g.log.map((x) => x.seq), prefix), "T-62", () => ({ forged: g.forged, wantForged: forged, got: g.log.map((x) => x.seq), prefix }));
        }
        c.ok(wellFormed(mk(3, "s")) && !wellFormed(mk(0, "s")) && !wellFormed({ ...mk(1, "s"), action: "dance" }) && !wellFormed({ ...mk(1, "s"), atBeaconRound: -1 }) && !wellFormed({ ...mk(1, "s"), untilRound: 1.5 }) && !wellFormed(null) && !wellFormed([]) && !wellFormed({ ...mk(1, "s"), sig: 5 }), "T-62");
      }
    }
  }
  return { parts, tag: tag.join(",") };
}
function edSample(r, c) {
  const secret = r.hex(32), PK8 = Buffer.from("302e020100300506032b657004220420", "hex"), priv = createPrivateKey({ key: Buffer.concat([PK8, Buffer.from(secret, "hex")]), format: "der", type: "pkcs8" }), pub = createPublicKey(priv);
  c.ok(publicKeyFromSecret(secret) === pub.export({ format: "der", type: "spki" }).subarray(-32).toString("hex"), "T-62", () => "public key differs from node's");
  for (let i = 0;i < 6; i++) {
    const m = { engagementId: "E" + r.hex(3), seq: r.int(1, 9), action: r.pick(["pause", "resume", "extend", "stop"]), atBeaconRound: r.int(1000, 90000000), signedAtRound: r.int(1000, 90000000), ...r.chance(0.5) ? { untilRound: r.int(1000, 90000000) } : {} };
    const text = `CBCTL1|${m.engagementId}|${m.seq}|${m.action}|${m.atBeaconRound}|${m.signedAtRound}|${"untilRound" in m ? m.untilRound : "-"}`, sig = signControlWithSecret(secret, m).sig;
    const data = Buffer.from(text), mine = nodeSign(null, data, priv).toString("hex");
    c.ok(sig === mine && /^[0-9a-f]{128}$/.test(sig), "T-62", () => ({ text, sig, mine }));
    c.ok(nodeVerify(null, data, pub, Buffer.from(sig, "hex")) === true, "T-62", () => "node cannot verify the product's signature");
    c.ok(nodeVerify(null, Buffer.from(text.replace(/\|(\d+)\|/, (_, d) => `|${Number(d) + 1}|`)), pub, Buffer.from(sig, "hex")) === false, "T-62", () => "a changed message still verifies");
    const bad = Buffer.from(sig, "hex");
    bad[r.int(0, 63)] ^= 1 << r.int(0, 7);
    c.ok(nodeVerify(null, data, pub, bad) === false, "T-62", () => "a changed signature still verifies");
    c.ok(wellFormed({ ...m, sig }), "T-62");
  }
}

// games/snakes/k_plat.ts
var HEX = "0123456789abcdef";
var DAY2 = 86400000;
var IST2 = 19800000;
var hex2 = (r, n) => {
  let s = "";
  for (let i = 0;i < n; i++)
    s += HEX[r.int(0, 15)];
  return s;
};
var isAlnum = (ch) => {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122;
};
var empEdgeO = (raw) => {
  let o = "";
  for (const ch of raw.normalize("NFKC").toUpperCase())
    if (ch.length === 1 && isAlnum(ch))
      o += ch;
  return o;
};
var empCoreO = (raw) => {
  let o = "";
  for (const ch of raw.normalize("NFKC"))
    if (ch.length === 1 && isAlnum(ch))
      o += ch;
  return o.toUpperCase();
};
var SPACE_SET = new Set([" ", "\t", `
`, "\r", "\v", "\f", "\xA0", "\u1680", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\uFEFF", "\x85", "\u200B", "\u200C", "\u200D", "\u2060", ...Array.from({ length: 11 }, (_, i) => String.fromCharCode(8192 + i))]);
var emailO = (raw) => {
  let o = "";
  for (const ch of raw.normalize("NFKC"))
    if (!SPACE_SET.has(ch))
      o += ch;
  return o.toLowerCase();
};
var isWs = (ch) => ch === " " || ch === "\t" || ch === `
` || ch === "\r" || ch === "\v" || ch === "\f" || ch === "\xA0" || ch === "\u1680" || ch >= "\u2000" && ch <= "\u200A" || ch === "\u2028" || ch === "\u2029" || ch === "\u202F" || ch === "\u205F" || ch === "\u3000" || ch === "\uFEFF";
var dropped = (c) => c < 32 || c === 127 || c >= 8203 && c <= 8207 || c === 8232 || c === 8233 || c === 65279;
var nameO = (n) => {
  let a = "";
  for (const ch of n)
    if (!dropped(ch.charCodeAt(0)) && ch !== "<" && ch !== ">" && ch !== "`")
      a += ch;
  let b = "", sp = false;
  for (const ch of a) {
    if (isWs(ch)) {
      if (!sp)
        b += " ";
      sp = true;
    } else {
      b += ch;
      sp = false;
    }
  }
  let i = 0;
  while (i < b.length && (b[i] === "=" || b[i] === "+" || b[i] === "-" || b[i] === "@" || isWs(b[i])))
    i++;
  b = b.slice(i);
  let e = b.length;
  while (e > 0 && isWs(b[e - 1]))
    e--;
  return b.slice(0, e).slice(0, 60);
};
var CF_INVISIBLE = [173, 8288, 8289, 8290, 8291, 8292, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297];
var WORDS = ["Asha", "ravi", "SINGH", "d'Souza", "Zo\xEB", "\u674E\u96F7", "\xC5sa", "O'Neil", "Mary-Ann", "x", "Dr.", "Priya K", "\u092D\u093E\u0930\u0924"];
function genName(r) {
  const n = r.int(0, 6), parts = [];
  for (let i = 0;i < n; i++) {
    const k = r.int(0, 15);
    parts.push(k < 6 ? r.pick(WORDS) : k === 6 ? "  " : k === 7 ? "\xA0" : k === 8 ? "\u200B" + r.pick(WORDS) : k === 9 ? "<b>" + r.pick(WORDS) + "</b>" : k === 10 ? r.pick(["=SUM(A1)", "+91", "-x", "@cmd", "= ", "==", "+-@="]) : k === 11 ? `\x00\x07	
` : k === 12 ? r.pick(["\uD83D\uDE00", "\uD83D\uDC69\u200D\uD83D\uDC69\u200D\uD83D\uDC67", "\uD83C\uDFB2"]) : k === 13 ? "`" : k === 14 ? "\u2028" + r.pick(WORDS) : r.pick(WORDS).repeat(r.int(2, 12)));
    if (r.chance(0.7))
      parts.push(" ");
  }
  if (r.chance(0.12))
    parts.push(String.fromCharCode(r.int(32, 126)).repeat(r.int(40, 90)));
  return parts.join("");
}
function genEmp(r, special) {
  const n = r.int(0, 6), seg = [];
  for (let i = 0;i < n; i++) {
    const k = r.int(0, 11);
    seg.push(k < 4 ? hex2(r, r.int(1, 5)).toUpperCase() : k < 6 ? String(r.int(0, 99999)) : k === 6 ? r.pick(["-", "/", " ", "_", ".", "  ", "\t"]) : k === 7 ? r.pick(["\uFF11\uFF22", "\uFF21\uFF22", "\u2460"]) : k === 8 ? "abc".slice(0, r.int(1, 3)) : k === 9 ? "\u200B" : k === 10 ? r.pick(["#", "(", ")", "\xE9", "\xF1"]) : r.pick(["x", "X"]));
  }
  if (special)
    seg.push(r.pick(["\xDF", "\u0131", "\u01F0", "\u1E96"]));
  if (r.chance(0.04))
    seg.push("@" + r.pick(["a.com", "x"]));
  if (r.chance(0.06))
    seg.push("Z".repeat(r.int(20, 40)));
  return seg.join("");
}
function kindPlat(r, c) {
  const parts = r.sample(["from", "pid", "emp", "name", "pause", "team", "admit", "life"], r.int(2, 3)), tag = [];
  for (const part of parts) {
    if (part === "from") {
      const seen = new Map, ins = ["o"];
      for (let i = 0;i < r.int(1, 8); i++)
        ins.push(r.pick(["h", "c", "s"]) === "s" ? "s:" + r.int(1, 999999999) : r.pick(["h:", "c:"]) + hex2(r, 7));
      for (const inv of ins) {
        const code = fromCodeOf(inv), p = code === null ? null : parseFrom(code);
        c.ok(code !== null && p !== null && inviterOf(p) === inv, "T-70", () => ({ inv, code, p }));
        if (code !== null) {
          if (seen.has(code))
            c.ok(seen.get(code) === inv, "T-70", () => ({ code, a: seen.get(code), b: inv }));
          seen.set(code, inv);
        }
        const kind = inv === "o" ? "org" : inv[0] === "h" ? "host" : inv[0] === "c" ? "cohost" : "guest";
        c.ok(p?.kind === kind, "T-70", () => ({ inv, p }));
        c.ok(srcOf(inv) === (inv[0] === "c" ? "co:" + inv.slice(2) : inv[0] === "h" ? "ho:" + inv.slice(2) : "link"), "T-70", () => inv);
      }
      c.ok(ORG_FROM === 1900000000 && HOST_FROM === 1500000000 && COHOST_FROM === 1e9, "T-70");
      const probe = r.pick([0, -1, 1.5, NaN, Infinity, 1e9 - 1, 1e9, 1e9 + 268435455, 1e9 + 268435456, 1499999999, 1500000000, 1500000000 + 268435455, 1500000000 + 268435456, 1899999999, 1900000000, 1900000000 + 1, "5", null, r.int(1, 2100000000)]);
      const want = typeof probe !== "number" || !Number.isInteger(probe) || probe < 1 ? "none" : probe === 1900000000 ? "org" : probe >= 1500000000 && probe < 1500000000 + 268435456 ? "host" : probe >= 1e9 && probe < 1e9 + 268435456 ? "cohost" : probe < 1e9 ? "guest" : "none", got = parseFrom(probe);
      c.ok((got?.kind ?? "none") === want, "T-70", () => ({ probe, got, want }));
      c.ok(fromCodeOf("x:12") === null && fromCodeOf("") === null && (fromCodeOf("h:zz") === null || parseFrom(fromCodeOf("h:zz")) === null), "T-70");
      tag.push("from", ins.length);
    } else if (part === "pid") {
      const seatTxt = r.pick([String(r.int(1, 9999999)), String(r.int(1, 120)), "0", "00012", String(r.int(1e7, 99999999)), ""]), h = r.pick([hex2(r, r.int(8, 24)), hex2(r, r.int(0, 7)), hex2(r, 10).toUpperCase(), hex2(r, 8) + "g", hex2(r, 8) + " "]);
      const pid = r.pick([seatTxt + "x" + h, seatTxt + "X" + h, seatTxt + h, " " + seatTxt + "x" + h, seatTxt + "x" + h + "x" + hex2(r, 8), "x" + h]);
      const ix = pid.indexOf("x"), a = ix < 0 ? "" : pid.slice(0, ix), b = ix < 0 ? "" : pid.slice(ix + 1);
      const digits = (s, lo, hi) => s.length >= lo && s.length <= hi && [...s].every((ch) => ch >= "0" && ch <= "9"), hexok = (s) => s.length >= 8 && [...s].every((ch) => HEX.includes(ch));
      const want = ix >= 0 && digits(a, 1, 7) && hexok(b) && Number(a) >= 1 ? Number(a) : null, wantT = ix >= 0 && digits(a, 1, 6) ? Number(a) : null;
      c.ok(seatOfPid(pid) === want, "T-71", () => ({ pid, got: seatOfPid(pid), want }));
      c.ok(seatOfPidText(pid) === wantT, "T-71", () => ({ pid, got: seatOfPidText(pid), wantT }));
      c.ok(seatOfPid(5) === null, "T-71");
      const eid = "E" + hex2(r, 4), seat = r.int(1, 99999);
      c.ok(ticketId(eid, seat) === `${eid}-T${String(seat).padStart(4, "0")}` && ticketId(eid, 7) === `${eid}-T0007`, "T-71", () => ({ eid, seat }));
      tag.push("pid", seatTxt.length);
    } else if (part === "emp") {
      const special = r.chance(0.025), raw = genEmp(r, special), typed = raw.trim();
      const e1 = cleanEmpId(raw), want = empEdgeO(raw);
      c.ok(e1 === want, "T-72", () => ({ raw, got: e1, want }));
      c.ok(cleanEmpId(raw.toLowerCase()) === cleanEmpId(raw) || /[\u0131\u00DF]/.test(raw), "T-72", () => ({ raw }));
      c.ok(cleanEmpId(e1) === e1 && /^[A-Z0-9]*$/.test(e1), "T-72", () => ({ raw, e1 }));
      c.ok(cleanEmpId(raw.replace(/[\s\-_./]+/g, "-")) === e1 || special, "T-72", () => ({ raw }));
      const mail = looksLikeEmail(raw), wantMail = raw.normalize("NFKC").includes("@");
      c.ok(mail === wantMail, "T-72", () => ({ raw }));
      const ne = normEmp(raw, true), wantNe = typed === "" ? "" : e1 && e1.length <= 30 ? e1 : null;
      c.ok(ne === wantNe, "T-72", () => ({ raw, ne, wantNe }));
      const ni = normId(raw, "emp", true), wantNi = wantMail ? null : wantNe;
      c.ok(ni === wantNi, "T-72", () => ({ raw, ni, wantNi }));
      if (typed !== "" && !wantMail && e1.length > 30)
        c.ok(normId(raw, "emp", true) === null, "T-72", () => ({ raw }));
      const old = raw.replace(/\s+/g, "").toUpperCase(), wantOld = old === "" ? "" : /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(old) ? old : null;
      c.ok(normEmp(raw, false) === wantOld, "T-72", () => ({ raw, old }));
      const cc = cleanEmpId2(raw), wantC = empCoreO(raw);
      c.ok(cc === wantC, "T-72", () => ({ raw, cc, wantC }));
      const nm = normEmp2(raw), wantNm = typed === "" ? "" : wantMail ? null : cc && cc.length <= EMP_MAX ? cc : null;
      c.ok(nm === wantNm, "T-72", () => ({ raw, nm, wantNm }));
      c.ok(normId2("emp", raw) === (wantNm || null), "T-72", () => ({ raw }));
      const em = r.pick(["Ab.C@Example.COM", " a b@x.io ", "\uFF21\uFF22\uFF20\uFF58\uFF0E\uFF49\uFF4F", "no-at", "a@b", "x@y.zz", "\u200Bq@w.er"]), ek = emailO(em);
      c.ok(normId2("email", em) === (ek || null), "T-72", () => ({ em, ek }));
      const en = normId(em, "email", true);
      const wantEn = ek === "" ? "" : /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(ek) && ek.length <= 254 ? ek : null;
      c.ok(en === wantEn, "T-72", () => ({ em, en, wantEn }));
      c.ok(cleanEmpId(raw) === cleanEmpId2(raw), "T-72", () => ({ raw, edge: cleanEmpId(raw), core: cleanEmpId2(raw) }));
      tag.push("emp", special ? 1 : 0, raw.length);
    } else if (part === "name") {
      const raw = genName(r), got = cleanName(raw), want = nameO(raw);
      c.ok(got === want, "T-73", () => ({ raw, got, want }));
      c.ok(cleanName(5) === "" && cleanName(null) === "" && cleanName(undefined) === "", "T-73");
      c.ok(![...got].some((ch) => dropped(ch.charCodeAt(0)) || ch === "<" || ch === ">" || ch === "`") && got.length <= 60, "T-73", () => ({ raw, got }));
      c.ok(!/^[=+\-@\s]/.test(got), "T-73", () => ({ raw, got }));
      c.ok(got === got.trim() && !/\s\s/.test(got), "T-73", () => ({ raw, got, why: "a space is left at the end" }));
      c.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(got), "T-73", () => ({ raw, got, why: "half of a character is left" }));
      c.ok(cleanName(got) === got, "T-73", () => ({ raw, got, again: cleanName(got) }));
      if (r.chance(0.05)) {
        const cf = r.pick(CF_INVISIBLE), g2 = cleanName("A" + String.fromCharCode(cf) + "B");
        c.ok(g2 === "AB", "T-73", () => ({ cf: cf.toString(16), g2 }));
      }
      tag.push("name", got.length);
    } else if (part === "pause") {
      const roles = ["organizer", "host", "cohost", "participant", "family"], MSG = "Only the Organizer, or a Host the Organizer has set up with a key, can pause or resume the game.";
      let st = freshPause(), phase = "waiting", frozen = null, pausedMs = 0, now = r.int(1e6, 9000000);
      const log = [], pauses = [];
      const n = r.int(2, 12);
      for (let i = 0;i < n; i++) {
        now += r.int(0, 600000);
        const op = r.weighted([["pause", 38], ["resume", 34], ["start", 14], ["end", 4], ["nothing", 10]]);
        if (op === "start") {
          st = { ...st, clock: start(st.clock) };
          if (phase === "waiting")
            phase = "running";
          continue;
        }
        if (op === "end") {
          st = { ...st, clock: end(st.clock) };
          phase = "over";
          frozen = null;
          continue;
        }
        if (op === "nothing") {
          c.ok(engineNow(st, now) === (frozen ?? now) - pausedMs, "T-74", () => ({ now }));
          continue;
        }
        const role = r.pick(roles), keyOk = r.chance(0.5), before = JSON.stringify(st), res = applyPause(st, op, role, keyOk, now);
        const allowed = role === "organizer" || role === "host" && keyOk;
        let wantOk = false, wantErr = "";
        if (!allowed)
          wantErr = MSG;
        else if (op === "pause") {
          if (phase === "running")
            wantOk = true;
          else
            wantErr = "The game is not running, so it cannot be paused.";
        } else {
          if (phase === "paused")
            wantOk = true;
          else
            wantErr = "The game is not paused.";
        }
        c.ok(res.ok === wantOk && (res.ok || res.error === wantErr), "T-74", () => ({ op, role, keyOk, phase, res }));
        c.ok(JSON.stringify(st) === before, "T-74", () => "the old state was changed");
        if (res.ok && wantOk) {
          st = res.st;
          if (op === "pause") {
            phase = "paused";
            frozen = now;
            pauses.push(now);
          } else {
            phase = "running";
            pausedMs += now - frozen;
            frozen = null;
          }
          log.push({ at: now, role, what: op });
          c.ok(st.clock.phase === phase && st.clock.frozenAt === frozen && st.clock.pausedMs === pausedMs, "T-74", () => ({ clock: st.clock, phase, frozen, pausedMs }));
        } else if (res.ok)
          st = res.st;
        c.ok(same(st.log, log), "T-74", () => ({ log: st.log, want: log }));
        const q = now + r.int(0, 90000);
        c.ok(engineNow(st, q) === (frozen ?? q) - pausedMs, "T-74", () => ({ q, frozen, pausedMs }));
        if (phase === "paused")
          c.ok(engineNow(st, q + 12345) === engineNow(st, q), "T-74", () => "the clock moved during a pause");
      }
      c.ok(st.log.every((x) => Object.keys(x).sort().join() === "at,role,what"), "T-74", () => st.log);
      c.ok(canControlClock("organizer") && canControlClock("host") && !canControlClock("cohost") && !canControlClock("participant") && !canControlClock("family"), "T-74");
      c.ok(canEditSetup("organizer") && !canEditSetup("host") && getsEndPdf("organizer") && getsEndPdf("host") && !getsEndPdf("cohost") && isPlayer("participant") && isPlayer("family") && !isPlayer("host") && !isPlayer("organizer") && !isPlayer("cohost"), "T-74");
      tag.push("pause", n);
    } else if (part === "team") {
      let t = newTeam(), hosts = [], cohosts = [], log = [], now = 1000;
      const pool = ["E100", "e-100", "E 100", "E200", "e/300", "E400", "x@y.com", "", "   ", "!!!", "A".repeat(35), "\xDF" + "9", "E500", "E600", "E700"], bys = ["organizer", "organizer", "organizer", "host", "cohost", "participant", "family"];
      const idOf = (kind, raw) => {
        if (kind === "email") {
          const k = emailO(raw);
          return k || null;
        }
        if (raw.trim() === "")
          return null;
        if (raw.normalize("NFKC").includes("@"))
          return null;
        const s = empCoreO(raw);
        return s && s.length <= 30 ? s : null;
      };
      for (let i = 0, n = r.int(3, 16);i < n; i++) {
        now += 10;
        const op = r.weighted([["host", 40], ["cohost", 30], ["approve", 30]]), by = r.pick(bys), before = JSON.stringify(t);
        if (op === "approve") {
          const raw = r.chance(0.7) && hosts.length ? r.pick(hosts).id : r.pick(["E100", "E200", "nobody"]), res = approveHostKey(t, by, raw, now);
          const h = hosts.find((x) => x.id === raw);
          let wantOk = true, why = "";
          if (by !== "organizer") {
            wantOk = false;
            why = "Only the Organizer can approve a Host key.";
          } else if (!h) {
            wantOk = false;
            why = "That Host is not in this game.";
          }
          c.ok(res.ok === wantOk && (res.ok || res.why === why), "T-75", () => ({ op, by, raw, res }));
          if (res.ok && wantOk) {
            if (!h.keyApproved) {
              h.keyApproved = true;
              log.push({ at: now, role: by, what: "Host key approved" });
            }
            t = res.team;
          }
        } else {
          const kind = r.pick(["emp", "emp", "email"]), raw = r.pick(pool), id = idOf(kind, raw), role = op;
          const res = (role === "host" ? addHost : addCohost)(t, by, kind, raw, now);
          let wantOk = false, why = "";
          if (role === "host" ? by !== "organizer" : !(by === "organizer" || by === "host"))
            why = role === "host" ? "Only the Organizer can add a Host." : "Only the Organizer or a Host can add a Co-host.";
          else if (!id)
            why = kind === "email" ? "That e-mail does not look right." : "That employee ID does not look right.";
          else if ([...hosts, ...cohosts].some((x) => x.id === id))
            why = "This person already has a role in this game.";
          else if (role === "host" && hosts.length >= 5)
            why = "A game can have up to 5 Hosts.";
          else
            wantOk = true;
          c.ok(res.ok === wantOk && (res.ok || res.why === why), "T-75", () => ({ op, by, kind, raw, id, res, why }));
          if (res.ok && wantOk) {
            (role === "host" ? hosts : cohosts).push({ id, role, keyApproved: false });
            log.push({ at: now, role: by, what: role === "host" ? "Host added" : "Co-host added" });
            t = res.team;
          }
        }
        c.ok(JSON.stringify(t) !== undefined && before !== undefined, "T-75");
        c.ok(same(t.hosts, hosts) && same(t.cohosts, cohosts) && same(t.log, log), "T-75", () => ({ team: t, hosts, cohosts, log }));
        c.ok(hosts.length <= MAX_HOSTS, "T-75");
      }
      for (const h of hosts)
        c.ok(hostMayControl(t, h.id) === h.keyApproved, "T-75", () => h);
      c.ok(!hostMayControl(t, "NOBODY") && MAX_HOSTS === 5, "T-75");
      const lim = r.pick([10, 100, 1000, 9, 1001, 0, -5, 10.5, NaN, 500, 999, 11, r.int(-20, 1200)]);
      c.ok(cohostLimitOk(lim) === (Number.isInteger(lim) && lim >= 10 && lim <= 1000), "T-75", () => ({ lim }));
      c.ok(COHOST_LIST_DEFAULT === 100 && COHOST_LIST_MIN === 10 && COHOST_LIST_MAX === 1000 && COHOST_LIMIT_DEFAULT === COHOST_LIST_DEFAULT && COHOST_LIMIT_MIN === COHOST_LIST_MIN && COHOST_LIMIT_MAX === COHOST_LIST_MAX, "T-75");
      tag.push("team", hosts.length, cohosts.length);
    } else if (part === "admit") {
      const j = { listed: r.chance(0.5), closeGroup: r.chance(0.5), alreadySeated: r.chance(0.25), full: r.chance(0.25), open: r.chance(0.8) }, got = admit(j);
      const want = !j.open ? "refused" : j.alreadySeated ? "refused" : j.full ? "refused" : j.closeGroup && !j.listed ? "waiting" : "in";
      c.ok(got.result === want && want === "refused" === (typeof got.why === "string" && got.why.length > 5), "T-76", () => ({ j, got }));
      if (want === "refused")
        c.ok(got.why === (!j.open ? "This game is not open yet." : j.alreadySeated ? "This ID already has a seat in this game." : "This game is full."), "T-76", () => ({ j, got }));
      c.ok(FAMILY_SEATS === 4 && MAX_INVITES_PER_PERSON === 4 && FAMILY_SEATS === MAX_INVITES_PER_PERSON, "T-76", () => ({ FAMILY_SEATS, MAX_INVITES_PER_PERSON }));
      tag.push("admit", want);
    } else {
      const end = r.int(1700000000000, 1900000000000) + (r.chance(0.2) ? r.pick([0, 1, 18000000, 18000001, DAY2 - 1]) : 0);
      const t = end + 365 * DAY2, d = new Date(t + IST2), want = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - IST2;
      c.ok(fullDeleteAt(end) === want, "T-77", () => ({ end, got: fullDeleteAt(end), want }));
      const fd = fullDeleteAt(end), ist = new Date(fd + IST2);
      c.ok(ist.getUTCHours() === 0 && ist.getUTCMinutes() === 0 && ist.getUTCSeconds() === 0 && fd > end + 365 * DAY2 && fd <= end + 366 * DAY2, "T-77", () => ({ end, fd }));
      c.ok(personalDeleteAt(end) === end + 20 * 3600000 && reportLinkUntil(end) === end + 19 * 3600000 && PURGE_AFTER_MS === 72000000 && REPORT_LINK_MS === 68400000, "T-77");
      c.ok(reportLinkUntil(end) < personalDeleteAt(end) && personalDeleteAt(end) < end + 24 * 3600000 && personalDeleteAt(end) < fd, "T-77", () => ({ end }));
      const rr = r.int(1, 90000000);
      c.ok(roundMs(rr) === (1692803367 + (rr - 1) * 3) * 1000 && roundMs(rr) === roundTimeMs(rr) && roundAt(roundMs(rr)) === rr && roundAt(roundMs(rr) + 2999) === rr && roundAt(roundMs(rr) + 3000) === rr + 1 && QUICKNET.periodSec === 3 && QUICKNET.genesisSec === 1692803367, "T-77", () => ({ rr }));
      const cm = r.int(1700000000000, 1900000000000);
      c.ok(rescheduleUntilMs(cm) === cm + 365 * DAY2 && PAID_WINDOW_MS === 365 * DAY2 && MAX_AHEAD_MS === 30 * DAY2, "T-77");
      const st = r.int(1700000000000, 1900000000000);
      c.ok(checkinOpensMs(st) === st - 300000 && CHECKIN_OPENS_BEFORE_MS === 300000 && checkinRequired({}) === false && checkinRequired({ created_ms: r.pick([0, 1, Date.UTC(2026, 9, 23, 10), 4102444800000, cm]) }) === false, "T-77");
      tag.push("life");
    }
  }
  return { parts, tag: tag.join(",") };
}

// games/snakes/k_core.ts
var canon = (x) => JSON.stringify(x, (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, val]) => !((k === "extra" || k === "skip") && !val)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
var nb = (s) => ({ ...s, boards: undefined });
var byId2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var chain = (p) => (a, b) => p[b].at - p[a].at || p[b].ladders - p[a].ladders || p[a].missed - p[b].missed || p[a].fate - p[b].fate || byId2(a, b);
function mvO(b, at, roll, pass) {
  let n = at + roll;
  if (n > b.size) {
    if (!pass)
      return { to: at, note: "" };
    n = b.size;
  }
  if (b.ladders[n] !== undefined)
    return { to: b.ladders[n], note: `Ladder! Up to ${b.ladders[n]}`, lad: true };
  if (b.snakes[n] !== undefined)
    return { to: b.snakes[n], note: `Snake! Down to ${b.snakes[n]}` };
  const sp = b.specials?.[n];
  if (!sp)
    return { to: n, note: "" };
  if (sp.kind === "upgrade") {
    const to = Math.min(n + (sp.n ?? 3), b.size - 1);
    return { to, note: `Upgrade! Forward ${sp.n} to ${to}`, sp };
  }
  if (sp.kind === "downgrade") {
    const to = Math.max(n - (sp.n ?? 3), 2);
    return { to, note: `Downgrade! Back ${sp.n} to ${to}`, sp };
  }
  return { to: n, note: sp.kind === "reward" ? "Reward! 2 extra throws" : "Punishment! You lose your next throw", sp };
}
function stepO2(s, e, paused) {
  if (s.over || e.type !== "turn" || paused)
    return { state: s, out: [] };
  const p = {}, out = [], turn = e.only ? s.turn : s.turn + 1;
  for (const k of Object.keys(s.pawns))
    p[k] = { ...s.pawns[k] };
  for (const k of Object.keys(p)) {
    const w = p[k];
    if (e.only && k !== e.only)
      continue;
    if (w.finishedTurn || s.out.includes(k))
      continue;
    if (s.presence && !e.threw?.includes(k)) {
      w.missed++;
      continue;
    }
    if (w.skip) {
      w.skip--;
      w.note = "You lose this throw";
      continue;
    }
    const roll = e.rolls[k];
    if (!roll || roll < 1 || roll > 6)
      continue;
    if (w.extra)
      w.extra--;
    const m = mvO(s.boards[k], w.at, roll, s.pass);
    w.at = m.to;
    if (m.lad)
      w.ladders++;
    w.note = m.note;
    if (m.sp?.kind === "reward")
      w.extra = (w.extra ?? 0) + 2;
    if (m.sp?.kind === "punishment")
      w.skip = (w.skip ?? 0) + 1;
    if (w.at === s.boards[k].size)
      w.finishedTurn = turn;
  }
  const cmp = chain(p), places = ["1st", "2nd", "3rd", "4th", "5th"];
  const fin = Object.keys(p).filter((k) => p[k].finishedTurn === turn).sort(cmp);
  const finishers = [...s.finishers, ...fin].slice(0, 5);
  fin.forEach((k, i) => {
    if (s.finishers.length + i < 5)
      out.push({ kind: "win", player: k, position: places[s.finishers.length + i] });
  });
  const won = { ...s.milestoneWon };
  for (const m of s.milestones)
    if (!won[m]) {
      const hit = Object.keys(p).filter((k) => p[k].at >= m).sort(cmp)[0];
      if (hit) {
        won[m] = hit;
        out.push({ kind: "win", player: hit, position: `milestone ${m}` });
      }
    }
  let outList = s.out;
  if (s.survivors && !e.only && turn % s.roundTurns === 0) {
    const live = Object.keys(p).filter((k) => !p[k].finishedTurn && !outList.includes(k)).sort(cmp), gone = live.slice(s.survivors);
    for (const k of gone)
      out.push({ kind: "out", player: k, why: "behind the front runners" });
    if (gone.length)
      outList = [...outList, ...gone];
    out.push({ kind: "round", n: turn / s.roundTurns + 1, alive: live.length - gone.length });
  }
  const stillIn = Object.keys(p).filter((k) => !p[k].finishedTurn && !outList.includes(k)).length, gameMs = Math.max(s.gameMs, e.gameMs ?? s.gameMs);
  const over = finishers.length >= 5 || turn >= s.turnLimit || stillIn === 0 || gameMs >= s.timeLimitMs;
  return { state: { ...s, pawns: p, turn, finishers, milestoneWon: won, out: outList, over, gameMs, settledMs: gameMs }, out: [...out, ...over ? [{ kind: "end" }] : []] };
}
function rankO(s) {
  const cmp = chain(s.pawns), rest = Object.keys(s.pawns).filter((k) => !s.finishers.includes(k));
  return [...s.finishers, ...rest.filter((k) => !s.out.includes(k)).sort(cmp), ...rest.filter((k) => s.out.includes(k)).sort(cmp)];
}
function trapFree(b) {
  const dest = (sq, roll) => {
    const n = sq + roll;
    if (n > b.size)
      return sq;
    if (b.ladders[n] !== undefined)
      return b.ladders[n];
    if (b.snakes[n] !== undefined)
      return b.snakes[n];
    const sp = b.specials?.[n];
    if (sp?.kind === "upgrade")
      return Math.min(n + (sp.n ?? 3), b.size - 1);
    if (sp?.kind === "downgrade")
      return Math.max(n - (sp.n ?? 3), 2);
    return n;
  };
  const can = new Set([b.size]);
  for (let ch = true;ch; ) {
    ch = false;
    for (let sq = 1;sq < b.size; sq++)
      if (!can.has(sq)) {
        for (let ro = 1;ro <= 6; ro++)
          if (can.has(dest(sq, ro))) {
            can.add(sq);
            ch = true;
            break;
          }
      }
  }
  return can.size === b.size;
}
var pool = new Map;
var pooled = (r, size) => {
  const k = r.int(0, 23), key = `${size}|${k}`;
  if (!pool.has(key)) {
    const q = new Rng(5000 + k * 7 + size, 3);
    pool.set(key, cheapBoard(q, size, q.int(6, 12), q.int(6, 12), "exact"));
  }
  return pool.get(key) ?? null;
};
var OWNER_IDS = ["own-1", "own-2", "game-77", "SL-alpha", "corp snakes 5", "z9", "owner-board-test-4", "R2D2"];
function kindCore(r, c) {
  const which = r.weighted([["steps", 78], ["owner", 14], ["board", 8]]);
  c.dim("coreKind", which);
  if (which === "owner") {
    const id = r.pick(OWNER_IDS), b = ownerBoard(id), again = ownerBoard(id);
    c.ok(checkOwnerBoard(b).length === 0 && JSON.stringify(b) === JSON.stringify(again), "T-81", () => ({ id, problems: checkOwnerBoard(b) }));
    const sn = Object.entries(b.snakes), la = Object.entries(b.ladders), sp = Object.entries(b.specials ?? {}), starts = [...sn.map(([f]) => +f), ...la.map(([f]) => +f), ...sp.map(([q]) => +q)];
    c.ok(b.size === 100 && sn.length === 10 && la.length === 10 && sp.filter(([, v]) => v.kind === "punishment").length === 5 && sp.filter(([, v]) => v.kind === "reward").length === 5, "T-81", () => ({ id }));
    c.ok(new Set(starts).size === starts.length && !starts.includes(1) && !starts.includes(100) && sn.every(([f, t]) => +f > t && t >= 2) && la.every(([f, t]) => t > +f && t <= 99) && sn.every(([f, t]) => +f - t >= 3) && la.every(([f, t]) => t - +f >= 3), "T-81", () => ({ id, b }));
    const ends = [...sn.map(([, t]) => t), ...la.map(([, t]) => t)];
    c.ok(new Set(ends).size === ends.length && ends.every((t) => !starts.includes(t)), "T-81", () => ({ id }));
    c.ok(trapFree(b), "T-81", () => ({ id }));
    b.snakes[99] = 2;
    delete b.ladders[+la[0][0]];
    c.ok(JSON.stringify(ownerBoard(id)) === JSON.stringify(again), "T-81", () => "the stored board was changed through a copy");
    const bad = { size: 100, snakes: { ...again.snakes }, ladders: { ...again.ladders }, specials: { ...again.specials } };
    const how = r.int(0, 4);
    if (how === 0)
      bad.size = 99;
    else if (how === 1) {
      const k = +Object.keys(bad.snakes)[0];
      delete bad.snakes[k];
    } else if (how === 2) {
      const k = +Object.keys(bad.ladders)[0];
      bad.ladders[k] = k - 1;
    } else if (how === 3)
      bad.snakes[1] = 50;
    else {
      const k = +Object.keys(bad.specials)[0];
      delete bad.specials[k];
    }
    c.ok(checkOwnerBoard(bad).length > 0, "T-81", () => ({ how }));
    c.dim("ownerBreak", how);
    return { which, id, how };
  }
  if (which === "board") {
    const cb = pooled(r, 100), snakes = cb ? Object.keys(cb.snakes).length : 0, ladders = cb ? Object.keys(cb.ladders).length : 0;
    if (!cb) {
      c.dim("coreBoard", "none");
      return { which, skipped: 1 };
    }
    const b = { size: 100, snakes: { ...cb.snakes }, ladders: { ...cb.ladders } };
    c.ok(checkBoard(b).length === 0, "T-80", () => ({ problems: checkBoard(b), b }));
    const bad = { size: 100, snakes: { ...b.snakes }, ladders: { ...b.ladders } }, how = r.int(0, 5), lk = +Object.keys(bad.ladders)[0], sk = +Object.keys(bad.snakes)[0];
    if (how === 0)
      bad.ladders[lk] = lk + 31;
    else if (how === 1)
      bad.snakes[sk] = sk - 7;
    else if (how === 2) {
      for (const k of Object.keys(bad.snakes).slice(0, snakes - 5))
        delete bad.snakes[+k];
    } else if (how === 3)
      bad.snakes[1] = 40;
    else if (how === 4) {
      delete bad.ladders[lk];
      bad.ladders[lk] = 100;
    } else
      bad.snakes[sk] = lk;
    c.ok(checkBoard(bad).length > 0, "T-80", () => ({ how, bad }));
    c.dim("coreBoard", `break${how}`);
    return { which, snakes, ladders, how };
  }
  const n = r.pick([2, 3, 4, 6, 8, 12]), size = r.pick([100, 100, 100, 144, 225]), players = Array.from({ length: n }, (_, i) => "p" + (i + 1));
  const specialsOn = r.chance(0.6), boards = {}, sharedB = pooled(r, size);
  if (!sharedB) {
    c.dim("coreBoard", "none");
    return { which, skipped: 1 };
  }
  const shared = r.chance(0.5);
  const mk = () => {
    const b = { size, snakes: { ...sharedB.snakes }, ladders: { ...sharedB.ladders } };
    if (specialsOn) {
      const used = new Set([1, size, ...Object.keys(b.snakes).map(Number), ...Object.keys(b.ladders).map(Number), ...Object.values(b.snakes), ...Object.values(b.ladders)]), sp = {};
      for (const kind of ["upgrade", "downgrade", "reward", "punishment"])
        for (let i = r.int(0, 3);i > 0; i--) {
          let q = r.int(2, size - 1), g = 0;
          while (used.has(q) && g++ < 30)
            q = r.int(2, size - 1);
          if (used.has(q))
            continue;
          used.add(q);
          sp[q] = kind === "upgrade" || kind === "downgrade" ? { kind, n: r.int(1, 6) } : { kind };
        }
      b.specials = sp;
    }
    return b;
  };
  const one = mk();
  for (const p of players)
    boards[p] = shared ? one : mk();
  const fate = {};
  for (const p of players)
    fate[p] = r.chance(0.2) ? r.int(0, 3) : r.int(0, 1e6);
  const presence = r.chance(0.35), pass = r.chance(0.3), turnLimit = r.pick([3, 8, 15, 30, 60, 600]), survivors = r.pick([0, 0, 0, 1, 2, n - 1, n]), roundTurns = r.pick([1, 2, 5, 10, 10, 12]);
  const miles = Array.from({ length: r.pick([0, 1, 1, 2, 3, 4]) }, () => r.chance(0.1) ? 50 : r.int(2, size - 1)), minutes = r.pick(["7", "8", "8", "9", undefined, 7]);
  const setup = { fate, mode: presence ? "presence" : "fate", pass, turnLimit, survivors, roundTurns, timeLimitMinutes: minutes, milestones: miles.length ? miles.join(",") : r.pick(["", undefined]) };
  if (shared)
    setup.board = one;
  else
    setup.boards = boards;
  const lackBoard = r.chance(0.04);
  if (lackBoard) {
    delete setup.board;
    setup.boards = { ...boards };
    delete setup.boards[players[0]];
  }
  c.dim("coreBoard", `${size}${specialsOn ? "s" : ""}`);
  c.dim("corePlayers", n);
  c.dim("corePresence", presence);
  c.dim("corePass", pass);
  let st;
  try {
    st = snakesRules.init(setup, players);
  } catch (e) {
    c.ok(lackBoard && String(e.message).includes("board"), "T-80", () => String(e));
    if (!lackBoard)
      return { which, n };
    return { which, lack: 1 };
  }
  c.ok(!lackBoard, "T-80", () => "a player without a board was accepted");
  const msRaw = minutes === "7" || minutes === 7 ? 7 : 8;
  const ms = String(setup.milestones ?? "75").split(",").map(Number).filter(Boolean).slice(0, 3);
  const o0 = { boards: Object.fromEntries(players.map((p) => [p, boards[p]])), pawns: Object.fromEntries(players.map((p) => [p, { at: 1, ladders: 0, missed: 0, fate: fate[p] }])), turn: 0, turnLimit, pass, presence, finishers: [], survivors, roundTurns, out: [], milestones: ms, milestoneWon: {}, over: false, timeLimitMs: msRaw * 60000, gameMs: 0, settledMs: 0 };
  c.ok(canon({ ...st, boards: undefined }) === canon({ ...o0, boards: undefined }), "T-80", () => ({ got: st, want: o0 }));
  let oc = o0, clock = start(newClock()), gameMs = 0, turns = 0;
  const steps = r.int(1, 45);
  for (let i = 0;i < steps && !oc.over; i++) {
    let ev;
    const k = r.weighted([["turn", 82], ["tick", 4], ["only", 10], ["paused", 4]]);
    if (k === "tick")
      ev = { type: "tick" };
    else {
      const rolls = {}, threw = [];
      for (const p of players) {
        rolls[p] = r.chance(0.03) ? r.pick([0, 7, -1]) : r.int(1, 6);
        if (r.chance(0.8))
          threw.push(p);
      }
      if (r.chance(0.02))
        delete rolls[r.pick(players)];
      gameMs += r.chance(0.3) ? r.int(0, 90000) : r.int(0, 3000);
      ev = { type: "turn", rolls, ...presence ? { threw } : {}, ...r.chance(0.8) ? { gameMs } : {} };
      if (k === "only") {
        const x = players.filter((p) => (oc.pawns[p].extra ?? 0) > 0);
        if (x.length)
          ev.only = r.pick(x);
      }
    }
    const pausedNow = k === "paused", cl = pausedNow ? pause(clock, "organizer", 1) : clock, before = canon(nb(st));
    const got = snakesRules.step(st, ev, 0, cl), want = stepO2(oc, ev, pausedNow);
    turns++;
    c.ok(got.state.boards === st.boards && canon(nb(got.state)) === canon(nb(want.state)), "T-80", () => ({ i, ev, got: got.state, want: want.state }));
    c.ok(canon(got.out) === canon(want.out), "T-80", () => ({ i, ev, got: got.out, want: want.out }));
    c.ok(canon(nb(st)) === before, "T-80", () => "the old state was changed by a step");
    if (pausedNow)
      c.ok(got.state === st && got.out.length === 0, "T-80", () => "a paused clock did not freeze the game");
    st = got.state;
    oc = want.state;
    for (const p of players) {
      const w = st.pawns[p];
      c.ok(w.at >= 1 && w.at <= size && (w.finishedTurn === undefined || w.at === size), "T-80", () => ({ p, w }));
    }
    c.ok(st.finishers.length <= 5 && new Set(st.finishers).size === st.finishers.length, "T-80", () => st.finishers);
    const rk = finalRanking(st), wantRk = rankO(oc);
    c.ok(rk.length === n && new Set(rk).size === n && players.every((p) => rk.includes(p)) && canon(rk) === canon(wantRk), "T-81", () => ({ rk, wantRk }));
    c.ok(st.finishers.every((p, j) => rk[j] === p), "T-81", () => ({ rk, fin: st.finishers }));
  }
  c.dim("coreEnd", oc.over ? oc.finishers.length >= 5 ? "five" : oc.turn >= oc.turnLimit ? "turns" : oc.gameMs >= oc.timeLimitMs ? "time" : "none-in" : "open");
  c.dim("coreSurv", survivors === 0 ? "none" : "rounds");
  return { which, n, size, steps: turns, seedBoard: Object.keys(sharedB.snakes).length };
}

// games/snakes/scenario.ts
var KINDS2 = [["walk", 80], ["corrupt", 40], ["dice", 3], ["race", 50], ["table", 4], ["cfg", 110], ["sched", 140], ["plat", 540], ["core", 25]];
var meta = {
  game: "snakes",
  sha: "33ed474",
  dimensions: {
    kind: KINDS2.map((k) => k[0]),
    board: "open",
    mode: ["race", "team", "table"],
    play: ["fate", "presence"],
    players: ["2", "3-5", "6-8", "9-12", "13-40", "41-300"],
    claims: ["none", "collector", "pattern"],
    end: "open",
    exclusive: [true, false],
    pThrow: "open",
    absent: "open",
    turns: "open",
    corruption: "open",
    cfgParts: [2, 3, 4],
    coreKind: ["steps", "owner", "board"],
    ownerBreak: [0, 1, 2, 3, 4],
    coreBoard: "open",
    corePlayers: [2, 3, 4, 6, 8, 12],
    corePresence: [true, false],
    corePass: [true, false],
    coreEnd: "open",
    coreSurv: ["none", "rounds"]
  },
  rules: RULES
};
function run(seed, trace) {
  const r = new Rng(seed, 1), c = new Ctx(trace, trace.length > 0);
  const kind = r.weighted(KINDS2), fn = {
    walk: () => kindWalk(r, c),
    corrupt: () => kindCorrupt(r, c),
    dice: () => kindDice(r, c),
    race: () => kindRace(r, c, seed),
    table: () => kindTable(r, c),
    cfg: () => kindCfg(r, c),
    sched: () => kindSched(r, c),
    plat: () => kindPlat(r, c),
    core: () => kindCore(r, c)
  };
  c.dim("kind", kind);
  const p = fn[kind]();
  if (kind === "sched" && seed % 2000 === 0) {
    edSample(new Rng(seed, 5), c);
    c.dim("ed25519", true);
  }
  c.t(() => `kind=${kind} params=${JSON.stringify(p)}`);
  return { params: { kind, p, fp: r.u32() }, dims: c.dims, checks: c.checks, fails: c.fails };
}

// games/snakes/main.ts
main(meta, run);
