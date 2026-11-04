// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// src-bingo-4d636fa/vendor/game-core/packages/core/src/prize-planner.js
var require_prize_planner = __commonJS((exports, module) => {
  (function(root) {
    var MAX_MANUAL = 30;
    var COUNTS = { 1: [4, 6, 8, 10], 2: [12, 14, 16, 20] };
    var DEFAULT_COUNT = { 1: 6, 2: 14 };
    var LINES2 = [["top", "Line 1"], ["mid", "Line 2"], ["bot", "Line 3"]];
    var NAMES = { top: "Line 1", mid: "Line 2", bot: "Line 3", corners: "Corners", early5: "Early 5", full: "Full House", full2: "Super Bumper" };
    var ORD = ["1st", "2nd", "3rd", "4th", "5th"];
    var ONE = {
      4: { lines: 20, corners: 0, early5: [], full: [40], full2: [] },
      6: { lines: 15, corners: 10, early5: [], full: [30, 15], full2: [] },
      8: { lines: 12, corners: 8, early5: [8], full: [24, 14, 10], full2: [] },
      10: { lines: 9, corners: 7, early5: [7, 5], full: [24, 14, 9, 7], full2: [] }
    };
    var TWO = {
      12: { lines: 5, corners: 4, early5: [], full: [8], full2: [30, 16] },
      14: { lines: 4.5, corners: 3.5, early5: [], full: [8, 4], full2: [26, 16] },
      16: { lines: 4, corners: 3, early5: [5], full: [7, 4], full2: [22, 12, 9] },
      20: { lines: 3.5, corners: 3, early5: [4, 3], full: [6, 4, 2.5], full2: [20, 11, 6, 4] }
    };
    var label = function(pattern, ordinal, ofTotal, ticket) {
      var base = NAMES[pattern] || pattern;
      var t = ticket ? "Ticket " + ticket + ": " : "";
      return t + (ofTotal > 1 ? (ORD[ordinal - 1] || ordinal + "th") + " " : "") + base;
    };
    var make = function(ticket, pattern, ordinal, ofTotal, pct) {
      return { id: ticket + ":" + pattern + ":" + ordinal, ticket, pattern, ordinal, label: label(pattern, ordinal, ofTotal, ticket), pct };
    };
    function split2(tickets, count) {
      var t = tickets === 2 ? 2 : 1, c = Number(count), S = t === 2 ? TWO[c] : ONE[c];
      if (!S)
        return [];
      var out = [];
      var per = function(ticket) {
        LINES2.forEach(function(l) {
          out.push(make(ticket, l[0], 1, 1, S.lines));
        });
        if (S.corners)
          out.push(make(ticket, "corners", 1, 1, S.corners));
        if (t === 1)
          S.early5.forEach(function(p, i) {
            out.push(make(0, "early5", i + 1, S.early5.length, p));
          });
        S.full.forEach(function(p, i) {
          out.push(make(ticket, "full", i + 1, S.full.length, p));
        });
      };
      if (t === 1)
        per(0);
      else {
        per(1);
        S.early5.forEach(function(p, i) {
          out.push(make(1, "early5", i + 1, S.early5.length, p));
        });
        per(2);
        S.full2.forEach(function(p, i) {
          out.push(make(0, "full2", i + 1, S.full2.length, p));
        });
      }
      return out;
    }
    function amounts(rows, budget) {
      var b = Math.floor(Number(budget));
      if (!(b > 0))
        return rows.map(function(r) {
          return Object.assign({}, r, { amount: 0 });
        });
      var out = rows.map(function(r) {
        return Object.assign({}, r, { amount: Math.floor(b * r.pct / 100 + 0.000000001) });
      });
      var sum = out.reduce(function(s, r) {
        return s + r.amount;
      }, 0), big = 0;
      out.forEach(function(r, i) {
        if (r.pct > out[big].pct)
          big = i;
      });
      out[big].amount += b - sum;
      return out;
    }
    function plan(tickets, count, budget) {
      var t = tickets === 2 ? 2 : 1, c = COUNTS[t].indexOf(Number(count)) >= 0 ? Number(count) : DEFAULT_COUNT[t];
      var rows = amounts(split2(t, c), budget);
      return { tickets: t, count: c, budget: Math.floor(Number(budget)) > 0 ? Math.floor(Number(budget)) : 0, total: rows.reduce(function(s, r) {
        return s + r.amount;
      }, 0), prizes: rows };
    }
    function shareOut(prizeAmount, winners) {
      var a = Math.max(0, Math.floor(Number(prizeAmount) || 0)), n = Math.floor(Number(winners) || 0);
      if (n < 1)
        return { share: 0, leftover: a, winners: 0 };
      var share = Math.floor(a / n);
      return { share, leftover: a - share * n, winners: n };
    }
    function validateManual(prizes) {
      var bad = [], list = Array.isArray(prizes) ? prizes : [], seen = {};
      if (list.length < 1)
        bad.push("Add at least one prize.");
      if (list.length > MAX_MANUAL)
        bad.push("A game can have up to " + MAX_MANUAL + " prizes.");
      list.forEach(function(p, i) {
        var n = i + 1;
        if (!p || typeof p.id !== "string" || !p.id) {
          bad.push("Prize " + n + " has no name.");
          return;
        }
        if (seen[p.id])
          bad.push("Prize " + n + " is listed twice.");
        seen[p.id] = true;
        var a = Number(p.amount);
        if (!(a > 0) || Math.floor(a) !== a)
          bad.push("Prize " + n + " needs an amount (a whole number above 0).");
        if (p.gift != null && String(p.gift).length > 60)
          bad.push("Prize " + n + ": the gift name can have up to 60 characters.");
      });
      return bad;
    }
    function hint(p) {
      if (!p || !p.prizes || !p.prizes.length || !(p.budget > 0))
        return "";
      var avg = p.total / p.prizes.length;
      return avg < 100 ? "Your prizes are small. Most teams give more, but this is entirely your choice. You can raise the budget, choose fewer prizes, or give a gift or a voucher." : "";
    }
    var API = { COUNTS, DEFAULT_COUNT, MAX_MANUAL, split: split2, plan, shareOut, validateManual, hint, label };
    if (typeof module !== "undefined" && module.exports)
      module.exports = API;
    if (root)
      root.ZPRIZE = API;
  })(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : exports);
});

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

// games/bingo/ctx.ts
var RULES = {
  "C-01": "Every card is a valid Bingo card: 5 x 5, FREE centre, each column from its own 15 numbers (B 1-15 ... O 61-75), 24 different numbers.",
  "C-02": "The same game id and seat id always give the same cards, and a second card is never the same as the first.",
  "C-03": "No two seats of one game round hold the same card.",
  "C-04": "A seat id '<number>x<hex>' carries its seat number and its cards come from positions 2(s-1) and 2(s-1)+1; an older id has no seat number.",
  "C-05": "Each round of a game has its own cards: a later round uses '<game>~r<round>', round 1 keeps the game id.",
  "C-06": "The keyed shuffle of card positions is a true permutation: different positions never give the same slot.",
  "N-01": "The numbers called are every number 1 to 75 exactly once, whatever the public randomness is.",
  "N-02": "The number for call k depends only on the game id, k, that call's randomness and the numbers already called.",
  "S-01": "The winners of every reward line equal an independent brute-force settlement: earliest completion first, one winner per line, lines filled in order.",
  "S-02": "A card completes a house at the first call after which all its squares are marked (FREE counts); a seat's best card counts; Two Lines needs two different lines.",
  "S-03": "The common engine (vendor/game-core) gives exactly the same winners as the live settlement.",
  "S-04": "The incremental prize engine gives exactly the winners of settling the whole log at once, however the seats and calls are fed to it.",
  "S-05": "A late joiner counts only the calls whose beacon round is at least their join round + 30; earlier calls count for nothing; call numbers stay global.",
  "S-06": "A claim is accepted only if its call number equals the one recomputed from the public log (late-joiner rule included); a wrong round, house or number is refused; claims never decide who wins.",
  "S-07": "The numbers still needed for a house are 0 at the winning call and not 0 the call before, and match an independent count.",
  "S-08": "The ranking lists each reward line once, best prize first, then the earlier call, then fate, with ranks 1, 2, 3 without gaps.",
  "S-09": "A seat that is in the public list can win (family members, blocked or removed seats too); a seat not in the list never can.",
  "S-10": "A seat that joined in time counts every call; one that joined at beacon round r counts from r + 30.",
  "T-01": "The tie order is the same on every phone: whatever order the seats are listed in, the same seat gets the same reward line.",
  "T-02": "Each reward line has exactly one winner; the earliest call fills the earliest lines; seats finishing on the same call take the next lines in fate order before any later call; a seat wins a house once.",
  "T-03": "The fate number is the sha256 of 'CB1-TIE|game|seat|tie|house|line'; seats never share one; the hash part of a seat id does not matter.",
  "T-04": "The live tie rule and the common engine's tie rule agree.",
  "T-05": "'tied' on a winner is the number of seats that finished the house on that same call, and is absent for a lone finisher.",
  "K-01": "Round 1: call k comes at start + k x call-gap, pushed later by every brand break that starts at or before it.",
  "K-02": "Round r+1 begins one call-gap plus 30 rounds after round r's last call; later rounds have no breaks.",
  "K-03": "A pause pushes every call at or after its start later by the pause's FULL length: no call falls inside a pause, and the unpaused time between two calls stays exactly one call-gap.",
  "K-04": "After a stop no call is made at or after the stop round; calls before it do not move.",
  "K-05": "A break shows from the round after the call before it for its whole length and no call is made while it shows; an intermission shows between a round's last call and the next round's first.",
  "K-06": "A lucky draw uses the randomness of the round its break ends in, and that round comes before the next call.",
  "K-07": "The schedule helpers agree with each other and with the plain schedule when nothing is paused.",
  "L-01": "Signed organizer messages are applied in order; each takes effect, or is refused for the stated reason, exactly as the written rules say (lead, state, end rounds, stop).",
  "L-02": "The order messages arrive in does not matter: they are applied by sequence number.",
  "L-03": "A timed pause ends by itself at its end round, an open pause after the longest allowed pause, a resume ends it early, an extend moves the end later.",
  "L-04": "Pause intervals are sorted and never overlap; claim holds join them as ordinary pauses and touching or overlapping pauses become one.",
  "L-05": "Claim holds are kept only when well formed (whole numbers, start 0 or more, end after start, at most 21 rounds); at most 40 are read.",
  "L-06": "A control message is well formed only with a text game id, a whole sequence number from 1, one of four actions, whole rounds and a signature text.",
  "L-07": "The safety lead is worked out as written: hold-after = ceil((poll + cache + delay + missed x poll) / 3) rounds, lead = hold-after + ceil(cache / 3) + 2.",
  "L-08": "A control message verifies only with the organizer's key and only if nothing in it changed (real Ed25519).",
  "L-09": "Only the organizer's key can sign; a Host key is not believed while Host keys are switched off.",
  "L-10": "A control log from an untrusted place keeps only genuine, matching messages, once each, up to the first missing number.",
  "L-11": "A game id with a space or a | cannot be signed.",
  "G-01": "A valid setting is accepted and kept as sent (cleaned): cards, rounds, reward lines, breaks in order, invites, join, mark, verify, brand, openings and closings.",
  "G-02": "An invalid setting is refused with a plain sentence (no codes, no 'undefined') and never crashes.",
  "G-03": "A house has at most its allowed winners, a 2nd reward line needs the 1st, and the same line twice is refused.",
  "G-04": "Breaks: at most 3 per card during the game, 15 to 600 seconds in steps of 3, after number 1 to 74, never two at the same number; a lucky draw picks 1, 3, 5 or 10.",
  "G-05": "A guest may invite 1 to 4 people from the listed kinds; an employees-only game switches invites off.",
  "G-06": "Automatic breaks are spread evenly: the k-th of n goes after round(75 k / (n + 1)), kept between 1 and 74.",
  "G-07": "The prize table has the ten documented houses in the documented order with their documented shapes and most winners; the shared copy and the common engine's copy agree.",
  "G-08": "The quorum and the number of reporting phones follow the documented formulas.",
  "G-09": "A new game has 1 card, 1 round, one reward each for Line, Four Corners, X and Blackout, and invites off with 4 per guest.",
  "G-10": "Brand moments are allowed per card: 3 during the game, 1 opening and 1 closing, 5 in all.",
  "Y-01": "A lucky draw picks the right number of different people, the same on every phone, from the public randomness; nobody wins twice; list order and repeats do not matter.",
  "Y-02": "A lucky draw for fewer people is the start of the draw for more.",
  "P-01": "A link code names its inviter and the inviter gives the code back (organizer, host, co-host, guest); codes outside the ranges are refused.",
  "P-02": "Where a person came from is kept as co:, ho: or link.",
  "P-03": "Who may decide a waiting request: the organizer and hosts always; anyone else only if they are in that request's chain.",
  "P-04": "Family approvals close exactly 15 minutes before the start and a waiting request lapses at exactly 30 minutes (when the rules are switched on for the game).",
  "P-05": "A mobile number is cleaned as written: an Indian number is 10 digits starting 6 to 9 (+91, 0 or 00 allowed), another country needs a known code, and one person gives one set of last 10 digits.",
  "P-06": "A name is kept without markup, control characters, formula starters or blanks at either end, at most 60 characters, and cleaning twice changes nothing.",
  "P-10": "A name that is cut to 60 characters never ends in a blank (a name is kept without blanks at either end).",
  "P-11": "A name that is cut to 60 characters never ends in half an emoji (a lone surrogate half).",
  "P-07": "An employee ID is cleaned to capital letters and digits (up to 30); an e-mail address is refused where an ID is asked.",
  "P-08": "The role limits are the written ones: a Co-host's list defaults to 100 (10 to 1000), a guest invites up to 4, there is no check-in.",
  "P-09": "The three copies of the beacon clock (beacon, lifecycle, approvals) give the same time for every round.",
  "E-01": "Guests' personal data goes 20 hours after the game ends (inside the 24-hour promise), the report link stops at 19 hours, and everything goes at 00:00 India time after 365 days.",
  "E-02": "The time-zone helpers turn a wall-clock time into the right instant and back.",
  "E-03": "Beacon round numbers and times invert each other."
};
function newCtx(seed, trace) {
  const verbose = trace.toString().length > 14;
  const c = {
    checks: 0,
    fails: [],
    dims: {},
    verbose,
    trace,
    seed,
    more: 0,
    ck(rule, ok, detail) {
      c.checks++;
      if (!ok) {
        if (c.fails.length < 10)
          c.fails.push({ rule, sentence: RULES[rule] ?? rule, detail });
        else
          c.more++;
      }
      return ok;
    },
    note(s) {
      if (verbose)
        trace(s);
    }
  };
  return c;
}
var bucketPlayers = (n) => n <= 8 ? "3-8" : n <= 20 ? "9-20" : n <= 40 ? "21-40" : "41+";
var wpick = (rng, xs) => rng.weighted(xs);
var js = (x) => JSON.stringify(x);

// src-bingo-4d636fa/vendor/game-core/packages/bingo/src/card.ts
var SIZE = 5;
var CELLS = 25;
var FREE_CELL = 12;
var row = (r) => [0, 1, 2, 3, 4].map((c) => r * SIZE + c);
var col = (c) => [0, 1, 2, 3, 4].map((r) => r * SIZE + c);
var D1 = [0, 6, 12, 18, 24];
var D2 = [4, 8, 12, 16, 20];
var LINES = [0, 1, 2, 3, 4].map(row).concat([0, 1, 2, 3, 4].map(col), [D1, D2]);
var HOUSES = {
  line: { label: "Line", sets: LINES, need: 1, max: 3, dflt: true },
  twolines: { label: "Two Lines", sets: LINES, need: 2, max: 2, dflt: false },
  corners: { label: "Four Corners", sets: [[0, 4, 20, 24]], need: 1, max: 3, dflt: true },
  plus: { label: "Plus", sets: [[...row(2), 2, 7, 17, 22]], need: 1, max: 2, dflt: false },
  x: { label: "X", sets: [[...D1, 4, 8, 16, 20]], need: 1, max: 2, dflt: true },
  frame: { label: "Frame", sets: [[...row(0), ...row(4), 5, 10, 15, 9, 14, 19]], need: 1, max: 2, dflt: false },
  stamp: { label: "Postage Stamp", sets: [[0, 1, 5, 6], [3, 4, 8, 9], [15, 16, 20, 21], [18, 19, 23, 24]], need: 1, max: 3, dflt: false },
  letterL: { label: "Letter L", sets: [[...col(0), 21, 22, 23, 24]], need: 1, max: 2, dflt: false },
  letterT: { label: "Letter T", sets: [[...row(0), 7, 12, 17, 22]], need: 1, max: 2, dflt: false },
  blackout: { label: "Blackout", sets: [Array.from({ length: CELLS }, (_, i) => i)], need: 1, max: 2, dflt: true }
};
var HOUSE_IDS = Object.keys(HOUSES);

// src-bingo-4d636fa/packages/shared/src/bingo-card.ts
var SIZE2 = 5;
var FREE_CELL2 = 12;
var MAX_NUMBER = 75;
var PER_COLUMN = 15;
var columnRange = (c) => [c * PER_COLUMN + 1, c * PER_COLUMN + PER_COLUMN];
var columnOf = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER ? Math.floor((n - 1) / PER_COLUMN) : -1;
function cellOfNumber(t, n) {
  const c = columnOf(n);
  if (c < 0)
    return -1;
  for (let r = 0;r < SIZE2; r++)
    if (t[r][c] === n)
      return r * SIZE2 + c;
  return -1;
}
var cryptoRand = (n) => {
  const a = new Uint32Array(1);
  const limit = Math.floor(4294967296 / n) * n;
  do {
    crypto.getRandomValues(a);
  } while (a[0] >= limit);
  return a[0] % n;
};
var shuffle = (arr, rand) => {
  for (let i = arr.length - 1;i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
function generateTicket(rand = cryptoRand) {
  const t = Array.from({ length: SIZE2 }, () => Array(SIZE2).fill(null));
  for (let c = 0;c < SIZE2; c++) {
    const [lo, hi] = columnRange(c);
    const pool = [];
    for (let v = lo;v <= hi; v++)
      pool.push(v);
    const pick = shuffle(pool, rand).slice(0, c === 2 ? 4 : 5);
    let i = 0;
    for (let r = 0;r < SIZE2; r++)
      t[r][c] = r * SIZE2 + c === FREE_CELL2 ? null : pick[i++];
  }
  return t;
}
var ticketNumbers = (t) => t.flat().filter((v) => v !== null);
function isValidTicket(t) {
  if (!Array.isArray(t) || t.length !== SIZE2 || t.some((r) => !Array.isArray(r) || r.length !== SIZE2))
    return false;
  if (t[2][2] !== null)
    return false;
  const seen = new Set;
  for (let c = 0;c < SIZE2; c++) {
    const [lo, hi] = columnRange(c);
    for (let r = 0;r < SIZE2; r++) {
      const v = t[r][c];
      if (r * SIZE2 + c === FREE_CELL2)
        continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi || seen.has(v))
        return false;
      seen.add(v);
    }
  }
  return seen.size === 24;
}
var PATTERN_RULES = Object.fromEntries(HOUSE_IDS.map((h) => [h, { sets: HOUSES[h].sets, need: HOUSES[h].need }]));
function patternSets(t, p) {
  const flat = t.flat();
  return PATTERN_RULES[p].sets.map((cells) => cells.filter((i) => i !== FREE_CELL2).map((i) => flat[i]));
}
// src-bingo-4d636fa/packages/beacon/src/config.ts
var PRIZE_HOUSES = [
  { id: "line", label: "Line", how: "Mark any one row, column or diagonal. FREE counts.", max: 3, kind: "set", dflt: true, squares: "5" },
  { id: "twolines", label: "Two Lines", how: "Mark any two different lines.", max: 2, kind: "lines", squares: "9-10" },
  { id: "corners", label: "Four Corners", how: "Mark the four corner squares.", max: 3, kind: "set", dflt: true, squares: "4" },
  { id: "plus", label: "Plus", how: "Mark the whole middle row and the whole middle column.", max: 2, kind: "set", squares: "9" },
  { id: "x", label: "X", how: "Mark both diagonals.", max: 2, kind: "set", dflt: true, squares: "9" },
  { id: "frame", label: "Frame", how: "Mark the whole outer border.", max: 2, kind: "set", squares: "16" },
  { id: "stamp", label: "Postage Stamp", how: "Mark a 2 x 2 block in any corner.", max: 3, kind: "set", squares: "4" },
  { id: "letterL", label: "Letter L", how: "Mark the whole B column and the bottom row.", max: 2, kind: "set", squares: "9" },
  { id: "letterT", label: "Letter T", how: "Mark the whole top row and the whole N column.", max: 2, kind: "set", squares: "9" },
  { id: "blackout", label: "Blackout", how: "Mark every square on your card. FREE counts.", max: 2, kind: "set", dflt: true, squares: "24 + FREE" }
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
var MAX_ROUNDS = 5;
var MAX_CALLS = 75;
var DEMO_CAP = 10;
var GRACE_ROUNDS = 40;
var LATE_LAG_ROUNDS = 30;
var INTERMISSION_ROUNDS = 30;
var roundEid = (eid, round) => round <= 1 ? eid : `${eid}~r${round}`;
var PATTERN_ORDER = PRIZE_HOUSES.filter((h) => h.dflt).map((h) => h.id);
var MAX_MID_PER_TICKET = 3;
var MAX_BREAKS = MAX_MID_PER_TICKET;
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
  const cfg = { tickets: base.tickets, rewards: base.rewards, breaks: base.breaks, rounds: base.rounds ?? 1, invites: base.invites ?? defaultInvites(), opening: base.opening ?? [], closing: base.closing ?? [], ...base.name ? { name: base.name } : {}, ...base.brand ? { brand: base.brand } : {}, ...base.mark ? { mark: base.mark } : {}, ...base.join ? { join: base.join } : {}, ...base.tz ? { tz: base.tz } : {}, ...base.verify ? { verify: base.verify } : {}, ...base.employeesOnly ? { employeesOnly: true } : {}, ...base.idKind === "email" ? { idKind: "email" } : {}, ...base.roomMode ? { roomMode: true } : {} };
  if (input.rounds !== undefined) {
    if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > MAX_ROUNDS)
      return { ok: false, error: `An engagement has 1 to ${MAX_ROUNDS} rounds.` };
    cfg.rounds = input.rounds;
  }
  if (input.tickets !== undefined) {
    if (input.tickets !== 1 && input.tickets !== 2)
      return { ok: false, error: "Each participant gets 1 or 2 cards." };
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
        return { ok: false, error: "Unknown house in the rewards." };
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
        return { ok: false, error: `A break starts after 1 to ${MAX_CALLS - 1} numbers have been called.` };
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
        return { ok: false, error: "Two breaks cannot start at the same number." };
    cfg.breaks = out;
  }
  if (input.mark !== undefined) {
    if (input.mark !== "auto" && input.mark !== "tap")
      return { ok: false, error: 'Marking is "auto" (squares light up by themselves) or "tap" (guests tap to daub).' };
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
      return { ok: false, error: `Openings must fit together in the ${OPENING_WINDOW_SECONDS / 60} minutes before the first number. An opening with no time counts as 60 seconds.` };
    if (isOpening)
      cfg.opening = slots;
    else
      cfg.closing = slots;
  }
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
  if (input.roomMode !== undefined) {
    if (typeof input.roomMode !== "boolean")
      return { ok: false, error: "Everyone in one room: say yes or no." };
    if (input.roomMode)
      cfg.roomMode = true;
    else
      delete cfg.roomMode;
  }
  if (input.invites !== undefined) {
    const v = input.invites;
    if (!v || typeof v !== "object" || typeof v.on !== "boolean")
      return { ok: false, error: "Invites: say whether they are on or off." };
    const per = v.per === undefined ? cfg.invites.per : v.per;
    if (!Number.isInteger(per) || per < 1 || per > MAX_INVITES_PER_PERSON)
      return { ok: false, error: `You and up to ${MAX_INVITES_PER_PERSON} family members. Please choose a number from 1 to ${MAX_INVITES_PER_PERSON}.` };
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

// src-bingo-4d636fa/packages/beacon/src/house-rules.ts
function ruleOf(t, key) {
  const r = PATTERN_RULES[key];
  return r ? { sets: patternSets(t, key), need: r.need } : null;
}
function ticketCompletion(t, key, log) {
  const r = ruleOf(t, key);
  if (!r)
    return -1;
  const first = new Map;
  for (let i = 0;i < log.length; i++) {
    const n = log[i];
    if (n > 0 && !first.has(n))
      first.set(n, i);
  }
  const done = [];
  for (const set of r.sets) {
    let last = -1, ok = true;
    for (const n of set) {
      const i = first.get(n);
      if (i === undefined) {
        ok = false;
        break;
      }
      if (i > last)
        last = i;
    }
    if (ok)
      done.push(last);
  }
  if (done.length < r.need)
    return -1;
  return done.sort((a, b) => a - b)[r.need - 1];
}
function ticketStillNeeds(t, key, called) {
  const r = ruleOf(t, key);
  if (!r)
    return 99;
  const left = r.sets.map((s) => s.filter((n) => !called.has(n)));
  if (r.need === 1)
    return Math.min(...left.map((l) => l.length));
  let best = 99;
  for (let a = 0;a < left.length; a++)
    for (let b = a + 1;b < left.length; b++)
      best = Math.min(best, new Set([...left[a], ...left[b]]).size);
  return best;
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

// src-bingo-4d636fa/packages/beacon/src/unique-ticket.ts
var arrangements = (k) => {
  let p = 1n;
  for (let i = 0;i < k; i++)
    p *= BigInt(PER_COLUMN - i);
  return p;
};
var A5 = arrangements(5);
var A4 = arrangements(4);
var TOTAL = A5 ** 4n * A4;
var BASE = [A5, A5, A4, A5, A5];
var COUNT = [5, 5, 4, 5, 5];
function unrankArrangement(rank, k, lo) {
  const pool = Array.from({ length: PER_COLUMN }, (_, i) => lo + i), out = [];
  let r = rank;
  for (let i = 0;i < k; i++) {
    const base = BigInt(PER_COLUMN - i), pick = Number(r % base);
    r /= base;
    out.push(pool.splice(pick, 1)[0]);
  }
  return out;
}
var keyCache = new Map;
var keyOf = (eid) => {
  let k = keyCache.get(eid);
  if (!k) {
    if (keyCache.size > 64)
      keyCache.clear();
    k = sha2562(utf8ToBytes("card-space|" + eid));
    keyCache.set(eid, k);
  }
  return k;
};
function roundFn(right, r, key, buf, half) {
  let v = Number(right);
  buf[key.length] = r;
  for (let i = 0;i < 6; i++) {
    buf[key.length + 1 + i] = v % 256;
    v = Math.floor(v / 256);
  }
  const h = sha2562(buf);
  let f = 0;
  for (let i = 0;i < 6; i++)
    f = f * 256 + h[i];
  return BigInt(f % 2 ** half);
}
function feistel(x, half, key) {
  const hb = BigInt(half), mask = (1n << hb) - 1n;
  let left = x >> hb, right = x & mask;
  const buf = new Uint8Array(key.length + 7);
  buf.set(key);
  for (let r = 0;r < 6; r++) {
    const next = left ^ roundFn(right, r, key, buf, half);
    left = right;
    right = next;
  }
  return left << hb | right;
}
function permute(i, n, key) {
  const x0 = BigInt(i);
  if (x0 < 0n || x0 >= n)
    throw new Error("position outside the list");
  let bits = 2;
  while (1n << BigInt(bits) < n)
    bits++;
  if (bits & 1)
    bits++;
  const half = bits / 2;
  if (half > 45)
    throw new Error("list too long");
  let x = x0;
  do
    x = feistel(x, half, key);
  while (x >= n);
  return x;
}
function ticketAt(engagementId, position) {
  let q = permute(position, TOTAL, keyOf(engagementId));
  const t = Array.from({ length: SIZE2 }, () => Array(SIZE2).fill(null));
  for (let c = 0;c < SIZE2; c++) {
    const digit = q % BASE[c];
    q /= BASE[c];
    const nums = unrankArrangement(digit, COUNT[c], columnRange(c)[0]);
    let i = 0;
    for (let r = 0;r < SIZE2; r++)
      t[r][c] = r * SIZE2 + c === FREE_CELL2 ? null : nums[i++];
  }
  return t;
}
var seatOfPid = (pid) => {
  const m = /^(\d{1,7})x[0-9a-f]{8,}$/.exec(pid);
  const s = m ? Number(m[1]) : 0;
  return s >= 1 ? s : null;
};
var positionOf = (seat, which) => 2 * (seat - 1) + which;
// src-bingo-4d636fa/vendor/game-core/packages/core/src/roles.ts
var WAIT_LAPSE_MS = 30 * 60000;
// src-bingo-4d636fa/vendor/game-core/packages/core/src/flow.ts
var MAX_AHEAD_MS = 30 * 86400000;
var SLOT_MS = 15 * 60000;
// src-bingo-4d636fa/vendor/game-core/packages/core/src/retention.ts
var AUTO_DELETE_AFTER_MS = 20 * 3600000;
var PRIZE_SHEET_REMINDER_MS = 12 * 3600000;
var PDF_SEND_WITHIN_MS = 3 * 3600000;
// src-bingo-4d636fa/vendor/game-core/packages/core/src/sha256.ts
var K = Uint32Array.from({ length: 64 }, (_, i) => {
  let n = 2, c = 0;
  for (let p = 2;; p++) {
    let ok = true;
    for (let d = 2;d * d <= p; d++)
      if (p % d === 0) {
        ok = false;
        break;
      }
    if (ok && c++ === i) {
      n = p;
      break;
    }
  }
  return Math.floor(Math.cbrt(n) % 1 * 2 ** 32);
});
var rotr2 = (x, n) => x >>> n | x << 32 - n;
function sha256Hex(s) {
  const m = new TextEncoder().encode(s), l = m.length, padded = new Uint8Array(l + 9 + 63 >> 6 << 6);
  padded.set(m);
  padded[l] = 128;
  new DataView(padded.buffer).setUint32(padded.length - 4, l * 8, false);
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor(l * 8 / 2 ** 32), false);
  const h = Uint32Array.from({ length: 8 }, (_, i) => {
    const p = [2, 3, 5, 7, 11, 13, 17, 19][i];
    return Math.floor(Math.sqrt(p) % 1 * 2 ** 32);
  });
  const w = new Uint32Array(64), dv = new DataView(padded.buffer);
  for (let o = 0;o < padded.length; o += 64) {
    for (let i = 0;i < 16; i++)
      w[i] = dv.getUint32(o + i * 4, false);
    for (let i = 16;i < 64; i++) {
      const a2 = w[i - 15], b2 = w[i - 2];
      w[i] = w[i - 16] + (rotr2(a2, 7) ^ rotr2(a2, 18) ^ a2 >>> 3) + w[i - 7] + (rotr2(b2, 17) ^ rotr2(b2, 19) ^ b2 >>> 10) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0;i < 64; i++) {
      const t1 = hh + (rotr2(e, 6) ^ rotr2(e, 11) ^ rotr2(e, 25)) + (e & f ^ ~e & g) + K[i] + w[i] >>> 0;
      const t2 = (rotr2(a, 2) ^ rotr2(a, 13) ^ rotr2(a, 22)) + (a & b ^ a & c ^ b & c) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => {
      h[i] = h[i] + v >>> 0;
    });
  }
  return [...h].map((v) => v.toString(16).padStart(8, "0")).join("");
}
// src-bingo-4d636fa/vendor/game-core/packages/core/src/planner.ts
var import_prize_planner = __toESM(require_prize_planner(), 1);
// src-bingo-4d636fa/vendor/game-core/packages/core/src/funnel.ts
var FUNNEL_EVENTS = ["viewed", "size_chosen", "signup_started", "game_created", "game_published", "payment_page_reached", "payment_page_opened", "payment_link_copied", "payment_started", "payment_succeeded", "payment_failed", "game_started", "game_completed"];
// src-bingo-4d636fa/vendor/game-core/packages/bingo/src/settle.ts
var roundEid2 = (eid, round) => round <= 1 ? eid : `${eid}~r${round}`;
var fateOf = (eid, seat, house, ordinal) => sha256Hex(`CB1-TIE|${eid}|${seat}|tie|${house}|${ordinal}`);
var countedLog = (log, countFrom, callRounds) => countFrom && countFrom > 0 && callRounds ? log.map((n, k) => (callRounds[k] ?? Infinity) >= countFrom ? n : 0) : log;
function cardCompletion(card, house, log) {
  const flat = card.flat(), h = HOUSES[house], at = new Map;
  log.forEach((n, k) => {
    if (n && !at.has(n))
      at.set(n, k);
  });
  const when = (set) => {
    let m = -1;
    for (const i of set) {
      if (i === FREE_CELL)
        continue;
      const k = flat[i] == null ? undefined : at.get(flat[i]);
      if (k === undefined)
        return -1;
      if (k > m)
        m = k;
    }
    return m;
  };
  const done = h.sets.map(when).filter((k) => k >= 0).sort((a, b) => a - b);
  return done.length >= h.need ? Math.max(done[h.need - 1], 0) : -1;
}
function seatCompletion(cards, house, log) {
  let best = -1;
  for (const c of cards) {
    const i = cardCompletion(c, house, log);
    if (i >= 0 && (best < 0 || i < best))
      best = i;
  }
  return best;
}
var ordinalsOf = (houses, h) => Array.from({ length: Math.min(houses[h] ?? 0, HOUSES[h].max) }, (_, i) => i + 1);
function assignOrdinals(eid, house, groups, ordinals, round = 1) {
  const out = [], ord = [...ordinals].sort((a, b) => a - b);
  let o = 0;
  for (const [idx, seats] of [...groups].sort((a, b) => a[0] - b[0])) {
    const left = [...seats];
    while (left.length && o < ord.length) {
      const k = ord[o], f = new Map(left.map((s) => [s.id, fateOf(eid, s.key, house, k)]));
      left.sort((a, b) => f.get(a.id) < f.get(b.id) ? -1 : f.get(a.id) > f.get(b.id) ? 1 : a.id < b.id ? -1 : 1);
      out.push({ house, ordinal: k, idx, player: left.shift().id, round, ...seats.length > 1 ? { tied: seats.length } : {} });
      o++;
    }
    if (o >= ord.length)
      break;
  }
  return out;
}
function settleFromLog(eid, seats, log, houses, round = 1, callRounds) {
  const id = roundEid2(eid, round), out = [];
  const by = new Map(HOUSE_IDS.map((h) => [h, new Map]));
  for (const s of seats) {
    const mine = countedLog(log, s.countFrom, callRounds);
    for (const h of HOUSE_IDS) {
      if (!ordinalsOf(houses, h).length)
        continue;
      const i = seatCompletion(s.cards, h, mine);
      if (i < 0)
        continue;
      const g = by.get(h), e = { id: s.id, key: s.seat ?? s.id };
      const arr = g.get(i);
      if (arr)
        arr.push(e);
      else
        g.set(i, [e]);
    }
  }
  for (const h of HOUSE_IDS)
    out.push(...assignOrdinals(id, h, [...by.get(h).entries()], ordinalsOf(houses, h), round));
  return out;
}

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
function calcOffsets(n, window2, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window2 * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window2 % 2 !== 0;
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
    for (let window2 = 0;window2 < windows; window2++) {
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
    for (let window2 = 0;window2 < wo.windows; window2++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window2, wo);
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
    for (let window2 = 0;window2 < wo.windows; window2++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window2, wo);
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

// node_modules/@noble/curves/esm/abstract/weierstrass.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var divNearest = (num2, den) => (num2 + (num2 >= 0 ? den : -den) / _2n2) / den;
function _splitEndoScalar(k, basis, n) {
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n4;
  const k2neg = k2 < _0n4;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
  if (k1 < _0n4 || k1 >= MAX_NUM || k2 < _0n4 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed, k=" + k);
  }
  return { k1neg, k1, k2neg, k2 };
}
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _3n2 = BigInt(3);
var _4n2 = BigInt(4);
function _normFnElement(Fn, key) {
  const { BYTES: expected } = Fn;
  let num2;
  if (typeof key === "bigint") {
    num2 = key;
  } else {
    let bytes = ensureBytes("private key", key);
    try {
      num2 = Fn.fromBytes(bytes);
    } catch (error) {
      throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
    }
  }
  if (!Fn.isValidNot0(num2))
    throw new Error("invalid private key: out of range [1..N-1]");
  return num2;
}
function weierstrassN(params, extraOpts = {}) {
  const validated = _createCurveFields("weierstrass", params, extraOpts);
  const { Fp, Fn } = validated;
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
    if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const lengths = getWLengths(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    _abool2(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes(pprefix(hasEvenY), bx);
    } else {
      return concatBytes(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    _abytes2(bytes, undefined, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const isYOdd = Fp.isOdd(y);
      const isHeadOdd = (head & 1) === 1;
      if (isHeadOdd !== isYOdd)
        y = Fp.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
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
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n2);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
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
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    if (Fp.eql(Z, Fp.ONE))
      return { x: X, y: Y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp.ONE : Fp.inv(Z);
    const x = Fp.mul(X, iz);
    const y = Fp.mul(Y, iz);
    const zz = Fp.mul(Z, iz);
    if (is0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (!Fp.eql(zz, Fp.ONE))
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    if (p.is0()) {
      if (extraOpts.allowInfinityPoint && !Fp.is0(p.Y))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp.isValid(x) || !Fp.isValid(y))
      throw new Error("bad point: x or y not field elements");
    if (!isValidXY(x, y))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
    k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
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
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P2 = Point.fromAffine(decodePoint(_abytes2(bytes, undefined, "point")));
      P2.assertValidity();
      return P2;
    }
    static fromHex(hex) {
      return Point.fromBytes(ensureBytes("pointHex", hex));
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
        this.multiply(_3n2);
      return this;
    }
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    double() {
      const { a, b } = CURVE;
      const b3 = Fp.mul(b, _3n2);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = Fp.mul(a, Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = Fp.mul(a, t2);
      t3 = Fp.sub(t0, t2);
      t3 = Fp.mul(a, t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp;
      const a = CURVE.a;
      const b3 = Fp.mul(CURVE.b, _3n2);
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = Fp.mul(a, t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = Fp.mul(a, t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = Fp.mul(a, t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
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
      if (!Fn.isValidNot0(scalar))
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
      if (!Fn.isValid(sc))
        throw new Error("invalid scalar: out of range");
      if (sc === _0n4 || p.is0())
        return Point.ZERO;
      if (sc === _1n4)
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
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.unsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n4)
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
      return pippenger(Point, Fn, points, scalars);
    }
    static fromPrivateKey(privateKey) {
      return Point.BASE.multiply(_normFnElement(Fn, privateKey));
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
  Point.ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
  Point.Fp = Fp;
  Point.Fn = Fn;
  const bits = Fn.BITS;
  const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
  Point.BASE.precompute(8);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function SWUFpSqrtRatio(Fp, Z) {
  const q = Fp.ORDER;
  let l = _0n4;
  for (let o = q - _1n4;o % _2n2 === _0n4; o /= _2n2)
    l += _1n4;
  const c1 = l;
  const _2n_pow_c1_1 = _2n2 << c1 - _1n4 - _1n4;
  const _2n_pow_c1 = _2n_pow_c1_1 * _2n2;
  const c2 = (q - _1n4) / _2n_pow_c1;
  const c3 = (c2 - _1n4) / _2n2;
  const c4 = _2n_pow_c1 - _1n4;
  const c5 = _2n_pow_c1_1;
  const c6 = Fp.pow(Z, c2);
  const c7 = Fp.pow(Z, (c2 + _1n4) / _2n2);
  let sqrtRatio = (u, v) => {
    let tv1 = c6;
    let tv2 = Fp.pow(v, c4);
    let tv3 = Fp.sqr(tv2);
    tv3 = Fp.mul(tv3, v);
    let tv5 = Fp.mul(u, tv3);
    tv5 = Fp.pow(tv5, c3);
    tv5 = Fp.mul(tv5, tv2);
    tv2 = Fp.mul(tv5, v);
    tv3 = Fp.mul(tv5, u);
    let tv4 = Fp.mul(tv3, tv2);
    tv5 = Fp.pow(tv4, c5);
    let isQR = Fp.eql(tv5, Fp.ONE);
    tv2 = Fp.mul(tv3, c7);
    tv5 = Fp.mul(tv4, tv1);
    tv3 = Fp.cmov(tv2, tv3, isQR);
    tv4 = Fp.cmov(tv5, tv4, isQR);
    for (let i = c1;i > _1n4; i--) {
      let tv52 = i - _2n2;
      tv52 = _2n2 << tv52 - _1n4;
      let tvv5 = Fp.pow(tv4, tv52);
      const e1 = Fp.eql(tvv5, Fp.ONE);
      tv2 = Fp.mul(tv3, tv1);
      tv1 = Fp.mul(tv1, tv1);
      tvv5 = Fp.mul(tv4, tv1);
      tv3 = Fp.cmov(tv2, tv3, e1);
      tv4 = Fp.cmov(tvv5, tv4, e1);
    }
    return { isValid: isQR, value: tv3 };
  };
  if (Fp.ORDER % _4n2 === _3n2) {
    const c12 = (Fp.ORDER - _3n2) / _4n2;
    const c22 = Fp.sqrt(Fp.neg(Z));
    sqrtRatio = (u, v) => {
      let tv1 = Fp.sqr(v);
      const tv2 = Fp.mul(u, v);
      tv1 = Fp.mul(tv1, tv2);
      let y1 = Fp.pow(tv1, c12);
      y1 = Fp.mul(y1, tv2);
      const y2 = Fp.mul(y1, c22);
      const tv3 = Fp.mul(Fp.sqr(y1), v);
      const isQR = Fp.eql(tv3, u);
      let y = Fp.cmov(y2, y1, isQR);
      return { isValid: isQR, value: y };
    };
  }
  return sqrtRatio;
}
function mapToCurveSimpleSWU(Fp, opts) {
  validateField(Fp);
  const { A, B, Z } = opts;
  if (!Fp.isValid(A) || !Fp.isValid(B) || !Fp.isValid(Z))
    throw new Error("mapToCurveSimpleSWU: invalid opts");
  const sqrtRatio = SWUFpSqrtRatio(Fp, Z);
  if (!Fp.isOdd)
    throw new Error("Field does not have .isOdd()");
  return (u) => {
    let tv1, tv2, tv3, tv4, tv5, tv6, x, y;
    tv1 = Fp.sqr(u);
    tv1 = Fp.mul(tv1, Z);
    tv2 = Fp.sqr(tv1);
    tv2 = Fp.add(tv2, tv1);
    tv3 = Fp.add(tv2, Fp.ONE);
    tv3 = Fp.mul(tv3, B);
    tv4 = Fp.cmov(Z, Fp.neg(tv2), !Fp.eql(tv2, Fp.ZERO));
    tv4 = Fp.mul(tv4, A);
    tv2 = Fp.sqr(tv3);
    tv6 = Fp.sqr(tv4);
    tv5 = Fp.mul(tv6, A);
    tv2 = Fp.add(tv2, tv5);
    tv2 = Fp.mul(tv2, tv3);
    tv6 = Fp.mul(tv6, tv4);
    tv5 = Fp.mul(tv6, B);
    tv2 = Fp.add(tv2, tv5);
    x = Fp.mul(tv1, tv3);
    const { isValid, value } = sqrtRatio(tv2, tv6);
    y = Fp.mul(tv1, u);
    y = Fp.mul(y, value);
    x = Fp.cmov(x, tv3, isValid);
    y = Fp.cmov(y, value, isValid);
    const e1 = Fp.isOdd(u) === Fp.isOdd(y);
    y = Fp.cmov(Fp.neg(y), y, e1);
    const tv4_inv = FpInvertBatch(Fp, [tv4], true)[0];
    x = Fp.mul(x, tv4_inv);
    return { x, y };
  };
}
function getWLengths(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    signature: 2 * Fn.BYTES
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
  const Fp = c.Fp;
  let allowedLengths = c.allowedPrivateKeyLengths ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2)))) : undefined;
  const Fn = Field(CURVE.n, {
    BITS: c.nBitLength,
    allowedLengths,
    modFromBytes: c.wrapPrivateKey
  });
  const curveOpts = {
    Fp,
    Fn,
    allowInfinityPoint: c.allowInfinityPoint,
    endo: c.endo,
    isTorsionFree: c.isTorsionFree,
    clearCofactor: c.clearCofactor,
    fromBytes: c.fromBytes,
    toBytes: c.toBytes
  };
  return { CURVE, curveOpts };
}
function _legacyHelperEquat(Fp, a, b) {
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, a)), b);
  }
  return weierstrassEquation;
}
function _weierstrass_new_output_to_legacy(c, Point) {
  const { Fp, Fn } = Point;
  function isWithinCurveOrder(num2) {
    return inRange(num2, _1n4, Fn.ORDER);
  }
  const weierstrassEquation = _legacyHelperEquat(Fp, c.a, c.b);
  return Object.assign({}, {
    CURVE: c,
    Point,
    ProjectivePoint: Point,
    normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
    weierstrassEquation,
    isWithinCurveOrder
  });
}

// node_modules/@noble/curves/esm/abstract/bls.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n3 = BigInt(2);
var _3n3 = BigInt(3);
function NAfDecomposition(a) {
  const res = [];
  for (;a > _1n5; a >>= _1n5) {
    if ((a & _1n5) === _0n5)
      res.unshift(0);
    else if ((a & _3n3) === _3n3) {
      res.unshift(-1);
      a += _1n5;
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
  const Fp2div2 = Fp2.div(Fp2.ONE, Fp2.mul(Fp2.ONE, _2n3));
  function pointDouble(ell, Rx, Ry, Rz) {
    const t0 = Fp2.sqr(Ry);
    const t1 = Fp2.sqr(Rz);
    const t2 = Fp2.mulByB(Fp2.mul(t1, _3n3));
    const t3 = Fp2.mul(t2, _3n3);
    const t4 = Fp2.sub(Fp2.sub(Fp2.sqr(Fp2.add(Ry, Rz)), t1), t0);
    const c0 = Fp2.sub(t2, t0);
    const c1 = Fp2.mul(Fp2.sqr(Rx), _3n3);
    const c2 = Fp2.neg(t4);
    ell.push([c0, c1, c2]);
    Rx = Fp2.mul(Fp2.mul(Fp2.mul(Fp2.sub(t0, t3), Rx), Ry), Fp2div2);
    Ry = Fp2.sub(Fp2.sqr(Fp2.mul(Fp2.add(t0, t3), Fp2div2)), Fp2.mul(Fp2.sqr(t2), _3n3));
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
    const t5 = Fp2.add(Fp2.sub(t3, Fp2.mul(t4, _2n3)), Fp2.mul(Fp2.sqr(t0), Rz));
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
        let keys = messagePubKeyMap.get(msg);
        if (keys === undefined) {
          keys = [];
          messagePubKeyMap.set(msg, keys);
        }
        keys.push(pub);
      }
      const paired = [];
      const G = PubCurve.Point.BASE;
      try {
        for (const [msg, keys] of messagePubKeyMap) {
          const groupPublicKey = keys.reduce((acc, msg2) => acc.add(msg2));
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
  const { Fp, Fr, Fp2, Fp6, Fp12 } = CURVE.fields;
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
      Fp,
      Fp2,
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
var _0n6 = BigInt(0);
var _1n6 = BigInt(1);
var _2n4 = BigInt(2);
var _3n4 = BigInt(3);
function calcFrobeniusCoefficients(Fp, nonResidue, modulus, degree, num2 = 1, divisor) {
  const _divisor = BigInt(divisor === undefined ? degree : divisor);
  const towerModulus = modulus ** BigInt(degree);
  const res = [];
  for (let i = 0;i < num2; i++) {
    const a = BigInt(i + 1);
    const powers = [];
    for (let j = 0, qPower = _1n6;j < degree; j++) {
      const power = (a * qPower - a) / _divisor % towerModulus;
      powers.push(Fp.pow(nonResidue, power));
      qPower *= modulus;
    }
    res.push(powers);
  }
  return res;
}
function psiFrobenius(Fp, Fp2, base) {
  const PSI_X = Fp2.pow(base, (Fp.ORDER - _1n6) / _3n4);
  const PSI_Y = Fp2.pow(base, (Fp.ORDER - _1n6) / _2n4);
  function psi(x, y) {
    const x2 = Fp2.mul(Fp2.frobeniusMap(x, 1), PSI_X);
    const y2 = Fp2.mul(Fp2.frobeniusMap(y, 1), PSI_Y);
    return [x2, y2];
  }
  const PSI2_X = Fp2.pow(base, (Fp.ORDER ** _2n4 - _1n6) / _3n4);
  const PSI2_Y = Fp2.pow(base, (Fp.ORDER ** _2n4 - _1n6) / _2n4);
  if (!Fp2.eql(PSI2_Y, Fp2.neg(Fp2.ONE)))
    throw new Error("psiFrobenius: PSI2_Y!==-1");
  function psi2(x, y) {
    return [Fp2.mul(x, PSI2_X), Fp2.neg(y)];
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
var Fp2fromBigTuple = (Fp, tuple) => {
  if (tuple.length !== 2)
    throw new Error("invalid tuple");
  const fps = tuple.map((n) => Fp.create(n));
  return { c0: fps[0], c1: fps[1] };
};

class _Field2 {
  constructor(Fp, opts = {}) {
    this.MASK = _1n6;
    const ORDER = Fp.ORDER;
    const FP2_ORDER = ORDER * ORDER;
    this.Fp = Fp;
    this.ORDER = FP2_ORDER;
    this.BITS = bitLen(FP2_ORDER);
    this.BYTES = Math.ceil(bitLen(FP2_ORDER) / 8);
    this.isLE = Fp.isLE;
    this.ZERO = { c0: Fp.ZERO, c1: Fp.ZERO };
    this.ONE = { c0: Fp.ONE, c1: Fp.ZERO };
    this.Fp_NONRESIDUE = Fp.create(opts.NONRESIDUE || BigInt(-1));
    this.Fp_div2 = Fp.div(Fp.ONE, _2n4);
    this.NONRESIDUE = Fp2fromBigTuple(Fp, opts.FP2_NONRESIDUE);
    this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp, this.Fp_NONRESIDUE, Fp.ORDER, 2)[0];
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
      return typeof num2 === "bigint" && _0n6 <= num2 && num2 < ORDER;
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
    const { Fp } = this;
    if (typeof rhs === "bigint")
      return { c0: Fp.mul(c0, rhs), c1: Fp.mul(c1, rhs) };
    const { c0: r0, c1: r1 } = rhs;
    let t1 = Fp.mul(c0, r0);
    let t2 = Fp.mul(c1, r1);
    const o0 = Fp.sub(t1, t2);
    const o1 = Fp.sub(Fp.mul(Fp.add(c0, c1), Fp.add(r0, r1)), Fp.add(t1, t2));
    return { c0: o0, c1: o1 };
  }
  sqr({ c0, c1 }) {
    const { Fp } = this;
    const a = Fp.add(c0, c1);
    const b = Fp.sub(c0, c1);
    const c = Fp.add(c0, c0);
    return { c0: Fp.mul(a, b), c1: Fp.mul(c, c1) };
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
    const { Fp } = this;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
  }
  inv({ c0: a, c1: b }) {
    const { Fp } = this;
    const factor = Fp.inv(Fp.create(a * a + b * b));
    return { c0: Fp.mul(factor, Fp.create(a)), c1: Fp.mul(factor, Fp.create(-b)) };
  }
  sqrt(num2) {
    const { Fp } = this;
    const Fp2 = this;
    const { c0, c1 } = num2;
    if (Fp.is0(c1)) {
      if (FpLegendre(Fp, c0) === 1)
        return Fp2.create({ c0: Fp.sqrt(c0), c1: Fp.ZERO });
      else
        return Fp2.create({ c0: Fp.ZERO, c1: Fp.sqrt(Fp.div(c0, this.Fp_NONRESIDUE)) });
    }
    const a = Fp.sqrt(Fp.sub(Fp.sqr(c0), Fp.mul(Fp.sqr(c1), this.Fp_NONRESIDUE)));
    let d = Fp.mul(Fp.add(a, c0), this.Fp_div2);
    const legendre = FpLegendre(Fp, d);
    if (legendre === -1)
      d = Fp.sub(d, a);
    const a0 = Fp.sqrt(d);
    const candidateSqrt = Fp2.create({ c0: a0, c1: Fp.div(Fp.mul(c1, this.Fp_div2), a0) });
    if (!Fp2.eql(Fp2.sqr(candidateSqrt), num2))
      throw new Error("Cannot find square root");
    const x1 = candidateSqrt;
    const x2 = Fp2.neg(x1);
    const { re: re1, im: im1 } = Fp2.reim(x1);
    const { re: re2, im: im2 } = Fp2.reim(x2);
    if (im1 > im2 || im1 === im2 && re1 > re2)
      return x1;
    return x2;
  }
  isOdd(x) {
    const { re: x0, im: x1 } = this.reim(x);
    const sign_0 = x0 % _2n4;
    const zero_0 = x0 === _0n6;
    const sign_1 = x1 % _2n4;
    return BigInt(sign_0 || zero_0 && sign_1) == _1n6;
  }
  fromBytes(b) {
    const { Fp } = this;
    if (b.length !== this.BYTES)
      throw new Error("fromBytes invalid length=" + b.length);
    return { c0: Fp.fromBytes(b.subarray(0, Fp.BYTES)), c1: Fp.fromBytes(b.subarray(Fp.BYTES)) };
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
    this.MASK = _1n6;
    this.Fp2 = Fp2;
    this.ORDER = Fp2.ORDER;
    this.BITS = 3 * Fp2.BITS;
    this.BYTES = 3 * Fp2.BYTES;
    this.isLE = Fp2.isLE;
    this.ZERO = { c0: Fp2.ZERO, c1: Fp2.ZERO, c2: Fp2.ZERO };
    this.ONE = { c0: Fp2.ONE, c1: Fp2.ZERO, c2: Fp2.ZERO };
    const { Fp } = Fp2;
    const frob = calcFrobeniusCoefficients(Fp2, Fp2.NONRESIDUE, Fp.ORDER, 6, 2, 3);
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
    let t1 = Fp2.mul(Fp2.mul(c0, c1), _2n4);
    let t3 = Fp2.mul(Fp2.mul(c1, c2), _2n4);
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
    const { Fp } = Fp2;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
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
    this.MASK = _1n6;
    const { Fp2 } = Fp6;
    const { Fp } = Fp2;
    this.Fp6 = Fp6;
    this.ORDER = Fp2.ORDER;
    this.BITS = 2 * Fp6.BITS;
    this.BYTES = 2 * Fp6.BYTES;
    this.isLE = Fp6.isLE;
    this.ZERO = { c0: Fp6.ZERO, c1: Fp6.ZERO };
    this.ONE = { c0: Fp6.ONE, c1: Fp6.ZERO };
    this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp2, Fp2.NONRESIDUE, Fp.ORDER, 12, 1, 6)[0];
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
    const { Fp } = Fp2;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
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
        c0: Fp2.add(Fp2.mul(Fp2.sub(t3, c0c0), _2n4), t3),
        c1: Fp2.add(Fp2.mul(Fp2.sub(t5, c0c1), _2n4), t5),
        c2: Fp2.add(Fp2.mul(Fp2.sub(t7, c0c2), _2n4), t7)
      }),
      c1: Fp6.create({
        c0: Fp2.add(Fp2.mul(Fp2.add(t9, c1c0), _2n4), t9),
        c1: Fp2.add(Fp2.mul(Fp2.add(t4, c1c1), _2n4), t4),
        c2: Fp2.add(Fp2.mul(Fp2.add(t6, c1c2), _2n4), t6)
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
  const Fp = Field(opts.ORDER);
  const Fp2 = new _Field2(Fp, opts);
  const Fp6 = new _Field6(Fp2);
  const Fp12 = new _Field12(Fp6, opts);
  return { Fp, Fp2, Fp6, Fp12 };
}

// node_modules/@noble/curves/esm/bls12-381.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n7 = BigInt(0);
var _1n7 = BigInt(1);
var _2n5 = BigInt(2);
var _3n5 = BigInt(3);
var _4n3 = BigInt(4);
var BLS_X = BigInt("0xd201000000010000");
var BLS_X_LEN = bitLen(BLS_X);
var bls12_381_CURVE_G1 = {
  p: BigInt("0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"),
  n: BigInt("0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001"),
  h: BigInt("0x396c8c005555e1568c00aaab0000aaab"),
  a: _0n7,
  b: _4n3,
  Gx: BigInt("0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"),
  Gy: BigInt("0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1")
};
var bls12_381_Fr = Field(bls12_381_CURVE_G1.n, {
  modFromBytes: true,
  isLE: true
});
var { Fp, Fp2, Fp6, Fp12 } = tower12({
  ORDER: bls12_381_CURVE_G1.p,
  X_LEN: BLS_X_LEN,
  FP2_NONRESIDUE: [_1n7, _1n7],
  Fp2mulByB: ({ c0, c1 }) => {
    const t0 = Fp.mul(c0, _4n3);
    const t1 = Fp.mul(c1, _4n3);
    return { c0: Fp.sub(t0, t1), c1: Fp.add(t0, t1) };
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
var { G2psi, G2psi2 } = psiFrobenius(Fp, Fp2, Fp2.div(Fp2.ONE, Fp2.NONRESIDUE));
var htfDefaults = Object.freeze({
  DST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
  encodeDST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
  p: Fp.ORDER,
  m: 2,
  k: 128,
  expand: "xmd",
  hash: sha256
});
var bls12_381_CURVE_G2 = {
  p: Fp2.ORDER,
  n: bls12_381_CURVE_G1.n,
  h: BigInt("0x5d543a95414e7f1091d50792876a202cd91de4547085abaa68a205b2e5a7ddfa628f1cb4d9e82ef21537e293a6691ae1616ec6e786f0c70cf1c38e31c7238e5"),
  a: Fp2.ZERO,
  b: Fp2.fromBigTuple([_4n3, _4n3]),
  Gx: Fp2.fromBigTuple([
    BigInt("0x024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8"),
    BigInt("0x13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e")
  ]),
  Gy: Fp2.fromBigTuple([
    BigInt("0x0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801"),
    BigInt("0x0606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be")
  ])
};
var COMPZERO = setMask(Fp.toBytes(_0n7), { infinity: true, compressed: true });
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
  const { BYTES: L, ORDER: P2 } = Fp;
  const is0 = point.is0();
  const { x, y } = point.toAffine();
  if (isComp) {
    if (is0)
      return COMPZERO.slice();
    const sort = Boolean(y * _2n5 / P2);
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
  const { BYTES: L, ORDER: P2 } = Fp;
  const { x, y } = point.toAffine();
  if (point.is0())
    return COMPZERO.slice();
  const sort = Boolean(y * _2n5 / P2);
  return setMask(numberToBytesBE(x, L), { compressed: true, sort });
}
function pointG1FromBytes(bytes) {
  const { compressed, infinity, sort, value } = parseMask(bytes);
  const { BYTES: L, ORDER: P2 } = Fp;
  if (value.length === 48 && compressed) {
    const compressedValue = bytesToNumberBE(value);
    const x = Fp.create(compressedValue & bitMask(Fp.BITS));
    if (infinity) {
      if (x !== _0n7)
        throw new Error("invalid G1 point: non-empty, at infinity, with compression");
      return { x: _0n7, y: _0n7 };
    }
    const right = Fp.add(Fp.pow(x, _3n5), Fp.create(bls12_381_CURVE_G1.b));
    let y = Fp.sqrt(right);
    if (!y)
      throw new Error("invalid G1 point: compressed point");
    if (y * _2n5 / P2 !== BigInt(sort))
      y = Fp.neg(y);
    return { x: Fp.create(x), y: Fp.create(y) };
  } else if (value.length === 96 && !compressed) {
    const x = bytesToNumberBE(value.subarray(0, L));
    const y = bytesToNumberBE(value.subarray(L));
    if (infinity) {
      if (x !== _0n7 || y !== _0n7)
        throw new Error("G1: non-empty point at infinity");
      return bls12_381.G1.Point.ZERO.toAffine();
    }
    return { x: Fp.create(x), y: Fp.create(y) };
  } else {
    throw new Error("invalid G1 point: expected 48/96 bytes");
  }
}
function signatureG1FromBytes(hex) {
  const { infinity, sort, value } = parseMask(ensureBytes("signatureHex", hex, 48));
  const P2 = Fp.ORDER;
  const Point = bls12_381.G1.Point;
  const compressedValue = bytesToNumberBE(value);
  if (infinity)
    return Point.ZERO;
  const x = Fp.create(compressedValue & bitMask(Fp.BITS));
  const right = Fp.add(Fp.pow(x, _3n5), Fp.create(bls12_381_CURVE_G1.b));
  let y = Fp.sqrt(right);
  if (!y)
    throw new Error("invalid G1 point: compressed");
  const aflag = BigInt(sort);
  if (y * _2n5 / P2 !== aflag)
    y = Fp.neg(y);
  const point = Point.fromAffine({ x, y });
  point.assertValidity();
  return point;
}
function pointG2ToBytes(_c, point, isComp) {
  const { BYTES: L, ORDER: P2 } = Fp;
  const is0 = point.is0();
  const { x, y } = point.toAffine();
  if (isComp) {
    if (is0)
      return concatBytes(COMPZERO, numberToBytesBE(_0n7, L));
    const flag2 = Boolean(y.c1 === _0n7 ? y.c0 * _2n5 / P2 : y.c1 * _2n5 / P2);
    return concatBytes(setMask(numberToBytesBE(x.c1, L), { compressed: true, sort: flag2 }), numberToBytesBE(x.c0, L));
  } else {
    if (is0)
      return concatBytes(Uint8Array.of(64), new Uint8Array(4 * L - 1));
    const { re: x0, im: x1 } = Fp2.reim(x);
    const { re: y0, im: y1 } = Fp2.reim(y);
    return concatBytes(numberToBytesBE(x1, L), numberToBytesBE(x0, L), numberToBytesBE(y1, L), numberToBytesBE(y0, L));
  }
}
function signatureG2ToBytes(point) {
  point.assertValidity();
  const { BYTES: L } = Fp;
  if (point.is0())
    return concatBytes(COMPZERO, numberToBytesBE(_0n7, L));
  const { x, y } = point.toAffine();
  const { re: x0, im: x1 } = Fp2.reim(x);
  const { re: y0, im: y1 } = Fp2.reim(y);
  const tmp = y1 > _0n7 ? y1 * _2n5 : y0 * _2n5;
  const sort = Boolean(tmp / Fp.ORDER & _1n7);
  const z2 = x0;
  return concatBytes(setMask(numberToBytesBE(x1, L), { sort, compressed: true }), numberToBytesBE(z2, L));
}
function pointG2FromBytes(bytes) {
  const { BYTES: L, ORDER: P2 } = Fp;
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
      return { x: Fp2.ZERO, y: Fp2.ZERO };
    }
    const x_1 = slc(value, 0, L);
    const x_0 = slc(value, L, 2 * L);
    const x = Fp2.create({ c0: Fp.create(x_0), c1: Fp.create(x_1) });
    const right = Fp2.add(Fp2.pow(x, _3n5), bls12_381_CURVE_G2.b);
    let y = Fp2.sqrt(right);
    const Y_bit = y.c1 === _0n7 ? y.c0 * _2n5 / P2 : y.c1 * _2n5 / P2 ? _1n7 : _0n7;
    y = sort && Y_bit > 0 ? y : Fp2.neg(y);
    return { x, y };
  } else if (value.length === 192 && !compressed) {
    if (infinity) {
      if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
        throw new Error("invalid G2 point: uncompressed");
      }
      return { x: Fp2.ZERO, y: Fp2.ZERO };
    }
    const x1 = slc(value, 0 * L, 1 * L);
    const x0 = slc(value, 1 * L, 2 * L);
    const y1 = slc(value, 2 * L, 3 * L);
    const y0 = slc(value, 3 * L, 4 * L);
    return { x: Fp2.fromBigTuple([x0, x1]), y: Fp2.fromBigTuple([y0, y1]) };
  } else {
    throw new Error("invalid G2 point: expected 96/192 bytes");
  }
}
function signatureG2FromBytes(hex) {
  const { ORDER: P2 } = Fp;
  const { infinity, sort, value } = parseMask(ensureBytes("signatureHex", hex));
  const Point = bls12_381.G2.Point;
  const half = value.length / 2;
  if (half !== 48 && half !== 96)
    throw new Error("invalid compressed signature length, expected 96/192 bytes");
  const z1 = bytesToNumberBE(value.slice(0, half));
  const z2 = bytesToNumberBE(value.slice(half));
  if (infinity)
    return Point.ZERO;
  const x1 = Fp.create(z1 & bitMask(Fp.BITS));
  const x2 = Fp.create(z2);
  const x = Fp2.create({ c0: x2, c1: x1 });
  const y2 = Fp2.add(Fp2.pow(x, _3n5), bls12_381_CURVE_G2.b);
  let y = Fp2.sqrt(y2);
  if (!y)
    throw new Error("Failed to find a square root");
  const { re: y0, im: y1 } = Fp2.reim(y);
  const aflag1 = BigInt(sort);
  const isGreater = y1 > _0n7 && y1 * _2n5 / P2 !== aflag1;
  const is0 = y1 === _0n7 && y0 * _2n5 / P2 !== aflag1;
  if (isGreater || is0)
    y = Fp2.neg(y);
  const point = Point.fromAffine({ x, y });
  point.assertValidity();
  return point;
}
var bls12_381 = bls({
  fields: {
    Fp,
    Fp2,
    Fp6,
    Fp12,
    Fr: bls12_381_Fr
  },
  G1: {
    ...bls12_381_CURVE_G1,
    Fp,
    htfDefaults: { ...htfDefaults, m: 1, DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" },
    wrapPrivateKey: true,
    allowInfinityPoint: true,
    isTorsionFree: (c, point) => {
      const beta = BigInt("0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffe");
      const phi = new c(Fp.mul(point.X, beta), point.Y, point.Z);
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
      fromHex(hex) {
        return signatureG1FromBytes(hex);
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
    Fp: Fp2,
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
      fromHex(hex) {
        return signatureG2FromBytes(hex);
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
var isogenyMapG2 = isogenyMap(Fp2, [
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
].map((i) => i.map((pair) => Fp2.fromBigTuple(pair.map(BigInt)))));
var isogenyMapG1 = isogenyMap(Fp, [
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
var G1_SWU = mapToCurveSimpleSWU(Fp, {
  A: Fp.create(BigInt("0x144698a3b8e9433d693a02c96d4982b0ea985383ee66a8d8e8981aefd881ac98936f8da0e0f97f5cf428082d584c1d")),
  B: Fp.create(BigInt("0x12e2908d11688030018b12e8753eee3b2016c1f0f24f4070a0b9c14fcef35ef55a23215a316ceaa5d1cc48e98e172be0")),
  Z: Fp.create(BigInt(11))
});
var G2_SWU = mapToCurveSimpleSWU(Fp2, {
  A: Fp2.create({ c0: Fp.create(_0n7), c1: Fp.create(BigInt(240)) }),
  B: Fp2.create({ c0: Fp.create(BigInt(1012)), c1: Fp.create(BigInt(1012)) }),
  Z: Fp2.create({ c0: Fp.create(BigInt(-2)), c1: Fp.create(BigInt(-1)) })
});
function mapToG1(scalars) {
  const { x, y } = G1_SWU(Fp.create(scalars[0]));
  return isogenyMapG1(x, y);
}
function mapToG2(scalars) {
  const { x, y } = G2_SWU(Fp2.fromBigTuple(scalars));
  return isogenyMapG2(x, y);
}

// node_modules/@noble/curves/esm/abstract/edwards.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n8 = BigInt(0);
var _1n8 = BigInt(1);
var _2n6 = BigInt(2);
var _8n2 = BigInt(8);
function isEdValidXY(Fp3, CURVE, x, y) {
  const x2 = Fp3.sqr(x);
  const y2 = Fp3.sqr(y);
  const left = Fp3.add(Fp3.mul(CURVE.a, x2), y2);
  const right = Fp3.add(Fp3.ONE, Fp3.mul(CURVE.d, Fp3.mul(x2, y2)));
  return Fp3.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  const validated = _createCurveFields("edwards", params, extraOpts, extraOpts.FpFnLE);
  const { Fp: Fp3, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  _validateObject(extraOpts, {}, { uvRatio: "function" });
  const MASK = _2n6 << BigInt(Fn.BYTES * 8) - _1n8;
  const modP = (n) => Fp3.create(n);
  const uvRatio = extraOpts.uvRatio || ((u, v) => {
    try {
      return { isValid: true, value: Fp3.sqrt(Fp3.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n8 };
    }
  });
  if (!isEdValidXY(Fp3, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n8 : _0n8;
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
      iz = is0 ? _8n2 : Fp3.inv(Z);
    const x = modP(X * iz);
    const y = modP(Y * iz);
    const zz = Fp3.mul(Z, iz);
    if (is0)
      return { x: _0n8, y: _1n8 };
    if (zz !== _1n8)
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
      return new Point(x, y, _1n8, modP(x * y));
    }
    static fromBytes(bytes, zip215 = false) {
      const len = Fp3.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes(_abytes2(bytes, len, "point"));
      _abool2(zip215, "zip215");
      const normed = copyBytes(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp3.ORDER;
      aInRange("point.y", y, _0n8, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n8);
      const v = modP(d * y2 - a);
      let { isValid, value: x } = uvRatio(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = (x & _1n8) === _1n8;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n8 && isLastByteOdd)
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
        this.multiply(_2n6);
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
      const C = modP(_2n6 * modP(Z1 * Z1));
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
      if (scalar === _0n8)
        return Point.ZERO;
      if (this.is0() || scalar === _1n8)
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
      if (cofactor === _1n8)
        return this;
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp3.toBytes(y);
      bytes[bytes.length - 1] |= x & _1n8 ? 128 : 0;
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
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n8, modP(CURVE.Gx * CURVE.Gy));
  Point.ZERO = new Point(_0n8, _1n8, _1n8, _0n8);
  Point.Fp = Fp3;
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
  const { BASE: BASE2, Fp: Fp3, Fn } = Point;
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
    const point = BASE2.multiply(scalar);
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
    const R = BASE2.multiply(r).toBytes();
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
      SB = BASE2.multiplyUnsafe(s);
    } catch (error) {
      return false;
    }
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
    const RkA = R.add(A.multiplyUnsafe(k));
    return RkA.subtract(SB).clearCofactor().is0();
  }
  const _size = Fp3.BYTES;
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
      const u = is25519 ? Fp3.div(_1n8 + y, _1n8 - y) : Fp3.div(y - _1n8, y + _1n8);
      return Fp3.toBytes(u);
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
  const Fp3 = c.Fp;
  const Fn = Field(CURVE.n, c.nBitLength, true);
  const curveOpts = { Fp: Fp3, Fn, uvRatio: c.uvRatio };
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

// node_modules/@noble/curves/esm/ed25519.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n9 = /* @__PURE__ */ BigInt(0);
var _1n9 = BigInt(1);
var _2n7 = BigInt(2);
var _3n6 = BigInt(3);
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
  const b4 = pow2(b2, _2n7, P2) * b2 % P2;
  const b5 = pow2(b4, _1n9, P2) * x % P2;
  const b10 = pow2(b5, _5n2, P2) * b5 % P2;
  const b20 = pow2(b10, _10n, P2) * b10 % P2;
  const b40 = pow2(b20, _20n, P2) * b20 % P2;
  const b80 = pow2(b40, _40n, P2) * b40 % P2;
  const b160 = pow2(b80, _80n, P2) * b80 % P2;
  const b240 = pow2(b160, _80n, P2) * b80 % P2;
  const b250 = pow2(b240, _10n, P2) * b10 % P2;
  const pow_p_5_8 = pow2(b250, _2n7, P2) * x % P2;
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
var Fp3 = /* @__PURE__ */ (() => Field(ed25519_CURVE.p, { isLE: true }))();
var Fn = /* @__PURE__ */ (() => Field(ed25519_CURVE.n, { isLE: true }))();
var ed25519Defaults = /* @__PURE__ */ (() => ({
  ...ed25519_CURVE,
  Fp: Fp3,
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
var invertSqrt = (number) => uvRatio(_1n9, number);
var MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var bytes255ToNumberLE = (bytes) => ed25519.Point.Fp.create(bytesToNumberLE(bytes) & MAX_255B);
function calcElligatorRistrettoMap(r0) {
  const { d } = ed25519_CURVE;
  const P2 = ed25519_CURVE_p;
  const mod2 = (n) => Fp3.create(n);
  const r = mod2(SQRT_M1 * r0 * r0);
  const Ns = mod2((r + _1n9) * ONE_MINUS_D_SQ);
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
  const Nt = mod2(c * (r - _1n9) * D_MINUS_ONE_SQ - D);
  const s2 = s * s;
  const W0 = mod2((s + s) * D);
  const W1 = mod2(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod2(_1n9 - s2);
  const W3 = mod2(_1n9 + s2);
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
  static hashToCurve(hex) {
    return ristretto255_map(ensureBytes("ristrettoHash", hex, 64));
  }
  static fromBytes(bytes) {
    abytes(bytes, 32);
    const { a, d } = ed25519_CURVE;
    const P2 = ed25519_CURVE_p;
    const mod2 = (n) => Fp3.create(n);
    const s = bytes255ToNumberLE(bytes);
    if (!equalBytes(Fp3.toBytes(s), bytes) || isNegativeLE(s, P2))
      throw new Error("invalid ristretto255 encoding 1");
    const s2 = mod2(s * s);
    const u1 = mod2(_1n9 + a * s2);
    const u2 = mod2(_1n9 - a * s2);
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
    if (!isValid || isNegativeLE(t, P2) || y === _0n9)
      throw new Error("invalid ristretto255 encoding 2");
    return new _RistrettoPoint(new ed25519.Point(x, y, _1n9, t));
  }
  static fromHex(hex) {
    return _RistrettoPoint.fromBytes(ensureBytes("ristrettoHex", hex, 32));
  }
  static msm(points, scalars) {
    return pippenger(_RistrettoPoint, ed25519.Point.Fn, points, scalars);
  }
  toBytes() {
    let { X, Y, Z, T } = this.ep;
    const P2 = ed25519_CURVE_p;
    const mod2 = (n) => Fp3.create(n);
    const u1 = mod2(mod2(Z + Y) * mod2(Z - Y));
    const u2 = mod2(X * Y);
    const u2sq = mod2(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod2(u1 * u2sq));
    const D12 = mod2(invsqrt * u1);
    const D22 = mod2(invsqrt * u2);
    const zInv = mod2(D12 * D22 * T);
    let D;
    if (isNegativeLE(T * zInv, P2)) {
      let _x = mod2(Y * SQRT_M1);
      let _y = mod2(X * SQRT_M1);
      X = _x;
      Y = _y;
      D = mod2(D12 * INVSQRT_A_MINUS_D);
    } else {
      D = D22;
    }
    if (isNegativeLE(X * zInv, P2))
      Y = mod2(-Y);
    let s = mod2((Z - Y) * D);
    if (isNegativeLE(s, P2))
      s = mod2(-s);
    return Fp3.toBytes(s);
  }
  equals(other) {
    this.assertSame(other);
    const { X: X1, Y: Y1 } = this.ep;
    const { X: X2, Y: Y2 } = other.ep;
    const mod2 = (n) => Fp3.create(n);
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
_RistrettoPoint.Fp = /* @__PURE__ */ (() => Fp3)();
_RistrettoPoint.Fn = /* @__PURE__ */ (() => Fn)();

// src-bingo-4d636fa/packages/beacon/src/control.ts
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
var HOST_KEY_ENABLED = false;
async function signerOf(cfg, m) {
  if (await verifyControlSig(cfg.pubKey, m))
    return "organizer";
  if (HOST_KEY_ENABLED && cfg.hostKey && (m.action === "pause" || m.action === "resume") && await verifyControlSig(cfg.hostKey, m))
    return "host";
  return null;
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
    if (await signerOf(cfg, raw))
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
var MAX_HOLD_ROUNDS = 20;
function cleanHolds(x) {
  if (!Array.isArray(x))
    return [];
  const out = [];
  for (const h of x.slice(0, 40)) {
    const a = h?.start, b = h?.end;
    if (Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b > a && b - a <= MAX_HOLD_ROUNDS + 1)
      out.push({ start: a, end: b });
  }
  return out;
}
function withHolds(ivs, holds) {
  if (!holds.length)
    return ivs;
  const all = [...ivs, ...holds].sort((a, b) => a.start - b.start || a.end - b.end), out = [];
  for (const i of all) {
    const l = out[out.length - 1];
    if (l && i.start <= l.end)
      l.end = Math.max(l.end, i.end);
    else
      out.push({ ...i });
  }
  return out;
}
function resolveControl(cfg, log, holds = []) {
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
  return { intervals: withHolds(ivs.map((c) => ({ start: c.start, end: effEnd(c, cfg.maxPauseRounds) })), holds), stopRound: stop, ignored, applied };
}
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

// src-bingo-4d636fa/packages/beacon/src/index.ts
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
var roundTimeMs = (r, net = QUICKNET) => (net.genesisSec + (r - 1) * net.periodSec) * 1000;
var roundAt = (utcMs, net = QUICKNET) => Math.floor((utcMs / 1000 - net.genesisSec) / net.periodSec) + 1;
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
var NUMBERS = 75;
function scheduleFor(startRound, callSeconds, count = NUMBERS, net = QUICKNET) {
  if (!Number.isInteger(callSeconds) || callSeconds % net.periodSec !== 0 || callSeconds < net.periodSec * 2)
    throw new Error(`Call speed must be a multiple of ${net.periodSec} seconds, at least ${net.periodSec * 2}.`);
  const stride = callSeconds / net.periodSec;
  return Array.from({ length: count }, (_, k) => startRound + k * stride);
}
var u8 = (n) => String(n);
function pickNumber(engagementId, k, randomnessHex, called) {
  const taken = new Set(called);
  const remaining = [];
  for (let n = 1;n <= NUMBERS; n++)
    if (!taken.has(n))
      remaining.push(n);
  if (remaining.length === 0)
    throw new Error("All 75 numbers have been called.");
  const h = sha2562(utf8ToBytes(`CB1|${engagementId}|${u8(k)}|${randomnessHex}`));
  let v = 0n;
  for (const b of h)
    v = v << 8n | BigInt(b);
  return remaining[Number(v % BigInt(remaining.length))];
}
function deriveCalls(engagementId, randomness) {
  const out = [];
  for (let k = 0;k < randomness.length; k++)
    out.push(pickNumber(engagementId, k, randomness[k], out));
  return out;
}
function seededRand(seed) {
  let counter = 0;
  let buf = new Uint8Array(0);
  let pos = 0;
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

// src-bingo-4d636fa/packages/beacon/src/game.ts
var ticketFor = (engagementId, pid) => {
  const seat = seatOfPid(pid);
  return seat ? ticketAt(engagementId, positionOf(seat, 0)) : generateTicket(seededRand(`${engagementId}|${pid}`));
};
function ticketsFor(engagementId, pid, n = 1) {
  const a = ticketFor(engagementId, pid);
  if (n === 1)
    return [a];
  const seat = seatOfPid(pid);
  if (seat)
    return [a, ticketAt(engagementId, positionOf(seat, 1))];
  for (let i = 2;i < 40; i++) {
    const b = generateTicket(seededRand(`${engagementId}|${pid}|${i}`));
    if (JSON.stringify(b) !== JSON.stringify(a))
      return [a, b];
  }
  throw new Error("Could not make a second card.");
}
function completionIndex(t, pat, log) {
  return ticketCompletion(t, pat, log);
}
function completionIndexKey(tickets, key, log) {
  let best = -1;
  for (const t of tickets) {
    const i = completionIndex(t, key, log);
    if (i >= 0 && (best < 0 || i < best))
      best = i;
  }
  return best;
}
function fateOf2(engagementId, pid, pattern, ordinal) {
  const seat = seatOfPid(pid) ?? pid;
  return bytesToHex(sha2562(utf8ToBytes(`CB1-TIE|${engagementId}|${seat}|tie|${pattern}|${ordinal}`)));
}
function assignOrdinals2(engagementId, key, groups, ordinals, round) {
  const out = [];
  let o = 0;
  const ord = [...ordinals].sort((a, b) => a - b);
  for (const [idx, pids] of [...groups].sort((a, b) => a[0] - b[0])) {
    const left = [...pids];
    while (left.length && o < ord.length) {
      const k = ord[o];
      left.sort((a, b) => {
        const fa = fateOf2(engagementId, a, key, k), fb = fateOf2(engagementId, b, key, k);
        return fa < fb ? -1 : fa > fb ? 1 : a < b ? -1 : 1;
      });
      out.push({ pattern: key, ordinal: k, idx, pids: [left.shift()], round, ...pids.length > 1 ? { tied: pids.length } : {} });
      o++;
    }
    if (o >= ord.length)
      break;
  }
  return out;
}
var CORE_SETTLE = false;
var setCoreSettle = (on) => {
  CORE_SETTLE = on;
};
function settleViaCore(engagementId, pids, log, cfg, round, late) {
  const eid = roundEid2(engagementId, round), keys = keysInPlay(cfg.rewards), by = new Map(keys.map((k) => [k, new Map]));
  for (const pid of pids) {
    const cards = ticketsFor(roundEid(engagementId, round), pid, cfg.tickets), mine = countedLog(log, late?.countFrom.get(pid) ?? 0, late?.callRounds);
    for (const k of keys) {
      const i = seatCompletion(cards, k, mine);
      if (i < 0)
        continue;
      const g = by.get(k), e = { id: pid, key: seatOfPid(pid) ?? pid }, arr = g.get(i);
      if (arr)
        arr.push(e);
      else
        g.set(i, [e]);
    }
  }
  const out = [];
  for (const k of keys)
    for (const x of assignOrdinals(eid, k, [...by.get(k).entries()], linesFor(cfg.rewards, k).map((l) => l.ordinal), round))
      out.push({ pattern: x.house, ordinal: x.ordinal, idx: x.idx, pids: [x.player], round: x.round, ...x.tied ? { tied: x.tied } : {} });
  return out;
}
function settleAll(engagementId, pids, log, cfg = defaultCfg(), round = 1, late) {
  if (CORE_SETTLE)
    return settleViaCore(engagementId, pids, log, cfg, round, late);
  const eid = roundEid(engagementId, round);
  const keys = keysInPlay(cfg.rewards);
  const best = new Map(keys.map((k) => [k, new Map]));
  for (const pid of pids) {
    const tk = ticketsFor(eid, pid, cfg.tickets);
    const cf = late?.countFrom.get(pid) ?? 0;
    const mine = cf > 0 && late ? log.map((n, k) => (late.callRounds[k] ?? Infinity) >= cf ? n : 0) : log;
    for (const k of keys) {
      const i = completionIndexKey(tk, k, mine);
      if (i < 0)
        continue;
      const g = best.get(k);
      const arr = g.get(i);
      if (arr)
        arr.push(pid);
      else
        g.set(i, [pid]);
    }
  }
  const out = [];
  for (const k of keys) {
    out.push(...assignOrdinals2(eid, k, [...best.get(k).entries()], linesFor(cfg.rewards, k).map((l) => l.ordinal), round));
  }
  return out;
}
var checkClaims = (engagementId, claims, log, cfg = defaultCfg(), late) => {
  const good = [];
  const bad = [];
  const cache = new Map;
  for (const c of claims) {
    const round = c.round ?? 1;
    const l = Array.isArray(log) ? round === 1 ? log : undefined : log[round];
    if (!l || round < 1 || round > cfg.rounds) {
      bad.push(c);
      continue;
    }
    const key = `${round}|${c.pid}`;
    let tk = cache.get(key);
    if (!tk) {
      tk = ticketsFor(roundEid(engagementId, round), c.pid, cfg.tickets);
      cache.set(key, tk);
    }
    const cf = late?.countFrom.get(c.pid) ?? 0, cr = late?.callRounds[round];
    const mine = cf > 0 && cr ? l.map((n, k) => (cr[k] ?? Infinity) >= cf ? n : 0) : l;
    (completionIndexKey(tk, c.pattern, mine) === c.idx ? good : bad).push(c);
  }
  return { good, bad };
};
var stillToWin = (t, pat, log) => {
  const tickets = Array.isArray(t[0]?.[0]) ? t : [t];
  const called = new Set(log);
  let min = Infinity;
  for (const tk of tickets) {
    const left = ticketStillNeeds(tk, pat, called);
    if (left < min)
      min = left;
  }
  return min;
};
function luckyWinners(engagementId, breakAfter, randomnessHex, pids, n) {
  const rank = (pid) => bytesToHex(sha2562(utf8ToBytes(`CB1-LUCKY|${engagementId}|${breakAfter}|${randomnessHex}|${pid}`)));
  return [...new Set(pids)].map((pid) => [rank(pid), pid]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).slice(0, Math.max(0, n)).map((x) => x[1]);
}
function luckyRound(st, start, stride, breaks, b) {
  const prev = callRoundFull(st, start, stride, breaks, b.after - 1);
  return prev === null ? null : prev + 1 + b.seconds / 3;
}
function unshiftedRound(start, stride, breaks, round, k) {
  if (round <= 1)
    return start + k * stride + breakShift(breaks, k);
  return unshiftedRound(start, stride, breaks, round - 1, NUMBERS - 1) + stride + INTERMISSION_ROUNDS + k * stride;
}
function callRoundR(st, start, stride, breaks, round, k) {
  let a = unshiftedRound(start, stride, breaks, round, k);
  if (st) {
    for (const i of st.intervals)
      if (a >= i.start)
        a += i.end - i.start;
    if (st.stopRound !== null && a >= st.stopRound)
      return null;
  }
  return a;
}
function callRoundFull(st, start, stride, breaks, k) {
  return callRoundR(st, start, stride, breaks, 1, k);
}
var scheduleFull = (st, start, stride, breaks, count = NUMBERS) => Array.from({ length: count }, (_, k) => callRoundFull(st, start, stride, breaks, k));
function activeIntermission(st, start, stride, breaks, round, nowRound) {
  if (round < 2)
    return null;
  const prevLast = callRoundR(st, start, stride, breaks, round - 1, NUMBERS - 1), first = callRoundR(st, start, stride, breaks, round, 0);
  if (prevLast === null || first === null)
    return null;
  return nowRound > prevLast && nowRound < first ? { endsAtRound: first } : null;
}
function activeBreak(st, start, stride, breaks, nowRound) {
  for (const b of breaks) {
    const prev = callRoundFull(st, start, stride, breaks, b.after - 1);
    if (prev === null)
      continue;
    const from = prev + 1, to = from + b.seconds / 3;
    if (nowRound >= from && nowRound < to)
      return { brk: b, endsAtRound: to };
  }
  return null;
}
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
function rankWinners(engagementId, cfg, settled, n = 10) {
  const valueOf = (s) => {
    const i = cfg.rewards.findIndex((l) => l.pattern === s.pattern && l.ordinal === s.ordinal);
    return i < 0 ? 1e9 : i;
  };
  const rows = [...settled].filter((s) => s.pids.length > 0).sort((a, b) => valueOf(a) - valueOf(b) || a.idx - b.idx || (fateOf2(engagementId, a.pids[0], a.pattern, a.ordinal) < fateOf2(engagementId, b.pids[0], b.pattern, b.ordinal) ? -1 : 1));
  return rows.slice(0, Math.max(0, n)).map((s, i) => ({ rank: i + 1, pid: s.pids[0], pattern: s.pattern, ordinal: s.ordinal, idx: s.idx, text: cfg.rewards.find((l) => l.pattern === s.pattern && l.ordinal === s.ordinal)?.text ?? "", note: s.tied && s.tied > 1 ? `${s.tied} cards completed it on the same number; a fixed public rule put them in order` : "" }));
}
var rankName = (r) => ["", "1st", "2nd", "3rd"][r] ?? `${r}th`;
// src-bingo-4d636fa/packages/beacon/src/prize-engine.ts
var countFromOf = (jr) => jr && jr > 0 ? jr + LATE_LAG_ROUNDS : 0;

class PrizeEngine {
  cfg;
  round;
  keys;
  eid;
  setKey = [];
  setSize = [];
  cellSets = Array.from({ length: 25 }, () => []);
  need;
  unitPid = [];
  unitCf = [];
  unitCell = [];
  unitLeft0 = [];
  unitLeft = [];
  unitDone0 = [];
  unitDone = [];
  inv = Array.from({ length: NUMBERS + 1 }, () => []);
  callNum = [];
  callBr = [];
  donePid;
  byKey;
  known = new Set;
  queue = [];
  constructor(engagementId, cfg, round = 1) {
    this.cfg = cfg;
    this.round = round;
    this.eid = roundEid(engagementId, round);
    this.keys = keysInPlay(cfg.rewards);
    this.need = this.keys.map((k) => PATTERN_RULES[k].need);
    this.keys.forEach((k, h) => {
      for (const cells of PATTERN_RULES[k].sets) {
        const s = this.setKey.length;
        this.setKey.push(h);
        this.setSize.push(cells.filter((c) => c !== FREE_CELL2).length);
        for (const c of cells)
          if (c !== FREE_CELL2)
            this.cellSets[c].push(s);
      }
    });
    this.donePid = this.keys.map(() => new Set);
    this.byKey = this.keys.map(() => new Map);
  }
  get seatCount() {
    return this.known.size;
  }
  get pending() {
    return this.queue.length;
  }
  get calls() {
    return this.callNum.length;
  }
  addSeats(seats) {
    for (const s of seats)
      if (!this.known.has(s.pid)) {
        this.known.add(s.pid);
        this.queue.push(s);
      }
  }
  work(budgetMs, now = () => performance.now()) {
    const t0 = now();
    while (this.queue.length) {
      const s = this.queue.shift();
      this.build(s);
      if (now() - t0 >= budgetMs)
        break;
    }
    return this.queue.length === 0;
  }
  build(s) {
    const cards = ticketsFor(this.eid, s.pid, this.cfg.tickets);
    const first = this.unitPid.length;
    for (const t of cards) {
      const cell = new Int8Array(NUMBERS + 1).fill(-1);
      for (const n of ticketNumbers(t))
        cell[n] = cellOfNumber(t, n);
      const left = Uint8Array.from(this.setSize);
      const u = this.unitPid.length;
      this.unitPid.push(s.pid);
      this.unitCf.push(s.countFrom);
      this.unitCell.push(cell);
      this.unitLeft0.push(left);
      this.unitLeft.push(left.slice());
      const done = new Uint8Array(this.keys.length);
      this.unitDone0.push(done);
      this.unitDone.push(done.slice());
      for (let n = 1;n <= NUMBERS; n++)
        if (cell[n] >= 0)
          this.inv[n].push(u);
    }
    for (let j = 0;j < this.callNum.length; j++)
      for (let u = first;u < this.unitPid.length; u++)
        this.apply(u, j, this.callNum[j], this.callBr[j]);
  }
  apply(u, j, n, br) {
    if (br < this.unitCf[u])
      return;
    const c = this.unitCell[u][n];
    if (c < 0)
      return;
    const left = this.unitLeft[u], done = this.unitDone[u];
    for (const s of this.cellSets[c]) {
      if (--left[s] !== 0)
        continue;
      const h = this.setKey[s];
      if (++done[h] !== this.need[h])
        continue;
      const pid = this.unitPid[u];
      if (this.donePid[h].has(pid))
        continue;
      this.donePid[h].add(pid);
      const g = this.byKey[h].get(j);
      if (g)
        g.push(pid);
      else
        this.byKey[h].set(j, [pid]);
    }
  }
  feed(number, beaconRound) {
    const j = this.callNum.length;
    this.callNum.push(number);
    this.callBr.push(beaconRound);
    if (number < 1 || number > NUMBERS)
      return;
    for (const u of this.inv[number])
      this.apply(u, j, number, beaconRound);
  }
  resetCalls() {
    this.callNum = [];
    this.callBr = [];
    this.unitLeft = this.unitLeft0.map((l) => l.slice());
    this.unitDone = this.unitDone0.map((l) => l.slice());
    this.donePid = this.keys.map(() => new Set);
    this.byKey = this.keys.map(() => new Map);
  }
  results() {
    const out = [];
    this.keys.forEach((k, h) => {
      out.push(...assignOrdinals2(this.eid, k, [...this.byKey[h].entries()], linesFor(this.cfg.rewards, k).map((l) => l.ordinal), this.round));
    });
    return out;
  }
}
// src-bingo-4d636fa/apps/edge/src/approvals.ts
var WAIT_LIMIT_MS = 30 * 60000;
var FAMILY_CUTOFF_MS = 15 * 60000;
var GENESIS = 1692803367;
var roundStartMs = (round) => (GENESIS + (round - 1) * 3) * 1000;
var waitingLapsed = (atMs, now) => now - atMs >= WAIT_LIMIT_MS;
var waitingValidUntil = (atMs) => atMs + WAIT_LIMIT_MS;
var familyCutoffPassed = (startMs, now) => now >= startMs - FAMILY_CUTOFF_MS;
var mayDecide = (who, chain) => who.all || String(chain).includes(`,${who.id},`);
var APPROVAL_RULES_FROM_MS = Date.UTC(2099, 0, 1);
var approvalRulesOn = (e) => Number(e?.created_ms) >= APPROVAL_RULES_FROM_MS;
var waitSince = (e, now) => approvalRulesOn(e) ? now - WAIT_LIMIT_MS : 0;
// src-bingo-4d636fa/apps/edge/src/phonekit.ts
function cleanPhone(raw) {
  const typed = String(raw ?? "").trim();
  if (/[^\d\s+\-()./]/.test(typed))
    return { ok: false, why: "A number has only digits (and + - spaces or brackets). Please check it." };
  let d = typed.replace(/\D/g, "");
  if (!d)
    return { ok: false, why: "There is no number." };
  const international = (typed.startsWith("+") || typed.startsWith("00")) && !d.replace(/^00/, "").startsWith("91");
  if (international) {
    const n = d.replace(/^00/, "");
    if (!knownDial(n))
      return { ok: false, why: "We do not know that country code. Please pick your country from the list." };
    return n.length >= 8 && n.length <= 15 ? { ok: true, digits: n, last10: n.slice(-10) } : { ok: false, why: n.length < 8 ? "That is too short for a mobile number." : "That is too long for a mobile number." };
  }
  if (d.startsWith("00"))
    d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0"))
    d = d.slice(1);
  const indian = (ten) => /^[6-9]\d{9}$/.test(ten) ? { ok: true, digits: "91" + ten, last10: ten } : { ok: false, why: "An Indian mobile number starts with 6, 7, 8 or 9." };
  if (d.length === 10)
    return indian(d);
  if (d.length === 12 && d.startsWith("91"))
    return indian(d.slice(2));
  if (d.startsWith("91"))
    return { ok: false, why: "After +91 there must be 10 digits." };
  if (d.length >= 11 && d.length <= 15)
    return { ok: true, digits: d, last10: d.slice(-10) };
  return { ok: false, why: d.length < 10 ? "That is too short for a mobile number." : "That is too long for a mobile number." };
}
var maskedPhone = (digits) => "******" + digits.slice(-4);
function keptPhone(raw) {
  const s = String(raw ?? "").trim(), d = s.replace(/\D/g, "");
  if (!d)
    return "";
  if (/^\s*(\+|00)/.test(s)) {
    const n = d.replace(/^00/, "");
    return n.startsWith("91") ? n : "+" + n;
  }
  if (d.length === 10)
    return "91" + d;
  if (d.length === 11 && d[0] === "0")
    return "91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91"))
    return d;
  return d.startsWith("91") ? d : "+" + d;
}
var phoneDigits = (kept) => String(kept ?? "").replace(/\D/g, "");
var keptFromClean = (digits) => digits.length === 12 && digits.startsWith("91") ? digits : "+" + digits;
var KNOWN_DIAL = new Set("1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 509 590 591 592 593 594 595 596 597 598 599 670 673 674 675 676 677 678 679 680 682 685 686 687 688 689 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998".split(" "));
var knownDial = (digitsWithCode) => [1, 2, 3].some((k) => KNOWN_DIAL.has(digitsWithCode.slice(0, k)));
// src-bingo-4d636fa/apps/edge/src/pii.ts
var enc = new TextEncoder;
var dec = new TextDecoder;
var AAD = enc.encode("corporate-bingo/pii/v1");
var keys = new Map;

// src-bingo-4d636fa/apps/edge/src/emailkey.ts
var INVISIBLE_RE = /[\s\u0085\u200B-\u200D\u2028\u2029\u2060\uFEFF]/g;
var accountEmail = (raw) => String(raw ?? "").normalize("NFKC").replace(INVISIBLE_RE, " ").trim().toLowerCase();
var emailKey = (raw) => accountEmail(raw).replace(/\s+/g, "");

// src-bingo-4d636fa/apps/edge/src/brand.ts
var BRAND = {
  name: "Corporate Bingo",
  tagline: "Online games for company events",
  tag: "Bingo",
  support: "hello@corporatetambola.com",
  legalPath: "/legal.html",
  defaultOrigin: "https://bingo.corporatetambola.com",
  wine: "#0B3D91",
  gold: "#FFC93C",
  gold2: "#FFE08A",
  ivory: "#FFFAF2",
  line: "#EFDDBE"
};
var mailTag = `[${BRAND.tag}] `;
// src-bingo-4d636fa/vendor/game-core/packages/wording/src/lines.ts
var TERMS_RETENTION = "All participant data is deleted within 24 hours after the game ends, except the winners' record.";
var ID_ONLY_LINE = "A game is played with only an employee ID.";
var DETAILS_LINE = "No other participant details are asked for.";
var AUTO_DELETE_LINE = "All participant data is auto-deleted within 24 hours after the game ends.";

// src-bingo-4d636fa/vendor/game-core/packages/wording/src/legal.ts
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

// src-bingo-4d636fa/vendor/game-core/packages/wording/src/documents.ts
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

// src-bingo-4d636fa/vendor/game-core/packages/wording/src/consent.ts
var NOTICE_LINKS = ["terms", "privacy", "game-rules"].map((id) => ({ id, label: DOC_TITLES[id], href: DOC_URLS[id] }));
var NOTICE_TEXT = `By continuing, you agree to the ${DOC_TITLES.terms}, ${DOC_TITLES.privacy}, and ${DOC_TITLES["game-rules"]}.`;

// src-bingo-4d636fa/apps/edge/src/consent.ts
var encoder = new TextEncoder;

// src-bingo-4d636fa/apps/edge/src/checkin.ts
var CHECKIN_FROM_MS = Date.UTC(2026, 9, 23, 10, 0, 0);
var CHECKIN_OPENS_BEFORE_MS = 5 * 60000;
var CHECKIN_LOCK_MS = 10 * 60000;
var checkinRequired = (_e) => false;
// src-bingo-4d636fa/apps/edge/src/people.ts
var COHOST_FROM = 1e9;
var HOST_FROM = 1500000000;
var ORG_FROM = 1900000000;
var COHOST_LIMIT_DEFAULT = 100;
var COHOST_LIMIT_MIN = 10;
var COHOST_LIMIT_MAX = 1000;
var MAX_ADD_BATCH = 200;
var WAITING_MAX = 500;
var isOrg = (id) => id === "o";
var encoder2 = new TextEncoder;
var EMP_CLEAN_FROM_MS = Date.UTC(2099, 0, 1);
var empClean = (raw) => String(raw ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
var normEmp = (raw, createdMs) => {
  if (createdMs != null && createdMs < EMP_CLEAN_FROM_MS) {
    const s2 = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
    if (!s2)
      return "";
    return /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(s2) ? s2 : null;
  }
  if (!String(raw ?? "").replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, ""))
    return "";
  const s = empClean(raw);
  return s && s.length <= 30 ? s : null;
};
var EMAIL_ID_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
var looksLikeEmail = (raw) => String(raw ?? "").normalize("NFKC").includes("@");
var normId2 = (raw, kind, createdMs) => {
  if (kind === "email") {
    const t = String(raw ?? "");
    if (!emailKey(t))
      return "";
    const k = emailKey(t);
    return EMAIL_ID_RE.test(k) && k.length <= 254 && !k.includes("..") && !k.split("@")[1].startsWith(".") && !k.endsWith(".") ? k : null;
  }
  if ((createdMs == null || createdMs >= EMP_CLEAN_FROM_MS) && looksLikeEmail(raw))
    return null;
  return normEmp(raw, createdMs);
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
// src-bingo-4d636fa/apps/edge/src/tz.ts
var DEFAULT_TZ2 = "Asia/Kolkata";
var safe = (tz, f) => {
  try {
    return f(tz);
  } catch {
    return f(DEFAULT_TZ2);
  }
};
var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function zoneParts(ms, tz = DEFAULT_TZ2) {
  return safe(tz, (z) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: z, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }).formatToParts(new Date(ms));
    const g = (k) => parts.find((x) => x.type === k).value;
    return { y: Number(g("year")), mo: Number(g("month")), d: Number(g("day")), h: Number(g("hour")), mi: Number(g("minute")), s: Number(g("second")), wd: DOW.indexOf(g("weekday")) };
  });
}
function zoneOffsetMs(ms, tz = DEFAULT_TZ2) {
  const p = zoneParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
function zoneLocalToUtc(y, mo, d, h, mi, tz = DEFAULT_TZ2) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return guess - zoneOffsetMs(guess - zoneOffsetMs(guess, tz), tz);
}
// src-bingo-4d636fa/apps/edge/src/audit.ts
var GENESIS2 = "0".repeat(64);
var enc2 = new TextEncoder;

// src-bingo-4d636fa/apps/edge/src/mode.ts
var cache = new WeakMap;

// src-bingo-4d636fa/apps/edge/src/analytics-core.ts
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

// src-bingo-4d636fa/apps/edge/src/visits.ts
var STEPS = ["visit", "pricing", "size", "create", "account", "published", "paid"];
var STAGE = Object.fromEntries(STEPS.map((s, i) => [s, i]));
var PUBLIC_PATHS = new Set(["/", "/legal", "/terms", "/dpa", "/subprocessors", "/partner-terms", "/organizer-guide", "/partner", "/signin", "/pay"]);
var ACTIONS = new Set(["pack", "create", "cur", "signin_open", "signin_submit", "start_open", "start_submit", "partner_click", "nav", "legal_click"]);
var enc4 = new TextEncoder;
var hmacKeys2 = new Map;
var rate2 = new Map;

// src-bingo-4d636fa/apps/edge/src/funnel.ts
var CLIENT_EVENTS = ["viewed", "size_chosen", "signup_started", "payment_page_opened"];
var SERVER_EVENTS = FUNNEL_EVENTS.filter((e) => !CLIENT_EVENTS.includes(e));
var enc5 = new TextEncoder;

// src-bingo-4d636fa/packages/billing/src/index.ts
var BRANDS = {
  corporate_bingo: { id: "corporate_bingo", name: "Corporate Bingo", domain: "corporate-bingo.example", invoicePrefix: "CB", theme: "#0B5D5B", line: "Live engagement software" },
  dpdp: { id: "dpdp", name: "dpdp.VERIDIAN-AIOS.COM", domain: "dpdp.veridian-aios.com", invoicePrefix: "DPDP", theme: "#0E7C6E", line: "Data protection compliance software" },
  projexa: { id: "projexa", name: "projexa-ai.com", domain: "projexa-ai.com", invoicePrefix: "PXA", theme: "#1C2B3A", line: "Project management software" },
  dewberry: { id: "dewberry", name: "dewberry.in", domain: "dewberry.in", invoicePrefix: "DEW", theme: "#5B3A8C", line: "Software solutions" }
};

// src-bingo-4d636fa/apps/edge/src/ledgerc.ts
var SITE_CODE = "BNG";
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

// src-bingo-4d636fa/apps/edge/src/hostsetup.ts
var HOST_LINK_TTL_MS = 7 * 86400000;
var encoder3 = new TextEncoder;

// src-bingo-4d636fa/apps/edge/src/ai-link.ts
var SETTINGS_BODY = `{startRound?, callSeconds?: 12 (new games use 12; an older game keeps its own 6|9|15), cap?, closed?: true|false (invite-only), tickets?: 1|2 (cards per person), mark?: auto|tap, join?: name|phone (name = guests type only their name, the default), tz?: an IANA time zone such as America/New_York (how times are worded), rounds?: 1-5, rewards?: [{pattern: ${PRIZE_HOUSES.map((h) => h.id).join("|")}, ordinal?: 1 up to the house maximum (see Houses), text}], breaks?: [{after?: 1-74 (leave it out and the software spreads the breaks evenly), seconds?: 15-600 in steps of 3 (default 60), kind: file|youtube|slides|speech|lucky, title, mediaUrl?: https link (not for lucky), winners?: 1|3|5|10 (lucky only), style?: draw|scratch (lucky only)}], opening?: [{kind: file|youtube|slides|speech, title, mediaUrl?: https link, seconds?: 15-120 in steps of 3 (default 60)}], closing?: [{kind: file|youtube|slides|speech, title, mediaUrl?: https link}], invites?: {on: true|false, per?: 1-4 people each person may invite, cats?: [ids of guest kinds, see section 1]}}`;

// src-bingo-4d636fa/apps/edge/src/mails.ts
var LINK_MAIL_TTL_MS = 24 * 3600000;

// src-bingo-4d636fa/apps/edge/src/helpdesk.ts
var TMP_KEY_MS = 30 * 60000;
var RESEND_MS = 10 * 60000;
var HELPER_MANUAL_NOTE = [
  "YOU ARE A HELP DESK HELPER.",
  "You prepare games for the Organizer who allowed you. You create the game and set it up with your normal functions. You never publish and never pay: only the Organizer publishes, with one tap, and pays.",
  'When the game is ready, ask the Organizer to publish: call POST /api/helpdesk/request-publish with {"eid": "<the game id>"} (or tell the helper to tap Ask the Organizer to publish). The Organizer gets an e-mail with a short summary and a button. Do not give out any link yourself.',
  "After the Organizer publishes, the helper becomes a Host of that game and gets a Host link by e-mail."
].join(`
`);

// src-bingo-4d636fa/apps/edge/src/testlogins.ts
var TEST_LOGINS = new Set(["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in"]);

// src-bingo-4d636fa/apps/edge/src/paylink.ts
var PAYLINK_TTL_MS = 7 * 86400000;

// src-bingo-4d636fa/apps/edge/src/payfirst.ts
var INVOICE_AFTER_MS = 15 * 60000;

// src-bingo-4d636fa/apps/edge/src/pay.ts
var brand = BRANDS.corporate_bingo;
var OUTBOX_KEEP_MS = 3 * 86400000;

// src-bingo-4d636fa/apps/edge/src/credit.ts
var PAYER_KINDS = new Set(["master", "host", "cohost"]);

// src-bingo-4d636fa/apps/edge/src/gamelog.ts
var ready2 = new WeakSet;
var NAMES = Object.fromEntries(PRIZE_HOUSES.map((h) => [h.id, h.label]));

// src-bingo-4d636fa/apps/edge/src/lifecycle.ts
var GENESIS3 = 1692803367;
var roundMs = (r) => (GENESIS3 + (r - 1) * 3) * 1000;
var PURGE_AFTER_MS = 20 * 3600000;
var REPORT_LINK_MS = 19 * 3600000;
var REPORT_AFTER_MS = 3 * 60000;
var UNPLAYED_WARN_MS = 6 * 3600000;
var SETTINGS_KEEP_MS = 30 * 86400000;
var MAX_AHEAD_MS2 = 30 * 86400000;
var IST = 5.5 * 3600000;
var DAY = 86400000;
var NAMES2 = Object.fromEntries(PRIZE_HOUSES.map((h) => [h.id, h.label]));
var fullDeleteAt = (endMs) => {
  const t = endMs + 365 * DAY;
  const istDay = Math.floor((t + IST) / DAY);
  return (istDay + 1) * DAY - IST;
};
var personalDeleteAt = (endMs) => endMs + PURGE_AFTER_MS;
var reportLinkUntil = (endMs) => endMs + REPORT_LINK_MS;
// games/bingo/oracle.ts
import { createHash } from "crypto";
var sha = (s) => createHash("sha256").update(s).digest("hex");
var HOUSES_O = ["line", "twolines", "corners", "plus", "x", "frame", "stamp", "letterL", "letterT", "blackout"];
var row2 = (r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c);
var col2 = (c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c);
var LINES_O = [0, 1, 2, 3, 4].map(row2).concat([0, 1, 2, 3, 4].map(col2), [[0, 6, 12, 18, 24], [4, 8, 12, 16, 20]]);
var OH = {
  line: { sets: LINES_O, need: 1, max: 3 },
  twolines: { sets: LINES_O, need: 2, max: 2 },
  corners: { sets: [[0, 4, 20, 24]], need: 1, max: 3 },
  plus: { sets: [[2, 7, 10, 11, 12, 13, 14, 17, 22]], need: 1, max: 2 },
  x: { sets: [[0, 4, 6, 8, 12, 16, 18, 20, 24]], need: 1, max: 2 },
  frame: { sets: [[0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]], need: 1, max: 2 },
  stamp: { sets: [[0, 1, 5, 6], [3, 4, 8, 9], [15, 16, 20, 21], [18, 19, 23, 24]], need: 1, max: 3 },
  letterL: { sets: [[0, 5, 10, 15, 20, 21, 22, 23, 24]], need: 1, max: 2 },
  letterT: { sets: [[0, 1, 2, 3, 4, 7, 12, 17, 22]], need: 1, max: 2 },
  blackout: { sets: [Array.from({ length: 25 }, (_, i) => i)], need: 1, max: 2 }
};
function markIndex(card, log, counts) {
  const at = new Map;
  for (let j = 0;j < log.length; j++) {
    const n = log[j];
    if (n > 0 && !at.has(n) && (!counts || counts(j)))
      at.set(n, j);
  }
  const m = new Array(25);
  for (let r = 0;r < 5; r++)
    for (let c = 0;c < 5; c++) {
      const v = card[r][c];
      m[r * 5 + c] = v == null ? -1 : at.get(v) ?? Infinity;
    }
  return m;
}
function houseDone(m, house) {
  const h = OH[house];
  const done = [];
  for (const set of h.sets) {
    let last = -1;
    for (const i of set)
      if (m[i] > last)
        last = m[i];
    if (last < Infinity)
      done.push(last);
  }
  if (done.length < h.need)
    return Infinity;
  done.sort((a, b) => a - b);
  return done[h.need - 1];
}
function stillNeedsO(m, house, upto) {
  const h = OH[house];
  const missing = h.sets.map((s) => s.filter((i) => m[i] >= upto));
  if (h.need === 1)
    return Math.min(...missing.map((x) => x.length));
  let best = 99;
  for (let a = 0;a < missing.length; a++)
    for (let b = a + 1;b < missing.length; b++)
      best = Math.min(best, new Set([...missing[a], ...missing[b]]).size);
  return best;
}
var countsFor = (countFrom, callRounds) => countFrom > 0 && callRounds ? (j) => (callRounds[j] ?? Infinity) >= countFrom : null;
function seatIdx(cards, house, log, countFrom, callRounds) {
  const counts = countsFor(countFrom, callRounds);
  let best = Infinity;
  for (const c of cards) {
    const d = houseDone(markIndex(c, log, counts), house);
    if (d < best)
      best = d;
  }
  return best;
}
function seatKey(pid) {
  const i = pid.indexOf("x");
  if (i > 0 && /^\d{1,7}$/.test(pid.slice(0, i)) && /^[0-9a-f]{8,}$/.test(pid.slice(i + 1)) && Number(pid.slice(0, i)) >= 1)
    return String(Number(pid.slice(0, i)));
  return pid;
}
var roundEidO = (eid, round) => round <= 1 ? eid : `${eid}~r${round}`;
var fate = (eid, pid, house, ordinal) => sha(`CB1-TIE|${eid}|${seatKey(pid)}|tie|${house}|${ordinal}`);
function oracleAssign(eid, house, groups, ordinals, round) {
  const out = [];
  const ord = [...ordinals].sort((a, b) => a - b);
  let o = 0;
  const gs = [...groups].sort((a, b) => a[0] - b[0]);
  for (const [idx, pids] of gs) {
    const left = [...pids];
    while (left.length && o < ord.length) {
      const k = ord[o];
      let bi = 0, bf = fate(eid, left[0], house, k);
      for (let i = 1;i < left.length; i++) {
        const f = fate(eid, left[i], house, k);
        if (f < bf || f === bf && left[i] < left[bi]) {
          bf = f;
          bi = i;
        }
      }
      out.push({ pattern: house, ordinal: k, idx, pid: left[bi], tied: pids.length > 1 ? pids.length : 0, round });
      left.splice(bi, 1);
      o++;
    }
    if (o >= ord.length)
      break;
  }
  return out;
}
function oracleSettle(engagementId, seats, log, callRounds, rewards, round) {
  const eid = roundEidO(engagementId, round), wins = [], idxBy = new Map;
  for (const house of HOUSES_O) {
    const ords = rewards.get(house);
    if (!ords || !ords.length)
      continue;
    const groups = new Map, per = new Map;
    for (const s of seats) {
      const i = seatIdx(s.cards, house, log, s.countFrom, callRounds);
      per.set(s.pid, i);
      if (i < Infinity) {
        const g = groups.get(i);
        if (g)
          g.push(s.pid);
        else
          groups.set(i, [s.pid]);
      }
    }
    idxBy.set(house, per);
    wins.push(...oracleAssign(eid, house, [...groups.entries()], ords, round));
  }
  return { wins, idx: idxBy };
}
var winKey = (w) => `${w.pattern}|${w.ordinal}|${w.idx}|${w.pid}|${w.tied}|${w.round}`;
var settledKey = (s) => `${s.pattern}|${s.ordinal}|${s.idx}|${s.pids.join(",")}|${s.tied ?? 0}|${s.round}`;
function plainRound(start, stride, breaks, round, k) {
  const r1 = (kk) => {
    let t = start + kk * stride;
    for (const b of breaks)
      if (b.after <= kk)
        t += b.seconds / 3;
    return t;
  };
  if (round <= 1)
    return r1(k);
  let first = r1(74) + stride + 30;
  for (let r = 3;r <= round; r++)
    first = first + 74 * stride + stride + 30;
  return first + k * stride;
}
function awakeBefore(t, ivs) {
  let n = t;
  for (const i of ivs) {
    const o = Math.min(i.end, t) - i.start;
    if (o > 0)
      n -= o;
  }
  return n;
}
function actualRound(plain, ivs, stop) {
  let lo = plain, hi = plain;
  for (const i of ivs)
    hi += Math.max(0, i.end - i.start);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (awakeBefore(mid + 1, ivs) >= plain + 1)
      hi = mid;
    else
      lo = mid + 1;
  }
  return stop !== null && lo >= stop ? null : lo;
}
function mergeIvs(all) {
  const s = [...all].sort((a, b) => a.start - b.start || a.end - b.end), out = [];
  for (const i of s) {
    const l = out[out.length - 1];
    if (l && i.start <= l.end)
      l.end = Math.max(l.end, i.end);
    else
      out.push({ ...i });
  }
  return out;
}
var MAX_TIMED_O = 24 * 3600 / 3;
function refControl(lead, maxPause, msgs) {
  const sorted = [...msgs].sort((a, b) => a.seq - b.seq);
  const ps = [], ignored = [];
  let stop = null, applied = 0;
  const endOf = (p) => Math.min(p.ended ?? Infinity, p.until ?? p.s + maxPause);
  for (const m of sorted) {
    const cur = ps.length ? ps[ps.length - 1] : null;
    const no = (why) => {
      ignored.push({ seq: m.seq, why });
    };
    if (stop !== null) {
      no("stopped");
      continue;
    }
    if (m.signedAt > m.at) {
      no("backdated");
      continue;
    }
    const ahead = m.at - m.signedAt, inPause = cur !== null && cur.s <= m.at && m.at < endOf(cur);
    if (m.action === "pause") {
      if (ahead < lead) {
        no("pause-lead");
        continue;
      }
      if (cur && m.at < endOf(cur)) {
        no("already-paused");
        continue;
      }
      if (m.until !== undefined && (m.until <= m.at || m.until - m.at > MAX_TIMED_O)) {
        no("bad-pause-end");
        continue;
      }
      ps.push({ s: m.at, until: m.until ?? null, ended: null });
    } else if (m.action === "resume") {
      if (!inPause) {
        no("not-paused");
        continue;
      }
      if (ahead < 1) {
        no("resume-lead");
        continue;
      }
      if (!(m.at > cur.s)) {
        no("resume-early");
        continue;
      }
      cur.ended = m.at;
    } else if (m.action === "extend") {
      if (!inPause) {
        no("not-paused");
        continue;
      }
      if (cur.ended !== null) {
        no("pause-ending");
        continue;
      }
      if (ahead < lead) {
        no("extend-lead");
        continue;
      }
      if (m.until === undefined || m.until - m.at > MAX_TIMED_O) {
        no("extend-end");
        continue;
      }
      if (!(m.until > endOf(cur))) {
        no("extend-not-later");
        continue;
      }
      cur.until = m.until;
    } else {
      if (ahead < lead) {
        no("stop-lead");
        continue;
      }
      stop = m.at;
    }
    applied++;
  }
  return { pauses: ps.map((p) => ({ start: p.s, end: endOf(p) })), stop, applied, ignored };
}
function reasonCode(why) {
  if (why === "engagement already stopped")
    return "stopped";
  if (why === "takes effect before it was signed")
    return "backdated";
  if (/^pause needs at least \d+ rounds of lead$/.test(why))
    return "pause-lead";
  if (why === "already paused")
    return "already-paused";
  if (why === "bad pause end")
    return "bad-pause-end";
  if (why === "not paused")
    return "not-paused";
  if (why === "resume must be after it was signed")
    return "resume-lead";
  if (why === "resume before the pause began")
    return "resume-early";
  if (why === "pause already ending")
    return "pause-ending";
  if (/^extend needs at least \d+ rounds of lead$/.test(why))
    return "extend-lead";
  if (why === "extend needs a sensible end round")
    return "extend-end";
  if (why === "extend must move the end later")
    return "extend-not-later";
  if (/^stop needs at least \d+ rounds of lead$/.test(why))
    return "stop-lead";
  return "other:" + why;
}
function oracleLucky(eid, breakAfter, rand, pids, n) {
  const uniq = [...new Set(pids)].map((p) => [sha(`CB1-LUCKY|${eid}|${breakAfter}|${rand}|${p}`), p]);
  uniq.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return uniq.slice(0, Math.max(0, n)).map((x) => x[1]);
}
var quorumO = (people2) => people2 <= 6 ? Math.max(1, Math.ceil(people2 / 2)) : Math.min(25, Math.max(3, Math.ceil(people2 / 20)));
var votersO = (people2) => people2 <= 12 ? people2 : 4 * quorumO(people2);
var autoAfterO = (n, k) => {
  const v = Math.round(75 * k / (n + 1));
  return v < 1 ? 1 : v > 74 ? 74 : v;
};

// games/bingo/k_control.ts
var PROFILES = { fast: SAFETY_FAST, standard: SAFETY_STANDARD, lean30: SAFETY_LEAN30, lean60: SAFETY_LEAN60 };
var SIG = "0".repeat(128);
function genBreaks(rng, nb) {
  const afters = new Set, out = [];
  while (afters.size < nb)
    afters.add(rng.int(1, 74));
  for (const a of [...afters].sort((x, y) => x - y)) {
    const kind = rng.pick(["file", "youtube", "slides", "speech", "lucky"]), seconds = rng.pick([15, 30, 45, 60, 90, 120, 180, 300, 600]);
    out.push({ after: a, seconds, kind, title: "Moment " + a, ...kind === "lucky" ? { winners: rng.pick([1, 3, 5, 10]) } : {} });
  }
  return out;
}
var rm = (m) => ({ seq: m.seq, action: m.action, at: m.atBeaconRound, signedAt: m.signedAtRound, ...m.untilRound !== undefined ? { until: m.untilRound } : {} });
function genTimeline(rng, opt = {}) {
  const safety = wpick(rng, [["fast", 1], ["standard", 3], ["lean30", 2], ["lean60", 1]]), lead = PROFILES[safety].leadRounds;
  const maxPause = rng.pick([60, 200, 600, 600, 1200, 3000]), start = opt.start ?? 30000000 + rng.int(0, 9999999);
  const stride = opt.stride ?? wpick(rng, [[2, 10], [3, 25], [4, 20], [5, 15], [6, 10], [8, 10], [10, 10]]);
  const breaks = opt.breaks ?? genBreaks(rng, wpick(rng, [[0, 45], [1, 25], [2, 18], [3, 12]]));
  const rounds = opt.rounds ?? wpick(rng, [[1, 55], [2, 15], [3, 10], [4, 10], [5, 10]]);
  const span = 74 * stride + breaks.reduce((s, b) => s + b.seconds / 3, 0) + (rounds - 1) * (75 * stride + 30);
  const eid = "BT" + rng.hex(4), cfg = { pubKey: "00".repeat(32), maxPauseRounds: maxPause, leadRounds: lead };
  const msgs = [];
  let slip = "none";
  const nm = opt.allowMsgs === false ? 0 : wpick(rng, [[0, 18], [1, 16], [2, 18], [3, 14], [4, 12], [5, 8], [6, 6], [8, 4]]);
  let now = start - 35 + rng.int(0, span);
  for (let i = 0;i < nm; i++) {
    const so2 = refControl(lead, maxPause, msgs.map(rm)), cur = so2.pauses.length ? so2.pauses[so2.pauses.length - 1] : null;
    const live = !!cur && cur.end > now;
    const action = so2.stop !== null ? rng.pick(["pause", "resume", "stop", "extend"]) : !cur ? wpick(rng, [["pause", 62], ["stop", 8], ["resume", 15], ["extend", 15]]) : live ? wpick(rng, [["resume", 30], ["extend", 24], ["pause", 12], ["stop", 10], ["pause", 4]]) : wpick(rng, [["pause", 56], ["stop", 10], ["resume", 12], ["extend", 12]]);
    const extra = wpick(rng, [[0, 10], [1, 8], [rng.int(2, 15), 24], [rng.int(16, 120), 30], [rng.int(121, 600), 10]]);
    let signedAt = now, at = now + lead + extra, until;
    if (action === "pause" || action === "stop") {
      if (rng.chance(0.2)) {
        const p = actualRound(plainRound(start, stride, breaks, 1, rng.int(0, 74)), so2.pauses, so2.stop);
        if (p !== null && p >= now + lead)
          at = p;
      }
    }
    if (action === "pause") {
      if (rng.chance(0.55))
        until = at + wpick(rng, [[rng.int(1, 4), 10], [rng.int(5, 30), 35], [rng.int(31, 300), 40], [rng.int(301, 3000), 15]]);
    } else if (action === "resume") {
      at = now + rng.int(1, 40);
      if (cur && rng.chance(0.12)) {
        at = cur.start;
        signedAt = at - rng.int(1, 3);
      }
    } else if (action === "extend") {
      const e = cur ? cur.end : at;
      until = e + wpick(rng, [[-3, 4], [0, 6], [1, 10], [5, 25], [40, 35], [200, 20]]);
      if (rng.chance(0.05))
        until = undefined;
    }
    let tag = "none";
    const sl = rng.float();
    if (sl < 0.08) {
      tag = "short-lead";
      at = action === "resume" ? signedAt : signedAt + rng.int(0, Math.max(0, lead - 1));
    } else if (sl < 0.12) {
      tag = "backdated";
      at = signedAt - rng.int(1, 5);
    } else if (sl < 0.2) {
      tag = "exact-lead";
      at = action === "resume" ? signedAt + 1 : signedAt + lead;
    } else if (sl < 0.24 && action === "pause") {
      tag = "bad-until";
      until = rng.chance(0.5) ? at - rng.int(0, 3) : at + MAX_TIMED_O + rng.int(1, 5);
    } else if (sl < 0.26 && action === "pause") {
      tag = "max-until";
      until = at + MAX_TIMED_O;
    }
    if (tag !== "none" && slip === "none")
      slip = tag;
    msgs.push({ engagementId: eid, seq: i + 1, action, atBeaconRound: at, signedAtRound: signedAt, ...until !== undefined ? { untilRound: until } : {}, sig: SIG });
    now += wpick(rng, [[rng.int(0, 2), 15], [rng.int(3, 30), 45], [rng.int(31, 200), 40]]);
  }
  const so = refControl(lead, maxPause, msgs.map(rm)), holdsRaw = [];
  const nh = wpick(rng, [[0, 62], [1, 20], [2, 10], [3, 6], [5, 2]]);
  for (let i = 0;i < nh; i++) {
    const p = so.pauses.length ? rng.pick(so.pauses) : null, len = rng.int(1, 21), where = rng.float();
    let s;
    if (p && where < 0.2)
      s = p.start + rng.int(0, Math.max(0, p.end - p.start - 1));
    else if (p && where < 0.3)
      s = p.end;
    else if (p && where < 0.4)
      s = p.start - len;
    else if (p && where < 0.5)
      s = p.start - rng.int(1, 5);
    else
      s = start - 20 + rng.int(0, span);
    holdsRaw.push({ start: s, end: s + len });
  }
  if (rng.chance(0.12)) {
    const junk = [{ start: -1, end: 5 }, { start: 5, end: 5 }, { start: 5, end: 40 }, { start: 1.5, end: 3 }, "x", null, { start: "5", end: 9 }, {}, 7, [1, 2], { start: 10, end: 31 }];
    const n = rng.int(1, 3);
    for (let i = 0;i < n; i++)
      holdsRaw.splice(rng.int(0, holdsRaw.length), 0, rng.pick(junk));
  }
  if (rng.chance(0.01))
    for (let i = 0;i < 45; i++)
      holdsRaw.push({ start: start + i * 40, end: start + i * 40 + 3 });
  const holds = expectedHolds(holdsRaw);
  return { start, stride, breaks, rounds, lead, maxPause, safety, eid, msgs, holdsRaw, holds, slip, cfg };
}
function expectedHolds(raw) {
  const out = [];
  for (const h of raw.slice(0, 40)) {
    const a = h?.start, b = h?.end;
    if (typeof a === "number" && typeof b === "number" && Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b > a && b - a <= 21)
      out.push({ start: a, end: b });
  }
  return out;
}
function oracleSchedule(T) {
  const ref = refControl(T.lead, T.maxPause, T.msgs.map(rm)), ivs = T.holds.length ? mergeIvs([...ref.pauses, ...T.holds]) : ref.pauses;
  const br = T.breaks.map((b) => ({ after: b.after, seconds: b.seconds }));
  return { ref, ivs, act: (r, k) => actualRound(plainRound(T.start, T.stride, br, r, k), ivs, ref.stop) };
}
function resolveAndCheck(c, T, rng) {
  const ref = refControl(T.lead, T.maxPause, T.msgs.map(rm)), st = resolveControl(T.cfg, T.msgs, T.holds);
  const ivs = T.holds.length ? mergeIvs([...ref.pauses, ...T.holds]) : ref.pauses;
  c.ck("L-01", st.applied === ref.applied, [st.applied, ref.applied]);
  c.ck("L-01", js(st.ignored.map((x) => ({ seq: x.seq, why: reasonCode(x.why) }))) === js(ref.ignored), [st.ignored, ref.ignored]);
  c.ck("L-01", st.stopRound === ref.stop, [st.stopRound, ref.stop]);
  c.ck("L-04", js(st.intervals) === js(ivs), [st.intervals, ivs]);
  let sorted = true;
  for (let i = 0;i < st.intervals.length; i++) {
    const v = st.intervals[i];
    if (!(v.end > v.start) || i > 0 && v.start < st.intervals[i - 1].end)
      sorted = false;
  }
  c.ck("L-04", sorted, st.intervals);
  if (rng && T.msgs.length > 1) {
    const st2 = resolveControl(T.cfg, rng.shuffle(T.msgs), T.holds);
    c.ck("L-02", js(st2) === js(st), [st2.applied, st.applied]);
  }
  return { st, ref, ivs };
}
function pauseLabel(T, ref) {
  const ign = new Set(ref.ignored.map((x) => x.seq)), ap = T.msgs.filter((m) => !ign.has(m.seq));
  const np = ap.filter((m) => m.action === "pause").length;
  if (np === 0)
    return "none";
  if (np >= 2)
    return "multiple";
  if (ap.some((m) => m.action === "extend"))
    return "extended";
  if (ap.some((m) => m.action === "resume"))
    return "resumed";
  return ap.find((m) => m.action === "pause").untilRound !== undefined ? "timed" : "open";
}
function stopLabel(ref, T) {
  if (ref.stop === null)
    return "none";
  if (ref.pauses.some((p) => ref.stop >= p.start && ref.stop < p.end))
    return "during-pause";
  const first = T.start, last = plainRound(T.start, T.stride, T.breaks, T.rounds, 74);
  return ref.stop <= first ? "before-start" : ref.stop > last ? "after-end" : "mid-game";
}
function holdLabel(T, ref) {
  if (T.holdsRaw.length > T.holds.length)
    return "junk";
  if (!T.holds.length)
    return "none";
  if (T.holds.length >= 3)
    return "many";
  let rel = "apart";
  for (const h of T.holds)
    for (const p of ref.pauses) {
      if (h.start >= p.start && h.end <= p.end)
        rel = "inside-pause";
      else if (h.start <= p.start && h.end >= p.end)
        rel = "encloses-pause";
      else if (h.end === p.start || h.start === p.end) {
        if (rel === "apart")
          rel = "adjacent";
      } else if (h.start < p.end && h.end > p.start) {
        if (rel === "apart" || rel === "adjacent")
          rel = "overlap";
      }
    }
  return rel;
}
function checkSchedule(c, rng, T, R) {
  const { st, ivs, ref } = R, stop = ref.stop, br = T.breaks.map((b) => ({ after: b.after, seconds: b.seconds }));
  const act = (r, k) => actualRound(plainRound(T.start, T.stride, br, r, k), ivs, stop);
  const r1 = [];
  for (let k = 0;k < 75; k++) {
    const e = callRoundR(st, T.start, T.stride, T.breaks, 1, k), x = act(1, k);
    r1.push(e);
    if (e !== x)
      c.ck("K-03", false, ["r1", k, e, x]);
    else
      c.checks++;
  }
  for (let k = 0;k < 75; k += 7)
    c.ck("K-01", callRoundR(null, T.start, T.stride, T.breaks, 1, k) === plainRound(T.start, T.stride, br, 1, k), k);
  for (let r = 2;r <= T.rounds; r++)
    for (const k of [0, 1, rng.int(2, 72), 73, 74]) {
      const e = callRoundR(st, T.start, T.stride, T.breaks, r, k), x = act(r, k);
      c.ck("K-02", e === x, [r, k, e, x]);
      c.ck("K-02", callRoundR(null, T.start, T.stride, T.breaks, r, k) === plainRound(T.start, T.stride, br, r, k), [r, k]);
    }
  let prev = null, seenNull = false, ok = true;
  for (let k = 0;k < 75; k++) {
    const t = r1[k];
    if (t === null) {
      seenNull = true;
      continue;
    }
    if (seenNull)
      ok = false;
    if (stop !== null && t >= stop)
      ok = false;
    if (ivs.some((i) => t >= i.start && t < i.end))
      ok = false;
    if (prev !== null) {
      if (!(t > prev))
        ok = false;
      const awake = awakeBefore(t + 1, ivs) - awakeBefore(prev + 1, ivs), plainGap = plainRound(T.start, T.stride, br, 1, k) - plainRound(T.start, T.stride, br, 1, k - 1);
      if (awake !== plainGap)
        ok = false;
    }
    prev = t;
  }
  c.ck("K-03", ok, r1.slice(0, 12));
  if (stop !== null) {
    let moved = false;
    for (let k = 0;k < 75; k++) {
      const t = r1[k];
      const p = act(1, k);
      if (t !== null && t !== p)
        moved = true;
      if (t === null && p !== null)
        moved = true;
    }
    c.ck("K-04", !moved, stop);
  }
  const sf = scheduleFull(st, T.start, T.stride, T.breaks);
  c.ck("K-07", js(sf) === js(r1), "scheduleFull");
  if (!T.breaks.length)
    c.ck("K-07", js(scheduleWithControl(st, T.start, T.stride, 75)) === js(r1), "scheduleWithControl");
  c.ck("K-07", callRoundFull(st, T.start, T.stride, T.breaks, 40) === r1[40], "callRoundFull");
  for (const b of T.breaks) {
    const prevCall = act(1, b.after - 1), next = act(1, b.after);
    if (prevCall === null)
      continue;
    const from = prevCall + 1, to = from + b.seconds / 3;
    for (const t of [from - 1, from, rng.int(from, to - 1), to - 1, to]) {
      const ab = activeBreak(st, T.start, T.stride, T.breaks, t), inside = t >= from && t < to;
      const want = inside ? b : null;
      const other = T.breaks.some((o2) => o2 !== b && (() => {
        const pc = act(1, o2.after - 1);
        return pc !== null && t >= pc + 1 && t < pc + 1 + o2.seconds / 3;
      })());
      if (!other)
        c.ck("K-05", (ab ? ab.brk : null) === want && (!ab || ab.endsAtRound === to), [t, from, to, ab?.brk?.after]);
    }
    if (next !== null)
      c.ck("K-05", next >= to, [from, to, next]);
    if (b.kind === "lucky") {
      const lr = luckyRound(st, T.start, T.stride, T.breaks, b);
      c.ck("K-06", lr === to, [lr, to]);
      if (next !== null && lr !== null)
        c.ck("K-06", lr < next, [lr, next]);
    }
  }
  for (let r = 2;r <= Math.min(T.rounds, 3); r++) {
    const pl = act(r - 1, 74), fi = act(r, 0);
    if (pl === null || fi === null) {
      c.ck("K-05", activeIntermission(st, T.start, T.stride, T.breaks, r, T.start + 5) === null, "null");
      continue;
    }
    for (const t of [pl, pl + 1, fi - 1, fi]) {
      const ai = activeIntermission(st, T.start, T.stride, T.breaks, r, t), want = t > pl && t < fi;
      c.ck("K-05", want ? ai?.endsAtRound === fi : ai === null, [r, t, pl, fi]);
    }
  }
}
function kindControl(rng, c) {
  const T = genTimeline(rng), R = resolveAndCheck(c, T, rng);
  checkSchedule(c, rng, T, R);
  c.ck("L-05", js(cleanHolds(T.holdsRaw)) === js(T.holds), [T.holdsRaw.length, T.holds.length]);
  if (!Array.isArray(T.holdsRaw))
    c.ck("L-05", cleanHolds(null).length === 0, "null");
  const m0 = T.msgs[0] ?? { engagementId: T.eid, seq: 1, action: "pause", atBeaconRound: T.start, signedAtRound: T.start - 20, sig: SIG };
  const good = (x) => {
    const o = x;
    const wi = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
    return !!o && typeof o === "object" && typeof o.engagementId === "string" && wi(o.seq) && o.seq >= 1 && ["pause", "resume", "extend", "stop"].includes(o.action) && wi(o.atBeaconRound) && wi(o.signedAtRound) && (o.untilRound === undefined || wi(o.untilRound)) && typeof o.sig === "string";
  };
  const bad = [null, 5, "x", [], { ...m0, seq: 0 }, { ...m0, seq: 1.5 }, { ...m0, action: "boom" }, { ...m0, atBeaconRound: -1 }, { ...m0, atBeaconRound: 2.5 }, { ...m0, signedAtRound: -3 }, { ...m0, untilRound: -2 }, { ...m0, sig: 5 }, { ...m0, engagementId: 7 }, { ...m0, untilRound: 1.5 }, { ...m0, atBeaconRound: Number.MAX_SAFE_INTEGER + 2 }];
  for (const x of [...T.msgs.slice(0, 3), m0, ...bad])
    c.ck("L-06", wellFormed(x) === good(x), js(x));
  if (rng.chance(0.3)) {
    const ok = canonicalBytes({ engagementId: T.eid, seq: m0.seq, action: m0.action, atBeaconRound: m0.atBeaconRound, signedAtRound: m0.signedAtRound, ...m0.untilRound !== undefined ? { untilRound: m0.untilRound } : {} });
    c.ck("L-11", new TextDecoder().decode(ok) === `CBCTL1|${T.eid}|${m0.seq}|${m0.action}|${m0.atBeaconRound}|${m0.signedAtRound}|${m0.untilRound ?? "-"}`, "text");
    for (const badId of ["a b", "a|b", "", "x\ty"]) {
      let threw = false;
      try {
        canonicalBytes({ engagementId: badId, seq: 1, action: "pause", atBeaconRound: 5, signedAtRound: 1 });
      } catch {
        threw = true;
      }
      c.ck("L-11", threw, badId);
    }
    const inp = { pollMaxSec: rng.int(5, 120), cacheTtlSec: rng.int(0, 10), latencySec: rng.int(0, 10), missedPollsTolerated: rng.int(0, 3) };
    const hold = Math.ceil((inp.pollMaxSec + inp.cacheTtlSec + inp.latencySec + inp.missedPollsTolerated * inp.pollMaxSec) / 3), sf = deriveSafety(inp);
    c.ck("L-07", sf.holdAfterRounds === hold && sf.leadRounds === hold + Math.ceil(inp.cacheTtlSec / 3) + 2 && sf.giveUpRounds === Math.max(hold * 6, 60), [sf, hold]);
    c.ck("L-07", SAFETY_STANDARD.leadRounds === 13 && SAFETY_FAST.leadRounds === 10 && SAFETY_LEAN30.leadRounds === 29 && SAFETY_LEAN60.leadRounds === 53, "profiles");
    c.ck("L-07", safetyForCap(250) === SAFETY_STANDARD && safetyForCap(251) === SAFETY_LEAN30 && safetyForCap(1000) === SAFETY_LEAN30 && safetyForCap(1001) === SAFETY_LEAN60 && safetyForCap(2000) === SAFETY_LEAN60 && safetyForCap(2001) === null, "cap");
  }
  const d = c.dims, ign = R.ref.ignored.length;
  d.pause = pauseLabel(T, R.ref);
  d.stop = stopLabel(R.ref, T);
  d.slip = T.slip;
  d.hold = holdLabel(T, R.ref);
  d.breaks = T.breaks.length;
  d.rounds = T.rounds;
  d.stride = T.stride;
  d.safety = T.safety;
  d.maxPause = T.maxPause;
  d.refused = ign === 0 ? "none" : ign === 1 ? "1" : ign <= 3 ? "2-3" : "4+";
  d.luckyBreak = T.breaks.some((b) => b.kind === "lucky") ? "yes" : "no";
  c.note(`control: ${T.msgs.length} messages, ${R.ref.applied} applied, ${ign} refused, pause ${d.pause}, stop ${d.stop}, hold ${d.hold}`);
  return { eid: T.eid, start: T.start, stride: T.stride, rounds: T.rounds, lead: T.lead, maxPause: T.maxPause, breaks: T.breaks, msgs: T.msgs.map((m) => [m.action, m.atBeaconRound, m.signedAtRound, m.untilRound ?? 0]), holds: T.holdsRaw };
}

// games/bingo/world.ts
var NW = 40;
var worlds = new Map;
function worldOf(w) {
  let x = worlds.get(w);
  if (x)
    return x;
  const rng = new Rng(w + 7000000, 11), legacy = w % 8 === 7, n = 12 + w * 7 % 29;
  const eid = "BG" + (w + 1296).toString(36) + rng.hex(3), pids = [];
  for (let i = 1;i <= n; i++)
    pids.push(legacy ? rng.hex(6) : `${i}x${rng.hex(8)}`);
  x = { w, eid, pids, legacy };
  worlds.set(w, x);
  return x;
}
var days = new Map;
function dayOf(w, round) {
  const key = w * 8 + round;
  let d = days.get(key);
  if (d)
    return d;
  const x = worldOf(w), rng = new Rng(w * 977 + round, 29), rnd = [], log = [], eid = roundEid(x.eid, round);
  for (let k = 0;k < NUMBERS; k++) {
    const r = rng.hex(32);
    rnd.push(r);
    log.push(pickNumber(eid, k, r, log));
  }
  d = { rnd, log };
  days.set(key, d);
  return d;
}
var pairs = new Map;
function pairOf(w, round, i) {
  const key = w * 8 + round;
  let arr = pairs.get(key);
  if (!arr) {
    arr = [];
    pairs.set(key, arr);
  }
  let p = arr[i];
  if (p)
    return p;
  const x = worldOf(w);
  p = ticketsFor(roundEid(x.eid, round), x.pids[i], 2);
  arr[i] = p;
  return p;
}

// games/bingo/k_settle.ts
function genRewards(rng) {
  const label = wpick(rng, [["default", 35], ["one", 10], ["few", 25], ["many", 18], ["all", 12]]);
  const houses = label === "default" ? ["line", "corners", "x", "blackout"] : label === "one" ? [rng.pick(HOUSES_O)] : label === "few" ? rng.sample(HOUSES_O, rng.int(2, 4)) : label === "many" ? rng.sample(HOUSES_O, rng.int(5, 8)) : [...HOUSES_O];
  const map = new Map, input = [];
  let lines = 0;
  for (const h of houses) {
    const max = OH[h].max, n = Math.min(max, label === "all" && rng.chance(0.5) ? max : wpick(rng, [[1, 50], [2, 30], [3, 20]])), ords = [];
    for (let o = 1;o <= n; o++) {
      ords.push(o);
      input.push({ pattern: h, ordinal: o, text: rng.chance(0.5) ? `Prize ${h} ${o}` : "" });
      lines++;
    }
    map.set(h, ords);
  }
  return { input: rng.shuffle(input), map, label, lines, houses: houses.length };
}
var seatNo = (pid) => {
  const m = /^(\d{1,7})x[0-9a-f]{8,}$/.exec(pid);
  return m && Number(m[1]) >= 1 ? Number(m[1]) : pid;
};
var cellNums = (card, cells) => {
  const f = card.flat();
  const out = [];
  for (const i of cells) {
    const v = f[i];
    if (v != null)
      out.push(v);
  }
  return out;
};
function craftTie(rng, w, round, idxs, houses, log0) {
  const house = rng.pick(houses), h = OH[house];
  const cells = h.need === 2 ? [...new Set([...h.sets[rng.int(0, 11)], ...h.sets[rng.int(0, 11)]])] : h.sets[rng.int(0, h.sets.length - 1)];
  const per = idxs.map((i) => cellNums(pairOf(w, round, i)[0], cells)), cnt = new Map;
  per.forEach((nums, s) => {
    for (const n of nums) {
      const a = cnt.get(n);
      if (a)
        a.push(s);
      else
        cnt.set(n, [s]);
    }
  });
  let best = 0, pick = -1;
  for (const [n, a] of cnt)
    if (a.length > best) {
      best = a.length;
      pick = n;
    }
  if (best < 2)
    return null;
  const members = cnt.get(pick).slice(0, rng.int(2, Math.min(best, 5))), seen = new Set, first = [];
  for (const s of members)
    for (const n of per[s])
      if (n !== pick && !seen.has(n)) {
        seen.add(n);
        first.push(n);
      }
  seen.add(pick);
  return { log: [...first, pick, ...log0.filter((n) => !seen.has(n))], house, members: members.length };
}
function kindSettle(rng, c, heavy) {
  const w = rng.int(0, NW - 1), W = worldOf(w), tickets = rng.chance(0.5) ? 1 : 2;
  const rounds = wpick(rng, [[1, 55], [2, 15], [3, 12], [4, 9], [5, 9]]), round = rng.int(1, rounds), rw = genRewards(rng);
  const v = validateCfg({ tickets, rounds, rewards: rw.input });
  if (!c.ck("G-01", v.ok, v.ok ? 0 : v.error) || !v.ok)
    return { k: "settle", w, tickets, rounds, rw: rw.input };
  const cfg = v.cfg, day = dayOf(w, round), nAll = W.pids.length;
  const nWant = heavy ? wpick(rng, [[rng.int(3, 8), 62], [rng.int(9, 20), 30], [rng.int(21, 40), 8]]) : rng.int(3, 6);
  const idxs = rng.sample(Array.from({ length: nAll }, (_, i) => i), Math.min(nAll, nWant)), pids = idxs.map((i) => W.pids[i]);
  let callRounds = [], nLog = 75, sched = "plain";
  let schedParams;
  if (rng.chance(0.4)) {
    const T = genTimeline(rng, { rounds, allowMsgs: true }), S = oracleSchedule(T);
    for (let k = 0;k < 75; k++) {
      const x = S.act(round, k);
      if (x === null) {
        nLog = k;
        break;
      }
      callRounds.push(x);
    }
    sched = S.ref.stop !== null ? "stopped" : S.ivs.length ? "paused" : T.breaks.length ? "breaks" : "plain";
    schedParams = { eid: T.eid, start: T.start, stride: T.stride, breaks: T.breaks, msgs: T.msgs.map((m) => [m.action, m.atBeaconRound, m.signedAtRound, m.untilRound ?? 0]), holds: T.holdsRaw, lead: T.lead, maxPause: T.maxPause };
  } else {
    const start = 30000000 + rng.int(0, 9999999), stride = wpick(rng, [[2, 10], [3, 30], [4, 20], [5, 15], [6, 10], [8, 8], [10, 7]]), breaks = genBreaks(rng, wpick(rng, [[0, 60], [1, 25], [2, 10], [3, 5]]));
    callRounds = Array.from({ length: 75 }, (_, k) => plainRound(start, stride, breaks, round, k));
    if (breaks.length)
      sched = "breaks";
    schedParams = { start, stride, breaks };
  }
  let upto = nLog, logState = nLog < 75 ? "stopped" : "full";
  if (rng.chance(0.4)) {
    upto = nLog === 0 ? 0 : rng.int(1, nLog);
    if (upto < nLog)
      logState = "partial";
  }
  let log0 = day.log.slice(), craft = "none";
  if (rng.chance(heavy ? 0.45 : 0.25) && idxs.length >= 3) {
    const t = craftTie(rng, w, round, idxs, [...rw.map.keys()], log0);
    if (t) {
      log0 = t.log;
      craft = t.house;
    }
  }
  const log = log0.slice(0, upto), cr = callRounds.slice(0, upto);
  const lateMode = wpick(rng, [["none", 45], ["some", 28], ["many", 14], ["all", 6], ["boundary", 7]]), jrs = [], cfs = [];
  for (let n = 0;n < pids.length; n++) {
    let jr = 0;
    const isLate = lateMode === "all" || lateMode === "boundary" ? rng.chance(0.6) : lateMode === "many" ? rng.chance(0.55) : lateMode === "some" ? rng.chance(0.2) : false;
    if (isLate && cr.length) {
      if (lateMode === "boundary")
        jr = cr[rng.int(0, cr.length - 1)] - 30 + rng.pick([-1, 0, 0, 1]);
      else
        jr = rng.int(cr[0] - 40, cr[cr.length - 1] + 5);
    } else if (rng.chance(0.03))
      jr = 0;
    jrs.push(jr);
    cfs.push(jr > 0 ? jr + 30 : 0);
    c.ck("S-10", countFromOf(jr) === cfs[n], [jr, countFromOf(jr)]);
  }
  c.ck("S-10", countFromOf(0) === 0 && countFromOf(null) === 0 && countFromOf(undefined) === 0 && countFromOf(-5) === 0, "zero");
  const anyLate = cfs.some((x) => x > 0), late = anyLate || rng.chance(0.1) ? { countFrom: new Map(pids.flatMap((p, n) => cfs[n] > 0 ? [[p, cfs[n]]] : [])), callRounds: cr } : undefined;
  const seats = idxs.map((i, n) => ({ pid: pids[n], cards: pairOf(w, round, i).slice(0, tickets), countFrom: cfs[n] }));
  const orc = oracleSettle(W.eid, seats, log, cr, rw.map, round), oKeys = orc.wins.map(winKey);
  const live = settleAll(W.eid, pids, log, cfg, round, late), lKeys = live.map(settledKey);
  c.ck("S-01", js(lKeys) === js(oKeys), { live: lKeys.slice(0, 4), oracle: oKeys.slice(0, 4), n: [lKeys.length, oKeys.length] });
  if (heavy || rng.chance(0.3)) {
    const hc = {};
    for (const [hh, os] of rw.map)
      hc[hh] = os.length;
    const coreSeats = seats.map((s) => ({ id: s.pid, cards: s.cards, seat: seatNo(s.pid), countFrom: s.countFrom }));
    const core = settleFromLog(W.eid, coreSeats, log, hc, round, cr).map((x) => `${x.house}|${x.ordinal}|${x.idx}|${x.player}|${x.tied ?? 0}|${x.round}`).sort();
    c.ck("S-03", js(core) === js([...lKeys].sort()), { core: core.slice(0, 3), live: lKeys.slice(0, 3) });
  }
  let engineTag = "live+core";
  if (heavy) {
    if (rng.chance(0.4)) {
      setCoreSettle(true);
      try {
        const via = settleAll(W.eid, pids, log, cfg, round, late).map(settledKey);
        c.ck("S-03", js(via) === js(lKeys), { via: via.slice(0, 3), live: lKeys.slice(0, 3) });
      } finally {
        setCoreSettle(false);
      }
      engineTag = "live+core+switch";
    }
    if (rng.chance(0.55)) {
      const variant = wpick(rng, [["seats-first", 40], ["calls-first", 30], ["reset", 15], ["batches", 15]]), pe = new PrizeEngine(W.eid, cfg, round), now = () => 0;
      const seatIn = pids.map((p, n) => ({ pid: p, countFrom: cfs[n] })), feed = (a, b) => {
        for (let j = a;j < b; j++)
          pe.feed(log[j], cr[j]);
      };
      if (variant === "seats-first") {
        pe.addSeats(seatIn);
        pe.work(1, now);
        feed(0, log.length);
      } else if (variant === "calls-first") {
        feed(0, log.length);
        pe.addSeats(seatIn);
        pe.work(1, now);
      } else if (variant === "reset") {
        pe.addSeats(seatIn);
        pe.work(1, now);
        feed(0, Math.min(log.length, rng.int(0, 30)));
        pe.resetCalls();
        feed(0, log.length);
      } else {
        const h = Math.ceil(seatIn.length / 2), m = rng.int(0, log.length);
        pe.addSeats(seatIn.slice(0, h));
        pe.work(1, now);
        feed(0, m);
        pe.addSeats(seatIn);
        pe.work(1, now);
        feed(m, log.length);
      }
      const pk = pe.results().map(settledKey);
      c.ck("S-04", js(pk) === js(lKeys) && pe.pending === 0 && pe.seatCount === pids.length && pe.calls === log.length, { variant, pe: pk.slice(0, 3), live: lKeys.slice(0, 3) });
      engineTag += "+incremental-" + variant;
    }
  }
  const inList = new Set(pids), byHouse = new Map;
  for (const s of live) {
    const a = byHouse.get(s.pattern);
    if (a)
      a.push(s);
    else
      byHouse.set(s.pattern, [s]);
  }
  let maxTied = 0, split2 = false, allFilled = 0, someFilled = 0;
  for (const [house, ords] of rw.map) {
    const per = orc.idx.get(house), done = [...per.values()].filter((x) => x < Infinity).length, ws = byHouse.get(house) ?? [];
    c.ck("T-02", ws.length === Math.min(ords.length, done), { house, n: ws.length, ords: ords.length, done });
    const seen = new Set;
    let prevIdx = -1, ok = true;
    for (const s of ws) {
      if (s.pids.length !== 1 || seen.has(s.pids[0]) || !inList.has(s.pids[0]))
        ok = false;
      seen.add(s.pids[0]);
      if (s.idx < prevIdx)
        ok = false;
      prevIdx = s.idx;
      if (per.get(s.pids[0]) !== s.idx)
        ok = false;
      const group = [...per.values()].filter((x) => x === s.idx).length;
      if ((s.tied ?? 0) !== (group > 1 ? group : 0)) {
        c.ck("T-05", false, { house, ordinal: s.ordinal, tied: s.tied, group });
      } else
        c.checks++;
      if (group > 1) {
        maxTied = Math.max(maxTied, group);
        const same = ws.filter((x) => x.idx === s.idx).length;
        if (same < group)
          split2 = true;
      }
    }
    c.ck("T-02", ok, { house, ws: ws.map((s) => `${s.ordinal}:${s.idx}:${s.pids[0]}`).slice(0, 4) });
    for (let a = 0;a + 1 < ws.length; a++)
      if (ws[a].idx === ws[a + 1].idx) {
        const x = ws[a], y = ws[a + 1];
        c.ck("T-03", fate(roundEidO(W.eid, round), x.pids[0], house, x.ordinal) <= fate(roundEidO(W.eid, round), y.pids[0], house, x.ordinal), { house, a: x.ordinal });
      }
    if (ws.length === ords.length)
      allFilled++;
    else if (ws.length > 0)
      someFilled++;
  }
  c.ck("S-09", live.every((s) => inList.has(s.pids[0])), "outside winner");
  const nCheck = Math.min(seats.length, heavy ? 6 : 4), keysIn = [...rw.map.keys()];
  for (const si of rng.sample(Array.from({ length: seats.length }, (_, i) => i), nCheck)) {
    const s = seats[si], house = rng.pick(keysIn), counted = s.countFrom > 0 ? log.map((n, k) => (cr[k] ?? Infinity) >= s.countFrom ? n : 0) : log;
    const ei = completionIndexKey(s.cards, house, counted), oi = seatIdx(s.cards, house, log, s.countFrom, cr);
    c.ck("S-02", (ei < 0 ? Infinity : ei) === oi, { house, ei, oi, cf: s.countFrom });
    const counts = countsFor(s.countFrom, cr), ms = s.cards.map((cd) => markIndex(cd, log, counts)), at = rng.int(0, log.length);
    const want = Math.min(...ms.map((m) => stillNeedsO(m, house, at))), got = stillToWin(s.cards, house, counted.slice(0, at));
    c.ck("S-07", got === want, { house, at, got, want });
    if (oi < Infinity) {
      c.ck("S-07", stillToWin(s.cards, house, counted.slice(0, oi + 1)) === 0, { house, oi });
      c.ck("S-07", stillToWin(s.cards, house, counted.slice(0, oi)) > 0, { house, oi });
    }
    const ord = rng.int(1, 3);
    c.ck("T-03", fateOf2(roundEidO(W.eid, round), s.pid, house, ord) === fate(roundEidO(W.eid, round), s.pid, house, ord), s.pid);
  }
  const rankEid = roundEidO(W.eid, round), rows = rankWinners(rankEid, cfg, live, 10);
  const valueOf = (pat, ord) => cfg.rewards.findIndex((l) => l.pattern === pat && l.ordinal === ord);
  const expRows = [...orc.wins].sort((a, b) => valueOf(a.pattern, a.ordinal) - valueOf(b.pattern, b.ordinal)).slice(0, 10);
  let rk = rows.length === expRows.length;
  for (let i = 0;rk && i < rows.length; i++) {
    const r = rows[i], x = expRows[i], text = cfg.rewards.find((l) => l.pattern === x.pattern && l.ordinal === x.ordinal)?.text ?? "";
    rk = r.rank === i + 1 && r.pid === x.pid && r.pattern === x.pattern && r.ordinal === x.ordinal && r.idx === x.idx && r.text === text && r.note === (x.tied > 1 ? `${x.tied} cards completed it on the same number; a fixed public rule put them in order` : "");
  }
  c.ck("S-08", rk, { rows: rows.slice(0, 3).map((r) => `${r.rank}:${r.pattern}${r.ordinal}`), exp: expRows.slice(0, 3).map((x) => `${x.pattern}${x.ordinal}`) });
  c.ck("S-08", new Set(rows.map((r) => r.pattern + "#" + r.ordinal)).size === rows.length, "a line twice");
  if (rng.chance(0.2))
    c.ck("S-08", rankName(1) === "1st" && rankName(2) === "2nd" && rankName(3) === "3rd" && rankName(4) === "4th" && rankName(11) === "11th", "names");
  let claimsLabel = "none";
  if (rng.chance(heavy ? 0.6 : 0.4)) {
    const spare = idxs.length < nAll ? Array.from({ length: nAll }, (_, i) => i).filter((i) => !idxs.includes(i)) : [];
    const real = (i, pid, house, rd, cf) => {
      const x = seatIdx(pairOf(w, rd, i).slice(0, tickets), house, rd === round ? log : [], rd === round ? cf : 0, rd === round ? cr : undefined);
      return x === Infinity ? -1 : x;
    };
    const cl = [], exp = [], kinds = new Set, nCl = rng.int(3, 10);
    for (let q = 0;q < nCl; q++) {
      const kind = wpick(rng, [["true", 40], ["early", 8], ["late", 8], ["house", 10], ["never", 8], ["round", 8], ["minus1", 4], ["stranger", 8], ["unknown-round", 6]]);
      let si = rng.int(0, seats.length - 1), i = idxs[si], pid = pids[si], cf = cfs[si], house = rng.pick(keysIn), rd = round, idx;
      if (kind === "stranger") {
        if (!spare.length)
          continue;
        i = rng.pick(spare);
        pid = W.pids[i];
        cf = 0;
        si = -1;
      }
      const r0 = real(i, pid, house, round, cf);
      idx = r0;
      if (kind === "early")
        idx = r0 - 1;
      else if (kind === "late")
        idx = r0 + 1;
      else if (kind === "house") {
        const h2 = rng.pick(HOUSES_O);
        house = h2;
        idx = real(i, pid, keysIn[0], round, cf);
      } else if (kind === "never")
        idx = rng.int(0, 74);
      else if (kind === "minus1")
        idx = -1;
      let valid = true;
      if (kind === "round") {
        rd = rng.pick([0, rounds + 1, -1]);
        valid = false;
      } else if (kind === "unknown-round" && rounds > 1) {
        rd = round === 1 ? 2 : 1;
        valid = false;
      }
      const claim = rd === 1 && rng.chance(0.5) ? { pid, pattern: house, idx } : { pid, pattern: house, idx, round: rd };
      if (rd === round && round === 1 && claim.round === undefined) {}
      cl.push(claim);
      kinds.add(kind);
      exp.push(valid && idx === real(i, pid, house, round, cf));
    }
    const lateRec = anyLate ? { countFrom: late.countFrom, callRounds: { [round]: cr } } : undefined;
    const res = checkClaims(W.eid, cl, { [round]: log }, cfg, lateRec);
    const good = new Set(res.good);
    let ok = res.good.length + res.bad.length === cl.length;
    for (let q = 0;ok && q < cl.length; q++)
      if (good.has(cl[q]) !== exp[q])
        ok = false;
    c.ck("S-06", ok, { claims: cl.map((x, q) => `${x.pid.slice(0, 4)}:${x.pattern}:${x.idx}:${x.round ?? 1}=${exp[q]}`).slice(0, 5), good: res.good.length });
    if (round === 1 && cl.length) {
      const r2 = checkClaims(W.eid, cl.filter((x) => (x.round ?? 1) === 1), log, cfg, lateRec ? { countFrom: lateRec.countFrom, callRounds: { 1: cr } } : undefined);
      c.ck("S-06", r2.good.length === cl.filter((x, q) => (x.round ?? 1) === 1 && exp[q]).length, "array log");
    }
    claimsLabel = kinds.size > 3 ? "mixed" : kinds.has("true") && kinds.size === 1 ? "all-true" : kinds.has("true") ? "some-wrong" : "all-wrong";
  }
  const d = c.dims, lateLabel = lateMode === "none" ? "none" : !anyLate ? "none" : lateMode;
  d.players = bucketPlayers(pids.length);
  d.tickets = tickets;
  d.gameRound = round === 1 ? "r1" : "r2+";
  d.gameRounds = rounds;
  d.houses = rw.houses <= 1 ? "1" : rw.houses <= 4 ? "2-4" : rw.houses <= 8 ? "5-8" : "9-10";
  d.late = lateLabel;
  d.tie = maxTied === 0 ? "none" : maxTied === 2 ? "2-way" : maxTied === 3 ? "3-way" : "4+-way";
  d.tieSplit = split2 ? "lines-run-out" : "no";
  d.linesFilled = allFilled === rw.map.size ? "all" : someFilled + allFilled === 0 ? "none" : "some";
  d.log = logState;
  d.schedule = sched;
  d.engines = engineTag;
  d.claims = claimsLabel;
  d.ids = W.legacy ? "plain" : "seat";
  d.rewardSet = rw.label;
  d.craft = craft === "none" ? "no" : "yes";
  c.note(`settle: world ${w} round ${round}/${rounds}, ${pids.length} seats, ${live.length} winners, ties ${d.tie}, late ${lateLabel}, ${engineTag}`);
  return { k: heavy ? "settle" : "light", w, round, rounds, tickets, rw: rw.input, idxs, jrs, upto, sched: schedParams, craft, lateMode, claims: claimsLabel, eng: engineTag };
}
function kindTies(rng, c) {
  const eid = "BT" + rng.hex(5), round = rng.int(1, 5), house = rng.pick(HOUSES_O), reid = roundEidO(eid, round);
  const nGroups = wpick(rng, [[1, 45], [2, 30], [3, 15], [4, 10]]), lines = wpick(rng, [[1, 35], [2, 35], [3, 30]]), nOrd = Math.min(lines, OH[house].max);
  const ords = Array.from({ length: nOrd }, (_, i) => i + 1);
  const used = new Set, seatPids = [], groups = [];
  const mk = () => {
    const style = wpick(rng, [["seat", 70], ["plain", 20], ["samehash", 10]]);
    if (style === "plain")
      return rng.hex(6);
    let s = rng.int(1, 400);
    while (used.has(s))
      s = rng.int(1, 400);
    used.add(s);
    return `${s}x${rng.hex(8)}`;
  };
  const idxUsed = new Set;
  for (let g = 0;g < nGroups; g++) {
    let idx = rng.int(5, 74);
    while (idxUsed.has(idx))
      idx = rng.int(5, 74);
    idxUsed.add(idx);
    const size = wpick(rng, [[1, 25], [2, 30], [3, 20], [4, 12], [6, 8], [10, 5]]), ps = [];
    for (let i = 0;i < size; i++) {
      const p = mk();
      ps.push(p);
      seatPids.push(p);
    }
    groups.push([idx, ps]);
  }
  const ora = oracleAssign(reid, house, groups, ords, round), oKeys = ora.map(winKey);
  const live = assignOrdinals2(reid, house, groups, ords, round), lKeys = live.map((s) => settledKey(s));
  c.ck("T-02", js(lKeys) === js(oKeys), { live: lKeys.slice(0, 3), oracle: oKeys.slice(0, 3) });
  const coreG = groups.map(([i, ps]) => [i, ps.map((p) => ({ id: p, key: seatNo(p) }))]);
  const core = assignOrdinals(reid, house, coreG, ords, round).map((x) => `${x.house}|${x.ordinal}|${x.idx}|${x.player}|${x.tied ?? 0}|${x.round}`);
  c.ck("T-04", js(core) === js(oKeys.map((k) => k)), { core: core.slice(0, 3), oracle: oKeys.slice(0, 3) });
  for (let t = 0;t < 3; t++) {
    const g2 = rng.shuffle(groups.map(([i, ps]) => [i, rng.shuffle(ps)])), l2 = assignOrdinals2(reid, house, g2, ords, round).map((s) => settledKey(s));
    c.ck("T-01", js(l2) === js(lKeys), { t });
  }
  const swapped = groups.map(([i, ps]) => [i, ps.map((p) => /^\d+x/.test(p) ? p.split("x")[0] + "x" + rng.hex(8) : p)]);
  if (swapped.some(([, ps], gi) => ps.some((p, pi) => p !== groups[gi][1][pi]))) {
    const ls = assignOrdinals2(reid, house, swapped, ords, round);
    const seatsOf = (a) => a.map((s) => `${s.ordinal}|${s.idx}|${String(seatNo(s.pids[0]))}`).join(",");
    c.ck("T-03", seatsOf(ls) === seatsOf(live), { a: seatsOf(ls).slice(0, 40), b: seatsOf(live).slice(0, 40) });
  }
  const allFates = new Set;
  let clash = false;
  for (const p of seatPids) {
    const f = fate(reid, p, house, 1);
    if (allFates.has(f))
      clash = true;
    allFates.add(f);
  }
  const seatKeys = new Set(seatPids.map(seatKey));
  c.ck("T-03", clash === (seatKeys.size !== seatPids.length), { clash, keys: seatKeys.size, pids: seatPids.length });
  for (const s of live.slice(0, 3))
    c.ck("T-03", fateOf2(reid, s.pids[0], house, s.ordinal) === fate(reid, s.pids[0], house, s.ordinal) && fateOf(reid, seatNo(s.pids[0]), house, s.ordinal) === fate(reid, s.pids[0], house, s.ordinal), s.pids[0]);
  const maxG = Math.max(...groups.map((g) => g[1].length)), total = seatPids.length;
  const d = c.dims;
  d.tie = maxG === 1 ? "none" : maxG === 2 ? "2-way" : maxG === 3 ? "3-way" : "4+-way";
  d.tieSplit = total > nOrd && maxG > 1 && live.length === nOrd ? "lines-run-out" : "no";
  d.tieHouse = house;
  d.tieLines = nOrd;
  d.tieGroups = nGroups;
  d.ids = seatPids.some((p) => !/^\d+x/.test(p)) ? "plain" : "seat";
  c.note(`ties: ${house}, ${nGroups} groups, biggest ${maxG}, ${nOrd} lines`);
  return { k: "ties", eid, round, house, groups, ords };
}

// games/bingo/k_config.ts
var canon = (x) => JSON.stringify(x, (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort((a, b) => a[0] < b[0] ? -1 : 1)) : v);
var TZS = ["Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Singapore", "Australia/Sydney", "UTC", "Asia/Dubai", "Africa/Nairobi", "America/Argentina/Buenos_Aires", "Pacific/Auckland"];
var BAD_TZ = ["Mars/Phobos", `Asia/Kolkata
`, "../etc", "a/b/c/d", 5, "x".repeat(70), "Asia Kolkata"];
var WORDS = ["Welcome", "Quiz", "Our story", "Break", "Thank you", "Sponsor", "Team photo", "Music", "Slides", "Chairman speaks"];
var cleanTitle = (t) => t.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
var plain = (m) => typeof m === "string" && m.length >= 10 && m.length <= 400 && /^[A-Z]/.test(m) && /[.?!")]$/.test(m) && !/undefined|\[object|NaN|\bnull\b|TypeError|RangeError|Error:|\.ts\b|[{}]|\$\{/.test(m);
function genBreak(rng, auto, after) {
  const kind = wpick(rng, [["file", 20], ["youtube", 18], ["slides", 18], ["speech", 18], ["lucky", 26]]);
  const b = { kind, title: rng.pick(WORDS) + (rng.chance(0.3) ? " <b>" + rng.int(1, 9) + "</b>" : "") };
  if (!auto)
    b.after = after;
  else if (rng.chance(0.5))
    b.auto = true;
  if (!auto || rng.chance(0.5))
    b.seconds = 15 + 3 * rng.int(0, 195);
  if (kind === "file")
    b.mediaUrl = rng.chance(0.2) ? "/demo.mp4" : `https://example.com/v${rng.int(1, 99)}.mp4`;
  else if (kind === "youtube")
    b.mediaUrl = rng.chance(0.5) ? "https://www.youtube.com/watch?v=" + rng.hex(4) : "https://youtu.be/" + rng.hex(4);
  else if (kind !== "lucky" && rng.chance(0.3))
    b.mediaUrl = `https://example.com/s${rng.int(1, 99)}`;
  if (kind === "lucky") {
    if (rng.chance(0.7))
      b.winners = rng.pick([1, 3, 5, 10]);
    if (rng.chance(0.4))
      b.style = rng.pick(["draw", "scratch", ""]);
  }
  return b;
}
function genValid(rng) {
  const input = {}, exp = {}, tags = new Set;
  let err = null;
  let tk = rng.chance(0.5) ? 1 : 2;
  if (rng.chance(0.8))
    input.tickets = tk;
  else
    tk = 1;
  exp.tickets = tk;
  const rounds = rng.int(1, 5);
  if (rng.chance(0.7))
    input.rounds = rounds;
  exp.rounds = input.rounds === undefined ? 1 : rounds;
  if (rng.chance(0.75)) {
    const rw = genRewards(rng);
    input.rewards = rw.input;
    exp.rewards = rw.input.map((r) => [r.pattern, r.ordinal, r.text]);
    tags.add("rewards:" + rw.label);
  } else {
    exp.rewards = ["line", "corners", "x", "blackout"].map((p) => [p, 1, ""]);
    tags.add("rewards:default");
  }
  const nb = wpick(rng, [[0, 40], [1, 25], [2, 18], [3, 12], [4, 3], [5, 1], [6, 1]]), nbReal = Math.min(nb, 3 * tk);
  if (nb > 0 && rng.chance(0.85)) {
    const bs = [], used = new Set, autos = [];
    for (let i = 0;i < nbReal; i++) {
      const auto = rng.chance(0.3);
      let a = 0;
      if (!auto) {
        a = rng.int(1, 74);
        while (used.has(a))
          a = rng.int(1, 74);
        used.add(a);
      } else
        autos.push(i);
      bs.push(genBreak(rng, auto, a));
    }
    input.breaks = bs;
    const expB = bs.map((b, i) => ({ after: b.after ?? 0, seconds: b.seconds ?? 60, kind: b.kind, title: cleanTitle(b.title), ...b.mediaUrl ? { mediaUrl: b.mediaUrl } : {}, ...b.kind === "lucky" ? { winners: b.winners ?? 3 } : {}, ...b.kind === "lucky" && b.style === "scratch" ? { style: "scratch" } : {}, ...autos.includes(i) ? { auto: true } : {} }));
    autos.forEach((ix, k) => {
      expB[ix].after = autoAfterO(autos.length, k + 1);
    });
    expB.sort((a, b) => a.after - b.after);
    if (new Set(expB.map((x) => x.after)).size !== expB.length)
      err = "same number";
    exp.breaks = expB;
    tags.add(autos.length ? "breaks:auto" : "breaks:set");
    if (bs.some((b) => b.kind === "lucky"))
      tags.add("breaks:lucky");
  } else
    exp.breaks = [];
  if (rng.chance(0.3)) {
    const name = rng.pick(["Acme", "Bright  Foods", "Zenith Corp", "  Nova "]), color = rng.pick(BRAND_COLORS);
    input.brand = { name, color: rng.chance(0.3) ? color.toLowerCase() : color };
    exp.brand = { name: name.replace(/\s+/g, " ").trim(), color };
    tags.add("brand");
  }
  for (const [field, isOpen] of [["opening", true], ["closing", false]]) {
    if (!rng.chance(0.3))
      continue;
    const n = rng.int(0, tk), arr = [], expA = [];
    for (let i = 0;i < n; i++) {
      const kind = rng.pick(["file", "youtube", "slides", "speech"]), x = { kind, title: rng.pick(WORDS) };
      if (kind === "file")
        x.mediaUrl = "https://example.com/o.mp4";
      else if (kind === "youtube")
        x.mediaUrl = "https://youtu.be/abc12345";
      let seconds;
      if (isOpen && rng.chance(0.7)) {
        seconds = 15 + 3 * rng.int(0, 15);
        x.seconds = seconds;
      }
      arr.push(x);
      expA.push({ kind, title: x.title, ...x.mediaUrl ? { mediaUrl: x.mediaUrl } : {}, ...isOpen ? { seconds: seconds ?? 60 } : {} });
    }
    input[field] = arr;
    exp[field] = expA;
    if (n)
      tags.add(field);
  }
  if (rng.chance(0.4)) {
    const on = rng.chance(0.6), per = rng.chance(0.7) ? rng.int(1, 4) : undefined, cats = rng.chance(0.7) ? rng.sample(INVITE_CATEGORIES.map((k) => k.id), on ? rng.int(1, 4) : rng.int(0, 3)) : undefined;
    if (cats && rng.chance(0.2) && cats.length)
      cats.push(cats[0]);
    input.invites = { on, ...per !== undefined ? { per } : {}, ...cats ? { cats } : {} };
    exp.invites = { on, per: per ?? 4, cats: [...new Set(cats ?? ["family", "colleagues"])] };
    tags.add(on ? "invites:on" : "invites:off");
  } else
    exp.invites = { on: false, per: 4, cats: ["family", "colleagues"] };
  if (rng.chance(0.2)) {
    input.employeesOnly = true;
    exp.invites.on = false;
    exp.employeesOnly = true;
    tags.add("employeesOnly");
  } else if (rng.chance(0.1))
    input.employeesOnly = false;
  if (rng.chance(0.3)) {
    const v = rng.pick(VERIFY_MODES);
    input.verify = v;
    if (v !== "mobile")
      exp.verify = v;
    tags.add("verify:" + v);
  }
  if (rng.chance(0.15)) {
    const k = rng.pick(["email", "emp"]);
    input.idKind = k;
    if (k === "email")
      exp.idKind = "email";
  }
  if (rng.chance(0.2)) {
    const j = rng.pick(["name", "phone"]);
    input.join = j;
    if (j === "phone")
      exp.join = "phone";
  }
  if (rng.chance(0.2)) {
    const m = rng.pick(["auto", "tap"]);
    input.mark = m;
    if (m === "tap")
      exp.mark = "tap";
  }
  if (rng.chance(0.25)) {
    const z = rng.pick(TZS);
    input.tz = z;
    if (z !== "Asia/Kolkata")
      exp.tz = z;
  }
  if (rng.chance(0.2)) {
    const nm = rng.pick(["Annual day", "  Diwali   party  ", "Q3 <b>review</b>"]);
    input.name = nm;
    exp.name = nm.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  }
  if (rng.chance(0.1)) {
    input.roomMode = true;
    exp.roomMode = true;
  }
  return { input, exp, err, tags };
}
var REW = (n) => Array.from({ length: n }, (_, i) => ({ pattern: HOUSES_O[i % 10], ordinal: 1 + Math.floor(i / 10) }));
var BR = (o = {}) => ({ after: 10, seconds: 60, kind: "speech", title: "Welcome", ...o });
var bads = () => [
  { name: "rounds-0", patch: { rounds: 0 }, sub: "rounds" },
  { name: "rounds-6", patch: { rounds: 6 }, sub: "rounds" },
  { name: "rounds-1.5", patch: { rounds: 1.5 }, sub: "rounds" },
  { name: "rounds-text", patch: { rounds: "2" }, sub: "rounds" },
  { name: "rounds-null", patch: { rounds: null }, sub: "rounds" },
  { name: "tickets-3", patch: { tickets: 3 }, sub: "cards" },
  { name: "tickets-0", patch: { tickets: 0 }, sub: "cards" },
  { name: "tickets-text", patch: { tickets: "1" }, sub: "cards" },
  { name: "rewards-empty", patch: { rewards: [] }, sub: "between 1 and" },
  { name: "rewards-text", patch: { rewards: "line" }, sub: "between 1 and" },
  { name: "rewards-31", patch: { rewards: REW(31) }, sub: "between 1 and" },
  { name: "house-unknown", patch: { rewards: [{ pattern: "bogus" }] }, sub: "unknown house" },
  { name: "house-null", patch: { rewards: [null] }, sub: "unknown house" },
  { name: "ordinal-0", patch: { rewards: [{ pattern: "line", ordinal: 0 }] }, sub: "winner number" },
  { name: "ordinal-1.5", patch: { rewards: [{ pattern: "line", ordinal: 1.5 }] }, sub: "winner number" },
  { name: "ordinal-text", patch: { rewards: [{ pattern: "line", ordinal: "2" }] }, sub: "winner number" },
  { name: "line-4th", patch: { rewards: [1, 2, 3, 4].map((o) => ({ pattern: "line", ordinal: o })) }, sub: "winners" },
  { name: "blackout-3rd", patch: { rewards: [1, 2, 3].map((o) => ({ pattern: "blackout", ordinal: o })) }, sub: "winners" },
  { name: "plus-3rd", patch: { rewards: [1, 2, 3].map((o) => ({ pattern: "plus", ordinal: o })) }, sub: "winners" },
  { name: "reward-gap", patch: { rewards: [{ pattern: "corners", ordinal: 2 }] }, sub: "needs the one before" },
  { name: "reward-twice", patch: { rewards: [{ pattern: "x", ordinal: 1 }, { pattern: "x", ordinal: 1 }] }, sub: "listed twice" },
  { name: "breaks-4", patch: { breaks: [10, 20, 30, 40].map((a) => BR({ after: a })) }, sub: "brand moments during the game" },
  { name: "breaks-text", patch: { breaks: "x" }, sub: "brand moments during the game" },
  { name: "after-0", patch: { breaks: [BR({ after: 0 })] }, sub: "starts after 1 to 74" },
  { name: "after-75", patch: { breaks: [BR({ after: 75 })] }, sub: "starts after 1 to 74" },
  { name: "after-1.5", patch: { breaks: [BR({ after: 1.5 })] }, sub: "starts after 1 to 74" },
  { name: "after-text", patch: { breaks: [BR({ after: "5" })] }, sub: "starts after 1 to 74" },
  { name: "secs-14", patch: { breaks: [BR({ seconds: 14 })] }, sub: "15 to 600 seconds" },
  { name: "secs-601", patch: { breaks: [BR({ seconds: 601 })] }, sub: "15 to 600 seconds" },
  { name: "secs-16", patch: { breaks: [BR({ seconds: 16 })] }, sub: "15 to 600 seconds" },
  { name: "secs-text", patch: { breaks: [BR({ seconds: "30" })] }, sub: "15 to 600 seconds" },
  { name: "kind-bogus", patch: { breaks: [BR({ kind: "dance" })] }, sub: "a break is a file" },
  { name: "lucky-2", patch: { breaks: [BR({ kind: "lucky", winners: 2 })] }, sub: "picks 1, 3, 5 or 10" },
  { name: "lucky-style", patch: { breaks: [BR({ kind: "lucky", style: "bogus" })] }, sub: "shown as a draw" },
  { name: "style-on-speech", patch: { breaks: [BR({ style: "draw" })] }, sub: "only a lucky draw has a style" },
  { name: "title-short", patch: { breaks: [BR({ title: "A" })] }, sub: "short title" },
  { name: "title-none", patch: { breaks: [BR({ title: undefined })] }, sub: "short title" },
  { name: "title-markup", patch: { breaks: [BR({ title: "<>" })] }, sub: "short title" },
  { name: "link-http", patch: { breaks: [BR({ kind: "file", mediaUrl: "http://example.com/a.mp4" })] }, sub: "https://" },
  { name: "link-spaces", patch: { breaks: [BR({ kind: "file", mediaUrl: "https://example.com/a b.mp4" })] }, sub: "https://" },
  { name: "youtube-other", patch: { breaks: [BR({ kind: "youtube", mediaUrl: "https://youtube.com.evil.example/v" })] }, sub: "not a youtube" },
  { name: "file-nolink", patch: { breaks: [BR({ kind: "file" })] }, sub: "needs a link" },
  { name: "lucky-link", patch: { breaks: [BR({ kind: "lucky", mediaUrl: "https://example.com/x" })] }, sub: "no link" },
  { name: "break-twice", patch: { breaks: [BR({ after: 10 }), BR({ after: 10, title: "Again" })] }, sub: "same number" },
  { name: "mark-bogus", patch: { mark: "tapping" }, sub: "marking is" },
  { name: "join-bogus", patch: { join: "email" }, sub: "joining is" },
  { name: "brand-colour", patch: { brand: { name: "Acme", color: "#123456" } }, sub: "brand colours" },
  { name: "brand-name-long", patch: { brand: { name: "N".repeat(41), color: "#0B3D91" } }, sub: "brand name" },
  { name: "brand-name-none", patch: { brand: { color: "#0B3D91" } }, sub: "brand name" },
  { name: "brand-key", patch: { brand: { name: "A", color: "#0B3D91", size: 3 } }, sub: "only a name" },
  { name: "brand-array", patch: { brand: [1] }, sub: "brand needs" },
  { name: "brand-text", patch: { brand: "Acme" }, sub: "brand needs" },
  { name: "open-lucky", patch: { opening: [{ kind: "lucky", title: "Win" }] }, sub: "lucky draw can only" },
  { name: "open-2", patch: { opening: [{ kind: "speech", title: "One" }, { kind: "speech", title: "Two" }] }, sub: "brand moment" },
  { name: "open-secs", patch: { opening: [{ kind: "speech", title: "One", seconds: 14 }] }, sub: "opening lasts" },
  { name: "open-sum", patch: { tickets: 2, opening: [{ kind: "speech", title: "One", seconds: 90 }, { kind: "speech", title: "Two", seconds: 90 }] }, sub: "must fit together" },
  { name: "open-text", patch: { opening: "x" }, sub: "brand moment" },
  { name: "close-kind", patch: { closing: [{ kind: "dance", title: "Bye" }] }, sub: "brand moment is" },
  { name: "close-title", patch: { closing: [{ kind: "speech", title: "B" }] }, sub: "short message or title" },
  { name: "tz-1", patch: { tz: BAD_TZ[0] }, sub: "time zone" },
  { name: "tz-2", patch: { tz: BAD_TZ[1] }, sub: "time zone" },
  { name: "tz-3", patch: { tz: BAD_TZ[2] }, sub: "time zone" },
  { name: "tz-4", patch: { tz: BAD_TZ[3] }, sub: "time zone" },
  { name: "tz-5", patch: { tz: BAD_TZ[4] }, sub: "time zone" },
  { name: "tz-6", patch: { tz: BAD_TZ[5] }, sub: "time zone" },
  { name: "tz-7", patch: { tz: BAD_TZ[6] }, sub: "time zone" },
  { name: "verify-bogus", patch: { verify: "sms" }, sub: "what a person must give" },
  { name: "idkind-bogus", patch: { idKind: "phone" }, sub: "what the id is" },
  { name: "emponly-text", patch: { employeesOnly: "yes" }, sub: "employees only" },
  { name: "room-num", patch: { roomMode: 1 }, sub: "everyone in one room" },
  { name: "inv-text", patch: { invites: "x" }, sub: "invites: say" },
  { name: "inv-on-text", patch: { invites: { on: "yes" } }, sub: "invites: say" },
  { name: "inv-per-0", patch: { invites: { on: true, per: 0 } }, sub: "family members" },
  { name: "inv-per-5", patch: { invites: { on: true, per: 5 } }, sub: "family members" },
  { name: "inv-per-1.5", patch: { invites: { on: true, per: 1.5 } }, sub: "family members" },
  { name: "inv-cat", patch: { invites: { on: true, cats: ["family", "aliens"] } }, sub: "kinds of guests" },
  { name: "inv-cat-text", patch: { invites: { on: true, cats: "family" } }, sub: "kinds of guests" },
  { name: "inv-none", patch: { invites: { on: true, cats: [] } }, sub: "at least one kind" }
];
function kindConfig(rng, c) {
  const mode = wpick(rng, [["valid", 42], ["invalid", 38], ["tables", 20]]), d = c.dims;
  d.cfgMode = mode;
  if (mode === "valid") {
    const g = genValid(rng), v = validateCfg(g.input);
    if (g.err) {
      c.ck("G-04", !v.ok && !!v.error && /same number/.test(v.error) && plain(v.error), v.ok ? "accepted" : v.error);
      d.cfgOutcome = "refused:two-breaks-same-number";
      return { k: "config", input: g.input };
    }
    if (!c.ck("G-01", v.ok, v.ok ? 0 : v.error) || !v.ok)
      return { k: "config", input: g.input };
    const cfg = v.cfg, e = g.exp;
    c.ck("G-01", cfg.tickets === e.tickets && cfg.rounds === e.rounds, [cfg.tickets, cfg.rounds]);
    c.ck("G-01", canon(cfg.rewards.map((r) => [r.pattern, r.ordinal, r.text])) === canon(e.rewards) && cfg.rewards.every((r) => r.scope === "ticket"), "rewards");
    c.ck("G-01", canon(cfg.breaks) === canon(e.breaks), { got: cfg.breaks.slice(0, 2), want: e.breaks.slice(0, 2) });
    c.ck("G-01", canon(cfg.invites) === canon(e.invites), { got: cfg.invites, want: e.invites });
    for (const f of ["verify", "idKind", "join", "mark", "tz", "name", "roomMode", "employeesOnly", "brand"])
      c.ck("G-01", canon(cfg[f]) === canon(e[f]), [f, cfg[f], e[f]]);
    c.ck("G-01", canon(cfg.opening) === canon(e.opening ?? []) && canon(cfg.closing) === canon(e.closing ?? []), "moments");
    const back = validateCfg({ tickets: cfg.tickets, rewards: cfg.rewards, breaks: cfg.breaks, rounds: cfg.rounds, invites: cfg.invites, mark: cfg.mark, join: cfg.join, tz: cfg.tz, verify: cfg.verify, employeesOnly: cfg.employeesOnly, idKind: cfg.idKind, opening: cfg.opening, closing: cfg.closing, name: cfg.name, brand: cfg.brand, roomMode: cfg.roomMode }, undefined, { stored: true });
    c.ck("G-01", back.ok && canon(back.cfg) === canon(cfg), back.ok ? "differs" : back.error);
    const per = new Map;
    for (const r of cfg.rewards)
      per.set(r.pattern, (per.get(r.pattern) ?? 0) + 1);
    let lim = true;
    for (const [h, n] of per) {
      if (n > OH[h].max)
        lim = false;
      for (let o = 1;o <= n; o++)
        if (!cfg.rewards.some((r) => r.pattern === h && r.ordinal === o))
          lim = false;
    }
    c.ck("G-03", lim, [...per]);
    const bs = cfg.breaks;
    c.ck("G-04", bs.length <= 3 * cfg.tickets && bs.every((b, i) => b.after >= 1 && b.after <= 74 && b.seconds >= 15 && b.seconds <= 600 && b.seconds % 3 === 0 && (i === 0 || bs[i - 1].after < b.after) && (b.kind !== "lucky" || [1, 3, 5, 10].includes(b.winners ?? 0))), "breaks kept");
    c.ck("G-10", cfg.opening.length <= cfg.tickets && cfg.closing.length <= cfg.tickets && bs.length + cfg.opening.length + cfg.closing.length <= 5 * cfg.tickets, "moments");
    c.ck("G-05", !(cfg.employeesOnly && cfg.invites.on) && cfg.invites.per >= 1 && cfg.invites.per <= 4, cfg.invites);
    d.mode = cfg.roomMode ? "one-room" : cfg.employeesOnly ? "employees-only" : cfg.invites.on ? "open-with-invites" : "open";
    d.cfgOutcome = "kept";
    d.cfgTickets = cfg.tickets;
    d.cfgRounds = cfg.rounds;
    for (const t of g.tags)
      d["cfg_" + t.split(":")[0]] = t.split(":")[1] ?? "yes";
    c.note(`config kept: ${js(g.tags)}`);
    return { k: "config", input: g.input };
  }
  if (mode === "invalid") {
    const list = bads(), b = rng.pick(list), rw = genRewards(rng);
    const base = { rounds: rng.int(1, 5), rewards: rw.input, name: "Event " + rng.hex(3) };
    if (rng.chance(0.3))
      base.mark = rng.pick(["auto", "tap"]);
    if (rng.chance(0.3))
      base.join = rng.pick(["name", "phone"]);
    if (rng.chance(0.3))
      base.tz = rng.pick(TZS);
    if (rng.chance(0.3))
      base.verify = rng.pick(VERIFY_MODES);
    const input = { ...base, ...b.patch };
    let res = null, threw = "";
    try {
      res = validateCfg(input);
    } catch (e) {
      threw = String(e);
    }
    c.ck("G-02", threw === "", b.name + ": " + threw);
    if (res) {
      c.ck("G-02", !res.ok, b.name + ": accepted");
      if (!res.ok) {
        c.ck("G-02", plain(res.error), b.name + ": " + res.error);
        c.ck("G-02", res.error.toLowerCase().includes(b.sub), b.name + ": " + res.error + " (wanted '" + b.sub + "')");
      }
    }
    if (rng.chance(0.15)) {
      const two = validateCfg({ tickets: 2, breaks: [10, 20, 30, 40, 50, 60].map((a) => BR({ after: a })) });
      if (c.ck("G-10", two.ok, two.ok ? 0 : two.error) && two.ok) {
        const back = validateCfg({ tickets: 1 }, two.cfg);
        c.ck("G-10", !back.ok && /brand moments/.test(back.ok ? "" : back.error) && plain(back.ok ? "" : back.error), back.ok ? "accepted" : back.error);
      }
    }
    d.cfgOutcome = "refused";
    d.cfgBad = b.name.split("-")[0];
    c.note(`config refused: ${b.name}`);
    return { k: "config-bad", name: b.name, input };
  }
  d.cfgOutcome = "tables";
  const sizes = [0, 1, 2, 3, 5, 6, 7, 12, 13, 59, 60, 61, 120, 500, 501, 2000, 2001, rng.int(1, 2600), rng.int(1, 300), rng.int(1, 40)];
  for (const p of sizes) {
    c.ck("G-08", quorumFor(p) === quorumO(p), [p, quorumFor(p), quorumO(p)]);
    c.ck("G-08", votersFor(p) === votersO(p), [p, votersFor(p), votersO(p)]);
  }
  for (let n = 1;n <= 8; n++)
    for (let k = 1;k <= n; k++)
      if (rng.chance(0.3))
        c.ck("G-06", autoAfter(n, k) === autoAfterO(n, k), [n, k]);
  c.ck("G-06", autoAfter(1, 1) === 38 && autoAfter(2, 1) === 25 && autoAfter(2, 2) === 50 && autoAfter(3, 3) === 56 && autoAfter(200, 1) === 1 && autoAfter(1, 5) === 74, "worked");
  const dc = defaultCfg();
  c.ck("G-09", dc.tickets === 1 && dc.rounds === 1 && dc.breaks.length === 0 && dc.opening.length === 0 && dc.closing.length === 0 && js(dc.invites) === js({ on: false, per: 4, cats: ["family", "colleagues"] }) && js(dc.rewards.map((r) => [r.pattern, r.scope, r.ordinal, r.text])) === js([["line", "ticket", 1, ""], ["corners", "ticket", 1, ""], ["x", "ticket", 1, ""], ["blackout", "ticket", 1, ""]]), "defaults");
  const empty = validateCfg({});
  c.ck("G-09", empty.ok && canon(empty.cfg) === canon(dc), "empty input = defaults");
  c.ck("G-09", js(PATTERN_ORDER) === js(["line", "corners", "x", "blackout"]) && js(defaultRewards().map((r) => r.pattern)) === js(PATTERN_ORDER) && defaultInvites().per === 4, "pattern order");
  c.ck("G-10", MAX_MID_PER_TICKET === 3 && MAX_BREAKS === 3 && [1, 2].every((t) => maxMidFor(t) === 3 * t && maxEdgeFor(t) === t && brandMomentsFor(t) === 5 * t) && OPENING_WINDOW_SECONDS === 120, "allowance");
  c.ck("G-04", MAX_CALLS === 75 && MAX_ROUNDS === 5 && GRACE_ROUNDS === 40 && LATE_LAG_ROUNDS === 30 && INTERMISSION_ROUNDS === 30 && js(LUCKY_WINNERS) === js([1, 3, 5, 10]) && NUMBERS === 75, "constants");
  c.ck("G-05", MAX_INVITES_PER_PERSON === 4 && INVITE_CATEGORIES.length === 10 && new Set(INVITE_CATEGORIES.map((k) => k.id)).size === 10 && DEMO_CAP === 10 && BRAND_NAME_MAX === 40 && BRAND_COLORS.length === 8 && new Set(BRAND_COLORS).size === 8, "invites and brand");
  const canonSets = (sets) => JSON.stringify(sets.map((s) => [...s].sort((a, b) => a - b)).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  c.ck("G-07", js(PRIZE_HOUSES.map((h) => h.id)) === js([...HOUSES_O]) && js(HOUSE_ORDER) === js([...HOUSES_O]), "order");
  for (const h of PRIZE_HOUSES) {
    const o = OH[h.id];
    c.ck("G-07", h.max === o.max && maxWinnersFor(h.id) === o.max, [h.id, h.max, o.max]);
    const pr = PATTERN_RULES[h.id], cr = HOUSES[h.id];
    c.ck("G-07", pr.need === o.need && canonSets(pr.sets) === canonSets(o.sets), [h.id, "shared copy"]);
    c.ck("G-07", cr.need === o.need && canonSets(cr.sets) === canonSets(o.sets) && cr.max === o.max, [h.id, "common engine copy"]);
  }
  c.ck("G-07", js([...HOUSE_IDS]) === js([...HOUSES_O]), "core order");
  c.ck("G-07", maxWinnersFor("nope") === 1 && MAX_ORDINAL === 3 && LEGACY_MAX_ORDINAL === 3 && MAX_REWARD_LINES === 30, "limits");
  const rewards = [{ pattern: "x", scope: "ticket", ordinal: 2, text: "" }, { pattern: "line", scope: "ticket", ordinal: 1, text: "" }, { pattern: "x", scope: "ticket", ordinal: 1, text: "" }, { pattern: "blackout", scope: "ticket", ordinal: 1, text: "" }];
  c.ck("G-07", js(keysInPlay(rewards)) === js(["line", "x", "blackout"]) && js(linesFor(rewards, "x").map((l) => l.ordinal)) === js([1, 2]), "keys and lines");
  const old = [1, 2, 3].map((o) => ({ pattern: "blackout", ordinal: o }));
  c.ck("G-03", validateCfg({ rewards: old }).ok === false && validateCfg({ rewards: old }, undefined, { stored: true }).ok === true, "stored limit");
  c.ck("G-03", isTimeZone("Asia/Kolkata") && isTimeZone("America/New_York") && !isTimeZone("Mars/Phobos") && !isTimeZone(null) && DEFAULT_TZ === "Asia/Kolkata", "time zones");
  return { k: "tables", sizes };
}

// games/bingo/k_misc.ts
function validCard(t) {
  const a = t;
  if (!Array.isArray(a) || a.length !== 5)
    return false;
  const seen = new Set;
  for (let r = 0;r < 5; r++) {
    const row3 = a[r];
    if (!Array.isArray(row3) || row3.length !== 5)
      return false;
    for (let c = 0;c < 5; c++) {
      const v = row3[c];
      if (r === 2 && c === 2) {
        if (v !== null)
          return false;
        continue;
      }
      if (typeof v !== "number" || !Number.isInteger(v) || v < c * 15 + 1 || v > c * 15 + 15 || seen.has(v))
        return false;
      seen.add(v);
    }
  }
  return seen.size === 24;
}
var cardKey = (t) => JSON.stringify(t);
var pickO = (eid, k, rnd, called) => {
  const taken = new Set(called), rem = [];
  for (let n = 1;n <= 75; n++)
    if (!taken.has(n))
      rem.push(n);
  return rem[Number(BigInt("0x" + sha(`CB1|${eid}|${k}|${rnd}`)) % BigInt(rem.length))];
};
function kindCards(rng, c) {
  const d = c.dims, fresh = rng.chance(0.3);
  let params;
  if (!fresh) {
    const w = rng.int(0, NW - 1), W = worldOf(w), round = rng.int(1, 5), eid = roundEid(W.eid, round), keys2 = new Set;
    let valid = true;
    const sm = rng.sample(Array.from({ length: W.pids.length }, (_, i2) => i2), Math.min(W.pids.length, 6));
    for (const i2 of sm)
      for (const t of pairOf(w, round, i2)) {
        if (!validCard(t) || !isValidTicket(t))
          valid = false;
        keys2.add(cardKey(t));
      }
    c.ck("C-01", valid, { w, round });
    if (!W.legacy)
      c.ck("C-03", keys2.size === 2 * sm.length, { cards: keys2.size, seats: sm.length });
    const i = rng.int(0, W.pids.length - 1), pid = W.pids[i], pr = pairOf(w, round, i);
    c.ck("C-02", cardKey(pr[0]) !== cardKey(pr[1]), "second card differs");
    c.ck("C-02", cardKey(ticketFor(eid, pid)) === cardKey(pr[0]) && cardKey(ticketsFor(eid, pid, 1)[0]) === cardKey(pr[0]), "first card stable");
    const other = round === 5 ? 1 : round + 1;
    c.ck("C-05", cardKey(pairOf(w, other, i)[0]) !== cardKey(pr[0]) && roundEid(W.eid, 1) === W.eid && roundEid(W.eid, 3) === W.eid + "~r3" && roundEid2(W.eid, 4) === W.eid + "~r4" && roundEid2(W.eid, 1) === W.eid, "rounds differ");
    if (!W.legacy) {
      const seat = i + 1;
      c.ck("C-04", seatOfPid(pid) === seat && positionOf(seat, 0) === 2 * (seat - 1) && positionOf(seat, 1) === 2 * (seat - 1) + 1 && cardKey(ticketAt(eid, 2 * (seat - 1))) === cardKey(pr[0]) && cardKey(ticketAt(eid, 2 * (seat - 1) + 1)) === cardKey(pr[1]), { seat });
    } else
      c.ck("C-04", seatOfPid(pid) === null, pid);
    const pos = rng.int(0, 2000000000), pa = ticketAt(eid, pos), pb = ticketAt(eid, pos + 1);
    c.ck("C-03", validCard(pa) && validCard(pb) && cardKey(pa) !== cardKey(pb), { pos });
    d.cardsFrom = W.legacy ? "plain-ids" : "seat-ids";
    params = { k: "cards", w, round, i, pos };
  } else {
    const eid = "BC" + rng.hex(5), round = rng.int(1, 5), reid = roundEid(eid, round), plain2 = rng.chance(0.25);
    const big = rng.chance(0.3), s1 = big ? rng.int(1e5, 9999999) : rng.int(1, 60), s2 = s1 === 1 ? 2 : s1 - 1;
    const p1 = plain2 ? rng.hex(8) : `${s1}x${rng.hex(rng.int(4, 12))}`, p2 = plain2 ? rng.hex(8) : `${s2}x${rng.hex(8)}`;
    const a = ticketsFor(reid, p1, 2), b = ticketsFor(reid, p2, 2), a2 = ticketsFor(reid, p1, 2);
    c.ck("C-01", [...a, ...b].every((t) => validCard(t) && isValidTicket(t)), { p1, p2 });
    c.ck("C-02", cardKey(a) === cardKey(a2) && cardKey(a[0]) !== cardKey(a[1]), "same again / second differs");
    c.ck("C-03", new Set([...a, ...b].map(cardKey)).size === 4, "four different cards");
    if (!plain2) {
      c.ck("C-04", seatOfPid(p1) === s1 && cardKey(ticketAt(reid, 2 * (s1 - 1))) === cardKey(a[0]) && cardKey(ticketAt(reid, 2 * (s1 - 1) + 1)) === cardKey(a[1]), { s1 });
      const hashB = `${s1}x${rng.hex(8)}`;
      c.ck("C-04", cardKey(ticketsFor(reid, hashB, 2)) === cardKey(a), "hash part does not matter");
    } else
      c.ck("C-04", seatOfPid(p1) === null, p1);
    for (const bad of ["0x" + rng.hex(8), `5x${rng.hex(3)}`, `5xZZ${rng.hex(8)}`, "x" + rng.hex(8), `12345678x${rng.hex(8)}`, rng.hex(8), "", "5x" + rng.hex(8).toUpperCase()])
      c.ck("C-04", seatOfPid(bad) === (/^\d{1,7}x[0-9a-f]{8,}$/.test(bad) && Number(bad.split("x")[0]) >= 1 ? Number(bad.split("x")[0]) : null), bad);
    c.ck("C-05", cardKey(ticketsFor(roundEid(eid, round === 5 ? 1 : round + 1), p1, 2)[0]) !== cardKey(a[0]), "another round");
    d.cardsFrom = plain2 ? "fresh-plain" : big ? "fresh-big-seat" : "fresh-seat";
    params = { k: "cards", eid, round, p1, p2 };
  }
  if (rng.chance(0.3)) {
    const n = BigInt(rng.int(2, 36)), key = Uint8Array.from({ length: 32 }, () => rng.int(0, 255)), seen = new Set;
    let inRange2 = true;
    for (let i = 0n;i < n; i++) {
      const x = permute(i, n, key);
      if (x < 0n || x >= n)
        inRange2 = false;
      seen.add(x.toString());
    }
    c.ck("C-06", inRange2 && seen.size === Number(n), { n: Number(n) });
    const k = rng.pick([4, 5]), rank = BigInt(rng.int(0, 32759)), rank2 = (rank + 1n) % 32760n, lo = rng.pick([1, 16, 31, 46, 61]);
    const u1 = unrankArrangement(rank, k, lo), u2 = unrankArrangement(rank2, k, lo);
    c.ck("C-06", u1.length === k && new Set(u1).size === k && u1.every((x) => x >= lo && x <= lo + 14) && js(u1) !== js(u2), { rank: Number(rank) });
    let threw = false;
    try {
      permute(n, n, key);
    } catch {
      threw = true;
    }
    c.ck("C-06", threw, "outside the list");
    params.perm = { n: Number(n), key: key[0] * 256 + key[1], rank: Number(rank), k, lo };
  }
  if (rng.chance(0.5)) {
    const eid = "BN" + rng.hex(4), style = wpick(rng, [["random", 70], ["zeros", 6], ["same", 6], ["upper", 6], ["short", 6], ["empty", 6]]);
    const one = rng.hex(32), rnd = Array.from({ length: 75 }, () => style === "random" ? rng.hex(32) : style === "zeros" ? "00".repeat(32) : style === "same" ? one : style === "upper" ? rng.hex(32).toUpperCase() : style === "short" ? rng.hex(2) : "");
    const log = deriveCalls(eid, rnd), want = [];
    for (let k2 = 0;k2 < 75; k2++)
      want.push(pickO(eid, k2, rnd[k2], want));
    c.ck("N-01", js(log) === js(want) && new Set(log).size === 75 && log.every((n) => n >= 1 && n <= 75), { style });
    const k = rng.int(0, 74);
    c.ck("N-02", pickNumber(eid, k, rnd[k], log.slice(0, k)) === log[k] && pickO(eid, k, rnd[k], log.slice(0, k)) === log[k], { k });
    const m = rng.int(1, 74), r2 = rnd.slice();
    r2[m] = rng.hex(32) + "ab";
    c.ck("N-02", js(deriveCalls(eid, r2).slice(0, m)) === js(log.slice(0, m)), { m });
    let threw = false;
    try {
      pickNumber(eid, 75, "ab", log);
    } catch {
      threw = true;
    }
    c.ck("N-01", threw, "all 75 called");
    c.ck("N-01", deriveCalls(eid, []).length === 0, "empty");
    const start = rng.int(1, 5000000), sec = rng.pick([6, 9, 12, 15, 30, 60, 90]), sc = scheduleFor(start, sec, 75);
    c.ck("K-01", sc.length === 75 && sc[0] === start && sc[74] === start + 74 * (sec / 3) && sc.every((x, i) => x === start + i * (sec / 3)), { start, sec });
    let bad = 0;
    for (const s of [3, 4, 5, 7, 0, -6, 7.5]) {
      try {
        scheduleFor(start, s, 5);
      } catch (e) {
        if (/multiple of 3 seconds, at least 6/.test(String(e)))
          bad++;
      }
    }
    c.ck("K-01", bad === 7, "bad speeds refused");
    d.numbers = style;
    params.num = { eid, style, r0: rnd[0], m, k, start, sec };
  }
  c.note(`cards: ${d.cardsFrom}`);
  return params;
}
function kindLucky(rng, c) {
  const eid = "BL" + rng.hex(4), after = rng.int(1, 74), rnd = rng.hex(32), n = rng.pick([1, 3, 5, 10]), size = wpick(rng, [[rng.int(1, 4), 15], [rng.int(5, 12), 30], [rng.int(13, 60), 45], [rng.int(61, 120), 10]]);
  const pids = Array.from({ length: size }, (_, i) => rng.chance(0.2) ? rng.hex(6) : `${i + 1}x${rng.hex(8)}`);
  const got = luckyWinners(eid, after, rnd, pids, n), want = oracleLucky(eid, after, rnd, pids, n);
  c.ck("Y-01", js(got) === js(want) && got.length === Math.min(n, size) && new Set(got).size === got.length && got.every((p) => pids.includes(p)), { got: got.slice(0, 3), want: want.slice(0, 3) });
  const withDups = rng.shuffle([...pids, ...rng.sample(pids, Math.min(size, 5))]);
  c.ck("Y-01", js(luckyWinners(eid, after, rnd, withDups, n)) === js(got), "list order and repeats do not matter");
  for (const m of [1, 3, 5])
    if (m < n)
      c.ck("Y-02", js(luckyWinners(eid, after, rnd, pids, n).slice(0, m)) === js(luckyWinners(eid, after, rnd, pids, m)), { m, n });
  c.ck("Y-01", luckyWinners(eid, after, rnd, pids, 0).length === 0 && luckyWinners(eid, after, rnd, [], n).length === 0 && luckyWinners(eid, after, rnd, pids, -3).length === 0, "none");
  const rnd2 = rng.hex(32);
  c.ck("Y-01", js(luckyWinners(eid, after, rnd2, pids, n)) === js(oracleLucky(eid, after, rnd2, pids, n)), "other randomness");
  const d = c.dims;
  d.luckyPick = n;
  d.luckyList = size <= 4 ? "1-4" : size <= 12 ? "5-12" : size <= 60 ? "13-60" : "61+";
  d.luckyShort = size < n ? "fewer-than-winners" : "enough";
  c.note(`lucky: ${n} of ${size}`);
  return { k: "lucky", eid, after, rnd, n, pids };
}
var IST2 = 19800000;
var DAYMS = 86400000;
function kindTime(rng, c) {
  const d = c.dims, part = wpick(rng, [["clock", 35], ["erase", 35], ["zones", 30]]);
  d.timeKind = part;
  if (part === "clock") {
    const r = rng.int(1, 120000000), want2 = (1692803367 + (r - 1) * 3) * 1000;
    c.ck("P-09", roundTimeMs(r) === want2 && roundMs(r) === want2 && roundStartMs(r) === want2, { r, a: roundTimeMs(r), b: roundMs(r), c: roundStartMs(r) });
    c.ck("E-03", roundAt(want2) === r && roundAt(want2 + 2999) === r && roundAt(want2 + 3000) === r + 1 && roundAt(want2 - 1) === r - 1, { r });
    c.ck("E-03", roundAt(1692803367000) === 1 && roundTimeMs(1) === 1692803367000 && GENESIS3 === 1692803367, "genesis");
    return { k: "time-clock", r };
  }
  if (part === "erase") {
    const end = Date.UTC(2026, 10, 1) + rng.int(0, 4 * 365 * 24 * 60 * 60) * 1000 + rng.int(0, 999);
    c.ck("E-01", personalDeleteAt(end) === end + 20 * 3600000 && reportLinkUntil(end) === end + 19 * 3600000 && PURGE_AFTER_MS === 20 * 3600000 && REPORT_LINK_MS === 19 * 3600000 && MAX_AHEAD_MS2 === 30 * DAYMS, { end });
    c.ck("E-01", reportLinkUntil(end) < personalDeleteAt(end) && personalDeleteAt(end) - end < 24 * 3600000, "inside the 24 hour promise");
    const t = end + 365 * DAYMS, ist = new Date(t + IST2), want2 = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - IST2, got = fullDeleteAt(end);
    c.ck("E-01", got === want2 && (got + IST2) % DAYMS === 0 && got > t && got - t <= DAYMS, { end, got, want: want2 });
    return { k: "time-erase", end };
  }
  const zones = [["Asia/Kolkata", 19800000], ["Asia/Singapore", 28800000], ["Asia/Dubai", 14400000], ["Africa/Nairobi", 10800000], ["UTC", 0], ["America/Argentina/Buenos_Aires", -10800000]];
  const [tz, off] = rng.pick(zones), y = rng.int(2026, 2032), mo = rng.int(1, 12), dd = rng.int(1, 28), h = rng.int(6, 21), mi = rng.int(0, 59);
  const utc = zoneLocalToUtc(y, mo, dd, h, mi, tz), want = Date.UTC(y, mo - 1, dd, h, mi) - off;
  c.ck("E-02", utc === want, { tz, y, mo, dd, h, mi, utc, want });
  const p = zoneParts(utc, tz);
  c.ck("E-02", p.y === y && p.mo === mo && p.d === dd && p.h === h && p.mi === mi && p.s === 0, { tz, p });
  c.ck("E-02", zoneOffsetMs(utc, tz) === off, { tz, off });
  const nth = (yy, mm, wd, n) => {
    const first = new Date(Date.UTC(yy, mm, 1)).getUTCDay();
    return 1 + (wd - first + 7) % 7 + 7 * (n - 1);
  };
  const lastSun = (yy, mm) => {
    const last = new Date(Date.UTC(yy, mm + 1, 0));
    return last.getUTCDate() - last.getUTCDay();
  };
  const day = Date.UTC(y, mo - 1, dd), usOn = day > Date.UTC(y, 2, nth(y, 2, 0, 2)) + DAYMS && day < Date.UTC(y, 10, nth(y, 10, 0, 1)) - DAYMS, usOff = day < Date.UTC(y, 2, nth(y, 2, 0, 2)) - DAYMS || day > Date.UTC(y, 10, nth(y, 10, 0, 1)) + DAYMS;
  const euOn = day > Date.UTC(y, 2, lastSun(y, 2)) + DAYMS && day < Date.UTC(y, 9, lastSun(y, 9)) - DAYMS, euOff = day < Date.UTC(y, 2, lastSun(y, 2)) - DAYMS || day > Date.UTC(y, 9, lastSun(y, 9)) + DAYMS;
  if (usOn || usOff) {
    const z = "America/New_York", u = zoneLocalToUtc(y, mo, dd, h, mi, z);
    c.ck("E-02", zoneOffsetMs(u, z) === (usOn ? -4 : -5) * 3600000 && u === Date.UTC(y, mo - 1, dd, h, mi) - (usOn ? -4 : -5) * 3600000, { z, y, mo, dd, usOn });
  }
  if (euOn || euOff) {
    const z = "Europe/London", u = zoneLocalToUtc(y, mo, dd, h, mi, z);
    c.ck("E-02", zoneOffsetMs(u, z) === (euOn ? 1 : 0) * 3600000 && u === Date.UTC(y, mo - 1, dd, h, mi) - (euOn ? 1 : 0) * 3600000, { z, y, mo, dd, euOn });
  }
  return { k: "time-zone", tz, y, mo, dd, h, mi };
}
var HEXD = "0123456789abcdef";
var hexN = (rng, n) => {
  let s = "";
  for (let i = 0;i < n; i++)
    s += HEXD[rng.int(0, 15)];
  return s;
};
var digits = (rng, n) => {
  let s = "";
  for (let i = 0;i < n; i++)
    s += String(rng.int(0, 9));
  return s;
};
var KNOWN2 = ["44", "65", "61", "49", "33", "81", "971", "880", "977", "254", "27", "1", "86", "60", "66"];
var FROM_LO = 1e9;
function expectFrom(f) {
  if (typeof f !== "number" || !Number.isInteger(f) || f < 1)
    return null;
  if (f === 1900000000)
    return { kind: "org" };
  if (f >= 1500000000 && f < 1500000000 + 268435456)
    return { kind: "host", hex: (f - 1500000000).toString(16).padStart(7, "0") };
  if (f >= FROM_LO && f < FROM_LO + 268435456)
    return { kind: "cohost", hex: (f - FROM_LO).toString(16).padStart(7, "0") };
  if (f < FROM_LO)
    return { kind: "guest", seq: f };
  return null;
}
var noisy = (rng, s) => {
  const style = rng.int(0, 5);
  if (style === 0)
    return s;
  if (style === 1)
    return s.slice(0, 5) + " " + s.slice(5);
  if (style === 2)
    return s.slice(0, 3) + "-" + s.slice(3, 6) + "-" + s.slice(6);
  if (style === 3)
    return "(" + s.slice(0, 3) + ") " + s.slice(3, 6) + " " + s.slice(6);
  if (style === 4)
    return s.slice(0, 5) + "." + s.slice(5);
  return " " + s + " ";
};
var lone = (s) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
function kindPeople(rng, c) {
  const d = c.dims, part = wpick(rng, [["links", 24], ["approvals", 14], ["phone", 26], ["name", 22], ["employee-id", 14]]);
  d.peopleKind = part;
  if (part === "links") {
    const role = wpick(rng, [["organizer", 14], ["host", 18], ["co-host", 26], ["guest", 30], ["family", 12]]);
    d.role = role;
    const hex2 = hexN(rng, 7);
    const inviter = role === "organizer" ? "o" : role === "host" ? "h:" + hex2 : role === "co-host" ? "c:" + hex2 : "s:" + rng.int(1, 999999);
    const code = fromCodeOf(inviter);
    const want2 = role === "organizer" ? 1900000000 : role === "host" ? 1500000000 + parseInt(hex2, 16) : role === "co-host" ? FROM_LO + parseInt(hex2, 16) : Number(inviter.slice(2));
    c.ck("P-01", code === want2, { inviter, code, want: want2 });
    const o = parseFrom(code), ex = expectFrom(want2);
    c.ck("P-01", js(o) === js(ex) && o !== null && inviterOf(o) === inviter, { inviter, o });
    c.ck("P-01", fromCodeOf("x:1") === null && fromCodeOf("") === null, "unknown inviter");
    c.ck("P-02", srcOf(inviter) === (role === "co-host" ? "co:" + hex2 : role === "host" ? "ho:" + hex2 : "link"), { inviter });
    const probe = rng.int(1, 2100000000);
    for (const f of [0, -1, 1.5, NaN, null, "5", undefined, FROM_LO - 1, FROM_LO, FROM_LO + 268435455, FROM_LO + 268435456, 1499999999, 1500000000, 1500000000 + 268435455, 1500000000 + 268435456, 1899999999, 1900000000, 1900000001, 2000000000, probe])
      c.ck("P-01", js(parseFrom(f)) === js(expectFrom(f)), String(f));
    const chainIds = [...role === "co-host" ? ["c:" + hex2] : [], ...role === "guest" || role === "family" ? [inviter] : [], ...rng.sample(["c:aaaaaaa", "c:bbbbbbb", "s:12", "s:123", "s:7"], rng.int(0, 3))];
    const chain = "," + chainIds.join(",") + ",";
    const all = role === "organizer" || role === "host", who = { all, id: inviter };
    c.ck("P-03", mayDecide(who, chain) === (all || chainIds.includes(inviter)), { role, chain, inviter });
    c.ck("P-03", mayDecide({ all: false, id: "s:1" }, ",s:12,s:123,") === false && mayDecide({ all: false, id: "s:12" }, ",s:12,s:123,") === true && mayDecide({ all: true, id: "zz" }, "") === true, "whole ids only");
    c.ck("P-08", COHOST_FROM === 1e9 && HOST_FROM === 1500000000 && ORG_FROM === 1900000000 && COHOST_LIMIT_DEFAULT === 100 && COHOST_LIMIT_MIN === 10 && COHOST_LIMIT_MAX === 1000 && MAX_ADD_BATCH === 200 && WAITING_MAX === 500 && MAX_INVITES_PER_PERSON === 4 && isOrg("o") && !isOrg("h:1"), "limits");
    c.ck("P-08", checkinRequired({}) === false && checkinRequired({ created_ms: Date.UTC(2030, 0, 1) }) === false, "no check-in step in Bingo");
    return { k: "people-links", role, inviter, chain, probe };
  }
  if (part === "approvals") {
    const at = Date.UTC(2026, 10, 1) + rng.int(0, 10000000000), delta = rng.pick([-1, 0, 1, 1799999, 1800000, 1800001, rng.int(0, 5000000)]);
    c.ck("P-04", waitingLapsed(at, at + delta) === delta >= 30 * 60000 && waitingValidUntil(at) === at + 30 * 60000 && WAIT_LIMIT_MS === 1800000, { delta });
    const start = Date.UTC(2026, 10, 1) + rng.int(0, 10000000000), dd = rng.pick([-1, 0, 1, 899999, 900000, 900001, rng.int(-3000000, 3000000)]);
    c.ck("P-04", familyCutoffPassed(start, start + dd) === dd >= -15 * 60000 && FAMILY_CUTOFF_MS === 900000, { dd });
    const created2 = rng.pick([Date.UTC(2026, 10, 4), Date.UTC(2098, 11, 31, 23, 59, 59), Date.UTC(2099, 0, 1), Date.UTC(2099, 0, 1) - 1, Date.UTC(2100, 5, 1), 0, NaN]), on = Number.isFinite(created2) && created2 >= Date.UTC(2099, 0, 1);
    c.ck("P-04", approvalRulesOn({ created_ms: created2 }) === on && approvalRulesOn(null) === false && approvalRulesOn({}) === false && waitSince({ created_ms: created2 }, 5000000) === (on ? 5000000 - 1800000 : 0), { created: created2 });
    d.approvalRules = on ? "on" : "off";
    return { k: "people-approvals", at, delta, start, dd, created: created2 };
  }
  if (part === "phone") {
    const ten = rng.pick(["6", "7", "8", "9"]) + digits(rng, 9), style2 = wpick(rng, [["indian", 30], ["indian-0", 10], ["indian-91", 14], ["bad-start", 8], ["short", 6], ["long", 5], ["intl-ok", 10], ["intl-unknown", 5], ["intl-length", 4], ["letters", 4], ["empty", 3], ["plus-free", 4]]);
    d.phone = style2;
    let raw2 = "", ok = false, digitsW = "", why = "";
    if (style2 === "indian") {
      raw2 = noisy(rng, ten);
      ok = true;
      digitsW = "91" + ten;
    } else if (style2 === "indian-0") {
      raw2 = rng.pick(["0", "00"]) === "0" ? "0" + ten : "0091" + ten;
      ok = true;
      digitsW = "91" + ten;
    } else if (style2 === "indian-91") {
      raw2 = rng.pick(["+91", "91", "+91 ", "+91-", "0091 ", "+91 (0) "]) + ten;
      if (raw2.includes("(0)")) {
        raw2 = "+91 " + ten;
      }
      ok = true;
      digitsW = "91" + ten;
    } else if (style2 === "bad-start") {
      {
        const f = rng.int(0, 5);
        raw2 = String(f) + (f === 0 ? String(rng.int(1, 9)) + digits(rng, 8) : digits(rng, 9));
      }
      why = "starts with 6, 7, 8 or 9";
    } else if (style2 === "short") {
      raw2 = String(rng.int(1, 8)) + digits(rng, rng.int(3, 8));
      why = "too short";
    } else if (style2 === "long") {
      raw2 = String(rng.int(1, 8)) + digits(rng, rng.int(15, 20));
      why = "too long";
    } else if (style2 === "intl-ok") {
      const cc = rng.pick(KNOWN2), n = 8 - cc.length + rng.int(0, 15 - 8 - 0), sub2 = digits(rng, Math.max(4, Math.min(n, 15 - cc.length)));
      raw2 = "+" + cc + " " + sub2;
      const all = cc + sub2;
      ok = all.length >= 8 && all.length <= 15;
      digitsW = all;
      if (!ok)
        why = all.length < 8 ? "too short" : "too long";
    } else if (style2 === "intl-unknown") {
      raw2 = "+999" + digits(rng, 9);
      why = "country code";
    } else if (style2 === "intl-length") {
      const cc = rng.pick(KNOWN2);
      if (rng.chance(0.5)) {
        raw2 = "+" + cc + digits(rng, 7 - cc.length);
        why = "too short";
      } else {
        raw2 = "+" + cc + digits(rng, 16 - cc.length);
        why = "too long";
      }
    } else if (style2 === "letters") {
      raw2 = ten.slice(0, 4) + rng.pick(["a", "x", "#", "*", "\uD83D\uDE00", "O"]) + ten.slice(4);
      why = "only digits";
    } else if (style2 === "empty") {
      raw2 = Array.from({ length: rng.int(0, 10) }, () => rng.pick([" ", "+", "-", "(", ")", "."])).join("");
      why = "no number";
    } else {
      const first = rng.pick(["2", "3", "4", "5", "6", "7", "8"]), body = first + digits(rng, rng.int(10, 13));
      raw2 = body;
      ok = true;
      digitsW = body;
    }
    const r = cleanPhone(raw2);
    if (ok) {
      c.ck("P-05", r.ok === true && r.digits === digitsW && r.last10 === digitsW.slice(-10), { raw: raw2, r });
      if (r.ok) {
        c.ck("P-05", keptFromClean(r.digits) === (r.digits.length === 12 && r.digits.startsWith("91") ? r.digits : "+" + r.digits), { raw: raw2 });
        c.ck("P-05", maskedPhone(r.digits) === "******" + r.digits.slice(-4) && phoneDigits(keptFromClean(r.digits)) === r.digits, "mask");
      }
    } else {
      c.ck("P-05", r.ok === false && String(r.why).toLowerCase().includes(why), { raw: raw2, r, why });
      if (!r.ok)
        c.ck("P-05", /^[A-Z].*[.]$/.test(r.why), r.why);
    }
    if (style2 === "indian" || style2 === "indian-0" || style2 === "indian-91") {
      for (const f of [ten, "0" + ten, "+91" + ten, "91" + ten, "0091" + ten, "+91 " + noisy(rng, ten).trim()]) {
        const q = cleanPhone(f);
        c.ck("P-05", q.ok === true && q.last10 === ten && q.digits === "91" + ten, f);
        c.ck("P-05", keptPhone(f) === "91" + ten, "kept " + f);
      }
    }
    return { k: "people-phone", raw: raw2, style: style2 };
  }
  if (part === "name") {
    const FIRST = ["Raj", "Priya", "Ananya", "Ravi", "Meera", "Aarav", "Chen", "Zo\xEB", "Jos\xE9", "Kavya", "Imran", "Sana", "Vikram", "Neha", "Arjun", "Divya", "Omar", "Lena", "Tara", "Yusuf"], LAST = ["Kumar", "Sharma", "O'Brien", "Wei", "Iyer", "Gupta", "Menon", "Silva", "Khan", "Patel", "Das", "Rao", "Nair", "Bose", "Singh", "Mehta", "Reddy", "Joshi", "Verma", "Shah"];
    const letter = () => String.fromCharCode(65 + rng.int(0, 25));
    const words = FIRST, junkLead = ["=", "+", "-", "@", " ", "=+-@ ", "  ", "\t", "= ", "@@"], ctl = ["\x00", "\x07", "\x1F", "\x7F", "\u200B", "\u200D", "\u200F", "\u2028", "\u2029", "\uFEFF", "\t", `
`];
    const nameStyle = wpick(rng, [["plain", 30], ["decorated", 35], ["long", 12], ["boundary-space", 8], ["boundary-emoji", 6], ["markup", 6], ["not-text", 3]]);
    d.nameStyle = nameStyle;
    let raw2 = "", want2 = null;
    if (nameStyle === "plain") {
      const parts = [rng.pick(words), rng.pick(LAST), ...rng.chance(0.6) ? [letter()] : [], ...rng.chance(0.3) ? [letter()] : []];
      raw2 = parts.join(" ");
      want2 = parts.join(" ");
    } else if (nameStyle === "decorated") {
      const parts = [rng.pick(["Raj", "Priya", "Ananya", "Meera", "Aarav", "Chen", "Kavya", "Imran", "Sana", "Vikram"]), rng.pick(["Kumar", "Sharma", "Wei", "Iyer", "Gupta", "Menon", "Silva", "Khan", "Patel", "Rao"]), ...rng.chance(0.5) ? [letter() + letter()] : []];
      let s = rng.pick(junkLead);
      parts.forEach((p, i) => {
        const k = rng.int(1, p.length - 1);
        s += (rng.chance(0.4) ? p.slice(0, k) + rng.pick(ctl) + p.slice(k) : p) + (i < parts.length - 1 ? " ".repeat(rng.int(1, 3)) : "");
      });
      raw2 = s + (rng.chance(0.3) ? "   " : "");
      want2 = parts.join(" ");
    } else if (nameStyle === "long")
      raw2 = Array.from({ length: rng.int(10, 25) }, () => rng.pick(["Alexander", "Bartholomew", "Christopher", "Dominique", "Evangeline"])).join(" ");
    else if (nameStyle === "boundary-space")
      raw2 = hexN(rng, 58) + "z" + " " + hexN(rng, 10);
    else if (nameStyle === "boundary-emoji")
      raw2 = hexN(rng, 58) + "z" + "\uD83D\uDE00" + hexN(rng, 6);
    else if (nameStyle === "markup")
      raw2 = "<b>" + rng.pick(words) + "</b> `x`";
    else
      raw2 = rng.pick([null, undefined, 5, {}, [], true]);
    const out = cleanName(raw2);
    c.ck("P-06", typeof out === "string", "text");
    if (typeof raw2 !== "string")
      c.ck("P-06", out === "", "not text gives empty");
    else {
      c.ck("P-06", !/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff<>`]/.test(out), { out });
      c.ck("P-06", out === "" || !/^[=+\-@\s]/.test(out), { out });
      c.ck("P-06", !/\s{2,}/.test(out) && !/[\t\n\r]/.test(out), { out });
      c.ck("P-06", out.length <= 60, { len: out.length });
      c.ck("P-10", !/\s$/.test(out), { out, len: out.length });
      c.ck("P-11", !lone(out), { len: out.length });
      c.ck(lone(out) ? "P-11" : /\s$/.test(out) ? "P-10" : "P-06", cleanName(out) === out, { out, again: cleanName(out) });
      if (want2 !== null && want2.length <= 60)
        c.ck("P-06", out === want2, { raw: raw2, out, want: want2 });
    }
    return { k: "people-name", raw: typeof raw2 === "string" ? raw2 : String(raw2), nameStyle };
  }
  const old = rng.chance(0.4), created = old ? rng.pick([Date.UTC(2026, 9, 1), 0, 1000]) : rng.pick([null, undefined, Date.UTC(2099, 0, 1), Date.UTC(2100, 0, 1)]);
  const style = wpick(rng, [["code", 40], ["separators", 20], ["lower", 10], ["fullwidth", 5], ["only-symbols", 6], ["blank", 6], ["too-long", 6], ["email", 7]]);
  d.idStyle = (old ? "old-game-" : "new-rule-") + style;
  const alnum = (n) => {
    let s = "";
    for (let i = 0;i < n; i++)
      s += "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[rng.int(0, 33)];
    return s;
  };
  let raw = "", wantNew = null, wantOld = null;
  if (style === "code") {
    const s = alnum(rng.int(1, 30));
    raw = s;
    wantNew = s;
    wantOld = s;
  } else if (style === "separators") {
    const a = alnum(rng.int(1, 6)), b = alnum(rng.int(1, 6)), sep = rng.pick(["-", "/", " ", ".", "_"]);
    raw = a + sep + b;
    wantNew = a + b;
    wantOld = sep === " " ? a + b : a + sep + b;
  } else if (style === "lower") {
    const s = alnum(rng.int(2, 12));
    raw = s.toLowerCase();
    wantNew = s;
    wantOld = s;
  } else if (style === "fullwidth") {
    const s = alnum(5);
    raw = Array.from(s).map((ch) => String.fromCharCode(ch.charCodeAt(0) + 65248)).join("");
    wantNew = s;
    wantOld = null;
  } else if (style === "only-symbols") {
    raw = Array.from({ length: rng.int(1, 12) }, () => rng.pick(["-", "/", ".", "#", "$", "%", "*", "_"])).join("");
    wantNew = null;
    wantOld = null;
  } else if (style === "blank") {
    raw = Array.from({ length: rng.int(0, 14) }, () => rng.pick([" ", " ", "\t"])).join("");
    wantNew = "";
    wantOld = "";
  } else if (style === "too-long") {
    raw = alnum(rng.int(31, 40));
    wantNew = null;
    wantOld = null;
  } else {
    raw = alnum(5).toLowerCase() + "@" + alnum(4).toLowerCase() + ".com";
    wantNew = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    wantOld = null;
  }
  const got = normEmp(raw, created), gotId = normId2(raw, "emp", created);
  const want = old ? wantOld : wantNew;
  c.ck("P-07", got === want, { raw, old, got, want });
  c.ck("P-07", gotId === (style === "email" ? null : want), { raw, old, gotId });
  c.ck("P-07", looksLikeEmail(raw) === (style === "email") && looksLikeEmail("a\uFF20b") === true && looksLikeEmail("AB12") === false, { raw });
  if (!old)
    c.ck("P-07", empClean(raw) === raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, ""), { raw });
  c.ck("P-07", EMP_CLEAN_FROM_MS === Date.UTC(2099, 0, 1), "flag date");
  return { k: "people-id", raw, created: created ?? null, style };
}
var SK1 = "11".repeat(32);
var SK2 = "22".repeat(32);
var FEID = "BGfixture";
var FIX = await (async () => {
  const out = [], add2 = (rule, label, ok) => {
    out.push([rule, label, ok]);
  };
  const pub1 = publicKeyFromSecret(SK1), pub2 = publicKeyFromSecret(SK2);
  const mk = (sk, seq, action, at, signed, until, eid = FEID) => signControlWithSecret(sk, { engagementId: eid, seq, action, atBeaconRound: at, signedAtRound: signed, ...until !== undefined ? { untilRound: until } : {} });
  const good = mk(SK1, 1, "pause", 1000, 900), cfg = { pubKey: pub1, maxPauseRounds: 600, leadRounds: 13 }, cfgHost = { ...cfg, hostKey: pub2 };
  add2("L-08", "a genuine message verifies", await verifyControlSig(pub1, good));
  add2("L-08", "another key does not verify it", !await verifyControlSig(pub2, good));
  for (const [k, v] of [["seq", { seq: 2 }], ["action", { action: "stop" }], ["at", { atBeaconRound: 1001 }], ["signed", { signedAtRound: 899 }], ["until", { untilRound: 1100 }], ["game", { engagementId: "BGother" }]])
    add2("L-08", "changed " + k + " does not verify", !await verifyControlSig(pub1, { ...good, ...v }));
  add2("L-08", "a flipped signature does not verify", !await verifyControlSig(pub1, { ...good, sig: (good.sig[0] === "a" ? "b" : "a") + good.sig.slice(1) }));
  add2("L-08", "a short signature does not verify", !await verifyControlSig(pub1, { ...good, sig: good.sig.slice(2) }));
  add2("L-08", "a non-hex signature does not verify", !await verifyControlSig(pub1, { ...good, sig: "zz".repeat(64) }));
  add2("L-08", "a bad key does not verify", !await verifyControlSig("zz", good) && !await verifyControlSig("ab".repeat(16), good));
  const sigs = good.sig;
  add2("L-08", "signing again gives the same signature", mk(SK1, 1, "pause", 1000, 900).sig === sigs);
  add2("L-09", "the organizer's key signs", await signerOf(cfg, good) === "organizer");
  add2("L-09", "a stranger's key is nobody", await signerOf(cfg, mk(SK2, 1, "pause", 1000, 900)) === null);
  add2("L-09", "a Host key is not believed while Host keys are off", HOST_KEY_ENABLED === false && await signerOf(cfgHost, mk(SK2, 1, "pause", 1000, 900)) === null && await signerOf(cfgHost, mk(SK2, 2, "resume", 1100, 1000)) === null && await signerOf(cfgHost, mk(SK2, 3, "stop", 1100, 1000)) === null);
  const L5 = [1, 2, 3, 4, 5].map((s) => mk(SK1, s, s % 2 ? "pause" : "resume", 1000 + s * 100, 900 + s * 100 - 20)), seqs = (a) => a.map((x) => x.seq).join(",");
  const r1 = await acceptLogDetailed(cfg, FEID, [L5[3], L5[1], L5[0], L5[4], L5[2], L5[1]]);
  add2("L-10", "all genuine, any order, one repeated", seqs(r1.log) === "1,2,3,4,5" && r1.forged === 0);
  const r2 = await acceptLogDetailed(cfg, FEID, [L5[0], L5[1], mk(SK2, 3, "pause", 1300, 1200), L5[3], L5[4]]);
  add2("L-10", "a forged message stops the log at the gap", seqs(r2.log) === "1,2" && r2.forged === 1);
  const r3 = await acceptLogDetailed(cfg, FEID, [L5[0], L5[1], L5[3], L5[4]]);
  add2("L-10", "a withheld message stops the log at the gap", seqs(r3.log) === "1,2" && r3.forged === 0);
  const r4 = await acceptLogDetailed(cfg, FEID, [...L5, mk(SK1, 6, "pause", 2000, 1900, undefined, "BGother")]);
  add2("L-10", "another game's message is dropped", seqs(r4.log) === "1,2,3,4,5" && r4.forged === 1);
  const r5 = await acceptLogDetailed(cfg, FEID, [L5[0], L5[1], mk(SK1, 2, "stop", 1200, 1000)]);
  add2("L-10", "a second genuine message under a used number is not believed", seqs(r5.log) === "1,2" && r5.forged === 1 && r5.log[1].sig === L5[1].sig);
  const r6 = await acceptLogDetailed(cfg, FEID, [L5[2]], [L5[0], L5[1]]);
  add2("L-10", "a known log is extended", seqs(r6.log) === "1,2,3" && r6.forged === 0);
  const r7 = await acceptLogDetailed(cfg, FEID, "nonsense", [L5[0]]);
  add2("L-10", "a non-list changes nothing", seqs(r7.log) === "1" && r7.forged === 0);
  const r8 = await acceptLogDetailed(cfg, FEID, [L5[0], { ...L5[1], seq: 0 }, null, 7]);
  add2("L-10", "malformed entries are counted forged", seqs(r8.log) === "1" && r8.forged === 3);
  return out;
})();
var hexBytes = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
function kindSign(rng, c) {
  c.dims.sign = "real-ed25519";
  for (const [rule, label, ok] of FIX)
    c.ck(rule, ok, label);
  const sk = rng.hex(32), pub = publicKeyFromSecret(sk), eid = "BG" + rng.hex(4), at = rng.int(1000, 90000);
  const m = { engagementId: eid, seq: rng.int(1, 50), action: rng.pick(["pause", "resume", "extend", "stop"]), atBeaconRound: at, signedAtRound: at - rng.int(1, 40), ...rng.chance(0.5) ? { untilRound: at + rng.int(1, 500) } : {} };
  const signed = signControlWithSecret(sk, m);
  c.ck("L-08", /^[0-9a-f]{128}$/.test(signed.sig) && pub === Array.from(ed25519.getPublicKey(hexBytes(sk)), (b) => b.toString(16).padStart(2, "0")).join(""), "format");
  c.ck("L-08", ed25519.verify(hexBytes(signed.sig), canonicalBytes(m), hexBytes(pub)) === true, "verifies");
  c.ck("L-08", ed25519.verify(hexBytes(signed.sig), canonicalBytes({ ...m, atBeaconRound: at + 1 }), hexBytes(pub)) === false && ed25519.verify(hexBytes(signed.sig), canonicalBytes({ ...m, seq: m.seq + 1 }), hexBytes(pub)) === false, "changed message");
  c.ck("L-08", ed25519.verify(hexBytes(signed.sig), canonicalBytes(m), hexBytes(publicKeyFromSecret(rng.hex(32)))) === false, "another key");
  c.ck("L-08", signControlWithSecret(sk, m).sig === signed.sig, "deterministic");
  const st = resolveControl({ pubKey: pub, maxPauseRounds: 600, leadRounds: 13 }, [signed]), ref = refControl(13, 600, [{ seq: m.seq, action: m.action, at: m.atBeaconRound, signedAt: m.signedAtRound, ..."untilRound" in m ? { until: m.untilRound } : {} }]);
  c.ck("L-01", st.applied === ref.applied && js(st.ignored.map((x) => x.seq)) === js(ref.ignored.map((x) => x.seq)), "applied");
  return { k: "sign", eid, m };
}

// games/bingo/scenario.ts
var meta = {
  game: "bingo",
  sha: "4d636fa",
  dimensions: {
    kind: ["control", "ties", "config", "people", "settle-light", "settle-heavy", "cards", "lucky", "time", "sign"],
    pause: ["none", "open", "timed", "resumed", "extended", "multiple"],
    stop: ["none", "during-pause", "before-start", "mid-game", "after-end"],
    slip: ["none", "short-lead", "backdated", "exact-lead", "bad-until", "max-until"],
    hold: ["none", "junk", "many", "apart", "inside-pause", "encloses-pause", "adjacent", "overlap"],
    breaks: [0, 1, 2, 3],
    rounds: [1, 2, 3, 4, 5],
    stride: [2, 3, 4, 5, 6, 8, 10],
    safety: ["fast", "standard", "lean30", "lean60"],
    maxPause: [60, 200, 600, 1200, 3000],
    refused: ["none", "1", "2-3", "4+"],
    luckyBreak: ["yes", "no"],
    players: ["3-8", "9-20", "21-40", "41+"],
    tickets: [1, 2],
    gameRound: ["r1", "r2+"],
    gameRounds: [1, 2, 3, 4, 5],
    houses: ["1", "2-4", "5-8", "9-10"],
    late: ["none", "some", "many", "all", "boundary"],
    tie: ["none", "2-way", "3-way", "4+-way"],
    tieSplit: ["no", "lines-run-out"],
    linesFilled: ["all", "some", "none"],
    log: ["full", "partial", "stopped"],
    schedule: ["plain", "breaks", "paused", "stopped"],
    engines: "open",
    claims: ["none", "all-true", "some-wrong", "all-wrong", "mixed"],
    ids: ["seat", "plain"],
    rewardSet: ["default", "one", "few", "many", "all"],
    craft: ["yes", "no"],
    mode: ["single-round", "multi-round", "open", "open-with-invites", "employees-only", "one-room"],
    tieHouse: ["line", "twolines", "corners", "plus", "x", "frame", "stamp", "letterL", "letterT", "blackout"],
    tieLines: [1, 2, 3],
    tieGroups: [1, 2, 3, 4],
    cfgMode: ["valid", "invalid", "tables"],
    cfgOutcome: ["kept", "refused", "refused:two-breaks-same-number", "tables"],
    cfgTickets: [1, 2],
    cfgRounds: [1, 2, 3, 4, 5],
    cfg_rewards: ["default", "one", "few", "many", "all"],
    cfg_breaks: ["auto", "set", "lucky"],
    cfg_brand: ["yes"],
    cfg_opening: ["yes"],
    cfg_closing: ["yes"],
    cfg_invites: ["on", "off"],
    cfg_employeesOnly: ["yes"],
    cfg_verify: ["mobile", "id", "either", "both"],
    cfgBad: "open",
    cardsFrom: ["seat-ids", "plain-ids", "fresh-seat", "fresh-big-seat", "fresh-plain"],
    numbers: ["random", "zeros", "same", "upper", "short", "empty"],
    luckyPick: [1, 3, 5, 10],
    luckyList: ["1-4", "5-12", "13-60", "61+"],
    luckyShort: ["enough", "fewer-than-winners"],
    timeKind: ["clock", "erase", "zones"],
    peopleKind: ["links", "approvals", "phone", "name", "employee-id"],
    role: ["organizer", "host", "co-host", "guest", "family"],
    approvalRules: ["off", "on"],
    phone: "open",
    nameStyle: ["plain", "decorated", "long", "boundary-space", "boundary-emoji", "markup", "not-text"],
    idStyle: "open",
    sign: ["real-ed25519"]
  },
  rules: RULES
};
var KINDS2 = [["control", 29], ["ties", 11], ["config", 21], ["people", 31], ["settle-light", 3.5], ["cards", 1.5], ["settle-heavy", 1], ["lucky", 1.2], ["time", 4]];
function run(seed, trace) {
  const rng = new Rng(seed), c = newCtx(seed, trace);
  const kind = seed % 1e4 === 4242 ? "sign" : wpick(rng, KINDS2);
  let params;
  switch (kind) {
    case "control":
      params = kindControl(rng, c);
      break;
    case "ties":
      params = kindTies(rng, c);
      break;
    case "config":
      params = kindConfig(rng, c);
      break;
    case "people":
      params = kindPeople(rng, c);
      break;
    case "settle-light":
      params = kindSettle(rng, c, false);
      break;
    case "settle-heavy":
      params = kindSettle(rng, c, true);
      break;
    case "cards":
      params = kindCards(rng, c);
      break;
    case "lucky":
      params = kindLucky(rng, c);
      break;
    case "time":
      params = kindTime(rng, c);
      break;
    default:
      params = kindSign(rng, c);
  }
  c.dims.kind = kind;
  if (kind.startsWith("settle"))
    c.dims.mode = c.dims.gameRounds > 1 ? "multi-round" : "single-round";
  if (c.more > 0)
    c.fails.push({ rule: c.fails[c.fails.length - 1].rule, sentence: "(and " + c.more + " more failed checks in this scenario)", detail: c.more });
  return { params: { kind, seed: undefined, p: params }, dims: c.dims, checks: c.checks, fails: c.fails };
}

// games/bingo/main.ts
main(meta, run);
