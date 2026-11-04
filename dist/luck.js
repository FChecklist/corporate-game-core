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
    const from2 = num("from", 0);
    for (let s = from2;s < from2 + det; s++) {
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

// games/luck/common.ts
var RULES = {
  "H-00": "The test's own hash (a stand-in for the browser's async SHA-256) gives the published SHA-256 answers, so every number the test checks is the real one.",
  "G-01": "The target of a dice round is a number 1 to 6 made only from the game id, the dice round and the public number, so every phone gets the same target.",
  "G-02": "A player's dice is a number 1 to 6 made only from the game id, the seat, the dice round and the public number, so every phone gets the same dice.",
  "G-03": "Classic: a hit (dice equals target) scores the target, a miss scores nothing. New flow: a pressed dice scores 10, 5, 3 or 1 by distance from the target, an unpressed one scores 0.",
  "G-04": "A player's points, hits and best hit are exactly the sum of what they scored in the dice rounds, and the rounds add up to the whole game.",
  "G-05": "'Who reached the score first' means the last dice round in which the player scored anything.",
  "G-06": "The top places are in the written order with no ties: points, then highest single hit, then most hits, then who reached the score first, then the lower fate number (new flow: points, exact hits, 5-point hits, who reached first, fate).",
  "G-07": "The ranking does not depend on the order the players are listed in: every phone gets the same list.",
  "G-08": "Players who are equal on every number are separated by their fate number (the lower wins), never by seat order, even when the tie reaches over the end of the top-10 list.",
  "G-09": "A player's standing counts exactly the players strictly ahead on the numbers, and 'top x percent' is that count plus one, over the players, rounded up, at least 1.",
  "G-10": "Every listed place that shares its points with its neighbour in the list says which measure decided it.",
  "G-11": "The last listed place says which measure decided it when the first player below the list shares its points.",
  "G-12": "The game must be played in order with both public numbers: a dice round out of order, a missing number, ranking before it is possible are refused.",
  "G-13": "The organizer may end the game after round n only if n is a whole number from 1 to one less than the rounds and that round is not already past; the game then has n rounds.",
  "G-14": "Prizes go to the places the organizer wrote a gift for: without 'one win per player' place k gets the player ranked k; with it, the next player who has not won yet; a place without a gift gives nothing; round 1, 2 ... then overall.",
  "G-15": "Prize mode 'overall' gives prizes only for the overall result, 'rounds' only for the rounds, 'both' for both; and with 'one win per player' nobody gets two prizes.",
  "T-01": "Dice round g opens at the start plus g slots (window plus reveal) plus one break after each full round; its window closes after the window seconds, its reveal 3 seconds later; the game ends when the last reveal ends.",
  "T-02": "At any moment the game is before the start, in a press window, in a reveal, in a break after a round, or over, exactly as counting slot by slot says, also at the exact boundaries.",
  "T-03": "The public number for the target exists from the moment its dice round opens and the number for the dice only from the moment its press window closes.",
  "S-01": "Settings in range are accepted and kept as typed: 1 to 20 rounds, a window of 6, 10 or 15 seconds, a prize mode, one-win-per-player, at most 5 prizes per list; anything not given takes its default.",
  "S-02": "Settings out of range are refused with the plain sentence for the first wrong field, and nothing is kept.",
  "S-03": "A prize is a gift: text with money words or money signs is refused; spaces are tidied; at most 120 characters; it must be text.",
  "S-04": "A new-flow game is always 22 rounds of one dice round, 10 s window, 3 s reveal, 7 s break, prizes for the overall result unless chosen; its start mode is 'auto' or 'manual'.",
  "S-05": "More prize lists than rounds are refused.",
  "V-01": "The fingerprint is sha256('LBC-COMMIT|'+secret); the seed is sha256 of the secret, the game id and the sorted list of player ids; public number i is sha256('LBC-BEACON|'+seed+'|'+i).",
  "V-02": "A result counts only when this many different phones send the same one: the smaller of the players and the larger of 3 and 5% of them, rounded up.",
  "V-03": "A result with an odd shape (unknown or repeated seat, impossible score, wrong number of rounds, empty or more than 10 lines) is refused; a good one is kept in one fixed shape.",
  "V-04": "A game is closed at the latest: a minute after the phones agreed, or 11 minutes after its last dice round if they never agreed, or 6 hours after its start if it never began.",
  "R-01": "Only the Organizer or a Host (not through an AI link) can start, end or close a game; every other sign-in gets 403 and nothing changes.",
  "R-02": "A game needs at least 2 players who are not removed; fewer is refused and the answer says how many joined.",
  "R-03": "Start accepts the settings and a delay of 5 s to 1 hour; wrong settings or delay are refused in plain words and nothing starts; a second start is refused.",
  "R-04": "The list of players closes at the start: the people who had joined and were not removed, seated in the order of their ids; a person who joins later only watches; a person removed before the start has no seat.",
  "R-05": "A public number is sent only from the moment it is due (the dice number only after its window closed), in order, at most 60 per call, never before the start.",
  "R-06": "The secret is shown only after the game is over, and then anybody can recompute the fingerprint, the seed and every public number.",
  "R-07": "A player's own calls (vote, press, me) work only from their own phone: another phone, a stranger, a removed player or a bad device gets the right plain refusal.",
  "R-08": "A vote is taken only after the game's end time; the result counts when enough different phones send the same one and it leads; a forged result against an honest majority does not win; the winners record gets first to fifth.",
  "R-09": "If the phones never agree, the game is closed ten minutes after its end without a published result.",
  "R-10": "Ending early ends the game after the round now being played; pressing twice gives the same answer; before the first dice round, on the last round and after the end it says so in plain words.",
  "R-11": "New flow press: accepted while the window is open (with one second of grace), refused before and after; the first press of a player in a round is the one kept; who pressed is shown only after the window closed.",
  "R-12": "When the day's budget is used up the route answers 'busy' and changes nothing.",
  "R-13": "A cancelled, not-started, draft or locked game gives the gate's answer and changes nothing.",
  "R-14": "A new-flow game waits 120 seconds for people; the list is read when the time is over; with fewer than 2 it goes back to waiting.",
  "R-15": "A player the organizer removed during the game does not take a podium place or prize.",
  "R-16": "The names shown are tidied: no markup characters, one space between words, at most 24 characters, 'Player' if empty; Luck has no pause, resume or stop route.",
  "P-01": "The 'from' code of a common link means exactly one owner (organizer, host, co-host or a guest's seat) and coding then decoding gives the same owner; codes outside the ranges mean nobody.",
  "P-02": "Each guest may invite 1 to 10 people (default 4) of the chosen kinds; a wrong number or kind is refused; 'invites on' needs a kind; 'employees only' switches invites off.",
  "P-03": "What a person gives to get in is mobile, id, either or both; an Email ID goes with 'id' only; tickets are 1 or 2; rounds 1 to 5.",
  "P-04": "A check-in code is different for every seat: the keyed shuffle of 0000-9999 never repeats a code; Luck has no check-in.",
  "P-05": "A ticket id is the game id, '-T' and the seat in 4 digits; the seat is read back from a participant id that starts with digits and an x.",
  "P-06": "Personal data is deleted 20 hours after the end, the report link stops after 19 hours, everything goes at 00:00 IST ending day 365; a cancelled paid game can be moved for 365 days.",
  "P-07": "A guest's own list counts the people who are not removed and are not team members; a team member or co-host has their own limit; the organizer and hosts have none.",
  "P-08": "Dice scores and draws are right for every possible face, and an unbiased draw gives the same number as the written recipe for any size, also when the first value is thrown away.",
  "C-01": "A message with too little lead or in the wrong state (resume when not paused, pause when paused, anything after stop) is ignored but still uses its number; the rest take effect.",
  "C-02": "A pause stops all calls for its whole length; the calls after it are the same calls later by exactly the pause length; before it nothing moves; resume continues from the same call.",
  "C-03": "An open pause ends by itself after the maximum pause; a timed pause ends at its end; resume ends it at its round; extend moves the end later only.",
  "C-04": "From a stop on, no call is made.",
  "C-05": "A phone applies only the signed messages in an unbroken run from number 1: forged, wrong-game or repeated messages change nothing, a missing number stops the run there, order does not matter.",
  "C-06": "The lead is longer than what a phone could not yet have seen (hold time plus cache plus margin), and a game's size decides which pause profile it gets.",
  "C-07": "The same log in any order gives the same answer on every phone.",
  "C-08": "A pause that ended before the first call does not delay the game.",
  "C-09": "A new organizer message is numbered next, takes effect after the lead, and a timed pause or extension ends where the organizer said.",
  "C-10": "A phone reveals new calls only while its last good answer is recent; after a long run of failed attempts it goes blind, and never because it was merely offline.",
  "F-01": "Over many draws every face 1 to 6 is equally likely (chi-square), for targets and for dice, and a hit happens one time in six."
};

class Ck {
  checks = 0;
  fails = [];
  ok(c, rule, d) {
    this.checks++;
    if (!c && this.fails.length < 24)
      this.fails.push({ rule, sentence: RULES[rule] ?? rule, detail: d ? d() : undefined });
    return c;
  }
  same(a, b, rule, what) {
    this.checks++;
    if (a !== b && this.fails.length < 24)
      this.fails.push({ rule, sentence: RULES[rule] ?? rule, detail: `${what}: got ${String(a)}, expected ${String(b)}` });
    return a === b;
  }
  json(a, b, rule, what) {
    this.checks++;
    const x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y && this.fails.length < 24)
      this.fails.push({ rule, sentence: RULES[rule] ?? rule, detail: `${what}: got ${x?.slice(0, 300)}, expected ${y?.slice(0, 300)}` });
    return x === y;
  }
}
var bucketN = (n) => n <= 2 ? "2" : n <= 5 ? "3-5" : n <= 12 ? "6-12" : n <= 60 ? "13-60" : "61+";
var bucketR = (r, nf) => nf ? "22 (new flow)" : r === 1 ? "1" : r <= 3 ? "2-3" : r <= 10 ? "4-10" : "11-20";
var tidy = (s) => s.split(/\s+/).filter(Boolean).join(" ");
var CLEAN_PRIZES = ["Hamper", "Book", "Pen set", "Coffee mug", "Movie tickets for two", "Plant with a pot", "Gift basket", "Desk lamp", "Backpack", "Headphones", "Travel bag", "Notebook", "Cashew nuts box", "Cashmere shawl", "Better luck mug", "Stakeholder pen", "Moneyball book", "Cafe voucher gift", "\u0909\u092A\u0939\u093E\u0930 \u092C\u0949\u0915\u094D\u0938"];
var MONEY_PRIZES = ["Win cash", "CASH prize", "cash-back card", "Rs 500 voucher", "Rs. 500", "500 rupees", "a rupee coin", "INR 100", "USD 5", "10 dollars", "bet on it", "betting slip", "stake money", "stakes", "wager", "wagering pack", "gambling night", "gambler kit", "jackpot", "money back", "\u20B9500", "$50", "Free $ gift"];

// games/luck/engine.ts
import * as jsc from "bun:jsc";
import { createHash } from "crypto";

// src-luck-3057fb8/packages/luck/src/random.ts
var enc = new TextEncoder;
var hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
var sha256Hex = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function stream(seed, label, count) {
  const out = [];
  for (let block = 0;out.length < count; block++) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${seed}|${label}|${block}`)));
    for (let i = 0;i + 4 <= h.length && out.length < count; i += 4)
      out.push((h[i] << 24 | h[i + 1] << 16 | h[i + 2] << 8 | h[i + 3]) >>> 0);
  }
  return out;
}
async function below(seed, label, n) {
  const limit = Math.floor(4294967296 / n) * n;
  for (let k = 0;; k++) {
    const v = (await stream(seed, `${label}#${k}`, 1))[0];
    if (v < limit)
      return v % n;
  }
}
// src-luck-3057fb8/packages/luck/src/settings.ts
var MAX_ROUNDS = 20;
var DEFAULT_ROUNDS = 10;
var DICE_ROUNDS_PER_ROUND = 10;
var REVEAL_SECS = 3;
var BREAK_SECS = 20;
var WINDOWS = [6, 10, 15];
var PLACES = 5;
var TOP_LIST = 10;
var defaultSettings = () => ({ rounds: DEFAULT_ROUNDS, windowSecs: 10, prizeMode: "both", oneWinPerPlayer: false, prizes: { overall: [], rounds: [] }, diceRounds: DICE_ROUNDS_PER_ROUND, revealSecs: REVEAL_SECS, breakSecs: BREAK_SECS });
var FORBIDDEN_PRIZE = /\b(cash|money|rupees?|rs\.?|inr|usd|dollars?|bets?|betting|stakes?|wager\w*|gambl\w*|jackpot)\b|[\u20B9$]/i;
function checkPrizeText(s) {
  if (typeof s !== "string")
    return { ok: false, error: "A prize is written as text." };
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length > 120)
    return { ok: false, error: "A prize text is at most 120 characters." };
  if (FORBIDDEN_PRIZE.test(t))
    return { ok: false, error: "A prize is a gift you hand over, not money. Please describe the gift." };
  return { ok: true, value: t };
}
function parseSettings(input) {
  const b = input && typeof input === "object" ? input : {};
  const s = defaultSettings();
  if (b.newFlow === true) {
    Object.assign(s, { newFlow: true, prizeMode: "overall", rounds: 22, windowSecs: 10, diceRounds: 1, revealSecs: 3, breakSecs: 7 });
    if (b.startMode !== undefined) {
      if (b.startMode !== "auto" && b.startMode !== "manual")
        return { ok: false, error: "The game starts by itself at the set time (auto) or when you press start (manual)." };
      s.startMode = b.startMode;
    }
  }
  if (b.rounds !== undefined && !s.newFlow) {
    const r = Number(b.rounds);
    if (!Number.isInteger(r) || r < 1 || r > MAX_ROUNDS)
      return { ok: false, error: `A game has 1 to ${MAX_ROUNDS} rounds.` };
    s.rounds = r;
  }
  if (b.windowSecs !== undefined && !s.newFlow) {
    const w = Number(b.windowSecs);
    if (!WINDOWS.includes(w))
      return { ok: false, error: "The press window is 6, 10 or 15 seconds." };
    s.windowSecs = w;
  }
  if (b.prizeMode !== undefined) {
    if (b.prizeMode !== "both" && b.prizeMode !== "overall" && b.prizeMode !== "rounds")
      return { ok: false, error: "Prizes are for each round, for the overall result, or both." };
    s.prizeMode = b.prizeMode;
  }
  if (b.oneWinPerPlayer !== undefined)
    s.oneWinPerPlayer = b.oneWinPerPlayer === true;
  const pz = b.prizes ?? {};
  const list = (v, what) => {
    if (v === undefined)
      return { ok: true, value: [] };
    if (!Array.isArray(v) || v.length > PLACES)
      return { ok: false, error: `${what}: at most ${PLACES} places have a prize.` };
    const out = [];
    for (const x of v) {
      const c = checkPrizeText(x);
      if (!c.ok)
        return { ok: false, error: `${what}: ${c.error}` };
      out.push(c.value);
    }
    return { ok: true, value: out };
  };
  const ov = list(pz.overall, "Overall prizes");
  if (!ov.ok)
    return ov;
  s.prizes.overall = ov.value;
  if (pz.rounds !== undefined) {
    if (!Array.isArray(pz.rounds) || pz.rounds.length > s.rounds)
      return { ok: false, error: "There are more prize lists than rounds." };
    for (let i = 0;i < pz.rounds.length; i++) {
      const l = list(pz.rounds[i], `Round ${i + 1} prizes`);
      if (!l.ok)
        return l;
      s.prizes.rounds.push(l.value);
    }
  }
  return { ok: true, value: s };
}

// src-luck-3057fb8/packages/luck/src/timeline.ts
var totalDiceRounds = (s) => s.rounds * s.diceRounds;
var roundOf = (s, g) => Math.floor(g / s.diceRounds) + 1;
var isLastOfRound = (s, g) => g % s.diceRounds === s.diceRounds - 1;
var diceOpenMs = (s, startMs, g) => startMs + g * (s.windowSecs + s.revealSecs) * 1000 + Math.floor(g / s.diceRounds) * s.breakSecs * 1000;
var windowCloseMs = (s, startMs, g) => diceOpenMs(s, startMs, g) + s.windowSecs * 1000;
var revealEndMs = (s, startMs, g) => windowCloseMs(s, startMs, g) + s.revealSecs * 1000;
var gameEndMs = (s, startMs) => revealEndMs(s, startMs, totalDiceRounds(s) - 1);
var beaconDueMs = (s, startMs, i) => i % 2 === 0 ? diceOpenMs(s, startMs, i / 2) : windowCloseMs(s, startMs, (i - 1) / 2);
function phaseAt(s, startMs, now) {
  if (now < startMs)
    return { kind: "before" };
  if (now >= gameEndMs(s, startMs))
    return { kind: "over" };
  const slot = (s.windowSecs + s.revealSecs) * 1000;
  const roundMs = s.diceRounds * slot + s.breakSecs * 1000;
  const r = Math.min(s.rounds - 1, Math.floor((now - startMs) / roundMs));
  const inRound = now - startMs - r * roundMs;
  if (inRound >= s.diceRounds * slot)
    return { kind: "break", afterRound: r + 1, endsMs: startMs + (r + 1) * roundMs };
  const d = Math.floor(inRound / slot), g = r * s.diceRounds + d;
  return inRound - d * slot < s.windowSecs * 1000 ? { kind: "window", g, closesMs: windowCloseMs(s, startMs, g) } : { kind: "reveal", g, endsMs: revealEndMs(s, startMs, g) };
}

// src-luck-3057fb8/packages/luck/src/engine.ts
var targetOf = async (gameId, g, beaconA) => 1 + await below(`LBC-TARGET|${gameId}|${g}|${beaconA}`, "t", 6);
var diceOf = async (gameId, seat, g, beaconB) => 1 + await below(`LBC-DICE|${gameId}|${seat}|${g}|${beaconB}`, "d", 6);
var scoreOf = (target, dice) => dice === target ? target : 0;
var fateOf = (gameId, seat, label, beacon) => sha256Hex(`LBC-FATE|${gameId}|${label}|${seat}|${beacon}`);
var emptyTally = (seat, nf = false) => nf ? { seat, points: 0, hits: 0, best: 0, reachedAt: -1, nf: true, fives: 0 } : { seat, points: 0, hits: 0, best: 0, reachedAt: -1 };
var nfPoints = (target, dice) => {
  const d = Math.abs(target - dice);
  return d === 0 ? 10 : d === 1 ? 5 : d === 2 ? 3 : 1;
};
function addNf(t, g, pts) {
  t.points += pts;
  if (pts === 10)
    t.hits++;
  if (pts === 5)
    t.fives = (t.fives ?? 0) + 1;
  t.reachedAt = g;
}
function addHit(t, g, target) {
  t.points += target;
  t.hits++;
  if (target > t.best)
    t.best = target;
  t.reachedAt = g;
}
var MEASURE_WORDS = { points: "points", best: "the highest single hit", hits: "the most hits", earliest: "who reached the score first", fate: "fate (a number from the public beacon)", exact: "the most exact hits", fives: "the most 5-point hits" };
function cmpNumeric(a, b) {
  if (a.nf)
    return b.points - a.points || b.hits - a.hits || (b.fives ?? 0) - (a.fives ?? 0) || a.reachedAt - b.reachedAt;
  return b.points - a.points || b.best - a.best || b.hits - a.hits || a.reachedAt - b.reachedAt;
}
function measureBetween(a, b) {
  if (a.nf)
    return a.points !== b.points ? "points" : a.hits !== b.hits ? "exact" : (a.fives ?? 0) !== (b.fives ?? 0) ? "fives" : a.reachedAt !== b.reachedAt ? "earliest" : "fate";
  return a.points !== b.points ? "points" : a.best !== b.best ? "best" : a.hits !== b.hits ? "hits" : a.reachedAt !== b.reachedAt ? "earliest" : "fate";
}
async function rankTop(gameId, label, beacon, tallies, top = TOP_LIST) {
  const sorted = [...tallies].sort((a, b) => cmpNumeric(a, b) || a.seat - b.seat);
  const n = Math.min(top, sorted.length);
  let end = n;
  while (end < sorted.length && end > 0 && cmpNumeric(sorted[end - 1], sorted[end]) === 0)
    end++;
  const head = sorted.slice(0, end);
  const out = [];
  for (let i = 0;i < head.length; ) {
    let j = i + 1;
    while (j < head.length && cmpNumeric(head[i], head[j]) === 0)
      j++;
    const group = head.slice(i, j);
    if (group.length > 1) {
      const f = new Map;
      for (const t of group)
        f.set(t.seat, await fateOf(gameId, t.seat, label, beacon));
      group.sort((a, b) => f.get(a.seat) < f.get(b.seat) ? -1 : f.get(a.seat) > f.get(b.seat) ? 1 : a.seat - b.seat);
    }
    out.push(...group);
    i = j;
  }
  const ranked = [];
  for (let i = 0;i < n; i++) {
    const t = out[i], prev = out[i - 1], next = out[i + 1];
    const tiedPrev = prev && prev.points === t.points, tiedNext = next && next.points === t.points;
    let decidedBy = null, line = "";
    if (tiedPrev || tiedNext) {
      const m = tiedPrev ? measureBetween(prev, t) : measureBetween(t, next);
      decidedBy = m;
      line = `Tied on ${t.points} point${t.points === 1 ? "" : "s"}; decided by ${MEASURE_WORDS[m]}.`;
    }
    ranked.push({ place: i + 1, seat: t.seat, points: t.points, hits: t.hits, best: t.best, reachedAt: t.reachedAt, decidedBy, line });
  }
  return ranked;
}
function standingOf(tallies, seat) {
  const me = tallies[seat];
  if (!me)
    return { ahead: 0, of: tallies.length, percent: 100 };
  let ahead = 0;
  for (const t of tallies)
    if (t !== me && cmpNumeric(t, me) < 0)
      ahead++;
  return { ahead, of: tallies.length, percent: Math.max(1, Math.ceil((ahead + 1) / Math.max(1, tallies.length) * 100)) };
}

class LuckGame {
  gameId;
  seats;
  roundTallies = [];
  total;
  results = [];
  lastBeacon = [];
  next = 0;
  latestB = "";
  cfg;
  constructor(gameId, settings, seats) {
    this.gameId = gameId;
    this.seats = seats;
    this.cfg = settings;
    this.total = Array.from({ length: seats }, (_, i) => emptyTally(i, settings.newFlow === true));
    for (let r = 0;r < settings.rounds; r++)
      this.roundTallies.push(Array.from({ length: seats }, (_, i) => emptyTally(i, settings.newFlow === true)));
  }
  get settings() {
    return this.cfg;
  }
  get done() {
    return this.next;
  }
  get finished() {
    return this.next >= totalDiceRounds(this.cfg);
  }
  endAfterRound(n) {
    if (!Number.isInteger(n) || n < 1 || n >= this.cfg.rounds || n * this.cfg.diceRounds < this.next)
      return false;
    this.cfg = { ...this.cfg, rounds: n };
    return true;
  }
  async addDiceRound(g, beaconA, beaconB, pressed) {
    if (g !== this.next)
      throw new Error(`dice round ${g} is out of order (expected ${this.next})`);
    if (!beaconA || !beaconB)
      throw new Error("both beacon values are needed");
    const s = this.cfg, r = roundOf(s, g);
    const target = await targetOf(this.gameId, g, beaconA);
    const dice = new Uint8Array(this.seats), points = new Uint8Array(this.seats);
    const rt = this.roundTallies[r - 1];
    for (let seat = 0;seat < this.seats; seat++) {
      const d = await diceOf(this.gameId, seat, g, beaconB);
      dice[seat] = d;
      if (s.newFlow) {
        const pt = pressed && !pressed.has(seat) ? 0 : nfPoints(target, d);
        points[seat] = pt;
        addNf(this.total[seat], g, pt);
        addNf(rt[seat], g, pt);
      } else if (d === target) {
        points[seat] = target;
        addHit(this.total[seat], g, target);
        addHit(rt[seat], g, target);
      }
    }
    if (isLastOfRound(s, g))
      this.lastBeacon[r - 1] = beaconB;
    this.next++;
    this.latestB = beaconB;
    const res = { g, round: r, target, dice, points };
    this.results.push(res);
    return res;
  }
  async roundRanking(round, top = TOP_LIST) {
    const b = this.lastBeacon[round - 1];
    if (b === undefined)
      throw new Error(`round ${round} is not finished`);
    return rankTop(this.gameId, `round-${round}`, b, this.roundTallies[round - 1], top);
  }
  async overallRanking(top = TOP_LIST) {
    if (this.next === 0)
      throw new Error("nothing has been played");
    return rankTop(this.gameId, "overall", this.latestB, this.total, top);
  }
}
function assignPrizes(settings, rounds, overall) {
  const wins = [];
  const won = new Set;
  const one = (name, list, texts) => {
    let at = 0;
    for (let place = 1;place <= Math.min(PLACES, texts.length); place++) {
      const text = texts[place - 1];
      if (!text) {
        at++;
        continue;
      }
      let pick;
      if (settings.oneWinPerPlayer) {
        while (at < list.length && won.has(list[at].seat))
          at++;
        pick = list[at];
        at++;
      } else {
        pick = list[place - 1];
        at = place;
      }
      if (!pick)
        continue;
      won.add(pick.seat);
      wins.push({ ranking: name, place, seat: pick.seat, prize: text });
    }
  };
  if (settings.prizeMode !== "overall")
    rounds.forEach((r, i) => one(`round-${i + 1}`, r, settings.prizes.rounds[i] ?? []));
  if (settings.prizeMode !== "rounds")
    one("overall", overall, settings.prizes.overall);
  return wins;
}
// src-luck-3057fb8/apps/edge/src/luck.ts
var LUCK_PRESS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS luck_press (eid TEXT NOT NULL, pid TEXT NOT NULL, g INTEGER NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, pid, g))`
];
var LUCK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS luck_t (eid TEXT PRIMARY KEY, commit_hash TEXT NOT NULL, secret TEXT, state TEXT NOT NULL DEFAULT 'open', opts TEXT, seed TEXT, players INTEGER, start_ms INTEGER, end_ms INTEGER, result TEXT, ended_ms INTEGER)`,
  `CREATE TABLE IF NOT EXISTS luck_p (eid TEXT NOT NULL, pid TEXT NOT NULL, seat INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY (eid, pid))`,
  `CREATE INDEX IF NOT EXISTS luck_p_seat ON luck_p (eid, seat)`,
  `CREATE TABLE IF NOT EXISTS luck_v (eid TEXT NOT NULL, pid TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, pid))`
];
var MAX_MS = 6 * 3600000;
var NO_AGREEMENT_MS = 10 * 60000;
var BEACON_BATCH = 60;
var json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
var sha = (s) => sha256Hex(s);
var settingsOf = (t) => JSON.parse(t.opts ?? "{}");
var newSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
var commitOf = (secret) => sha(`LBC-COMMIT|${secret}`);
var rosterHash = (pids) => sha(`LBC-ROSTER|${[...pids].sort().join(",")}`);
var seedOf = async (secret, eid, pids) => sha(`LBC-SEED|${secret}|${eid}|${await rosterHash(pids)}`);
var beaconValue = (seed, i) => sha(`LBC-BEACON|${seed}|${i}`);
async function ensureL(env, eid) {
  const have = await env.DB.prepare("SELECT * FROM luck_t WHERE eid=?").bind(eid).first();
  if (have)
    return have;
  const secret = newSecret(), commit = await commitOf(secret);
  await env.DB.prepare("INSERT OR IGNORE INTO luck_t(eid,commit_hash,secret) VALUES(?,?,?)").bind(eid, commit, secret).run();
  return await env.DB.prepare("SELECT * FROM luck_t WHERE eid=?").bind(eid).first();
}
function endBoundLuck(startMs, t) {
  return t?.ended_ms ? t.ended_ms + 60000 : t?.end_ms ? t.end_ms + NO_AGREEMENT_MS + 60000 : startMs + MAX_MS;
}
var cleanName = (n) => String(n ?? "").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 24) || "Player";
function normalizeResult(x, players, rounds) {
  const lines = (a) => {
    if (!Array.isArray(a) || a.length < 1 || a.length > TOP_LIST)
      return null;
    const out = [];
    for (const r of a) {
      if (!r || !Number.isInteger(r.seat) || r.seat < 0 || r.seat >= players || !Number.isInteger(r.points) || r.points < 0 || r.points > 6 * 400 || !Number.isInteger(r.hits) || r.hits < 0 || !Number.isInteger(r.best) || r.best < 0 || r.best > 6)
        return null;
      out.push({ seat: r.seat, points: r.points, hits: r.hits, best: r.best, line: typeof r.line === "string" ? r.line.slice(0, 120) : "" });
    }
    return new Set(out.map((o) => o.seat)).size === out.length ? out : null;
  };
  const overall = lines(x?.overall);
  if (!overall)
    return null;
  if (!Array.isArray(x?.rounds) || x.rounds.length !== rounds)
    return null;
  const rs = [];
  for (const r of x.rounds) {
    const l = lines(r);
    if (!l)
      return null;
    rs.push(l);
  }
  return { overall, rounds: rs };
}
var quorumFor = (players) => Math.min(players, Math.max(3, Math.ceil(players * 0.05)));
var PODIUM = ["first", "second", "third", "fourth", "fifth"];
async function settleVotes(env, t, now) {
  if (t.state !== "running")
    return t;
  const players = t.players ?? 0, q = quorumFor(players);
  const g = await env.DB.prepare("SELECT digest, COUNT(*) AS n FROM luck_v WHERE eid=? GROUP BY digest ORDER BY n DESC LIMIT 2").bind(t.eid).all();
  const [top, second] = g.results ?? [];
  if (top && top.n >= q && top.n > (second?.n ?? 0)) {
    const row = await env.DB.prepare("SELECT payload FROM luck_v WHERE eid=? AND digest=? LIMIT 1").bind(t.eid, top.digest).first();
    const res = JSON.parse(row.payload);
    const endMs = Math.max(t.end_ms ?? 0, now);
    const stmts = [env.DB.prepare("UPDATE luck_t SET state='done', result=?, ended_ms=? WHERE eid=? AND state='running'").bind(row.payload, endMs, t.eid)];
    for (let i = 0;i < PODIUM.length; i++) {
      const w = res.overall[i];
      if (!w)
        continue;
      const who = await env.DB.prepare("SELECT pid FROM luck_p WHERE eid=? AND seat=?").bind(t.eid, w.seat).first();
      if (!who)
        continue;
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settled(eid,pattern,ordinal,round,idx,pids) VALUES(?,?,?,?,?,?)").bind(t.eid, PODIUM[i], 1, 1, 0, JSON.stringify([who.pid])));
      const shellSeat = parseInt(who.pid, 10);
      if (Number.isFinite(shellSeat))
        stmts.push(env.DB.prepare("INSERT OR REPLACE INTO winner(eid,round,pattern,ordinal,seat,idx,at_ms,src) VALUES(?,?,?,?,?,?,?,?)").bind(t.eid, 1, PODIUM[i], 1, shellSeat, 0, endMs, "phones"));
    }
    stmts.push(env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'phones') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='phones' WHERE life.purged_ms IS NULL").bind(t.eid, endMs));
    await env.DB.batch(stmts);
    return await env.DB.prepare("SELECT * FROM luck_t WHERE eid=?").bind(t.eid).first();
  }
  if (t.end_ms && now > t.end_ms + NO_AGREEMENT_MS) {
    await env.DB.prepare("UPDATE luck_t SET state='done', ended_ms=? WHERE eid=? AND state='running'").bind(t.end_ms + NO_AGREEMENT_MS, t.eid).run();
    return await env.DB.prepare("SELECT * FROM luck_t WHERE eid=?").bind(t.eid).first();
  }
  return t;
}
async function luckTick(env, now) {
  let n = 0;
  const ts = await env.DB.prepare("SELECT * FROM luck_t WHERE state='running' AND end_ms IS NOT NULL AND end_ms<? LIMIT 200").bind(now).all();
  for (const t of ts.results ?? []) {
    const after = await settleVotes(env, t, now);
    if (after.state === "done")
      n++;
  }
  return n;
}
async function beginGame(c, t, s, startMs) {
  const { env, now, eid } = c;
  const rows = await env.DB.prepare("SELECT p.pid AS pid, p.pii AS pii, s.blocked AS blocked FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=? ORDER BY p.pid").bind(eid).all();
  const players = [];
  for (const r of rows.results ?? []) {
    if (r.blocked)
      continue;
    players.push({ pid: r.pid, name: cleanName(await c.openName(r.pii)) });
  }
  if (players.length < 2)
    return json({ error: `A game needs at least 2 players. ${players.length} joined.`, code: "too-few", joined: players.length }, 409);
  if (!await c.spend(env, now, players.length * 2 + 8))
    return c.BUSY();
  const endMs = gameEndMs(s, startMs);
  const seed = await seedOf(t.secret, c.eid, players.map((p) => p.pid));
  const stmts = [env.DB.prepare("UPDATE luck_t SET state='running', opts=?, seed=?, players=?, start_ms=?, end_ms=? WHERE eid=? AND state='open'").bind(JSON.stringify(s), seed, players.length, startMs, endMs, eid)];
  players.forEach((p, i) => stmts.push(env.DB.prepare("INSERT OR REPLACE INTO luck_p(eid,pid,seat,name) VALUES(?,?,?,?)").bind(eid, p.pid, i, p.name)));
  for (let i = 0;i < stmts.length; i += 90)
    await env.DB.batch(stmts.slice(i, i + 90));
  return json({ ok: true, players: players.length, startMs, endMs, diceRounds: totalDiceRounds(s), commit: t.commit_hash, secretShownAt: "reveal" });
}
var WAITING_ROOM_MS = 120000;
async function playerOf(c, pid, device) {
  if (typeof pid !== "string" || typeof device !== "string" || !/^[0-9a-f]{16,64}$/.test(device))
    return json({ error: "Open the game link on your own phone." }, 400);
  const seat = await c.env.DB.prepare("SELECT s.dev AS dev, s.blocked AS blocked FROM seat s WHERE s.eid=? AND s.pid=?").bind(c.eid, pid).first();
  if (!seat)
    return json({ error: "You do not seem to be in this game." }, 403);
  if (seat.blocked)
    return json({ error: "You were removed from this game by the organizer.", code: "removed" }, 403);
  if (!seat.dev || seat.dev !== (await sha(`dev|${c.eid}|${device}`)).slice(0, 32))
    return json({ error: "This place is on another phone.", code: "other-phone" }, 403);
  return { pid };
}
async function luckRoute(c) {
  const { env, req, now, eid, sub } = c;
  if (c.gate)
    return c.gate;
  const method = req.method;
  let t = await ensureL(env, eid);
  t = await settleVotes(env, t, now);
  if (t.state === "open") {
    const { pendingStartMs, ...o } = JSON.parse(t.opts ?? "{}");
    if (pendingStartMs && now >= pendingStartMs) {
      const r = await beginGame(c, t, o, pendingStartMs);
      if (r.status === 409)
        await env.DB.prepare("UPDATE luck_t SET opts=? WHERE eid=? AND state='open'").bind(JSON.stringify(o), eid).run();
      t = await ensureL(env, eid);
    }
  }
  if (sub === "tick" && method === "POST") {
    if (!c.allowed)
      return json({ error: "That is not open to this sign-in." }, 403);
    return json({ ok: true, closed: await luckTick(env, now) });
  }
  if (sub === "start" && method === "POST") {
    if (!c.allowed)
      return json({ error: "Only the Organizer or a Host can start the game." }, 403);
    if (t.state !== "open")
      return json({ error: "The game has already started.", code: "started" }, 409);
    const pend = JSON.parse(t.opts ?? "{}").pendingStartMs;
    if (pend)
      return json({ ok: true, pending: true, startMs: pend });
    const b = await c.body(req, 4096) ?? {};
    const parsed = parseSettings(b.settings ?? b);
    if (!parsed.ok)
      return json({ error: parsed.error }, 400);
    if (parsed.value.newFlow) {
      const startMs = now + WAITING_ROOM_MS;
      await env.DB.prepare("UPDATE luck_t SET opts=? WHERE eid=? AND state='open'").bind(JSON.stringify({ ...parsed.value, pendingStartMs: startMs }), eid).run();
      return json({ ok: true, pending: true, startMs });
    }
    const delay = b.delaySecs === undefined ? 20 : Number(b.delaySecs);
    if (!Number.isInteger(delay) || delay < 5 || delay > 3600)
      return json({ error: "The game starts 5 seconds to 1 hour after you press start." }, 400);
    return beginGame(c, t, parsed.value, now + delay * 1000);
  }
  if (sub === "end" && method === "POST") {
    if (!c.allowed)
      return json({ error: "Only the Organizer or a Host can end the game." }, 403);
    if (t.state === "open")
      return json({ error: "The game has not started yet.", code: "not-started" }, 409);
    const s = settingsOf(t), ph = phaseAt(s, t.start_ms, now);
    const was = JSON.parse(t.opts ?? "{}").endedAfterRound;
    if (was)
      return json({ ok: true, again: true, endedAfterRound: was, endsMs: t.end_ms });
    if (t.state === "done" || ph.kind === "over")
      return json({ error: "The game is over.", code: "over" }, 409);
    if (ph.kind === "before")
      return json({ error: "The first dice round has not begun yet. Nothing has been played.", code: "not-yet" }, 409);
    const cur = ph.kind === "break" ? ph.afterRound : roundOf(s, ph.g);
    if (cur >= s.rounds)
      return json({ ok: true, last: true, endedAfterRound: s.rounds, endsMs: t.end_ms, message: "This is the last round. The game ends by itself when it is over." });
    const s2 = { ...s, rounds: cur }, endMs = gameEndMs(s2, t.start_ms);
    if (!await c.spend(env, now, 2))
      return c.BUSY();
    await env.DB.prepare("UPDATE luck_t SET opts=?, end_ms=? WHERE eid=? AND state='running'").bind(JSON.stringify({ ...s2, endedAfterRound: cur }), endMs, eid).run();
    return json({ ok: true, endedAfterRound: cur, rounds: cur, endsMs: endMs });
  }
  if (sub === "reveal" && method === "GET") {
    if (t.state !== "done")
      return json({ commit: t.commit_hash, revealed: false, note: "The secret is shown when the game is over. This fingerprint cannot be changed after that." });
    return json({ commit: t.commit_hash, revealed: true, secret: t.secret, seed: t.seed, eid, how: "commit = sha256('LBC-COMMIT|' + secret); seed = sha256('LBC-SEED|' + secret + '|' + eid + '|' + sha256('LBC-ROSTER|' + sorted player ids joined by comma)); beacon value i = sha256('LBC-BEACON|' + seed + '|' + i). The game id used in every draw is the eid. The code is packages/luck/src." });
  }
  if (sub === "beacon" && method === "GET") {
    if (t.state === "open")
      return json({ error: "The game has not started.", code: "open" }, 409);
    const s = settingsOf(t), from = Math.max(0, Math.floor(Number(c.url.searchParams.get("from") ?? 0)) || 0), max = 2 * totalDiceRounds(s);
    const values = [];
    for (let i = from;i < max && values.length < BEACON_BATCH; i++) {
      if (beaconDueMs(s, t.start_ms, i) > now)
        break;
      values.push({ i, v: await beaconValue(t.seed, i) });
    }
    return json({ serverNow: now, from, values, next: from + values.length, total: max });
  }
  if (sub === "press" && method === "POST") {
    const b = await c.body(req, 1024);
    if (!b)
      return json({ error: "That press could not be read." }, 400);
    const who = await playerOf(c, b.pid, b.device);
    if (who instanceof Response)
      return who;
    if (t.state !== "running")
      return json({ error: "The game is not running.", code: t.state }, 409);
    const s = settingsOf(t);
    if (!s.newFlow)
      return json({ ok: true, ignored: true });
    const g = Number(b.g);
    if (!Number.isInteger(g) || g < 0 || g >= totalDiceRounds(s))
      return json({ error: "That round does not exist." }, 400);
    if (now < diceOpenMs(s, t.start_ms, g) || now > windowCloseMs(s, t.start_ms, g) + 1000)
      return json({ error: "The time to press is over.", code: "late" }, 409);
    if (!await c.spend(env, now, 2))
      return c.BUSY();
    await env.DB.prepare("INSERT OR IGNORE INTO luck_press(eid,pid,g,at_ms) VALUES(?,?,?,?)").bind(eid, who.pid, g, now).run();
    return json({ ok: true });
  }
  if (sub === "presses" && method === "GET") {
    if (t.state === "open")
      return json({ error: "The game has not started.", code: "open" }, 409);
    const s = settingsOf(t), g = Number(c.url.searchParams.get("g"));
    if (!s.newFlow)
      return json({ newFlow: false });
    if (!Number.isInteger(g) || g < 0 || g >= totalDiceRounds(s))
      return json({ error: "That round does not exist." }, 400);
    if (now < windowCloseMs(s, t.start_ms, g) + 1000)
      return json({ error: "The press window is still open.", code: "open-window" }, 409);
    const r = await env.DB.prepare("SELECT p.seat AS seat FROM luck_press x JOIN luck_p p ON p.eid=x.eid AND p.pid=x.pid WHERE x.eid=? AND x.g=? ORDER BY p.seat").bind(eid, g).all();
    return json({ g, seats: (r.results ?? []).map((x) => x.seat) });
  }
  if (sub === "seats" && method === "GET") {
    if (t.state === "open")
      return json({ error: "The list of players is not closed yet.", code: "open" }, 409);
    const r = await env.DB.prepare("SELECT seat, name FROM luck_p WHERE eid=? ORDER BY seat").bind(eid).all();
    return json({ players: t.players, seats: (r.results ?? []).map((x) => [x.seat, x.name]) });
  }
  if (sub === "vote" && method === "POST") {
    const b = await c.body(req, 49152);
    if (!b)
      return json({ error: "Bad result." }, 400);
    const who = await playerOf(c, b.pid, b.device);
    if (who instanceof Response)
      return who;
    if (t.state === "open")
      return json({ error: "The game has not started.", code: "open" }, 409);
    if (t.state === "done")
      return json({ ok: true, already: true });
    const s = settingsOf(t);
    if (now < gameEndMs(s, t.start_ms))
      return json({ error: "The game is not over yet.", code: "running" }, 409);
    const inGame = await env.DB.prepare("SELECT 1 AS x FROM luck_p WHERE eid=? AND pid=?").bind(eid, who.pid).first();
    if (!inGame)
      return json({ error: "The list closed before you joined. You can watch.", code: "watching" }, 409);
    const res = normalizeResult(b.result, t.players ?? 0, s.rounds);
    if (!res)
      return json({ error: "That result is not valid.", code: "bad-result" }, 400);
    const payload = JSON.stringify(res), digest = await sha(payload);
    await env.DB.prepare("INSERT INTO luck_v(eid,pid,digest,payload,at_ms) VALUES(?,?,?,?,?) ON CONFLICT(eid,pid) DO UPDATE SET digest=excluded.digest, payload=excluded.payload, at_ms=excluded.at_ms").bind(eid, who.pid, digest, payload, now).run();
    t = await settleVotes(env, t, now);
    return json({ ok: true, agreed: t.state === "done" && !!t.result });
  }
  if (sub === "rank" && method === "GET") {
    const votes = (await env.DB.prepare("SELECT COUNT(*) AS n FROM luck_v WHERE eid=?").bind(eid).first())?.n ?? 0;
    if (!t.result)
      return json({ done: t.state === "done", agreed: false, votes, quorum: quorumFor(t.players ?? 0) });
    const res = JSON.parse(t.result);
    const seats = new Set([...res.overall.map((x) => x.seat), ...res.rounds.flat().map((x) => x.seat)]);
    const names = new Map;
    const want = [...seats];
    for (let i = 0;i < want.length; i += 80) {
      const part = want.slice(i, i + 80);
      const r = await env.DB.prepare(`SELECT seat, name FROM luck_p WHERE eid=? AND seat IN (${part.map(() => "?").join(",")})`).bind(eid, ...part).all();
      for (const x of r.results ?? [])
        names.set(x.seat, x.name);
    }
    const withName = (l) => l.map((x, i) => ({ place: i + 1, name: names.get(x.seat) ?? "-", points: x.points, hits: x.hits, best: x.best, line: x.line }));
    return json({ done: true, agreed: true, votes, overall: withName(res.overall), rounds: res.rounds.map(withName) });
  }
  if ((sub === "view" || sub === "me") && method === "GET") {
    const joined = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first())?.c ?? 0;
    let ann = null;
    {
      const a = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`ann/${eid}`).first();
      if (a) {
        try {
          const x = JSON.parse(a.v);
          if (typeof x?.id === "string" && typeof x?.text === "string" && x.text)
            ann = { id: x.id, text: x.text };
        } catch {}
      }
    }
    const head = { serverNow: now, ann, state: t.state, commit: t.commit_hash, joined, startMs: t.start_ms, endMs: t.end_ms, players: t.players, ...t.state !== "open" ? { settings: settingsOf(t) } : {}, agreed: !!t.result, endedAfterRound: JSON.parse(t.opts ?? "{}").endedAfterRound ?? null };
    if (sub === "view")
      return json(head);
    const q = c.url.searchParams, who = await playerOf(c, q.get("pid"), q.get("device"));
    if (who instanceof Response)
      return who;
    if (t.state === "open")
      return json({ ...head, phase: "waiting", message: "You are in. Waiting for the host to start." });
    const me = await env.DB.prepare("SELECT seat, name FROM luck_p WHERE eid=? AND pid=?").bind(eid, who.pid).first();
    if (!me)
      return json({ ...head, phase: "watching", message: "The list closed before you joined. You can watch." });
    return json({ ...head, phase: "playing", you: { seat: me.seat, name: me.name } });
  }
  return json({ error: "Not found" }, 404);
}
// src-luck-3057fb8/vendor/game-core/packages/wording/src/lines.ts
var TERMS_RETENTION = "All participant data is deleted within 24 hours after the game ends, except the winners' record.";
var ID_ONLY_LINE = "A game is played with only an employee ID.";
var DETAILS_LINE = "No other participant details are asked for.";
var AUTO_DELETE_LINE = "All participant data is auto-deleted within 24 hours after the game ends.";

// src-luck-3057fb8/vendor/game-core/packages/wording/src/legal.ts
var NAVIGATION_LINE = "Navigation data is collected to improve the games.";
var REPORT_LINE = "The game report is e-mailed to the Organizer and the Hosts within 3 hours after the game and is not stored.";
var GRIEVANCE_EMAIL = "hello@corporatetambola.com";
var LEGAL = [
  { id: "privacy", title: "Privacy", paragraphs: [
    ID_ONLY_LINE,
    DETAILS_LINE,
    TERMS_RETENTION,
    AUTO_DELETE_LINE,
    "The winners' record is kept for 365 days as the audit record of the game.",
    "The e-mail addresses of the Organizer and the Hosts are kept for invoices and payments.",
    REPORT_LINE,
    NAVIGATION_LINE
  ] },
  { id: "terms", title: "Terms and Conditions", paragraphs: [
    "These terms apply to the home page and to every game.",
    "Games are played for entertainment. The game software decides the winners from the rules of the game.",
    "The Organizer sets the game and the prizes, and chooses and invites the people who play. Prizes are given by the Organizer.",
    "Game details (settings, prizes, time and a result summary without personal details) are auto-deleted after 365 days.",
    "Invoices and the payment ledger are kept as tax records.",
    "A game report that cannot be delivered is held in encrypted form and sent again after 24, 36 and 72 hours. It is deleted on delivery or after the last try.",
    "These terms may change. The latest version is always on this page."
  ] },
  { id: "cookies", title: "Cookies and storage", paragraphs: [
    "The games use only first-party storage on the device, for settings such as the look and the language.",
    "No advertising cookies and no third-party trackers are used.",
    NAVIGATION_LINE,
    "A Global Privacy Control signal from the browser is respected: no navigation data is collected."
  ] },
  { id: "grievance", title: "Questions and complaints", paragraphs: [
    `Questions or complaints about data can be sent to ${GRIEVANCE_EMAIL}.`,
    "Each message gets a reply."
  ] }
];
var norm = (s) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
var LEGAL_FINGERPRINTS = LEGAL.flatMap((s) => s.paragraphs.filter((p) => p.length >= 40).map((p) => ({ id: s.id, text: norm(p) })));

// src-luck-3057fb8/vendor/game-core/packages/wording/src/documents.ts
var DOC_SECTION_IDS = ["terms", "payments", "privacy", "retention", "cookies", "processors", "grievance", "acceptable-use", "game-rules"];
var DOC_TITLES = {
  terms: "Terms and Conditions",
  payments: "Payments and Credit",
  privacy: "Privacy and Data",
  retention: "Data retention",
  cookies: "Cookies and navigation data",
  processors: "Companies that help run the service",
  grievance: "Grievance and contact",
  "acceptable-use": "Acceptable use and Legal Disclaimer",
  "game-rules": "Game rules"
};
var DOC_HOST = "https://home.corporatetambola.com";
var DOC_URL = `${DOC_HOST}/terms`;
var DOC_URLS = Object.fromEntries(DOC_SECTION_IDS.map((k) => [k, `${DOC_URL}#${k}`]));
var SELLER = "IT Services by Rajat Agarwal";
var CONTACT_EMAIL = "hello@corporatetambola.com";
var NOTHING_KEPT_LINES = ["No mobile number or e-mail address is taken or kept for taking part.", "All information about participants is deleted within 24 hours after the game.", "Only the winners' results, the game logs, the Organizer and Host details and the tax invoices are kept, for the periods in the table below."];
var sub = (id, heading, ...paragraphs) => ({ id, heading, paragraphs });
var SUBPROC = "Cloudflare hosts the website and keeps the database in its Asia-Pacific region. Resend sends e-mail to Organizers and Hosts. Razorpay takes the Organizer's payment, and the IT Services payment service records each payment for the invoice. Google is used only if an Organizer chooses to sign in with Google. A public source of random values is used for draws, and YouTube in privacy mode only if an Organizer adds a video.";
var DOCUMENT = [
  { id: "terms", title: DOC_TITLES.terms, subs: [
    sub("what", "What the service is", `Corporate Tambola and its sister games are software provided as a service by ${SELLER}, the trade name of Rajat Agarwal, a sole proprietorship in India (called IT Services here).`, "Each game is a separate, one-time service for a single game run. Nothing is sold for keeps: there is no perpetual licence, no transfer of ownership of the software and no subscription. Each new game is arranged and paid for on its own.", "The Organizer uses the software to run a game for the people the Organizer invites. IT Services is the software provider only. It does not organize, conduct or take part in any game, and it is not a party to any arrangement between an Organizer and a participant."),
    sub("who-plays", "Who plays", "The Organizer chooses and invites the people who play: people listed by employee ID. The Organizer is responsible for that choice and for the prizes."),
    sub("free-play", "Players pay nothing", "Participants pay nothing to play. The only charge is the Organizer's fee for the game, shown before payment. It is the price of the software service, and it is not a stake, an entry fee or the price of a chance.", "IT Services does not collect, hold or give any money or prize. Any prize is provided, funded and handed over by the Organizer."),
    sub("agree", "How these terms are agreed", "Continuing to use the service means agreeing to the Terms and Conditions, Privacy and Data, and the Game rules. Publishing a game is the Organizer's clear act of going ahead.", "The agreement is electronic and is valid as such under section 10A of the Information Technology Act, 2000. At sign-in and when a game is published, the version of this document, a fingerprint of the notice shown and the time are stored, and nothing else personal.", "These terms may change. The latest version is always on this page, with its version and date at the top. A change applies to games created after it is published."),
    sub("law", "Law and disputes", "Indian law applies. A dispute is first raised with the Grievance Officer (section 7). If it is not settled within 30 days, it goes to a sole arbitrator in India, in English, under the Arbitration and Conciliation Act, 1996. The courts in India have exclusive jurisdiction.", "This whole document is read together. If one part is found not to apply, the rest stays in force. The Organizer cannot pass on rights under these terms without written consent.")
  ] },
  { id: "payments", title: DOC_TITLES.payments, subs: [
    sub("what", "What is paid for", "One payment is for one game, for the group size chosen, at the price shown on the payment page. No commitment and no repeat charges.", "Building and publishing a game is free. A game that is not paid for simply does not begin, and nothing is charged."),
    sub("who", "Who is paid", `Payments go only to ${SELLER}, through Razorpay. Card, UPI and bank details stay with Razorpay. An invoice is issued for each payment.`),
    sub("credit", "Credit instead of a refund", "Once the payment is made, it stays with the game as credit for 365 days rather than being refunded. A paid game can be moved to any date within 365 days of payment, free of charge.", "A paid game can be cancelled until its start time. It then stays with the Organizer as credit for a new game of the same kind within the same 365 days from the date of payment. Unused credit lapses at the end of day 365, and an e-mail is sent before it lapses.", "Once the start time has passed, the game has started and keeps its time. A game that is stopped because it is not allowed (section 8) keeps no credit."),
    sub("wrong", "A failed, wrong or double payment", "If a payment fails or is cancelled, nothing is charged, the game stays unpaid and can be paid for again later. If money is taken but the game is not created, or a payment is taken twice or at a wrong amount, the extra or the whole amount is refunded in full.", `Write to ${CONTACT_EMAIL} with the subject Billing, the payment reference, the amount and the date. An approved refund is started within 7 working days to the original payment method.`, "If a paid game cannot run because of a fault in the software, it is moved free of charge. If it cannot be provided at all within the 365 days, the amount paid is refunded. A test payment is only for trying the payment and its invoice; it is not returned.")
  ] },
  { id: "privacy", title: DOC_TITLES.privacy, subs: [
    sub("short", "In short", ID_ONLY_LINE, DETAILS_LINE),
    sub("kept", "What is kept", ...NOTHING_KEPT_LINES),
    sub("use", "How a game uses data", "The Organizer sets up the game and decides who is invited, and participants join with an employee ID only.", "Participant data is used for that game only and is never shown to other participants.", "The Organizer decides why participant data is used. IT Services handles it only for the Organizer, as the Organizer's data processor under the Digital Personal Data Protection Act, 2023 (sections 2 and 8), as set out in section 6."),
    sub("after", "After the game", REPORT_LINE, "The report has the statistics, the game log, how the game was played and the winners in full. It has no row for any individual participant.", "The Organizer and the Hosts receive it. Co-hosts do not.", "If the e-mail bounces, the report is held in encrypted form and sent again after 24, 36 and 72 hours, and is deleted on delivery or after the last try.", "The Organizer can delete all participant data at any time from the console, once the game is over or if it was never published."),
    sub("rights", "Participant rights", "A participant can leave a game at any time, ask what data is held, ask for a correction or deletion (section 12 of the Act), or ask another person to use these rights for them (section 14).", `Write to ${CONTACT_EMAIL} with the subject Grievance, or use the game page. A request is answered within 7 days. A complaint can also go to the Data Protection Board of India.`),
    sub("laws", "Laws followed", "The service is designed to follow India's Digital Personal Data Protection Act, 2023 and its Rules, 2025, the EU General Data Protection Regulation and the California Consumer Privacy Act of the United States.", "Only the data a game needs is asked for, and it is kept for the shortest time that is practical, in line with Justice K.S. Puttaswamy (Retd.) v. Union of India, (2017) 10 SCC 1.")
  ] },
  { id: "retention", title: DOC_TITLES.retention, subs: [
    { id: "table", heading: "What is kept, and for how long", paragraphs: [
      "Each item is auto-deleted by timer as shown. Deleted means a person deletes it."
    ], table: [
      ["What", "How long", "Then"],
      ["Participant data, codes, invitation records and requests", "Within 24 hours after the game ends", "Auto-deleted"],
      ["A game that never starts: its participant data", "Within 24 hours after it was meant to end", "Auto-deleted"],
      ["Participant data, when the Organizer deletes it", "At once", "Deleted"],
      ["The winners' record: who won which prize place", "365 days", "Auto-deleted"],
      ["Details a winner confirms to receive a prize (Tambola, Bingo, Snakes and Ladders)", "365 days", "Auto-deleted"],
      ["Game settings, prizes, time and the result summary, without personal details; Tic Tac Toe and Luck by Chance results in numeric form only", "365 days after the game", "Auto-deleted"],
      ["Audit log of the game, without personal details", "365 days", "Auto-deleted"],
      ["Speed and error reports", "90 days", "Auto-deleted"],
      ["Mail log", "3 days", "Auto-deleted"],
      ["A game report held after a bounce", "Until delivered, or after the last try at 72 hours", "Deleted"],
      ["Organizer account details", "Until the Organizer closes the account", "Deleted"],
      ["Billing records", "Kept", "For audit and tax"]
    ] }
  ] },
  { id: "cookies", title: DOC_TITLES.cookies, subs: [
    sub("storage", "Cookies and storage", "The games use only first-party storage on the device, for settings such as the look and the language. No advertising cookies and no third-party trackers are used."),
    sub("navigation", "Navigation data", NAVIGATION_LINE, "A Global Privacy Control signal from the browser is respected: no navigation data is collected.")
  ] },
  { id: "processors", title: DOC_TITLES.processors, subs: [
    sub("companies", "Companies that help run the service", SUBPROC),
    sub("terms", "Data processing terms", "For participant data, the Organizer decides the purpose and the means, and IT Services processes the data only on the Organizer's instructions, under these terms as the contract that section 8 of the Digital Personal Data Protection Act, 2023 asks for. For the Organizer's own account, sign-in and billing data, IT Services decides how it is used.", "The companies that help work under contracts that keep the data confidential and secure. All data is encrypted in transit and at rest.", "Participant data is deleted as set out in section 4. Any incident that touches participant data is told to the Organizer without delay.")
  ] },
  { id: "grievance", title: DOC_TITLES.grievance, subs: [
    sub("officer", "Seller and Grievance Officer", `Seller: ${SELLER}, India.`, "Grievance Officer: Rajat Agarwal. E-mail " + CONTACT_EMAIL + " with the subject Grievance. Phone +91 96503 97480. Each message gets a reply within 7 days.", "The seller, the Grievance Officer and the payment policy are shown here as the Consumer Protection Act, 2019 and the Consumer Protection (E-Commerce) Rules, 2020 ask.")
  ] },
  { id: "acceptable-use", title: DOC_TITLES["acceptable-use"], subs: [
    sub("use", "Acceptable use", "The Organizer follows the law that applies to the game, charges no participant anything, links no game to betting, pooling of money or side bets, shares game links only with the people invited, and does not interfere with the fairness, randomness or sealed data of the software."),
    sub("stop", "Stopping a game", "A game or an account may be stopped, and a link disabled, when the service is misused, when the law, a court or an authority requires it, or on a court order, government notification or credible notice of unlawful use. This follows section 79 of the Information Technology Act, 2000 as read in Shreya Singhal v. Union of India, (2015) 5 SCC 1. Participants can report misuse to the Grievance Officer."),
    sub("provider", "Software provider only", "The software is provided as is, for entertainment. The Organizer runs the game, and the software follows the rules of the game. IT Services does not decide who plays."),
    sub("prizes", "Prizes and tax", "Prizes, if any, are the Organizer's own. The Organizer is responsible for their cost, delivery and any dispute about them with a participant. Gifts that are not cash are recommended.", "The Organizer, as the payer of a prize, deducts tax where the law asks, under section 393(3), Table Sl. No. 1 of the Income-tax Act, 2025 (formerly section 194B of the Income-tax Act, 1961), and pays the tax on a prize in kind before it is released. IT Services is not the payer, deductor or collector for any prize."),
    sub("availability", "Availability", "The service runs on the internet and on the participants' own devices. It is offered without a promise of uninterrupted use. IT Services is not responsible for interruptions of the internet, of a device or of a company that helps run the service, or for events beyond its control. If a fault in the software stops a paid game, section 2 applies."),
    sub("liability", "Limit of liability and Organizer's responsibility", "To the extent the law permits, the total liability of Rajat Agarwal and IT Services by Rajat Agarwal to an Organizer for any claim about a game is limited to the fee paid for that game. Nothing limits a liability that the law does not allow to be limited.", "The Organizer keeps IT Services and Rajat Agarwal free from any claim, loss or cost that arises from the Organizer's content, invitation lists, prizes, tax or use that is not allowed, to the extent permitted by the Indian Contract Act, 1872."),
    sub("ip", "Ownership", "The software (a computer programme under section 2(ffc) of the Copyright Act, 1957), the game rules, designs, text and names, and all rights in them, belong to Rajat Agarwal, trading as IT Services by Rajat Agarwal. The Organizer gets only the right to use the software for a paid game, as a service.", "Nobody may copy, change, resell or reverse-engineer the software, use automated access, or feed the pages, code, text, rules or designs to an AI system or another tool to copy or derive a similar product.")
  ] },
  { id: "game-rules", title: DOC_TITLES["game-rules"], subs: [
    sub("common", "Rules common to all games", "Each participant has one seat or entry in a game. An ID that already has a seat is not given a second one, and a full game does not take more people.", "A game starts by itself at its published time, or when the Organizer or a Host presses Start, as the Organizer chose. The Organizer or a Host can pause and resume the game. While a game is paused nothing counts down, and play continues from the same point. Co-hosts help but do not start or pause the game.", "The game software decides every win from the rules of the game. Neither the Organizer nor IT Services can add, remove or change a winner in the software. The result is final, apart from the correction of a demonstrable technical error."),
    sub("tambola", "Tambola", "Tambola is played with tickets. A participant presses Claim when a pattern is complete, and the software checks the claim against the numbers called. A correct claim wins the prize, and the first correct claim for a prize is the winner. A wrong claim does not stop the game."),
    sub("bingo", "Bingo", "Bingo is played with cards. Winners are worked out by the software from the public list of numbers called and the seats of the game, so no claim is needed. Where two cards complete a pattern on the same call, the software breaks the tie by a fixed public rule that nobody can change."),
    sub("tictactoe", "Tic Tac Toe", "Tic Tac Toe is played in rounds and stages after a waiting room of 2 minutes. The software pairs participants, and the result of each pair decides who goes on. A tie is played once more; after that the rules of the game decide. Prize places go to the last participants standing."),
    sub("snakes", "Snakes and Ladders", "Snakes and Ladders is played in rounds after a waiting room of 2 minutes, with the dice rolled by the software. A participant who is not playing in time is out of the next round. Prize places go to the last participants standing."),
    sub("luck", "Luck by Chance", "Luck by Chance is played in rounds after a waiting room of 2 minutes, decided by the software's throws. A tie is thrown again. Prize places go to the last participants standing."),
    sub("luckydraw", "Lucky Draw", "Lucky Draw has one entry per participant. Entry closes at the draw time. The winners are drawn by the software from the entries using a public value, so anyone with the entries and the value gets the same winners. Winners are shown to all, with the words You won.")
  ] }
];
var allDocParagraphs = () => DOCUMENT.flatMap((s) => s.subs.flatMap((u) => [...u.paragraphs, ...(u.table ?? []).slice(1).map((r) => r.join(", "))].map((text) => ({ section: s.id, sub: u.id, text }))));
var norm2 = (s) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
var FINGERPRINTS = allDocParagraphs().filter((p) => p.text.length >= 40).map((p) => ({ section: p.section, text: norm2(p.text) }));

// src-luck-3057fb8/vendor/game-core/packages/wording/src/consent.ts
var NOTICE_LINKS = ["terms", "privacy", "game-rules"].map((id) => ({ id, label: DOC_TITLES[id], href: DOC_URLS[id] }));
var NOTICE_TEXT = `By continuing, you agree to the ${DOC_TITLES.terms}, ${DOC_TITLES.privacy}, and ${DOC_TITLES["game-rules"]}.`;

// src-luck-3057fb8/apps/edge/src/pii.ts
var enc2 = new TextEncoder;
var dec = new TextDecoder;
var AAD = enc2.encode("corporate-luck-by-chance/pii/v1");
var keys = new Map;

// src-luck-3057fb8/apps/edge/src/phonekit.ts
var KNOWN_DIAL = new Set("1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 509 590 591 592 593 594 595 596 597 598 599 670 673 674 675 676 677 678 679 680 682 685 686 687 688 689 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998".split(" "));

// src-luck-3057fb8/apps/edge/src/checkin.ts
var CHECKIN_FROM_MS = Date.UTC(2026, 9, 23, 10, 0, 0);
var CHECKIN_OPENS_BEFORE_MS = 5 * 60000;
var CHECKIN_LOCK_MS = 10 * 60000;
var prefixEnd = (prefix) => prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
var checkinRequired = (_e) => false;
var checkinOpensMs = (startMs) => startMs - CHECKIN_OPENS_BEFORE_MS;
var seatOfPidText = (pid) => {
  const m = /^(\d{1,6})x/.exec(String(pid));
  return m ? Number(m[1]) : null;
};
var ticketId = (eid, seat) => `${eid}-T${String(seat).padStart(4, "0")}`;
function perm10k(keyHex, x) {
  const kb = Array.from({ length: 32 }, (_, i) => parseInt(keyHex.slice(i * 2, i * 2 + 2), 16));
  const f = (r, h) => kb[(r * 8 + (h & 7)) % 32] * 131 + kb[(r * 5 + 3 + (h >> 3)) % 32] * 29 + h * 17 + r * 101 & 127;
  let v = x % 16384;
  do {
    let L = v >> 7, R = v & 127;
    for (let r = 0;r < 6; r++) {
      const nL = R, nR = L ^ f(r, R);
      L = nL;
      R = nR;
    }
    v = L << 7 | R;
  } while (v >= 1e4);
  return v;
}

// src-luck-3057fb8/apps/edge/src/idclean.ts
var BLANKS = "\\s\\u200B-\\u200D\\u2060\\uFEFF\\u0085\\u2028\\u2029";
var BLANKS_G = new RegExp("[" + BLANKS + "]+", "g");
var BLANK_ONE = new RegExp("[" + BLANKS + "]");
// src-luck-3057fb8/apps/edge/src/people.ts
var COHOST_FROM = 1e9;
var HOST_FROM = 1500000000;
var ORG_FROM = 1900000000;
var COHOST_LIMIT_DEFAULT = 100;
var encoder = new TextEncoder;
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
var listCount = async (db, eid, inviter) => (await db.prepare("SELECT COUNT(*) AS c FROM person WHERE eid=? AND inviter=? AND status<>'removed' AND role IS NULL").bind(eid, inviter).first())?.c ?? 0;
async function limitOfInviter(c, inviter) {
  if (inviter.startsWith("c:"))
    return c.e.cohost_limit ?? COHOST_LIMIT_DEFAULT;
  if (inviter.startsWith("s:")) {
    const s = await c.env.DB.prepare("SELECT role FROM seat WHERE eid=? AND seq=?").bind(c.eid, Number(inviter.slice(2))).first();
    return s?.role ? null : c.invites.per;
  }
  return null;
}
async function chainOf(db, eid, inviter) {
  const ids = [inviter];
  if (inviter.startsWith("s:")) {
    const up = await db.prepare("SELECT p.inviter AS inviter FROM seat s JOIN person p ON p.eid=s.eid AND p.ph=s.ph WHERE s.eid=? AND s.seq=?").bind(eid, Number(inviter.slice(2))).first();
    if (up?.inviter && !ids.includes(up.inviter))
      ids.push(up.inviter);
  }
  return "," + ids.join(",") + ",";
}
// src-luck-3057fb8/packages/beacon/src/config.ts
var PRIZE_HOUSES = [
  { id: "first", label: "1st place", how: "The most points. If points are equal: the highest single hit, then the most hits, then who reached the score first, then a public random number.", max: 1, kind: "set", dflt: true, squares: "1st" },
  { id: "second", label: "2nd place", how: "The second most points, by the same order.", max: 1, kind: "set", dflt: true, squares: "2nd" },
  { id: "third", label: "3rd place", how: "The third most points, by the same order.", max: 1, kind: "set", dflt: true, squares: "3rd" },
  { id: "fourth", label: "4th place", how: "The fourth most points, by the same order.", max: 1, kind: "set", dflt: true, squares: "4th" },
  { id: "fifth", label: "5th place", how: "The fifth most points, by the same order.", max: 1, kind: "set", dflt: true, squares: "5th" }
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
var MAX_INVITES_PER_PERSON = 10;
var defaultInvites = () => ({ on: false, per: 4, cats: ["family", "colleagues"] });
var VERIFY_MODES = ["mobile", "id", "either", "both"];
var MAX_ROUNDS2 = 5;
var MAX_CALLS = 75;
var GRACE_ROUNDS = 40;
var PATTERN_ORDER = PRIZE_HOUSES.filter((h) => h.dflt).map((h) => h.id);
var MAX_MID_PER_TICKET = 3;
var maxMidFor = (tickets) => MAX_MID_PER_TICKET * tickets;
var maxEdgeFor = (tickets) => tickets;
var brandMomentsFor = (tickets) => 5 * tickets;
var OPENING_WINDOW_SECONDS = GRACE_ROUNDS * 3;
var autoAfter = (n, k) => Math.min(MAX_CALLS - 1, Math.max(1, Math.round(MAX_CALLS * k / (n + 1))));
var MAX_REWARD_LINES = Math.max(30, PRIZE_HOUSES.reduce((n, h) => n + h.max, 0));
var MAX_ORDINAL = Math.max(LEGACY_MAX_ORDINAL, ...PRIZE_HOUSES.map((h) => h.max));
var KINDS = new Set(["file", "youtube", "slides", "speech", "lucky"]);
var LUCKY_WINNERS = [1, 3, 5, 10];
var defaultRewards = () => PATTERN_ORDER.map((pattern) => ({ pattern, scope: "ticket", ordinal: 1, text: "" }));
var defaultCfg = () => ({ tickets: 1, rewards: defaultRewards(), breaks: [], rounds: 1, invites: defaultInvites(), opening: [], closing: [] });
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
  const cfg = { tickets: base.tickets, rewards: base.rewards, breaks: base.breaks, rounds: base.rounds ?? 1, invites: base.invites ?? defaultInvites(), opening: base.opening ?? [], closing: base.closing ?? [], ...base.name ? { name: base.name } : {}, ...base.brand ? { brand: base.brand } : {}, ...base.mark ? { mark: base.mark } : {}, ...base.join ? { join: base.join } : {}, ...base.tz ? { tz: base.tz } : {}, ...base.verify ? { verify: base.verify } : {}, ...base.employeesOnly ? { employeesOnly: true } : {}, ...base.idKind === "email" && base.verify === "id" ? { idKind: "email" } : {} };
  if (input.rounds !== undefined) {
    if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > MAX_ROUNDS2)
      return { ok: false, error: `The number of rounds is a whole number from 1 to ${MAX_ROUNDS2}.` };
    cfg.rounds = input.rounds;
  }
  if (input.tickets !== undefined) {
    if (input.tickets !== 1 && input.tickets !== 2)
      return { ok: false, error: "The tickets setting is 1 or 2." };
    cfg.tickets = input.tickets;
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
        return { ok: false, error: "Unknown place in the rewards." };
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
        return { ok: false, error: "A 2nd, 3rd... reward needs the one before it. Note that sending rewards REPLACES the whole list, so send every reward line each time, with ordinals starting at 1 for each place." };
    cfg.rewards = out;
  }
  if (cfg.rewards.length === 0)
    cfg.rewards = defaultRewards();
  if (input.breaks !== undefined) {
    if (!Array.isArray(input.breaks) || input.breaks.length > maxMidFor(cfg.tickets))
      return { ok: false, error: `At most ${maxMidFor(cfg.tickets)} brand moments during the game.` };
    const out = [];
    for (const b of input.breaks) {
      const auto = b?.auto === true || b?.after === undefined || b?.after === null || b?.after === "";
      const after = auto ? 0 : b?.after, seconds = auto && (b?.seconds === undefined || b?.seconds === null || b?.seconds === "") ? 60 : b?.seconds, kind = b?.kind;
      if (!auto && (!Number.isInteger(after) || after < 1 || after > MAX_CALLS - 1))
        return { ok: false, error: `A break starts at a whole number from 1 to ${MAX_CALLS - 1}.` };
      if (!Number.isInteger(seconds) || seconds < 15 || seconds > 600 || seconds % 3)
        return { ok: false, error: "A break lasts 15 to 600 seconds, in steps of 3." };
      if (!KINDS.has(kind))
        return { ok: false, error: "A break is a file, a YouTube link, slides, a speech or a prize draw." };
      const winners = kind === "lucky" ? b?.winners === undefined ? 3 : b.winners : undefined;
      if (kind === "lucky" && !LUCKY_WINNERS.includes(winners))
        return { ok: false, error: "A prize draw picks 1, 3, 5 or 10 people." };
      const style = kind === "lucky" ? b?.style === undefined || b.style === "" ? "draw" : b.style : undefined;
      if (kind === "lucky" && style !== "draw" && style !== "scratch")
        return { ok: false, error: "A prize draw is shown as a plain draw or as a scratch reveal." };
      if (kind !== "lucky" && b?.style !== undefined && b.style !== "")
        return { ok: false, error: "Only a prize draw has a style." };
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
        return { ok: false, error: "A prize draw has no link." };
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
        return { ok: false, error: "Two breaks cannot start at the same number." };
    cfg.breaks = out;
  }
  if (input.mark !== undefined) {
    if (input.mark !== "auto" && input.mark !== "tap")
      return { ok: false, error: 'Marking is "auto" or "tap".' };
    if (input.mark === "tap")
      cfg.mark = "tap";
    else
      delete cfg.mark;
  }
  const legacyEmail = input.verify === "email", verifyIn = legacyEmail ? "id" : input.verify;
  if (verifyIn !== undefined) {
    if (!VERIFY_MODES.includes(verifyIn))
      return { ok: false, error: "What a person must give: choose mobile number, employee ID, Email ID, or both mobile number and employee ID." };
    if (verifyIn === "mobile")
      delete cfg.verify;
    else
      cfg.verify = verifyIn;
    if (verifyIn !== "id" && input.idKind === undefined)
      delete cfg.idKind;
  }
  const kindIn = input.idKind !== undefined ? input.idKind : legacyEmail ? "email" : undefined;
  if (kindIn !== undefined) {
    if (kindIn !== "email" && kindIn !== "emp")
      return { ok: false, error: "What the ID is: an employee ID or an Email ID." };
    if (kindIn === "email") {
      if (verifyIn !== undefined && verifyIn !== "id")
        return { ok: false, error: "An Email ID is asked on its own: choose Email ID only, not a mobile number with it." };
      if (cfg.verify !== undefined && cfg.verify !== "id")
        return { ok: false, error: "An Email ID is asked on its own: choose Email ID only, not a mobile number with it." };
      cfg.verify = "id";
      cfg.idKind = "email";
    } else
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
      return { ok: false, error: `At most ${max} brand moment${max === 1 ? "" : "s"} ${label}.` };
    const slots = [];
    for (const b of raw) {
      const kind = b?.kind;
      if (kind === "lucky")
        return { ok: false, error: "A prize draw can only be placed during the game." };
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
      return { ok: false, error: `Openings must fit together in the ${OPENING_WINDOW_SECONDS / 60} minutes before the start.` };
    if (isOpening)
      cfg.opening = slots;
    else
      cfg.closing = slots;
  }
  {
    const t = cfg.tickets;
    if (cfg.breaks.length > maxMidFor(t) || cfg.opening.length > maxEdgeFor(t) || cfg.closing.length > maxEdgeFor(t))
      return { ok: false, error: `You can use ${brandMomentsFor(t)} brand moments: ${maxEdgeFor(t)} before the game, ${maxMidFor(t)} during it and ${maxEdgeFor(t)} at the end. Please switch some off.` };
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
  if (cfg.employeesOnly)
    cfg.invites = { on: false, per: cfg.invites.per, cats: cfg.invites.cats };
  return { ok: true, cfg };
}
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
  let hex2 = "";
  for (let i = 0;i < bytes.length; i++) {
    hex2 += hexes[bytes[i]];
  }
  return hex2;
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
function hexToBytes(hex2) {
  if (typeof hex2 !== "string")
    throw new Error("hex string expected, got " + typeof hex2);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex2);
  const hl = hex2.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0;ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex2.charCodeAt(hi));
    const n2 = asciiToBase16(hex2.charCodeAt(hi + 1));
    if (n1 === undefined || n2 === undefined) {
      const char = hex2[hi] + hex2[hi + 1];
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
function hexToNumber(hex2) {
  if (typeof hex2 !== "string")
    throw new Error("hex string expected, got " + typeof hex2);
  return hex2 === "" ? _0n : BigInt("0x" + hex2);
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
function ensureBytes(title, hex2, expectedLength) {
  let res;
  if (typeof hex2 === "string") {
    try {
      res = hexToBytes(hex2);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes(hex2)) {
    res = Uint8Array.from(hex2);
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
function bitGet(n, pos) {
  return n >> BigInt(pos) & _1n;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function isHash(val) {
  return typeof val === "function" && Number.isSafeInteger(val.outputLen);
}
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
  return (arg2, ...args) => {
    const val = map.get(arg2);
    if (val !== undefined)
      return val;
    const computed = fn(arg2, ...args);
    map.set(arg2, computed);
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
function sqrt9mod16(P2) {
  const Fp_ = Field(P2);
  const tn = tonelliShanks(P2);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P2 + _7n) / _16n;
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
function tonelliShanks(P2) {
  if (P2 < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P2 - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P2);
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
    let M2 = S;
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
        if (i === M2)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M2 - i - 1);
      const b = Fp.pow(c, exponent);
      M2 = i;
      c = Fp.sqr(b);
      t = Fp.mul(t, c);
      R = Fp.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P2) {
  if (P2 % _4n === _3n)
    return sqrt3mod4;
  if (P2 % _8n === _5n)
    return sqrt5mod8;
  if (P2 % _16n === _9n)
    return sqrt9mod16(P2);
  return tonelliShanks(P2);
}
var isNegativeLE = (num2, modulo) => (mod(num2, modulo) & _1n2) === _1n2;
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
function FpPow(Fp, num2, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp.ONE;
  if (power === _1n2)
    return num2;
  let p = Fp.ONE;
  let d = num2;
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
  const multipliedAcc = nums.reduce((acc, num2, i) => {
    if (Fp.is0(num2))
      return acc;
    inverted[i] = acc;
    return Fp.mul(acc, num2);
  }, Fp.ONE);
  const invertedAcc = Fp.inv(multipliedAcc);
  nums.reduceRight((acc, num2, i) => {
    if (Fp.is0(num2))
      return acc;
    inverted[i] = Fp.mul(acc, inverted[i]);
    return Fp.mul(acc, num2);
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
    create: (num2) => mod(num2, ORDER),
    isValid: (num2) => {
      if (typeof num2 !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num2);
      return _0n2 <= num2 && num2 < ORDER;
    },
    is0: (num2) => num2 === _0n2,
    isValidNot0: (num2) => !f.is0(num2) && f.isValid(num2),
    isOdd: (num2) => (num2 & _1n2) === _1n2,
    neg: (num2) => mod(-num2, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num2) => mod(num2 * num2, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num2, power) => FpPow(f, num2, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    sqrN: (num2) => num2 * num2,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num2) => invert(num2, ORDER),
    sqrt: _sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num2) => isLE ? numberToBytesLE(num2, BYTES) : numberToBytesBE(num2, BYTES),
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
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  const bitLength = fieldOrder.toString(2).length;
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE = false) {
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = getMinHashLength(fieldOrder);
  if (len < 16 || len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num2 = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num2, fieldOrder - _1n2) + _1n2;
  return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
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
function getW(P2) {
  return pointWindowSizes.get(P2) || 1;
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
  createCache(P2, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P2, W);
    pointPrecomputes.delete(P2);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
}
function mulEndoUnsafe(Point, point, k1, k2) {
  let acc = point;
  let p1 = Point.ZERO;
  let p2 = Point.ZERO;
  while (k1 > _0n3 || k2 > _0n3) {
    if (k1 & _1n3)
      p1 = p1.add(acc);
    if (k2 & _1n3)
      p2 = p2.add(acc);
    acc = acc.double();
    k1 >>= _1n3;
    k2 >>= _1n3;
  }
  return { p1, p2 };
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
      const wbits2 = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits2] = buckets[wbits2].add(points[j]);
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
      const { p, f } = wnaf.cached(this, scalar, (p2) => normalizeZ(Point, p2));
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
function _eddsa_new_output_to_legacy(c, eddsa2) {
  const Point = eddsa2.Point;
  const legacy = Object.assign({}, eddsa2, {
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

// node_modules/@noble/curves/esm/abstract/hash-to-curve.js
var os2ip = bytesToNumberBE;
function i2osp(value, length) {
  anum(value);
  anum(length);
  if (value < 0 || value >= 1 << 8 * length)
    throw new Error("invalid I2OSP input: " + value);
  const res = Array.from({ length }).fill(0);
  for (let i = length - 1;i >= 0; i--) {
    res[i] = value & 255;
    value >>>= 8;
  }
  return new Uint8Array(res);
}
function strxor(a, b) {
  const arr = new Uint8Array(a.length);
  for (let i = 0;i < a.length; i++) {
    arr[i] = a[i] ^ b[i];
  }
  return arr;
}
function anum(item) {
  if (!Number.isSafeInteger(item))
    throw new Error("number expected");
}
function normDST(DST) {
  if (!isBytes(DST) && typeof DST !== "string")
    throw new Error("DST must be Uint8Array or string");
  return typeof DST === "string" ? utf8ToBytes(DST) : DST;
}
function expand_message_xmd(msg, DST, lenInBytes, H) {
  abytes(msg);
  anum(lenInBytes);
  DST = normDST(DST);
  if (DST.length > 255)
    DST = H(concatBytes(utf8ToBytes("H2C-OVERSIZE-DST-"), DST));
  const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
  const ell = Math.ceil(lenInBytes / b_in_bytes);
  if (lenInBytes > 65535 || ell > 255)
    throw new Error("expand_message_xmd: invalid lenInBytes");
  const DST_prime = concatBytes(DST, i2osp(DST.length, 1));
  const Z_pad = i2osp(0, r_in_bytes);
  const l_i_b_str = i2osp(lenInBytes, 2);
  const b = new Array(ell);
  const b_0 = H(concatBytes(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
  b[0] = H(concatBytes(b_0, i2osp(1, 1), DST_prime));
  for (let i = 1;i <= ell; i++) {
    const args = [strxor(b_0, b[i - 1]), i2osp(i + 1, 1), DST_prime];
    b[i] = H(concatBytes(...args));
  }
  const pseudo_random_bytes = concatBytes(...b);
  return pseudo_random_bytes.slice(0, lenInBytes);
}
function expand_message_xof(msg, DST, lenInBytes, k, H) {
  abytes(msg);
  anum(lenInBytes);
  DST = normDST(DST);
  if (DST.length > 255) {
    const dkLen = Math.ceil(2 * k / 8);
    DST = H.create({ dkLen }).update(utf8ToBytes("H2C-OVERSIZE-DST-")).update(DST).digest();
  }
  if (lenInBytes > 65535 || DST.length > 255)
    throw new Error("expand_message_xof: invalid lenInBytes");
  return H.create({ dkLen: lenInBytes }).update(msg).update(i2osp(lenInBytes, 2)).update(DST).update(i2osp(DST.length, 1)).digest();
}
function hash_to_field(msg, count, options) {
  _validateObject(options, {
    p: "bigint",
    m: "number",
    k: "number",
    hash: "function"
  });
  const { p, k, m, hash, expand, DST } = options;
  if (!isHash(options.hash))
    throw new Error("expected valid hash");
  abytes(msg);
  anum(count);
  const log2p = p.toString(2).length;
  const L = Math.ceil((log2p + k) / 8);
  const len_in_bytes = count * m * L;
  let prb;
  if (expand === "xmd") {
    prb = expand_message_xmd(msg, DST, len_in_bytes, hash);
  } else if (expand === "xof") {
    prb = expand_message_xof(msg, DST, len_in_bytes, k, hash);
  } else if (expand === "_internal_pass") {
    prb = msg;
  } else {
    throw new Error('expand must be "xmd" or "xof"');
  }
  const u = new Array(count);
  for (let i = 0;i < count; i++) {
    const e = new Array(m);
    for (let j = 0;j < m; j++) {
      const elm_offset = L * (j + i * m);
      const tv = prb.subarray(elm_offset, elm_offset + L);
      e[j] = mod(os2ip(tv), p);
    }
    u[i] = e;
  }
  return u;
}
function isogenyMap(field, map) {
  const coeff = map.map((i) => Array.from(i).reverse());
  return (x, y) => {
    const [xn, xd, yn, yd] = coeff.map((val) => val.reduce((acc, i) => field.add(field.mul(acc, x), i)));
    const [xd_inv, yd_inv] = FpInvertBatch(field, [xd, yd], true);
    x = field.mul(xn, xd_inv);
    y = field.mul(y, field.mul(yn, yd_inv));
    return { x, y };
  };
}
var _DST_scalar = utf8ToBytes("HashToScalar-");
function createHasher2(Point, mapToCurve, defaults) {
  if (typeof mapToCurve !== "function")
    throw new Error("mapToCurve() must be defined");
  function map(num2) {
    return Point.fromAffine(mapToCurve(num2));
  }
  function clear(initial) {
    const P2 = initial.clearCofactor();
    if (P2.equals(Point.ZERO))
      return Point.ZERO;
    P2.assertValidity();
    return P2;
  }
  return {
    defaults,
    hashToCurve(msg, options) {
      const opts = Object.assign({}, defaults, options);
      const u = hash_to_field(msg, 2, opts);
      const u0 = map(u[0]);
      const u1 = map(u[1]);
      return clear(u0.add(u1));
    },
    encodeToCurve(msg, options) {
      const optsDst = defaults.encodeDST ? { DST: defaults.encodeDST } : {};
      const opts = Object.assign({}, defaults, optsDst, options);
      const u = hash_to_field(msg, 1, opts);
      const u0 = map(u[0]);
      return clear(u0);
    },
    mapToCurve(scalars) {
      if (!Array.isArray(scalars))
        throw new Error("expected array of bigints");
      for (const i of scalars)
        if (typeof i !== "bigint")
          throw new Error("expected array of bigints");
      return clear(map(scalars));
    },
    hashToScalar(msg, options) {
      const N = Point.Fn.ORDER;
      const opts = Object.assign({}, defaults, { p: N, m: 1, DST: _DST_scalar }, options);
      return hash_to_field(msg, 1, opts)[0][0];
    }
  };
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
  const P2 = ed25519_CURVE_p;
  const x2 = x * x % P2;
  const b2 = x2 * x % P2;
  const b4 = pow2(b2, _2n3, P2) * b2 % P2;
  const b5 = pow2(b4, _1n5, P2) * x % P2;
  const b10 = pow2(b5, _5n2, P2) * b5 % P2;
  const b20 = pow2(b10, _10n, P2) * b10 % P2;
  const b40 = pow2(b20, _20n, P2) * b20 % P2;
  const b80 = pow2(b40, _40n, P2) * b40 % P2;
  const b160 = pow2(b80, _80n, P2) * b80 % P2;
  const b240 = pow2(b160, _80n, P2) * b80 % P2;
  const b250 = pow2(b240, _10n, P2) * b10 % P2;
  const pow_p_5_8 = pow2(b250, _2n3, P2) * x % P2;
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
  const P2 = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P2);
  const v7 = mod(v3 * v3 * v, P2);
  const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow, P2);
  const vx2 = mod(v * x * x, P2);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P2);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P2);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P2);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P2))
    x = mod(-x, P2);
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
  const P2 = ed25519_CURVE_p;
  const mod2 = (n) => Fp.create(n);
  const r = mod2(SQRT_M1 * r0 * r0);
  const Ns = mod2((r + _1n5) * ONE_MINUS_D_SQ);
  let c = BigInt(-1);
  const D = mod2((c - d * r) * mod2(r + d));
  let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D);
  let s_ = mod2(s * r0);
  if (!isNegativeLE(s_, P2))
    s_ = mod2(-s_);
  if (!Ns_D_is_sq)
    s = s_;
  if (!Ns_D_is_sq)
    c = r;
  const Nt = mod2(c * (r - _1n5) * D_MINUS_ONE_SQ - D);
  const s2 = s * s;
  const W0 = mod2((s + s) * D);
  const W1 = mod2(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod2(_1n5 - s2);
  const W3 = mod2(_1n5 + s2);
  return new ed25519.Point(mod2(W0 * W3), mod2(W2 * W1), mod2(W1 * W3), mod2(W0 * W2));
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
  static hashToCurve(hex2) {
    return ristretto255_map(ensureBytes("ristrettoHash", hex2, 64));
  }
  static fromBytes(bytes) {
    abytes(bytes, 32);
    const { a, d } = ed25519_CURVE;
    const P2 = ed25519_CURVE_p;
    const mod2 = (n) => Fp.create(n);
    const s = bytes255ToNumberLE(bytes);
    if (!equalBytes(Fp.toBytes(s), bytes) || isNegativeLE(s, P2))
      throw new Error("invalid ristretto255 encoding 1");
    const s2 = mod2(s * s);
    const u1 = mod2(_1n5 + a * s2);
    const u2 = mod2(_1n5 - a * s2);
    const u1_2 = mod2(u1 * u1);
    const u2_2 = mod2(u2 * u2);
    const v = mod2(a * d * u1_2 - u2_2);
    const { isValid, value: I } = invertSqrt(mod2(v * u2_2));
    const Dx = mod2(I * u2);
    const Dy = mod2(I * Dx * v);
    let x = mod2((s + s) * Dx);
    if (isNegativeLE(x, P2))
      x = mod2(-x);
    const y = mod2(u1 * Dy);
    const t = mod2(x * y);
    if (!isValid || isNegativeLE(t, P2) || y === _0n5)
      throw new Error("invalid ristretto255 encoding 2");
    return new _RistrettoPoint(new ed25519.Point(x, y, _1n5, t));
  }
  static fromHex(hex2) {
    return _RistrettoPoint.fromBytes(ensureBytes("ristrettoHex", hex2, 32));
  }
  static msm(points, scalars) {
    return pippenger(_RistrettoPoint, ed25519.Point.Fn, points, scalars);
  }
  toBytes() {
    let { X, Y, Z, T } = this.ep;
    const P2 = ed25519_CURVE_p;
    const mod2 = (n) => Fp.create(n);
    const u1 = mod2(mod2(Z + Y) * mod2(Z - Y));
    const u2 = mod2(X * Y);
    const u2sq = mod2(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod2(u1 * u2sq));
    const D1 = mod2(invsqrt * u1);
    const D2 = mod2(invsqrt * u2);
    const zInv = mod2(D1 * D2 * T);
    let D;
    if (isNegativeLE(T * zInv, P2)) {
      let _x = mod2(Y * SQRT_M1);
      let _y = mod2(X * SQRT_M1);
      X = _x;
      Y = _y;
      D = mod2(D1 * INVSQRT_A_MINUS_D);
    } else {
      D = D2;
    }
    if (isNegativeLE(X * zInv, P2))
      Y = mod2(-Y);
    let s = mod2((Z - Y) * D);
    if (isNegativeLE(s, P2))
      s = mod2(-s);
    return Fp.toBytes(s);
  }
  equals(other) {
    this.assertSame(other);
    const { X: X1, Y: Y1 } = this.ep;
    const { X: X2, Y: Y2 } = other.ep;
    const mod2 = (n) => Fp.create(n);
    const one = mod2(X1 * Y2) === mod2(Y1 * X2);
    const two = mod2(Y1 * Y2) === mod2(X1 * X2);
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

// src-luck-3057fb8/packages/beacon/src/control.ts
var PERIOD_SEC = 3;
var MAX_TIMED_PAUSE_ROUNDS = 28800;
var hex2 = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
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
  return { ...m, sig: hex2(ed25519.sign(canonicalBytes(m), unhex(secretHex))) };
}
var publicKeyFromSecret = (secretHex) => hex2(ed25519.getPublicKey(unhex(secretHex)));
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
function scheduleWithControl(s, startRound, strideRounds, count) {
  return Array.from({ length: count }, (_, k) => callRound(s, startRound, strideRounds, k));
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
var fileKey = (id) => `control/${id}.json`;
async function readPublished(kv, engagementId) {
  const t = await kv.get(fileKey(engagementId));
  return t ? JSON.parse(t) : null;
}
var cfgOf = (f) => ({ pubKey: f.pubKey, maxPauseRounds: f.maxPauseRounds, leadRounds: f.leadRounds });
async function registerKey(kv, engagementId, pubKeyHex, safety = SAFETY_STANDARD, maxPauseRounds = 600) {
  if (!/^[0-9a-f]{64}$/i.test(pubKeyHex))
    return { ok: false, error: "The public key must be 32 bytes in hex." };
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(engagementId))
    return { ok: false, error: "Bad engagement id." };
  if (await readPublished(kv, engagementId))
    return { ok: false, error: "A key is already registered for this engagement and cannot be changed." };
  const f = { v: 1, engagementId, pubKey: pubKeyHex.toLowerCase(), maxPauseRounds, leadRounds: safety.leadRounds, messages: [] };
  await kv.put(fileKey(engagementId), JSON.stringify(f));
  return { ok: true };
}
async function publishControl(kv, engagementId, msg) {
  const f = await readPublished(kv, engagementId);
  if (!f)
    return { ok: false, status: 404, error: "No key is registered for this engagement." };
  if (!wellFormed(msg) || msg.engagementId !== engagementId)
    return { ok: false, status: 400, error: "Malformed control message." };
  const cfg = cfgOf(f);
  if (!await verifyControlSig(cfg.pubKey, msg))
    return { ok: false, status: 403, error: "Signature does not match the organizer key." };
  const existing = f.messages.find((m) => m.seq === msg.seq);
  if (existing)
    return existing.sig === msg.sig ? { ok: true, seq: msg.seq, duplicate: true } : { ok: false, status: 409, error: "That sequence number is already used." };
  if (msg.seq !== f.messages.length + 1)
    return { ok: false, status: 409, error: `Next sequence number is ${f.messages.length + 1}.` };
  const after = resolveControl(cfg, [...f.messages, msg]);
  const bad = after.ignored.find((x) => x.seq === msg.seq);
  if (bad)
    return { ok: false, status: 422, error: `Not accepted: ${bad.why}.` };
  f.messages.push(msg);
  await kv.put(fileKey(engagementId), JSON.stringify(f));
  return { ok: true, seq: msg.seq };
}
function describeControl(f, nowRound) {
  if (!f)
    return { registered: false };
  const st = resolveControl(cfgOf(f), f.messages);
  return {
    registered: true,
    pubKey: f.pubKey,
    leadRounds: f.leadRounds,
    leadSeconds: f.leadRounds * PERIOD_SEC,
    maxPauseRounds: f.maxPauseRounds,
    messages: f.messages.map((m) => ({ seq: m.seq, action: m.action, atBeaconRound: m.atBeaconRound, untilRound: m.untilRound })),
    intervals: st.intervals,
    stopRound: st.stopRound,
    ignored: st.ignored,
    pausedNow: nowRound === undefined ? undefined : pausedAt(st, nowRound),
    stopped: nowRound === undefined || st.stopRound === null ? undefined : nowRound >= st.stopRound
  };
}
function nextMessage(f, nowRound, a) {
  const lead = a.action === "resume" ? Math.max(1, a.inRounds ?? f.leadRounds) : Math.max(f.leadRounds, a.inRounds ?? 0);
  const at = nowRound + lead;
  const m = { engagementId: f.engagementId, seq: f.messages.length + 1, action: a.action, atBeaconRound: at, signedAtRound: nowRound };
  if (a.action === "pause" && a.pauseForRounds)
    m.untilRound = at + a.pauseForRounds;
  if (a.action === "extend") {
    const open = resolveControl(cfgOf(f), f.messages).intervals.at(-1);
    m.untilRound = a.untilRound ?? (open ? open.end : at) + (a.addRounds ?? a.pauseForRounds ?? 0);
  }
  return m;
}
// src-luck-3057fb8/apps/edge/src/audit.ts
var GENESIS = "0".repeat(64);
var enc3 = new TextEncoder;

// src-luck-3057fb8/apps/edge/src/mode.ts
var cache = new WeakMap;

// src-luck-3057fb8/apps/edge/src/analytics-core.ts
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
var enc4 = new TextEncoder;
var hmacKeys = new Map;
var rate = new Map;

// src-luck-3057fb8/apps/edge/src/visits.ts
var STEPS = ["visit", "pricing", "size", "create", "account", "published", "paid"];
var STAGE = Object.fromEntries(STEPS.map((s, i) => [s, i]));
var PUBLIC_PATHS = new Set(["/", "/legal", "/terms", "/dpa", "/subprocessors", "/partner-terms", "/organizer-guide", "/partner", "/signin", "/pay"]);
var ACTIONS = new Set(["pack", "create", "cur", "signin_open", "signin_submit", "start_open", "start_submit", "partner_click", "nav", "legal_click"]);
var enc5 = new TextEncoder;
var hmacKeys2 = new Map;
var rate2 = new Map;

// src-luck-3057fb8/packages/billing/src/index.ts
var BRANDS = {
  corporate_luck_by_chance: { id: "corporate_luck_by_chance", name: "Corporate Luck by Chance", domain: "corporate-luck-by-chance.example", invoicePrefix: "CB", theme: "#0B5D5B", line: "Live game software" },
  dpdp: { id: "dpdp", name: "dpdp.VERIDIAN-AIOS.COM", domain: "dpdp.veridian-aios.com", invoicePrefix: "DPDP", theme: "#0E7C6E", line: "Data protection compliance software" },
  projexa: { id: "projexa", name: "projexa-ai.com", domain: "projexa-ai.com", invoicePrefix: "PXA", theme: "#1C2B3A", line: "Project management software" },
  dewberry: { id: "dewberry", name: "dewberry.in", domain: "dewberry.in", invoicePrefix: "DEW", theme: "#5B3A8C", line: "Software solutions" }
};

// src-luck-3057fb8/apps/edge/src/ledgerc.ts
var SITE_CODE = "LBC";
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

// src-luck-3057fb8/apps/edge/src/hostsetup.ts
var HOST_LINK_TTL_MS = 7 * 86400000;
var encoder2 = new TextEncoder;

// src-luck-3057fb8/apps/edge/src/ai-link.ts
var SETTINGS_BODY = `{startRound?, cap?, closed?: true|false (invite-only; whoCanJoin: "list"|"anyone" is the same switch), coHostLimit?: 10-1000 people a Co-host may list, tz?: an IANA time zone such as America/New_York (how times are worded), name?: up to 60 characters, brand?: {name: 1-40 characters, color: one of ${BRAND_COLORS.join(" ")}, logo?: a small picture as a data URL}, rewards?: [{pattern: ${PRIZE_HOUSES.map((h) => h.id).join("|")}, ordinal?: 1 (every place has exactly one winner), text}], invites?: {on: true|false, per?: 1-10 people each person may invite, cats?: [ids of guest kinds, see section 1]}}`;

// src-luck-3057fb8/apps/edge/src/mails.ts
var LINK_MAIL_TTL_MS = 24 * 3600000;

// src-luck-3057fb8/apps/edge/src/helpdesk.ts
var TMP_KEY_MS = 30 * 60000;
var RESEND_MS = 10 * 60000;
var HELPER_MANUAL_NOTE = [
  "YOU ARE A HELP DESK HELPER.",
  "You prepare games for the Organizer who allowed you. You create the game and set it up with your normal functions. You never publish and never pay: only the Organizer publishes, with one tap, and pays.",
  'When the game is ready, ask the Organizer to publish: call POST /api/helpdesk/request-publish with {"eid": "<the game id>"} (or tell the helper to tap Ask the Organizer to publish). The Organizer gets an e-mail with a short summary and a button. Do not give out any link yourself.',
  "After the Organizer publishes, the helper becomes a Host of that game and gets a Host link by e-mail."
].join(`
`);

// src-luck-3057fb8/apps/edge/src/testlogins.ts
var TEST_LOGINS = new Set(["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in"]);

// src-luck-3057fb8/apps/edge/src/paylink.ts
var PAYLINK_TTL_MS = 7 * 86400000;

// src-luck-3057fb8/apps/edge/src/payfirst.ts
var INVOICE_AFTER_MS = 15 * 60000;

// src-luck-3057fb8/vendor/game-core/packages/core/src/funnel.ts
var FUNNEL_EVENTS = ["viewed", "size_chosen", "signup_started", "game_created", "game_published", "payment_page_reached", "payment_page_opened", "payment_link_copied", "payment_started", "payment_succeeded", "payment_failed", "game_started", "game_completed"];

// src-luck-3057fb8/apps/edge/src/funnel.ts
var PAGE_EVENTS = new Set(["viewed", "size_chosen", "signup_started", "payment_page_reached", "payment_page_opened", "payment_link_copied"]);
var SERVER_EVENTS = new Set(["game_created", "game_published", "payment_started", "payment_succeeded", "payment_failed", "game_started", "game_completed"]);
var MAIN_LINE = FUNNEL_EVENTS.filter((e) => e !== "payment_failed");
var ready2 = new WeakSet;

// src-luck-3057fb8/apps/edge/src/pay.ts
var brand = BRANDS.corporate_luck_by_chance;
var OUTBOX_KEEP_MS = 3 * 86400000;

// src-luck-3057fb8/apps/edge/src/credit.ts
var PAYER_KINDS = new Set(["master", "host", "cohost"]);

// src-luck-3057fb8/packages/shared/src/bingo-card.ts
var SIZE = 5;
var CELLS = 25;
var PER_COLUMN = 15;
var rowCells = (r) => [0, 1, 2, 3, 4].map((c) => r * SIZE + c);
var colCells = (c) => [0, 1, 2, 3, 4].map((r) => r * SIZE + c);
var DIAG1 = [0, 6, 12, 18, 24];
var DIAG2 = [4, 8, 12, 16, 20];
var LINES = [0, 1, 2, 3, 4].map(rowCells).concat([0, 1, 2, 3, 4].map(colCells), [DIAG1, DIAG2]);
var PATTERN_RULES = {
  line: { sets: LINES, need: 1 },
  twolines: { sets: LINES, need: 2 },
  corners: { sets: [[0, 4, 20, 24]], need: 1 },
  plus: { sets: [[...rowCells(2), 2, 7, 17, 22]], need: 1 },
  x: { sets: [[...DIAG1, 4, 8, 16, 20]], need: 1 },
  frame: { sets: [[...rowCells(0), ...rowCells(4), 5, 10, 15, 9, 14, 19]], need: 1 },
  stamp: { sets: [[0, 1, 5, 6], [3, 4, 8, 9], [15, 16, 20, 21], [18, 19, 23, 24]], need: 1 },
  letterL: { sets: [[...colCells(0), 21, 22, 23, 24]], need: 1 },
  letterT: { sets: [[...rowCells(0), 7, 12, 17, 22]], need: 1 },
  blackout: { sets: [Array.from({ length: CELLS }, (_, i) => i)], need: 1 }
};
// node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

// src-luck-3057fb8/packages/beacon/src/unique-ticket.ts
var arrangements = (k) => {
  let p = 1n;
  for (let i = 0;i < k; i++)
    p *= BigInt(PER_COLUMN - i);
  return p;
};
var A5 = arrangements(5);
var A4 = arrangements(4);
var TOTAL = A5 ** 4n * A4;
var keyCache = new Map;

// node_modules/@noble/curves/esm/abstract/weierstrass.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var divNearest = (num2, den) => (num2 + (num2 >= 0 ? den : -den) / _2n4) / den;
function _splitEndoScalar(k, basis, n) {
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n6;
  const k2neg = k2 < _0n6;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n6;
  if (k1 < _0n6 || k1 >= MAX_NUM || k2 < _0n6 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed, k=" + k);
  }
  return { k1neg, k1, k2neg, k2 };
}
var _0n6 = BigInt(0);
var _1n6 = BigInt(1);
var _2n4 = BigInt(2);
var _3n3 = BigInt(3);
var _4n2 = BigInt(4);
function _normFnElement(Fn2, key) {
  const { BYTES: expected } = Fn2;
  let num2;
  if (typeof key === "bigint") {
    num2 = key;
  } else {
    let bytes = ensureBytes("private key", key);
    try {
      num2 = Fn2.fromBytes(bytes);
    } catch (error) {
      throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
    }
  }
  if (!Fn2.isValidNot0(num2))
    throw new Error("invalid private key: out of range [1..N-1]");
  return num2;
}
function weierstrassN(params, extraOpts = {}) {
  const validated = _createCurveFields("weierstrass", params, extraOpts);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  _validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    wrapPrivateKey: "boolean"
  });
  const { endo } = extraOpts;
  if (endo) {
    if (!Fp2.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const lengths = getWLengths(Fp2, Fn2);
  function assertCompressionIsSupported() {
    if (!Fp2.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    const { x, y } = point.toAffine();
    const bx = Fp2.toBytes(x);
    _abool2(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp2.isOdd(y);
      return concatBytes(pprefix(hasEvenY), bx);
    } else {
      return concatBytes(Uint8Array.of(4), bx, Fp2.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    _abytes2(bytes, undefined, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp2.fromBytes(tail);
      if (!Fp2.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp2.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const isYOdd = Fp2.isOdd(y);
      const isHeadOdd = (head & 1) === 1;
      if (isHeadOdd !== isYOdd)
        y = Fp2.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp2.BYTES;
      const x = Fp2.fromBytes(tail.subarray(0, L));
      const y = Fp2.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = extraOpts.toBytes || pointToBytes;
  const decodePoint = extraOpts.fromBytes || pointFromBytes;
  function weierstrassEquation(x) {
    const x2 = Fp2.sqr(x);
    const x3 = Fp2.mul(x2, x);
    return Fp2.add(Fp2.add(x3, Fp2.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp2.sqr(y);
    const right = weierstrassEquation(x);
    return Fp2.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp2.mul(Fp2.pow(CURVE.a, _3n3), _4n2);
  const _27b2 = Fp2.mul(Fp2.sqr(CURVE.b), BigInt(27));
  if (Fp2.is0(Fp2.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp2.isValid(n) || banZero && Fp2.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ProjectivePoint expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn2.ORDER);
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    if (Fp2.eql(Z, Fp2.ONE))
      return { x: X, y: Y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp2.ONE : Fp2.inv(Z);
    const x = Fp2.mul(X, iz);
    const y = Fp2.mul(Y, iz);
    const zz = Fp2.mul(Z, iz);
    if (is0)
      return { x: Fp2.ZERO, y: Fp2.ZERO };
    if (!Fp2.eql(zz, Fp2.ONE))
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    if (p.is0()) {
      if (extraOpts.allowInfinityPoint && !Fp2.is0(p.Y))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp2.isValid(x) || !Fp2.isValid(y))
      throw new Error("bad point: x or y not field elements");
    if (!isValidXY(x, y))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
    k2p = new Point(Fp2.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
    k1p = negateCt(k1neg, k1p);
    k2p = negateCt(k2neg, k2p);
    return k1p.add(k2p);
  }

  class Point {
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp2.isValid(x) || !Fp2.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp2.is0(x) && Fp2.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp2.ONE);
    }
    static fromBytes(bytes) {
      const P2 = Point.fromAffine(decodePoint(_abytes2(bytes, undefined, "point")));
      P2.assertValidity();
      return P2;
    }
    static fromHex(hex3) {
      return Point.fromBytes(ensureBytes("pointHex", hex3));
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
        this.multiply(_3n3);
      return this;
    }
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp2.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp2.isOdd(y);
    }
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp2.eql(Fp2.mul(X1, Z2), Fp2.mul(X2, Z1));
      const U2 = Fp2.eql(Fp2.mul(Y1, Z2), Fp2.mul(Y2, Z1));
      return U1 && U2;
    }
    negate() {
      return new Point(this.X, Fp2.neg(this.Y), this.Z);
    }
    double() {
      const { a, b } = CURVE;
      const b3 = Fp2.mul(b, _3n3);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp2;
      let t0 = Fp2.mul(X1, X1);
      let t1 = Fp2.mul(Y1, Y1);
      let t2 = Fp2.mul(Z1, Z1);
      let t3 = Fp2.mul(X1, Y1);
      t3 = Fp2.add(t3, t3);
      Z3 = Fp2.mul(X1, Z1);
      Z3 = Fp2.add(Z3, Z3);
      X3 = Fp2.mul(a, Z3);
      Y3 = Fp2.mul(b3, t2);
      Y3 = Fp2.add(X3, Y3);
      X3 = Fp2.sub(t1, Y3);
      Y3 = Fp2.add(t1, Y3);
      Y3 = Fp2.mul(X3, Y3);
      X3 = Fp2.mul(t3, X3);
      Z3 = Fp2.mul(b3, Z3);
      t2 = Fp2.mul(a, t2);
      t3 = Fp2.sub(t0, t2);
      t3 = Fp2.mul(a, t3);
      t3 = Fp2.add(t3, Z3);
      Z3 = Fp2.add(t0, t0);
      t0 = Fp2.add(Z3, t0);
      t0 = Fp2.add(t0, t2);
      t0 = Fp2.mul(t0, t3);
      Y3 = Fp2.add(Y3, t0);
      t2 = Fp2.mul(Y1, Z1);
      t2 = Fp2.add(t2, t2);
      t0 = Fp2.mul(t2, t3);
      X3 = Fp2.sub(X3, t0);
      Z3 = Fp2.mul(t2, t1);
      Z3 = Fp2.add(Z3, Z3);
      Z3 = Fp2.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp2;
      const a = CURVE.a;
      const b3 = Fp2.mul(CURVE.b, _3n3);
      let t0 = Fp2.mul(X1, X2);
      let t1 = Fp2.mul(Y1, Y2);
      let t2 = Fp2.mul(Z1, Z2);
      let t3 = Fp2.add(X1, Y1);
      let t4 = Fp2.add(X2, Y2);
      t3 = Fp2.mul(t3, t4);
      t4 = Fp2.add(t0, t1);
      t3 = Fp2.sub(t3, t4);
      t4 = Fp2.add(X1, Z1);
      let t5 = Fp2.add(X2, Z2);
      t4 = Fp2.mul(t4, t5);
      t5 = Fp2.add(t0, t2);
      t4 = Fp2.sub(t4, t5);
      t5 = Fp2.add(Y1, Z1);
      X3 = Fp2.add(Y2, Z2);
      t5 = Fp2.mul(t5, X3);
      X3 = Fp2.add(t1, t2);
      t5 = Fp2.sub(t5, X3);
      Z3 = Fp2.mul(a, t4);
      X3 = Fp2.mul(b3, t2);
      Z3 = Fp2.add(X3, Z3);
      X3 = Fp2.sub(t1, Z3);
      Z3 = Fp2.add(t1, Z3);
      Y3 = Fp2.mul(X3, Z3);
      t1 = Fp2.add(t0, t0);
      t1 = Fp2.add(t1, t0);
      t2 = Fp2.mul(a, t2);
      t4 = Fp2.mul(b3, t4);
      t1 = Fp2.add(t1, t2);
      t2 = Fp2.sub(t0, t2);
      t2 = Fp2.mul(a, t2);
      t4 = Fp2.add(t4, t2);
      t0 = Fp2.mul(t1, t4);
      Y3 = Fp2.add(Y3, t0);
      t0 = Fp2.mul(t5, t4);
      X3 = Fp2.mul(t3, X3);
      X3 = Fp2.sub(X3, t0);
      t0 = Fp2.mul(t3, t1);
      Z3 = Fp2.mul(t5, Z3);
      Z3 = Fp2.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    multiply(scalar) {
      const { endo: endo2 } = extraOpts;
      if (!Fn2.isValidNot0(scalar))
        throw new Error("invalid scalar: out of range");
      let point, fake;
      const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(Point, p));
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
        const { p: k1p, f: k1f } = mul(k1);
        const { p: k2p, f: k2f } = mul(k2);
        fake = k1f.add(k2f);
        point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
      } else {
        const { p, f } = mul(scalar);
        point = p;
        fake = f;
      }
      return normalizeZ(Point, [point, fake])[0];
    }
    multiplyUnsafe(sc) {
      const { endo: endo2 } = extraOpts;
      const p = this;
      if (!Fn2.isValid(sc))
        throw new Error("invalid scalar: out of range");
      if (sc === _0n6 || p.is0())
        return Point.ZERO;
      if (sc === _1n6)
        return p;
      if (wnaf.hasCache(this))
        return this.multiply(sc);
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
        const { p1, p2 } = mulEndoUnsafe(Point, p, k1, k2);
        return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
      } else {
        return wnaf.unsafe(p, sc);
      }
    }
    multiplyAndAddUnsafe(Q, a, b) {
      const sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
      return sum.is0() ? undefined : sum;
    }
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    isTorsionFree() {
      const { isTorsionFree } = extraOpts;
      if (cofactor === _1n6)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.unsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n6)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    toBytes(isCompressed = true) {
      _abool2(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    get px() {
      return this.X;
    }
    get py() {
      return this.X;
    }
    get pz() {
      return this.Z;
    }
    toRawBytes(isCompressed = true) {
      return this.toBytes(isCompressed);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    static normalizeZ(points) {
      return normalizeZ(Point, points);
    }
    static msm(points, scalars) {
      return pippenger(Point, Fn2, points, scalars);
    }
    static fromPrivateKey(privateKey) {
      return Point.BASE.multiply(_normFnElement(Fn2, privateKey));
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp2.ONE);
  Point.ZERO = new Point(Fp2.ZERO, Fp2.ONE, Fp2.ZERO);
  Point.Fp = Fp2;
  Point.Fn = Fn2;
  const bits = Fn2.BITS;
  const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
  Point.BASE.precompute(8);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function SWUFpSqrtRatio(Fp2, Z) {
  const q = Fp2.ORDER;
  let l = _0n6;
  for (let o = q - _1n6;o % _2n4 === _0n6; o /= _2n4)
    l += _1n6;
  const c1 = l;
  const _2n_pow_c1_1 = _2n4 << c1 - _1n6 - _1n6;
  const _2n_pow_c1 = _2n_pow_c1_1 * _2n4;
  const c2 = (q - _1n6) / _2n_pow_c1;
  const c3 = (c2 - _1n6) / _2n4;
  const c4 = _2n_pow_c1 - _1n6;
  const c5 = _2n_pow_c1_1;
  const c6 = Fp2.pow(Z, c2);
  const c7 = Fp2.pow(Z, (c2 + _1n6) / _2n4);
  let sqrtRatio = (u, v) => {
    let tv1 = c6;
    let tv2 = Fp2.pow(v, c4);
    let tv3 = Fp2.sqr(tv2);
    tv3 = Fp2.mul(tv3, v);
    let tv5 = Fp2.mul(u, tv3);
    tv5 = Fp2.pow(tv5, c3);
    tv5 = Fp2.mul(tv5, tv2);
    tv2 = Fp2.mul(tv5, v);
    tv3 = Fp2.mul(tv5, u);
    let tv4 = Fp2.mul(tv3, tv2);
    tv5 = Fp2.pow(tv4, c5);
    let isQR = Fp2.eql(tv5, Fp2.ONE);
    tv2 = Fp2.mul(tv3, c7);
    tv5 = Fp2.mul(tv4, tv1);
    tv3 = Fp2.cmov(tv2, tv3, isQR);
    tv4 = Fp2.cmov(tv5, tv4, isQR);
    for (let i = c1;i > _1n6; i--) {
      let tv52 = i - _2n4;
      tv52 = _2n4 << tv52 - _1n6;
      let tvv5 = Fp2.pow(tv4, tv52);
      const e1 = Fp2.eql(tvv5, Fp2.ONE);
      tv2 = Fp2.mul(tv3, tv1);
      tv1 = Fp2.mul(tv1, tv1);
      tvv5 = Fp2.mul(tv4, tv1);
      tv3 = Fp2.cmov(tv2, tv3, e1);
      tv4 = Fp2.cmov(tvv5, tv4, e1);
    }
    return { isValid: isQR, value: tv3 };
  };
  if (Fp2.ORDER % _4n2 === _3n3) {
    const c12 = (Fp2.ORDER - _3n3) / _4n2;
    const c22 = Fp2.sqrt(Fp2.neg(Z));
    sqrtRatio = (u, v) => {
      let tv1 = Fp2.sqr(v);
      const tv2 = Fp2.mul(u, v);
      tv1 = Fp2.mul(tv1, tv2);
      let y1 = Fp2.pow(tv1, c12);
      y1 = Fp2.mul(y1, tv2);
      const y2 = Fp2.mul(y1, c22);
      const tv3 = Fp2.mul(Fp2.sqr(y1), v);
      const isQR = Fp2.eql(tv3, u);
      let y = Fp2.cmov(y2, y1, isQR);
      return { isValid: isQR, value: y };
    };
  }
  return sqrtRatio;
}
function mapToCurveSimpleSWU(Fp2, opts) {
  validateField(Fp2);
  const { A, B, Z } = opts;
  if (!Fp2.isValid(A) || !Fp2.isValid(B) || !Fp2.isValid(Z))
    throw new Error("mapToCurveSimpleSWU: invalid opts");
  const sqrtRatio = SWUFpSqrtRatio(Fp2, Z);
  if (!Fp2.isOdd)
    throw new Error("Field does not have .isOdd()");
  return (u) => {
    let tv1, tv2, tv3, tv4, tv5, tv6, x, y;
    tv1 = Fp2.sqr(u);
    tv1 = Fp2.mul(tv1, Z);
    tv2 = Fp2.sqr(tv1);
    tv2 = Fp2.add(tv2, tv1);
    tv3 = Fp2.add(tv2, Fp2.ONE);
    tv3 = Fp2.mul(tv3, B);
    tv4 = Fp2.cmov(Z, Fp2.neg(tv2), !Fp2.eql(tv2, Fp2.ZERO));
    tv4 = Fp2.mul(tv4, A);
    tv2 = Fp2.sqr(tv3);
    tv6 = Fp2.sqr(tv4);
    tv5 = Fp2.mul(tv6, A);
    tv2 = Fp2.add(tv2, tv5);
    tv2 = Fp2.mul(tv2, tv3);
    tv6 = Fp2.mul(tv6, tv4);
    tv5 = Fp2.mul(tv6, B);
    tv2 = Fp2.add(tv2, tv5);
    x = Fp2.mul(tv1, tv3);
    const { isValid, value } = sqrtRatio(tv2, tv6);
    y = Fp2.mul(tv1, u);
    y = Fp2.mul(y, value);
    x = Fp2.cmov(x, tv3, isValid);
    y = Fp2.cmov(y, value, isValid);
    const e1 = Fp2.isOdd(u) === Fp2.isOdd(y);
    y = Fp2.cmov(Fp2.neg(y), y, e1);
    const tv4_inv = FpInvertBatch(Fp2, [tv4], true)[0];
    x = Fp2.mul(x, tv4_inv);
    return { x, y };
  };
}
function getWLengths(Fp2, Fn2) {
  return {
    secretKey: Fn2.BYTES,
    publicKey: 1 + Fp2.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp2.BYTES,
    publicKeyHasPrefix: true,
    signature: 2 * Fn2.BYTES
  };
}
function weierstrassPoints(c) {
  const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c);
  const Point = weierstrassN(CURVE, curveOpts);
  return _weierstrass_new_output_to_legacy(c, Point);
}
function _weierstrass_legacy_opts_to_new(c) {
  const CURVE = {
    a: c.a,
    b: c.b,
    p: c.Fp.ORDER,
    n: c.n,
    h: c.h,
    Gx: c.Gx,
    Gy: c.Gy
  };
  const Fp2 = c.Fp;
  let allowedLengths = c.allowedPrivateKeyLengths ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2)))) : undefined;
  const Fn2 = Field(CURVE.n, {
    BITS: c.nBitLength,
    allowedLengths,
    modFromBytes: c.wrapPrivateKey
  });
  const curveOpts = {
    Fp: Fp2,
    Fn: Fn2,
    allowInfinityPoint: c.allowInfinityPoint,
    endo: c.endo,
    isTorsionFree: c.isTorsionFree,
    clearCofactor: c.clearCofactor,
    fromBytes: c.fromBytes,
    toBytes: c.toBytes
  };
  return { CURVE, curveOpts };
}
function _legacyHelperEquat(Fp2, a, b) {
  function weierstrassEquation(x) {
    const x2 = Fp2.sqr(x);
    const x3 = Fp2.mul(x2, x);
    return Fp2.add(Fp2.add(x3, Fp2.mul(x, a)), b);
  }
  return weierstrassEquation;
}
function _weierstrass_new_output_to_legacy(c, Point) {
  const { Fp: Fp2, Fn: Fn2 } = Point;
  function isWithinCurveOrder(num2) {
    return inRange(num2, _1n6, Fn2.ORDER);
  }
  const weierstrassEquation = _legacyHelperEquat(Fp2, c.a, c.b);
  return Object.assign({}, {
    CURVE: c,
    Point,
    ProjectivePoint: Point,
    normPrivateKeyToScalar: (key) => _normFnElement(Fn2, key),
    weierstrassEquation,
    isWithinCurveOrder
  });
}

// node_modules/@noble/curves/esm/abstract/bls.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n7 = BigInt(0);
var _1n7 = BigInt(1);
var _2n5 = BigInt(2);
var _3n4 = BigInt(3);
function NAfDecomposition(a) {
  const res = [];
  for (;a > _1n7; a >>= _1n7) {
    if ((a & _1n7) === _0n7)
      res.unshift(0);
    else if ((a & _3n4) === _3n4) {
      res.unshift(-1);
      a += _1n7;
    } else
      res.unshift(1);
  }
  return res;
}
function aNonEmpty(arr) {
  if (!Array.isArray(arr) || arr.length === 0)
    throw new Error("expected non-empty array");
}
function createBlsPairing(fields, G1, G2, params) {
  const { Fp2, Fp12 } = fields;
  const { twistType, ateLoopSize, xNegative, postPrecompute } = params;
  let lineFunction;
  if (twistType === "multiplicative") {
    lineFunction = (c0, c1, c2, f, Px, Py) => Fp12.mul014(f, c0, Fp2.mul(c1, Px), Fp2.mul(c2, Py));
  } else if (twistType === "divisive") {
    lineFunction = (c0, c1, c2, f, Px, Py) => Fp12.mul034(f, Fp2.mul(c2, Py), Fp2.mul(c1, Px), c0);
  } else
    throw new Error("bls: unknown twist type");
  const Fp2div2 = Fp2.div(Fp2.ONE, Fp2.mul(Fp2.ONE, _2n5));
  function pointDouble(ell, Rx, Ry, Rz) {
    const t0 = Fp2.sqr(Ry);
    const t1 = Fp2.sqr(Rz);
    const t2 = Fp2.mulByB(Fp2.mul(t1, _3n4));
    const t3 = Fp2.mul(t2, _3n4);
    const t4 = Fp2.sub(Fp2.sub(Fp2.sqr(Fp2.add(Ry, Rz)), t1), t0);
    const c0 = Fp2.sub(t2, t0);
    const c1 = Fp2.mul(Fp2.sqr(Rx), _3n4);
    const c2 = Fp2.neg(t4);
    ell.push([c0, c1, c2]);
    Rx = Fp2.mul(Fp2.mul(Fp2.mul(Fp2.sub(t0, t3), Rx), Ry), Fp2div2);
    Ry = Fp2.sub(Fp2.sqr(Fp2.mul(Fp2.add(t0, t3), Fp2div2)), Fp2.mul(Fp2.sqr(t2), _3n4));
    Rz = Fp2.mul(t0, t4);
    return { Rx, Ry, Rz };
  }
  function pointAdd(ell, Rx, Ry, Rz, Qx, Qy) {
    const t0 = Fp2.sub(Ry, Fp2.mul(Qy, Rz));
    const t1 = Fp2.sub(Rx, Fp2.mul(Qx, Rz));
    const c0 = Fp2.sub(Fp2.mul(t0, Qx), Fp2.mul(t1, Qy));
    const c1 = Fp2.neg(t0);
    const c2 = t1;
    ell.push([c0, c1, c2]);
    const t2 = Fp2.sqr(t1);
    const t3 = Fp2.mul(t2, t1);
    const t4 = Fp2.mul(t2, Rx);
    const t5 = Fp2.add(Fp2.sub(t3, Fp2.mul(t4, _2n5)), Fp2.mul(Fp2.sqr(t0), Rz));
    Rx = Fp2.mul(t1, t5);
    Ry = Fp2.sub(Fp2.mul(Fp2.sub(t4, t5), t0), Fp2.mul(t3, Ry));
    Rz = Fp2.mul(Rz, t3);
    return { Rx, Ry, Rz };
  }
  const ATE_NAF = NAfDecomposition(ateLoopSize);
  const calcPairingPrecomputes = memoized((point) => {
    const p = point;
    const { x, y } = p.toAffine();
    const Qx = x, Qy = y, negQy = Fp2.neg(y);
    let Rx = Qx, Ry = Qy, Rz = Fp2.ONE;
    const ell = [];
    for (const bit of ATE_NAF) {
      const cur = [];
      ({ Rx, Ry, Rz } = pointDouble(cur, Rx, Ry, Rz));
      if (bit)
        ({ Rx, Ry, Rz } = pointAdd(cur, Rx, Ry, Rz, Qx, bit === -1 ? negQy : Qy));
      ell.push(cur);
    }
    if (postPrecompute) {
      const last = ell[ell.length - 1];
      postPrecompute(Rx, Ry, Rz, Qx, Qy, pointAdd.bind(null, last));
    }
    return ell;
  });
  function millerLoopBatch(pairs, withFinalExponent = false) {
    let f12 = Fp12.ONE;
    if (pairs.length) {
      const ellLen = pairs[0][0].length;
      for (let i = 0;i < ellLen; i++) {
        f12 = Fp12.sqr(f12);
        for (const [ell, Px, Py] of pairs) {
          for (const [c0, c1, c2] of ell[i])
            f12 = lineFunction(c0, c1, c2, f12, Px, Py);
        }
      }
    }
    if (xNegative)
      f12 = Fp12.conjugate(f12);
    return withFinalExponent ? Fp12.finalExponentiate(f12) : f12;
  }
  function pairingBatch(pairs, withFinalExponent = true) {
    const res = [];
    normalizeZ(G1, pairs.map(({ g1 }) => g1));
    normalizeZ(G2, pairs.map(({ g2 }) => g2));
    for (const { g1, g2 } of pairs) {
      if (g1.is0() || g2.is0())
        throw new Error("pairing is not available for ZERO point");
      g1.assertValidity();
      g2.assertValidity();
      const Qa = g1.toAffine();
      res.push([calcPairingPrecomputes(g2), Qa.x, Qa.y]);
    }
    return millerLoopBatch(res, withFinalExponent);
  }
  function pairing(Q, P2, withFinalExponent = true) {
    return pairingBatch([{ g1: Q, g2: P2 }], withFinalExponent);
  }
  return {
    Fp12,
    millerLoopBatch,
    pairing,
    pairingBatch,
    calcPairingPrecomputes
  };
}
function createBlsSig(blsPairing, PubCurve, SigCurve, SignatureCoder, isSigG1) {
  const { Fp12, pairingBatch } = blsPairing;
  function normPub(point) {
    return point instanceof PubCurve.Point ? point : PubCurve.Point.fromHex(point);
  }
  function normSig(point) {
    return point instanceof SigCurve.Point ? point : SigCurve.Point.fromHex(point);
  }
  function amsg(m) {
    if (!(m instanceof SigCurve.Point))
      throw new Error(`expected valid message hashed to ${!isSigG1 ? "G2" : "G1"} curve`);
    return m;
  }
  const pair = !isSigG1 ? (a, b) => ({ g1: a, g2: b }) : (a, b) => ({ g1: b, g2: a });
  return {
    getPublicKey(secretKey) {
      const sec = _normFnElement(PubCurve.Point.Fn, secretKey);
      return PubCurve.Point.BASE.multiply(sec);
    },
    sign(message, secretKey, unusedArg) {
      if (unusedArg != null)
        throw new Error("sign() expects 2 arguments");
      const sec = _normFnElement(PubCurve.Point.Fn, secretKey);
      amsg(message).assertValidity();
      return message.multiply(sec);
    },
    verify(signature, message, publicKey, unusedArg) {
      if (unusedArg != null)
        throw new Error("verify() expects 3 arguments");
      signature = normSig(signature);
      publicKey = normPub(publicKey);
      const P2 = publicKey.negate();
      const G = PubCurve.Point.BASE;
      const Hm = amsg(message);
      const S = signature;
      const exp = pairingBatch([pair(P2, Hm), pair(G, S)]);
      return Fp12.eql(exp, Fp12.ONE);
    },
    verifyBatch(signature, messages, publicKeys) {
      aNonEmpty(messages);
      if (publicKeys.length !== messages.length)
        throw new Error("amount of public keys and messages should be equal");
      const sig = normSig(signature);
      const nMessages = messages;
      const nPublicKeys = publicKeys.map(normPub);
      const messagePubKeyMap = new Map;
      for (let i = 0;i < nPublicKeys.length; i++) {
        const pub = nPublicKeys[i];
        const msg = nMessages[i];
        let keys2 = messagePubKeyMap.get(msg);
        if (keys2 === undefined) {
          keys2 = [];
          messagePubKeyMap.set(msg, keys2);
        }
        keys2.push(pub);
      }
      const paired = [];
      const G = PubCurve.Point.BASE;
      try {
        for (const [msg, keys2] of messagePubKeyMap) {
          const groupPublicKey = keys2.reduce((acc, msg2) => acc.add(msg2));
          paired.push(pair(groupPublicKey, msg));
        }
        paired.push(pair(G.negate(), sig));
        return Fp12.eql(pairingBatch(paired), Fp12.ONE);
      } catch {
        return false;
      }
    },
    aggregatePublicKeys(publicKeys) {
      aNonEmpty(publicKeys);
      publicKeys = publicKeys.map((pub) => normPub(pub));
      const agg = publicKeys.reduce((sum, p) => sum.add(p), PubCurve.Point.ZERO);
      agg.assertValidity();
      return agg;
    },
    aggregateSignatures(signatures) {
      aNonEmpty(signatures);
      signatures = signatures.map((sig) => normSig(sig));
      const agg = signatures.reduce((sum, s) => sum.add(s), SigCurve.Point.ZERO);
      agg.assertValidity();
      return agg;
    },
    hash(messageBytes, DST) {
      abytes(messageBytes);
      const opts = DST ? { DST } : undefined;
      return SigCurve.hashToCurve(messageBytes, opts);
    },
    Signature: SignatureCoder
  };
}
function bls(CURVE) {
  const { Fp: Fp2, Fr, Fp2: Fp22, Fp6, Fp12 } = CURVE.fields;
  const G1_ = weierstrassPoints(CURVE.G1);
  const G1 = Object.assign(G1_, createHasher2(G1_.Point, CURVE.G1.mapToCurve, {
    ...CURVE.htfDefaults,
    ...CURVE.G1.htfDefaults
  }));
  const G2_ = weierstrassPoints(CURVE.G2);
  const G2 = Object.assign(G2_, createHasher2(G2_.Point, CURVE.G2.mapToCurve, {
    ...CURVE.htfDefaults,
    ...CURVE.G2.htfDefaults
  }));
  const pairingRes = createBlsPairing(CURVE.fields, G1.Point, G2.Point, {
    ...CURVE.params,
    postPrecompute: CURVE.postPrecompute
  });
  const { millerLoopBatch, pairing, pairingBatch, calcPairingPrecomputes } = pairingRes;
  const longSignatures = createBlsSig(pairingRes, G1, G2, CURVE.G2.Signature, false);
  const shortSignatures = createBlsSig(pairingRes, G2, G1, CURVE.G1.ShortSignature, true);
  const rand = CURVE.randomBytes || randomBytes;
  const randomSecretKey = () => {
    const length = getMinHashLength(Fr.ORDER);
    return mapHashToField(rand(length), Fr.ORDER);
  };
  const utils = {
    randomSecretKey,
    randomPrivateKey: randomSecretKey,
    calcPairingPrecomputes
  };
  const { ShortSignature } = CURVE.G1;
  const { Signature } = CURVE.G2;
  function normP1Hash(point, htfOpts) {
    return point instanceof G1.Point ? point : shortSignatures.hash(ensureBytes("point", point), htfOpts?.DST);
  }
  function normP2Hash(point, htfOpts) {
    return point instanceof G2.Point ? point : longSignatures.hash(ensureBytes("point", point), htfOpts?.DST);
  }
  function getPublicKey(privateKey) {
    return longSignatures.getPublicKey(privateKey).toBytes(true);
  }
  function getPublicKeyForShortSignatures(privateKey) {
    return shortSignatures.getPublicKey(privateKey).toBytes(true);
  }
  function sign(message, privateKey, htfOpts) {
    const Hm = normP2Hash(message, htfOpts);
    const S = longSignatures.sign(Hm, privateKey);
    return message instanceof G2.Point ? S : Signature.toBytes(S);
  }
  function signShortSignature(message, privateKey, htfOpts) {
    const Hm = normP1Hash(message, htfOpts);
    const S = shortSignatures.sign(Hm, privateKey);
    return message instanceof G1.Point ? S : ShortSignature.toBytes(S);
  }
  function verify(signature, message, publicKey, htfOpts) {
    const Hm = normP2Hash(message, htfOpts);
    return longSignatures.verify(signature, Hm, publicKey);
  }
  function verifyShortSignature(signature, message, publicKey, htfOpts) {
    const Hm = normP1Hash(message, htfOpts);
    return shortSignatures.verify(signature, Hm, publicKey);
  }
  function aggregatePublicKeys(publicKeys) {
    const agg = longSignatures.aggregatePublicKeys(publicKeys);
    return publicKeys[0] instanceof G1.Point ? agg : agg.toBytes(true);
  }
  function aggregateSignatures(signatures) {
    const agg = longSignatures.aggregateSignatures(signatures);
    return signatures[0] instanceof G2.Point ? agg : Signature.toBytes(agg);
  }
  function aggregateShortSignatures(signatures) {
    const agg = shortSignatures.aggregateSignatures(signatures);
    return signatures[0] instanceof G1.Point ? agg : ShortSignature.toBytes(agg);
  }
  function verifyBatch(signature, messages, publicKeys, htfOpts) {
    const Hm = messages.map((m) => normP2Hash(m, htfOpts));
    return longSignatures.verifyBatch(signature, Hm, publicKeys);
  }
  G1.Point.BASE.precompute(4);
  return {
    longSignatures,
    shortSignatures,
    millerLoopBatch,
    pairing,
    pairingBatch,
    verifyBatch,
    fields: {
      Fr,
      Fp: Fp2,
      Fp2: Fp22,
      Fp6,
      Fp12
    },
    params: {
      ateLoopSize: CURVE.params.ateLoopSize,
      twistType: CURVE.params.twistType,
      r: CURVE.params.r,
      G1b: CURVE.G1.b,
      G2b: CURVE.G2.b
    },
    utils,
    getPublicKey,
    getPublicKeyForShortSignatures,
    sign,
    signShortSignature,
    verify,
    verifyShortSignature,
    aggregatePublicKeys,
    aggregateSignatures,
    aggregateShortSignatures,
    G1,
    G2,
    Signature,
    ShortSignature
  };
}

// node_modules/@noble/curves/esm/abstract/tower.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n8 = BigInt(0);
var _1n8 = BigInt(1);
var _2n6 = BigInt(2);
var _3n5 = BigInt(3);
function calcFrobeniusCoefficients(Fp2, nonResidue, modulus, degree, num2 = 1, divisor) {
  const _divisor = BigInt(divisor === undefined ? degree : divisor);
  const towerModulus = modulus ** BigInt(degree);
  const res = [];
  for (let i = 0;i < num2; i++) {
    const a = BigInt(i + 1);
    const powers = [];
    for (let j = 0, qPower = _1n8;j < degree; j++) {
      const power = (a * qPower - a) / _divisor % towerModulus;
      powers.push(Fp2.pow(nonResidue, power));
      qPower *= modulus;
    }
    res.push(powers);
  }
  return res;
}
function psiFrobenius(Fp2, Fp22, base) {
  const PSI_X = Fp22.pow(base, (Fp2.ORDER - _1n8) / _3n5);
  const PSI_Y = Fp22.pow(base, (Fp2.ORDER - _1n8) / _2n6);
  function psi(x, y) {
    const x2 = Fp22.mul(Fp22.frobeniusMap(x, 1), PSI_X);
    const y2 = Fp22.mul(Fp22.frobeniusMap(y, 1), PSI_Y);
    return [x2, y2];
  }
  const PSI2_X = Fp22.pow(base, (Fp2.ORDER ** _2n6 - _1n8) / _3n5);
  const PSI2_Y = Fp22.pow(base, (Fp2.ORDER ** _2n6 - _1n8) / _2n6);
  if (!Fp22.eql(PSI2_Y, Fp22.neg(Fp22.ONE)))
    throw new Error("psiFrobenius: PSI2_Y!==-1");
  function psi2(x, y) {
    return [Fp22.mul(x, PSI2_X), Fp22.neg(y)];
  }
  const mapAffine = (fn) => (c, P2) => {
    const affine = P2.toAffine();
    const p = fn(affine.x, affine.y);
    return c.fromAffine({ x: p[0], y: p[1] });
  };
  const G2psi = mapAffine(psi);
  const G2psi2 = mapAffine(psi2);
  return { psi, psi2, G2psi, G2psi2, PSI_X, PSI_Y, PSI2_X, PSI2_Y };
}
var Fp2fromBigTuple = (Fp2, tuple) => {
  if (tuple.length !== 2)
    throw new Error("invalid tuple");
  const fps = tuple.map((n) => Fp2.create(n));
  return { c0: fps[0], c1: fps[1] };
};

class _Field2 {
  constructor(Fp2, opts = {}) {
    this.MASK = _1n8;
    const ORDER = Fp2.ORDER;
    const FP2_ORDER = ORDER * ORDER;
    this.Fp = Fp2;
    this.ORDER = FP2_ORDER;
    this.BITS = bitLen(FP2_ORDER);
    this.BYTES = Math.ceil(bitLen(FP2_ORDER) / 8);
    this.isLE = Fp2.isLE;
    this.ZERO = { c0: Fp2.ZERO, c1: Fp2.ZERO };
    this.ONE = { c0: Fp2.ONE, c1: Fp2.ZERO };
    this.Fp_NONRESIDUE = Fp2.create(opts.NONRESIDUE || BigInt(-1));
    this.Fp_div2 = Fp2.div(Fp2.ONE, _2n6);
    this.NONRESIDUE = Fp2fromBigTuple(Fp2, opts.FP2_NONRESIDUE);
    this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp2, this.Fp_NONRESIDUE, Fp2.ORDER, 2)[0];
    this.mulByB = opts.Fp2mulByB;
    Object.seal(this);
  }
  fromBigTuple(tuple) {
    return Fp2fromBigTuple(this.Fp, tuple);
  }
  create(num2) {
    return num2;
  }
  isValid({ c0, c1 }) {
    function isValidC(num2, ORDER) {
      return typeof num2 === "bigint" && _0n8 <= num2 && num2 < ORDER;
    }
    return isValidC(c0, this.ORDER) && isValidC(c1, this.ORDER);
  }
  is0({ c0, c1 }) {
    return this.Fp.is0(c0) && this.Fp.is0(c1);
  }
  isValidNot0(num2) {
    return !this.is0(num2) && this.isValid(num2);
  }
  eql({ c0, c1 }, { c0: r0, c1: r1 }) {
    return this.Fp.eql(c0, r0) && this.Fp.eql(c1, r1);
  }
  neg({ c0, c1 }) {
    return { c0: this.Fp.neg(c0), c1: this.Fp.neg(c1) };
  }
  pow(num2, power) {
    return FpPow(this, num2, power);
  }
  invertBatch(nums) {
    return FpInvertBatch(this, nums);
  }
  add(f1, f2) {
    const { c0, c1 } = f1;
    const { c0: r0, c1: r1 } = f2;
    return {
      c0: this.Fp.add(c0, r0),
      c1: this.Fp.add(c1, r1)
    };
  }
  sub({ c0, c1 }, { c0: r0, c1: r1 }) {
    return {
      c0: this.Fp.sub(c0, r0),
      c1: this.Fp.sub(c1, r1)
    };
  }
  mul({ c0, c1 }, rhs) {
    const { Fp: Fp2 } = this;
    if (typeof rhs === "bigint")
      return { c0: Fp2.mul(c0, rhs), c1: Fp2.mul(c1, rhs) };
    const { c0: r0, c1: r1 } = rhs;
    let t1 = Fp2.mul(c0, r0);
    let t2 = Fp2.mul(c1, r1);
    const o0 = Fp2.sub(t1, t2);
    const o1 = Fp2.sub(Fp2.mul(Fp2.add(c0, c1), Fp2.add(r0, r1)), Fp2.add(t1, t2));
    return { c0: o0, c1: o1 };
  }
  sqr({ c0, c1 }) {
    const { Fp: Fp2 } = this;
    const a = Fp2.add(c0, c1);
    const b = Fp2.sub(c0, c1);
    const c = Fp2.add(c0, c0);
    return { c0: Fp2.mul(a, b), c1: Fp2.mul(c, c1) };
  }
  addN(a, b) {
    return this.add(a, b);
  }
  subN(a, b) {
    return this.sub(a, b);
  }
  mulN(a, b) {
    return this.mul(a, b);
  }
  sqrN(a) {
    return this.sqr(a);
  }
  div(lhs, rhs) {
    const { Fp: Fp2 } = this;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp2.inv(Fp2.create(rhs)) : this.inv(rhs));
  }
  inv({ c0: a, c1: b }) {
    const { Fp: Fp2 } = this;
    const factor = Fp2.inv(Fp2.create(a * a + b * b));
    return { c0: Fp2.mul(factor, Fp2.create(a)), c1: Fp2.mul(factor, Fp2.create(-b)) };
  }
  sqrt(num2) {
    const { Fp: Fp2 } = this;
    const Fp22 = this;
    const { c0, c1 } = num2;
    if (Fp2.is0(c1)) {
      if (FpLegendre(Fp2, c0) === 1)
        return Fp22.create({ c0: Fp2.sqrt(c0), c1: Fp2.ZERO });
      else
        return Fp22.create({ c0: Fp2.ZERO, c1: Fp2.sqrt(Fp2.div(c0, this.Fp_NONRESIDUE)) });
    }
    const a = Fp2.sqrt(Fp2.sub(Fp2.sqr(c0), Fp2.mul(Fp2.sqr(c1), this.Fp_NONRESIDUE)));
    let d = Fp2.mul(Fp2.add(a, c0), this.Fp_div2);
    const legendre = FpLegendre(Fp2, d);
    if (legendre === -1)
      d = Fp2.sub(d, a);
    const a0 = Fp2.sqrt(d);
    const candidateSqrt = Fp22.create({ c0: a0, c1: Fp2.div(Fp2.mul(c1, this.Fp_div2), a0) });
    if (!Fp22.eql(Fp22.sqr(candidateSqrt), num2))
      throw new Error("Cannot find square root");
    const x1 = candidateSqrt;
    const x2 = Fp22.neg(x1);
    const { re: re1, im: im1 } = Fp22.reim(x1);
    const { re: re2, im: im2 } = Fp22.reim(x2);
    if (im1 > im2 || im1 === im2 && re1 > re2)
      return x1;
    return x2;
  }
  isOdd(x) {
    const { re: x0, im: x1 } = this.reim(x);
    const sign_0 = x0 % _2n6;
    const zero_0 = x0 === _0n8;
    const sign_1 = x1 % _2n6;
    return BigInt(sign_0 || zero_0 && sign_1) == _1n8;
  }
  fromBytes(b) {
    const { Fp: Fp2 } = this;
    if (b.length !== this.BYTES)
      throw new Error("fromBytes invalid length=" + b.length);
    return { c0: Fp2.fromBytes(b.subarray(0, Fp2.BYTES)), c1: Fp2.fromBytes(b.subarray(Fp2.BYTES)) };
  }
  toBytes({ c0, c1 }) {
    return concatBytes(this.Fp.toBytes(c0), this.Fp.toBytes(c1));
  }
  cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
    return {
      c0: this.Fp.cmov(c0, r0, c),
      c1: this.Fp.cmov(c1, r1, c)
    };
  }
  reim({ c0, c1 }) {
    return { re: c0, im: c1 };
  }
  Fp4Square(a, b) {
    const Fp2 = this;
    const a2 = Fp2.sqr(a);
    const b2 = Fp2.sqr(b);
    return {
      first: Fp2.add(Fp2.mulByNonresidue(b2), a2),
      second: Fp2.sub(Fp2.sub(Fp2.sqr(Fp2.add(a, b)), a2), b2)
    };
  }
  mulByNonresidue({ c0, c1 }) {
    return this.mul({ c0, c1 }, this.NONRESIDUE);
  }
  frobeniusMap({ c0, c1 }, power) {
    return {
      c0,
      c1: this.Fp.mul(c1, this.FROBENIUS_COEFFICIENTS[power % 2])
    };
  }
}

class _Field6 {
  constructor(Fp2) {
    this.MASK = _1n8;
    this.Fp2 = Fp2;
    this.ORDER = Fp2.ORDER;
    this.BITS = 3 * Fp2.BITS;
    this.BYTES = 3 * Fp2.BYTES;
    this.isLE = Fp2.isLE;
    this.ZERO = { c0: Fp2.ZERO, c1: Fp2.ZERO, c2: Fp2.ZERO };
    this.ONE = { c0: Fp2.ONE, c1: Fp2.ZERO, c2: Fp2.ZERO };
    const { Fp: Fp3 } = Fp2;
    const frob = calcFrobeniusCoefficients(Fp2, Fp2.NONRESIDUE, Fp3.ORDER, 6, 2, 3);
    this.FROBENIUS_COEFFICIENTS_1 = frob[0];
    this.FROBENIUS_COEFFICIENTS_2 = frob[1];
    Object.seal(this);
  }
  add({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
    const { Fp2 } = this;
    return {
      c0: Fp2.add(c0, r0),
      c1: Fp2.add(c1, r1),
      c2: Fp2.add(c2, r2)
    };
  }
  sub({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
    const { Fp2 } = this;
    return {
      c0: Fp2.sub(c0, r0),
      c1: Fp2.sub(c1, r1),
      c2: Fp2.sub(c2, r2)
    };
  }
  mul({ c0, c1, c2 }, rhs) {
    const { Fp2 } = this;
    if (typeof rhs === "bigint") {
      return {
        c0: Fp2.mul(c0, rhs),
        c1: Fp2.mul(c1, rhs),
        c2: Fp2.mul(c2, rhs)
      };
    }
    const { c0: r0, c1: r1, c2: r2 } = rhs;
    const t0 = Fp2.mul(c0, r0);
    const t1 = Fp2.mul(c1, r1);
    const t2 = Fp2.mul(c2, r2);
    return {
      c0: Fp2.add(t0, Fp2.mulByNonresidue(Fp2.sub(Fp2.mul(Fp2.add(c1, c2), Fp2.add(r1, r2)), Fp2.add(t1, t2)))),
      c1: Fp2.add(Fp2.sub(Fp2.mul(Fp2.add(c0, c1), Fp2.add(r0, r1)), Fp2.add(t0, t1)), Fp2.mulByNonresidue(t2)),
      c2: Fp2.sub(Fp2.add(t1, Fp2.mul(Fp2.add(c0, c2), Fp2.add(r0, r2))), Fp2.add(t0, t2))
    };
  }
  sqr({ c0, c1, c2 }) {
    const { Fp2 } = this;
    let t0 = Fp2.sqr(c0);
    let t1 = Fp2.mul(Fp2.mul(c0, c1), _2n6);
    let t3 = Fp2.mul(Fp2.mul(c1, c2), _2n6);
    let t4 = Fp2.sqr(c2);
    return {
      c0: Fp2.add(Fp2.mulByNonresidue(t3), t0),
      c1: Fp2.add(Fp2.mulByNonresidue(t4), t1),
      c2: Fp2.sub(Fp2.sub(Fp2.add(Fp2.add(t1, Fp2.sqr(Fp2.add(Fp2.sub(c0, c1), c2))), t3), t0), t4)
    };
  }
  addN(a, b) {
    return this.add(a, b);
  }
  subN(a, b) {
    return this.sub(a, b);
  }
  mulN(a, b) {
    return this.mul(a, b);
  }
  sqrN(a) {
    return this.sqr(a);
  }
  create(num2) {
    return num2;
  }
  isValid({ c0, c1, c2 }) {
    const { Fp2 } = this;
    return Fp2.isValid(c0) && Fp2.isValid(c1) && Fp2.isValid(c2);
  }
  is0({ c0, c1, c2 }) {
    const { Fp2 } = this;
    return Fp2.is0(c0) && Fp2.is0(c1) && Fp2.is0(c2);
  }
  isValidNot0(num2) {
    return !this.is0(num2) && this.isValid(num2);
  }
  neg({ c0, c1, c2 }) {
    const { Fp2 } = this;
    return { c0: Fp2.neg(c0), c1: Fp2.neg(c1), c2: Fp2.neg(c2) };
  }
  eql({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
    const { Fp2 } = this;
    return Fp2.eql(c0, r0) && Fp2.eql(c1, r1) && Fp2.eql(c2, r2);
  }
  sqrt(_) {
    return notImplemented();
  }
  div(lhs, rhs) {
    const { Fp2 } = this;
    const { Fp: Fp3 } = Fp2;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp3.inv(Fp3.create(rhs)) : this.inv(rhs));
  }
  pow(num2, power) {
    return FpPow(this, num2, power);
  }
  invertBatch(nums) {
    return FpInvertBatch(this, nums);
  }
  inv({ c0, c1, c2 }) {
    const { Fp2 } = this;
    let t0 = Fp2.sub(Fp2.sqr(c0), Fp2.mulByNonresidue(Fp2.mul(c2, c1)));
    let t1 = Fp2.sub(Fp2.mulByNonresidue(Fp2.sqr(c2)), Fp2.mul(c0, c1));
    let t2 = Fp2.sub(Fp2.sqr(c1), Fp2.mul(c0, c2));
    let t4 = Fp2.inv(Fp2.add(Fp2.mulByNonresidue(Fp2.add(Fp2.mul(c2, t1), Fp2.mul(c1, t2))), Fp2.mul(c0, t0)));
    return { c0: Fp2.mul(t4, t0), c1: Fp2.mul(t4, t1), c2: Fp2.mul(t4, t2) };
  }
  fromBytes(b) {
    const { Fp2 } = this;
    if (b.length !== this.BYTES)
      throw new Error("fromBytes invalid length=" + b.length);
    const B2 = Fp2.BYTES;
    return {
      c0: Fp2.fromBytes(b.subarray(0, B2)),
      c1: Fp2.fromBytes(b.subarray(B2, B2 * 2)),
      c2: Fp2.fromBytes(b.subarray(2 * B2))
    };
  }
  toBytes({ c0, c1, c2 }) {
    const { Fp2 } = this;
    return concatBytes(Fp2.toBytes(c0), Fp2.toBytes(c1), Fp2.toBytes(c2));
  }
  cmov({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }, c) {
    const { Fp2 } = this;
    return {
      c0: Fp2.cmov(c0, r0, c),
      c1: Fp2.cmov(c1, r1, c),
      c2: Fp2.cmov(c2, r2, c)
    };
  }
  fromBigSix(t) {
    const { Fp2 } = this;
    if (!Array.isArray(t) || t.length !== 6)
      throw new Error("invalid Fp6 usage");
    return {
      c0: Fp2.fromBigTuple(t.slice(0, 2)),
      c1: Fp2.fromBigTuple(t.slice(2, 4)),
      c2: Fp2.fromBigTuple(t.slice(4, 6))
    };
  }
  frobeniusMap({ c0, c1, c2 }, power) {
    const { Fp2 } = this;
    return {
      c0: Fp2.frobeniusMap(c0, power),
      c1: Fp2.mul(Fp2.frobeniusMap(c1, power), this.FROBENIUS_COEFFICIENTS_1[power % 6]),
      c2: Fp2.mul(Fp2.frobeniusMap(c2, power), this.FROBENIUS_COEFFICIENTS_2[power % 6])
    };
  }
  mulByFp2({ c0, c1, c2 }, rhs) {
    const { Fp2 } = this;
    return {
      c0: Fp2.mul(c0, rhs),
      c1: Fp2.mul(c1, rhs),
      c2: Fp2.mul(c2, rhs)
    };
  }
  mulByNonresidue({ c0, c1, c2 }) {
    const { Fp2 } = this;
    return { c0: Fp2.mulByNonresidue(c2), c1: c0, c2: c1 };
  }
  mul1({ c0, c1, c2 }, b1) {
    const { Fp2 } = this;
    return {
      c0: Fp2.mulByNonresidue(Fp2.mul(c2, b1)),
      c1: Fp2.mul(c0, b1),
      c2: Fp2.mul(c1, b1)
    };
  }
  mul01({ c0, c1, c2 }, b0, b1) {
    const { Fp2 } = this;
    let t0 = Fp2.mul(c0, b0);
    let t1 = Fp2.mul(c1, b1);
    return {
      c0: Fp2.add(Fp2.mulByNonresidue(Fp2.sub(Fp2.mul(Fp2.add(c1, c2), b1), t1)), t0),
      c1: Fp2.sub(Fp2.sub(Fp2.mul(Fp2.add(b0, b1), Fp2.add(c0, c1)), t0), t1),
      c2: Fp2.add(Fp2.sub(Fp2.mul(Fp2.add(c0, c2), b0), t0), t1)
    };
  }
}

class _Field12 {
  constructor(Fp6, opts) {
    this.MASK = _1n8;
    const { Fp2 } = Fp6;
    const { Fp: Fp3 } = Fp2;
    this.Fp6 = Fp6;
    this.ORDER = Fp2.ORDER;
    this.BITS = 2 * Fp6.BITS;
    this.BYTES = 2 * Fp6.BYTES;
    this.isLE = Fp6.isLE;
    this.ZERO = { c0: Fp6.ZERO, c1: Fp6.ZERO };
    this.ONE = { c0: Fp6.ONE, c1: Fp6.ZERO };
    this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp2, Fp2.NONRESIDUE, Fp3.ORDER, 12, 1, 6)[0];
    this.X_LEN = opts.X_LEN;
    this.finalExponentiate = opts.Fp12finalExponentiate;
  }
  create(num2) {
    return num2;
  }
  isValid({ c0, c1 }) {
    const { Fp6 } = this;
    return Fp6.isValid(c0) && Fp6.isValid(c1);
  }
  is0({ c0, c1 }) {
    const { Fp6 } = this;
    return Fp6.is0(c0) && Fp6.is0(c1);
  }
  isValidNot0(num2) {
    return !this.is0(num2) && this.isValid(num2);
  }
  neg({ c0, c1 }) {
    const { Fp6 } = this;
    return { c0: Fp6.neg(c0), c1: Fp6.neg(c1) };
  }
  eql({ c0, c1 }, { c0: r0, c1: r1 }) {
    const { Fp6 } = this;
    return Fp6.eql(c0, r0) && Fp6.eql(c1, r1);
  }
  sqrt(_) {
    notImplemented();
  }
  inv({ c0, c1 }) {
    const { Fp6 } = this;
    let t = Fp6.inv(Fp6.sub(Fp6.sqr(c0), Fp6.mulByNonresidue(Fp6.sqr(c1))));
    return { c0: Fp6.mul(c0, t), c1: Fp6.neg(Fp6.mul(c1, t)) };
  }
  div(lhs, rhs) {
    const { Fp6 } = this;
    const { Fp2 } = Fp6;
    const { Fp: Fp3 } = Fp2;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp3.inv(Fp3.create(rhs)) : this.inv(rhs));
  }
  pow(num2, power) {
    return FpPow(this, num2, power);
  }
  invertBatch(nums) {
    return FpInvertBatch(this, nums);
  }
  add({ c0, c1 }, { c0: r0, c1: r1 }) {
    const { Fp6 } = this;
    return {
      c0: Fp6.add(c0, r0),
      c1: Fp6.add(c1, r1)
    };
  }
  sub({ c0, c1 }, { c0: r0, c1: r1 }) {
    const { Fp6 } = this;
    return {
      c0: Fp6.sub(c0, r0),
      c1: Fp6.sub(c1, r1)
    };
  }
  mul({ c0, c1 }, rhs) {
    const { Fp6 } = this;
    if (typeof rhs === "bigint")
      return { c0: Fp6.mul(c0, rhs), c1: Fp6.mul(c1, rhs) };
    let { c0: r0, c1: r1 } = rhs;
    let t1 = Fp6.mul(c0, r0);
    let t2 = Fp6.mul(c1, r1);
    return {
      c0: Fp6.add(t1, Fp6.mulByNonresidue(t2)),
      c1: Fp6.sub(Fp6.mul(Fp6.add(c0, c1), Fp6.add(r0, r1)), Fp6.add(t1, t2))
    };
  }
  sqr({ c0, c1 }) {
    const { Fp6 } = this;
    let ab = Fp6.mul(c0, c1);
    return {
      c0: Fp6.sub(Fp6.sub(Fp6.mul(Fp6.add(Fp6.mulByNonresidue(c1), c0), Fp6.add(c0, c1)), ab), Fp6.mulByNonresidue(ab)),
      c1: Fp6.add(ab, ab)
    };
  }
  addN(a, b) {
    return this.add(a, b);
  }
  subN(a, b) {
    return this.sub(a, b);
  }
  mulN(a, b) {
    return this.mul(a, b);
  }
  sqrN(a) {
    return this.sqr(a);
  }
  fromBytes(b) {
    const { Fp6 } = this;
    if (b.length !== this.BYTES)
      throw new Error("fromBytes invalid length=" + b.length);
    return {
      c0: Fp6.fromBytes(b.subarray(0, Fp6.BYTES)),
      c1: Fp6.fromBytes(b.subarray(Fp6.BYTES))
    };
  }
  toBytes({ c0, c1 }) {
    const { Fp6 } = this;
    return concatBytes(Fp6.toBytes(c0), Fp6.toBytes(c1));
  }
  cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
    const { Fp6 } = this;
    return {
      c0: Fp6.cmov(c0, r0, c),
      c1: Fp6.cmov(c1, r1, c)
    };
  }
  fromBigTwelve(t) {
    const { Fp6 } = this;
    return {
      c0: Fp6.fromBigSix(t.slice(0, 6)),
      c1: Fp6.fromBigSix(t.slice(6, 12))
    };
  }
  frobeniusMap(lhs, power) {
    const { Fp6 } = this;
    const { Fp2 } = Fp6;
    const { c0, c1, c2 } = Fp6.frobeniusMap(lhs.c1, power);
    const coeff = this.FROBENIUS_COEFFICIENTS[power % 12];
    return {
      c0: Fp6.frobeniusMap(lhs.c0, power),
      c1: Fp6.create({
        c0: Fp2.mul(c0, coeff),
        c1: Fp2.mul(c1, coeff),
        c2: Fp2.mul(c2, coeff)
      })
    };
  }
  mulByFp2({ c0, c1 }, rhs) {
    const { Fp6 } = this;
    return {
      c0: Fp6.mulByFp2(c0, rhs),
      c1: Fp6.mulByFp2(c1, rhs)
    };
  }
  conjugate({ c0, c1 }) {
    return { c0, c1: this.Fp6.neg(c1) };
  }
  mul014({ c0, c1 }, o0, o1, o4) {
    const { Fp6 } = this;
    const { Fp2 } = Fp6;
    let t0 = Fp6.mul01(c0, o0, o1);
    let t1 = Fp6.mul1(c1, o4);
    return {
      c0: Fp6.add(Fp6.mulByNonresidue(t1), t0),
      c1: Fp6.sub(Fp6.sub(Fp6.mul01(Fp6.add(c1, c0), o0, Fp2.add(o1, o4)), t0), t1)
    };
  }
  mul034({ c0, c1 }, o0, o3, o4) {
    const { Fp6 } = this;
    const { Fp2 } = Fp6;
    const a = Fp6.create({
      c0: Fp2.mul(c0.c0, o0),
      c1: Fp2.mul(c0.c1, o0),
      c2: Fp2.mul(c0.c2, o0)
    });
    const b = Fp6.mul01(c1, o3, o4);
    const e = Fp6.mul01(Fp6.add(c0, c1), Fp2.add(o0, o3), o4);
    return {
      c0: Fp6.add(Fp6.mulByNonresidue(b), a),
      c1: Fp6.sub(e, Fp6.add(a, b))
    };
  }
  _cyclotomicSquare({ c0, c1 }) {
    const { Fp6 } = this;
    const { Fp2 } = Fp6;
    const { c0: c0c0, c1: c0c1, c2: c0c2 } = c0;
    const { c0: c1c0, c1: c1c1, c2: c1c2 } = c1;
    const { first: t3, second: t4 } = Fp2.Fp4Square(c0c0, c1c1);
    const { first: t5, second: t6 } = Fp2.Fp4Square(c1c0, c0c2);
    const { first: t7, second: t8 } = Fp2.Fp4Square(c0c1, c1c2);
    const t9 = Fp2.mulByNonresidue(t8);
    return {
      c0: Fp6.create({
        c0: Fp2.add(Fp2.mul(Fp2.sub(t3, c0c0), _2n6), t3),
        c1: Fp2.add(Fp2.mul(Fp2.sub(t5, c0c1), _2n6), t5),
        c2: Fp2.add(Fp2.mul(Fp2.sub(t7, c0c2), _2n6), t7)
      }),
      c1: Fp6.create({
        c0: Fp2.add(Fp2.mul(Fp2.add(t9, c1c0), _2n6), t9),
        c1: Fp2.add(Fp2.mul(Fp2.add(t4, c1c1), _2n6), t4),
        c2: Fp2.add(Fp2.mul(Fp2.add(t6, c1c2), _2n6), t6)
      })
    };
  }
  _cyclotomicExp(num2, n) {
    let z = this.ONE;
    for (let i = this.X_LEN - 1;i >= 0; i--) {
      z = this._cyclotomicSquare(z);
      if (bitGet(n, i))
        z = this.mul(z, num2);
    }
    return z;
  }
}
function tower12(opts) {
  const Fp2 = Field(opts.ORDER);
  const Fp22 = new _Field2(Fp2, opts);
  const Fp6 = new _Field6(Fp22);
  const Fp12 = new _Field12(Fp6, opts);
  return { Fp: Fp2, Fp2: Fp22, Fp6, Fp12 };
}

// node_modules/@noble/curves/esm/bls12-381.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n9 = BigInt(0);
var _1n9 = BigInt(1);
var _2n7 = BigInt(2);
var _3n6 = BigInt(3);
var _4n3 = BigInt(4);
var BLS_X = BigInt("0xd201000000010000");
var BLS_X_LEN = bitLen(BLS_X);
var bls12_381_CURVE_G1 = {
  p: BigInt("0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"),
  n: BigInt("0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001"),
  h: BigInt("0x396c8c005555e1568c00aaab0000aaab"),
  a: _0n9,
  b: _4n3,
  Gx: BigInt("0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"),
  Gy: BigInt("0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1")
};
var bls12_381_Fr = Field(bls12_381_CURVE_G1.n, {
  modFromBytes: true,
  isLE: true
});
var { Fp: Fp2, Fp2: Fp22, Fp6, Fp12 } = tower12({
  ORDER: bls12_381_CURVE_G1.p,
  X_LEN: BLS_X_LEN,
  FP2_NONRESIDUE: [_1n9, _1n9],
  Fp2mulByB: ({ c0, c1 }) => {
    const t0 = Fp2.mul(c0, _4n3);
    const t1 = Fp2.mul(c1, _4n3);
    return { c0: Fp2.sub(t0, t1), c1: Fp2.add(t0, t1) };
  },
  Fp12finalExponentiate: (num2) => {
    const x = BLS_X;
    const t0 = Fp12.div(Fp12.frobeniusMap(num2, 6), num2);
    const t1 = Fp12.mul(Fp12.frobeniusMap(t0, 2), t0);
    const t2 = Fp12.conjugate(Fp12._cyclotomicExp(t1, x));
    const t3 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicSquare(t1)), t2);
    const t4 = Fp12.conjugate(Fp12._cyclotomicExp(t3, x));
    const t5 = Fp12.conjugate(Fp12._cyclotomicExp(t4, x));
    const t6 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicExp(t5, x)), Fp12._cyclotomicSquare(t2));
    const t7 = Fp12.conjugate(Fp12._cyclotomicExp(t6, x));
    const t2_t5_pow_q2 = Fp12.frobeniusMap(Fp12.mul(t2, t5), 2);
    const t4_t1_pow_q3 = Fp12.frobeniusMap(Fp12.mul(t4, t1), 3);
    const t6_t1c_pow_q1 = Fp12.frobeniusMap(Fp12.mul(t6, Fp12.conjugate(t1)), 1);
    const t7_t3c_t1 = Fp12.mul(Fp12.mul(t7, Fp12.conjugate(t3)), t1);
    return Fp12.mul(Fp12.mul(Fp12.mul(t2_t5_pow_q2, t4_t1_pow_q3), t6_t1c_pow_q1), t7_t3c_t1);
  }
});
var { G2psi, G2psi2 } = psiFrobenius(Fp2, Fp22, Fp22.div(Fp22.ONE, Fp22.NONRESIDUE));
var htfDefaults = Object.freeze({
  DST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
  encodeDST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
  p: Fp2.ORDER,
  m: 2,
  k: 128,
  expand: "xmd",
  hash: sha256
});
var bls12_381_CURVE_G2 = {
  p: Fp22.ORDER,
  n: bls12_381_CURVE_G1.n,
  h: BigInt("0x5d543a95414e7f1091d50792876a202cd91de4547085abaa68a205b2e5a7ddfa628f1cb4d9e82ef21537e293a6691ae1616ec6e786f0c70cf1c38e31c7238e5"),
  a: Fp22.ZERO,
  b: Fp22.fromBigTuple([_4n3, _4n3]),
  Gx: Fp22.fromBigTuple([
    BigInt("0x024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8"),
    BigInt("0x13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e")
  ]),
  Gy: Fp22.fromBigTuple([
    BigInt("0x0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801"),
    BigInt("0x0606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be")
  ])
};
var COMPZERO = setMask(Fp2.toBytes(_0n9), { infinity: true, compressed: true });
function parseMask(bytes) {
  bytes = bytes.slice();
  const mask = bytes[0] & 224;
  const compressed = !!(mask >> 7 & 1);
  const infinity = !!(mask >> 6 & 1);
  const sort = !!(mask >> 5 & 1);
  bytes[0] &= 31;
  return { compressed, infinity, sort, value: bytes };
}
function setMask(bytes, mask) {
  if (bytes[0] & 224)
    throw new Error("setMask: non-empty mask");
  if (mask.compressed)
    bytes[0] |= 128;
  if (mask.infinity)
    bytes[0] |= 64;
  if (mask.sort)
    bytes[0] |= 32;
  return bytes;
}
function pointG1ToBytes(_c, point, isComp) {
  const { BYTES: L, ORDER: P2 } = Fp2;
  const is0 = point.is0();
  const { x, y } = point.toAffine();
  if (isComp) {
    if (is0)
      return COMPZERO.slice();
    const sort = Boolean(y * _2n7 / P2);
    return setMask(numberToBytesBE(x, L), { compressed: true, sort });
  } else {
    if (is0) {
      return concatBytes(Uint8Array.of(64), new Uint8Array(2 * L - 1));
    } else {
      return concatBytes(numberToBytesBE(x, L), numberToBytesBE(y, L));
    }
  }
}
function signatureG1ToBytes(point) {
  point.assertValidity();
  const { BYTES: L, ORDER: P2 } = Fp2;
  const { x, y } = point.toAffine();
  if (point.is0())
    return COMPZERO.slice();
  const sort = Boolean(y * _2n7 / P2);
  return setMask(numberToBytesBE(x, L), { compressed: true, sort });
}
function pointG1FromBytes(bytes) {
  const { compressed, infinity, sort, value } = parseMask(bytes);
  const { BYTES: L, ORDER: P2 } = Fp2;
  if (value.length === 48 && compressed) {
    const compressedValue = bytesToNumberBE(value);
    const x = Fp2.create(compressedValue & bitMask(Fp2.BITS));
    if (infinity) {
      if (x !== _0n9)
        throw new Error("invalid G1 point: non-empty, at infinity, with compression");
      return { x: _0n9, y: _0n9 };
    }
    const right = Fp2.add(Fp2.pow(x, _3n6), Fp2.create(bls12_381_CURVE_G1.b));
    let y = Fp2.sqrt(right);
    if (!y)
      throw new Error("invalid G1 point: compressed point");
    if (y * _2n7 / P2 !== BigInt(sort))
      y = Fp2.neg(y);
    return { x: Fp2.create(x), y: Fp2.create(y) };
  } else if (value.length === 96 && !compressed) {
    const x = bytesToNumberBE(value.subarray(0, L));
    const y = bytesToNumberBE(value.subarray(L));
    if (infinity) {
      if (x !== _0n9 || y !== _0n9)
        throw new Error("G1: non-empty point at infinity");
      return bls12_381.G1.Point.ZERO.toAffine();
    }
    return { x: Fp2.create(x), y: Fp2.create(y) };
  } else {
    throw new Error("invalid G1 point: expected 48/96 bytes");
  }
}
function signatureG1FromBytes(hex3) {
  const { infinity, sort, value } = parseMask(ensureBytes("signatureHex", hex3, 48));
  const P2 = Fp2.ORDER;
  const Point = bls12_381.G1.Point;
  const compressedValue = bytesToNumberBE(value);
  if (infinity)
    return Point.ZERO;
  const x = Fp2.create(compressedValue & bitMask(Fp2.BITS));
  const right = Fp2.add(Fp2.pow(x, _3n6), Fp2.create(bls12_381_CURVE_G1.b));
  let y = Fp2.sqrt(right);
  if (!y)
    throw new Error("invalid G1 point: compressed");
  const aflag = BigInt(sort);
  if (y * _2n7 / P2 !== aflag)
    y = Fp2.neg(y);
  const point = Point.fromAffine({ x, y });
  point.assertValidity();
  return point;
}
function pointG2ToBytes(_c, point, isComp) {
  const { BYTES: L, ORDER: P2 } = Fp2;
  const is0 = point.is0();
  const { x, y } = point.toAffine();
  if (isComp) {
    if (is0)
      return concatBytes(COMPZERO, numberToBytesBE(_0n9, L));
    const flag2 = Boolean(y.c1 === _0n9 ? y.c0 * _2n7 / P2 : y.c1 * _2n7 / P2);
    return concatBytes(setMask(numberToBytesBE(x.c1, L), { compressed: true, sort: flag2 }), numberToBytesBE(x.c0, L));
  } else {
    if (is0)
      return concatBytes(Uint8Array.of(64), new Uint8Array(4 * L - 1));
    const { re: x0, im: x1 } = Fp22.reim(x);
    const { re: y0, im: y1 } = Fp22.reim(y);
    return concatBytes(numberToBytesBE(x1, L), numberToBytesBE(x0, L), numberToBytesBE(y1, L), numberToBytesBE(y0, L));
  }
}
function signatureG2ToBytes(point) {
  point.assertValidity();
  const { BYTES: L } = Fp2;
  if (point.is0())
    return concatBytes(COMPZERO, numberToBytesBE(_0n9, L));
  const { x, y } = point.toAffine();
  const { re: x0, im: x1 } = Fp22.reim(x);
  const { re: y0, im: y1 } = Fp22.reim(y);
  const tmp = y1 > _0n9 ? y1 * _2n7 : y0 * _2n7;
  const sort = Boolean(tmp / Fp2.ORDER & _1n9);
  const z2 = x0;
  return concatBytes(setMask(numberToBytesBE(x1, L), { sort, compressed: true }), numberToBytesBE(z2, L));
}
function pointG2FromBytes(bytes) {
  const { BYTES: L, ORDER: P2 } = Fp2;
  const { compressed, infinity, sort, value } = parseMask(bytes);
  if (!compressed && !infinity && sort || !compressed && infinity && sort || sort && infinity && compressed) {
    throw new Error("invalid encoding flag: " + (bytes[0] & 224));
  }
  const slc = (b, from, to) => bytesToNumberBE(b.slice(from, to));
  if (value.length === 96 && compressed) {
    if (infinity) {
      if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
        throw new Error("invalid G2 point: compressed");
      }
      return { x: Fp22.ZERO, y: Fp22.ZERO };
    }
    const x_1 = slc(value, 0, L);
    const x_0 = slc(value, L, 2 * L);
    const x = Fp22.create({ c0: Fp2.create(x_0), c1: Fp2.create(x_1) });
    const right = Fp22.add(Fp22.pow(x, _3n6), bls12_381_CURVE_G2.b);
    let y = Fp22.sqrt(right);
    const Y_bit = y.c1 === _0n9 ? y.c0 * _2n7 / P2 : y.c1 * _2n7 / P2 ? _1n9 : _0n9;
    y = sort && Y_bit > 0 ? y : Fp22.neg(y);
    return { x, y };
  } else if (value.length === 192 && !compressed) {
    if (infinity) {
      if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
        throw new Error("invalid G2 point: uncompressed");
      }
      return { x: Fp22.ZERO, y: Fp22.ZERO };
    }
    const x1 = slc(value, 0 * L, 1 * L);
    const x0 = slc(value, 1 * L, 2 * L);
    const y1 = slc(value, 2 * L, 3 * L);
    const y0 = slc(value, 3 * L, 4 * L);
    return { x: Fp22.fromBigTuple([x0, x1]), y: Fp22.fromBigTuple([y0, y1]) };
  } else {
    throw new Error("invalid G2 point: expected 96/192 bytes");
  }
}
function signatureG2FromBytes(hex3) {
  const { ORDER: P2 } = Fp2;
  const { infinity, sort, value } = parseMask(ensureBytes("signatureHex", hex3));
  const Point = bls12_381.G2.Point;
  const half = value.length / 2;
  if (half !== 48 && half !== 96)
    throw new Error("invalid compressed signature length, expected 96/192 bytes");
  const z1 = bytesToNumberBE(value.slice(0, half));
  const z2 = bytesToNumberBE(value.slice(half));
  if (infinity)
    return Point.ZERO;
  const x1 = Fp2.create(z1 & bitMask(Fp2.BITS));
  const x2 = Fp2.create(z2);
  const x = Fp22.create({ c0: x2, c1: x1 });
  const y2 = Fp22.add(Fp22.pow(x, _3n6), bls12_381_CURVE_G2.b);
  let y = Fp22.sqrt(y2);
  if (!y)
    throw new Error("Failed to find a square root");
  const { re: y0, im: y1 } = Fp22.reim(y);
  const aflag1 = BigInt(sort);
  const isGreater = y1 > _0n9 && y1 * _2n7 / P2 !== aflag1;
  const is0 = y1 === _0n9 && y0 * _2n7 / P2 !== aflag1;
  if (isGreater || is0)
    y = Fp22.neg(y);
  const point = Point.fromAffine({ x, y });
  point.assertValidity();
  return point;
}
var bls12_381 = bls({
  fields: {
    Fp: Fp2,
    Fp2: Fp22,
    Fp6,
    Fp12,
    Fr: bls12_381_Fr
  },
  G1: {
    ...bls12_381_CURVE_G1,
    Fp: Fp2,
    htfDefaults: { ...htfDefaults, m: 1, DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" },
    wrapPrivateKey: true,
    allowInfinityPoint: true,
    isTorsionFree: (c, point) => {
      const beta = BigInt("0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffe");
      const phi = new c(Fp2.mul(point.X, beta), point.Y, point.Z);
      const xP = point.multiplyUnsafe(BLS_X).negate();
      const u2P = xP.multiplyUnsafe(BLS_X);
      return u2P.equals(phi);
    },
    clearCofactor: (_c, point) => {
      return point.multiplyUnsafe(BLS_X).add(point);
    },
    mapToCurve: mapToG1,
    fromBytes: pointG1FromBytes,
    toBytes: pointG1ToBytes,
    ShortSignature: {
      fromBytes(bytes) {
        abytes(bytes);
        return signatureG1FromBytes(bytes);
      },
      fromHex(hex3) {
        return signatureG1FromBytes(hex3);
      },
      toBytes(point) {
        return signatureG1ToBytes(point);
      },
      toRawBytes(point) {
        return signatureG1ToBytes(point);
      },
      toHex(point) {
        return bytesToHex(signatureG1ToBytes(point));
      }
    }
  },
  G2: {
    ...bls12_381_CURVE_G2,
    Fp: Fp22,
    hEff: BigInt("0xbc69f08f2ee75b3584c6a0ea91b352888e2a8e9145ad7689986ff031508ffe1329c2f178731db956d82bf015d1212b02ec0ec69d7477c1ae954cbc06689f6a359894c0adebbf6b4e8020005aaa95551"),
    htfDefaults: { ...htfDefaults },
    wrapPrivateKey: true,
    allowInfinityPoint: true,
    mapToCurve: mapToG2,
    isTorsionFree: (c, P2) => {
      return P2.multiplyUnsafe(BLS_X).negate().equals(G2psi(c, P2));
    },
    clearCofactor: (c, P2) => {
      const x = BLS_X;
      let t1 = P2.multiplyUnsafe(x).negate();
      let t2 = G2psi(c, P2);
      let t3 = P2.double();
      t3 = G2psi2(c, t3);
      t3 = t3.subtract(t2);
      t2 = t1.add(t2);
      t2 = t2.multiplyUnsafe(x).negate();
      t3 = t3.add(t2);
      t3 = t3.subtract(t1);
      const Q = t3.subtract(P2);
      return Q;
    },
    fromBytes: pointG2FromBytes,
    toBytes: pointG2ToBytes,
    Signature: {
      fromBytes(bytes) {
        abytes(bytes);
        return signatureG2FromBytes(bytes);
      },
      fromHex(hex3) {
        return signatureG2FromBytes(hex3);
      },
      toBytes(point) {
        return signatureG2ToBytes(point);
      },
      toRawBytes(point) {
        return signatureG2ToBytes(point);
      },
      toHex(point) {
        return bytesToHex(signatureG2ToBytes(point));
      }
    }
  },
  params: {
    ateLoopSize: BLS_X,
    r: bls12_381_CURVE_G1.n,
    xNegative: true,
    twistType: "multiplicative"
  },
  htfDefaults,
  hash: sha256
});
var isogenyMapG2 = isogenyMap(Fp22, [
  [
    [
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6",
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6"
    ],
    [
      "0x0",
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71a"
    ],
    [
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71e",
      "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38d"
    ],
    [
      "0x171d6541fa38ccfaed6dea691f5fb614cb14b4e7f4e810aa22d6108f142b85757098e38d0f671c7188e2aaaaaaaa5ed1",
      "0x0"
    ]
  ],
  [
    [
      "0x0",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa63"
    ],
    [
      "0xc",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa9f"
    ],
    ["0x1", "0x0"]
  ],
  [
    [
      "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706",
      "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706"
    ],
    [
      "0x0",
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97be"
    ],
    [
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71c",
      "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38f"
    ],
    [
      "0x124c9ad43b6cf79bfbf7043de3811ad0761b0f37a1e26286b0e977c69aa274524e79097a56dc4bd9e1b371c71c718b10",
      "0x0"
    ]
  ],
  [
    [
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb"
    ],
    [
      "0x0",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa9d3"
    ],
    [
      "0x12",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa99"
    ],
    ["0x1", "0x0"]
  ]
].map((i) => i.map((pair) => Fp22.fromBigTuple(pair.map(BigInt)))));
var isogenyMapG1 = isogenyMap(Fp2, [
  [
    "0x11a05f2b1e833340b809101dd99815856b303e88a2d7005ff2627b56cdb4e2c85610c2d5f2e62d6eaeac1662734649b7",
    "0x17294ed3e943ab2f0588bab22147a81c7c17e75b2f6a8417f565e33c70d1e86b4838f2a6f318c356e834eef1b3cb83bb",
    "0xd54005db97678ec1d1048c5d10a9a1bce032473295983e56878e501ec68e25c958c3e3d2a09729fe0179f9dac9edcb0",
    "0x1778e7166fcc6db74e0609d307e55412d7f5e4656a8dbf25f1b33289f1b330835336e25ce3107193c5b388641d9b6861",
    "0xe99726a3199f4436642b4b3e4118e5499db995a1257fb3f086eeb65982fac18985a286f301e77c451154ce9ac8895d9",
    "0x1630c3250d7313ff01d1201bf7a74ab5db3cb17dd952799b9ed3ab9097e68f90a0870d2dcae73d19cd13c1c66f652983",
    "0xd6ed6553fe44d296a3726c38ae652bfb11586264f0f8ce19008e218f9c86b2a8da25128c1052ecaddd7f225a139ed84",
    "0x17b81e7701abdbe2e8743884d1117e53356de5ab275b4db1a682c62ef0f2753339b7c8f8c8f475af9ccb5618e3f0c88e",
    "0x80d3cf1f9a78fc47b90b33563be990dc43b756ce79f5574a2c596c928c5d1de4fa295f296b74e956d71986a8497e317",
    "0x169b1f8e1bcfa7c42e0c37515d138f22dd2ecb803a0c5c99676314baf4bb1b7fa3190b2edc0327797f241067be390c9e",
    "0x10321da079ce07e272d8ec09d2565b0dfa7dccdde6787f96d50af36003b14866f69b771f8c285decca67df3f1605fb7b",
    "0x6e08c248e260e70bd1e962381edee3d31d79d7e22c837bc23c0bf1bc24c6b68c24b1b80b64d391fa9c8ba2e8ba2d229"
  ],
  [
    "0x8ca8d548cff19ae18b2e62f4bd3fa6f01d5ef4ba35b48ba9c9588617fc8ac62b558d681be343df8993cf9fa40d21b1c",
    "0x12561a5deb559c4348b4711298e536367041e8ca0cf0800c0126c2588c48bf5713daa8846cb026e9e5c8276ec82b3bff",
    "0xb2962fe57a3225e8137e629bff2991f6f89416f5a718cd1fca64e00b11aceacd6a3d0967c94fedcfcc239ba5cb83e19",
    "0x3425581a58ae2fec83aafef7c40eb545b08243f16b1655154cca8abc28d6fd04976d5243eecf5c4130de8938dc62cd8",
    "0x13a8e162022914a80a6f1d5f43e7a07dffdfc759a12062bb8d6b44e833b306da9bd29ba81f35781d539d395b3532a21e",
    "0xe7355f8e4e667b955390f7f0506c6e9395735e9ce9cad4d0a43bcef24b8982f7400d24bc4228f11c02df9a29f6304a5",
    "0x772caacf16936190f3e0c63e0596721570f5799af53a1894e2e073062aede9cea73b3538f0de06cec2574496ee84a3a",
    "0x14a7ac2a9d64a8b230b3f5b074cf01996e7f63c21bca68a81996e1cdf9822c580fa5b9489d11e2d311f7d99bbdcc5a5e",
    "0xa10ecf6ada54f825e920b3dafc7a3cce07f8d1d7161366b74100da67f39883503826692abba43704776ec3a79a1d641",
    "0x95fc13ab9e92ad4476d6e3eb3a56680f682b4ee96f7d03776df533978f31c1593174e4b4b7865002d6384d168ecdd0a",
    "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
  ],
  [
    "0x90d97c81ba24ee0259d1f094980dcfa11ad138e48a869522b52af6c956543d3cd0c7aee9b3ba3c2be9845719707bb33",
    "0x134996a104ee5811d51036d776fb46831223e96c254f383d0f906343eb67ad34d6c56711962fa8bfe097e75a2e41c696",
    "0xcc786baa966e66f4a384c86a3b49942552e2d658a31ce2c344be4b91400da7d26d521628b00523b8dfe240c72de1f6",
    "0x1f86376e8981c217898751ad8746757d42aa7b90eeb791c09e4a3ec03251cf9de405aba9ec61deca6355c77b0e5f4cb",
    "0x8cc03fdefe0ff135caf4fe2a21529c4195536fbe3ce50b879833fd221351adc2ee7f8dc099040a841b6daecf2e8fedb",
    "0x16603fca40634b6a2211e11db8f0a6a074a7d0d4afadb7bd76505c3d3ad5544e203f6326c95a807299b23ab13633a5f0",
    "0x4ab0b9bcfac1bbcb2c977d027796b3ce75bb8ca2be184cb5231413c4d634f3747a87ac2460f415ec961f8855fe9d6f2",
    "0x987c8d5333ab86fde9926bd2ca6c674170a05bfe3bdd81ffd038da6c26c842642f64550fedfe935a15e4ca31870fb29",
    "0x9fc4018bd96684be88c9e221e4da1bb8f3abd16679dc26c1e8b6e6a1f20cabe69d65201c78607a360370e577bdba587",
    "0xe1bba7a1186bdb5223abde7ada14a23c42a0ca7915af6fe06985e7ed1e4d43b9b3f7055dd4eba6f2bafaaebca731c30",
    "0x19713e47937cd1be0dfd0b8f1d43fb93cd2fcbcb6caf493fd1183e416389e61031bf3a5cce3fbafce813711ad011c132",
    "0x18b46a908f36f6deb918c143fed2edcc523559b8aaf0c2462e6bfe7f911f643249d9cdf41b44d606ce07c8a4d0074d8e",
    "0xb182cac101b9399d155096004f53f447aa7b12a3426b08ec02710e807b4633f06c851c1919211f20d4c04f00b971ef8",
    "0x245a394ad1eca9b72fc00ae7be315dc757b3b080d4c158013e6632d3c40659cc6cf90ad1c232a6442d9d3f5db980133",
    "0x5c129645e44cf1102a159f748c4a3fc5e673d81d7e86568d9ab0f5d396a7ce46ba1049b6579afb7866b1e715475224b",
    "0x15e6be4e990f03ce4ea50b3b42df2eb5cb181d8f84965a3957add4fa95af01b2b665027efec01c7704b456be69c8b604"
  ],
  [
    "0x16112c4c3a9c98b252181140fad0eae9601a6de578980be6eec3232b5be72e7a07f3688ef60c206d01479253b03663c1",
    "0x1962d75c2381201e1a0cbd6c43c348b885c84ff731c4d59ca4a10356f453e01f78a4260763529e3532f6102c2e49a03d",
    "0x58df3306640da276faaae7d6e8eb15778c4855551ae7f310c35a5dd279cd2eca6757cd636f96f891e2538b53dbf67f2",
    "0x16b7d288798e5395f20d23bf89edb4d1d115c5dbddbcd30e123da489e726af41727364f2c28297ada8d26d98445f5416",
    "0xbe0e079545f43e4b00cc912f8228ddcc6d19c9f0f69bbb0542eda0fc9dec916a20b15dc0fd2ededda39142311a5001d",
    "0x8d9e5297186db2d9fb266eaac783182b70152c65550d881c5ecd87b6f0f5a6449f38db9dfa9cce202c6477faaf9b7ac",
    "0x166007c08a99db2fc3ba8734ace9824b5eecfdfa8d0cf8ef5dd365bc400a0051d5fa9c01a58b1fb93d1a1399126a775c",
    "0x16a3ef08be3ea7ea03bcddfabba6ff6ee5a4375efa1f4fd7feb34fd206357132b920f5b00801dee460ee415a15812ed9",
    "0x1866c8ed336c61231a1be54fd1d74cc4f9fb0ce4c6af5920abc5750c4bf39b4852cfe2f7bb9248836b233d9d55535d4a",
    "0x167a55cda70a6e1cea820597d94a84903216f763e13d87bb5308592e7ea7d4fbc7385ea3d529b35e346ef48bb8913f55",
    "0x4d2f259eea405bd48f010a01ad2911d9c6dd039bb61a6290e591b36e636a5c871a5c29f4f83060400f8b49cba8f6aa8",
    "0xaccbb67481d033ff5852c1e48c50c477f94ff8aefce42d28c0f9a88cea7913516f968986f7ebbea9684b529e2561092",
    "0xad6b9514c767fe3c3613144b45f1496543346d98adf02267d5ceef9a00d9b8693000763e3b90ac11e99b138573345cc",
    "0x2660400eb2e4f3b628bdd0d53cd76f2bf565b94e72927c1cb748df27942480e420517bd8714cc80d1fadc1326ed06f7",
    "0xe0fa1d816ddc03e6b24255e0d7819c171c40f65e273b853324efcd6356caa205ca2f570f13497804415473a1d634b8f",
    "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
  ]
].map((i) => i.map((j) => BigInt(j))));
var G1_SWU = mapToCurveSimpleSWU(Fp2, {
  A: Fp2.create(BigInt("0x144698a3b8e9433d693a02c96d4982b0ea985383ee66a8d8e8981aefd881ac98936f8da0e0f97f5cf428082d584c1d")),
  B: Fp2.create(BigInt("0x12e2908d11688030018b12e8753eee3b2016c1f0f24f4070a0b9c14fcef35ef55a23215a316ceaa5d1cc48e98e172be0")),
  Z: Fp2.create(BigInt(11))
});
var G2_SWU = mapToCurveSimpleSWU(Fp22, {
  A: Fp22.create({ c0: Fp2.create(_0n9), c1: Fp2.create(BigInt(240)) }),
  B: Fp22.create({ c0: Fp2.create(BigInt(1012)), c1: Fp2.create(BigInt(1012)) }),
  Z: Fp22.create({ c0: Fp2.create(BigInt(-2)), c1: Fp2.create(BigInt(-1)) })
});
function mapToG1(scalars) {
  const { x, y } = G1_SWU(Fp2.create(scalars[0]));
  return isogenyMapG1(x, y);
}
function mapToG2(scalars) {
  const { x, y } = G2_SWU(Fp22.fromBigTuple(scalars));
  return isogenyMapG2(x, y);
}

// src-luck-3057fb8/packages/beacon/src/index.ts
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
var DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
var relayMirror = () => {
  try {
    const l = globalThis.location;
    return l && /^https?:$/.test(l.protocol) && l.origin ? [l.origin + "/api/beacon"] : [];
  } catch {
    return [];
  }
};
var defaultMirrors = (net = QUICKNET) => [...net.mirrors, ...relayMirror()];
var DOWN_FOR = 40;
var askCount = 0;
var downUntil = new Map;
var isDown = (m) => (downUntil.get(m) ?? 0) > askCount;
var roundBytes = (r) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(r));
  return b;
};
function verifyRound(x, net = QUICKNET) {
  try {
    if (!Number.isInteger(x.round) || x.round < 1)
      return false;
    const sig = hexToBytes(x.signature);
    if (bytesToHex(sha2562(sig)) !== x.randomness)
      return false;
    const msg = bls12_381.shortSignatures.hash(sha2562(roundBytes(x.round)), DST);
    return bls12_381.shortSignatures.verify(sig, msg, hexToBytes(net.publicKey));
  } catch {
    return false;
  }
}
async function fetchRound(r, opts = {}, salt = 0) {
  const net = opts.net ?? QUICKNET;
  askCount++;
  const all = opts.mirrors ?? defaultMirrors(net);
  const rotated = all.map((_, i) => all[(i + salt) % all.length]);
  const mirrors = [...rotated.filter((m) => !isDown(m)), ...rotated.filter(isDown)];
  const f = opts.fetcher ?? fetch;
  const HEDGE_MS = opts.hedgeMs ?? 1200;
  return new Promise((resolve) => {
    let launched = 0, finished = 0, won = false;
    const ctls = [];
    const timers = [];
    const finish = (x) => {
      if (won)
        return;
      won = true;
      timers.forEach(clearTimeout);
      ctls.forEach((c) => {
        try {
          c.abort();
        } catch {}
      });
      resolve(x);
    };
    const launch = () => {
      if (won || launched >= mirrors.length)
        return;
      const m = mirrors[launched];
      launched++;
      const ctl = new AbortController;
      ctls.push(ctl);
      const ms = opts.timeoutMs ?? 6000;
      let to;
      Promise.race([
        f(`${m}/${net.chainHash}/public/${r}`, { signal: ctl.signal }),
        new Promise((_, rej) => {
          to = setTimeout(() => {
            ctl.abort();
            rej(new Error("timeout"));
          }, ms);
        })
      ]).finally(() => clearTimeout(to)).then(async (res) => {
        downUntil.delete(m);
        if (!res.ok)
          return null;
        const x = await res.json();
        return (opts.verify ?? verifyRound)(x, net) && (r === "latest" || x.round === r) ? x : null;
      }).catch(() => {
        downUntil.set(m, askCount + DOWN_FOR);
        return null;
      }).then((x) => {
        finished++;
        if (x)
          return finish(x);
        if (finished >= mirrors.length)
          return finish(null);
        launch();
      });
      if (launched < mirrors.length)
        timers.push(setTimeout(launch, HEDGE_MS));
    };
    launch();
  });
}

// src-luck-3057fb8/packages/beacon/src/game.ts
var BACKFILL_SKIP = 100;

class RoundStore {
  opts;
  verify;
  rounds = new Map;
  verified = new Set;
  discarded = 0;
  backfills = { asked: 0, skipUntil: new Map };
  constructor(opts = {}, verify = (x) => verifyRound(x, opts.net)) {
    this.opts = opts;
    this.verify = verify;
  }
  async fetchLive(r, salt = 0, mirrors) {
    if (this.verified.has(r))
      return true;
    const x = await fetchRound(r, { ...this.opts, ...mirrors ? { mirrors } : {}, verify: (y) => this.verify(y) }, salt);
    if (!x)
      return false;
    this.rounds.set(r, x);
    this.verified.add(r);
    return true;
  }
  async fetchBackfill(r, salt = 0) {
    if (this.rounds.has(r))
      return true;
    const mirrors = this.opts.mirrors ?? defaultMirrors();
    const answers = [];
    const bf = this.backfills;
    bf.asked++;
    const lately = (m) => (bf.skipUntil.get(m) ?? 0) > bf.asked;
    for (let i = 0;i < mirrors.length && answers.length < 2; i++) {
      const m = mirrors[(i + salt) % mirrors.length];
      if (lately(m))
        continue;
      const x = await fetchRound(r, { ...this.opts, mirrors: [m], verify: (y) => !!y && y.round === r && typeof y.signature === "string" && typeof y.randomness === "string" }, 0);
      if (x) {
        answers.push(x);
        bf.skipUntil.delete(m);
      } else
        bf.skipUntil.set(m, bf.asked + BACKFILL_SKIP);
    }
    if (answers.length < 2) {
      const late = mirrors.filter(lately), live = mirrors.filter((m) => !lately(m));
      if (!late.length || !live.length)
        return this.fetchLive(r, salt);
      return this.fetchLive(r, 0, [...live.map((_, i) => live[(i + salt) % live.length]), ...late]);
    }
    if (answers[0].signature !== answers[1].signature || answers[0].randomness !== answers[1].randomness)
      return this.fetchLive(r, salt);
    this.rounds.set(r, answers[0]);
    return true;
  }
  verifySome(max = 1) {
    let n = 0;
    for (const [r, x] of this.rounds) {
      if (this.verified.has(r))
        continue;
      if (n >= max)
        break;
      n++;
      if (this.verify(x))
        this.verified.add(r);
      else {
        this.rounds.delete(r);
        this.discarded++;
      }
    }
    return this.pending();
  }
  pending() {
    let p = 0;
    for (const r of this.rounds.keys())
      if (!this.verified.has(r))
        p++;
    return p;
  }
  async verifyAll() {
    while (this.verifySome(1) > 0)
      await new Promise((r) => setTimeout(r, 0));
  }
}

// src-luck-3057fb8/apps/edge/src/cancel.ts
var RESCHEDULE_WINDOW_MS = 365 * 86400000;
var rescheduleUntilMs = (cancelledMs) => cancelledMs + RESCHEDULE_WINDOW_MS;

// src-luck-3057fb8/apps/edge/src/lifecycle.ts
var GENESIS2 = 1692803367;
var roundMs = (r) => (GENESIS2 + (r - 1) * 3) * 1000;
var PURGE_AFTER_MS = 20 * 3600000;
var REPORT_LINK_MS = 19 * 3600000;
var REPORT_AFTER_MS = 3 * 60000;
var UNPLAYED_WARN_MS = 6 * 3600000;
var SETTINGS_KEEP_MS = 30 * 86400000;
var PAID_WINDOW_MS = 365 * 86400000;
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

// games/luck/engine.ts
var toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
var asBytes = (d) => d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
var sha256Bytes = (d) => createHash("sha256").update(d).digest();
var sha256Sync = (s) => createHash("sha256").update(s).digest("hex");
var ent = 19088743;
var setEntropy = (seed) => {
  ent = mix32(seed ^ 1540483477) | 0;
};
var shim = {
  subtle: {
    digest: (alg, data) => {
      const a = typeof alg === "string" ? alg : alg?.name;
      if (a !== "SHA-256")
        return Promise.reject(new Error("generator shim: only SHA-256 exists here"));
      return Promise.resolve(toAB(sha256Bytes(asBytes(data))));
    }
  },
  getRandomValues: (arr) => {
    const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0;i < u.length; i++) {
      ent = ent + 2654435769 | 0;
      u[i] = mix32(ent) & 255;
    }
    return arr;
  }
};
try {
  Object.defineProperty(globalThis, "crypto", { value: shim, configurable: true, writable: true });
} catch {
  globalThis.crypto = shim;
}
if (globalThis.crypto !== shim)
  throw new Error("generator shim could not replace globalThis.crypto");
function runSync(f) {
  let done = false, failed = false, val, err;
  f().then((v) => {
    done = true;
    val = v;
  }, (e) => {
    done = true;
    failed = true;
    err = e;
  });
  jsc.drainMicrotasks();
  if (!done)
    throw new Error("generator: an engine call did not finish inside one turn (it waited for something other than a hash)");
  if (failed)
    throw err;
  return val;
}
var KAT = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"]
];
var shimProblem = (() => {
  try {
    for (const [msg, want] of KAT) {
      if (sha256Sync(msg) !== want)
        return `the shim's SHA-256 of "${msg.slice(0, 8)}" differs from the published test vector`;
      const viaBun = new globalThis.Bun.CryptoHasher("sha256").update(msg).digest("hex");
      if (viaBun !== want)
        return "Bun's own hasher disagrees with the published test vector";
      const viaEngine = runSync(() => sha256Hex(msg));
      if (viaEngine !== want)
        return `the engine's sha256Hex (through the shim) of "${msg.slice(0, 8)}" differs from the published test vector`;
    }
    return null;
  } catch (e) {
    return "shim self-check crashed: " + String(e?.message ?? e);
  }
})();

// games/luck/oracle.ts
import { createHash as createHash2 } from "crypto";
var H = (s) => createHash2("sha256").update(s).digest("hex");
function drawBelow(seed, label, n) {
  const limit = Math.floor(4294967296 / n) * n;
  for (let k = 0;; k++) {
    const v = parseInt(H(`${seed}|${label}#${k}|0`).slice(0, 8), 16);
    if (v < limit)
      return v % n;
  }
}
var oTarget = (gid, g, a) => 1 + drawBelow(`LBC-TARGET|${gid}|${g}|${a}`, "t", 6);
var oDice = (gid, seat, g, b) => 1 + drawBelow(`LBC-DICE|${gid}|${seat}|${g}|${b}`, "d", 6);
var oFate = (gid, label, seat, beacon) => BigInt("0x" + H(`LBC-FATE|${gid}|${label}|${seat}|${beacon}`));
var oNewTally = (seat) => ({ seat, points: 0, best: 0, hits: 0, fives: 0, last: -1 });
var oPoints = (nf, target, dice, pressed = true) => nf ? pressed ? [10, 5, 3, 1][Math.min(3, Math.abs(target - dice))] : 0 : dice === target ? target : 0;
function oAdd(t, nf, g, pts, target) {
  if (pts <= 0)
    return;
  t.points += pts;
  t.last = g;
  if (nf) {
    if (pts === 10)
      t.hits++;
    if (pts === 5)
      t.fives++;
  } else {
    t.hits++;
    if (target > t.best)
      t.best = target;
  }
}
var pad = (n, w) => String(n).padStart(w, "0");
var oKey = (t, nf) => nf ? `${pad(1e5 - t.points, 6)}${pad(1e5 - t.hits, 6)}${pad(1e5 - t.fives, 6)}${pad(t.last + 1, 5)}` : `${pad(1e5 - t.points, 6)}${pad(10 - t.best, 2)}${pad(1e5 - t.hits, 6)}${pad(t.last + 1, 5)}`;
var WORDS = { points: "points", best: "the highest single hit", hits: "the most hits", earliest: "who reached the score first", fate: "fate (a number from the public beacon)", exact: "the most exact hits", fives: "the most 5-point hits" };
function oMeasure(a, b, nf) {
  if (a.points !== b.points)
    return "points";
  if (nf) {
    if (a.hits !== b.hits)
      return "exact";
    if (a.fives !== b.fives)
      return "fives";
  } else {
    if (a.best !== b.best)
      return "best";
    if (a.hits !== b.hits)
      return "hits";
  }
  return a.last !== b.last ? "earliest" : "fate";
}
function oRank(gid, label, beacon, tallies, nf, top = 10) {
  const keyed = tallies.map((t) => ({ t, k: oKey(t, nf) })).sort((a, b) => a.k < b.k ? -1 : a.k > b.k ? 1 : a.t.seat - b.t.seat);
  const order = [];
  let fateUsed = false, cutTie = false;
  for (let i = 0;i < keyed.length; ) {
    let j = i + 1;
    while (j < keyed.length && keyed[j].k === keyed[i].k)
      j++;
    const grp = keyed.slice(i, j).map((x) => x.t);
    if (grp.length > 1 && i < top) {
      fateUsed = true;
      if (j > top && i < top)
        cutTie = true;
      const f = new Map(grp.map((t) => [t.seat, oFate(gid, label, t.seat, beacon)]));
      grp.sort((a, b) => {
        const x = f.get(a.seat), y = f.get(b.seat);
        return x < y ? -1 : x > y ? 1 : a.seat - b.seat;
      });
    }
    order.push(...grp);
    i = j;
  }
  const n = Math.min(top, order.length), out = [];
  for (let p = 0;p < n; p++) {
    const t = order[p], prev = p > 0 ? order[p - 1] : undefined, next = order[p + 1];
    const tp = !!prev && prev.points === t.points, tn = !!next && next.points === t.points;
    const m = tp ? oMeasure(prev, t, nf) : tn ? oMeasure(t, next, nf) : null;
    out.push({ place: p + 1, seat: t.seat, points: t.points, decided: m, line: m ? `Tied on ${t.points} point${t.points === 1 ? "" : "s"}; decided by ${WORDS[m]}.` : "" });
  }
  return { top: out, order, fateUsed, cutTie };
}
function oPrizes(prizeMode, oneWin, rounds, overall, texts) {
  const out = [], won = new Set;
  const one = (name, list, tx) => {
    const places = Math.min(5, tx.length);
    if (!oneWin) {
      for (let p2 = 1;p2 <= places; p2++) {
        const text = tx[p2 - 1];
        const s = list[p2 - 1];
        if (!text || s === undefined)
          continue;
        won.add(s);
        out.push({ ranking: name, place: p2, seat: s, prize: text });
      }
      return;
    }
    let p = 1;
    for (let i = 0;i < list.length && p <= places; i++) {
      const text = tx[p - 1];
      if (!text) {
        p++;
        continue;
      }
      if (won.has(list[i]))
        continue;
      won.add(list[i]);
      out.push({ ranking: name, place: p, seat: list[i], prize: text });
      p++;
    }
  };
  if (prizeMode !== "overall")
    rounds.forEach((r, i) => one(`round-${i + 1}`, r, texts.rounds[i] ?? []));
  if (prizeMode !== "rounds")
    one("overall", overall, texts.overall);
  return out;
}
function oSched(rounds, diceRounds, windowSecs, revealSecs, breakSecs, start) {
  const G = rounds * diceRounds, open = [], close = [], revEnd = [];
  let t = start;
  for (let g = 0;g < G; g++) {
    open.push(t);
    close.push(t + windowSecs * 1000);
    revEnd.push(t + (windowSecs + revealSecs) * 1000);
    t = revEnd[g];
    if ((g + 1) % diceRounds === 0 && g + 1 < G)
      t += breakSecs * 1000;
  }
  return { open, close, revEnd, end: revEnd[G - 1], G };
}
var oBeaconDue = (s, i) => i % 2 === 0 ? s.open[i / 2] : s.close[(i - 1) / 2];
function oPhase(s, start, diceRounds, now) {
  if (now < start)
    return { kind: "before" };
  if (now >= s.end)
    return { kind: "over" };
  for (let g = 0;g < s.G; g++) {
    if (now < s.open[g])
      return { kind: "break", afterRound: g / diceRounds };
    if (now < s.close[g])
      return { kind: "window", g };
    if (now < s.revEnd[g])
      return { kind: "reveal", g };
  }
  return { kind: "over" };
}
var MAX_TIMED = 28800;
function oResolve(maxPause, lead, log) {
  const ps = [];
  let stop = null;
  const ignored = [];
  let applied = 0;
  const endOf = (p) => Math.min(p.ended ?? Infinity, p.until ?? p.start + maxPause);
  for (const m of [...log].sort((a, b) => a.seq - b.seq)) {
    const cur = ps.length ? ps[ps.length - 1] : null;
    let ok;
    if (stop !== null)
      ok = false;
    else if (m.signedAt > m.at)
      ok = false;
    else {
      const L = m.at - m.signedAt, inPause = !!cur && cur.start <= m.at && m.at < endOf(cur);
      if (m.action === "pause")
        ok = L >= lead && !(cur && m.at < endOf(cur)) && !(m.until !== undefined && (m.until <= m.at || m.until - m.at > MAX_TIMED));
      else if (m.action === "resume")
        ok = inPause && L >= 1 && m.at > cur.start;
      else if (m.action === "extend")
        ok = inPause && cur.ended === null && L >= lead && m.until !== undefined && m.until - m.at <= MAX_TIMED && m.until > endOf(cur);
      else
        ok = L >= lead;
    }
    if (!ok) {
      ignored.push(m.seq);
      continue;
    }
    applied++;
    if (m.action === "pause")
      ps.push({ start: m.at, until: m.until ?? null, ended: null });
    else if (m.action === "resume")
      ps[ps.length - 1].ended = m.at;
    else if (m.action === "extend")
      ps[ps.length - 1].until = m.until;
    else
      stop = m.at;
  }
  return { intervals: ps.map((p) => ({ start: p.start, end: endOf(p) })), stop, ignored, applied };
}
function oCalls(intervals, stop, start, stride, count) {
  const out = [];
  let due = start, r = start;
  while (out.length < count) {
    if (stop !== null && r >= stop) {
      out.push(null);
      continue;
    }
    const iv = intervals.find((i) => r >= i.start && r < i.end);
    if (iv) {
      due += iv.end - r;
      r = iv.end;
      continue;
    }
    if (r === due) {
      out.push(r);
      due += stride;
    }
    r++;
  }
  return out;
}

// games/luck/kinds1.ts
var throws = (f) => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};
var spaced = (rng, s) => rng.chance(0.15) ? `  ${s.split(" ").join("   ")}  ` : s;
function genSettings(rng, nf, rounds) {
  const win = nf ? 10 : rng.pick([6, 10, 15]);
  const pmGiven = nf ? rng.chance(0.5) ? rng.weighted([["both", 40], ["overall", 30], ["rounds", 30]]) : undefined : rng.weighted([["both", 40], ["overall", 30], ["rounds", 30]]);
  const ow = rng.chance(0.5);
  const mkList = (maxLen) => {
    const len = rng.int(0, maxLen), xs = [];
    for (let i = 0;i < len; i++)
      xs.push(rng.chance(0.15) ? "" : spaced(rng, rng.pick(CLEAN_PRIZES)));
    return xs;
  };
  const overall = rng.chance(0.8) ? mkList(5) : [];
  const lists = [];
  if (rng.chance(0.5)) {
    const cnt = rng.int(0, Math.min(rounds, nf ? 22 : rounds));
    for (let i = 0;i < cnt; i++)
      lists.push(mkList(rng.pick([0, 1, 2, 3, 5])));
  }
  const inp = { oneWinPerPlayer: ow, prizes: { overall, rounds: lists } };
  if (pmGiven !== undefined)
    inp.prizeMode = pmGiven;
  if (nf) {
    inp.newFlow = true;
    const sm = rng.pick([undefined, "auto", "manual"]);
    if (sm)
      inp.startMode = sm;
    if (rng.chance(0.3)) {
      inp.rounds = 99;
      inp.windowSecs = 7;
    }
  } else {
    inp.rounds = rng.chance(0.15) ? String(rounds) : rounds;
    inp.windowSecs = win;
  }
  const exp = nf ? { rounds: 22, windowSecs: 10, prizeMode: pmGiven ?? "overall", oneWinPerPlayer: ow, diceRounds: 1, revealSecs: 3, breakSecs: 7, newFlow: true } : { rounds, windowSecs: win, prizeMode: pmGiven, oneWinPerPlayer: ow, diceRounds: 10, revealSecs: 3, breakSecs: 20 };
  if (nf && inp.startMode)
    exp.startMode = inp.startMode;
  exp.prizes = { overall: overall.map(tidy), rounds: lists.map((l) => l.map(tidy)) };
  return { inp, exp, rounds: nf ? 22 : rounds, nf };
}
function sameSettings(ck, got, exp, what) {
  for (const k of ["rounds", "windowSecs", "prizeMode", "oneWinPerPlayer", "diceRounds", "revealSecs", "breakSecs", "newFlow", "startMode"])
    ck.same(got[k], exp[k], "S-01", `${what} ${k}`);
  ck.json(got.prizes, exp.prizes, "S-01", `${what} prizes`);
  if (exp.newFlow)
    for (const k of ["rounds", "windowSecs", "diceRounds", "revealSecs", "breakSecs"])
      ck.same(got[k], exp[k], "S-04", `new flow ${k}`);
}
function cmpRank(ck, eng, orc, label) {
  ck.same(eng.length, orc.top.length, "G-06", `${label}: places listed`);
  const m = Math.min(eng.length, orc.top.length);
  for (let p = 0;p < m; p++) {
    const e = eng[p], o = orc.top[p];
    if (e.seat !== o.seat)
      ck.same(e.seat, o.seat, "G-06", `${label} place ${p + 1} seat`);
    else
      ck.checks++;
    if (e.points !== o.points)
      ck.same(e.points, o.points, "G-06", `${label} place ${p + 1} points`);
    else
      ck.checks++;
    const rule = p < orc.top.length - 1 ? "G-10" : "G-11";
    if ((e.decidedBy ?? null) !== o.decided)
      ck.same(e.decidedBy, o.decided, rule, `${label} place ${p + 1} decided by`);
    else
      ck.checks++;
    if (e.line !== o.line)
      ck.same(e.line, o.line, rule, `${label} place ${p + 1} line`);
    else
      ck.checks++;
  }
}
var tieLabel = (orc) => orc.fateUsed ? orc.cutTie ? "fate-at-cut" : "fate" : orc.top.some((x, i) => i > 0 && x.points === orc.top[i - 1].points) ? "points" : "none";
var toO = (t) => ({ seat: t.seat, points: t.points, best: t.best, hits: t.hits, fives: t.fives ?? 0, last: t.reachedAt });
function gameKind(rng, ck, dims, tr) {
  const nf = rng.chance(0.3);
  const rounds0 = nf ? 22 : rng.weighted([[1, 40], [2, 25], [3, 12], [4, 6], [5, 3], [6, 3], [8, 3], [10, 3], [14, 2], [20, 1.5]]);
  const D = nf ? 1 : 10, G0 = rounds0 * D;
  let n = rng.weighted([[2, 8], [3, 12], [4, 12], [5, 12], [6, 10], [7, 8], [8, 7], [10, 8], [12, 6], [16, 4], [24, 4], [40, 3], [80, 2.5], [200, 0.8], [500, 0.2]]);
  const cap = rng.weighted([[40, 45], [100, 32], [260, 15], [900, 6], [2600, 2]]);
  while (n > 2 && n * G0 > cap)
    n = Math.max(2, Math.floor(n / 2));
  const gen = genSettings(rng, nf, rounds0);
  const gid = "G" + rng.hex(4), bseed = rng.u32(), start = 1700000000000 + rng.int(0, 999999) * 1000;
  const rate3 = nf ? rng.weighted([[1, 50], [0.9, 30], [0.5, 20]]) : 1;
  const endAt = rounds0 >= 2 && rng.chance(nf ? 0.1 : 0.15) ? rng.int(1, rounds0 - 1) : 0;
  const endCallG = endAt ? rng.int((endAt - 1) * D, endAt * D) : -1;
  const params = { k: "game", gid, bseed, n, nf, inp: gen.inp, rate: rate3, endAt, endCallG, start };
  const ps = parseSettings(gen.inp);
  if (!ck.ok(ps.ok, "S-01", () => JSON.stringify(ps)))
    return params;
  const settings = ps.value;
  sameSettings(ck, settings, gen.exp, "parsed");
  const br = new Rng(bseed, 77), A = [], B = [], pressed = [];
  for (let g = 0;g < G0; g++) {
    A.push(br.hex(6));
    B.push(br.hex(6));
  }
  for (let g = 0;g < G0; g++) {
    if (!nf || rate3 === 1) {
      pressed.push(undefined);
      continue;
    }
    const s = new Set;
    for (let seat = 0;seat < n; seat++)
      if (br.chance(rate3))
        s.add(seat);
    pressed.push(s);
  }
  const game2 = new LuckGame(gid, settings, n);
  let G = G0;
  runSync(async () => {
    for (let g = 0;g < G; g++) {
      if (g === endCallG) {
        const rBefore = game2.settings.rounds, want = (m) => Number.isInteger(m) && m >= 1 && m < rBefore && m * D >= g;
        for (const bad of [0, -1, 1.5, rounds0, rounds0 + 1, NaN])
          ck.same(game2.endAfterRound(bad), want(bad), "G-13", `end after ${bad} (${g} dice rounds played)`);
        const passed = Math.ceil(g / D) - 1;
        if (passed >= 1)
          ck.same(game2.endAfterRound(passed), want(passed), "G-13", `end after round ${passed}, already past`);
        ck.same(game2.settings.rounds, rBefore, "G-13", "a refused end changes nothing");
        ck.same(game2.endAfterRound(endAt), want(endAt), "G-13", `end after round ${endAt}`);
        G = endAt * D;
        if (g >= G)
          break;
      }
      await game2.addDiceRound(g, A[g], B[g], pressed[g]);
    }
  });
  const st = game2.settings, R = st.rounds, Gf = R * D;
  ck.same(R, endAt || rounds0, "G-13", "rounds after the end call");
  ck.same(game2.done, Gf, "G-12", "dice rounds played");
  ck.ok(game2.finished, "G-12", () => "not finished");
  const totalT = Array.from({ length: n }, (_, i) => oNewTally(i));
  const roundT = Array.from({ length: R }, () => Array.from({ length: n }, (_, i) => oNewTally(i)));
  for (let g = 0;g < Gf; g++) {
    const res = game2.results[g], target = oTarget(gid, g, A[g]), r = Math.floor(g / D), pr = pressed[g];
    if (res.target !== target)
      ck.same(res.target, target, "G-01", `target of dice round ${g}`);
    else
      ck.checks++;
    for (let s = 0;s < n; s++) {
      const dice = oDice(gid, s, g, B[g]), pts = oPoints(nf, target, dice, pr ? pr.has(s) : true);
      if (res.dice[s] !== dice)
        ck.same(res.dice[s], dice, "G-02", `dice of seat ${s}, dice round ${g}`);
      else
        ck.checks++;
      if (res.points[s] !== pts)
        ck.same(res.points[s], pts, "G-03", `score of seat ${s}, dice round ${g}`);
      else
        ck.checks++;
      oAdd(totalT[s], nf, g, pts, target);
      oAdd(roundT[r][s], nf, g, pts, target);
    }
  }
  for (let s = 0;s < n; s++) {
    const t = game2.total[s], o = totalT[s];
    ck.same(t.points, o.points, "G-04", `seat ${s} points`);
    ck.same(t.hits, o.hits, "G-04", `seat ${s} hits`);
    if (nf)
      ck.same(t.fives, o.fives, "G-04", `seat ${s} 5-point hits`);
    else
      ck.same(t.best, o.best, "G-04", `seat ${s} best hit`);
    ck.same(t.reachedAt, o.last, "G-05", `seat ${s} last scoring dice round`);
    let sum = 0, sumHits = 0;
    for (let r = 0;r < R; r++) {
      sum += game2.roundTallies[r][s].points;
      sumHits += game2.roundTallies[r][s].hits;
    }
    ck.same(sum, t.points, "G-04", `seat ${s} rounds add up (points)`);
    ck.same(sumHits, t.hits, "G-04", `seat ${s} rounds add up (hits)`);
    for (let r = 0;r < R; r++) {
      const a = game2.roundTallies[r][s], b = roundT[r][s];
      if (a.points !== b.points || a.hits !== b.hits)
        ck.same(`${a.points}/${a.hits}`, `${b.points}/${b.hits}`, "G-04", `seat ${s} round ${r + 1}`);
      else
        ck.checks++;
    }
  }
  const rr = runSync(async () => {
    const out = [];
    for (let r = 1;r <= R; r++)
      out.push(await game2.roundRanking(r));
    return out;
  });
  const ov = runSync(() => game2.overallRanking());
  let ovO;
  for (let r = 1;r <= R; r++) {
    const o = oRank(gid, `round-${r}`, B[r * D - 1], roundT[r - 1], nf);
    cmpRank(ck, rr[r - 1], o, `round ${r}`);
  }
  ovO = oRank(gid, "overall", B[Gf - 1], totalT, nf);
  cmpRank(ck, ov, ovO, "overall");
  ck.same(ov.length, Math.min(10, n), "G-06", "overall list length");
  ck.same(new Set(ov.map((x) => x.seat)).size, ov.length, "G-06", "a player listed twice");
  if (rng.chance(0.4)) {
    const sh = runSync(() => rankTop(gid, "overall", B[Gf - 1], rng.shuffle(game2.total)));
    ck.json(sh.map((x) => x.seat), ov.map((x) => x.seat), "G-07", "shuffled input");
  }
  for (let i = 0;i < 2; i++) {
    const s = rng.int(0, n - 1), me = oKey(toO(game2.total[s]), nf), ahead = game2.total.filter((t, j) => j !== s && oKey(toO(t), nf) < me).length;
    const sd = standingOf(game2.total, s);
    ck.same(sd.ahead, ahead, "G-09", `ahead of seat ${s}`);
    ck.same(sd.of, n, "G-09", "players");
    ck.same(sd.percent, Math.max(1, Math.ceil((ahead + 1) / Math.max(1, n) * 100)), "G-09", `percent of seat ${s}`);
  }
  const lists = rr.map((l) => l.map((x) => x.seat)), ovList = ov.map((x) => x.seat);
  const wE = assignPrizes(st, rr, ov), wO = oPrizes(st.prizeMode, st.oneWinPerPlayer, lists, ovList, st.prizes);
  ck.json(wE.map((w) => [w.ranking, w.place, w.seat, w.prize]), wO.map((w) => [w.ranking, w.place, w.seat, w.prize]), "G-14", "who gets which gift");
  ck.ok(wE.every((w) => st.prizeMode === "overall" ? w.ranking === "overall" : st.prizeMode === "rounds" ? w.ranking !== "overall" : true), "G-15", () => "prize mode " + st.prizeMode);
  if (st.oneWinPerPlayer)
    ck.same(new Set(wE.map((w) => w.seat)).size, wE.length, "G-15", "a player won twice");
  else
    for (const w of wE) {
      const l = w.ranking === "overall" ? ovList : lists[Number(w.ranking.slice(6)) - 1];
      if (l[w.place - 1] !== w.seat)
        ck.same(w.seat, l[w.place - 1], "G-14", `${w.ranking} place ${w.place}`);
      else
        ck.checks++;
    }
  const sch = oSched(R, D, st.windowSecs, st.revealSecs, st.breakSecs, start);
  for (let g = 0;g < Gf; g++) {
    const a = diceOpenMs(st, start, g), b = windowCloseMs(st, start, g), c = revealEndMs(st, start, g);
    if (a !== sch.open[g] || b !== sch.close[g] || c !== sch.revEnd[g])
      ck.same(`${a}/${b}/${c}`, `${sch.open[g]}/${sch.close[g]}/${sch.revEnd[g]}`, "T-01", `times of dice round ${g}`);
    else
      ck.checks++;
    if (beaconDueMs(st, start, 2 * g) !== sch.open[g] || beaconDueMs(st, start, 2 * g + 1) !== sch.close[g])
      ck.same(`${beaconDueMs(st, start, 2 * g)}/${beaconDueMs(st, start, 2 * g + 1)}`, `${sch.open[g]}/${sch.close[g]}`, "T-03", `public numbers of dice round ${g}`);
    else
      ck.checks++;
  }
  ck.same(gameEndMs(st, start), sch.end, "T-01", "end of the game");
  const times = [start - 1, start, sch.end - 1, sch.end, sch.end + 7777];
  for (let i = 0;i < 3; i++) {
    const g = rng.int(0, Gf - 1);
    times.push(sch.open[g] - 1, sch.open[g], sch.close[g] - 1, sch.close[g], sch.revEnd[g] - 1, sch.revEnd[g]);
  }
  times.push(rng.int(start, sch.end), rng.int(start, sch.end));
  for (const t of times) {
    const pe = phaseAt(st, start, t), po = oPhase(sch, start, D, t);
    const same = pe.kind === po.kind && (po.kind === "window" || po.kind === "reveal" ? pe.g === po.g : po.kind === "break" ? pe.afterRound === po.afterRound : true);
    ck.ok(same, "T-02", () => `at ${t - start} ms: engine ${JSON.stringify(pe)}, oracle ${JSON.stringify(po)}`);
  }
  if (rng.chance(0.3)) {
    const g2 = new LuckGame(gid, settings, 3);
    ck.ok(throws(() => runSync(() => g2.addDiceRound(1, "a", "b"))), "G-12", () => "out-of-order dice round accepted");
    ck.ok(throws(() => runSync(() => g2.addDiceRound(0, "", "b"))), "G-12", () => "missing target number accepted");
    ck.ok(throws(() => runSync(() => g2.addDiceRound(0, "a", ""))), "G-12", () => "missing dice number accepted");
    ck.ok(throws(() => runSync(() => g2.overallRanking())), "G-12", () => "ranking before play accepted");
    ck.ok(throws(() => runSync(() => g2.roundRanking(1))), "G-12", () => "ranking an unfinished round accepted");
    runSync(() => g2.addDiceRound(0, "aa", "bb"));
    ck.ok(throws(() => runSync(() => g2.addDiceRound(0, "aa", "bb"))), "G-12", () => "a dice round played twice");
  }
  dims.mode = nf ? "new-flow" : "classic";
  dims.players = bucketN(n);
  dims.rounds = bucketR(rounds0, nf);
  dims.window = st.windowSecs;
  dims.prize_mode = st.prizeMode;
  dims.one_win = st.oneWinPerPlayer ? "yes" : "no";
  dims.press = nf ? rate3 === 1 ? "all" : rate3 === 0.9 ? "most" : "half" : "n/a";
  dims.end = endAt ? "organizer-ended" : "ran-to-end";
  dims.tie = tieLabel(ovO);
  if (tr)
    tr(`game ${gid}: ${nf ? "new flow" : "classic"} ${rounds0} rounds, ${n} players, press rate ${rate3}, ended after round ${endAt || "-"}; overall winner seat ${ov[0].seat} with ${ov[0].points} points; ${wE.length} prizes`);
  return params;
}
var gridPairs = (() => {
  const xs = [];
  for (let p = 0;p < 3; p++)
    for (let b = 0;b < 3; b++)
      for (let h = 0;h < 3; h++)
        for (let l = -1;l < 2; l++)
          xs.push([p, b, h, l]);
  return xs;
})();
function rankKind(rng, ck, dims, tr, seed) {
  const nf = rng.chance(0.4);
  const n = rng.weighted([[2, 6], [3, 8], [5, 12], [8, 12], [11, 12], [12, 12], [15, 12], [20, 10], [30, 8], [60, 5], [150, 2]]);
  const style = rng.weighted([["random", 25], ["groups", 25], ["all-equal", 12], ["cut", 25], ["pairs", 13]]);
  const mk = (seat, p, b, h, f, last) => ({ seat, points: p, hits: h, best: nf ? 0 : b, reachedAt: last, ...nf ? { nf: true, fives: f } : {} });
  const tpl = () => [rng.int(0, 4), rng.int(0, 3), rng.int(0, 3), rng.int(0, 2), rng.int(-1, 3)];
  const rows = [];
  if (style === "random")
    for (let i = 0;i < n; i++)
      rows.push(tpl());
  else if (style === "groups") {
    const ts = Array.from({ length: rng.int(1, 4) }, tpl);
    for (let i = 0;i < n; i++)
      rows.push(rng.pick(ts));
  } else if (style === "all-equal") {
    const t = tpl();
    for (let i = 0;i < n; i++)
      rows.push(t);
  } else if (style === "pairs") {
    for (let i = 0;i < n; i += 2) {
      const t = tpl();
      rows.push(t);
      if (i + 1 < n)
        rows.push(t);
    }
  } else {
    const m2 = rng.int(2, 8), at = rng.int(Math.max(0, 9 - m2 + 1), 9), t = [3, 2, 2, 1, 2];
    for (let i = 0;i < n; i++)
      rows.push(i >= at && i < at + m2 ? t : [rng.int(4, 9), rng.int(0, 3), rng.int(0, 3), rng.int(0, 2), rng.int(-1, 3)]);
    if (n > at + m2)
      for (let i = at + m2;i < n; i++)
        rows[i] = [rng.int(0, 2), rng.int(0, 3), rng.int(0, 3), rng.int(0, 2), rng.int(-1, 3)];
  }
  const tallies = rows.map((r, i) => mk(i, r[0], r[1], r[2], r[3], r[4]));
  const gid = "R" + rng.hex(3), label = rng.pick(["overall", "round-1", "round-7"]), beacon = rng.hex(6);
  const params = { k: "rank", gid, label, beacon, nf, style, rows: rows.map((r) => r.join(",")).join(";") };
  const eng = runSync(() => rankTop(gid, label, beacon, tallies));
  const orc = oRank(gid, label, beacon, tallies.map(toO), nf);
  ck.same(eng.length, orc.top.length, "G-06", "places listed");
  const m = Math.min(eng.length, orc.top.length), seatRule = orc.fateUsed ? "G-08" : "G-06";
  for (let p = 0;p < m; p++) {
    const e = eng[p], o = orc.top[p];
    if (e.seat !== o.seat)
      ck.same(e.seat, o.seat, seatRule, `place ${p + 1} seat`);
    else
      ck.checks++;
    const rule = p < orc.top.length - 1 ? "G-10" : "G-11";
    if ((e.decidedBy ?? null) !== o.decided)
      ck.same(e.decidedBy, o.decided, rule, `place ${p + 1} decided by`);
    else
      ck.checks++;
    if (e.line !== o.line)
      ck.same(e.line, o.line, rule, `place ${p + 1} line`);
    else
      ck.checks++;
  }
  const sh = runSync(() => rankTop(gid, label, beacon, rng.shuffle(tallies)));
  ck.json(sh.map((x) => x.seat), eng.map((x) => x.seat), orc.fateUsed ? "G-08" : "G-07", "shuffled input");
  for (let i = 0;i < 6; i++) {
    const a = tallies[rng.int(0, n - 1)], b = tallies[rng.int(0, n - 1)], ka = oKey(toO(a), nf), kb = oKey(toO(b), nf);
    ck.same(Math.sign(cmpNumeric(a, b)), ka < kb ? -1 : ka > kb ? 1 : 0, "G-06", `compare seat ${a.seat} with seat ${b.seat}`);
    ck.same(Math.sign(cmpNumeric(a, b)), -Math.sign(cmpNumeric(b, a)), "G-06", "comparison is symmetric");
    if (ka !== kb)
      ck.same(measureBetween(a, b), oMeasure(toO(a), toO(b), nf) === "exact" || oMeasure(toO(a), toO(b), nf) === "fives" ? oMeasure(toO(a), toO(b), nf) : oMeasure(toO(a), toO(b), nf), "G-10", "measure between two tallies");
  }
  if (seed % 2000 === 0) {
    for (const nfx of [false, true])
      for (const x of gridPairs)
        for (const y of gridPairs) {
          const a = { seat: 0, points: x[0], best: nfx ? 0 : x[1], hits: x[2], reachedAt: x[3], ...nfx ? { nf: true, fives: x[1] } : {} }, b = { seat: 1, points: y[0], best: nfx ? 0 : y[1], hits: y[2], reachedAt: y[3], ...nfx ? { nf: true, fives: y[1] } : {} };
          const ka = oKey(toO(a), nfx), kb = oKey(toO(b), nfx);
          if (Math.sign(cmpNumeric(a, b)) !== (ka < kb ? -1 : ka > kb ? 1 : 0))
            ck.same(Math.sign(cmpNumeric(a, b)), ka < kb ? -1 : ka > kb ? 1 : 0, "G-06", `grid ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
          else
            ck.checks++;
        }
  }
  dims.mode = nf ? "new-flow" : "classic";
  dims.players = bucketN(n);
  dims.tie = tieLabel(orc);
  dims.tie_style = style;
  if (tr)
    tr(`rank ${style}: ${n} made-up tallies, top seats ${eng.map((x) => x.seat).join(",")}`);
  return params;
}
var M_ROUNDS = "A game has 1 to 20 rounds.";
var M_WINDOW = "The press window is 6, 10 or 15 seconds.";
var M_PM = "Prizes are for each round, for the overall result, or both.";
var M_MORE = "There are more prize lists than rounds.";
var M_START = "The game starts by itself at the set time (auto) or when you press start (manual).";
var M_PLACES = (w) => `${w}: at most 5 places have a prize.`;
var M_MONEY = (w) => `${w}: A prize is a gift you hand over, not money. Please describe the gift.`;
var M_LONG = (w) => `${w}: A prize text is at most 120 characters.`;
var M_TEXT = (w) => `${w}: A prize is written as text.`;
var words = (len) => {
  let s = "";
  while (s.length < len)
    s += "word ";
  s = s.slice(0, len);
  return s.endsWith(" ") ? s.slice(0, -1) + "x" : s;
};
function settingsKind(rng, ck, dims, tr) {
  const c = rng.weighted([["valid", 20], ["newflow-valid", 12], ["rounds", 7], ["window", 7], ["prizemode", 6], ["too-many", 6], ["money", 9], ["length", 7], ["not-text", 5], ["more-lists", 5], ["startmode", 5], ["two-wrong", 6], ["garbage-input", 3], ["extra-keys", 3]]);
  const nf = c === "newflow-valid" || c === "startmode" || c === "more-lists" && rng.chance(0.3);
  const rounds = rng.int(1, 20), g = genSettings(rng, nf, rounds);
  const inp = g.inp;
  let err = null, rule = "S-02";
  let expectOk = true;
  const salt = rng.u32();
  const listIdx = () => {
    const L = inp.prizes.rounds.length;
    return rng.chance(0.5) || L === 0 ? -1 : rng.int(0, L - 1);
  };
  const slot = () => {
    const li = listIdx();
    const arr = li < 0 ? inp.prizes.overall : inp.prizes.rounds[li];
    return { arr, what: li < 0 ? "Overall prizes" : `Round ${li + 1} prizes` };
  };
  if (c === "rounds" && !nf) {
    inp.rounds = rng.pick([0, 21, -1, 1.5, 100, "abc", "0", "21", NaN, Infinity]);
    err = M_ROUNDS;
  } else if (c === "window" && !nf) {
    inp.windowSecs = rng.pick([7, 0, 5, 16, 20, "x", "7", -6, NaN]);
    err = M_WINDOW;
  } else if (c === "prizemode") {
    inp.prizeMode = rng.pick(["x", "ALL", "Both", "round", "", 5, null, true]);
    err = M_PM;
  } else if (c === "too-many") {
    const { arr, what } = slot();
    const extra = rng.int(6, 8);
    arr.length = 0;
    for (let i = 0;i < extra; i++)
      arr.push(rng.pick(CLEAN_PRIZES));
    err = M_PLACES(what);
    if (what !== "Overall prizes" && inp.prizes.overall.length > 5)
      err = null;
  } else if (c === "money") {
    const { arr, what } = slot();
    if (arr.length === 0)
      arr.push("");
    const i = rng.int(0, arr.length - 1);
    arr[i] = rng.pick(MONEY_PRIZES);
    err = M_MONEY(what);
  } else if (c === "length") {
    const { arr, what } = slot();
    if (arr.length === 0)
      arr.push("");
    const i = rng.int(0, arr.length - 1), len = rng.pick([119, 120, 120, 121, 121, 150, 400]);
    arr[i] = words(len);
    if (rng.chance(0.3) && len <= 120)
      arr[i] = "  " + arr[i].split(" ").join("    ") + "  ";
    if (len > 120)
      err = M_LONG(what);
  } else if (c === "not-text") {
    const { arr, what } = slot();
    if (arr.length === 0)
      arr.push("");
    arr[rng.int(0, arr.length - 1)] = rng.pick([5, null, true, { a: 1 }, ["x"]]);
    err = M_TEXT(what);
  } else if (c === "more-lists") {
    const R = g.rounds, extra = rng.int(1, 3);
    inp.prizes.rounds = Array.from({ length: R + extra }, () => []);
    err = M_MORE;
  } else if (c === "startmode") {
    inp.startMode = rng.pick(["x", "AUTO", 5, null, "", true]);
    err = M_START;
  } else if (c === "two-wrong") {
    const flags = { r: !nf && rng.chance(0.5), w: !nf && rng.chance(0.5), p: rng.chance(0.5), o: rng.chance(0.5) };
    if (!flags.r && !flags.w && !flags.p && !flags.o)
      flags.p = true;
    if (flags.r)
      inp.rounds = 0;
    if (flags.w)
      inp.windowSecs = 7;
    if (flags.p)
      inp.prizeMode = "bad";
    if (flags.o)
      inp.prizes.overall = ["a", "b", "c", "d", "e", "f"];
    err = flags.r ? M_ROUNDS : flags.w ? M_WINDOW : flags.p ? M_PM : M_PLACES("Overall prizes");
  }
  if (c === "garbage-input") {
    const bad = rng.pick([null, undefined, 5, "text", [], true]);
    const r2 = parseSettings(bad);
    ck.ok(r2.ok, "S-01", () => JSON.stringify(r2));
    if (r2.ok) {
      const d = defaultSettings();
      sameSettings(ck, r2.value, { ...d, prizes: d.prizes }, "defaults");
    }
    dims.settings = "defaults";
    dims.mode = "classic";
    return { k: "settings", c, salt };
  }
  if (c === "extra-keys") {
    inp.fee = 50;
    inp.entryFee = 10;
    inp.price = 5;
    inp.stake = 1;
    inp.cash = "yes";
  }
  expectOk = err === null;
  if (nf && (c === "rounds" || c === "window"))
    expectOk = true;
  const r = parseSettings(inp);
  if (expectOk) {
    if (ck.ok(r.ok, "S-01", () => `refused a good input: ${JSON.stringify(r)} for ${JSON.stringify(inp).slice(0, 300)}`)) {
      const exp = { ...g.exp, prizes: { overall: inp.prizes.overall.map((x) => tidy(x)), rounds: inp.prizes.rounds.map((l) => l.map((x) => tidy(x))) } };
      sameSettings(ck, r.value, exp, c);
      const txt = JSON.stringify(r.value);
      for (const f of ["fee", "entryFee", "price", "stake", "cash"])
        ck.ok(!txt.includes(`"${f}"`), "S-01", () => `an unknown field ${f} was kept`);
    }
  } else if (ck.ok(!r.ok, "S-02", () => `accepted a bad input (${c}): ${JSON.stringify(inp).slice(0, 300)}`)) {
    const rule2 = c === "money" || c === "length" || c === "not-text" ? "S-03" : c === "more-lists" ? "S-05" : c === "startmode" ? "S-04" : "S-02";
    ck.same(r.error, err, rule2, `message for ${c}`);
  }
  dims.settings = expectOk ? "valid" : `invalid:${c}`;
  dims.mode = nf ? "new-flow" : "classic";
  if (tr)
    tr(`settings ${c}: ${expectOk ? "accepted" : "refused with: " + err}`);
  return { k: "settings", c, nf, rounds, salt, inp };
}

// games/luck/harness.ts
import { Database } from "bun:sqlite";
class FakeResponse {
  bodyText;
  status;
  headers;
  constructor(bodyText = "", init = {}) {
    this.bodyText = bodyText;
    this.status = init.status ?? 200;
    this.headers = init.headers ?? {};
  }
  text() {
    return Promise.resolve(this.bodyText);
  }
  json() {
    return Promise.resolve(JSON.parse(this.bodyText));
  }
}
globalThis.Response = FakeResponse;
var DDL = [
  ...LUCK_SCHEMA,
  ...LUCK_PRESS_SCHEMA,
  `CREATE TABLE IF NOT EXISTS life (eid TEXT PRIMARY KEY, end_ms INTEGER NOT NULL, end_src TEXT NOT NULL, report_ms INTEGER, report_state TEXT, purged_ms INTEGER, tries INTEGER NOT NULL DEFAULT 0, notified INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS winner (eid TEXT NOT NULL, round INTEGER NOT NULL, pattern TEXT NOT NULL, ordinal INTEGER NOT NULL, seat INTEGER NOT NULL, idx INTEGER, at_ms INTEGER, src TEXT NOT NULL, PRIMARY KEY (eid, round, pattern, ordinal, seat))`,
  `CREATE TABLE IF NOT EXISTS participant (eid TEXT NOT NULL, pid TEXT NOT NULL, phone_hash TEXT NOT NULL, name TEXT, joined_ms INTEGER NOT NULL, pii TEXT, PRIMARY KEY (eid, pid))`,
  `CREATE TABLE IF NOT EXISTS settled (eid TEXT NOT NULL, pattern TEXT NOT NULL, ordinal INTEGER NOT NULL DEFAULT 1, round INTEGER NOT NULL DEFAULT 1, idx INTEGER NOT NULL, pids TEXT NOT NULL, PRIMARY KEY (eid, pattern, ordinal, round))`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS seat (eid TEXT NOT NULL, seq INTEGER NOT NULL, pid TEXT NOT NULL, ph TEXT NOT NULL, dev TEXT, blocked INTEGER, role TEXT, PRIMARY KEY (eid, seq))`,
  `CREATE TABLE IF NOT EXISTS person (eid TEXT NOT NULL, id TEXT NOT NULL, ph TEXT NOT NULL, pii TEXT NOT NULL, inviter TEXT NOT NULL, role TEXT, status TEXT NOT NULL, tok_hash TEXT, tok_sealed TEXT, approved_by TEXT, approved_ms INTEGER, added_ms INTEGER NOT NULL, joined_ms INTEGER, removed_ms INTEGER, removed_by TEXT, PRIMARY KEY (eid, id))`
];
var TABLES = ["luck_t", "luck_p", "luck_v", "luck_press", "life", "winner", "participant", "settled", "seat", "person"];
var raw = null;
var stmt = (r, sql, vals = []) => ({
  bind: (...v) => stmt(r, sql, v),
  run: async () => {
    const x = r.query(sql).run(...vals);
    return { meta: { changes: x.changes } };
  },
  all: async () => ({ results: r.query(sql).all(...vals) }),
  first: async () => r.query(sql).get(...vals) ?? null
});
function db() {
  if (!raw) {
    raw = new Database(":memory:");
    for (const s of DDL)
      raw.run(s);
  }
  const r = raw;
  return { raw: r, d1: { prepare: (s) => stmt(r, s), batch: async (xs) => Promise.all(xs.map((x) => x.run())) } };
}
function wipe(eid) {
  const { raw: r } = db();
  for (const t of TABLES)
    r.query(`DELETE FROM ${t} WHERE eid=?`).run(eid);
  r.query("DELETE FROM kv WHERE k=?").run(`ann/${eid}`);
}
var budget = { spent: 0 };
function callRoute(eid, c) {
  const { d1 } = db();
  const qs = c.query ? "?" + Object.entries(c.query).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&") : "";
  const ctx = {
    env: { DB: d1 },
    req: { method: c.method ?? "GET" },
    now: c.now,
    eid,
    e: {},
    sub: c.sub,
    url: new URL(`http://x/api/z/${eid}/luck/${c.sub}${qs}`),
    body: async () => c.body === undefined ? null : c.body,
    spend: async (_env, _now, n) => {
      if (c.spendOk === false)
        return false;
      budget.spent += n ?? 1;
      return true;
    },
    allowed: c.allowed === true,
    openName: async (pii) => pii,
    gate: c.gate ?? null,
    BUSY: () => new FakeResponse(JSON.stringify({ error: "busy" }), { status: 503 })
  };
  const res = runSync(() => luckRoute(ctx));
  return { status: res.status, json: runSync(() => res.json()) };
}

// games/luck/kinds2.ts
var PODIUM2 = ["first", "second", "third", "fourth", "fifth"];
var oName = (s) => String(s ?? "").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 24) || "Player";
var NAMES2 = ["Asha", "Ravi Kumar", "  Meera   Iyer ", "<b>Tom</b>", "Sun`ny", "", "   ", "Dr. Anand Subramaniam Venkataraman", "a".repeat(30), "Lakshmi", "Zoya", "Imran", "\u0909\u092A\u0939\u093E\u0930", "x y z", "Priya\tN", "Q"];
var SPACEY = "abcdefghijklmnopqrstuvw xyz tail";
function routeKind(rng, ck, dims, tr) {
  const eid = "L" + rng.hex(5), { raw: raw2 } = db();
  try {
    return play();
  } finally {
    wipe(eid);
  }
  function play() {
    const nfm = rng.chance(0.2), R = nfm ? 22 : rng.weighted([[1, 40], [2, 30], [3, 20], [4, 10]]);
    const gen = genSettings(rng, nfm, R), S0 = parseSettings(gen.inp).value, D = S0.diceRounds;
    const t0 = 1800000000000 + rng.int(0, 999) * 1000;
    let T = t0;
    const call = (sub2, o = {}) => callRoute(eid, { sub: sub2, now: o.now ?? T, method: o.method ?? "GET", allowed: o.allowed ?? false, query: o.query, body: o.body, spendOk: o.spendOk, gate: o.gate });
    const luckRow = () => raw2.query("SELECT * FROM luck_t WHERE eid=?").get(eid);
    const cnt = (t) => raw2.query(`SELECT COUNT(*) AS n FROM ${t} WHERE eid=?`).get(eid).n;
    const parts = [];
    let nextI = 0;
    const addPart = (blocked) => {
      const i = nextI++, pid = `${i}x${rng.hex(2)}`, device = rng.hex(10);
      const name = rng.chance(0.015) ? SPACEY : rng.chance(0.06) ? null : rng.pick(NAMES2);
      raw2.query("INSERT INTO participant(eid,pid,phone_hash,name,joined_ms,pii) VALUES(?,?,?,?,?,?)").run(eid, pid, "h" + i, null, T, name);
      raw2.query("INSERT INTO seat(eid,seq,pid,ph,dev,blocked,role) VALUES(?,?,?,?,?,?,?)").run(eid, i, pid, "h" + i, sha256Sync(`dev|${eid}|${device}`).slice(0, 32), blocked ? 1 : 0, null);
      const p = { pid, i, name, device, blocked };
      parts.push(p);
      return p;
    };
    const nJoin = rng.weighted([[0, 3], [1, 6], [2, 14], [3, 15], [5, 20], [8, 16], [12, 10], [20, 5]]);
    const nBlocked = rng.chance(0.3) ? rng.int(0, Math.min(2, nJoin)) : 0;
    for (let i = 0;i < nJoin; i++)
      addPart(i < nBlocked);
    const freeze = () => parts.filter((p) => !p.blocked).sort((a, b) => a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0);
    const gateCase = rng.chance(0.04);
    const params = { k: "route", eid, nfm, R, inp: gen.inp, nJoin, nBlocked, t0, gate: gateCase };
    if (gateCase) {
      const gate = new FakeResponse(JSON.stringify({ error: "This game was cancelled." }), { status: 409 });
      for (const sub2 of ["view", "start", "beacon", "vote", "end"]) {
        const r = call(sub2, { method: sub2 === "start" || sub2 === "vote" || sub2 === "end" ? "POST" : "GET", gate, allowed: true, body: { settings: gen.inp } });
        ck.same(r.status, 409, "R-13", `${sub2} on a cancelled game`);
        ck.same(r.json.error, "This game was cancelled.", "R-13", `${sub2} gives the gate's answer`);
      }
      ck.same(cnt("luck_t"), 0, "R-13", "nothing was created");
      dims.route = "gate";
      return params;
    }
    const v0 = call("view");
    ck.same(v0.status, 200, "R-04", "view before the start");
    ck.same(v0.json.state, "open", "R-04", "state before the start");
    ck.same(v0.json.joined, parts.length, "R-04", "people who joined");
    ck.ok(/^[0-9a-f]{64}$/.test(v0.json.commit), "R-06", () => `fingerprint ${v0.json.commit}`);
    ck.same(v0.json.commit, sha256Sync(`LBC-COMMIT|${luckRow().secret}`), "R-06", "fingerprint is the hash of the sealed secret");
    ck.same(call("beacon").status, 409, "R-05", "no public number before the start");
    ck.same(call("seats").status, 409, "R-04", "no seat list before the start");
    const role = rng.weighted([["organizer", 30], ["host", 20], ["platform", 10], ["co-host", 10], ["ai-link", 10], ["other-org", 8], ["stranger", 8], ["player", 4]]);
    const allowed = role === "organizer" || role === "host" || role === "platform";
    dims.role = role;
    const startBody = (d) => ({ settings: gen.inp, ...d !== undefined ? { delaySecs: d } : {} });
    if (!allowed) {
      for (const [sub2, body] of [["start", startBody()], ["end", {}], ["tick", {}]]) {
        const r = call(sub2, { method: "POST", allowed: false, body });
        ck.same(r.status, 403, "R-01", `${sub2} as ${role}`);
      }
      ck.same(call("view").json.state, "open", "R-01", "nothing changed");
    }
    const a0 = parts.find((p) => !p.blocked);
    if (a0) {
      ck.same(call("me", { query: { pid: a0.pid, device: a0.device } }).json.phase, "waiting", "R-07", "a player before the start");
      ck.same(call("me", { query: { pid: a0.pid, device: rng.hex(10) } }).json.code, "other-phone", "R-07", "another phone");
      ck.same(call("me", { query: { pid: "nobody", device: a0.device } }).status, 403, "R-07", "a stranger");
      ck.same(call("me", { query: { pid: a0.pid, device: "zz" } }).status, 400, "R-07", "a bad device id");
      ck.same(call("vote", { method: "POST", body: { pid: a0.pid, device: a0.device, result: {} } }).status, 409, "R-08", "a vote before the start");
    }
    const b0 = parts.find((p) => p.blocked);
    if (b0) {
      const r = call("me", { query: { pid: b0.pid, device: b0.device } });
      ck.same(r.status, 403, "R-07", "a removed player");
      ck.same(r.json.code, "removed", "R-07", "removed code");
    }
    ck.same(call("tick", { method: "POST", allowed: true }).json.closed, 0, "R-09", "tick with nothing to close");
    let startMs = 0, S = S0, roster = [];
    const bad = rng.chance(0.2);
    if (bad) {
      const badSettings = nfm ? { newFlow: true, prizeMode: "bad" } : rng.pick([{ rounds: 0 }, { rounds: 21 }, { windowSecs: 7, rounds: 2 }, { prizeMode: "x" }, { prizes: { overall: ["a", "b", "c", "d", "e", "f"] } }]);
      const want = parseSettings(badSettings);
      const r = call("start", { method: "POST", allowed: true, body: { settings: badSettings } });
      ck.same(r.status, 400, "R-03", "wrong settings");
      ck.same(r.json.error, want.error, "R-03", "wrong settings in plain words");
      if (!nfm)
        for (const d of [4, 3601, 1.5, 0, -10, "x", NaN]) {
          const r2 = call("start", { method: "POST", allowed: true, body: startBody(d) });
          ck.same(r2.status, 400, "R-03", `delay ${String(d)}`);
          ck.same(r2.json.error, "The game starts 5 seconds to 1 hour after you press start.", "R-03", "delay in plain words");
        }
      ck.same(luckRow().state, "open", "R-03", "still open after refused starts");
    }
    const P0 = freeze().length;
    if (P0 < 2) {
      const r = call("start", { method: "POST", allowed: true, body: startBody() });
      if (nfm) {
        ck.same(r.json.pending, true, "R-14", "new flow waits");
        T = r.json.startMs;
        const v = call("view");
        ck.same(v.json.state, "open", "R-14", "too few at the end of the wait: back to waiting");
        ck.ok(!JSON.parse(luckRow().opts ?? "{}").pendingStartMs, "R-14", () => "still pending");
      } else {
        ck.same(r.status, 409, "R-02", "too few players");
        ck.same(r.json.code, "too-few", "R-02", "code");
        ck.same(r.json.joined, P0, "R-02", "joined count");
        ck.same(r.json.error, `A game needs at least 2 players. ${P0} joined.`, "R-02", "plain words");
      }
      ck.same(luckRow().state, "open", "R-02", "nothing started");
      while (freeze().length < 2)
        addPart(false);
    }
    if (!nfm && rng.chance(0.15)) {
      const b = budget.spent;
      const r = call("start", { method: "POST", allowed: true, body: startBody(), spendOk: false });
      ck.same(r.status, 503, "R-12", "busy");
      ck.same(r.json.error, "busy", "R-12", "busy words");
      ck.same(luckRow().state, "open", "R-12", "nothing changed when busy");
      ck.same(budget.spent, b, "R-12", "nothing spent");
    }
    if (nfm && rng.chance(0.3)) {
      const lateJoin = rng.int(0, 3);
      for (let i = 0;i < lateJoin; i++)
        addPart(false);
      if (rng.chance(0.3)) {
        const p = parts.find((x) => !x.blocked);
        if (p && freeze().length > 2) {
          raw2.query("UPDATE seat SET blocked=1 WHERE eid=? AND pid=?").run(eid, p.pid);
          p.blocked = true;
        }
      }
    }
    const spent0 = budget.spent;
    if (nfm) {
      const r = call("start", { method: "POST", allowed: true, body: startBody() });
      ck.same(r.json.pending, true, "R-14", "new flow: waiting room");
      ck.same(r.json.startMs, T + 120000, "R-14", "120 seconds");
      const pend = r.json.startMs;
      const r2 = call("start", { method: "POST", allowed: true, body: startBody(), now: T + 5000 });
      ck.same(r2.json.pending, true, "R-14", "a second start while waiting");
      ck.same(r2.json.startMs, pend, "R-14", "same waiting end");
      ck.same(call("beacon", { now: pend - 1 }).status, 409, "R-14", "still waiting just before the end");
      ck.same(call("view", { now: pend - 1 }).json.state, "open", "R-14", "open just before the end");
      for (let i = 0;i < rng.int(0, 2); i++)
        addPart(false);
      roster = freeze();
      T = pend;
      startMs = pend;
      const v = call("view");
      ck.same(v.json.state, "running", "R-14", "the list is read when the time is over");
      ck.same(v.json.players, roster.length, "R-14", "players read at that moment");
      ck.same(budget.spent - spent0, roster.length * 2 + 8, "R-12", "budget asked for the start");
    } else {
      const d = rng.pick([undefined, 5, 20, 60, 3600, rng.int(5, 300)]);
      roster = freeze();
      const r = call("start", { method: "POST", allowed: true, body: startBody(d) });
      startMs = t0 + (d ?? 20) * 1000;
      if (T !== t0)
        startMs = T + (d ?? 20) * 1000;
      ck.same(r.status, 200, "R-03", "start");
      ck.same(r.json.ok, true, "R-03", "ok");
      ck.same(r.json.players, roster.length, "R-04", "players");
      ck.same(r.json.startMs, startMs, "R-03", "start time");
      ck.same(r.json.endMs, oSched(S0.rounds, D, S0.windowSecs, S0.revealSecs, S0.breakSecs, startMs).end, "T-01", "end time");
      ck.same(r.json.diceRounds, S0.rounds * D, "T-01", "dice rounds");
      ck.same(r.json.secretShownAt, "reveal", "R-06", "secret shown at reveal");
      ck.same(budget.spent - spent0, roster.length * 2 + 8, "R-12", "budget asked for the start");
      const r2 = call("start", { method: "POST", allowed: true, body: startBody() });
      ck.same(r2.status, 409, "R-03", "a second start");
      ck.same(r2.json.code, "started", "R-03", "started code");
    }
    const vS = call("view");
    S = vS.json.settings;
    ck.json(S, S0, "S-01", "settings kept as the organizer chose");
    ck.same(vS.json.startMs, startMs, "R-03", "start kept");
    ck.same(vS.json.agreed, false, "R-08", "not agreed");
    ck.same(vS.json.endedAfterRound, null, "R-10", "not ended early");
    const sch0 = oSched(S.rounds, D, S.windowSecs, S.revealSecs, S.breakSecs, startMs);
    const seats = call("seats");
    ck.same(seats.json.players, roster.length, "R-04", "seat count");
    ck.json(seats.json.seats, roster.map((p, i) => [i, oName(p.name)]), "R-04", "seats are in the order of the ids, with tidy names");
    for (const [, nm] of seats.json.seats) {
      ck.ok(nm === nm.trim() && nm.length > 0 && nm.length <= 24 && !/[<>`]/.test(nm) && !/\s\s/.test(nm), "R-16", () => `name "${nm}" is not tidy`);
    }
    const pOf = (seat) => roster[seat];
    const late = rng.chance(0.4) ? addPart(false) : null;
    if (late) {
      const r = call("me", { query: { pid: late.pid, device: late.device } });
      ck.same(r.json.phase, "watching", "R-04", "a late joiner watches");
      ck.same(call("seats").json.players, roster.length, "R-04", "a late joiner is not seated");
    }
    if (rng.chance(0.3)) {
      const p = pOf(rng.int(0, roster.length - 1));
      const r = call("me", { query: { pid: p.pid, device: p.device } });
      ck.same(r.json.phase, "playing", "R-07", "a seated player");
      ck.same(r.json.you.seat, roster.indexOf(p), "R-07", "own seat");
      ck.same(r.json.you.name, oName(p.name), "R-07", "own name");
    }
    const secret = luckRow().secret, seedO = H(`LBC-SEED|${secret}|${eid}|${H(`LBC-ROSTER|${roster.map((p) => p.pid).sort().join(",")}`)}`);
    ck.same(luckRow().seed, seedO, "V-01", "seed kept by the server");
    ck.same(luckRow().players, roster.length, "R-04", "players kept");
    const vals = [];
    let G = S.rounds * D;
    const pull = (now) => {
      for (let guard = 0;guard < 4; guard++) {
        const from = vals.length, r = call("beacon", { query: { from }, now });
        ck.same(r.status, 200, "R-05", "beacon call");
        let due = 0;
        const sc = sch();
        for (let i = from;i < 2 * G; i++) {
          if (oBeaconDue(sc, i) > now || due >= 60)
            break;
          due++;
        }
        ck.same(r.json.values.length, due, "R-05", `public numbers due at +${now - startMs} ms from ${from}`);
        ck.same(r.json.total, 2 * G, "R-05", "total");
        ck.same(r.json.serverNow, now, "R-05", "server time");
        ck.same(r.json.next, from + due, "R-05", "next");
        for (const x of r.json.values) {
          ck.same(x.i, vals.length, "R-05", "in order");
          ck.same(x.v, H(`LBC-BEACON|${seedO}|${x.i}`), "V-01", `public number ${x.i}`);
          vals.push(x.v);
        }
        if (due < 60)
          break;
      }
    };
    const sch = () => oSched(S.rounds, D, S.windowSecs, S.revealSecs, S.breakSecs, startMs);
    pull(startMs - 1);
    ck.same(vals.length, 0, "R-05", "nothing before the start");
    pull(startMs);
    ck.same(vals.length, 1, "R-05", "the first target number at the start");
    const endPlan = rng.chance(0.4), tEnd = rng.int(startMs, sch0.end - 1);
    const mid = rng.int(0, G - 1);
    for (const tt of [sch().open[mid], sch().close[mid] - 1])
      pull(endPlan ? Math.min(tt, tEnd) : tt);
    const pressed = Array.from({ length: G }, () => new Set);
    if (nfm) {
      const rate3 = rng.pick([1, 0.9, 0.5]), tests = new Set([rng.int(0, G - 1), rng.int(0, G - 1), 0]);
      for (let g = 0;g < G; g++) {
        const who = roster.filter(() => rng.chance(rate3));
        if (!tests.has(g)) {
          for (const p of who)
            raw2.query("INSERT INTO luck_press(eid,pid,g,at_ms) VALUES(?,?,?,?)").run(eid, p.pid, g, sch().open[g] + 100);
          who.forEach((p) => pressed[g].add(roster.indexOf(p)));
          continue;
        }
        const open = sch().open[g], close = sch().close[g], first = new Map;
        for (const p of who) {
          const at = open + rng.int(0, S.windowSecs * 1000 - 1), r = call("press", { method: "POST", body: { pid: p.pid, device: p.device, g }, now: at });
          ck.same(r.status, 200, "R-11", "a press in the window");
          ck.same(r.json.ok, true, "R-11", "ok");
          first.set(p.pid, at);
          pressed[g].add(roster.indexOf(p));
        }
        const q0 = roster[0], again = call("press", { method: "POST", body: { pid: q0.pid, device: q0.device, g }, now: open + 3 });
        ck.same(again.status, 200, "R-11", "pressing twice");
        const rowAt = raw2.query("SELECT at_ms FROM luck_press WHERE eid=? AND pid=? AND g=?").get(eid, q0.pid, g)?.at_ms;
        if (first.has(q0.pid))
          ck.same(rowAt, first.get(q0.pid), "R-11", "the first press is the one kept");
        else {
          ck.same(rowAt, open + 3, "R-11", "a press made by a late second call");
          pressed[g].add(0);
        }
        const q1 = roster[roster.length - 1];
        if (!first.has(q1.pid)) {
          const r = call("press", { method: "POST", body: { pid: q1.pid, device: q1.device, g }, now: open - 1 });
          ck.same(r.status, 409, "R-11", "a press before the window");
          ck.same(r.json.code, "late", "R-11", "late code");
        }
        if (!first.has(q1.pid)) {
          const r = call("press", { method: "POST", body: { pid: q1.pid, device: q1.device, g }, now: close + 1001 });
          ck.same(r.status, 409, "R-11", "a press after the grace");
          const r2 = call("press", { method: "POST", body: { pid: q1.pid, device: q1.device, g }, now: close + 1000 });
          ck.same(r2.status, 200, "R-11", "a press in the last second of grace");
          pressed[g].add(roster.length - 1);
        }
        for (const bg of [-1, G, 1.5, "x"]) {
          const r = call("press", { method: "POST", body: { pid: q0.pid, device: q0.device, g: bg }, now: open + 5 });
          ck.same(r.status, 400, "R-11", `round ${String(bg)} does not exist`);
        }
        const bs = budget.spent, rb = call("press", { method: "POST", body: { pid: roster[1 % roster.length].pid, device: roster[1 % roster.length].device, g }, now: open + 6, spendOk: false });
        ck.same(rb.status, 503, "R-12", "busy press");
        ck.same(budget.spent, bs, "R-12", "busy press spends nothing");
      }
      for (let g = 0;g < G; g++) {
        const early2 = g === [...tests][0] ? call("presses", { query: { g }, now: sch().close[g] + 999 }) : null;
        if (early2) {
          ck.same(early2.status, 409, "R-11", "who pressed is hidden while the window is open");
          ck.same(early2.json.code, "open-window", "R-11", "code");
        }
        const r = call("presses", { query: { g }, now: sch().close[g] + 1000 });
        ck.same(r.status, 200, "R-11", "who pressed after the window");
        ck.json(r.json.seats, [...pressed[g]].sort((a, b) => a - b), "R-11", `who pressed in dice round ${g}`);
      }
      ck.same(call("presses", { query: { g: G }, now: startMs }).status, 400, "R-11", "presses of a round that does not exist");
    } else {
      const p = roster[0];
      const r = call("press", { method: "POST", body: { pid: p.pid, device: p.device, g: 0 }, now: startMs + 1 });
      ck.same(r.json.ignored, true, "R-11", "press in a classic game is ignored");
      ck.same(call("presses", { query: { g: 0 } }).json.newFlow, false, "R-11", "classic presses");
    }
    let ended = 0;
    if (endPlan) {
      const notYet = call("end", { method: "POST", allowed: true, now: startMs - 1 });
      ck.same(notYet.status, 409, "R-10", "ending before the first dice round");
      ck.same(notYet.json.code, "not-yet", "R-10", "not-yet code");
      if (!allowed)
        ck.same(call("end", { method: "POST", allowed: false, now: startMs + 1000 }).status, 403, "R-01", "end as " + role);
      const ph = oPhase(sch0, startMs, D, tEnd), cur = ph.kind === "break" ? ph.afterRound : Math.floor(ph.g / D) + 1;
      const bs = budget.spent, r = call("end", { method: "POST", allowed: true, now: tEnd });
      if (cur >= S.rounds) {
        ck.same(r.json.last, true, "R-10", "the last round");
        ck.same(r.json.endedAfterRound, S.rounds, "R-10", "last round number");
        ck.same(r.json.endsMs, sch0.end, "R-10", "ends by itself");
      } else {
        ended = cur;
        const want = oSched(cur, D, S.windowSecs, S.revealSecs, S.breakSecs, startMs).end;
        ck.same(r.status, 200, "R-10", "end");
        ck.same(r.json.endedAfterRound, cur, "R-10", "ended after the round now played");
        ck.same(r.json.rounds, cur, "R-10", "rounds");
        ck.same(r.json.endsMs, want, "R-10", "new end time");
        ck.same(budget.spent - bs, 2, "R-12", "budget for ending");
        const again = call("end", { method: "POST", allowed: true, now: tEnd + 1000 });
        ck.same(again.json.again, true, "R-10", "ending twice");
        ck.same(again.json.endedAfterRound, cur, "R-10", "same answer");
        ck.same(again.json.endsMs, want, "R-10", "same end time");
        S = { ...S, rounds: cur };
        G = cur * D;
        const vv = call("view").json;
        ck.same(vv.settings.rounds, cur, "R-10", "view shows the new rounds");
        ck.same(vv.endedAfterRound, cur, "R-10", "view shows the end");
        ck.same(vv.endMs, want, "R-10", "view shows the new end");
        ck.same(call("beacon", { query: { from: 0 }, now: want + 1 }).json.total, 2 * G, "R-10", "the feed stops with the game");
      }
    }
    const endMs = sch().end;
    pull(endMs);
    ck.same(vals.length, 2 * G, "R-05", "all public numbers after the end");
    const overBefore = call("end", { method: "POST", allowed: true, now: endMs + 1 });
    ck.same(overBefore.status, ended ? 200 : 409, "R-10", "ending after the end");
    if (!ended)
      ck.same(overBefore.json.code, "over", "R-10", "over code");
    const game2 = new LuckGame(eid, S, roster.length);
    runSync(async () => {
      for (let g = 0;g < G; g++)
        await game2.addDiceRound(g, vals[2 * g], vals[2 * g + 1], nfm ? pressed[g] : undefined);
    });
    const ov = runSync(() => game2.overallRanking()), rr = runSync(async () => {
      const o = [];
      for (let r = 1;r <= S.rounds; r++)
        o.push(await game2.roundRanking(r));
      return o;
    });
    const lineOf = (x) => ({ seat: x.seat, points: x.points, hits: x.hits, best: x.best, line: x.line });
    const resultA = { overall: ov.map(lineOf), rounds: rr.map((l) => l.map(lineOf)) };
    {
      const tl = Array.from({ length: roster.length }, (_, i) => oNewTally(i));
      for (let g = 0;g < G; g++) {
        const tg = oTarget(eid, g, vals[2 * g]);
        for (let s = 0;s < roster.length; s++)
          oAdd(tl[s], nfm, g, oPoints(nfm, tg, oDice(eid, s, g, vals[2 * g + 1]), nfm ? pressed[g].has(s) : true), tg);
      }
      const orc = oRank(eid, "overall", vals[2 * G - 1], tl, nfm);
      ck.json(ov.map((x) => x.seat).slice(0, 5), orc.top.map((x) => x.seat).slice(0, 5), "G-06", "the first five of the overall list, from the route's numbers");
    }
    const q = quorumFor(roster.length), voters = roster.filter((p) => !p.blocked);
    const early = call("vote", { method: "POST", body: { pid: voters[0].pid, device: voters[0].device, result: resultA }, now: endMs - 1 });
    ck.same(early.status, 409, "R-08", "a vote before the end");
    ck.same(early.json.code, "running", "R-08", "running code");
    if (late) {
      const r = call("vote", { method: "POST", body: { pid: late.pid, device: late.device, result: resultA }, now: endMs + 1000 });
      ck.same(r.status, 409, "R-08", "a late joiner cannot vote");
      ck.same(r.json.code, "watching", "R-08", "watching code");
    }
    {
      const p = voters[0];
      const bad1 = call("vote", { method: "POST", body: { pid: p.pid, device: p.device, result: { overall: [], rounds: [] } }, now: endMs + 1000 });
      ck.same(bad1.status, 400, "R-08", "a result of the wrong shape");
      ck.same(bad1.json.code, "bad-result", "R-08", "bad-result code");
      ck.same(cnt("luck_v"), 0, "R-08", "a refused vote is not kept");
    }
    let kind = rng.weighted([["agree", 34], ["forged", 16], ["split", 8], ["short", 12], ["none", 10], ["dup", 6], ["removed-podium", 6], ["after-end-gap", 4]]);
    if (kind === "removed-podium" && roster.length < q + 1)
      kind = "agree";
    dims.vote = kind;
    let resultB = JSON.parse(JSON.stringify(resultA));
    resultB.overall[0].points += 1;
    const script = [];
    const pickV = (k) => rng.sample(voters, k);
    let removedPodium = null;
    if (kind === "removed-podium") {
      removedPodium = pOf(ov[0].seat);
      if (!removedPodium.blocked) {
        raw2.query("UPDATE seat SET blocked=1 WHERE eid=? AND pid=?").run(eid, removedPodium.pid);
        removedPodium.blocked = true;
      }
    }
    const vs = voters.filter((p) => !p.blocked);
    if (kind === "agree" || kind === "removed-podium" || kind === "after-end-gap")
      for (const p of rng.sample(vs, Math.min(vs.length, q + rng.int(0, 2))))
        script.push({ p, v: "A" });
    else if (kind === "forged") {
      const f = Math.max(1, Math.min(q - 1, vs.length - q));
      const a = rng.sample(vs, Math.min(vs.length, q + f));
      a.forEach((p, i) => script.push({ p, v: i < Math.min(q, a.length - f) ? "A" : "B" }));
      rng.shuffle(script).forEach((x, i) => script[i] = x);
    } else if (kind === "split") {
      const g = Math.min(q, Math.floor(vs.length / 2));
      const a = rng.sample(vs, g * 2);
      a.forEach((p, i) => script.push({ p, v: i % 2 ? "A" : "B" }));
    } else if (kind === "short")
      for (const p of rng.sample(vs, Math.max(0, Math.min(q - 1, vs.length))))
        script.push({ p, v: "A" });
    else if (kind === "dup") {
      const a = rng.sample(vs, Math.min(vs.length, q));
      a.slice(0, q - 1).forEach((p) => script.push({ p, v: "A" }));
      if (a.length)
        script.push({ p: a[0], v: "A" });
      if (a.length >= q)
        script.push({ p: a[q - 1], v: "A" });
    }
    const cast = new Map;
    let done = false, agreedAt = 0, tCur = endMs + 500, agreedWith = null;
    for (const s of script) {
      tCur += 1000 + rng.int(0, 500);
      const res = s.v === "A" ? resultA : resultB, r = call("vote", { method: "POST", body: { pid: s.p.pid, device: s.p.device, result: res }, now: tCur });
      if (s.p.blocked) {
        ck.same(r.status, 403, "R-07", "a removed player cannot vote");
        continue;
      }
      if (done) {
        ck.same(r.json.already, true, "R-08", "a vote after the result is agreed");
        continue;
      }
      ck.same(r.status, 200, "R-08", "a vote");
      cast.set(s.p.pid, s.v);
      const cA = [...cast.values()].filter((x) => x === "A").length, cB = cast.size - cA, top = Math.max(cA, cB), second = Math.min(cA, cB);
      const ag = top >= q && top > second;
      ck.same(r.json.agreed, ag, "R-08", `after ${cast.size} different phones (A ${cA}, B ${cB}, needed ${q})`);
      if (ag) {
        done = true;
        agreedAt = tCur;
        agreedWith = cA > cB ? "A" : "B";
      } else {
        const rk = call("rank", { now: tCur });
        ck.same(rk.json.agreed, false, "R-08", "rank before agreement");
        ck.same(rk.json.votes, cast.size, "R-08", "votes counted");
        ck.same(rk.json.quorum, q, "V-02", "quorum shown");
      }
    }
    const row = luckRow();
    if (done) {
      const res = agreedWith === "A" ? resultA : resultB;
      ck.same(row.state, "done", "R-08", "done");
      ck.same(row.ended_ms, Math.max(endMs, agreedAt), "R-08", "agreed time");
      ck.same(JSON.stringify(JSON.parse(row.result)), JSON.stringify(normalizeResult(res, roster.length, S.rounds)), "V-03", "result kept in one shape");
      const rk = call("rank", { now: agreedAt + 10 }).json;
      ck.same(rk.agreed, true, "R-08", "rank shows the agreed result");
      ck.same(rk.overall.length, res.overall.length, "R-08", "podium length");
      rk.overall.forEach((x, i) => {
        ck.same(x.place, i + 1, "R-08", "place");
        ck.same(x.name, oName(pOf(res.overall[i].seat).name), "R-08", `name of place ${i + 1}`);
        ck.same(x.points, res.overall[i].points, "R-08", "points");
      });
      ck.same(rk.rounds.length, S.rounds, "R-08", "rounds shown");
      const setl = raw2.query("SELECT pattern, pids FROM settled WHERE eid=? ORDER BY pattern").all(eid), byPat = new Map(setl.map((x) => [x.pattern, JSON.parse(x.pids)[0]]));
      for (let i = 0;i < Math.min(5, res.overall.length); i++) {
        const w = pOf(res.overall[i].seat);
        if (w.blocked)
          ck.ok(!byPat.has(PODIUM2[i]), "R-15", () => `${PODIUM2[i]} place went to ${w.pid}, a player the organizer removed`);
        else
          ck.same(byPat.get(PODIUM2[i]), w.pid, "R-08", `${PODIUM2[i]} place recorded`);
      }
      const wins = raw2.query("SELECT pattern, seat, at_ms, src FROM winner WHERE eid=?").all(eid);
      for (const w of wins) {
        ck.same(w.src, "phones", "R-08", "winner source");
        ck.same(w.at_ms, Math.max(endMs, agreedAt), "R-08", "winner time");
      }
      const life = raw2.query("SELECT end_ms, end_src FROM life WHERE eid=?").get(eid);
      ck.same(life?.end_ms, Math.max(endMs, agreedAt), "R-08", "end of life");
      ck.same(life?.end_src, "phones", "R-08", "end of life source");
      const rv = call("reveal", { now: agreedAt + 20 }).json;
      ck.same(rv.revealed, true, "R-06", "revealed");
      ck.same(rv.secret, secret, "R-06", "secret");
      ck.same(rv.seed, seedO, "R-06", "seed");
      ck.same(sha256Sync(`LBC-COMMIT|${rv.secret}`), rv.commit, "R-06", "anyone can recompute the fingerprint");
      ck.same(endBoundLuck(startMs, { end_ms: row.end_ms, ended_ms: row.ended_ms }), row.ended_ms + 60000, "V-04", "close time after agreement");
    } else {
      ck.same(row.state, "running", "R-08", "still running without agreement");
      ck.same(row.result, null, "R-08", "no result");
      const rv0 = call("reveal", { now: tCur + 1 }).json;
      ck.same(rv0.revealed, false, "R-06", "secret hidden while the game is not closed");
      ck.ok(!("secret" in rv0) && !JSON.stringify(rv0).includes(secret), "R-06", () => "the secret leaked");
      ck.same(call("rank", { now: endMs + 600000 }).json.done, false, "R-09", "ten minutes after the end is not yet late");
      ck.same(luckRow().state, "running", "R-09", "still running at exactly ten minutes");
      let closedByTick = -1;
      if (kind === "none")
        closedByTick = runSync(() => luckTick({ DB: db().d1 }, endMs + 600001));
      const rk = call("rank", { now: endMs + 600001 }).json;
      ck.same(rk.done, true, "R-09", "closed after ten minutes");
      ck.same(rk.agreed, false, "R-09", "without a result");
      if (closedByTick >= 0)
        ck.same(closedByTick, 1, "R-09", "the scheduled job closes it");
      const r2 = luckRow();
      ck.same(r2.state, "done", "R-09", "done");
      ck.same(r2.ended_ms, endMs + 600000, "R-09", "closed time");
      ck.same(r2.result, null, "R-09", "no result published");
      const rv = call("reveal", { now: endMs + 600002 }).json;
      ck.same(rv.revealed, true, "R-06", "revealed after closing");
      ck.same(rv.secret, secret, "R-06", "secret");
      ck.same(endBoundLuck(startMs, { end_ms: r2.end_ms, ended_ms: r2.ended_ms }), endMs + 660000, "V-04", "close time without agreement");
      ck.same(cnt("settled"), 0, "R-09", "no winners recorded");
    }
    for (const sub2 of ["pause", "resume", "stop"]) {
      const r = call(sub2, { method: "POST", allowed: true });
      ck.same(r.status, 404, "R-16", `Luck has no ${sub2} route`);
    }
    dims.mode = nfm ? "new-flow" : "classic";
    dims.route = done ? "agreed" : "not-agreed";
    dims.players = roster.length <= 5 ? "2-5" : roster.length <= 12 ? "6-12" : "13+";
    dims.early_end = ended ? "yes" : "no";
    if (tr)
      tr(`route ${eid}: ${nfm ? "new flow" : "classic"} ${S.rounds} rounds, ${roster.length} players, vote ${kind}, ${done ? "agreed" : "not agreed"}`);
    return { ...params, role, kind, ended, late: !!late };
  }
}

// games/luck/kinds3.ts
var PK = "00".repeat(32);
var IST2 = 19800000;
var DAY2 = 86400000;
var toO2 = (m) => ({ seq: m.seq, action: m.action, at: m.atBeaconRound, signedAt: m.signedAtRound, until: m.untilRound });
function controlKind(rng, ck, dims, tr, seed) {
  const lead = rng.pick([SAFETY_FAST.leadRounds, SAFETY_STANDARD.leadRounds, SAFETY_LEAN30.leadRounds, SAFETY_LEAN60.leadRounds, rng.int(2, 60)]);
  const maxPause = rng.pick([20, 60, 600, rng.int(5, 400)]);
  const cfg = { pubKey: PK, maxPauseRounds: maxPause, leadRounds: lead };
  const m = rng.weighted([[1, 10], [2, 25], [3, 25], [4, 20], [6, 12], [8, 8]]);
  const plausible = rng.chance(0.7);
  const msgs = [];
  let at = 1e4 + rng.int(0, 500);
  for (let seq = 1;seq <= m; seq++) {
    const cur = oResolve(maxPause, lead, msgs.map(toO2)), last = cur.intervals.at(-1);
    const action = rng.weighted([["pause", 40], ["resume", 25], ["extend", 15], ["stop", 5]]);
    if (plausible && last && (action === "resume" || action === "extend"))
      at = rng.int(last.start + (action === "resume" ? 1 : 0), Math.max(last.start + 1, last.end - 1));
    else if (plausible && last && action === "pause")
      at = last.end + rng.int(0, 60);
    else
      at += rng.chance(0.05) ? -rng.int(0, 40) : rng.int(0, 120);
    const L = rng.weighted([[lead, 35], [lead + rng.int(1, 30), 25], [lead - 1, 10], [rng.int(0, lead), 10], [1, 10], [-3, 3]]);
    let until;
    if (action === "pause" && rng.chance(0.4))
      until = at + rng.weighted([[rng.int(1, 60), 90], [rng.int(-5, 0), 4], [28801 + rng.int(0, 50), 3], [28800, 3]]);
    if (action === "extend" && rng.chance(0.92))
      until = (last ? last.end : at) + rng.weighted([[rng.int(1, 100), 85], [rng.int(-5, 0), 8], [29000, 3], [28800, 4]]);
    const msg = { engagementId: "E", seq, action, atBeaconRound: at, signedAtRound: at - L, sig: "x" };
    if (until !== undefined)
      msg.untilRound = until;
    msgs.push(msg);
  }
  const first = Math.min(...msgs.map((x) => x.atBeaconRound));
  const stride = rng.int(1, 12), count = 24, early = rng.chance(0.004);
  const params = { k: "control", lead, maxPause, msgs: msgs.map((x) => [x.action, x.atBeaconRound, x.signedAtRound, x.untilRound ?? null].join(",")).join(";"), stride, early };
  const st = resolveControl(cfg, msgs), o = oResolve(maxPause, lead, msgs.map(toO2));
  ck.json(st.intervals, o.intervals, "C-01", "pause intervals");
  ck.same(st.stopRound, o.stop, "C-04", "stop round");
  ck.json(st.ignored.map((x) => x.seq), o.ignored, "C-01", "ignored messages");
  ck.same(st.applied, o.applied, "C-01", "applied messages");
  ck.same(st.applied + st.ignored.length, m, "C-01", "every message is applied or ignored");
  const startRound = early && o.intervals.length ? o.intervals[0].end + rng.int(0, 30) : first - rng.int(0, 50);
  const sch = scheduleWithControl(st, startRound, stride, count);
  if (early && o.intervals.length) {
    ck.same(callRound(st, startRound, stride, 0), startRound, "C-08", `first call after a pause that ended at ${o.intervals[0].end}`);
  } else {
    const want = oCalls(o.intervals, o.stop, startRound, stride, count);
    ck.json(sch, want, "C-02", "call rounds");
    for (let k = 0;k < count; k++) {
      if (sch[k] !== callRound(st, startRound, stride, k))
        ck.same(sch[k], callRound(st, startRound, stride, k), "C-02", "schedule equals call by call");
      else
        ck.checks++;
    }
    const live = sch.filter((x) => x !== null);
    for (let k = 1;k < live.length; k++)
      ck.ok(live[k] > live[k - 1], "C-02", () => "calls out of order");
    if (o.stop !== null)
      for (const x of live)
        ck.ok(x < o.stop, "C-04", () => `call at ${x} on or after the stop at ${o.stop}`);
  }
  for (const iv of o.intervals)
    for (const r of [iv.start - 1, iv.start, iv.end - 1, iv.end])
      ck.same(pausedAt(st, r), o.intervals.some((j) => r >= j.start && r < j.end), "C-03", `paused at ${r} (pause ${iv.start}..${iv.end})`);
  const sh = resolveControl(cfg, rng.shuffle(msgs));
  ck.json([sh.intervals, sh.stopRound, sh.ignored, sh.applied], [st.intervals, st.stopRound, st.ignored, st.applied], "C-07", "shuffled log");
  const open = o.intervals.find((_, i) => !msgs.some((x) => x.action === "resume" || x.action === "extend") && i === 0);
  if (open) {
    const p = msgs.find((x) => x.action === "pause" && x.atBeaconRound === open.start && !o.ignored.includes(x.seq));
    if (p && p.untilRound === undefined)
      ck.same(open.end - open.start, maxPause, "C-03", "an open pause ends by itself after the maximum");
  }
  const f = { v: 1, engagementId: "E", pubKey: PK, maxPauseRounds: maxPause, leadRounds: lead, messages: msgs };
  const now = at + rng.int(-20, 40), d = describeControl(f, now);
  ck.same(d.registered, true, "C-09", "registered");
  ck.same(d.leadSeconds, lead * 3, "C-09", "lead in seconds");
  ck.json(d.intervals, o.intervals, "C-09", "described intervals");
  ck.same(d.pausedNow, o.intervals.some((j) => now >= j.start && now < j.end), "C-09", "paused now");
  ck.same(d.stopped, o.stop === null ? undefined : now >= o.stop, "C-09", "stopped");
  ck.same(describeControl(null).registered, false, "C-09", "an unregistered game");
  const act = rng.pick(["pause", "resume", "extend", "stop"]), inR = rng.chance(0.5) ? rng.int(0, 80) : undefined, pf = rng.pick([undefined, 0, rng.int(1, 90)]), ad = rng.pick([undefined, rng.int(1, 50)]);
  const nm = nextMessage(f, now, { action: act, inRounds: inR, pauseForRounds: pf, addRounds: ad });
  const wl = act === "resume" ? Math.max(1, inR ?? lead) : Math.max(lead, inR ?? 0), wat = now + wl, lastIv = o.intervals.at(-1);
  ck.same(nm.seq, m + 1, "C-09", "next number");
  ck.same(nm.atBeaconRound, wat, "C-09", "takes effect after the lead");
  ck.same(nm.signedAtRound, now, "C-09", "signed at the round seen");
  const wantUntil = act === "pause" ? pf ? wat + pf : undefined : act === "extend" ? (lastIv ? lastIv.end : wat) + (ad ?? pf ?? 0) : undefined;
  ck.same(nm.untilRound, wantUntil, "C-09", `end of the ${act}`);
  if (act === "stop" || act === "pause") {
    const after = oResolve(maxPause, lead, [...msgs.map(toO2), { seq: nm.seq, action: act, at: nm.atBeaconRound, signedAt: nm.signedAtRound, until: nm.untilRound }]);
    if (o.stop === null && (act === "stop" || !lastIv || wat >= lastIv.end) && !(act === "pause" && nm.untilRound !== undefined && nm.untilRound - wat > 28800))
      ck.ok(!after.ignored.includes(nm.seq), "C-09", () => `a fresh ${act} written by the console was ignored`);
    const eng = resolveControl(cfg, [...msgs, { ...nm, sig: "x" }]);
    ck.same(eng.ignored.some((x) => x.seq === nm.seq), after.ignored.includes(nm.seq), "C-09", `${act} accepted the same by engine and oracle`);
  }
  controlTracker(rng, ck);
  dims.ctl_msgs = m <= 2 ? "1-2" : m <= 4 ? "3-4" : "5+";
  dims.ctl_style = plausible ? "plausible" : "free";
  dims.ctl_stop = o.stop === null ? "no" : "yes";
  dims.ctl_pause = o.intervals.length === 0 ? "none" : o.intervals.length === 1 ? "one" : "several";
  dims.ctl_ignored = o.ignored.length ? "some" : "none";
  dims.ctl_lead = lead;
  if (tr)
    tr(`control: ${m} messages (${msgs.map((x) => x.action[0]).join("")}), ${o.applied} applied, ${o.intervals.length} pauses, stop ${o.stop ?? "-"}`);
  return params;
}
function controlTracker(rng, ck) {
  const S = rng.pick([SAFETY_FAST, SAFETY_STANDARD, SAFETY_LEAN30, SAFETY_LEAN60]), J = 5000 + rng.int(0, 99);
  const cfg = { pubKey: PK, maxPauseRounds: 600, leadRounds: S.leadRounds }, tk = new ControlTracker(cfg, "E", S, J);
  let lastGood = J - S.holdAfterRounds - 1, failing = null, t = J;
  const wantMode = (n) => n - lastGood <= S.holdAfterRounds ? "live" : failing !== null && n - failing >= S.giveUpRounds ? "blind" : "hold";
  const bad = [null, {}, { engagementId: "other", messages: [] }, { engagementId: "E", messages: "x" }, { engagementId: "E", messages: [{ junk: 1 }] }, 5, "text"];
  ck.same(tk.mode(J), wantMode(J), "C-10", "a fresh phone holds");
  ck.same(tk.mode(J), "hold", "C-10", "a fresh phone holds until its first good answer");
  for (let i = 0;i < rng.int(2, 7); i++) {
    t += rng.weighted([[rng.int(0, S.holdAfterRounds), 50], [rng.int(S.holdAfterRounds, S.giveUpRounds), 30], [rng.int(S.giveUpRounds, S.giveUpRounds * 3), 20]]);
    const ev = rng.weighted([["good", 40], ["bad", 35], ["failed", 25]]);
    if (ev === "good") {
      const r = runSync(() => tk.ingest(t, { engagementId: "E", messages: [] }));
      ck.same(r, true, "C-10", "a good answer is good");
      lastGood = t;
      failing = null;
    } else if (ev === "bad") {
      const r = runSync(() => tk.ingest(t, rng.pick(bad)));
      ck.same(r, false, "C-10", "a bad answer is not good");
      if (failing === null)
        failing = t;
    } else {
      const r = tk.failed(t);
      ck.same(r, false, "C-10", "a failed attempt returns false");
      if (failing === null)
        failing = t;
    }
    for (const p of [t, t + S.holdAfterRounds, t + S.holdAfterRounds + 1, t + S.giveUpRounds - 1, t + S.giveUpRounds, t + rng.int(0, S.giveUpRounds * 2)])
      ck.same(tk.mode(p), wantMode(p), "C-10", `mode at +${p - t} after a ${ev} answer`);
  }
}
function signedKind(rng, ck, dims, tr) {
  const secret = rng.hex(32), pub = publicKeyFromSecret(secret), pub2 = publicKeyFromSecret(rng.hex(32)), eid = "SE" + rng.hex(3);
  const sec2 = rng.hex(32);
  const mk = (seq, action, at, signed, until, key = secret, e = eid) => signControlWithSecret(key, { engagementId: e, seq, action, atBeaconRound: at, signedAtRound: signed, ...until !== undefined ? { untilRound: until } : {} });
  const base = 1000 + rng.int(0, 5000), cfg = { pubKey: pub, maxPauseRounds: 100, leadRounds: 13 };
  const m1 = mk(1, "pause", base, base - 20), m2 = mk(2, "resume", base + 30, base + 20), m3 = mk(3, "pause", base + 100, base + 80, base + 150), m4 = mk(4, "stop", base + 200, base + 150);
  const log = [m1, m2, m3, m4], ver = (k, m) => runSync(() => verifyControlSig(k, m));
  for (const m of log) {
    ck.same(ver(pub, m), true, "C-05", `signature of message ${m.seq}`);
    ck.same(ver(pub2, m), false, "C-05", "another key");
  }
  ck.same(ver(pub, { ...m1, atBeaconRound: m1.atBeaconRound + 1 }), false, "C-05", "a changed round");
  ck.same(ver(pub, { ...m1, action: "stop" }), false, "C-05", "a changed action");
  ck.same(ver(pub, { ...m1, sig: m1.sig.slice(0, -1) + (m1.sig.endsWith("0") ? "1" : "0") }), false, "C-05", "a changed signature");
  ck.same(ver(pub, { ...m1, sig: "zz" }), false, "C-05", "a garbage signature");
  const acc = (inc, known = []) => runSync(() => acceptLogDetailed(cfg, eid, inc, known));
  const seqs = (r2) => r2.log.map((x) => x.seq).join(",");
  let r = acc(rng.shuffle([...log, m2, m3]));
  ck.same(seqs(r), "1,2,3,4", "C-05", "shuffled with repeats");
  ck.same(r.forged, 0, "C-05", "repeats are not forgeries");
  r = acc([m1, m3, m4]);
  ck.same(seqs(r), "1", "C-05", "a missing number stops the run");
  const fake3 = mk(3, "stop", base + 100, base + 50, undefined, sec2);
  r = acc([m1, m2, fake3, m4]);
  ck.same(seqs(r), "1,2", "C-05", "a forged message stops the run");
  ck.same(r.forged, 1, "C-05", "one forgery counted");
  r = acc([m1, mk(2, "resume", base + 30, base + 20, undefined, secret, "other-game")]);
  ck.same(seqs(r), "1", "C-05", "another game's message");
  ck.same(r.forged, 1, "C-05", "counted as forged");
  r = acc([m1, m2, mk(2, "stop", base + 31, base + 1)]);
  ck.same(seqs(r), "1,2", "C-05", "a second message under a used number");
  ck.same(r.forged, 1, "C-05", "counted as forged");
  r = acc([m3, m4], [m1, m2]);
  ck.same(seqs(r), "1,2,3,4", "C-05", "new answer merged with what the phone knew");
  r = acc([], [m1, m2]);
  ck.same(seqs(r), "1,2", "C-05", "an old or empty answer undoes nothing");
  r = acc("not a list", [m1]);
  ck.same(seqs(r), "1", "C-05", "a non-list answer");
  r = acc([{ ...m2, atBeaconRound: m2.atBeaconRound + 1 }], [m1]);
  ck.same(seqs(r), "1", "C-05", "a changed message");
  ck.same(r.forged, 1, "C-05", "counted as forged");
  const full = acc(log).log, stt = resolveControl(cfg, full), ow = oResolve(100, 13, log.map(toO2));
  ck.json([stt.intervals, stt.stopRound, stt.ignored.map((x) => x.seq)], [ow.intervals, ow.stop, ow.ignored], "C-05", "the proven log resolves like the oracle");
  const store = new Map, kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => {
    store.set(k, v);
  } };
  const P2 = (m, e = eid) => runSync(() => publishControl(kv, e, m));
  ck.same(P2(m1).status, 404, "C-09", "publishing before a key is registered");
  ck.same(runSync(() => registerKey(kv, eid, "abc")).ok, false, "C-09", "a short key");
  ck.same(runSync(() => registerKey(kv, eid, pub)).ok, true, "C-09", "register the key");
  ck.same(runSync(() => registerKey(kv, eid, pub2)).ok, false, "C-09", "the key cannot be swapped");
  const L = SAFETY_STANDARD.leadRounds, b = base;
  const p1 = mk(1, "pause", b, b - L), p2 = mk(2, "resume", b + 30, b + 29), p3bad = mk(3, "pause", b + 50, b + 49), p3 = mk(3, "pause", b + 60, b + 40);
  ck.same(P2(p1).ok, true, "C-09", "first message");
  const dup = P2(p1);
  ck.same(dup.ok && dup.duplicate, true, "C-09", "the same message again");
  ck.same(P2(p3).status, 409, "C-09", "a number out of turn");
  ck.same(P2(p2).ok, true, "C-09", "resume");
  const bad = P2(p3bad);
  ck.same(bad.status, 422, "C-09", "a pause without the lead");
  ck.same(bad.error, `Not accepted: pause needs at least ${L} rounds of lead.`, "C-09", "the reason");
  ck.same(P2(mk(3, "pause", b + 60, b + 40, undefined, sec2)).status, 403, "C-09", "a message signed with another key");
  ck.same(P2({ junk: true }).status, 400, "C-09", "a malformed message");
  ck.same(P2(p3).ok, true, "C-09", "pause with the lead");
  const pub1 = runSync(() => readPublished(kv, eid));
  ck.same(pub1.messages.length, 3, "C-09", "three messages kept");
  ck.same(pub1.leadRounds, L, "C-09", "lead kept");
  const dsc = describeControl(pub1, b + 61);
  ck.same(dsc.pausedNow, true, "C-09", "paused now");
  ck.same(dsc.stopped, undefined, "C-09", "not stopped");
  const tk = new ControlTracker(cfgOf(pub1), eid, SAFETY_STANDARD, b);
  ck.same(runSync(() => tk.ingest(b + 1, { engagementId: eid, messages: pub1.messages })), true, "C-05", "ingest the published log");
  ck.json(tk.state.intervals, [{ start: b, end: b + 30 }, { start: b + 60, end: b + 60 + 600 }], "C-05", "the phone's pauses");
  ck.same(tk.mode(b + 2), "live", "C-10", "live after a good answer");
  const before = tk.log.length;
  ck.same(runSync(() => tk.ingest(b + 2, { engagementId: eid, messages: [...pub1.messages, fake3] })), false, "C-05", "an answer with a forgery is not good");
  ck.same(tk.log.length, before, "C-05", "nothing from it is applied");
  dims.ctl_signed = "yes";
  if (tr)
    tr("signed sample: 4 real Ed25519 messages, accept/publish/track");
  return { k: "signed", base };
}
var oFullDelete = (end) => {
  const d = new Date(end + 365 * DAY2 + IST2);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - IST2;
};
var oFrom = (f) => {
  if (typeof f !== "number" || !Number.isInteger(f) || f < 1)
    return null;
  if (f === 1900000000)
    return { kind: "org" };
  if (f >= 1500000000 && f < 1500000000 + 268435456)
    return { kind: "host", hex: (f - 1500000000).toString(16).padStart(7, "0") };
  if (f >= 1e9 && f < 1e9 + 268435456)
    return { kind: "cohost", hex: (f - 1e9).toString(16).padStart(7, "0") };
  return f < 1e9 ? { kind: "guest", seq: f } : null;
};
var CATS = INVITE_CATEGORIES.map((c) => c.id);
function platformKind(rng, ck, dims, tr, seed) {
  const sub2 = rng.weighted([["clock", 14], ["faces", 6], ["below", 8], ["from", 9], ["cfg", 14], ["quorum", 5], ["normalize", 10], ["seed", 7], ["endbound", 4], ["life", 5], ["ticket", 6], ["perm", 3], ["people", 6], ["safety", 6]]);
  dims.platform = sub2;
  let params = { k: "platform", sub: sub2 };
  switch (sub2) {
    case "clock":
      params = { ...params, ...clockSub(rng, ck, dims) };
      break;
    case "faces": {
      const used = [];
      for (let i = 0;i < 6; i++) {
        const t2 = rng.int(1, 6), d = rng.int(1, 6);
        used.push(t2 * 10 + d);
        ck.same(scoreOf(t2, d), oPoints(false, t2, d), "G-03", `classic score target ${t2} dice ${d}`);
        ck.same(nfPoints(t2, d), oPoints(true, t2, d), "G-03", `new flow score target ${t2} dice ${d}`);
      }
      const t = rng.int(1, 6);
      const row = [1, 2, 3, 4, 5, 6].map((d) => nfPoints(t, d));
      ck.same(row.filter((x) => x === 10).length, 1, "G-03", "exactly one dice scores 10");
      params.t = t;
      params.pairs = used.join(",");
      break;
    }
    case "below": {
      const n = rng.weighted([[rng.int(2, 12), 40], [rng.int(13, 1000), 25], [rng.int(1001, 3000000000), 15], [2147483649, 5], [3000000000, 5], [4294967295, 5], [4294967296, 3], [1, 2]]);
      const seedTxt = `S${rng.hex(4)}|${rng.int(0, 99)}`;
      params = { ...params, n, seedTxt };
      for (const lab of ["t", "d", "x" + rng.int(0, 9)]) {
        const a = runSync(() => below(seedTxt, lab, n)), b = drawBelow(seedTxt, lab, n);
        ck.same(a, b, "P-08", `draw below ${n}, label ${lab}`);
        ck.ok(a >= 0 && a < n, "P-08", () => `${a} not below ${n}`);
      }
      break;
    }
    case "from":
      params = { ...params, ...fromSub(rng, ck) };
      break;
    case "cfg":
      params = { ...params, ...cfgSub(rng, ck, dims) };
      break;
    case "quorum": {
      const ns = [];
      for (let i = 0;i < 8; i++) {
        const n = rng.pick([1, 2, 3, 4, 59, 60, 61, 62, 80, 81, 100, 101, 1000, 5000, rng.int(1, 6000)]);
        ns.push(n);
        params.ns = ns.join(",");
        const want = Math.min(n, Math.max(3, Math.floor((n + 19) / 20)));
        ck.same(quorumFor(n), want, "V-02", `votes needed with ${n} players`);
        ck.ok(quorumFor(n) <= n && quorumFor(n) >= 1, "V-02", () => `quorum ${quorumFor(n)} for ${n}`);
        ck.ok(quorumFor(n + 1) >= quorumFor(n), "V-02", () => `quorum falls from ${n} to ${n + 1}`);
      }
      break;
    }
    case "normalize":
      params = { ...params, ...normalizeSub(rng, ck) };
      break;
    case "seed": {
      const secret = rng.hex(32), eid = "E" + rng.hex(3), n = rng.int(0, 8), pids = Array.from({ length: n }, () => rng.hex(rng.int(1, 6)));
      params = { ...params, secret, eid, pids: pids.join(",") };
      const roster = H(`LBC-ROSTER|${[...pids].sort().join(",")}`), seedO = H(`LBC-SEED|${secret}|${eid}|${roster}`);
      ck.same(runSync(() => commitOf(secret)), H(`LBC-COMMIT|${secret}`), "V-01", "fingerprint");
      ck.same(runSync(() => rosterHash(pids)), roster, "V-01", "roster");
      ck.same(runSync(() => rosterHash(rng.shuffle(pids))), roster, "V-01", "roster order does not matter");
      ck.same(runSync(() => seedOf(secret, eid, pids)), seedO, "V-01", "seed");
      const i = rng.int(0, 400);
      ck.same(runSync(() => beaconValue(seedO, i)), H(`LBC-BEACON|${seedO}|${i}`), "V-01", `public number ${i}`);
      ck.ok(runSync(() => seedOf(secret, eid + "x", pids)) !== seedO, "V-01", () => "another game gave the same seed");
      ck.ok(runSync(() => seedOf(secret, eid, [...pids, "zz9"])) !== seedO, "V-01", () => "another roster gave the same seed");
      ck.same(newSecret === undefined, false, "V-01", "newSecret exists");
      const s1 = newSecret();
      ck.ok(/^[0-9a-f]{64}$/.test(s1), "V-01", () => `secret ${s1}`);
      break;
    }
    case "endbound": {
      const s = 1700000000000 + rng.int(0, 99999) * 1000, e = s + rng.int(1, 5000) * 1000, en = e + rng.int(0, 900) * 1000;
      const cases = [[null, s + 6 * 3600000], [{ end_ms: null, ended_ms: null }, s + 6 * 3600000], [{ end_ms: e, ended_ms: null }, e + 660000], [{ end_ms: e, ended_ms: en }, en + 60000], [{ end_ms: null, ended_ms: en }, en + 60000]];
      for (const [t, w] of cases)
        ck.same(endBoundLuck(s, t), w, "V-04", `closing time for ${JSON.stringify(t)}`);
      params = { ...params, s, e, en };
      break;
    }
    case "life": {
      const end = rng.weighted([[1700000000000 + rng.int(0, 99999999) * 1000, 70], [Date.UTC(2027, 0, 1 + rng.int(0, 3000)) - IST2 - 365 * DAY2, 10], [Date.UTC(2027, 0, 1 + rng.int(0, 3000)) - IST2 - 365 * DAY2 - 1, 10], [Date.UTC(2027, 0, 1 + rng.int(0, 3000)) - IST2 - 365 * DAY2 + 1, 10]]);
      ck.same(fullDeleteAt(end), oFullDelete(end), "P-06", `full delete after ${end}`);
      ck.same(personalDeleteAt(end), end + 20 * 3600000, "P-06", "personal data");
      ck.same(reportLinkUntil(end), end + 19 * 3600000, "P-06", "report link");
      ck.same(rescheduleUntilMs(end), end + 365 * DAY2, "P-06", "reschedule window");
      ck.same((fullDeleteAt(end) + IST2) % DAY2, 0, "P-06", "midnight IST");
      ck.ok(fullDeleteAt(end) > end + 365 * DAY2 - 1, "P-06", () => "deleted before day 365");
      const r = rng.int(1, 1e5);
      ck.same(roundMs(r), (1692803367 + (r - 1) * 3) * 1000, "P-06", `time of beacon round ${r}`);
      params = { ...params, end };
      break;
    }
    case "ticket": {
      const eid = "E" + rng.hex(3), seat = rng.pick([0, 1, 9, 10, 99, 100, 9999, 1e4, 99999, rng.int(0, 5000)]);
      ck.same(ticketId(eid, seat), `${eid}-T${String(seat).padStart(4, "0")}`, "P-05", "ticket id");
      const cases = [[`${seat}x1`, seat > 999999 ? null : seat], ["x12", null], ["", null], ["12", null], ["007x1", 7], ["1234567x9", null], ["12345x", 12345], ["a1x2", null], ["1 x2", null]];
      for (const [p, w] of cases)
        ck.same(seatOfPidText(p), w, "P-05", `seat of "${p}"`);
      const st = 1700000000000 + rng.int(0, 999) * 1000;
      ck.same(checkinOpensMs(st), st - 300000, "P-04", "check-in opens");
      ck.same(checkinRequired({ created_ms: st }), false, "P-04", "Luck has no check-in");
      const pre = "luck/" + rng.hex(2) + "/";
      const pe = prefixEnd(pre);
      ck.ok(pe > pre && pe.slice(0, -1) === pre.slice(0, -1) && pe.charCodeAt(pe.length - 1) === 48, "P-05", () => `prefix end ${pe}`);
      ck.ok(pre + "zzzz" < pe, "P-05", () => "a key under the prefix sorts after the end");
      params = { ...params, eid, seat };
      break;
    }
    case "perm": {
      const key = rng.hex(32), xs = rng.sample(Array.from({ length: 1e4 }, (_, i) => i), 60), outs = xs.map((x) => perm10k(key, x));
      params = { ...params, key };
      ck.ok(outs.every((v) => Number.isInteger(v) && v >= 0 && v < 1e4), "P-04", () => "outside 0..9999");
      ck.same(new Set(outs).size, xs.length, "P-04", "a code repeated");
      ck.json(outs, xs.map((x) => perm10k(key, x)), "P-04", "same key, same codes");
      if (seed % 300 === 0) {
        const seen = new Uint8Array(1e4);
        let dup = 0;
        for (let x = 0;x < 1e4; x++) {
          const v = perm10k(key, x);
          if (seen[v])
            dup++;
          seen[v] = 1;
        }
        ck.same(dup, 0, "P-04", "the keyed shuffle of 0000-9999 repeats a code");
      }
      break;
    }
    case "people":
      params = { ...params, ...peopleSub(rng, ck) };
      break;
    case "safety": {
      const i = { pollMaxSec: rng.int(1, 120), cacheTtlSec: rng.int(0, 10), latencySec: rng.int(0, 10), missedPollsTolerated: rng.int(0, 3) }, s = deriveSafety(i);
      const worst = i.pollMaxSec + i.cacheTtlSec + i.latencySec, hold = Math.floor((worst + i.missedPollsTolerated * i.pollMaxSec + 2) / 3), lead = hold + Math.floor((i.cacheTtlSec + 2) / 3) + 2;
      ck.same(s.holdAfterRounds, hold, "C-06", "hold");
      ck.same(s.leadRounds, lead, "C-06", "lead");
      ck.same(s.giveUpRounds, Math.max(hold * 6, 60), "C-06", "give up");
      ck.same(s.worstNormalAgeSec, worst, "C-06", "worst age");
      ck.ok(s.leadRounds * 3 > s.holdAfterRounds * 3 + i.cacheTtlSec, "C-06", () => "a pause could be seen late");
      for (const [sf, h, l] of [[SAFETY_STANDARD, 10, 13], [SAFETY_FAST, 7, 10], [SAFETY_LEAN30, 26, 29], [SAFETY_LEAN60, 50, 53]]) {
        ck.same(sf.holdAfterRounds, h, "C-06", "profile hold");
        ck.same(sf.leadRounds, l, "C-06", "profile lead");
      }
      const capR = rng.int(1, 3000);
      params.cap = capR;
      for (const [cap, fast, w] of [[1, false, SAFETY_STANDARD], [250, false, SAFETY_STANDARD], [250, true, SAFETY_FAST], [251, true, SAFETY_LEAN30], [1000, false, SAFETY_LEAN30], [1001, false, SAFETY_LEAN60], [2000, true, SAFETY_LEAN60], [2001, false, null], [capR, false, undefined]]) {
        const want = w === undefined ? cap <= 250 ? SAFETY_STANDARD : cap <= 1000 ? SAFETY_LEAN30 : cap <= 2000 ? SAFETY_LEAN60 : null : w;
        ck.same(safetyForCap(cap, fast), want, "C-06", `profile for ${cap} people`);
      }
      params = { ...params, ...i };
      break;
    }
  }
  if (tr)
    tr(`platform ${sub2}`);
  return params;
}
function clockSub(rng, ck, dims) {
  const nf = rng.chance(0.3), rounds = nf ? 22 : rng.int(1, 20), win = nf ? 10 : rng.pick([6, 10, 15]);
  const ps = parseSettings(nf ? { newFlow: true } : { rounds, windowSecs: win });
  if (!ck.ok(ps.ok, "S-01", () => JSON.stringify(ps)))
    return { nf, rounds };
  const st = ps.value, start = 1700000000000 + rng.int(0, 9999999) * 1000, D = st.diceRounds, sch = oSched(st.rounds, D, st.windowSecs, st.revealSecs, st.breakSecs, start);
  ck.same(totalDiceRounds(st), st.rounds * D, "T-01", "dice rounds");
  for (let g = 0;g < sch.G; g++) {
    if (diceOpenMs(st, start, g) !== sch.open[g] || windowCloseMs(st, start, g) !== sch.close[g] || revealEndMs(st, start, g) !== sch.revEnd[g])
      ck.same(`${diceOpenMs(st, start, g)}/${windowCloseMs(st, start, g)}/${revealEndMs(st, start, g)}`, `${sch.open[g]}/${sch.close[g]}/${sch.revEnd[g]}`, "T-01", `times of dice round ${g}`);
    else
      ck.checks++;
    ck.same(roundOf(st, g), Math.floor(g / D) + 1, "T-01", "round of dice round");
    ck.same(isLastOfRound(st, g), (g + 1) % D === 0, "T-01", "last of round");
    if (beaconDueMs(st, start, 2 * g) !== oBeaconDue(sch, 2 * g) || beaconDueMs(st, start, 2 * g + 1) !== oBeaconDue(sch, 2 * g + 1))
      ck.same(beaconDueMs(st, start, 2 * g + 1), oBeaconDue(sch, 2 * g + 1), "T-03", `public number of dice round ${g}`);
    else
      ck.checks++;
  }
  ck.same(gameEndMs(st, start), sch.end, "T-01", "end");
  const ts = [start - 1, start, sch.end - 1, sch.end, sch.end + 1];
  for (let i = 0;i < 6; i++) {
    const g = rng.int(0, sch.G - 1);
    ts.push(sch.open[g] - 1, sch.open[g], sch.close[g], sch.close[g] - 1, sch.revEnd[g] - 1, sch.revEnd[g]);
  }
  for (let i = 0;i < 4; i++)
    ts.push(rng.int(start, sch.end));
  for (const t of ts) {
    const pe = phaseAt(st, start, t), po = oPhase(sch, start, D, t);
    ck.ok(pe.kind === po.kind && (po.kind === "window" || po.kind === "reveal" ? pe.g === po.g : po.kind === "break" ? pe.afterRound === po.afterRound : true), "T-02", () => `at +${t - start} ms: engine ${JSON.stringify(pe)}, oracle ${JSON.stringify(po)}`);
  }
  dims.mode = nf ? "new-flow" : "classic";
  return { nf, rounds: st.rounds, win, start };
}
function fromSub(rng, ck) {
  const fs = [];
  for (let rep = 0;rep < 4; rep++)
    fs.push(fromOne(rng, ck));
  return { fs: fs.join(",") };
}
function fromOne(rng, ck) {
  const f = rng.weighted([[rng.int(1, 999999999), 30], [rng.pick([1, 999999999, 1e9, 1268435455, 1268435456, 1499999999, 1500000000, 1768435455, 1768435456, 1899999999, 1900000000, 1900000001, 2000000000]), 8], [1e9 + rng.int(0, 268435455), 14], [1500000000 + rng.int(0, 268435455), 14], [rng.pick([0, -1, 1.5, NaN, Infinity, "5", "1900000000", null, undefined, true, {}, [], 2 ** 53]), 15], [rng.int(1268435456, 2100000000), 15]]);
  const w = oFrom(f), g = parseFrom(f);
  ck.json(g, w, "P-01", `owner of from=${String(f)}`);
  if (g) {
    const inv = inviterOf(g), back = fromCodeOf(inv);
    ck.same(back, f, "P-01", `from=${String(f)} round trip through ${inv}`);
    ck.same(inv, g.kind === "org" ? "o" : g.kind === "host" ? "h:" + g.hex : g.kind === "cohost" ? "c:" + g.hex : "s:" + g.seq, "P-01", "inviter id");
    ck.same(srcOf(inv), inv.startsWith("c:") ? "co:" + inv.slice(2) : inv.startsWith("h:") ? "ho:" + inv.slice(2) : "link", "P-01", "source of a person");
  }
  for (const x of ["", "x", "z:5", "s:abc"])
    ck.same(x === "s:abc" ? Number.isNaN(fromCodeOf(x)) : fromCodeOf(x), x === "s:abc" ? true : null, "P-01", `code of inviter "${x}"`);
  ck.same(fromCodeOf("o"), ORG_FROM, "P-01", "organizer code");
  return typeof f === "number" ? String(f) : "~" + String(f);
}
function cfgSub(rng, ck, dims) {
  const c = rng.weighted([["invites-ok", 22], ["invites-bad", 14], ["employees", 10], ["verify", 16], ["idkind", 14], ["tickets", 6], ["rounds", 6], ["two-faults", 4], ["empty", 3]]);
  dims.cfg_case = c;
  const inp = {};
  let wantErr = null;
  let want = {};
  const catsPick = () => {
    const k = rng.int(0, 4), xs = [];
    for (let i = 0;i < k; i++)
      xs.push(rng.pick(CATS));
    return xs;
  };
  const uniq = (xs) => [...new Set(xs)];
  if (c === "invites-ok") {
    const on = rng.chance(0.6), per = rng.pick([undefined, 1, 4, 10, rng.int(1, 10)]), cats = rng.pick([undefined, catsPick()]);
    inp.invites = { on, ...per !== undefined ? { per } : {}, ...cats !== undefined ? { cats } : {} };
    if (on && cats !== undefined && cats.length === 0)
      wantErr = "Pick at least one kind of guest people may invite.";
    else
      want = { invites: { on, per: per ?? 4, cats: cats === undefined ? ["family", "colleagues"] : uniq(cats) } };
  } else if (c === "invites-bad") {
    const k = rng.int(0, 4);
    if (k === 0) {
      inp.invites = rng.pick([null, 5, "on", { per: 3 }, { on: "yes" }, { on: 1 }]);
      wantErr = "Invites: say whether they are on or off.";
    } else if (k === 1) {
      inp.invites = { on: true, per: rng.pick([0, 11, 1.5, "3", -1, NaN, 100]) };
      wantErr = "Each person can invite 1 to 10 people.";
    } else if (k === 2) {
      inp.invites = { on: rng.chance(0.5), cats: [rng.pick(["family", "colleagues"]), rng.pick(["cousins", "", "FAMILY", 5, null])] };
      wantErr = "Pick the kinds of guests from the list.";
    } else if (k === 3) {
      inp.invites = { on: false, cats: rng.pick(["family", 5, {}, null]) };
      wantErr = "Pick the kinds of guests from the list.";
    } else {
      inp.invites = { on: true, cats: [] };
      wantErr = "Pick at least one kind of guest people may invite.";
    }
  } else if (c === "employees") {
    const eo = rng.pick([true, false, "yes", 1, null]), on = rng.chance(0.7);
    inp.employeesOnly = eo;
    if (rng.chance(0.7))
      inp.invites = { on, per: rng.int(1, 10), cats: ["family"] };
    if (typeof eo !== "boolean")
      wantErr = "Employees only: say yes or no.";
    else {
      const iv = inp.invites;
      want = { employeesOnly: eo ? true : undefined, invites: iv ? { on: eo ? false : on, per: iv.per, cats: ["family"] } : { on: false, per: 4, cats: ["family", "colleagues"] } };
    }
  } else if (c === "verify") {
    const v = rng.pick(["mobile", "id", "either", "both", "email", "phone", "", "MOBILE", 5, null]);
    inp.verify = v;
    if (v === "email")
      want = { verify: "id", idKind: "email" };
    else if (v === "mobile")
      want = { verify: undefined, idKind: undefined };
    else if (v === "id" || v === "either" || v === "both")
      want = { verify: v, idKind: undefined };
    else
      wantErr = "What a person must give: choose mobile number, employee ID, Email ID, or both mobile number and employee ID.";
  } else if (c === "idkind") {
    const v = rng.pick([undefined, "mobile", "id", "either", "both"]), k = rng.pick(["email", "emp", "other", "", null]);
    if (v !== undefined)
      inp.verify = v;
    inp.idKind = k;
    if (k !== "email" && k !== "emp")
      wantErr = "What the ID is: an employee ID or an Email ID.";
    else if (k === "email") {
      if (v === undefined || v === "id")
        want = { verify: "id", idKind: "email" };
      else
        wantErr = "An Email ID is asked on its own: choose Email ID only, not a mobile number with it.";
    } else
      want = { verify: v === undefined || v === "mobile" ? undefined : v, idKind: undefined };
  } else if (c === "tickets") {
    const t = rng.pick([1, 2, 3, 0, "1", 1.5, null]);
    inp.tickets = t;
    if (t === 1 || t === 2)
      want = { tickets: t };
    else
      wantErr = "The tickets setting is 1 or 2.";
  } else if (c === "rounds") {
    const r2 = rng.pick([1, 2, 5, 0, 6, -1, 2.5, "2", null]);
    inp.rounds = r2;
    if (typeof r2 === "number" && Number.isInteger(r2) && r2 >= 1 && r2 <= 5)
      want = { rounds: r2 };
    else
      wantErr = "The number of rounds is a whole number from 1 to 5.";
  } else if (c === "two-faults") {
    inp.rounds = 9;
    inp.tickets = 7;
    inp.invites = { on: "x" };
    wantErr = "The number of rounds is a whole number from 1 to 5.";
  }
  if (c !== "tickets" && c !== "rounds" && c !== "two-faults" && c !== "empty") {
    const tk = rng.pick([1, 2]), rd = rng.int(1, 5);
    inp.tickets = tk;
    inp.rounds = rd;
    want = { ...want, tickets: tk, rounds: rd };
  }
  {
    const nm = "Team " + rng.hex(4), jn = rng.pick(["name", "phone"]), mk = rng.pick(["auto", "tap"]), tz = rng.pick(["Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney", "UTC"]);
    inp.name = nm;
    inp.join = jn;
    inp.mark = mk;
    inp.tz = tz;
    want = { ...want, name: nm, join: jn === "phone" ? "phone" : undefined, mark: mk === "tap" ? "tap" : undefined, tz: tz === "Asia/Kolkata" ? undefined : tz };
  }
  const r = validateCfg(inp);
  if (wantErr !== null) {
    if (ck.ok(!r.ok, "P-02", () => `accepted ${JSON.stringify(inp)}`))
      ck.same(r.error, wantErr, c.startsWith("invites") || c === "employees" ? "P-02" : "P-03", `message for ${c}`);
  } else if (ck.ok(r.ok, "P-02", () => `refused ${JSON.stringify(inp)}: ${r.error}`)) {
    const cfg = r.cfg;
    for (const k of Object.keys(want))
      ck.json(cfg[k] ?? null, want[k] ?? null, c.startsWith("invites") || c === "employees" ? "P-02" : "P-03", `${k} after ${c}`);
    if (cfg.employeesOnly)
      ck.same(cfg.invites.on, false, "P-02", "employees only switches invites off");
    if (cfg.idKind === "email")
      ck.same(cfg.verify, "id", "P-03", "an Email ID goes with 'id' only");
  }
  if (c === "empty") {
    const d = validateCfg({});
    if (ck.ok(d.ok, "P-02", () => "empty refused")) {
      const x = d.cfg;
      ck.same(x.tickets, 1, "P-03", "default tickets");
      ck.same(x.rounds, 1, "P-03", "default rounds");
      ck.json(x.invites, { on: false, per: 4, cats: ["family", "colleagues"] }, "P-02", "default invites");
    }
  }
  return { c, inp: JSON.stringify(inp) };
}
function normalizeSub(rng, ck) {
  const players = rng.int(2, 40), rounds = rng.int(1, 4), nf = rng.chance(0.3);
  const line = (seat) => ({ seat, points: rng.int(0, nf ? 220 : 120), hits: rng.int(0, 22), best: rng.int(0, 6), line: rng.chance(0.3) ? "Tied on 3 points; decided by the most hits." : "", extra: "dropped" });
  const list = () => {
    const k = rng.int(1, Math.min(10, players));
    return rng.sample(Array.from({ length: players }, (_, i) => i), k).map(line);
  };
  const good = { overall: list(), rounds: Array.from({ length: rounds }, list), junk: 1 };
  const out = normalizeResult(good, players, rounds);
  if (ck.ok(!!out, "V-03", () => "a good result was refused")) {
    const shape = (l) => l.map((x2) => ({ seat: x2.seat, points: x2.points, hits: x2.hits, best: x2.best, line: x2.line }));
    ck.json(out.overall, shape(good.overall), "V-03", "overall kept in one shape");
    ck.json(out.rounds, good.rounds.map(shape), "V-03", "rounds kept in one shape");
    ck.json(normalizeResult(JSON.parse(JSON.stringify(good)), players, rounds), out, "V-03", "the same result gives the same text");
    const longLine = JSON.parse(JSON.stringify(good));
    longLine.overall[0].line = "y".repeat(300);
    ck.same(normalizeResult(longLine, players, rounds).overall[0].line.length, 120, "V-03", "a long line is cut to 120");
    longLine.overall[0].line = 5;
    ck.same(normalizeResult(longLine, players, rounds).overall[0].line, "", "V-03", "a line that is not text becomes empty");
  }
  const bad = rng.int(0, 13), x = JSON.parse(JSON.stringify(good));
  const o0 = x.overall[0];
  const names = ["unknown seat", "negative seat", "fractional seat", "repeated seat", "negative points", "too many points", "fractional points", "best over 6", "wrong rounds", "empty list", "eleven lines", "not an array", "no overall", "negative hits"];
  if (bad === 0)
    o0.seat = players;
  else if (bad === 1)
    o0.seat = -1;
  else if (bad === 2)
    o0.seat = 1.5;
  else if (bad === 3) {
    if (x.overall.length < 2)
      x.overall.push({ ...o0, seat: (o0.seat + 1) % players });
    x.overall[1].seat = o0.seat;
  } else if (bad === 4)
    o0.points = -1;
  else if (bad === 5)
    o0.points = 2401;
  else if (bad === 6)
    o0.points = 2.5;
  else if (bad === 7)
    o0.best = 7;
  else if (bad === 8)
    x.rounds.push(x.rounds[0] ?? x.overall);
  else if (bad === 9)
    x.overall = [];
  else if (bad === 10)
    x.overall = Array.from({ length: 11 }, (_, i) => ({ seat: i % players, points: 1, hits: 0, best: 0, line: "" })).map((v, i) => ({ ...v, seat: i }));
  else if (bad === 11)
    x.overall = "x";
  else if (bad === 12)
    delete x.overall;
  else
    o0.hits = -1;
  const players2 = bad === 10 ? 40 : players;
  ck.same(normalizeResult(x, players2, bad === 8 ? rounds : rounds), null, "V-03", `a result with ${names[bad]}`);
  for (const junk of [null, undefined, 5, "x", []])
    ck.same(normalizeResult(junk, players, rounds), null, "V-03", "a result that is not an object");
  return { players, rounds, bad, input: H(JSON.stringify(good)).slice(0, 12) };
}
function peopleSub(rng, ck) {
  const { raw: raw2, d1 } = db();
  const eid = "P" + rng.hex(4);
  try {
    const n = rng.int(0, 12), guestSeq = rng.int(1, 30);
    let want = 0;
    const tgt = `s:${guestSeq}`;
    for (let i = 0;i < n; i++) {
      const status = rng.pick(["invited", "joined", "removed"]), role = rng.chance(0.25) ? "team" : null, inv = rng.chance(0.8) ? tgt : "s:99";
      raw2.query("INSERT INTO person(eid,id,ph,pii,inviter,role,status,added_ms) VALUES(?,?,?,?,?,?,?,?)").run(eid, `p${i}`, `ph${i}`, "{}", inv, role, status, 1);
      if (inv === tgt && status !== "removed" && role === null)
        want++;
    }
    ck.same(runSync(() => listCount(d1, eid, tgt)), want, "P-07", "people on a guest's list");
    ck.same(runSync(() => listCount(d1, eid, "c:0000001")), 0, "P-07", "an empty list");
    const seatRole = rng.pick([null, "cohost", "team"]), per = rng.int(1, 10), cl = rng.pick([undefined, null, 25, 500]);
    raw2.query("INSERT INTO seat(eid,seq,pid,ph,dev,blocked,role) VALUES(?,?,?,?,?,?,?)").run(eid, guestSeq, "x", "phU", null, 0, seatRole);
    const c = { env: { DB: d1 }, eid, e: { cohost_limit: cl }, invites: { on: true, per } };
    ck.same(runSync(() => limitOfInviter(c, tgt)), seatRole ? null : per, "P-07", "a guest's or team member's limit");
    ck.same(runSync(() => limitOfInviter(c, `s:${guestSeq + 100}`)), per, "P-07", "a seat that does not exist");
    ck.same(runSync(() => limitOfInviter(c, "c:0000002")), cl ?? 100, "P-07", "a co-host's limit");
    ck.same(runSync(() => limitOfInviter(c, "o")), null, "P-07", "the organizer has none");
    ck.same(runSync(() => limitOfInviter(c, "h:0000003")), null, "P-07", "a host has none");
    raw2.query("INSERT INTO person(eid,id,ph,pii,inviter,role,status,added_ms) VALUES(?,?,?,?,?,?,?,?)").run(eid, "up", "phU", "{}", "c:0000009", null, "joined", 1);
    ck.same(runSync(() => chainOf(d1, eid, tgt)), `,${tgt},c:0000009,`, "P-07", "who may answer for a guest");
    ck.same(runSync(() => chainOf(d1, eid, "o")), ",o,", "P-07", "the organizer's chain");
    ck.same(runSync(() => chainOf(d1, eid, `s:${guestSeq + 100}`)), `,s:${guestSeq + 100},`, "P-07", "a guest without a seat");
    return { n, guestSeq, seatRole, per, rows: H(JSON.stringify(raw2.query("SELECT id,inviter,role,status FROM person WHERE eid=?").all(eid))).slice(0, 10) };
  } finally {
    for (const t of ["person", "seat"])
      raw2.query(`DELETE FROM ${t} WHERE eid=?`).run(eid);
  }
}

// games/luck/scenario.ts
var meta = {
  game: "luck",
  sha: "3057fb8",
  rules: RULES,
  dimensions: {
    kind: ["game", "rank", "settings", "route", "control", "platform", "signed", "chi"],
    mode: ["classic", "new-flow"],
    players: ["2", "3-5", "6-12", "13-60", "61+", "2-5", "13+"],
    rounds: ["1", "2-3", "4-10", "11-20", "22 (new flow)"],
    window: [6, 10, 15],
    prize_mode: ["overall", "rounds", "both"],
    one_win: ["yes", "no"],
    press: ["all", "most", "half", "n/a"],
    end: ["ran-to-end", "organizer-ended"],
    early_end: ["yes", "no"],
    tie: ["none", "points", "fate", "fate-at-cut"],
    tie_style: ["random", "groups", "all-equal", "cut", "pairs"],
    settings: ["valid", "defaults", "invalid:rounds", "invalid:window", "invalid:prizemode", "invalid:too-many", "invalid:money", "invalid:length", "invalid:not-text", "invalid:more-lists", "invalid:startmode", "invalid:two-wrong", "invalid:extra-keys"],
    role: ["organizer", "host", "platform", "co-host", "ai-link", "other-org", "stranger", "player"],
    vote: ["agree", "forged", "split", "short", "none", "dup", "removed-podium", "after-end-gap"],
    route: ["agreed", "not-agreed", "gate"],
    platform: ["clock", "faces", "below", "from", "cfg", "quorum", "normalize", "seed", "endbound", "life", "ticket", "perm", "people", "safety"],
    cfg_case: ["invites-ok", "invites-bad", "employees", "verify", "idkind", "tickets", "rounds", "two-faults", "empty"],
    ctl_msgs: ["1-2", "3-4", "5+"],
    ctl_style: ["plausible", "free"],
    ctl_stop: ["no", "yes"],
    ctl_pause: ["none", "one", "several"],
    ctl_ignored: ["some", "none"],
    ctl_lead: "open",
    ctl_signed: ["yes"]
  }
};
var NOOP = /^\s*\(\s*\)\s*=>\s*\{\s*\}\s*$|^\s*\(\s*_?\w*\s*\)\s*=>\s*\{\s*\}\s*$/;
function chiKind(rng, ck, dims) {
  const gid = "CHI" + rng.hex(3), cnt = [0, 0, 0, 0, 0, 0], cd = [0, 0, 0, 0, 0, 0];
  let hits = 0, pairs = 0;
  runSync(async () => {
    for (let g = 0;g < 200; g++) {
      const a = rng.hex(6), b = rng.hex(6), t = await targetOf(gid, g, a);
      cnt[t - 1]++;
      for (let s = 0;s < 60; s++) {
        const d = await diceOf(gid, s, g, b);
        cd[d - 1]++;
        pairs++;
        if (d === t)
          hits++;
      }
    }
  });
  const chi = (c) => {
    const n = c.reduce((x, y) => x + y, 0), e = n / 6;
    return c.reduce((x, v) => x + (v - e) * (v - e) / e, 0);
  };
  ck.ok(chi(cd) < 40, "F-01", () => `dice faces ${cd.join("/")} chi-square ${chi(cd).toFixed(1)}`);
  ck.ok(chi(cnt) < 40, "F-01", () => `target faces ${cnt.join("/")} chi-square ${chi(cnt).toFixed(1)}`);
  const mean = pairs / 6, sd = Math.sqrt(pairs * 5 / 36);
  ck.ok(Math.abs(hits - mean) < 6 * sd, "F-01", () => `${hits} hits in ${pairs} pairs (expected about ${mean.toFixed(0)})`);
  dims.chi = "yes";
  return { k: "chi", gid };
}
function run(seed, trace) {
  const tr = NOOP.test(Function.prototype.toString.call(trace)) ? null : trace;
  const rng = new Rng(seed), ck = new Ck, dims = {};
  setEntropy(seed);
  if (shimProblem)
    ck.ok(false, "H-00", () => shimProblem);
  let kind = rng.weighted([["game", 10], ["rank", 8], ["settings", 8], ["route", 1.5], ["control", 12], ["platform", 60.5]]);
  if (seed % 20000 === 3)
    kind = "signed";
  else if (seed % 25000 === 7)
    kind = "chi";
  dims.kind = kind;
  const params = kind === "game" ? gameKind(rng, ck, dims, tr) : kind === "rank" ? rankKind(rng, ck, dims, tr, seed) : kind === "settings" ? settingsKind(rng, ck, dims, tr) : kind === "route" ? routeKind(rng, ck, dims, tr) : kind === "control" ? controlKind(rng, ck, dims, tr, seed) : kind === "signed" ? signedKind(rng, ck, dims, tr) : kind === "chi" ? chiKind(rng, ck, dims) : platformKind(rng, ck, dims, tr, seed);
  return { params, dims, checks: ck.checks, fails: ck.fails };
}

// games/luck/main.ts
main(meta, run);
