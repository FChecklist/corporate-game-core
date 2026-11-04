// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

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

// games/tictactoe/sha.ts
import { drainMicrotasks } from "bun:jsc";
import { createHash } from "crypto";
var K = new Int32Array([
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
var W = new Int32Array(64);
var scratch = new Uint8Array(4096);
function sha256Bytes(data) {
  const len = data.length;
  const total = len + 9 + 63 >> 6 << 6;
  if (total > scratch.length)
    scratch = new Uint8Array(total);
  const buf = scratch;
  buf.fill(0, 0, total);
  buf.set(data, 0);
  buf[len] = 128;
  const hi = Math.floor(len / 536870912), lo = len << 3 >>> 0;
  buf[total - 8] = hi >>> 24;
  buf[total - 7] = hi >>> 16 & 255;
  buf[total - 6] = hi >>> 8 & 255;
  buf[total - 5] = hi & 255;
  buf[total - 4] = lo >>> 24;
  buf[total - 3] = lo >>> 16 & 255;
  buf[total - 2] = lo >>> 8 & 255;
  buf[total - 1] = lo & 255;
  let h0 = 1779033703 | 0, h1 = 3144134277 | 0, h2 = 1013904242 | 0, h3 = 2773480762 | 0, h4 = 1359893119 | 0, h5 = 2600822924 | 0, h6 = 528734635 | 0, h7 = 1541459225 | 0;
  for (let off = 0;off < total; off += 64) {
    for (let i = 0;i < 16; i++) {
      const j = off + (i << 2);
      W[i] = buf[j] << 24 | buf[j + 1] << 16 | buf[j + 2] << 8 | buf[j + 3];
    }
    for (let i = 16;i < 64; i++) {
      const a2 = W[i - 15], b2 = W[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0;i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + W[i] | 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
    h4 = h4 + e | 0;
    h5 = h5 + f | 0;
    h6 = h6 + g | 0;
    h7 = h7 + h | 0;
  }
  const out = new Uint8Array(32);
  const hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0;i < 8; i++) {
    const v = hs[i];
    out[i * 4] = v >>> 24;
    out[i * 4 + 1] = v >>> 16 & 255;
    out[i * 4 + 2] = v >>> 8 & 255;
    out[i * 4 + 3] = v & 255;
  }
  return out;
}
var HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
var hexOf = (b) => {
  let s = "";
  for (let i = 0;i < b.length; i++)
    s += HEX[b[i]];
  return s;
};
var te = new TextEncoder;
var installed = false;
function installShim() {
  if (installed)
    return;
  for (let len = 0;len < 200; len += 3) {
    const u = new Uint8Array(len);
    for (let i = 0;i < len; i++)
      u[i] = i * 31 + len * 7 & 255;
    if (hexOf(sha256Bytes(u)) !== createHash("sha256").update(u).digest("hex"))
      throw new Error("sync sha256 shim disagrees with node:crypto at length " + len);
  }
  const sub = crypto.subtle;
  const real = sub.digest.bind(crypto.subtle);
  const digest = (alg, data) => {
    const name = typeof alg === "string" ? alg : alg?.name;
    if (String(name).toUpperCase() !== "SHA-256")
      return real(alg, data);
    const u8 = data instanceof Uint8Array ? data : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    return Promise.resolve(sha256Bytes(u8).buffer);
  };
  Object.defineProperty(sub, "digest", { value: digest, configurable: true, writable: true });
  Object.defineProperty(sub, "importKey", { value: () => Promise.reject(new Error("Ed25519 is not available through WebCrypto here (shim): use the bundled implementation")), configurable: true, writable: true });
  installed = true;
}
function sync(p) {
  drainMicrotasks();
  const st = Bun.peek.status(p);
  if (st === "fulfilled")
    return Bun.peek(p);
  if (st === "rejected")
    throw Bun.peek(p);
  throw new Error("scenario did not finish synchronously (a promise is still pending)");
}

// games/tictactoe/oracle.ts
var te2 = new TextEncoder;
var H = (s) => hexOf(sha256Bytes(te2.encode(s)));
function streamO(seed, label, count) {
  const out = [];
  for (let block = 0;out.length < count; block++) {
    const h = sha256Bytes(te2.encode(`${seed}|${label}|${block}`));
    for (let i = 0;i + 4 <= 32 && out.length < count; i += 4)
      out.push((h[i] << 24 | h[i + 1] << 16 | h[i + 2] << 8 | h[i + 3]) >>> 0);
  }
  return out;
}
var coinO = (seed, label) => (streamO(seed, label, 1)[0] & 1) === 1;
function belowO(seed, label, n) {
  const limit = Math.floor(4294967296 / n) * n;
  for (let k = 0;; k++) {
    const v = streamO(seed, `${label}#${k}`, 1)[0];
    if (v < limit)
      return v % n;
  }
}
function shuffledO(seed, label, items) {
  const a = [...items];
  const r = streamO(seed, label, Math.max(1, a.length));
  for (let i = a.length - 1;i > 0; i--) {
    const j = Math.floor(r[i] / 4294967296 * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
var fateO = (seed, mid, j, pid) => H(`${seed}|TTT-FATE|${mid}|${j}|${pid}`);
var WINS = [7, 56, 448, 73, 146, 292, 273, 84];
var FULL = 511;
var hasLine = (m) => {
  for (let i = 0;i < 8; i++)
    if ((m & WINS[i]) === WINS[i])
      return true;
  return false;
};
var pop = (m) => {
  let n = 0;
  while (m) {
    n += m & 1;
    m >>= 1;
  }
  return n;
};
var outcomeCode = (xm, om) => hasLine(xm) ? 1 : hasLine(om) ? 2 : (xm | om) === FULL ? 3 : 0;
var masksOf = (cells) => {
  let x = 0, o = 0;
  for (let i = 0;i < 9; i++) {
    if (cells[i] === 1)
      x |= 1 << i;
    else if (cells[i] === 2)
      o |= 1 << i;
  }
  return [x, o];
};
var MM = new Int8Array(1 << 18).fill(127);
function mmValue(xm, om) {
  const idx = xm | om << 9;
  const c = MM[idx];
  if (c !== 127)
    return c;
  let v;
  if (hasLine(xm))
    v = 1;
  else if (hasLine(om))
    v = -1;
  else if ((xm | om) === FULL)
    v = 0;
  else {
    const xTurn = pop(xm) === pop(om);
    v = xTurn ? -2 : 2;
    for (let c2 = 0;c2 < 9; c2++) {
      if ((xm | om) >> c2 & 1)
        continue;
      const w = xTurn ? mmValue(xm | 1 << c2, om) : mmValue(xm, om | 1 << c2);
      v = xTurn ? Math.max(v, w) : Math.min(v, w);
    }
  }
  MM[idx] = v;
  return v;
}
function optimalCells(xm, om) {
  const xTurn = pop(xm) === pop(om);
  const out = [];
  let best = xTurn ? -2 : 2;
  for (let c = 0;c < 9; c++) {
    if ((xm | om) >> c & 1)
      continue;
    const w = xTurn ? mmValue(xm | 1 << c, om) : mmValue(xm, om | 1 << c);
    if (xTurn ? w > best : w < best) {
      best = w;
      out.length = 0;
      out.push(c);
    } else if (w === best)
      out.push(c);
  }
  return out;
}
var ENUM = null;
function enumO() {
  if (ENUM)
    return ENUM;
  const e = { games: 0, x: 0, o: 0, d: 0, byPly: Array(10).fill(0), nodes: 0 };
  const go = (xm, om, ply) => {
    e.nodes++;
    const oc = outcomeCode(xm, om);
    if (oc) {
      e.games++;
      e.byPly[ply] = (e.byPly[ply] ?? 0) + 1;
      if (oc === 1)
        e.x++;
      else if (oc === 2)
        e.o++;
      else
        e.d++;
      return;
    }
    const xTurn = (ply & 1) === 0;
    for (let c = 0;c < 9; c++) {
      if ((xm | om) >> c & 1)
        continue;
      if (xTurn)
        go(xm | 1 << c, om, ply + 1);
      else
        go(xm, om | 1 << c, ply + 1);
    }
  };
  go(0, 0, 0);
  ENUM = e;
  return e;
}
function oStart(c, mid, B, no, startAt) {
  let aHasX;
  if (no === 1)
    aHasX = coinO(c.seed, `first|${mid}|${B.j}`);
  else if (no === 2)
    aHasX = B.games[0].x !== B.a;
  else
    aHasX = coinO(c.seed, `third|${mid}|${B.j}`);
  return { no, x: aHasX ? B.a : B.b, o: aHasX ? B.b : B.a, xm: 0, om: 0, moves: [], deadline: startAt + (no === 1 ? c.readyMs : c.moveMs), missed: {} };
}
function oNew(c, mid, j, a, b, startAt) {
  const B = { j, a, b, games: [], done: false, pts: { [a]: 0, [b]: 0 } };
  B.games.push(oStart(c, mid, B, 1, startAt));
  return B;
}
var oLast = (B) => B.games[B.games.length - 1];
var oMover = (g) => g.moves.length % 2 === 0 ? g.x : g.o;
function oFinish(c, mid, B, g, kind, winner, at) {
  g.res = { kind, ...winner !== undefined ? { winner } : {}, at };
  if (kind !== "draw") {
    B.pts[winner] = (B.pts[winner] ?? 0) + 2;
    B.done = true;
    B.winner = winner;
    B.via = kind === "win" ? "win" : "forfeit";
    return;
  }
  B.pts[g.x] = (B.pts[g.x] ?? 0) + 1;
  B.pts[g.o] = (B.pts[g.o] ?? 0) + 1;
  if (B.games.length < 3) {
    B.games.push(oStart(c, mid, B, B.games.length + 1, at));
    return;
  }
  const fa = fateO(c.seed, mid, B.j, B.a), fb = fateO(c.seed, mid, B.j, B.b);
  B.done = true;
  B.winner = fa < fb ? B.a : B.b;
  B.via = "fate";
}
function oPlace(c, mid, B, g, pid, cell, at, auto) {
  const isX = g.x === pid;
  if (isX)
    g.xm |= 1 << cell;
  else
    g.om |= 1 << cell;
  g.moves.push({ pid, cell, at, auto });
  g.deadline = at + c.moveMs;
  const mine = isX ? g.xm : g.om;
  if (hasLine(mine))
    oFinish(c, mid, B, g, "win", pid, at);
  else if ((g.xm | g.om) === FULL)
    oFinish(c, mid, B, g, "draw", undefined, at);
}
function oAdvance(c, mid, B, now) {
  while (!B.done && now > oLast(B).deadline) {
    const g = oLast(B);
    const who = oMover(g);
    const at = g.deadline;
    g.missed[who] = (g.missed[who] ?? 0) + 1;
    if (g.missed[who] >= 2) {
      oFinish(c, mid, B, g, "forfeit", who === B.a ? B.b : B.a, at);
      break;
    }
    const e = [];
    for (let i = 0;i < 9; i++)
      if (!((g.xm | g.om) >> i & 1))
        e.push(i);
    const cell = e[belowO(c.seed, `auto|${mid}|${B.j}|${g.no}|${g.moves.length}`, e.length)];
    oPlace(c, mid, B, g, who, cell, at, true);
  }
}
function oMove(c, mid, B, pid, cell, now, ply) {
  if (pid !== B.a && pid !== B.b)
    return { ok: false, causes: ["not-in-board"] };
  oAdvance(c, mid, B, now);
  if (B.done)
    return { ok: false, causes: ["match-over"] };
  const g = oLast(B);
  const causes = [];
  if (ply !== undefined && ply !== g.moves.length)
    causes.push("stale");
  if (oMover(g) !== pid)
    causes.push("not-your-turn");
  const valid = typeof cell === "number" && Number.isInteger(cell) && cell >= 0 && cell <= 8;
  if (!valid)
    causes.push("bad-square");
  else if ((g.xm | g.om) >> cell & 1)
    causes.push("square-taken");
  if (causes.length)
    return { ok: false, causes };
  g.missed[pid] = 0;
  oPlace(c, mid, B, g, pid, cell, now, false);
  return { ok: true };
}
function oShift(B, ms) {
  if (!B.done)
    oLast(B).deadline += ms;
}
var maskStr = (xm, om) => {
  let s = "";
  for (let i = 0;i < 9; i++)
    s += xm >> i & 1 ? "1" : om >> i & 1 ? "2" : "0";
  return s;
};
function sigO(B) {
  let s = `${B.done ? 1 : 0}|${B.winner ?? ""}|${B.via ?? ""}|${B.pts[B.a] ?? 0},${B.pts[B.b] ?? 0}`;
  for (const g of B.games)
    s += `;${g.no},${g.x},${g.o},${maskStr(g.xm, g.om)},${g.deadline},${g.missed[B.a] ?? 0},${g.missed[B.b] ?? 0},${g.res ? g.res.kind + (g.res.winner ?? "") + "@" + g.res.at : ""},${g.moves.map((m) => `${m.pid}:${m.cell}@${m.at}${m.auto ? "*" : ""}`).join(" ")}`;
  return s;
}
function sigE(b) {
  let s = `${b.done ? 1 : 0}|${b.winner ?? ""}|${b.via ?? ""}|${b.points[b.a] ?? 0},${b.points[b.b] ?? 0}`;
  for (const g of b.games)
    s += `;${g.no},${g.x},${g.o},${g.cells.join("")},${g.deadline},${g.missed[b.a] ?? 0},${g.missed[b.b] ?? 0},${g.result ? g.result.kind + (g.result.winner ?? "") + "@" + g.result.at : ""},${g.moves.map((m) => `${m.pid}:${m.cell}@${m.at}${m.auto ? "*" : ""}`).join(" ")}`;
  return s;
}
function oReplay(c, mid, eb, startAt) {
  const B = oNew(c, mid, eb.j, eb.a, eb.b, startAt);
  for (let gi = 0;gi < eb.games.length; gi++) {
    const g = eb.games[gi];
    if (B.games.length <= gi)
      return { B, err: `game ${gi + 1} exists in the record but the replay ended earlier` };
    for (const m of g.moves) {
      if (m.auto) {
        oAdvance(c, mid, B, m.at + 1);
        const last = B.games[gi];
        const lm = last.moves[last.moves.length - 1];
        if (!lm || !lm.auto || lm.pid !== m.pid || lm.cell !== m.cell || lm.at !== m.at)
          return { B, err: `the recorded clock-out move ${m.pid}:${m.cell}@${m.at} is not what the rules play` };
      } else {
        oAdvance(c, mid, B, m.at);
        const r = oMove(c, mid, B, m.pid, m.cell, m.at);
        if (!r.ok)
          return { B, err: `the recorded move ${m.pid}:${m.cell}@${m.at} is refused by the rules (${r.causes.join("/")})` };
      }
    }
  }
  const lg = eb.games[eb.games.length - 1];
  if (lg?.result?.kind === "forfeit")
    oAdvance(c, mid, B, lg.result.at + 1);
  return { B, err: null };
}
var nextPow2 = (n) => {
  let p = 1;
  while (p < n)
    p *= 2;
  return p;
};
function oBracket(seed, pids, format, teamSize) {
  const sorted = [...new Set(pids)].sort();
  const seated = shuffledO(seed, "roster", sorted);
  const entrants = [];
  const reserve = [];
  if (format === "solo")
    for (const id of seated)
      entrants.push({ id, members: [id] });
  else {
    const teams = Math.floor(seated.length / teamSize);
    for (let t = 0;t < teams; t++)
      entrants.push({ id: `team${t + 1}`, members: seated.slice(t * teamSize, (t + 1) * teamSize) });
    reserve.push(...seated.slice(teams * teamSize));
  }
  const size = nextPow2(entrants.length);
  const rounds = Math.round(Math.log2(size));
  const r1 = [];
  if (rounds > 0) {
    const order = shuffledO(seed, "bracket", entrants.map((e) => e.id));
    const half = size / 2;
    const slots = Array(size).fill(null);
    for (let i = 0;i < order.length; i++) {
      if (i < half)
        slots[2 * i] = order[i];
      else
        slots[2 * (i - half) + 1] = order[i];
    }
    for (let i = 0;i < half; i++)
      r1.push({ a: slots[2 * i] ?? null, b: slots[2 * i + 1] ?? null });
  }
  return { entrants, reserve, size, rounds, r1 };
}
function oRank(seed, entrants, matches, rounds, champion) {
  const rows = [];
  for (const e of entrants) {
    const mine = new Set(e.members);
    let points = 0, lastRound = 0, lastPts = 0, lostIn = 0;
    for (const m of matches) {
      if (m.bye || m.a === null || m.b === null)
        continue;
      if (m.a !== e.id && m.b !== e.id)
        continue;
      let p = 0;
      for (const b of m.boards) {
        if (mine.has(b.a))
          p += b.points[b.a] ?? 0;
        if (mine.has(b.b))
          p += b.points[b.b] ?? 0;
      }
      points += p;
      if (m.round >= lastRound) {
        lastRound = m.round;
        lastPts = p;
      }
      if (m.winner !== e.id)
        lostIn = m.round;
    }
    rows.push({ id: e.id, roundReached: champion === e.id ? rounds + 1 : lostIn, points, lastMatchPoints: lastPts, fate: H(`${seed}|TTT-RANK|${e.id}`) });
  }
  rows.sort((x, y) => y.roundReached - x.roundReached || y.points - x.points || y.lastMatchPoints - x.lastMatchPoints || (x.fate < y.fate ? -1 : 1));
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const decidedBy = !prev ? "" : prev.roundReached !== r.roundReached ? "round reached" : prev.points !== r.points ? "total points" : prev.lastMatchPoints !== r.lastMatchPoints ? "points in the last match" : "fate";
    return { ...r, rank: i + 1, decidedBy };
  });
}
var rosterHashO = (pids) => H(`TTT-ROSTER|${[...pids].sort().join(",")}`);
var commitO = (secret) => H(`TTT-COMMIT|${secret}`);
var seedO = (secret, eid, pids, beacon = "") => H(`TTT-SEED|${secret}|${eid}|${rosterHashO(pids)}|${beacon}`);
function effO(pauses, wall) {
  let eff = wall;
  for (const [f, t] of pauses) {
    const end = t === null ? wall : Math.min(t, wall);
    if (end > f)
      eff -= end - f;
  }
  return eff;
}

// games/tictactoe/ctx.ts
var C = {
  checks: 0,
  fails: [],
  tracing: false,
  lines: null,
  rules: {},
  params: {},
  dims: {}
};
function reset(trace, rules) {
  C.checks = 0;
  C.fails = [];
  C.params = {};
  C.dims = {};
  C.rules = rules;
  C.tracing = !!trace && trace.length >= 1;
  C.lines = C.tracing ? trace : null;
}
function ck(ok, rule, detail) {
  C.checks++;
  if (!ok && C.fails.length < 12)
    C.fails.push({ rule, sentence: C.rules[rule] ?? rule, detail: detail ? detail() : undefined });
  return ok;
}
function T(f) {
  if (C.tracing)
    C.lines(f());
}
var STRATS = [["random", 26], ["greedy", 24], ["perfect", 16], ["blunder", 8], ["absent", 10]];
var PROFS = [["fast", 35], ["normal", 40], ["slow", 15], ["late", 10]];
function thinkMs(p, win, rng) {
  switch (p) {
    case "fast":
      return rng.int(50, Math.min(1500, Math.max(51, Math.floor(win * 0.9))));
    case "normal":
      return rng.int(200, Math.max(201, Math.floor(win * 0.9)));
    case "slow":
      return rng.chance(0.5) ? rng.int(Math.floor(win * 0.6), Math.floor(win * 0.98)) : rng.int(200, Math.max(201, Math.floor(win * 0.9)));
    default:
      return rng.chance(0.3) ? win + rng.int(1, win) : rng.int(200, Math.max(201, Math.floor(win * 0.9)));
  }
}
function chooseCell(strat, cells, mark, rng) {
  const [xm, om] = masksOf(cells);
  const used = xm | om;
  const mine = mark === 1 ? xm : om, theirs = mark === 1 ? om : xm;
  const empt = [];
  for (let i = 0;i < 9; i++)
    if (!(used >> i & 1))
      empt.push(i);
  if (!empt.length)
    return 4;
  switch (strat) {
    case "perfect":
      return rng.pick(optimalCells(xm, om));
    case "blunder": {
      let worst = mark === 1 ? 2 : -2;
      let out = [];
      for (const c of empt) {
        const v = mark === 1 ? mmValue(xm | 1 << c, om) : mmValue(xm, om | 1 << c);
        if (mark === 1 ? v < worst : v > worst) {
          worst = v;
          out = [c];
        } else if (v === worst)
          out.push(c);
      }
      return rng.pick(out);
    }
    case "greedy": {
      for (const c of empt)
        if (hasLine(mine | 1 << c))
          return c;
      for (const c of empt)
        if (hasLine(theirs | 1 << c))
          return c;
      if (!(used >> 4 & 1) && rng.chance(0.8))
        return 4;
      return rng.pick(empt);
    }
    default:
      return rng.pick(empt);
  }
}
var pidOf = (style, n) => style === 0 ? `p${String(n).padStart(4, "0")}` : style === 1 ? `s${n.toString(16).padStart(6, "0")}` : `Zo\xEB-${n}`;
var bucket = (n) => n <= 2 ? "2" : n <= 4 ? "3-4" : n <= 8 ? "5-8" : n <= 16 ? "9-16" : "17+";

// src-tictactoe-4e40c2b/packages/ttt/src/classic.ts
var LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];
var emptyCells = () => Array(9).fill(0);
var emptiesOf = (cells) => {
  const o = [];
  for (let i = 0;i < 9; i++)
    if (cells[i] === 0)
      o.push(i);
  return o;
};
function outcomeOf(cells) {
  for (const l of LINES) {
    const m = cells[l[0]];
    if (m !== 0 && m === cells[l[1]] && m === cells[l[2]])
      return { kind: "win", mark: m, line: [...l] };
  }
  return emptiesOf(cells).length === 0 ? { kind: "draw" } : { kind: "playing" };
}
function place(cells, cell, mark) {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8)
    throw new Error("That square is not on the board.");
  if (cells[cell] !== 0)
    throw new Error("That square is taken.");
  const n = [...cells];
  n[cell] = mark;
  return n;
}
var markToMove = (cells) => cells.filter((c) => c !== 0).length % 2 === 0 ? 1 : 2;
// src-tictactoe-4e40c2b/packages/ttt/src/hash.ts
var enc = new TextEncoder;
var hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
var sha256Hex = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

// src-tictactoe-4e40c2b/packages/ttt/src/random.ts
var enc2 = new TextEncoder;
async function stream(seed, label, count) {
  const out = [];
  for (let block = 0;out.length < count; block++) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc2.encode(`${seed}|${label}|${block}`)));
    for (let i = 0;i + 4 <= h.length && out.length < count; i += 4)
      out.push((h[i] << 24 | h[i + 1] << 16 | h[i + 2] << 8 | h[i + 3]) >>> 0);
  }
  return out;
}
async function coin(seed, label) {
  return ((await stream(seed, label, 1))[0] & 1) === 1;
}
async function below(seed, label, n) {
  const limit = Math.floor(4294967296 / n) * n;
  for (let k = 0;; k++) {
    const v = (await stream(seed, `${label}#${k}`, 1))[0];
    if (v < limit)
      return v % n;
  }
}
async function shuffled(seed, label, items) {
  const a = [...items];
  const r = await stream(seed, label, Math.max(1, a.length));
  for (let i = a.length - 1;i > 0; i--) {
    const j = Math.floor(r[i] % 4294967296 / 4294967296 * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// src-tictactoe-4e40c2b/packages/ttt/src/match.ts
var MAX_GAMES = 3;
var DEFAULT_MOVE_MS = 20000;
var DEFAULT_READY_MS = 30000;
var MISSED_LIMIT = 2;
var maxGames = (cfg) => cfg.maxGames ?? MAX_GAMES;
var last = (a) => a[a.length - 1];
var lastGame = (b) => last(b.games);
var moverOf = (g) => g.moves.length % 2 === 0 ? g.x : g.o;
var markOf = (g, pid) => g.x === pid ? 1 : 2;
var fateOf = (seed, mid, j, pid) => sha256Hex(`${seed}|TTT-FATE|${mid}|${j}|${pid}`);
async function xFor(cfg, mid, j, a, b, no, first) {
  let aHasX;
  if (no === 1)
    aHasX = await coin(cfg.seed, `first|${mid}|${j}`);
  else if (no === 2)
    aHasX = first !== a;
  else
    aHasX = await coin(cfg.seed, `third|${mid}|${j}`);
  return aHasX ? { x: a, o: b } : { x: b, o: a };
}
async function startGame(cfg, mid, b, no, startAt) {
  const { x, o } = await xFor(cfg, mid, b.j, b.a, b.b, no, b.games[0]?.x);
  return { no, x, o, cells: emptyCells(), moves: [], deadline: startAt + (no === 1 ? cfg.readyMs : cfg.moveMs), missed: {} };
}
async function newBoard(cfg, mid, j, a, b, startAt) {
  const board = { j, a, b, games: [], done: false, points: { [a]: 0, [b]: 0 } };
  board.games.push(await startGame(cfg, mid, board, 1, startAt));
  return board;
}
async function finishGame(cfg, mid, board, g, res) {
  g.result = res;
  if (res.kind === "win" || res.kind === "forfeit") {
    board.points[res.winner] = (board.points[res.winner] ?? 0) + 2;
    board.done = true;
    board.winner = res.winner;
    board.via = res.kind === "win" ? "win" : "forfeit";
    return;
  }
  board.points[g.x] = (board.points[g.x] ?? 0) + 1;
  board.points[g.o] = (board.points[g.o] ?? 0) + 1;
  if (board.games.length < maxGames(cfg)) {
    board.games.push(await startGame(cfg, mid, board, board.games.length + 1, res.at));
    return;
  }
  const [fa, fb] = await Promise.all([fateOf(cfg.seed, mid, board.j, board.a), fateOf(cfg.seed, mid, board.j, board.b)]);
  board.done = true;
  board.winner = fa < fb ? board.a : board.b;
  board.via = "fate";
}
async function settleMove(cfg, mid, board, g, at) {
  const o = outcomeOf(g.cells);
  if (o.kind === "win")
    await finishGame(cfg, mid, board, g, { kind: "win", winner: o.mark === 1 ? g.x : g.o, line: o.line, at });
  else if (o.kind === "draw")
    await finishGame(cfg, mid, board, g, { kind: "draw", at });
}
async function clockOut(cfg, mid, board, g) {
  const who = moverOf(g), at = g.deadline;
  g.missed[who] = (g.missed[who] ?? 0) + 1;
  if (g.missed[who] >= MISSED_LIMIT) {
    await finishGame(cfg, mid, board, g, { kind: "forfeit", winner: who === board.a ? board.b : board.a, at });
    return;
  }
  const e = emptiesOf(g.cells);
  const cell = e[await below(cfg.seed, `auto|${mid}|${board.j}|${g.no}|${g.moves.length}`, e.length)];
  g.moves.push({ ply: g.moves.length, pid: who, cell, at, auto: true });
  g.cells = place(g.cells, cell, markOf(g, who));
  g.deadline = at + cfg.moveMs;
  await settleMove(cfg, mid, board, g, at);
}
async function advanceBoard(cfg, mid, board, now) {
  while (!board.done && now > lastGame(board).deadline)
    await clockOut(cfg, mid, board, lastGame(board));
  return board;
}
async function applyMove(cfg, mid, board, pid, cell, now, ply) {
  if (pid !== board.a && pid !== board.b)
    return { ok: false, error: "not-in-board", board };
  await advanceBoard(cfg, mid, board, now);
  if (board.done)
    return { ok: false, error: "match-over", board };
  const g = lastGame(board);
  if (ply !== undefined && ply !== g.moves.length)
    return { ok: false, error: "stale", board };
  if (moverOf(g) !== pid)
    return { ok: false, error: "not-your-turn", board };
  if (!Number.isInteger(cell) || cell < 0 || cell > 8)
    return { ok: false, error: "bad-square", board };
  if (g.cells[cell] !== 0)
    return { ok: false, error: "square-taken", board };
  g.moves.push({ ply: g.moves.length, pid, cell, at: now });
  g.cells = place(g.cells, cell, markOf(g, pid));
  g.missed[pid] = 0;
  g.deadline = now + cfg.moveMs;
  await settleMove(cfg, mid, board, g, now);
  return { ok: true, board };
}
function shiftBoard(board, ms) {
  if (!board.done)
    lastGame(board).deadline += ms;
}
var doneAtOf = (b) => Math.max(0, ...b.games.map((g) => g.result?.at ?? 0));
function howBoardEnded(b, nameOf) {
  if (!b.done || !b.winner)
    return "";
  if (b.via === "fate")
    return `${nameOf(b.winner)} won by fate (all ${b.games.length} games were drawn; the lower fate number wins)`;
  if (b.via === "forfeit")
    return `${nameOf(b.winner)} won because the other player's clock ran out twice in a row`;
  const g = b.games.find((x) => x.result?.kind === "win");
  return `${nameOf(b.winner)} won with three in a row${b.games.length > 1 ? ` in game ${g.no} (earlier games were drawn)` : ""}`;
}
// src-tictactoe-4e40c2b/packages/ttt/src/bracket.ts
var MAX_PLAYERS = 1e4;
var TEAM_SIZES = [3, 5];
var midOf = (round, idx) => `r${round}m${idx}`;
var cfgOf = (t) => ({ seed: t.seed, moveMs: t.moveMs, readyMs: t.readyMs });
var nextPow22 = (n) => {
  let p = 1;
  while (p < n)
    p *= 2;
  return p;
};
function layout(order, size) {
  const slots = Array(size).fill(null);
  const half = size / 2;
  for (let i = 0;i < order.length; i++) {
    if (i < half || size === 1)
      slots[size === 1 ? 0 : 2 * i] = order[i];
    else
      slots[2 * (i - half) + 1] = order[i];
  }
  return slots;
}
async function startTournament(o) {
  const format = o.format ?? "solo", teamSize = format === "team" ? o.teamSize ?? 3 : 1;
  if (format === "team" && !TEAM_SIZES.includes(teamSize))
    throw new Error("A team has 3 or 5 players.");
  const ids = new Set;
  for (const p of o.players) {
    if (ids.has(p.pid))
      throw new Error("The same player is listed twice.");
    ids.add(p.pid);
  }
  if (o.players.length > MAX_PLAYERS)
    throw new Error("Too many players.");
  const names = {};
  for (const p of o.players)
    names[p.pid] = p.name;
  const sortedIds = [...ids].sort();
  const seated = await shuffled(o.seed, "roster", sortedIds);
  const entrants = [];
  const reserve = [];
  if (format === "solo")
    for (const id of seated)
      entrants.push({ id, name: names[id], members: [id] });
  else {
    const teams = Math.floor(seated.length / teamSize);
    for (let t2 = 0;t2 < teams; t2++) {
      const members = seated.slice(t2 * teamSize, (t2 + 1) * teamSize);
      entrants.push({ id: `team${t2 + 1}`, name: `Team ${t2 + 1}`, members });
    }
    reserve.push(...seated.slice(teams * teamSize));
  }
  if (entrants.length < 1)
    throw new Error(format === "team" ? "Not enough players for one team." : "At least one player is needed.");
  const size = nextPow22(entrants.length), rounds = Math.log2(size);
  const t = {
    v: 1,
    eid: o.eid,
    format,
    teamSize,
    moveMs: o.moveMs ?? DEFAULT_MOVE_MS,
    readyMs: o.readyMs ?? DEFAULT_READY_MS,
    seed: o.seed,
    entrants,
    reserve,
    size,
    rounds,
    startAt: o.startAt,
    matches: {},
    done: false,
    names
  };
  for (let r = 1;r <= rounds; r++)
    for (let i = 0;i < size / 2 ** r; i++)
      t.matches[midOf(r, i)] = { mid: midOf(r, i), round: r, idx: i, a: null, b: null, boards: [], status: "waiting" };
  if (rounds === 0) {
    t.done = true;
    t.champion = entrants[0].id;
    return t;
  }
  const order = await shuffled(o.seed, "bracket", entrants.map((e) => e.id));
  const slots = layout(order, size);
  for (let i = 0;i < size / 2; i++) {
    const m = t.matches[midOf(1, i)];
    m.a = slots[2 * i] ?? null;
    m.b = slots[2 * i + 1] ?? null;
  }
  await settle(t, o.startAt);
  return t;
}
var entrantOf = (t, id) => t.entrants.find((e) => e.id === id);
var nameOfEntrant = (t, id) => id ? entrantOf(t, id).name : "-";
var ctxOf = (t) => ({ cfg: cfgOf(t), rounds: t.rounds, size: t.size, startAt: t.startAt, entrant: (id) => entrantOf(t, id) });
async function openMatchP(c, m, at) {
  const A = c.entrant(m.a), B = c.entrant(m.b);
  m.status = "live";
  m.startedAt = at;
  m.boards = [];
  for (let j = 0;j < A.members.length; j++)
    m.boards.push(await newBoard(c.cfg, m.mid, j, A.members[j], B.members[j], at));
}
function makeBye(c, m) {
  m.status = "done";
  m.bye = true;
  m.winner = m.a ?? m.b;
  m.doneAt = c.startAt;
}
function finalizeMatchP(c, m) {
  if (m.status !== "live" || !m.boards.every((b) => b.done))
    return false;
  const A = c.entrant(m.a), k = m.boards.length;
  const winsA = m.boards.filter((b) => b.winner === A.members[b.j]).length;
  m.winner = winsA * 2 > k ? m.a : m.b;
  m.loser = m.winner === m.a ? m.b : m.a;
  m.status = "done";
  m.doneAt = Math.max(...m.boards.map(doneAtOf));
  return true;
}
var parentOf = (c, m) => m.round >= c.rounds ? null : { mid: midOf(m.round + 1, m.idx >> 1), side: m.idx % 2 === 0 ? "a" : "b" };
var feedersOf = (m) => m.round <= 1 ? null : [midOf(m.round - 1, 2 * m.idx), midOf(m.round - 1, 2 * m.idx + 1)];
async function openMatch(t, m, at) {
  await openMatchP(ctxOf(t), m, at);
}
async function settle(t, now) {
  const c = ctxOf(t);
  for (let changed = true;changed; ) {
    changed = false;
    for (let r = 1;r <= t.rounds; r++) {
      for (let i = 0;i < t.size / 2 ** r; i++) {
        const m = t.matches[midOf(r, i)];
        if (m.status === "waiting" && m.a && m.b) {
          await openMatch(t, m, Math.max(t.startAt, t.matches[midOf(r - 1, 2 * i)]?.doneAt ?? 0, t.matches[midOf(r - 1, 2 * i + 1)]?.doneAt ?? 0));
          changed = true;
        } else if (m.status === "waiting" && r === 1 && (m.a || m.b)) {
          makeBye(c, m);
          changed = true;
        }
        if (finalizeMatchP(c, m))
          changed = true;
        if (m.status === "done") {
          const p = parentOf(c, m);
          if (p) {
            const pm = t.matches[p.mid];
            if (pm[p.side] !== m.winner) {
              pm[p.side] = m.winner;
              changed = true;
            }
          }
        }
      }
    }
    const fin = t.matches[midOf(t.rounds, 0)];
    if (fin && fin.status === "done" && !t.done) {
      t.done = true;
      t.champion = fin.winner;
      changed = true;
    }
  }
}
async function advanceTournament(t, now) {
  if (t.done)
    return t;
  for (let again = true;again && !t.done; ) {
    again = false;
    for (const m of Object.values(t.matches))
      if (m.status === "live") {
        for (const b of m.boards)
          if (!b.done)
            await advanceBoard(cfgOf(t), m.mid, b, now);
      }
    const before = Object.values(t.matches).filter((m) => m.status === "done").length;
    await settle(t, now);
    if (Object.values(t.matches).filter((m) => m.status === "done").length !== before)
      again = true;
  }
  return t;
}
function boardOf(t, pid) {
  for (const m of Object.values(t.matches))
    if (m.status === "live") {
      for (const b of m.boards)
        if (!b.done && (b.a === pid || b.b === pid))
          return { match: m, board: b };
    }
  return null;
}
async function moveInTournament(t, pid, cell, now, ply) {
  await advanceTournament(t, now);
  const f = boardOf(t, pid);
  if (!f)
    return { ok: false, error: "no-live-board" };
  const r = await applyMove(cfgOf(t), f.match.mid, f.board, pid, cell, now, ply);
  await advanceTournament(t, now);
  return r;
}
function shiftTournament(t, ms) {
  for (const m of Object.values(t.matches))
    if (m.status === "live")
      for (const b of m.boards)
        shiftBoard(b, ms);
}
var roundName = (t, round) => round === t.rounds ? "Final" : round === t.rounds - 1 ? "Semi-final" : round === t.rounds - 2 ? "Quarter-final" : `Round ${round}`;
async function rankings(t) {
  const rows = [];
  for (const e of t.entrants) {
    let points = 0, lastRound = 0, lastPts = 0, reached = 1;
    const mine = new Set(e.members);
    for (const m of Object.values(t.matches)) {
      if (m.bye || m.status === "waiting") {
        if (m.bye && m.winner === e.id)
          reached = Math.max(reached, m.round);
        continue;
      }
      if (m.a !== e.id && m.b !== e.id)
        continue;
      let p = 0;
      for (const b of m.boards) {
        if (mine.has(b.a))
          p += b.points[b.a] ?? 0;
        if (mine.has(b.b))
          p += b.points[b.b] ?? 0;
      }
      points += p;
      if (m.round >= lastRound) {
        lastRound = m.round;
        lastPts = p;
      }
      reached = Math.max(reached, m.round);
    }
    const out = Object.values(t.matches).find((m) => m.status === "done" && !m.bye && m.loser === e.id);
    const roundReached = t.champion === e.id ? t.rounds + 1 : out ? out.round : reached;
    rows.push({ id: e.id, name: e.name, roundReached, points, lastMatchPoints: lastPts, fate: await sha256Hex(`${t.seed}|TTT-RANK|${e.id}`) });
  }
  rows.sort((x, y) => y.roundReached - x.roundReached || y.points - x.points || y.lastMatchPoints - x.lastMatchPoints || (x.fate < y.fate ? -1 : 1));
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const decidedBy = !prev ? "" : prev.roundReached !== r.roundReached ? "round reached" : prev.points !== r.points ? "total points" : prev.lastMatchPoints !== r.lastMatchPoints ? "points in the last match" : "fate";
    return { ...r, rank: i + 1, decidedBy };
  });
}
var tieLine = (r, prevName) => !r.decidedBy || r.decidedBy === "round reached" ? "" : `${prevName} and ${r.name} were level on ${r.decidedBy === "total points" ? "round reached" : r.decidedBy === "points in the last match" ? "round reached and total points" : "round reached, total points and points in the last match"}; separated by ${r.decidedBy}.`;
function publicView(t) {
  const nm = (id) => t.names[id] ?? id;
  const matches = Object.values(t.matches).sort((x, y) => x.round - y.round || x.idx - y.idx).map((m) => ({
    mid: m.mid,
    round: m.round,
    roundName: roundName(t, m.round),
    a: nameOfEntrant(t, m.a),
    b: nameOfEntrant(t, m.b),
    status: m.status,
    bye: !!m.bye,
    winner: m.winner ? nameOfEntrant(t, m.winner) : null,
    boards: m.boards.map((b) => {
      const g = b.games[b.games.length - 1];
      return { j: b.j, a: b.a, b: b.b, aName: nm(b.a), bName: nm(b.b), cells: [...g.cells], gameNo: g.no, games: b.games.length, turn: b.done ? null : g.moves.length % 2 === 0 ? g.x : g.o, deadline: b.done ? null : g.deadline, done: b.done, winnerName: b.winner ? nm(b.winner) : null, how: howBoardEnded(b, nm) };
    })
  }));
  return { eid: t.eid, format: t.format, teamSize: t.teamSize, players: Object.keys(t.names).length, entrants: t.entrants.length, reserve: t.reserve.length, rounds: t.rounds, done: t.done, champion: t.champion ? nameOfEntrant(t, t.champion) : null, matches };
}
// src-tictactoe-4e40c2b/packages/ttt/src/seal.ts
var newSecret = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};
var commitOf = (secret) => sha256Hex(`TTT-COMMIT|${secret}`);
var rosterHash = (pids) => sha256Hex(`TTT-ROSTER|${[...pids].sort().join(",")}`);
var seedOf = async (secret, eid, pids, beacon = "") => sha256Hex(`TTT-SEED|${secret}|${eid}|${await rosterHash(pids)}|${beacon}`);
var verifyReveal = async (secret, commit) => await commitOf(secret) === commit;
// src-tictactoe-4e40c2b/packages/ttt/src/phone.ts
var ABSENT = -1;
var ENDED_MESSAGE = "The organizer ended the tournament. Thank you for playing.";
function effOf(pauses, wall) {
  let cut = 0;
  for (const [f, t] of pauses)
    if (wall > f)
      cut += Math.min(wall, t ?? Infinity) - f;
  return wall - cut;
}
var wallOf = (pauses, eff) => eff + pauses.reduce((s, [f, t]) => s + (t === null ? 0 : t - f), 0);
var ents = (t) => new Map(t.entrants.map((e) => [e.id, e]));
async function planOf(s) {
  if (!s.seed || !s.roster || !s.opts)
    throw new Error("The tournament has not started.");
  const t = await startTournament({ eid: s.eid, seed: s.seed, players: s.roster, format: s.opts.format, teamSize: s.opts.teamSize, moveMs: s.opts.moveMs, readyMs: s.opts.readyMs, startAt: s.startedMs ?? 0 });
  const entOfPid = new Map, r1 = new Map;
  for (const e of t.entrants)
    for (const m of e.members)
      entOfPid.set(m, e.id);
  for (const m of Object.values(t.matches))
    if (m.round === 1) {
      if (m.a)
        r1.set(m.a, m.mid);
      if (m.b)
        r1.set(m.b, m.mid);
    }
  const pairs = Object.values(t.matches).filter((m) => m.round === 1).sort((x, y) => x.idx - y.idx).map((m) => `${m.mid}:${m.a ?? "-"}:${m.b ?? "-"}`).join(",");
  const names = {};
  for (const p of s.roster)
    names[p.pid] = p.name;
  return { t, opts: s.opts, entOfPid, r1, digest: await sha256Hex(`TTT-PLAN|${s.eid}|${t.rounds}|${pairs}`), names, E: ents(t) };
}
function planPayload(p) {
  const matches = Object.values(p.t.matches).filter((m) => m.round === 1).sort((x, y) => x.idx - y.idx).map((m) => ({
    mid: m.mid,
    round: 1,
    idx: m.idx,
    a: m.a,
    b: m.b,
    bye: !!m.bye,
    winner: m.bye ? m.winner : null,
    boards: m.bye ? [] : m.boards.map((b) => [b.a, b.b])
  }));
  return { rounds: p.t.rounds, size: p.t.size, entrants: p.t.entrants, digest: p.digest, matches };
}
var ctxAt = (p, startAt) => ({ ...ctxOf(p.t), startAt, entrant: (id) => p.E.get(id) });
function force(b, winner) {
  if (b.done && b.winner === winner)
    return;
  if (!b.done)
    b.points[winner] = (b.points[winner] ?? 0) + 2;
  b.done = true;
  b.winner = winner;
  b.via = b.via ?? "forfeit";
}
async function replayMatch(p, startAt, m, rec, openedAt, pauses, nowEff) {
  const c = ctxAt(p, startAt);
  await openMatchP(c, m, openedAt);
  const due = m.boards.map(() => false);
  let doneAt = openedAt;
  for (const br of rec?.boards ?? []) {
    const b = m.boards[br.j];
    if (!b)
      continue;
    for (const e of [...br.events].sort((x, y) => x.seq - y.seq)) {
      if (b.done)
        break;
      const at = effOf(pauses, e.ms);
      if (e.sq === ABSENT)
        await advanceBoard(c.cfg, m.mid, b, at);
      else
        await applyMove(c.cfg, m.mid, b, e.pid, e.sq, at);
    }
    if (nowEff !== undefined && !b.done) {
      const probe = structuredClone(b);
      await advanceBoard(c.cfg, m.mid, probe, nowEff);
      due[br.j] = probe.done !== b.done || lastGame(probe).moves.length !== lastGame(b).moves.length || probe.games.length !== b.games.length;
    }
    if (br.result && !br.result.flag && br.result.winner) {
      force(b, br.result.winner);
      doneAt = Math.max(doneAt, effOf(pauses, br.result.ms));
    }
  }
  const complete = !!rec?.complete && m.boards.every((b) => b.done);
  if (complete) {
    finalizeMatchP(c, m);
    m.doneAt = doneAt;
  }
  return { m, complete, doneAt, due };
}
function boardView(b, names, pauses, paused, me) {
  const g = b.games[b.games.length - 1];
  const mover = b.done ? null : moverOf(g);
  const n = (id) => names[id] ?? "?";
  return {
    j: b.j,
    a: n(b.a),
    b: n(b.b),
    aName: n(b.a),
    bName: n(b.b),
    cells: [...g.cells],
    x: n(g.x),
    o: n(g.o),
    gameNo: g.no,
    games: b.games.length,
    turn: mover ? n(mover) : null,
    deadlineMs: b.done || paused ? null : wallOf(pauses, g.deadline),
    done: b.done,
    winner: b.winner ? n(b.winner) : null,
    via: b.via ?? null,
    ply: g.moves.length,
    lastAuto: g.moves.length ? !!g.moves[g.moves.length - 1].auto : false,
    ...me ? { yourMark: g.x === me ? "X" : g.o === me ? "O" : null, yourTurn: mover === me, youWon: b.done && b.winner === me } : {}
  };
}

class TttPhone {
  deps;
  setup = null;
  plan = null;
  skew = 0;
  planOk = null;
  last = null;
  counters = { gets: 0, posts: 0, replays: 0, claims: 0, results: 0, opens: 0, moves: 0 };
  done = new Map;
  reported = new Set;
  claimedAt = new Map;
  opened = new Set;
  cur = null;
  constructor(deps) {
    this.deps = deps;
  }
  get = async (path) => {
    this.counters.gets++;
    return this.deps.api("GET", `/api/z/${this.deps.eid}/ttt/${path}`);
  };
  post = async (path, body) => {
    this.counters.posts++;
    return this.deps.api("POST", `/api/z/${this.deps.eid}/ttt/${path}`, body);
  };
  id = () => ({ pid: this.deps.pid, device: this.deps.device });
  serverNow = () => this.deps.now() + this.skew;
  sync(t) {
    if (t?.serverNow)
      this.skew = t.serverNow - this.deps.now();
  }
  async loadSetup() {
    if (this.plan && this.setup)
      return this.setup;
    const s = await this.get("setup");
    this.sync(s);
    if ((s.state === "running" || s.state === "done") && s.seed) {
      if (!this.plan) {
        this.setup = s;
        this.plan = await planOf(s);
        this.planOk = !s.planDigest || s.planDigest === this.plan.digest;
        if (!this.planOk)
          await this.post("flag", { ...this.id(), kind: "plan", note: "The bracket I computed is not the one the Organizer's page stored." }).catch(() => {});
      }
      this.setup = s;
    } else
      this.setup = s;
    return s;
  }
  async tick() {
    const s = await this.loadSetup();
    const base = { serverNow: this.serverNow(), state: s.state, commit: s.commit, paused: false };
    if (s.state === "open" || s.state === "starting")
      return this.last = { ...base, phase: "waiting", joined: s.joined ?? 0, message: s.state === "open" ? "You are in. Waiting for the host to start." : "The host has started the game. Getting the draw ready." };
    const p = this.plan;
    const me = this.deps.pid;
    const name = p.names[me];
    if (s.state === "done" && s.endedEarly)
      return this.last = { ...base, phase: "ended", message: ENDED_MESSAGE };
    if (!name)
      return this.last = { ...base, phase: "watching", message: "The list closed before you joined. You can watch." };
    const ent = p.entOfPid.get(me);
    if (!ent)
      return this.last = { ...base, phase: "reserve", you: name, message: "There were not enough players for a full team for you. You can watch the games." };
    const v = await this.walk(ent);
    if (this.setup?.state === "done" && this.setup.endedEarly)
      return this.last = { ...base, state: "done", phase: "ended", message: ENDED_MESSAGE };
    return this.last = { ...base, ...v };
  }
  async fetchMatch(mid) {
    const r = await this.get(`m/${mid}`);
    this.sync(r.t);
    if (r.t)
      this.setup = { ...this.setup, state: r.t.state, endedEarly: r.t.endedEarly, pauses: r.t.pauses };
    return r;
  }
  pausesNow = () => this.setup?.pauses ?? [];
  isPaused = () => this.pausesNow().some(([, t]) => t === null);
  async walk(ent) {
    const E = this.plan.E;
    const p = this.plan, s = this.setup, me = this.deps.pid, t = p.t, startAt = s.startedMs ?? 0, pr = this.pausesNow();
    const roundWords = (r) => roundName(t, r);
    let mid = p.r1.get(ent);
    let side = null;
    let openedAt = startAt;
    for (let guard = 0;guard < 40; guard++) {
      const base = structuredClone(t.matches[mid]);
      if (side) {
        base.a = side.a;
        base.b = side.b;
      }
      let rep = this.done.get(mid) ?? null;
      let rec = null;
      if (base.bye)
        rep = rep ?? { m: Object.assign(base, { status: "done", doneAt: startAt }), complete: true, doneAt: startAt, due: [] };
      else if (!rep) {
        rec = await this.fetchMatch(mid);
        if (!rec.reg && base.round > 1 && !this.opened.has(mid)) {
          const fs2 = feedersOf(base);
          const A = E.get(base.a), B = E.get(base.b);
          const boards = A.members.map((x, j) => [x, B.members[j]]);
          if (boards.some(([x, y]) => x === me || y === me)) {
            this.counters.opens++;
            try {
              await this.post("open", { ...this.id(), mid, round: base.round, idx: base.idx, a: base.a, b: base.b, boards, from: fs2, opened: Math.round(openedAt) });
              this.opened.add(mid);
              rec = await this.fetchMatch(mid);
            } catch (e) {
              if (e?.status !== 409)
                throw e;
            }
          }
        }
        if (rec.reg && base.round > 1 && (rec.reg.a !== base.a || rec.reg.b !== base.b) && !this.opened.has("x" + mid)) {
          this.opened.add("x" + mid);
          await this.post("flag", { ...this.id(), kind: "pairing", mid, note: "The pairing stored for this match is not the one the results give." }).catch(() => {});
        }
        this.counters.replays++;
        const nowEff = effOf(pr, this.serverNow());
        rep = await replayMatch(p, startAt, base, rec, openedAt, pr, this.isPaused() ? undefined : nowEff);
        if (rep.complete)
          this.done.set(mid, rep);
      }
      const m = rep.m;
      if (!rep.complete)
        return this.playingView(m, rec, rep, E, roundWords);
      const lost = m.loser === ent && !m.bye;
      const par = parentOf(ctxAt(p, startAt), m);
      if (lost)
        return this.outView(m, ent, roundWords);
      if (!par)
        return this.championView(ent);
      const fs = feedersOf({ round: m.round + 1, idx: m.idx >> 1 });
      const sibMid = fs[0] === m.mid ? fs[1] : fs[0];
      let sib = this.done.get(sibMid) ?? null;
      if (!sib) {
        const sb = structuredClone(t.matches[sibMid]);
        if (sb.bye) {
          sib = { m: Object.assign(sb, { status: "done", doneAt: startAt }), complete: true, doneAt: startAt, due: [] };
          this.done.set(sibMid, sib);
        } else if (sb.round === 1) {
          const sr = await this.fetchMatch(sibMid);
          sib = await replayMatch(p, startAt, sb, sr, startAt, pr);
          if (sib.complete)
            this.done.set(sibMid, sib);
        } else {
          sib = await this.resolveUpper(sibMid, E);
        }
      }
      if (!sib || !sib.complete)
        return { phase: "next", you: p.names[me], message: m.bye ? "You have a free pass this round. Waiting for your opponent." : "You won. Waiting for your next opponent." };
      const sa = par.side === "a" ? m.winner : sib.m.winner, sbb = par.side === "a" ? sib.m.winner : m.winner;
      side = { a: sa, b: sbb };
      openedAt = Math.max(startAt, m.doneAt ?? 0, sib.m.doneAt ?? 0);
      mid = par.mid;
    }
    return { phase: "next", you: p.names[me], message: "Waiting for your next opponent." };
  }
  async resolveUpper(mid, E) {
    const p = this.plan, startAt = this.setup.startedMs ?? 0, pr = this.pausesNow();
    const cached = this.done.get(mid);
    if (cached)
      return cached;
    const base = structuredClone(p.t.matches[mid]);
    const fs = feedersOf(base);
    if (!fs)
      return null;
    const rs = [];
    for (const f of fs) {
      let r2 = this.done.get(f) ?? null;
      if (!r2) {
        const fb = structuredClone(p.t.matches[f]);
        if (fb.bye)
          r2 = { m: Object.assign(fb, { status: "done", doneAt: startAt }), complete: true, doneAt: startAt, due: [] };
        else if (fb.round === 1)
          r2 = await replayMatch(p, startAt, fb, await this.fetchMatch(f), startAt, pr);
        else
          r2 = await this.resolveUpper(f, E);
        if (r2?.complete)
          this.done.set(f, r2);
      }
      if (!r2 || !r2.complete)
        return null;
      rs.push(r2);
    }
    base.a = rs[0].m.winner;
    base.b = rs[1].m.winner;
    const rec = await this.fetchMatch(mid);
    const r = await replayMatch(p, startAt, base, rec, Math.max(startAt, rs[0].m.doneAt ?? 0, rs[1].m.doneAt ?? 0), pr);
    if (r.complete)
      this.done.set(mid, r);
    return r;
  }
  async playingView(m, rec, rep, E, roundWords) {
    const p = this.plan, me = this.deps.pid, pr = this.pausesNow(), paused = this.isPaused();
    const mine = m.boards.find((b) => b.a === me || b.b === me) ?? null;
    this.cur = null;
    if (mine && rec) {
      const br = rec.boards[mine.j];
      const nextSeq = br.events.length;
      if (!paused && rep.due[mine.j] && !mine.done && this.claimedAt.get(`${m.mid}:${mine.j}`) !== nextSeq) {
        this.claimedAt.set(`${m.mid}:${mine.j}`, nextSeq);
        this.counters.claims++;
        try {
          await this.post("move", { ...this.id(), mid: m.mid, seq: nextSeq, absent: true, client_ms: Math.round(this.serverNow()) });
        } catch (e) {
          if (e?.status !== 409)
            throw e;
        }
        return this.refresh(m.mid);
      }
      const key = `${m.mid}:${mine.j}`;
      if (mine.done && mine.winner && !br.result && !this.reported.has(key) && !br.reports.some((r) => r.pid === me)) {
        this.reported.add(key);
        this.counters.results++;
        try {
          await this.post("result", { ...this.id(), mid: m.mid, winner: mine.winner });
        } catch (e) {
          if (e?.status !== 409)
            throw e;
        }
      }
      const g = lastGame(mine);
      this.cur = { mid: m.mid, j: mine.j, seq: nextSeq, mine: true, yourTurn: !mine.done && moverOf(g) === me, ply: g.moves.length };
    }
    const names = p.names;
    const bv = (b, withMe) => boardView(b, names, pr, paused, withMe);
    const A = E.get(m.a), B = E.get(m.b);
    const myEnt = A.members.includes(me) ? A : B;
    const oppEnt = myEnt === A ? B : A;
    const flagged = rec?.boards.some((b) => b.result?.flag) ?? false;
    return {
      phase: "playing",
      you: names[me],
      round: m.round,
      roundName: roundWords(m.round),
      team: myEnt.name,
      vs: oppEnt.name,
      paused,
      ...flagged ? { flagged: true } : {},
      board: mine ? bv(mine, me) : null,
      boards: m.boards.map((b) => bv(b))
    };
  }
  async refresh(mid) {
    return this.tick();
  }
  rankAt = 0;
  ranked = [];
  async rankOnce() {
    if (this.ranked.length)
      return this.ranked;
    const now = this.deps.now();
    if (now - this.rankAt < 1e4 && this.rankAt)
      return [];
    this.rankAt = now;
    try {
      const r = await this.get("rank?n=10");
      if (r.done) {
        this.ranked = r.ranking;
        if (this.setup)
          this.setup = { ...this.setup, state: "done" };
      }
      return this.ranked;
    } catch {
      return [];
    }
  }
  async outView(m, ent, roundWords) {
    await this.finishIfFinal(m);
    const ranking = await this.rankOnce();
    const done = this.setup?.state === "done";
    return { phase: "out", you: this.plan.names[this.deps.pid], roundName: roundWords(m.round), message: done ? "The tournament is over." : "You are out. You can watch the rest.", place: ranking.find((r) => r.id === ent)?.rank ?? null, ranking };
  }
  async championView(ent) {
    const fin = this.plan.t.matches[midOf(this.plan.t.rounds, 0)];
    await this.finishIfFinal(fin);
    const ranking = await this.rankOnce();
    return { phase: "champion", you: this.plan.names[this.deps.pid], message: "You won the tournament.", ranking };
  }
  finished = false;
  async finishIfFinal(m) {
    if (this.finished || m.round !== this.plan.t.rounds || this.setup?.state === "done")
      return;
    this.finished = true;
    try {
      const t = await replayAll(this.setup, this.plan, async (r, pg) => (await this.get(`all?round=${r}&page=${pg}`)).matches);
      await this.post("finish", { ...this.id(), ...await finishPayload(t) });
    } catch {
      this.finished = false;
    }
  }
  async play(cell) {
    const c = this.cur;
    if (!c || !c.yourTurn)
      return { ok: false, error: "not-your-turn" };
    this.counters.moves++;
    try {
      await this.post("move", { ...this.id(), mid: c.mid, seq: c.seq, sq: cell, client_ms: this.deps.now() });
      c.yourTurn = false;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.code ?? "refused" };
    }
  }
  get myBoard() {
    return this.cur;
  }
}
async function replayAll(setup, plan, fetchRound) {
  const t = structuredClone(plan.t);
  const startAt = setup.startedMs ?? 0, pr = setup.pauses;
  const recs = new Map;
  for (let r = 1;r <= t.rounds; r++)
    for (let pg = 0;; pg++) {
      const rows = await fetchRound(r, pg);
      for (const x of rows)
        recs.set(x.mid, x);
      if (rows.length < 100)
        break;
    }
  for (let r = 1;r <= t.rounds; r++)
    for (let i = 0;i < t.size / 2 ** r; i++) {
      const mid = midOf(r, i);
      const m = t.matches[mid];
      if (r > 1) {
        const fs = feedersOf(m);
        const f0 = t.matches[fs[0]], f1 = t.matches[fs[1]];
        if (f0.status !== "done" || f1.status !== "done")
          continue;
        m.a = f0.winner;
        m.b = f1.winner;
      }
      if (m.bye) {
        m.status = "done";
        m.doneAt = startAt;
        continue;
      }
      if (!m.a || !m.b)
        continue;
      const opened = r === 1 ? startAt : Math.max(startAt, t.matches[feedersOf(m)[0]].doneAt ?? 0, t.matches[feedersOf(m)[1]].doneAt ?? 0);
      const rep = await replayMatch(plan, startAt, m, recs.get(mid) ?? null, opened, pr);
      t.matches[mid] = rep.m;
    }
  const fin = t.matches[midOf(t.rounds, 0)];
  if (fin?.status === "done") {
    t.done = true;
    t.champion = fin.winner;
  }
  return t;
}
async function finishPayload(t) {
  const rk = await rankings(t);
  const E = ents(t);
  return {
    champion: t.champion,
    rounds: t.rounds,
    finalMid: midOf(t.rounds, 0),
    podium: rk.slice(0, 5).map((r) => E.get(r.id)?.members ?? [r.id]),
    ranking: rk.slice(0, 100).map((r, i) => ({ rank: r.rank, id: r.id, name: r.name, roundReached: r.roundReached, points: r.points, decidedBy: r.decidedBy, tie: i ? tieLine(r, rk[i - 1].name) : "" }))
  };
}

class TttConsole {
  api;
  eid;
  opts;
  planSent = false;
  finishSent = false;
  full = null;
  setup = null;
  n = 0;
  reported = new Set;
  constructor(api, eid, opts = {}) {
    this.api = api;
    this.eid = eid;
    this.opts = opts;
  }
  get = (path) => this.api("GET", `/api/z/${this.eid}/ttt/${path}`);
  post = (path, body) => this.api("POST", `/api/z/${this.eid}/ttt/${path}`, body);
  async tick() {
    const v = await this.get("view");
    const state = v.state;
    this.n++;
    if (state === "starting" && !this.planSent) {
      const s = await this.get("setup");
      const plan = await planOf({ ...s, startedMs: s.serverNow });
      const pl = planPayload(plan);
      for (let i = 0;i < pl.matches.length || i === 0; i += 400) {
        const last2 = i + 400 >= pl.matches.length;
        await this.post("plan", { matches: pl.matches.slice(i, i + 400), ...i === 0 ? { entrants: pl.entrants } : {}, ...last2 ? { last: true, rounds: pl.rounds, size: pl.size, digest: pl.digest, entrantCount: pl.entrants.length } : {} });
      }
      this.planSent = true;
      return { state: "running", sentPlan: true };
    }
    if (state !== "running")
      return { state };
    const out = { state };
    if (!v.paused && this.n % (this.opts.watchEvery ?? 6) === 0) {
      const opened = await this.register();
      Object.assign(out, await this.watch(), { opened });
    }
    const rounds = v.rounds ?? 0;
    if (rounds && !this.finishSent && (v.perRound ?? []).some((x) => x.round === rounds && x.status === "done")) {
      const { plan, setup } = await this.loaded();
      const t = await replayAll(setup, plan, async (r, pg) => (await this.get(`all?round=${r}&page=${pg}`)).matches);
      await this.post("finish", await finishPayload(t));
      this.finishSent = true;
      return { ...out, state: "done", finished: true };
    }
    return out;
  }
  async loaded() {
    if (!this.full) {
      this.setup = await this.get("setup");
      this.full = await planOf(this.setup);
    }
    return { plan: this.full, setup: this.setup };
  }
  async register() {
    const { plan, setup } = await this.loaded();
    const t = plan.t, startAt = setup.startedMs ?? 0;
    let opens = 0;
    const briefs = new Map;
    let pr = setup.pauses;
    for (let r = 1;r <= t.rounds; r++)
      for (let pg = 0;; pg++) {
        const x = await this.get(`brief?round=${r}&page=${pg}`);
        pr = x.pauses ?? pr;
        for (const m of x.matches)
          briefs.set(m.mid, m);
        if (x.matches.length < 300)
          break;
      }
    const E = plan.E;
    const won = new Map;
    for (let r = 1;r <= t.rounds; r++)
      for (let i = 0;i < t.size / 2 ** r; i++) {
        const mid = midOf(r, i);
        const tm = t.matches[mid];
        if (r === 1 && tm.bye) {
          won.set(mid, { winner: tm.winner, doneAt: startAt });
          continue;
        }
        if (r > 1) {
          const fs = feedersOf(tm);
          const w0 = won.get(fs[0]), w1 = won.get(fs[1]);
          if (w0 && w1 && !briefs.has(mid)) {
            const A2 = E.get(w0.winner), B = E.get(w1.winner);
            const opened = Math.max(startAt, w0.doneAt, w1.doneAt);
            try {
              await this.post("open", { mid, round: r, idx: i, a: A2.id, b: B.id, boards: A2.members.map((x, j) => [x, B.members[j]]), from: fs, opened: Math.round(opened) });
              opens++;
            } catch {}
            continue;
          }
        }
        const b = briefs.get(mid);
        if (!b || !b.complete || b.a === null || b.b === null)
          continue;
        const A = E.get(b.a);
        const wins = b.boards.filter((x) => x.winner === A.members[x.j]).length;
        const doneAt = Math.max(b.opened ?? startAt, ...b.boards.map((x) => effOf(pr, x.ms ?? 0)));
        won.set(mid, { winner: wins * 2 > b.boards.length ? b.a : b.b, doneAt });
      }
    return opens;
  }
  async watch() {
    let claims = 0, reports = 0;
    for (let pg = 0;; pg++) {
      const r = await this.get(`stuck?ms=${this.opts.stuckMs ?? 90000}&page=${pg}`);
      const recs = r.matches;
      if (!recs.length)
        break;
      const { plan, setup } = await this.loaded();
      const startAt = setup.startedMs ?? 0, pr = r.pauses ?? setup.pauses;
      for (const rec0 of recs) {
        if (!rec0.reg || rec0.reg.bye)
          continue;
        let rec = rec0;
        for (let pass = 0;pass < 2; pass++) {
          const base = structuredClone(plan.t.matches[rec.mid]);
          base.a = rec.reg.a;
          base.b = rec.reg.b;
          const rep = await replayMatch(plan, startAt, base, rec, rec.reg.opened ?? startAt, pr, effOf(pr, r.serverNow));
          let claimed = false;
          for (const b of rep.m.boards) {
            const br = rec.boards[b.j];
            if (br.result)
              continue;
            if (!b.done && rep.due[b.j]) {
              try {
                await this.post("move", { mid: rec.mid, j: b.j, seq: br.events.length, absent: true });
                claims++;
                claimed = true;
              } catch {}
            } else if (b.done && b.winner && !this.reported.has(`${rec.mid}:${b.j}`)) {
              this.reported.add(`${rec.mid}:${b.j}`);
              try {
                await this.post("result", { mid: rec.mid, j: b.j, winner: b.winner });
                reports++;
              } catch {}
            }
          }
          if (!claimed)
            break;
          rec = { ...await this.get(`m/${rec.mid}`) };
        }
      }
      if (recs.length < 200)
        break;
    }
    return { claims, reports };
  }
  flags = () => this.get("flags");
  async waiting(ms = 300000, max = 20) {
    const r = await this.get(`stuck?ms=${ms}`);
    const { plan } = await this.loaded();
    const out = [];
    for (const rec of r.matches)
      for (const br of rec.boards)
        if (!br.result && out.length < max)
          out.push({ mid: rec.mid, j: br.j, a: { pid: br.a, name: plan.names[br.a] ?? "?" }, b: { pid: br.b, name: plan.names[br.b] ?? "?" } });
    return out;
  }
  async disputed() {
    const f = await this.flags();
    const { plan } = await this.loaded();
    const out = [];
    for (const d of f.disputed) {
      const rec = await this.get(`m/${d.mid}`);
      const br = rec.boards[d.j];
      if (br)
        out.push({ mid: d.mid, j: d.j, a: { pid: br.a, name: plan.names[br.a] ?? "?" }, b: { pid: br.b, name: plan.names[br.b] ?? "?" } });
    }
    return out;
  }
}
// src-tictactoe-4e40c2b/vendor/game-core/packages/core/src/roles.ts
var ROLES = ["organizer", "host", "cohost", "participant", "family"];
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
// src-tictactoe-4e40c2b/vendor/game-core/packages/core/src/ids.ts
var exports_ids = {};
__export(exports_ids, {
  normId: () => normId,
  normEmp: () => normEmp,
  normEmail: () => normEmail,
  looksLikeEmail: () => looksLikeEmail,
  empBadMessage: () => empBadMessage,
  cleanEmpId: () => cleanEmpId,
  EMP_TOO_LONG: () => EMP_TOO_LONG,
  EMP_MAX: () => EMP_MAX,
  EMP_LOOKS_LIKE_EMAIL: () => EMP_LOOKS_LIKE_EMAIL,
  EMP_BAD: () => EMP_BAD
});
var EMP_MAX = 30;
var cleanEmpId = (raw) => String(raw ?? "").normalize("NFKC").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
var normEmail = (raw) => String(raw ?? "").normalize("NFKC").replace(/[\s\u200b-\u200d\u2060\ufeff\u0085\u2028\u2029]/g, "").toLowerCase();
var looksLikeEmail = (raw) => String(raw ?? "").normalize("NFKC").includes("@");
var EMP_BAD = "An employee ID has letters and numbers only. The system ignores spaces, dashes and symbols, and the ID may be up to 30 characters once cleaned.";
var EMP_LOOKS_LIKE_EMAIL = "This looks like an Email ID. This game asks for an employee ID: letters and numbers only.";
var EMP_TOO_LONG = "This ID is too long. An employee ID may be up to 30 characters once cleaned.";
function normEmp(raw) {
  if (String(raw ?? "").trim() === "")
    return "";
  if (looksLikeEmail(raw))
    return null;
  const s = cleanEmpId(raw);
  return s && s.length <= EMP_MAX ? s : null;
}
var empBadMessage = (raw) => looksLikeEmail(raw) ? EMP_LOOKS_LIKE_EMAIL : cleanEmpId(raw).length > EMP_MAX ? EMP_TOO_LONG : EMP_BAD;
var normId = (kind, raw) => kind === "email" ? normEmail(raw) || null : normEmp(raw) || null;

// src-tictactoe-4e40c2b/vendor/game-core/packages/core/src/people.ts
var MAX_HOSTS = 5;
var COHOST_LIST_DEFAULT = 100;
var COHOST_LIST_MIN = 10;
var COHOST_LIST_MAX = 1000;
var PEOPLE_ROWS = [
  { id: "addHost", label: "Add a Host", help: "A Host can run the game with you. Up to 5.", who: ["organizer"] },
  { id: "addCohost", label: "Add a Co-host", help: "A Co-host invites people with their own link.", who: ["organizer", "host"] }
];
var newTeam = () => ({ hosts: [], cohosts: [], log: [] });
var add = (t, by, kind, raw, role, now) => {
  const row = PEOPLE_ROWS.find((r) => r.id === (role === "host" ? "addHost" : "addCohost"));
  if (!row.who.includes(by))
    return { ok: false, why: role === "host" ? "Only the Organizer can add a Host." : "Only the Organizer or a Host can add a Co-host." };
  const id = normId(kind, raw);
  if (!id)
    return { ok: false, why: kind === "email" ? "That e-mail does not look right." : "That employee ID does not look right." };
  if ([...t.hosts, ...t.cohosts].some((h2) => h2.id === id))
    return { ok: false, why: "This person already has a role in this game." };
  if (role === "host" && t.hosts.length >= MAX_HOSTS)
    return { ok: false, why: `A game can have up to ${MAX_HOSTS} Hosts.` };
  const h = { id, role, keyApproved: false };
  return { ok: true, team: { ...t, [role === "host" ? "hosts" : "cohosts"]: [...role === "host" ? t.hosts : t.cohosts, h], log: logChange(t.log, by, `${role === "host" ? "Host" : "Co-host"} added`, now) } };
};
var addHost = (t, by, kind, raw, now) => add(t, by, kind, raw, "host", now);
var addCohost = (t, by, kind, raw, now) => add(t, by, kind, raw, "cohost", now);
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
// src-tictactoe-4e40c2b/vendor/game-core/packages/core/src/modes.ts
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
var shouldStart = (mode, publishedAt, now, pressedBy) => mode === "auto" ? now >= publishedAt : pressedBy !== null && canControlClock(pressedBy);
var start = (c) => c.phase === "waiting" ? { ...c, phase: "running" } : c;
var end = (c) => ({ ...c, phase: "over", frozenAt: null });
var MAX_LATE_WINDOW_S = 300;
var canJoinLate = (rule, c) => {
  if (c.over)
    return false;
  if (rule.kind === "until-end")
    return true;
  if (rule.kind === "until-draw")
    return c.closeAt !== undefined && c.now < c.closeAt;
  return c.round <= 1 || c.msSinceRound1End <= (rule.windowSeconds ?? 0) * 1000;
};
var withLateWindow = (rule, seconds) => rule.kind === "none-after-round-1" ? { kind: rule.kind, windowSeconds: Math.max(0, Math.min(MAX_LATE_WINDOW_S, Math.floor(seconds) || 0)) } : rule;
// src-tictactoe-4e40c2b/vendor/game-core/packages/core/src/flow.ts
var MAX_AHEAD_MS = 30 * 86400000;
var SLOT_MS = 15 * 60000;
var timeOk = (t, now) => t <= now ? "Pick a time in the future." : t - now > MAX_AHEAD_MS ? "Pick a time within the next 30 days." : t % SLOT_MS !== 0 ? "Times are in 15-minute steps." : null;
// src-tictactoe-4e40c2b/vendor/game-core/packages/core/src/prizes.ts
var splitTie = (amount, winners) => {
  const each = Math.floor(amount / winners);
  return { each, left: amount - each * winners };
};
// src-tictactoe-4e40c2b/vendor/game-core/packages/core/src/retention.ts
var AUTO_DELETE_AFTER_MS = 20 * 3600000;
var PRIZE_SHEET_REMINDER_MS = 12 * 3600000;
var PDF_SEND_WITHIN_MS = 3 * 3600000;
var WINNERS_KEEP_DAYS = 365;
// src-tictactoe-4e40c2b/vendor/game-core/packages/manifest/src/games.ts
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
// src-tictactoe-4e40c2b/apps/edge/src/ids.ts
var exports_ids2 = {};
__export(exports_ids2, {
  normEmpFor: () => normEmpFor,
  empHint: () => empHint,
  cleanEmpId: () => cleanEmpId2,
  cleanEmail: () => cleanEmail,
  cleanAccountEmail: () => cleanAccountEmail,
  EMP_MAX: () => EMP_MAX2,
  EMP_CLEAN_FROM_MS: () => EMP_CLEAN_FROM_MS
});
var EMP_CLEAN_FROM_MS = Date.UTC(2099, 0, 1);
var EMP_MAX2 = 30;
var cleanEmpId2 = (raw) => String(raw ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
var cleanEmail = (raw) => String(raw ?? "").normalize("NFKC").replace(/[\s\u0085\u200B-\u200D\u2060\uFEFF]/g, "").toLowerCase();
var cleanAccountEmail = (raw) => {
  const s = String(raw ?? "");
  return /[\u0085\u2028\u2029\u200B-\u200D\u2060\uFEFF]/.test(s) ? "" : s.trim().toLowerCase();
};
var empHint = (raw) => {
  const c = cleanEmpId2(raw);
  return c ? `The system will read this as ${c}` : "";
};
var normEmpFor = (raw, createdMs) => {
  if (typeof createdMs === "number" && createdMs < EMP_CLEAN_FROM_MS) {
    const s = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
    if (!s)
      return "";
    return /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(s) ? s : null;
  }
  if (!String(raw ?? "").trim())
    return "";
  if (String(raw ?? "").normalize("NFKC").includes("@"))
    return null;
  const c = cleanEmpId2(raw);
  return c && c.length <= EMP_MAX2 ? c : null;
};

// src-tictactoe-4e40c2b/apps/edge/src/people.ts
var exports_people = {};
__export(exports_people, {
  waitingWho: () => waitingWho,
  waMessage: () => waMessage,
  waLinkOf: () => waLinkOf,
  verifyOf: () => verifyOf,
  tokenHash: () => tokenHash,
  srcOf: () => srcOf,
  randHex: () => randHex,
  phoneHashOf: () => phoneHashOf,
  phoneDigits: () => phoneDigits,
  personByToken: () => personByToken,
  personByPhone: () => personByPhone,
  peopleRoute: () => peopleRoute,
  parseFrom: () => parseFrom,
  normId: () => normId2,
  normEmp: () => normEmp2,
  newToken: () => newToken,
  maskedPhone: () => maskedPhone,
  listCount: () => listCount,
  limitOfInviter: () => limitOfInviter,
  keptPhone: () => keptPhone,
  keptFromClean: () => keptFromClean,
  joinLinkPage: () => joinLinkPage,
  isOrg: () => isOrg,
  inviterOf: () => inviterOf,
  fromCodeOf: () => fromCodeOf,
  empHashOf: () => empHashOf,
  cleanPhone: () => cleanPhone,
  cleanName: () => cleanName,
  chainOf: () => chainOf,
  badIdMessage: () => badIdMessage,
  addWaiting: () => addWaiting,
  WAITING_MAX: () => WAITING_MAX,
  PEOPLE_SCHEMA: () => PEOPLE_SCHEMA,
  ORG_FROM: () => ORG_FROM,
  MAX_ADD_BATCH: () => MAX_ADD_BATCH,
  HOST_FROM: () => HOST_FROM,
  COHOST_LIMIT_MIN: () => COHOST_LIMIT_MIN,
  COHOST_LIMIT_MAX: () => COHOST_LIMIT_MAX,
  COHOST_LIMIT_DEFAULT: () => COHOST_LIMIT_DEFAULT,
  COHOST_FROM: () => COHOST_FROM
});

// src-tictactoe-4e40c2b/apps/edge/src/brand.ts
var TERMS_VERSION = "2026-11-01";
var BRAND = {
  name: "Corporate Tic Tac Toe",
  tagline: "Live games for companies",
  tag: "Tic Tac Toe",
  support: "hello@corporatetambola.com",
  legalPath: "/legal.html",
  defaultOrigin: "https://tictactoe.corporatetambola.com",
  wine: "#0B5D5B",
  gold: "#FFC93C",
  gold2: "#FFE08A",
  ivory: "#F7FBFA",
  line: "#D5E3E1"
};
var mailTag = `[${BRAND.tag}] `;
// src-tictactoe-4e40c2b/apps/edge/src/consent-text.json
var consent_text_default = {
  version: "2026-11-01",
  K1: {
    A: "I have read and agree to the Terms & Conditions, the Privacy Policy and the Refund Policy.",
    B: "I confirm: players pay nothing to play. I provide and hand over any prize. This game is allowed in my State. I am allowed to invite these guests."
  },
  K2: {
    A: "I have read and agree to the Terms & Conditions and the Privacy Policy."
  },
  K3: {
    A: "I agree to the Terms and the Refund Policy. I understand there is no refund; my payment stays as credit."
  },
  K4: {
    A: "I agree that my name is used for this game only and deleted within 24 hours after it ends. If this game asks for my mobile number or my employee ID, it is used for this game only too and deleted at the same time. I know who invited me is recorded until then. The results are kept for 365 days, without names. Billing data is kept for audit and tax reasons. This notice is available in Hindi on request.",
    B: "I am 18 or older."
  },
  K5: {
    A: "I will not charge any player. I will hand over prizes as the organizer decides. I follow the Terms."
  },
  K6: {
    A: "I am allowed to use these names and numbers for this game. The people have been told."
  },
  K7: {
    A: "I agree to the Terms, the Privacy Policy and the Refund Policy linked here. I understand there is no promise of funding or results."
  },
  K9: {
    A: "I agree that you may use my details to reply to this request."
  }
};

// src-tictactoe-4e40c2b/apps/edge/src/consent.ts
var CONSENT_VERSION = TERMS_VERSION;
var WORDING = consent_text_default;
var boxesOf = (kind) => Object.entries(WORDING[kind]).sort((a, b) => a[0] < b[0] ? -1 : 1);
var NOTICE_TEXT = "By continuing, you agree to the Terms and Conditions, Privacy and Data, and Game rules.";
var json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
var sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
var randId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
var wordingHash = async (_kind) => sha(NOTICE_TEXT);
var STALE_PAGE_MESSAGE = "This page is out of date. Please reload it and try again. Sorry for the trouble.";
function consentRequired(b, kind) {
  const c = b?.consent;
  const sent = Array.isArray(c?.boxes) ? c.boxes : [];
  if (c?.v === CONSENT_VERSION && boxesOf(kind).every(([id]) => sent.includes(id)))
    return null;
  return json({ error: STALE_PAGE_MESSAGE, code: "consent-required", kind, version: CONSENT_VERSION }, 400);
}
async function recordConsent(db, o) {
  const ids = boxesOf(o.kind).map(([id]) => id);
  await db.prepare("INSERT INTO consent_log(id,subject,kind,ref,version,boxes,text_hash,at_ms) VALUES(?,?,?,?,?,?,?,?)").bind(randId(), o.subject, o.kind, o.ref, CONSENT_VERSION, ids.join(","), await wordingHash(o.kind), o.now).run();
}

// src-tictactoe-4e40c2b/apps/edge/src/pii.ts
var enc3 = new TextEncoder;
var dec = new TextDecoder;
var b64 = (u) => {
  let s = "";
  for (let i = 0;i < u.length; i += 32768)
    s += String.fromCharCode(...u.subarray(i, i + 32768));
  return btoa(s);
};
var unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
var AAD = enc3.encode("corporate-tic-tac-toe/pii/v1");
var keys = new Map;
function keyFor(env) {
  const secret = env.DATA_KEY ? "k|" + env.DATA_KEY : env.ORGANIZER_SECRET ? "fallback|" + env.ORGANIZER_SECRET : "";
  if (!secret)
    return Promise.reject(new Error("no data key configured"));
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc3.encode(secret), "HKDF", false, ["deriveKey"]).then((base) => crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc3.encode("corporate-tic-tac-toe/salt/v1"), info: enc3.encode("pii-aes-256-gcm") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    if (keys.size > 8)
      keys.clear();
    keys.set(secret, k);
  }
  return k;
}
async function sealText(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await keyFor(env), enc3.encode(text)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
async function openText(env, sealed) {
  if (!sealed)
    return null;
  const p = sealed.split(".");
  if (p.length !== 3 || p[0] !== "v1")
    return null;
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p[1]), additionalData: AAD }, await keyFor(env), unb64(p[2])));
  } catch {
    return null;
  }
}
var sealPii = (env, p) => sealText(env, JSON.stringify(p.empId ? { p: p.phone, n: p.name, e: p.empId } : { p: p.phone, n: p.name }));
async function openPii(env, sealed) {
  const t = await openText(env, sealed);
  if (t === null)
    return null;
  try {
    const o = JSON.parse(t);
    return { phone: String(o.p ?? ""), name: o.n == null ? null : String(o.n), ...o.e ? { empId: String(o.e) } : {} };
  } catch {
    return null;
  }
}

// src-tictactoe-4e40c2b/apps/edge/src/phonekit.ts
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

// src-tictactoe-4e40c2b/apps/edge/src/checkin.ts
var CHECKIN_FROM_MS = Date.UTC(2026, 9, 23, 10, 0, 0);
var CHECKIN_OPENS_BEFORE_MS = 5 * 60000;
var CHECKIN_LOCK_MS = 10 * 60000;
async function deviceMatches(env, eid, pid, device) {
  if (typeof device !== "string" || !/^[0-9a-f]{16,64}$/.test(device))
    return false;
  const row = await env.DB.prepare("SELECT dev FROM seat WHERE eid=? AND pid=?").bind(eid, pid).first();
  return !!row?.dev && row.dev === (await sha2(`dev|${eid}|${device}`)).slice(0, 32);
}
var sha2 = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
// src-tictactoe-4e40c2b/apps/edge/src/people.ts
var PEOPLE_SCHEMA = [
  `ALTER TABLE organizer_key ADD COLUMN created_by TEXT`,
  `ALTER TABLE engagement ADD COLUMN cohost_limit INTEGER`,
  `ALTER TABLE seat ADD COLUMN blocked INTEGER`,
  `CREATE TABLE IF NOT EXISTS person (eid TEXT NOT NULL, id TEXT NOT NULL, ph TEXT NOT NULL, pii TEXT NOT NULL, inviter TEXT NOT NULL, role TEXT, status TEXT NOT NULL, tok_hash TEXT, tok_sealed TEXT, approved_by TEXT, approved_ms INTEGER, added_ms INTEGER NOT NULL, joined_ms INTEGER, removed_ms INTEGER, removed_by TEXT, PRIMARY KEY (eid, id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS person_phone ON person (eid, ph)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS person_token ON person (tok_hash)`,
  `CREATE INDEX IF NOT EXISTS person_inviter ON person (eid, inviter)`,
  `CREATE TABLE IF NOT EXISTS waiting (eid TEXT NOT NULL, id TEXT NOT NULL, ph TEXT NOT NULL, pii TEXT NOT NULL, via TEXT NOT NULL, inviter TEXT NOT NULL, chain TEXT NOT NULL, overlimit INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, at_ms INTEGER NOT NULL, decided_by TEXT, decided_ms INTEGER, PRIMARY KEY (eid, id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS waiting_phone ON waiting (eid, ph)`
];
var COHOST_FROM = 1e9;
var HOST_FROM = 1500000000;
var ORG_FROM = 1900000000;
var COHOST_LIMIT_DEFAULT = 100;
var COHOST_LIMIT_MIN = 10;
var COHOST_LIMIT_MAX = 1000;
var MAX_ADD_BATCH = 200;
var WAITING_MAX = 500;
var isOrg = (id) => id === "o";
var encoder = new TextEncoder;
var sha3 = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
var randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
var ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
var newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHA[b % ALPHA.length]).join("");
var tokenHash = async (token) => (await sha3("pj|" + token.toLowerCase())).slice(0, 32);
var phoneHashOf = (env, digits) => sha3(`${env.PHONE_SALT ?? env.ORGANIZER_SECRET ?? "unset"}|${digits.slice(-10)}`);
var normEmp2 = (raw, createdMs) => normEmpFor(raw, createdMs);
var EMAIL_ID_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
var normId2 = (raw, kind, createdMs) => {
  if (kind === "email") {
    const k = cleanEmail(raw);
    if (!k)
      return "";
    return EMAIL_ID_RE.test(k) && k.length <= 254 ? k : null;
  }
  return normEmp2(raw, createdMs ?? undefined);
};
var badIdMessage = (raw, kind, createdMs) => kind === "email" ? "Please check your Email ID. It looks incomplete." : (createdMs == null || createdMs >= EMP_CLEAN_FROM_MS) && String(raw ?? "").normalize("NFKC").includes("@") ? "This looks like an Email ID. This game asks for an employee ID: letters and numbers only." : cleanEmpId2(raw).length > EMP_MAX2 ? "This ID is too long. An employee ID may be up to 30 characters once cleaned." : "An employee ID has letters and numbers only (up to 30).";
var empHashOf = (env, id) => sha3(`${env.PHONE_SALT ?? env.ORGANIZER_SECRET ?? "unset"}|emp|${id}`);
var verifyOf = (e) => {
  try {
    const j = e.config ? JSON.parse(e.config) : {};
    return { mode: j.verify === "id" || j.verify === "either" || j.verify === "both" ? j.verify : "mobile", employeesOnly: j.employeesOnly === true, idKind: j.idKind === "email" ? "email" : "emp" };
  } catch {
    return { mode: "mobile", employeesOnly: false, idKind: "emp" };
  }
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
var waMessage = (name, game, link) => `${name ? name + ", you" : "You"} are invited to ${game}. Open your game here: ${link}`;
var waLinkOf = (digits, text) => `https://wa.me/${phoneDigits(digits)}?text=${encodeURIComponent(text)}`;
var AI_REFUSAL = "Names and mobile numbers are handled by people in the console, never by an AI assistant. Ask the owner to do this in the console.";
var PERSON_COLS = "eid, id, ph, pii, inviter, role, status, tok_hash, tok_sealed, approved_by, approved_ms, added_ms, joined_ms, removed_ms, removed_by";
async function callerOf(c, bodyMe, bodyDevice) {
  const { a, e } = c;
  if (a.kind === "ai" || c.viaLink || c.req.headers.get("x-cb-link") === "1")
    return { res: c.json({ error: AI_REFUSAL }, 403) };
  if (a.kind) {
    if (!a.plat && (!a.org || a.org !== e.org))
      return { res: c.json({ error: "Not allowed." }, 403) };
    if (a.plat || a.kind === "master")
      return { who: { id: "o", kind: "organizer", all: true, limit: null, label: "Organizer", platform: a.plat } };
    if (a.kind === "host")
      return { who: { id: "h:" + c.keyId7, kind: "host", all: true, limit: null, label: "Host" } };
    if (a.kind === "cohost") {
      if (a.eid && a.eid !== e.id)
        return { res: c.json({ error: "Your Co-host link is for a different game." }, 403) };
      return { who: { id: "c:" + c.keyId7, kind: "cohost", all: false, limit: e.cohost_limit ?? COHOST_LIMIT_DEFAULT, label: "Co-host" } };
    }
    return { res: c.json({ error: "Not allowed." }, 403) };
  }
  const pid = c.req.headers.get("x-cb-pid") || c.url.searchParams.get("me") || (typeof bodyMe === "string" ? bodyMe : "");
  if (!pid)
    return { res: c.json({ error: "Please sign in, or open your personal link first." }, 403) };
  const seat = await c.env.DB.prepare("SELECT seq, role, inv, blocked FROM seat WHERE eid=? AND pid=?").bind(c.eid, pid).first();
  if (!seat)
    return { res: c.json({ error: "Not a participant of this game." }, 403) };
  if (!await deviceMatches(c.env, c.eid, pid, c.req.headers.get("x-cb-dev") || c.url.searchParams.get("device") || (typeof bodyDevice === "string" ? bodyDevice : "")))
    return { res: c.json({ error: "Open this card on the phone you joined with to invite people.", code: "device" }, 403) };
  if (seat.blocked)
    return { res: c.json({ error: "You were removed from this game.", code: "removed" }, 403) };
  if (seat.role)
    return { res: c.json({ error: "Your team seat invites through the console, not through the game page." }, 403) };
  if (seat.inv !== null)
    return { res: c.json({ error: "Guests invited by a guest can play but cannot invite more people." }, 403) };
  if (!c.invites.on)
    return { res: c.json({ error: "The organizer has not switched on guest invitations for this game." }, 403) };
  return { who: { id: "s:" + seat.seq, kind: "guest", all: false, limit: c.invites.per, label: "Guest", seat: seat.seq } };
}
async function labelsOf(c) {
  const rows = (await c.env.DB.prepare("SELECT substr(hash,1,7) AS h, kind, label FROM organizer_key WHERE org=? AND kind IN ('host','cohost') AND (eid IS NULL OR eid=?)").bind(c.e.org, c.eid).all()).results ?? [];
  const m = new Map;
  for (const r of rows)
    m.set((r.kind === "host" ? "h:" : "c:") + r.h, `${r.kind === "host" ? "Host" : "Co-host"}${r.label ? " " + r.label : ""}`);
  return (id) => !id ? "" : id === "o" ? "Organizer" : id.startsWith("s:") ? `Guest (seat ${id.slice(2)})` : m.get(id) ?? (id.startsWith("h:") ? "Host" : "Co-host");
}
async function viewOf(c, r, label, showInviter) {
  const pii = await openPii(c.env, r.pii);
  const token = r.status === "removed" ? null : await openText(c.env, r.tok_sealed);
  const link = token ? `${c.origin}/j/${token}` : null;
  const digits = pii?.phone ?? "";
  return {
    id: r.id,
    name: pii?.name ?? "",
    maskedPhone: digits ? maskedPhone(digits) : "",
    status: r.status,
    ...pii?.empId ? { empId: pii.empId } : {},
    link,
    waLink: link && digits ? waLinkOf(digits, waMessage(pii?.name || null, c.gameName, link)) : null,
    ...r.role ? { role: r.role } : {},
    ...showInviter ? { inviter: label(r.inviter) } : {},
    ...r.approved_by ? { approvedBy: label(r.approved_by) } : {}
  };
}
var listCount = async (db, eid, inviter) => (await db.prepare("SELECT COUNT(*) AS c FROM person WHERE eid=? AND inviter=? AND status<>'removed' AND role IS NULL").bind(eid, inviter).first())?.c ?? 0;
var totalCount = async (db, eid) => (await db.prepare("SELECT COUNT(*) AS c FROM person WHERE eid=? AND status<>'removed'").bind(eid).first())?.c ?? 0;
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
var csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s))
    s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
async function refreshBlocked(db, eid) {
  try {
    const rows = (await db.prepare("SELECT pid FROM seat WHERE eid=? AND blocked=1").bind(eid).all()).results ?? [];
    await db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(`seats-blk/${eid}`, JSON.stringify(rows.map((r) => r.pid))).run();
  } catch {}
}
async function batched(db, stmts) {
  const out = [];
  for (let i = 0;i < stmts.length; i += 50)
    out.push(...await db.batch(stmts.slice(i, i + 50)));
  return out;
}
var inList = (n) => Array(n).fill("?").join(",");
async function existingBy(db, table, eid, hashes, cols) {
  const m = new Map;
  const col = table === "seat" ? "ph" : "ph";
  for (let i = 0;i < hashes.length; i += 50) {
    const part = hashes.slice(i, i + 50);
    const rows = (await db.prepare(`SELECT ${cols} FROM ${table} WHERE eid=? AND ${col} IN (${inList(part.length)})`).bind(eid, ...part).all()).results ?? [];
    for (const r of rows)
      m.set(r.ph, r);
  }
  return m;
}
async function peopleRoute(c) {
  const parts = c.tail.split("/").filter(Boolean), method = c.req.method;
  if (parts[0] === "me")
    return method === "GET" ? meRoute(c) : c.json({ error: "Not found" }, 404);
  let bodyObj = null;
  if (method === "POST" || method === "PATCH") {
    const ct = c.req.clone();
    bodyObj = await c.body(ct, 65536);
  }
  const got = await callerOf(c, bodyObj?.me, bodyObj?.device);
  if ("res" in got)
    return got.res;
  const who = got.who;
  if (c.e.unplayed_ms && method !== "GET")
    return c.json({ error: "This game did not start. Your details have been auto-deleted.", code: "did-not-start", didNotStart: true }, 409);
  if (c.cancelled && method !== "GET")
    return c.json({ error: "This game was cancelled by the organizer.", code: "cancelled", cancelled: true }, 409);
  if (parts[0] === "waiting") {
    if (parts.length === 1 && method === "GET")
      return listWaiting(c, who);
    if (parts.length === 2 && parts[1] === "all" && method === "POST")
      return decideAll(c, who, bodyObj);
    if (parts.length === 2 && method === "POST")
      return decideWaiting(c, who, parts[1], bodyObj);
    return c.json({ error: "Not found" }, 404);
  }
  if (parts.length === 1 && method === "GET")
    return listPeople(c, who);
  if (parts.length === 1 && method === "POST")
    return addPeople(c, who, bodyObj);
  if (parts.length === 2 && parts[1] === "export" && method === "GET")
    return exportPeople(c, who);
  if (parts.length === 2 && parts[1] === "me" && (method === "GET" || method === "POST"))
    return myOwnSeat(c, who, bodyObj);
  if (parts.length === 3 && parts[2] === "remove" && method === "POST")
    return removePerson(c, who, parts[1], bodyObj);
  if (parts.length === 3 && parts[2] === "resend" && method === "POST")
    return resendPerson(c, who, parts[1], bodyObj);
  return c.json({ error: "Not found" }, 404);
}
async function listPeople(c, who) {
  const limit = Math.min(Math.max(Number(c.url.searchParams.get("limit")) || 200, 1), 500), offset = Math.max(Number(c.url.searchParams.get("offset")) || 0, 0);
  const rows = await (who.all ? c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? ORDER BY added_ms, id LIMIT ? OFFSET ?`).bind(c.eid, limit, offset) : c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND inviter=? ORDER BY added_ms, id LIMIT ? OFFSET ?`).bind(c.eid, who.id, limit, offset)).all();
  const label = await labelsOf(c);
  const people = [];
  for (const r of rows.results ?? [])
    people.push(await viewOf(c, r, label, who.all));
  const used = await listCount(c.env.DB, c.eid, who.id);
  const waitingCount = (await waitingRows(c, who, 1000)).length;
  const code = fromCodeOf(who.id);
  return c.json({
    people,
    limit: who.limit ?? c.e.cap,
    used,
    total: who.all ? await totalCount(c.env.DB, c.eid) : used,
    cap: c.e.cap,
    offset,
    waiting: waitingCount,
    whoCanJoin: c.e.closed ? "list" : "anyone",
    role: who.kind,
    canExport: who.all,
    commonLink: c.draft || c.cancelled || code === null ? null : `${c.origin}/z.html?e=${c.eid}&from=${code}`
  });
}
async function addPeople(c, who, b) {
  if (!b || !Array.isArray(b.people) || b.people.length < 1)
    return c.json({ error: "Send at least one person: {people:[{name, phone}]}." }, 400);
  {
    const mt = consentRequired(b, "K6");
    if (mt)
      return mt;
  }
  if (b.people.length > MAX_ADD_BATCH)
    return c.json({ error: `Send up to ${MAX_ADD_BATCH} people at a time; the console sends a bigger list in several parts.`, code: "too-many" }, 413);
  if (c.now >= await c.endBound())
    return c.json({ error: "The game has ended, so no one can be added." }, 409);
  const invalid = [];
  let duplicates = 0;
  const duplicateRows = [];
  const dupRow = (r, t) => {
    duplicates++;
    duplicateRows.push({ raw: t.trim().slice(0, 100) || r, why: "Already on the list" });
  };
  const seen = new Set;
  const todo = [];
  const vf = verifyOf(c.e);
  for (const x of b.people) {
    const raw = `${cleanName(x?.name)} ${String(x?.phone ?? "")}`.trim().slice(0, 100);
    const empRaw = x?.empId ?? x?.employeeId, emp = normId2(empRaw, vf.idKind, c.e?.created_ms);
    if (emp === null) {
      invalid.push({ raw, why: badIdMessage(empRaw, vf.idKind, c.e?.created_ms) });
      continue;
    }
    const phoneTyped = String(x?.phone ?? "").trim() !== "";
    if (vf.mode === "either" && !emp && !phoneTyped) {
      invalid.push({ raw, why: "Give a mobile number or an employee ID." });
      continue;
    }
    if (vf.employeesOnly && vf.mode !== "mobile" && vf.mode !== "either" && !emp) {
      invalid.push({ raw, why: "This game is for employees: the employee ID is missing." });
      continue;
    }
    if ((vf.mode === "id" || vf.mode === "either" && !phoneTyped) && emp) {
      let digits = "";
      if (phoneTyped) {
        const cl2 = cleanPhone(x?.phone);
        if (!cl2.ok) {
          invalid.push({ raw, why: cl2.why });
          continue;
        }
        digits = keptFromClean(cl2.digits);
      }
      const ph2 = await empHashOf(c.env, emp);
      if (seen.has(ph2)) {
        dupRow(raw, String(empRaw ?? x?.phone ?? ""));
        continue;
      }
      seen.add(ph2);
      todo.push({ name: cleanName(x?.name), digits, ph: ph2, empId: emp });
      continue;
    }
    const cl = cleanPhone(x?.phone);
    if (!cl.ok) {
      invalid.push({ raw, why: cl.why });
      continue;
    }
    const ph = await phoneHashOf(c.env, cl.digits);
    if (seen.has(ph)) {
      dupRow(raw, String(empRaw ?? x?.phone ?? ""));
      continue;
    }
    const idHash = vf.mode === "either" && emp ? await empHashOf(c.env, emp) : undefined;
    if (idHash) {
      const al = await c.env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`idx/${c.eid}/${idHash}`).first();
      if (al && al.v !== ph && await c.env.DB.prepare("SELECT 1 AS x FROM person WHERE eid=? AND ph=? AND status<>'removed'").bind(c.eid, al.v).first() || seen.has("I" + idHash)) {
        dupRow(raw, String(empRaw ?? ""));
        continue;
      }
      seen.add("I" + idHash);
    }
    seen.add(ph);
    todo.push({ name: cleanName(x?.name), digits: keptFromClean(cl.digits), ph, ...emp && vf.mode !== "mobile" ? { empId: emp } : {}, ...idHash ? { idHash } : {} });
  }
  const db = c.env.DB, hashes = todo.map((t) => t.ph);
  const persons = await existingBy(db, "person", c.eid, hashes, "ph, status, id, inviter, removed_by");
  const seats = await existingBy(db, "seat", c.eid, hashes, "ph, blocked");
  const waits = await existingBy(db, "waiting", c.eid, hashes, "ph, id, status");
  const fresh = [], revive = [];
  for (const t of todo) {
    const p = persons.get(t.ph);
    if (p) {
      if (p.status === "removed" && (who.all || p.inviter === who.id && p.removed_by === who.id))
        revive.push(t);
      else if (p.status === "removed")
        invalid.push({ raw: `${t.name} ${t.digits ? "+" + phoneDigits(t.digits) : ""}`.trim(), why: "This person was removed. Ask the Organizer or a Host to put them back." });
      else
        duplicates++;
      continue;
    }
    if (seats.has(t.ph)) {
      duplicates++;
      continue;
    }
    fresh.push(t);
  }
  const adds = fresh.length + revive.length;
  if (adds === 0)
    return c.json({ added: 0, duplicates, duplicateRows, invalid, people: [] });
  if (who.limit !== null) {
    const used = await listCount(db, c.eid, who.id), room = Math.max(0, who.limit - used);
    if (adds > room)
      return c.json({ error: room === 0 ? `Your list is full: ${who.limit} people. Remove someone first, or ask the Organizer.` : `You can add ${room} more ${room === 1 ? "person" : "people"} (your limit is ${who.limit}). Nothing was added; please send fewer.`, code: "over-limit", limit: who.limit, used, room }, 409);
  }
  const total = await totalCount(db, c.eid);
  if (total + adds > c.e.cap)
    return c.json({ error: `This game is for ${c.e.cap} people and ${total} are already on the lists. Nothing was added.`, code: "over-cap", cap: c.e.cap, total }, 409);
  if (!await c.spend(adds))
    return c.busy();
  const stmts = [], toks = new Map, ids = new Map;
  for (const t of fresh) {
    const token = newToken(), id = randHex(6);
    toks.set(t.ph, token);
    ids.set(t.ph, id);
    stmts.push(db.prepare("INSERT OR IGNORE INTO person(eid,id,ph,pii,inviter,role,status,tok_hash,tok_sealed,approved_by,approved_ms,added_ms) SELECT ?,?,?,?,?,NULL,'invited',?,?,NULL,NULL,? WHERE (? IS NULL OR (SELECT COUNT(*) FROM person WHERE eid=? AND inviter=? AND status<>'removed' AND role IS NULL) < ?) AND (SELECT COUNT(*) FROM person WHERE eid=? AND status<>'removed') < ?").bind(c.eid, id, t.ph, await sealPii(c.env, { phone: t.digits, name: t.name || null, empId: t.empId }), who.id, await tokenHash(token), await sealText(c.env, token), c.now, who.limit, c.eid, who.id, who.limit ?? 0, c.eid, c.e.cap));
  }
  for (const t of revive) {
    const token = newToken();
    toks.set(t.ph, token);
    ids.set(t.ph, persons.get(t.ph).id);
    const hasSeat = seats.has(t.ph);
    stmts.push(db.prepare("UPDATE person SET status=?, inviter=?, pii=?, tok_hash=?, tok_sealed=?, approved_by=?, approved_ms=?, removed_ms=NULL, removed_by=NULL WHERE eid=? AND ph=? AND status='removed'").bind(hasSeat ? "joined" : "invited", who.id, await sealPii(c.env, { phone: t.digits, name: t.name || null, empId: t.empId }), await tokenHash(token), await sealText(c.env, token), who.id, c.now, c.eid, t.ph));
    if (hasSeat)
      stmts.push(db.prepare("UPDATE seat SET blocked=NULL WHERE eid=? AND ph=?").bind(c.eid, t.ph));
  }
  const waitingNow = todo.filter((t) => waits.has(t.ph) && waits.get(t.ph).status !== "admitted");
  for (const t of waitingNow)
    stmts.push(db.prepare("UPDATE waiting SET status='admitted', decided_by=?, decided_ms=? WHERE eid=? AND ph=?").bind(who.id, c.now, c.eid, t.ph));
  const res = await batched(db, stmts);
  for (const t of todo)
    if (t.idHash)
      await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`idx/${c.eid}/${t.idHash}`, t.ph).run();
  await recordConsent(db, { subject: who.kind === "organizer" ? c.e.org ?? "platform" : `${c.e.org ?? "-"}/${who.id}`, kind: "K6", ref: c.eid, now: c.now });
  if (c.started && revive.length)
    await refreshBlocked(db, c.eid);
  let i = 0;
  const done = [];
  for (const t of fresh) {
    if ((res[i++]?.meta?.changes ?? 0) > 0)
      done.push(t);
    else
      duplicates++;
  }
  for (const t of revive) {
    if ((res[i++]?.meta?.changes ?? 0) > 0)
      done.push(t);
    else
      duplicates++;
    if (seats.has(t.ph))
      i++;
  }
  const label = await labelsOf(c);
  const out = [];
  for (const t of done) {
    const token = toks.get(t.ph), link = `${c.origin}/j/${token}`;
    out.push({ id: ids.get(t.ph), name: t.name, maskedPhone: t.digits ? maskedPhone(t.digits) : "", status: "invited", ...t.empId ? { empId: t.empId } : {}, link, waLink: t.digits ? waLinkOf(t.digits, waMessage(t.name || null, c.gameName, link)) : null, ...who.all ? { inviter: label(who.id) } : {} });
  }
  return c.json({ added: done.length, duplicates, duplicateRows, invalid, people: out });
}
async function exportPeople(c, who) {
  if (!who.all)
    return c.json({ error: "Only the Organizer and Hosts can download a list." }, 403);
  const whole = c.url.searchParams.get("all") === "1";
  const rows = await (whole ? c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? ORDER BY added_ms, id`).bind(c.eid) : c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND inviter=? ORDER BY added_ms, id`).bind(c.eid, who.id)).all();
  const label = await labelsOf(c);
  const withId = verifyOf(c.e).mode !== "mobile";
  const lines = [["Name", "Mobile", ...withId ? ["Employee ID"] : [], "Personal link", "WhatsApp link", "Status", ...whole ? ["Invited by"] : []].join(",")];
  for (const r of rows.results ?? []) {
    const v = await viewOf(c, r, label, true), pii = await openPii(c.env, r.pii);
    lines.push([v.name, pii?.phone ?? "", ...withId ? [pii?.empId ?? ""] : [], v.link ?? "", v.waLink ?? "", r.status === "invited" ? "Invited" : r.status === "joined" ? "Joined" : "Removed", ...whole ? [v.inviter ?? ""] : []].map(csvCell).join(","));
  }
  return new Response("\uFEFF" + lines.join(`\r
`) + `\r
`, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="people-${c.eid.replace(/[^A-Za-z0-9_-]/g, "_")}.csv"` } });
}
async function personFor(c, who, id) {
  if (!/^[0-9a-f]{12}$/.test(id))
    return { res: c.json({ error: "No such person." }, 404) };
  const row = await c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND id=?`).bind(c.eid, id).first();
  if (!row || !who.all && row.inviter !== who.id)
    return { res: c.json({ error: "No such person on your list." }, 404) };
  return { row };
}
async function removePerson(c, who, id, b) {
  const got = await personFor(c, who, id);
  if ("res" in got)
    return got.res;
  const row = got.row, db = c.env.DB;
  if (c.started && !who.all)
    return c.json({ error: "Once the game has started only the Organizer or a Host can remove people." }, 403);
  if (row.role)
    return c.json({ error: "That is a team member's own seat. Retire the team member instead." }, 409);
  if (row.status === "removed")
    return c.json({ ok: true, removed: 0 });
  const targets = [row];
  if (b?.withTheirPeople === true) {
    let frontier = [row];
    for (let depth = 0;depth < 3 && frontier.length; depth++) {
      const next = [];
      for (const p of frontier) {
        const seat = await db.prepare("SELECT seq FROM seat WHERE eid=? AND ph=?").bind(c.eid, p.ph).first();
        if (!seat)
          continue;
        const kids = (await db.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND inviter=? AND status<>'removed' AND role IS NULL`).bind(c.eid, "s:" + seat.seq).all()).results ?? [];
        for (const k of kids)
          if (!targets.some((t) => t.id === k.id)) {
            targets.push(k);
            next.push(k);
          }
      }
      frontier = next;
    }
  }
  if (!await c.spend(targets.length * 3))
    return c.busy();
  const stmts = [];
  for (const t of targets) {
    stmts.push(db.prepare("UPDATE person SET status='removed', removed_ms=?, removed_by=?, tok_hash=NULL, tok_sealed=NULL WHERE eid=? AND id=? AND status<>'removed'").bind(c.now, who.id, c.eid, t.id));
    if (c.started)
      stmts.push(db.prepare("UPDATE seat SET blocked=1 WHERE eid=? AND ph=?").bind(c.eid, t.ph));
    else
      stmts.push(db.prepare("DELETE FROM claim WHERE eid=? AND pid IN (SELECT pid FROM seat WHERE eid=? AND ph=?)").bind(c.eid, c.eid, t.ph), db.prepare("DELETE FROM participant WHERE eid=? AND phone_hash=?").bind(c.eid, t.ph), db.prepare("DELETE FROM seat WHERE eid=? AND ph=?").bind(c.eid, t.ph));
  }
  await batched(db, stmts);
  if (c.started)
    await refreshBlocked(db, c.eid);
  if (who.kind === "host") {
    try {
      const to = await c.orgEmail();
      if (to)
        await c.sendMail(to, `A Host removed ${targets.length === 1 ? "someone" : targets.length + " people"} from ${c.gameName}`, `${(await labelsOf(c))(who.id)} removed ${targets.length === 1 ? "one person" : targets.length + " people"} from ${c.gameName} at ${c.istTime(c.now)}.

You can see who in your console, under My people.`);
    } catch {}
  }
  return c.json({ ok: true, removed: targets.length, during: c.started });
}
async function resendPerson(c, who, id, b) {
  const got = await personFor(c, who, id);
  if ("res" in got)
    return got.res;
  const row = got.row, db = c.env.DB;
  if (row.status === "removed")
    return c.json({ error: "That person was removed. Add them again first." }, 409);
  if (c.started && !who.all)
    return c.json({ error: "Once the game has started only the Organizer or a Host can send a link again." }, 403);
  let pii = await openPii(c.env, row.pii), ph = row.ph, newPii = null;
  const hasSeat = !!await db.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND ph=?").bind(c.eid, row.ph).first();
  if (b?.phone !== undefined && b.phone !== null && String(b.phone).trim() !== "") {
    const cl = cleanPhone(b.phone);
    if (!cl.ok)
      return c.json({ error: cl.why }, 400);
    const idKeyed = !!pii?.empId && await empHashOf(c.env, pii.empId) === row.ph;
    ph = idKeyed ? row.ph : await phoneHashOf(c.env, cl.digits);
    if (idKeyed) {
      newPii = await sealPii(c.env, { phone: keptFromClean(cl.digits), name: pii?.name ?? null, empId: pii.empId });
      pii = { phone: keptFromClean(cl.digits), name: pii?.name ?? null, empId: pii.empId };
    } else if (ph !== row.ph) {
      if (hasSeat)
        return c.json({ error: "They have already joined with their first number. Their card can move to a new phone, but not to a new number." }, 409);
      if (await db.prepare("SELECT 1 AS x FROM person WHERE eid=? AND ph=?").bind(c.eid, ph).first() || await db.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND ph=?").bind(c.eid, ph).first())
        return c.json({ error: "That number is already invited.", code: "duplicate" }, 409);
      newPii = await sealPii(c.env, { phone: keptFromClean(cl.digits), name: pii?.name ?? null, ...pii?.empId ? { empId: pii.empId } : {} });
      pii = { phone: keptFromClean(cl.digits), name: pii?.name ?? null, ...pii?.empId ? { empId: pii.empId } : {} };
    }
  }
  if (!await c.spend(2))
    return c.busy();
  const token = newToken();
  const res = await batched(db, [
    db.prepare("UPDATE person SET tok_hash=?, tok_sealed=?, ph=COALESCE(?, ph), pii=COALESCE(?, pii) WHERE eid=? AND id=? AND status<>'removed'").bind(await tokenHash(token), await sealText(c.env, token), newPii ? ph : null, newPii, c.eid, row.id),
    db.prepare("UPDATE seat SET dev=NULL WHERE eid=? AND ph=?").bind(c.eid, row.ph)
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0)
    return c.json({ error: "That number is already invited.", code: "duplicate" }, 409);
  if (newPii && pii?.empId && verifyOf(c.e).mode === "either")
    await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`idx/${c.eid}/${await empHashOf(c.env, pii.empId)}`, ph).run();
  const link = `${c.origin}/j/${token}`;
  return c.json({ ok: true, link, waLink: pii?.phone ? waLinkOf(pii.phone, waMessage(pii.name || null, c.gameName, link)) : null, unlocked: hasSeat });
}
async function myOwnSeat(c, who, b) {
  if (who.kind === "guest")
    return c.json({ error: "Your card link is the one you were sent." }, 403);
  const db = c.env.DB;
  const role = who.kind === "organizer" ? "organizer" : who.kind === "host" ? "host" : "co-host";
  let name = null, digits = null;
  if (who.kind === "host" || who.kind === "cohost") {
    const k = await db.prepare("SELECT pii, label, created_by FROM organizer_key WHERE org=? AND substr(hash,1,7)=? AND kind=? AND revoked=0").bind(c.e.org, c.keyId7, who.kind).first();
    const p = await openPii(c.env, k?.pii);
    name = p?.name ?? k?.label ?? null;
    digits = p?.phone ? cleanPhone(p.phone).ok ? cleanPhone(p.phone).digits : null : null;
  } else {
    try {
      const ct = await db.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${c.eid}`).first();
      const ph2 = ct ? String(JSON.parse(ct.v).phone ?? "") : "";
      const cl = cleanPhone(ph2);
      digits = cl.ok ? cl.digits : null;
    } catch {}
    name = "Organizer";
  }
  if (b?.phone !== undefined && b.phone !== null && String(b.phone).trim() !== "") {
    const cl = cleanPhone(b.phone);
    if (!cl.ok)
      return c.json({ error: cl.why }, 400);
    digits = cl.digits;
  }
  if (b?.name !== undefined)
    name = cleanName(b.name) || name;
  if (!digits)
    return c.json({ error: "We need your mobile number to make your play link.", code: "need-phone" }, 400);
  const ph = await phoneHashOf(c.env, digits);
  const label = await labelsOf(c);
  let row = await db.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND ph=?`).bind(c.eid, ph).first();
  if (row && row.status === "removed")
    return c.json({ error: "That number was removed from this game. Add it back from My people first." }, 409);
  if (!row) {
    if (!await c.spend(2))
      return c.busy();
    const token = newToken(), up = who.kind === "organizer" ? "o" : (await db.prepare("SELECT created_by FROM organizer_key WHERE org=? AND substr(hash,1,7)=? AND revoked=0").bind(c.e.org, c.keyId7).first())?.created_by ?? "o";
    await db.prepare("INSERT OR IGNORE INTO person(eid,id,ph,pii,inviter,role,status,tok_hash,tok_sealed,added_ms) VALUES(?,?,?,?,?,?, 'invited', ?,?,?)").bind(c.eid, randHex(6), ph, await sealPii(c.env, { phone: digits, name }), up, role, await tokenHash(token), await sealText(c.env, token), c.now).run();
    row = await db.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND ph=?`).bind(c.eid, ph).first();
  } else if (!row.role) {
    if (!await c.spend(1))
      return c.busy();
    await db.prepare("UPDATE person SET role=? WHERE eid=? AND id=?").bind(role, c.eid, row.id).run();
    if (!c.started)
      await db.prepare("UPDATE seat SET role=? WHERE eid=? AND ph=?").bind(role, c.eid, ph).run();
    row = { ...row, role };
  }
  const seat = await db.prepare("SELECT pid FROM seat WHERE eid=? AND ph=?").bind(c.eid, ph).first();
  return c.json({ person: await viewOf(c, row, label, false), role, joined: !!seat, ...seat ? { pid: seat.pid } : {} });
}
async function waitingRows(c, who, limit) {
  const cols = "id, pii, via, inviter, overlimit, at_ms";
  const q = who.all ? c.env.DB.prepare(`SELECT ${cols} FROM waiting WHERE eid=? AND status='waiting' ORDER BY at_ms LIMIT ?`).bind(c.eid, limit) : c.env.DB.prepare(`SELECT ${cols} FROM waiting WHERE eid=? AND status='waiting' AND chain LIKE ? ORDER BY at_ms LIMIT ?`).bind(c.eid, `%,${who.id},%`, limit);
  return (await q.all()).results ?? [];
}
async function listWaiting(c, who) {
  const label = await labelsOf(c), out = [];
  for (const r of await waitingRows(c, who, 200)) {
    const p = await openPii(c.env, r.pii), first = (p?.name ?? "").trim().split(/\s+/)[0] ?? "";
    out.push({ id: r.id, firstName: first, last4: (p?.phone ?? "").slice(-4), via: r.via, at: r.at_ms, ...who.all ? { inviter: label(r.inviter), overLimit: !!r.overlimit, ...p?.empId ? { empId: p.empId } : {} } : {} });
  }
  return c.json({ waiting: out });
}
var admitInsert = (db, eid, wid, id, ph, pii, inviter, tokHash, tokSealed, by, now) => db.prepare("INSERT OR IGNORE INTO person(eid,id,ph,pii,inviter,role,status,tok_hash,tok_sealed,approved_by,approved_ms,added_ms) SELECT ?,?,?,?,?,NULL,'invited',?,?,?,?,? WHERE EXISTS (SELECT 1 FROM waiting WHERE eid=? AND id=? AND status='waiting')").bind(eid, id, ph, pii, inviter, tokHash, tokSealed, by, now, now, eid, wid);
var admitRevive = (db, eid, wid, pid, inviter, tokHash, tokSealed, by, now) => db.prepare("UPDATE person SET status='invited', inviter=?, tok_hash=?, tok_sealed=?, approved_by=?, approved_ms=?, removed_ms=NULL, removed_by=NULL WHERE eid=? AND id=? AND EXISTS (SELECT 1 FROM waiting WHERE eid=? AND id=? AND status='waiting')").bind(inviter, tokHash, tokSealed, by, now, eid, pid, eid, wid);
async function decideWaiting(c, who, wid, b) {
  if (!/^[0-9a-f]{12}$/.test(wid))
    return c.json({ error: "No such request." }, 404);
  const decision = b?.decision;
  if (decision !== "admit" && decision !== "decline")
    return c.json({ error: "Say admit or decline." }, 400);
  const db = c.env.DB;
  const w = await db.prepare("SELECT id, ph, pii, inviter, chain, overlimit, status FROM waiting WHERE eid=? AND id=?").bind(c.eid, wid).first();
  if (!w || !who.all && !String(w.chain).includes(`,${who.id},`))
    return c.json({ error: "No such request." }, 404);
  if (w.status !== "waiting")
    return c.json({ ok: true, already: w.status });
  if (c.now >= await c.endBound())
    return c.json({ error: "The game has ended, so this request has lapsed." }, 409);
  if (!await c.spend(3))
    return c.busy();
  if (decision === "decline") {
    await db.prepare("UPDATE waiting SET status='declined', decided_by=?, decided_ms=? WHERE eid=? AND id=? AND status='waiting'").bind(who.id, c.now, c.eid, wid).run();
    return c.json({ ok: true, declined: true });
  }
  let inviter = w.overlimit ? who.id : w.inviter;
  const lim = await limitOfInviter({ env: c.env, eid: c.eid, e: c.e, invites: c.invites }, inviter);
  if (lim !== null && await listCount(db, c.eid, inviter) >= lim) {
    if (!who.all)
      return c.json({ error: `Your list is full (${lim} people). Remove someone first.`, code: "over-limit" }, 409);
    inviter = who.id;
  }
  if (await totalCount(db, c.eid) >= c.e.cap && !await db.prepare("SELECT 1 AS x FROM person WHERE eid=? AND ph=? AND status<>'removed'").bind(c.eid, w.ph).first())
    return c.json({ error: `This game is for ${c.e.cap} people and all places are taken.`, code: "over-cap" }, 409);
  const token = newToken();
  const existing = await db.prepare("SELECT id, status FROM person WHERE eid=? AND ph=?").bind(c.eid, w.ph).first();
  const stmts = [];
  if (!existing)
    stmts.push(admitInsert(db, c.eid, wid, randHex(6), w.ph, w.pii, inviter, await tokenHash(token), await sealText(c.env, token), who.id, c.now));
  else if (existing.status === "removed")
    stmts.push(admitRevive(db, c.eid, wid, existing.id, inviter, await tokenHash(token), await sealText(c.env, token), who.id, c.now), db.prepare("UPDATE seat SET blocked=NULL WHERE eid=? AND ph=? AND EXISTS (SELECT 1 FROM waiting WHERE eid=? AND id=? AND status='waiting')").bind(c.eid, w.ph, c.eid, wid));
  stmts.push(db.prepare("UPDATE waiting SET status='admitted', decided_by=?, decided_ms=? WHERE eid=? AND id=? AND status='waiting'").bind(who.id, c.now, c.eid, wid));
  const res = await batched(db, stmts);
  if ((res[res.length - 1]?.meta?.changes ?? 0) === 0)
    return c.json({ ok: true, already: (await db.prepare("SELECT status FROM waiting WHERE eid=? AND id=?").bind(c.eid, wid).first())?.status ?? "decided" });
  const label = await labelsOf(c);
  return c.json({ ok: true, admitted: true, placedUnder: label(inviter) });
}
async function decideAll(c, who, b) {
  const decision = b?.decision;
  if (decision !== "admit" && decision !== "decline")
    return c.json({ error: "Say admit or decline." }, 400);
  const db = c.env.DB;
  if (c.now >= await c.endBound())
    return c.json({ error: "The game has ended, so these requests have lapsed." }, 409);
  const cols = "id, ph, pii, inviter, overlimit";
  const rows = await (who.all ? db.prepare(`SELECT ${cols} FROM waiting WHERE eid=? AND status='waiting' ORDER BY at_ms, id LIMIT ?`).bind(c.eid, WAITING_MAX) : db.prepare(`SELECT ${cols} FROM waiting WHERE eid=? AND status='waiting' AND chain LIKE ? ORDER BY at_ms, id LIMIT ?`).bind(c.eid, `%,${who.id},%`, WAITING_MAX)).all();
  const list = rows.results ?? [];
  if (!list.length)
    return c.json({ admitted: 0, declined: 0, stillWaiting: 0 });
  if (!await c.spend(list.length * 3))
    return c.busy();
  const stmts = [];
  if (decision === "decline") {
    for (const w of list)
      stmts.push(db.prepare("UPDATE waiting SET status='declined', decided_by=?, decided_ms=? WHERE eid=? AND id=? AND status='waiting'").bind(who.id, c.now, c.eid, w.id));
    await batched(db, stmts);
    return c.json({ admitted: 0, declined: list.length, stillWaiting: 0 });
  }
  let total = await totalCount(db, c.eid), admitted = 0, notAdmitted = 0, skippedFull = false;
  const counts = new Map, limits = new Map;
  for (const w of list) {
    let inviter = w.overlimit ? who.id : w.inviter;
    const existing = await db.prepare("SELECT id, status FROM person WHERE eid=? AND ph=?").bind(c.eid, w.ph).first();
    if (!existing || existing.status === "removed") {
      if (total >= c.e.cap) {
        skippedFull = true;
        notAdmitted++;
        continue;
      }
      if (!limits.has(inviter)) {
        limits.set(inviter, await limitOfInviter({ env: c.env, eid: c.eid, e: c.e, invites: c.invites }, inviter));
        counts.set(inviter, await listCount(db, c.eid, inviter));
      }
      const lim = limits.get(inviter);
      if (lim !== null && counts.get(inviter) >= lim) {
        if (!who.all) {
          notAdmitted++;
          continue;
        }
        inviter = who.id;
        if (!counts.has(inviter)) {
          limits.set(inviter, null);
          counts.set(inviter, 0);
        }
      }
      counts.set(inviter, (counts.get(inviter) ?? 0) + 1);
      total++;
      const token = newToken();
      if (!existing)
        stmts.push(admitInsert(db, c.eid, w.id, randHex(6), w.ph, w.pii, inviter, await tokenHash(token), await sealText(c.env, token), who.id, c.now));
      else
        stmts.push(admitRevive(db, c.eid, w.id, existing.id, inviter, await tokenHash(token), await sealText(c.env, token), who.id, c.now), db.prepare("UPDATE seat SET blocked=NULL WHERE eid=? AND ph=? AND EXISTS (SELECT 1 FROM waiting WHERE eid=? AND id=? AND status='waiting')").bind(c.eid, w.ph, c.eid, w.id));
    }
    stmts.push(db.prepare("UPDATE waiting SET status='admitted', decided_by=?, decided_ms=? WHERE eid=? AND id=? AND status='waiting'").bind(who.id, c.now, c.eid, w.id));
    admitted++;
  }
  await batched(db, stmts);
  return c.json({ admitted, declined: 0, stillWaiting: notAdmitted, ...skippedFull ? { message: `The game is full (${c.e.cap} places). The rest are still waiting.` } : notAdmitted ? { message: "Some lists are full, so those requests are still waiting." } : {} });
}
async function meRoute(c) {
  const db = c.env.DB, pid = c.url.searchParams.get("pid"), wid = c.url.searchParams.get("wid");
  if (pid) {
    const s = await db.prepare("SELECT seq, role, inv, blocked FROM seat WHERE eid=? AND pid=?").bind(c.eid, pid).first();
    if (!s)
      return c.json({ error: "Not a participant of this game." }, 404);
    const p = await db.prepare("SELECT inviter, approved_by FROM person pe JOIN seat se ON se.eid=pe.eid AND se.ph=pe.ph WHERE se.eid=? AND se.pid=?").bind(c.eid, pid).first().catch(() => null);
    const ownList = s.inv === null && !s.role;
    return c.json({ state: s.blocked ? "removed" : "playing", removed: !!s.blocked, role: s.role ?? null, seat: s.seq, canInvite: !s.blocked && ownList && c.invites.on, per: c.invites.per, used: ownList ? await listCount(db, c.eid, "s:" + s.seq) : 0, whoCanJoin: c.e.closed ? "list" : "anyone", ...p ? { listed: true } : {} });
  }
  if (wid && /^[0-9a-f]{12}$/.test(wid)) {
    const w = await db.prepare("SELECT status, inviter, overlimit FROM waiting WHERE eid=? AND id=?").bind(c.eid, wid).first();
    if (!w)
      return c.json({ state: "gone", error: "That request is not here any more." }, 404);
    const ended = c.now >= await c.endBound();
    const state = w.status === "waiting" && ended ? "lapsed" : w.status;
    const who = await waitingWho(c, w.overlimit ? "o" : w.inviter);
    return c.json({ state, with: who, message: state === "waiting" ? `Your request is with ${who}. You can come in as soon as they say yes.` : state === "admitted" ? "You are in. Open your game link again to join." : state === "declined" ? "This game could not add you. Please talk to whoever invited you." : "This game has ended." });
  }
  return c.json({ error: "Say which: ?pid=<your card id> or ?wid=<your request id>." }, 400);
}
async function waitingWho(c, inviter) {
  if (inviter === "o")
    return "the organizer";
  if (inviter.startsWith("s:"))
    return "the person who invited you";
  const r = await c.env.DB.prepare("SELECT label FROM organizer_key WHERE org=? AND substr(hash,1,7)=? AND kind=?").bind(c.e.org, inviter.slice(2), inviter.startsWith("h:") ? "host" : "cohost").first();
  return r?.label ? r.label : inviter.startsWith("h:") ? "the host" : "the co-host";
}
async function addWaiting(c, o) {
  const db = c.env.DB;
  const have = await db.prepare("SELECT id, status FROM waiting WHERE eid=? AND ph=?").bind(c.eid, o.ph).first();
  if (have)
    return have;
  const n = (await db.prepare("SELECT COUNT(*) AS c FROM waiting WHERE eid=? AND status='waiting'").bind(c.eid).first())?.c ?? 0;
  if (n >= WAITING_MAX)
    return { full: true };
  const id = randHex(6), chain = o.overlimit ? ",o," : await chainOf(db, c.eid, o.inviter);
  await db.prepare("INSERT OR IGNORE INTO waiting(eid,id,ph,pii,via,inviter,chain,overlimit,status,at_ms) VALUES(?,?,?,?,?,?,?,?,'waiting',?)").bind(c.eid, id, o.ph, await sealPii(c.env, { phone: o.digits, name: o.name, empId: o.empId }), o.via, o.inviter, chain, o.overlimit ? 1 : 0, c.now).run();
  return await db.prepare("SELECT id, status FROM waiting WHERE eid=? AND ph=?").bind(c.eid, o.ph).first() ?? { id, status: "waiting" };
}
async function personByToken(env, eid, token) {
  if (!/^[a-z0-9]{6,20}$/i.test(token))
    return null;
  const r = await env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND tok_hash=?`).bind(eid, await tokenHash(token)).first();
  return r ? { ...r, name: null } : null;
}
async function personByPhone(env, eid, ph) {
  return await env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND ph=?`).bind(eid, ph).first() ?? null;
}
async function joinLinkPage(env, token, origin, gameNameOf) {
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'" };
  const esc = (s) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const gone = () => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link not valid</title></head><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>This link is not valid any more</h1><p>Please ask the person who invited you to send it again.</p></body></html>`, { status: 404, headers });
  if (!/^[a-z0-9]{6,20}$/i.test(token))
    return gone();
  const row = await env.DB.prepare("SELECT eid, pii, status FROM person WHERE tok_hash=?").bind(await tokenHash(token)).first();
  if (!row || row.status === "removed")
    return gone();
  const e = await env.DB.prepare("SELECT * FROM engagement WHERE id=?").bind(row.eid).first();
  if (!e || e.cancelled_ms || e.unplayed_ms)
    return gone();
  const pii = await openPii(env, row.pii), first = (pii?.name ?? "").trim().split(/\s+/)[0] ?? "", game = gameNameOf(e);
  const target = `${origin}/z.html?e=${encodeURIComponent(row.eid)}&t=${encodeURIComponent(token.toLowerCase())}`;
  const title = `You are invited to ${game}`, desc = `${first ? first + ", tap" : "Tap"} to open your game. Corporate Tic Tac Toe needs no app and no sign-up.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${esc(target)}"><title>${esc(title)}</title>` + `<meta property="og:type" content="website"><meta property="og:site_name" content="Corporate Tic Tac Toe"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(origin + "/j/" + token.toLowerCase())}">` + `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"></head><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>${esc(title)}</h1><p><a href="${esc(target)}">Open your game</a></p></body></html>`;
  return new Response(html, { headers });
}

// src-tictactoe-4e40c2b/apps/edge/src/lifetimes.ts
var exports_lifetimes = {};
__export(exports_lifetimes, {
  REPORT_LINK_MS: () => REPORT_LINK_MS,
  REPORT_LINK_HOURS: () => REPORT_LINK_HOURS,
  REPORT_AFTER_MS: () => REPORT_AFTER_MS,
  PURGE_HOURS: () => PURGE_HOURS,
  PURGE_AFTER_MS: () => PURGE_AFTER_MS
});
var PURGE_AFTER_MS = 20 * 3600000;
var REPORT_LINK_MS = 19 * 3600000;
var REPORT_AFTER_MS = 3 * 60000;
var PURGE_HOURS = PURGE_AFTER_MS / 3600000;
var REPORT_LINK_HOURS = REPORT_LINK_MS / 3600000;

// src-tictactoe-4e40c2b/apps/edge/src/tournament.ts
var exports_tournament = {};
__export(exports_tournament, {
  tttTick: () => tttTick,
  tttRoute: () => tttRoute,
  tournamentStarted: () => tournamentStarted,
  ensureT: () => ensureT,
  endedAtOf: () => endedAtOf,
  endBoundTtt: () => endBoundTtt,
  TTT_SCHEMA: () => TTT_SCHEMA,
  TTT_MOVE_SECONDS: () => TTT_MOVE_SECONDS,
  TTT_MAILBOX_SCHEMA: () => TTT_MAILBOX_SCHEMA,
  STAGE_SCHEMA: () => STAGE_SCHEMA
});
var TTT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ttt_t (eid TEXT PRIMARY KEY, commit_hash TEXT NOT NULL, secret TEXT, state TEXT NOT NULL DEFAULT 'open', opts TEXT, seed TEXT, size INTEGER, rounds INTEGER, entrants INTEGER, players INTEGER, started_ms INTEGER, ended_ms INTEGER, pause_at INTEGER, pause_total INTEGER NOT NULL DEFAULT 0, champion TEXT, ranking TEXT)`,
  `CREATE TABLE IF NOT EXISTS ttt_e (eid TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, members TEXT NOT NULL, PRIMARY KEY (eid, id))`,
  `CREATE TABLE IF NOT EXISTS ttt_p (eid TEXT NOT NULL, pid TEXT NOT NULL, name TEXT NOT NULL, ent TEXT, PRIMARY KEY (eid, pid))`,
  `CREATE TABLE IF NOT EXISTS ttt_m (eid TEXT NOT NULL, mid TEXT NOT NULL, round INTEGER NOT NULL, idx INTEGER NOT NULL, a TEXT, b TEXT, status TEXT NOT NULL, bye INTEGER NOT NULL DEFAULT 0, deadline INTEGER, winner TEXT, loser TEXT, started_ms INTEGER, done_ms INTEGER, data TEXT, PRIMARY KEY (eid, mid))`,
  `CREATE INDEX IF NOT EXISTS ttt_m_live ON ttt_m (eid, status, deadline)`,
  `CREATE INDEX IF NOT EXISTS ttt_m_a ON ttt_m (eid, a)`,
  `CREATE INDEX IF NOT EXISTS ttt_m_b ON ttt_m (eid, b)`
];
var STAGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ttt_sl (eid TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, slot TEXT NOT NULL, kind TEXT NOT NULL, pid TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, at_ms INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ttt_sl_u ON ttt_sl (eid, slot, kind, pid, seq)`,
  `CREATE INDEX IF NOT EXISTS ttt_sl_p ON ttt_sl (eid, pid, at_ms)`,
  `CREATE INDEX IF NOT EXISTS ttt_sl_k ON ttt_sl (eid, kind, id)`
];
var TTT_MAILBOX_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ttt_mv (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, seq INTEGER NOT NULL, pid TEXT NOT NULL, sq INTEGER NOT NULL, client_ms INTEGER, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j, seq))`,
  `CREATE TABLE IF NOT EXISTS ttt_r (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, pid TEXT NOT NULL, winner TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j, pid))`,
  `CREATE TABLE IF NOT EXISTS ttt_b (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, winner TEXT, how TEXT NOT NULL, flag INTEGER NOT NULL DEFAULT 0, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j))`,
  `CREATE TABLE IF NOT EXISTS ttt_f (eid TEXT NOT NULL, who TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, who))`,
  `CREATE TABLE IF NOT EXISTS ttt_x (eid TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, mid TEXT, who TEXT, note TEXT, at_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ttt_z (eid TEXT NOT NULL, from_ms INTEGER NOT NULL, to_ms INTEGER, PRIMARY KEY (eid, from_ms))`
];
var TTT_MOVE_SECONDS = [10, 20, 30, 60];
var MAX_MS = 6 * 3600000;
var UNCONTESTED_MS = 30000;
var PAGE = 100;
var LIVE_SAMPLE = 24;
var MAX_PLAN_MATCHES = 600;
var json2 = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
var sha4 = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
var optsOf = (t) => JSON.parse(t.opts ?? "{}");
async function ensureT(env, eid) {
  const have = await env.DB.prepare("SELECT * FROM ttt_t WHERE eid=?").bind(eid).first();
  if (have)
    return have;
  const secret = newSecret(), commit = await commitOf(secret);
  await env.DB.prepare("INSERT OR IGNORE INTO ttt_t(eid,commit_hash,secret) VALUES(?,?,?)").bind(eid, commit, secret).run();
  return await env.DB.prepare("SELECT * FROM ttt_t WHERE eid=?").bind(eid).first();
}
var tournamentStarted = async (env, eid) => !!await env.DB.prepare("SELECT 1 AS x FROM ttt_t WHERE eid=? AND state<>'open'").bind(eid).first();
async function endedAtOf(env, e, now) {
  const t = await env.DB.prepare("SELECT ended_ms FROM ttt_t WHERE eid=?").bind(e.id).first();
  if (t?.ended_ms)
    return { endedAtMs: t.ended_ms };
  if (e.cancelled_ms)
    return {};
  const bound = endBoundTtt((1692803367 + (e.start_round - 1) * 3) * 1000, null);
  return now >= bound ? { endedAtMs: bound } : {};
}
function endBoundTtt(startMs, t) {
  return t?.ended_ms ? t.ended_ms + 60000 : startMs + MAX_MS;
}
var boardsOf = (m) => m.data ? JSON.parse(m.data) : [];
var pausesOf = async (env, eid) => ((await env.DB.prepare("SELECT from_ms, to_ms FROM ttt_z WHERE eid=? ORDER BY from_ms").bind(eid).all()).results ?? []).map((x) => [x.from_ms, x.to_ms]);
async function refreshMatch(env, eid, mid, now) {
  const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, mid).first();
  if (!m || m.bye)
    return;
  const k = boardsOf(m).length;
  const n = (await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_b WHERE eid=? AND mid=? AND flag=0 AND winner IS NOT NULL").bind(eid, mid).first())?.c ?? 0;
  const done = k > 0 && n >= k;
  await env.DB.prepare("UPDATE ttt_m SET status=?, done_ms=? WHERE eid=? AND mid=?").bind(done ? "done" : "live", done ? now : null, eid, mid).run();
}
async function sweep(env, eid, now, mid) {
  const rows = await env.DB.prepare(`SELECT r.mid AS mid, r.j AS j, r.winner AS winner, r.at_ms AS at_ms FROM ttt_r r WHERE r.eid=?${mid ? " AND r.mid=?" : ""} AND r.at_ms<? AND NOT EXISTS (SELECT 1 FROM ttt_b b WHERE b.eid=r.eid AND b.mid=r.mid AND b.j=r.j) GROUP BY r.mid, r.j HAVING COUNT(*)=1 LIMIT 300`).bind(...mid ? [eid, mid] : [eid], now - UNCONTESTED_MS).all();
  const touched = new Set;
  for (const r of rows.results ?? []) {
    await env.DB.prepare("INSERT OR IGNORE INTO ttt_b(eid,mid,j,winner,how,flag,at_ms) VALUES(?,?,?,?,'uncontested',0,?)").bind(eid, r.mid, r.j, r.winner, r.at_ms + UNCONTESTED_MS).run();
    touched.add(r.mid);
  }
  for (const x of touched)
    await refreshMatch(env, eid, x, now);
  return touched.size;
}
async function note(env, eid, kind, mid, who, text, now) {
  await env.DB.prepare("INSERT INTO ttt_x(eid,kind,mid,who,note,at_ms) VALUES(?,?,?,?,?,?)").bind(eid, kind, mid, who, text.slice(0, 300), now).run();
}
async function tttTick(env, now) {
  let n = 0;
  const ts = await env.DB.prepare("SELECT eid FROM ttt_t WHERE state='running'").all();
  for (const t of ts.results ?? [])
    n += await sweep(env, t.eid, now);
  return n;
}
var cleanName2 = (n) => String(n ?? "").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "Player";
var MID = /^r[0-9]{1,2}m[0-9]{1,5}$/;
var PID = /^[A-Za-z0-9_-]{4,40}$/;
var STAGE_MAX_ENTRIES = 250000;
var STAGE_ENTRY_BYTES = 200;
var STAGE_WRITES_PER_SECOND = 5;
var STAGE_MAX_PLAYERS = 2000;
var STAGE_SLOT = /^[0-9]-[0-9]-[A-Za-z0-9_-]{4,40}-[A-Za-z0-9_-]{4,40}$/;
var stagesOn = async (env, eid) => {
  try {
    return !!await env.DB.prepare("SELECT 1 AS x FROM ttt_sl WHERE eid=? AND kind='flag' LIMIT 1").bind(eid).first();
  } catch {
    return false;
  }
};
async function playerOf(c, pid, device) {
  if (typeof pid !== "string" || typeof device !== "string" || !/^[0-9a-f]{16,64}$/.test(device))
    return json2({ error: "Open the game link on your own phone." }, 400);
  const seat = await c.env.DB.prepare("SELECT s.dev AS dev, s.blocked AS blocked FROM seat s WHERE s.eid=? AND s.pid=?").bind(c.eid, pid).first();
  if (!seat)
    return json2({ error: "You are not in this game." }, 403);
  if (seat.blocked)
    return json2({ error: "You were removed from this game by the organizer.", code: "removed" }, 403);
  if (!seat.dev || seat.dev !== (await sha4(`dev|${c.eid}|${device}`)).slice(0, 32))
    return json2({ error: "This place is on another phone.", code: "other-phone" }, 403);
  return { pid };
}
function boardOfPid(m, pid) {
  return boardsOf(m).findIndex(([x, y]) => x === pid || y === pid);
}
async function tttRoute(c) {
  const { env, req, now, eid, sub } = c;
  if (c.gate)
    return c.gate;
  const method = req.method;
  const t = await ensureT(env, eid);
  const mailRead = sub.startsWith("m/") ? sub.slice(2) : null;
  if (sub === "tick" && method === "POST") {
    if (!c.allowed)
      return json2({ error: "Not allowed." }, 403);
    return json2({ ok: true, processed: await tttTick(env, now) });
  }
  if (sub === "setup" && method === "GET") {
    const joined = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first())?.c ?? 0;
    const head = { eid, state: t.state, commit: t.commit_hash, serverNow: now, joined, startedMs: t.started_ms, endedMs: t.ended_ms, endedEarly: endedEarly(t), pauses: await pausesOf(env, eid) };
    if (t.state === "open")
      return json2({ ...head, pauses: [] });
    if (t.state === "starting" && !c.allowed)
      return json2(head);
    const roster = (await env.DB.prepare("SELECT pid, name FROM ttt_p WHERE eid=? ORDER BY pid").bind(eid).all()).results ?? [];
    const o = optsOf(t);
    return json2({ ...head, secret: t.secret, seed: t.seed, roster, opts: { format: o.format, teamSize: o.teamSize, moveMs: o.moveMs, readyMs: o.readyMs, ...o.stages ? { stages: true } : {} }, planDigest: o.planDigest ?? null, rounds: t.rounds, entrants: t.entrants });
  }
  if (sub === "reveal" && method === "GET") {
    if (t.state === "open" || t.state === "starting" && !c.allowed)
      return json2({ commit: t.commit_hash, revealed: false, note: "The secret is shown when the host starts. This fingerprint cannot be changed after that." });
    return json2({ commit: t.commit_hash, revealed: true, secret: t.secret, seed: t.seed, eid, how: "commit = sha256('TTT-COMMIT|' + secret); seed = sha256('TTT-SEED|' + secret + '|' + eid + '|' + sha256('TTT-ROSTER|' + sorted player ids joined by comma) + '|' + beacon). The bracket and every starter are computed on each phone from the seed (packages/ttt/src/phone.ts, bracket.ts, match.ts)." });
  }
  if (sub === "start" && method === "POST") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can start the tournament." }, 403);
    if (t.state !== "open")
      return json2({ error: "The tournament has already started.", code: "started" }, 409);
    const b = await c.body(req, 1024) ?? {};
    const format = b.format === "team" ? "team" : "solo", teamSize = format === "team" ? Number(b.teamSize ?? 3) : 1;
    const moveSecs = Number(b.moveSecs ?? 20);
    if (!TTT_MOVE_SECONDS.includes(moveSecs))
      return json2({ error: "A move clock is 10, 20, 30 or 60 seconds." }, 400);
    if (format === "team" && ![3, 5].includes(teamSize))
      return json2({ error: "A team has 3 or 5 players." }, 400);
    const beacon = typeof b.beacon === "string" ? b.beacon.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 128) : "";
    const rows = await env.DB.prepare("SELECT p.pid AS pid, p.pii AS pii, s.blocked AS blocked FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=?").bind(eid).all();
    const players = [];
    for (const r of rows.results ?? []) {
      if (r.blocked)
        continue;
      players.push({ pid: r.pid, name: cleanName2(await c.openName(r.pii)) });
    }
    const need = format === "team" ? 2 * teamSize : 2;
    if (players.length < need)
      return json2({ error: format === "team" ? `A team tournament needs at least two full teams (${need} players). ${players.length} joined.` : `A tournament needs at least 2 players. ${players.length} joined.`, code: "too-few", joined: players.length }, 409);
    if (players.length > 1e4)
      return json2({ error: "Too many players." }, 400);
    if (!await c.spend(env, now, players.length * 2 + 8))
      return c.BUSY();
    const seed = await seedOf(t.secret, eid, players.map((p) => p.pid), beacon);
    const o = { format, teamSize, moveMs: moveSecs * 1000, readyMs: 30000 };
    const stmts = [env.DB.prepare("UPDATE ttt_t SET state='starting', opts=?, seed=?, players=? WHERE eid=? AND state='open'").bind(JSON.stringify(o), seed, players.length, eid)];
    for (const p of players)
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_p(eid,pid,name,ent) VALUES(?,?,?,NULL)").bind(eid, p.pid, p.name));
    for (let i = 0;i < stmts.length; i += 90)
      await env.DB.batch(stmts.slice(i, i + 90));
    return json2({ ok: true, players: players.length, commit: t.commit_hash, state: "starting", next: "The Organizer's page computes the bracket from the seed and sends it to the mailbox (plan)." });
  }
  if (sub === "plan" && method === "POST") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can send the draw." }, 403);
    if (t.state !== "starting")
      return json2({ error: t.state === "open" ? "The tournament has not started." : "The draw is already in place.", code: t.state }, 409);
    const b = await c.body(req, 400000);
    if (!b || !Array.isArray(b.matches) || b.matches.length > MAX_PLAN_MATCHES || !Array.isArray(b.entrants || []))
      return json2({ error: "Bad draw." }, 400);
    const roster = new Set(((await env.DB.prepare("SELECT pid FROM ttt_p WHERE eid=?").bind(eid).all()).results ?? []).map((x) => x.pid));
    const stmts = [];
    for (const e of b.entrants ?? []) {
      if (typeof e?.id !== "string" || !Array.isArray(e.members) || !e.members.every((p) => typeof p === "string" && roster.has(p)))
        return json2({ error: "A team lists someone who did not join." }, 400);
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_e(eid,id,name,members) VALUES(?,?,?,?)").bind(eid, String(e.id).slice(0, 40), cleanName2(e.name), JSON.stringify(e.members)));
    }
    for (const m of b.matches) {
      if (typeof m?.mid !== "string" || !MID.test(m.mid) || !Number.isInteger(m.round) || !Number.isInteger(m.idx) || !Array.isArray(m.boards))
        return json2({ error: "Bad match in the draw." }, 400);
      for (const bd of m.boards)
        if (!Array.isArray(bd) || bd.length !== 2 || !bd.every((p) => typeof p === "string" && roster.has(p)))
          return json2({ error: "A board lists someone who did not join." }, 400);
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_m(eid,mid,round,idx,a,b,status,bye,winner,started_ms,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(eid, m.mid, m.round, m.idx, m.a ?? null, m.b ?? null, m.bye ? "done" : "live", m.bye ? 1 : 0, m.bye && typeof m.winner === "string" ? m.winner : null, now, JSON.stringify(m.boards)));
    }
    for (let i = 0;i < stmts.length; i += 90)
      await env.DB.batch(stmts.slice(i, i + 90));
    if (b.last === true) {
      const rounds = Number(b.rounds), size = Number(b.size), entrants = Number(b.entrantCount ?? 0);
      if (!Number.isInteger(rounds) || rounds < 0 || rounds > 14 || !Number.isInteger(size) || typeof b.digest !== "string" || !/^[0-9a-f]{64}$/.test(b.digest))
        return json2({ error: "The draw is not complete." }, 400);
      const o = { ...optsOf(t), planDigest: b.digest };
      await env.DB.prepare("UPDATE ttt_t SET state='running', started_ms=?, rounds=?, size=?, entrants=?, opts=? WHERE eid=? AND state='starting'").bind(now, rounds, size, entrants || null, JSON.stringify(o), eid).run();
      return json2({ ok: true, state: "running", startedMs: now });
    }
    return json2({ ok: true, state: "starting", stored: b.matches.length });
  }
  if ((sub === "pause" || sub === "resume") && method === "POST") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can pause." }, 403);
    if (t.state !== "running")
      return json2({ error: "The tournament is not running." }, 409);
    if (sub === "pause" && !t.pause_at)
      await env.DB.batch([env.DB.prepare("UPDATE ttt_t SET pause_at=? WHERE eid=?").bind(now, eid), env.DB.prepare("INSERT OR IGNORE INTO ttt_z(eid,from_ms,to_ms) VALUES(?,?,NULL)").bind(eid, now)]);
    if (sub === "resume" && t.pause_at)
      await env.DB.batch([env.DB.prepare("UPDATE ttt_t SET pause_total=pause_total+?, pause_at=NULL WHERE eid=?").bind(now - t.pause_at, eid), env.DB.prepare("UPDATE ttt_z SET to_ms=? WHERE eid=? AND to_ms IS NULL").bind(now, eid)]);
    return json2({ ok: true, paused: sub === "pause" });
  }
  if (sub === "end" && method === "POST") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can end the tournament." }, 403);
    if (t.state === "done")
      return json2({ ok: true, ended: true, again: true });
    if (t.state !== "running" && t.state !== "starting")
      return json2({ error: "The tournament has not started.", code: t.state }, 409);
    await endEarly(env, t, now);
    return json2({ ok: true, ended: true });
  }
  if (sub === "open" && method === "POST") {
    const b = await c.body(req, 4096);
    if (!b)
      return json2({ error: "Bad request." }, 400);
    const orgOpen = typeof b.pid !== "string" && c.allowed;
    const who = orgOpen ? { pid: "organizer" } : await playerOf(c, b.pid, b.device);
    if (who instanceof Response)
      return who;
    if (t.state !== "running")
      return json2({ error: "The tournament is not running.", code: t.state }, 409);
    const { boards, from } = b;
    if (typeof b.mid !== "string" || !MID.test(b.mid) || !Number.isInteger(b.round) || b.round < 2 || !Number.isInteger(b.idx) || !Array.isArray(boards) || boards.length < 1 || boards.length > 5 || !boards.every((x) => Array.isArray(x) && x.length === 2 && x.every((p) => typeof p === "string" && PID.test(p))))
      return json2({ error: "Bad match." }, 400);
    if (!Array.isArray(from) || from.length !== 2 || from[0] === from[1] || !from.every((x) => typeof x === "string" && MID.test(x)))
      return json2({ error: "A match needs the two matches it comes from.", code: "needs-feeders" }, 400);
    if (!orgOpen && !boards.some(([x, y]) => x === who.pid || y === who.pid))
      return json2({ error: "You are not in this match.", code: "not-in-match" }, 403);
    const pids = [...new Set(boards.flat())];
    const known = (await env.DB.prepare(`SELECT COUNT(*) AS c FROM ttt_p WHERE eid=? AND pid IN (${pids.map(() => "?").join(",")})`).bind(eid, ...pids).first())?.c ?? 0;
    if (known !== pids.length)
      return json2({ error: "A board lists someone who did not join.", code: "not-in-game" }, 400);
    const ready = await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_m WHERE eid=? AND mid IN (?,?) AND status='done'").bind(eid, from[0], from[1]).first();
    if ((ready?.c ?? 0) !== 2)
      return json2({ error: "The two earlier matches are not finished yet.", code: "feeders-not-done" }, 409);
    const data = JSON.stringify(boards);
    const have = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, b.mid).first();
    if (have) {
      if (have.data === data && have.a === (b.a ?? null) && have.b === (b.b ?? null))
        return json2({ ok: true, again: true });
      await note(env, eid, "pairing", b.mid, who.pid, "Two different pairings were sent for the same match.", now);
      return json2({ error: "That match is already registered with other players. The Organizer was told.", code: "conflict" }, 409);
    }
    await env.DB.prepare("INSERT OR IGNORE INTO ttt_m(eid,mid,round,idx,a,b,status,bye,started_ms,deadline,data) VALUES(?,?,?,?,?,?,'live',0,?,?,?)").bind(eid, b.mid, b.round, b.idx, b.a ?? null, b.b ?? null, now, Number.isFinite(b.opened) ? Math.trunc(b.opened) : null, data).run();
    return json2({ ok: true });
  }
  if (sub === "move" && method === "POST") {
    const b = await c.body(req, 512);
    if (!b)
      return json2({ error: "Bad move." }, 400);
    const orgClaim = typeof b.pid !== "string" && c.allowed && b.absent === true;
    const who = orgClaim ? { pid: "organizer" } : await playerOf(c, b.pid, b.device);
    if (who instanceof Response)
      return who;
    if (t.state !== "running")
      return json2({ error: t.state === "done" ? "The tournament is over." : "The tournament has not started.", code: t.state }, 409);
    if (t.pause_at)
      return json2({ error: "The host paused the game. Your clock waits.", code: "paused" }, 409);
    if (typeof b.mid !== "string" || !MID.test(b.mid) || !Number.isInteger(b.seq) || b.seq < 0)
      return json2({ error: "Bad move." }, 400);
    const absent = b.absent === true, sq = absent ? -1 : b.sq;
    if (!absent && (!Number.isInteger(sq) || sq < 0 || sq > 8))
      return json2({ error: "Pick a square on the board.", code: "bad-square" }, 400);
    const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, b.mid).first();
    if (!m)
      return json2({ error: "That match is not open yet.", code: "no-match" }, 404);
    const j = orgClaim ? Number.isInteger(b.j) && b.j >= 0 && b.j < boardsOf(m).length ? b.j : -1 : boardOfPid(m, who.pid);
    if (j < 0)
      return json2({ error: orgClaim ? "No such board." : "You are not in this match.", code: "not-in-match" }, orgClaim ? 404 : 403);
    if (await env.DB.prepare("SELECT 1 AS x FROM ttt_b WHERE eid=? AND mid=? AND j=?").bind(eid, b.mid, j).first())
      return json2({ error: "This board is finished.", code: "board-over" }, 409);
    const next = (await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_mv WHERE eid=? AND mid=? AND j=?").bind(eid, b.mid, j).first())?.c ?? 0;
    if (b.seq !== next)
      return json2({ error: "The board changed. Look again.", code: "seq", next }, 409);
    try {
      await env.DB.prepare("INSERT INTO ttt_mv(eid,mid,j,seq,pid,sq,client_ms,at_ms) VALUES(?,?,?,?,?,?,?,?)").bind(eid, b.mid, j, b.seq, who.pid, sq, Number.isFinite(b.client_ms) ? Math.trunc(b.client_ms) : null, now).run();
    } catch {
      return json2({ error: "The board changed. Look again.", code: "seq", next: next + 1 }, 409);
    }
    return json2({ ok: true, seq: b.seq, at: now });
  }
  if (mailRead !== null && method === "GET") {
    if (t.state === "open")
      return json2({ error: "The tournament has not started.", code: "open" }, 409);
    if (!MID.test(mailRead))
      return json2({ error: "Not found" }, 404);
    await sweep(env, eid, now, mailRead);
    const recs = await matchRecs(env, eid, [mailRead]);
    return json2({ ...recs[0] ?? { mid: mailRead, reg: null, complete: false, boards: [] }, t: { state: t.state, endedEarly: endedEarly(t), pauses: await pausesOf(env, eid), serverNow: now } });
  }
  if (sub === "result" && method === "POST") {
    const b = await c.body(req, 512);
    if (!b)
      return json2({ error: "Bad result." }, 400);
    const orgReport = typeof b.pid !== "string" && c.allowed;
    const who = orgReport ? { pid: "organizer" } : await playerOf(c, b.pid, b.device);
    if (who instanceof Response)
      return who;
    if (t.state !== "running")
      return json2({ error: "The tournament is not running.", code: t.state }, 409);
    if (typeof b.mid !== "string" || !MID.test(b.mid) || typeof b.winner !== "string")
      return json2({ error: "Bad result." }, 400);
    const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, b.mid).first();
    if (!m)
      return json2({ error: "That match is not open yet.", code: "no-match" }, 404);
    const j = orgReport ? Number.isInteger(b.j) && b.j >= 0 && b.j < boardsOf(m).length ? b.j : -1 : boardOfPid(m, who.pid);
    if (j < 0)
      return json2({ error: "You are not in this match.", code: "not-in-match" }, 403);
    const pair = boardsOf(m)[j];
    if (!pair.includes(b.winner))
      return json2({ error: "The winner must be one of the two players on the board.", code: "bad-winner" }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO ttt_r(eid,mid,j,pid,winner,at_ms) VALUES(?,?,?,?,?,?)").bind(eid, b.mid, j, who.pid, b.winner, now).run();
    const mine = await env.DB.prepare("SELECT winner FROM ttt_r WHERE eid=? AND mid=? AND j=? AND pid=?").bind(eid, b.mid, j, who.pid).first();
    const others = (await env.DB.prepare("SELECT pid, winner FROM ttt_r WHERE eid=? AND mid=? AND j=? AND pid<>?").bind(eid, b.mid, j, who.pid).all()).results ?? [];
    const have = await env.DB.prepare("SELECT winner, flag, how FROM ttt_b WHERE eid=? AND mid=? AND j=?").bind(eid, b.mid, j).first();
    let disagree = mine.winner !== b.winner || others.some((o) => o.winner !== mine.winner);
    if (have && have.how !== "organizer" && have.winner && have.winner !== mine.winner)
      disagree = true;
    if (disagree && !(have && have.how === "organizer")) {
      await env.DB.prepare("INSERT INTO ttt_b(eid,mid,j,winner,how,flag,at_ms) VALUES(?,?,?,NULL,'mismatch',1,?) ON CONFLICT(eid,mid,j) DO UPDATE SET winner=NULL, how='mismatch', flag=1, at_ms=excluded.at_ms").bind(eid, b.mid, j, now).run();
      if (!have || !have.flag)
        await note(env, eid, "mismatch", b.mid, who.pid, `Board ${j + 1}: the two reports do not match. Settle it in the console.`, now);
      await refreshMatch(env, eid, b.mid, now);
      return json2({ ok: true, agreed: false, flagged: true });
    }
    if (!have && others.length >= 1 && others[0].winner === mine.winner) {
      await env.DB.prepare("INSERT OR IGNORE INTO ttt_b(eid,mid,j,winner,how,flag,at_ms) VALUES(?,?,?,?,'both',0,?)").bind(eid, b.mid, j, mine.winner, now).run();
      await refreshMatch(env, eid, b.mid, now);
      return json2({ ok: true, agreed: true });
    }
    return json2({ ok: true, agreed: !!have && !have.flag });
  }
  if (sub === "flag" && method === "POST") {
    const b = await c.body(req, 512);
    if (!b)
      return json2({ error: "Bad request." }, 400);
    const who = await playerOf(c, b.pid, b.device);
    if (who instanceof Response)
      return who;
    await note(env, eid, String(b.kind ?? "note").slice(0, 20), typeof b.mid === "string" && MID.test(b.mid) ? b.mid : null, who.pid, String(b.note ?? ""), now);
    return json2({ ok: true });
  }
  if (sub === "flags" && method === "GET") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can see this." }, 403);
    const rows = (await env.DB.prepare("SELECT kind, mid, who, note, at_ms FROM ttt_x WHERE eid=? ORDER BY id DESC LIMIT 100").bind(eid).all()).results ?? [];
    const open = (await env.DB.prepare("SELECT mid, j FROM ttt_b WHERE eid=? AND flag=1 ORDER BY mid, j LIMIT 200").bind(eid).all()).results ?? [];
    return json2({ flags: rows, disputed: open });
  }
  if (sub === "settle" && method === "POST") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can settle a game." }, 403);
    const b = await c.body(req, 512);
    if (!b || typeof b.mid !== "string" || !MID.test(b.mid) || !Number.isInteger(b.j) || typeof b.winner !== "string")
      return json2({ error: "Bad request." }, 400);
    if (t.state !== "running")
      return json2({ error: "The tournament is not running." }, 409);
    const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, b.mid).first();
    const pair = m ? boardsOf(m)[b.j] : null;
    if (!m || !pair)
      return json2({ error: "No such board.", code: "no-match" }, 404);
    if (!pair.includes(b.winner))
      return json2({ error: "The winner must be one of the two players on the board.", code: "bad-winner" }, 400);
    await env.DB.prepare("INSERT INTO ttt_b(eid,mid,j,winner,how,flag,at_ms) VALUES(?,?,?,?,'organizer',0,?) ON CONFLICT(eid,mid,j) DO UPDATE SET winner=excluded.winner, how='organizer', flag=0, at_ms=excluded.at_ms").bind(eid, b.mid, b.j, b.winner, now).run();
    await refreshMatch(env, eid, b.mid, now);
    return json2({ ok: true });
  }
  if (sub === "finish" && method === "POST") {
    const b = await c.body(req, 40000);
    if (!b)
      return json2({ error: "Bad request." }, 400);
    if (t.state === "done")
      return json2({ ok: true, done: true });
    if (t.state !== "running")
      return json2({ error: "The tournament is not running.", code: t.state }, 409);
    let who, byOrganizer = false;
    if (typeof b.pid === "string") {
      const p = await playerOf(c, b.pid, b.device);
      if (p instanceof Response)
        return p;
      who = p.pid;
    } else if (c.allowed) {
      who = "organizer";
      byOrganizer = true;
    } else
      return json2({ error: "Not allowed." }, 403);
    const finalMid = `r${t.rounds ?? 0}m0`;
    const fm = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, finalMid).first();
    if (!fm || fm.status !== "done")
      return json2({ error: "The final is not finished.", code: "final-open" }, 409);
    if (!byOrganizer && boardOfPid(fm, who) < 0)
      return json2({ error: "Only the finalists' phones or the Organizer's page can send the result.", code: "not-in-final" }, 403);
    const { podium, ranking } = b;
    if (typeof b.champion !== "string" || b.finalMid !== finalMid || !Array.isArray(podium) || podium.length < 1 || podium.length > 5 || !podium.every((x) => Array.isArray(x) && x.length >= 1 && x.length <= 5 && x.every((p) => typeof p === "string" && PID.test(p))) || !Array.isArray(ranking) || ranking.length < 1 || ranking.length > 100)
      return json2({ error: "Bad result." }, 400);
    const clean = { champion: b.champion, rounds: t.rounds, finalMid, podium, ranking: ranking.map((r) => ({ rank: Number(r.rank), id: String(r.id).slice(0, 40), name: cleanName2(r.name), roundReached: Number(r.roundReached), points: Number(r.points), decidedBy: String(r.decidedBy ?? "").slice(0, 40), tie: String(r.tie ?? "").slice(0, 200) })) };
    const payload = JSON.stringify(clean), digest = await sha4(payload);
    await env.DB.prepare("INSERT OR REPLACE INTO ttt_f(eid,who,digest,payload,at_ms) VALUES(?,?,?,?,?)").bind(eid, who, digest, payload, now).run();
    const all = (await env.DB.prepare("SELECT who, digest FROM ttt_f WHERE eid=?").bind(eid).all()).results ?? [];
    const same = all.filter((x) => x.digest === digest);
    if (all.some((x) => x.digest !== digest))
      await note(env, eid, "finish-mismatch", finalMid, who, "Two phones computed a different ranking. The Organizer's page decides.", now);
    if (!(byOrganizer || same.length >= 2))
      return json2({ ok: true, done: false, waitingFor: "a second phone" });
    await finishWith(env, t, clean, now);
    return json2({ ok: true, done: true });
  }
  if (sub === "rank" && method === "GET")
    return json2({ done: t.state === "done", ranking: t.ranking ? JSON.parse(t.ranking).slice(0, Math.min(100, Number(c.url.searchParams.get("n") ?? 10) || 10)) : [], podium: t.state === "done" ? PODIUM.slice(0, 5) : [] });
  if (sub === "brief" && method === "GET") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can see this." }, 403);
    const q = c.url.searchParams;
    const round = Number(q.get("round") ?? 1) || 1, page = Math.max(0, Number(q.get("page") ?? 0) || 0);
    const ms = (await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND round=? ORDER BY idx LIMIT 300 OFFSET ?").bind(eid, round, page * 300).all()).results ?? [];
    const bs = ms.length ? (await env.DB.prepare(`SELECT mid, j, winner, flag, at_ms FROM ttt_b WHERE eid=? AND mid IN (${ms.map(() => "?").join(",")})`).bind(eid, ...ms.map((m) => m.mid)).all()).results ?? [] : [];
    return json2({ serverNow: now, pauses: await pausesOf(env, eid), matches: ms.map((m) => ({ mid: m.mid, a: m.a, b: m.b, bye: !!m.bye, winner: m.winner, opened: m.deadline, complete: m.status === "done", boards: boardsOf(m).map((_, j) => {
      const r = bs.find((x) => x.mid === m.mid && x.j === j);
      return { j, winner: r && !r.flag ? r.winner : null, ms: r?.at_ms ?? null };
    }) })) });
  }
  if (sub === "stuck" && method === "GET") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can see this." }, 403);
    const ms = Math.max(30000, Number(c.url.searchParams.get("ms") ?? 90000) || 90000);
    const rows = (await env.DB.prepare("SELECT m.mid AS mid FROM ttt_m m WHERE m.eid=? AND m.status='live' AND m.bye=0 AND COALESCE((SELECT MAX(v.at_ms) FROM ttt_mv v WHERE v.eid=m.eid AND v.mid=m.mid), m.started_ms) < ? ORDER BY m.round DESC, m.idx LIMIT 200 OFFSET ?").bind(eid, now - ms, Math.max(0, Number(c.url.searchParams.get("page") ?? 0) || 0) * 200).all()).results ?? [];
    return json2({ serverNow: now, matches: await matchRecs(env, eid, rows.map((r) => r.mid)), pauses: await pausesOf(env, eid) });
  }
  if ((sub === "stageon" || sub === "stagego") && method === "POST") {
    if (!c.allowed)
      return json2({ error: "Only the Organizer or a Host can do this." }, 403);
    if (t.state !== "open")
      return json2({ error: "The tournament has already started.", code: "started" }, 409);
    if (sub === "stageon") {
      try {
        await env.DB.prepare("INSERT OR IGNORE INTO ttt_sl(eid,slot,kind,pid,seq,body,at_ms) VALUES(?,?,?,?,?,?,?)").bind(eid, "_", "flag", "_", 0, "stages", now).run();
      } catch {
        return json2({ error: "The new flow is not switched on for this game.", code: "no-stages" }, 409);
      }
      return json2({ ok: true, stages: true });
    }
    if (!await stagesOn(env, eid))
      return json2({ error: "The new flow is not switched on for this game.", code: "no-stages" }, 409);
    const b = await c.body(req, 1024) ?? {};
    const rows = await env.DB.prepare("SELECT p.pid AS pid, p.pii AS pii, s.blocked AS blocked FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=?").bind(eid).all();
    const players = [];
    for (const r of rows.results ?? []) {
      if (r.blocked)
        continue;
      players.push({ pid: r.pid, name: cleanName2(await c.openName(r.pii)) });
    }
    if (players.length < 2)
      return json2({ error: `A game needs at least 2 players. ${players.length} joined.`, code: "too-few", joined: players.length }, 409);
    if (players.length > STAGE_MAX_PLAYERS)
      return json2({ error: `This game is for up to ${STAGE_MAX_PLAYERS} players.`, code: "too-many" }, 409);
    if (!await c.spend(env, now, players.length * 2 + 8))
      return c.BUSY();
    const beacon = typeof b.beacon === "string" ? b.beacon.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 128) : "";
    const seed = await seedOf(t.secret, eid, players.map((p) => p.pid), beacon);
    const startMs = Number.isFinite(Number(b.startMs)) && Number(b.startMs) >= now && Number(b.startMs) <= now + 3600000 ? Math.floor(Number(b.startMs)) : now;
    const stmts = [env.DB.prepare("UPDATE ttt_t SET state='running', opts=?, seed=?, players=?, started_ms=? WHERE eid=? AND state='open'").bind(JSON.stringify({ stages: true }), seed, players.length, startMs, eid)];
    for (const p of players)
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_p(eid,pid,name,ent) VALUES(?,?,?,NULL)").bind(eid, p.pid, p.name));
    for (let i = 0;i < stmts.length; i += 90)
      await env.DB.batch(stmts.slice(i, i + 90));
    return json2({ ok: true, players: players.length, commit: t.commit_hash, state: "running", startedMs: startMs, seed });
  }
  if (sub === "stagelog" && method === "POST") {
    if (!await stagesOn(env, eid))
      return json2({ error: "The new flow is not on for this game." }, 404);
    if (t.state !== "running")
      return json2({ error: "The game is not running.", code: "not-running" }, 409);
    if (t.pause_at)
      return json2({ error: "The host paused the game. Your clock waits.", code: "paused" }, 409);
    const b = await c.body(req, 1024) ?? {};
    const who = await playerOf(c, b.pid, b.device);
    if (who instanceof Response)
      return who;
    const slot = String(b.slot ?? ""), kind = String(b.kind ?? ""), seq = Number(b.seq), body = typeof b.body === "string" ? b.body : "";
    if (!STAGE_SLOT.test(slot) || kind !== "move" && kind !== "result" || !Number.isInteger(seq) || seq < 0 || seq > 40 || body.length > STAGE_ENTRY_BYTES)
      return json2({ error: "That entry is not valid." }, 400);
    const recent = (await env.DB.prepare("SELECT COUNT(*) AS n FROM ttt_sl WHERE eid=? AND pid=? AND at_ms>?").bind(eid, who.pid, now - 1000).first())?.n ?? 0;
    if (recent >= STAGE_WRITES_PER_SECOND)
      return json2({ error: "Slow down a little.", code: "rate" }, 429);
    const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM ttt_sl WHERE eid=?").bind(eid).first())?.n ?? 0;
    if (total >= STAGE_MAX_ENTRIES)
      return json2({ error: "The log of this game is full.", code: "full" }, 409);
    const r = await env.DB.prepare("INSERT OR IGNORE INTO ttt_sl(eid,slot,kind,pid,seq,body,at_ms) VALUES(?,?,?,?,?,?,?)").bind(eid, slot, kind, who.pid, seq, body, now).run();
    return json2({ ok: true, stored: (r.meta?.changes ?? 0) > 0 });
  }
  if (sub === "stagelog" && method === "GET") {
    if (!await stagesOn(env, eid))
      return json2({ error: "The new flow is not on for this game." }, 404);
    const q = c.url.searchParams, after = Math.max(0, Number(q.get("after") ?? 0) || 0), slot = q.get("slot");
    let rows;
    if (slot !== null) {
      if (!STAGE_SLOT.test(slot))
        return json2({ error: "That game slot is not valid." }, 400);
      rows = await env.DB.prepare("SELECT id, slot, kind, pid, seq, body, at_ms FROM ttt_sl WHERE eid=? AND slot=? AND kind<>'flag' AND id>? ORDER BY id LIMIT 200").bind(eid, slot, after).all();
    } else
      rows = await env.DB.prepare("SELECT id, slot, kind, pid, seq, body, at_ms FROM ttt_sl WHERE eid=? AND kind='result' AND id>? ORDER BY id LIMIT 1000").bind(eid, after).all();
    return new Response(JSON.stringify({ serverNow: now, entries: rows.results ?? [] }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=2" } });
  }
  if (sub === "view" && method === "GET") {
    await sweep(env, eid, now);
    const joined = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first())?.c ?? 0;
    const o = optsOf(t);
    const head = { serverNow: now, state: t.state, commit: t.commit_hash, paused: !!t.pause_at, joined, startedMs: t.started_ms, endedMs: t.ended_ms, endedEarly: endedEarly(t), ...await endedAtOf(env, c.e, now) };
    if (t.state === "open")
      return json2({ ...head, phase: "waiting" });
    const counts = (await env.DB.prepare("SELECT round, status, COUNT(*) AS n FROM ttt_m WHERE eid=? AND bye=0 GROUP BY round, status").bind(eid).all()).results ?? [];
    const flags = (await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_b WHERE eid=? AND flag=1").bind(eid).first())?.c ?? 0;
    return json2({ ...head, phase: t.state, format: o.format, teamSize: o.teamSize, moveSecs: (o.moveMs ?? 0) / 1000, players: t.players, entrants: t.entrants, rounds: t.rounds, perRound: counts.map((x) => ({ round: x.round, status: x.status, n: x.n })), disputed: flags, champion: t.champion ? (await env.DB.prepare("SELECT name FROM ttt_e WHERE eid=? AND id=?").bind(eid, t.champion).first())?.name ?? null : null, ranking: t.ranking ? JSON.parse(t.ranking).slice(0, 10) : [] });
  }
  if (sub === "all" && method === "GET") {
    if (t.state === "open")
      return json2({ matches: [] });
    const q = c.url.searchParams;
    const round = Number(q.get("round") ?? 0), page = Math.max(0, Number(q.get("page") ?? 0));
    const live = q.get("status") === "live";
    const rows = live ? (await env.DB.prepare("SELECT mid FROM ttt_m WHERE eid=? AND status='live' AND bye=0 ORDER BY round DESC, started_ms LIMIT ?").bind(eid, Math.min(LIVE_SAMPLE, Number(q.get("n") ?? LIVE_SAMPLE) || LIVE_SAMPLE)).all()).results ?? [] : (await env.DB.prepare("SELECT mid FROM ttt_m WHERE eid=? AND round=? ORDER BY idx LIMIT ? OFFSET ?").bind(eid, round, PAGE, page * PAGE).all()).results ?? [];
    return json2({ serverNow: now, matches: await matchRecs(env, eid, rows.map((r) => r.mid)), pauses: await pausesOf(env, eid) });
  }
  return json2({ error: "Not found" }, 404);
}
var PODIUM = ["first", "second", "third", "fourth", "fifth"];
var endedEarly = (t) => t.state === "done" && !t.champion;
async function endEarly(env, t, now) {
  const eid = t.eid;
  await env.DB.batch([
    env.DB.prepare("UPDATE ttt_t SET state='done', ended_ms=?, pause_at=NULL WHERE eid=? AND state<>'done'").bind(now, eid),
    env.DB.prepare("UPDATE ttt_z SET to_ms=? WHERE eid=? AND to_ms IS NULL").bind(now, eid),
    env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'phones') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='phones' WHERE life.purged_ms IS NULL").bind(eid, now)
  ]);
  t.state = "done";
}
async function finishWith(env, t, r, now) {
  const eid = t.eid;
  const o = optsOf(t);
  const endMs = now;
  const stmts = [env.DB.prepare("UPDATE ttt_t SET state='done', ended_ms=?, champion=?, ranking=? WHERE eid=?").bind(endMs, r.champion, JSON.stringify(r.ranking), eid)];
  r.podium.forEach((members, i) => {
    const place2 = PODIUM[i];
    if (!place2)
      return;
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settled(eid,pattern,ordinal,round,idx,pids) VALUES(?,?,?,?,?,?)").bind(eid, place2, 1, 1, 0, JSON.stringify(members)));
    for (const pid of members) {
      const seat = parseInt(pid, 10);
      if (Number.isFinite(seat))
        stmts.push(env.DB.prepare("INSERT OR REPLACE INTO winner(eid,round,pattern,ordinal,seat,idx,at_ms,src) VALUES(?,?,?,?,?,?,?,?)").bind(eid, 1, place2, 1, seat, 0, endMs, "ttt"));
    }
  });
  stmts.push(env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'phones') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='phones' WHERE life.purged_ms IS NULL").bind(eid, endMs));
  await env.DB.batch(stmts);
  t.state = "done";
}
async function matchRecs(env, eid, mids) {
  if (!mids.length)
    return [];
  const ph = mids.map(() => "?").join(",");
  const ms = (await env.DB.prepare(`SELECT * FROM ttt_m WHERE eid=? AND mid IN (${ph})`).bind(eid, ...mids).all()).results ?? [];
  const ev = (await env.DB.prepare(`SELECT mid, j, seq, pid, sq, client_ms, at_ms FROM ttt_mv WHERE eid=? AND mid IN (${ph}) ORDER BY mid, j, seq`).bind(eid, ...mids).all()).results ?? [];
  const rp = (await env.DB.prepare(`SELECT mid, j, pid, winner FROM ttt_r WHERE eid=? AND mid IN (${ph})`).bind(eid, ...mids).all()).results ?? [];
  const bs = (await env.DB.prepare(`SELECT mid, j, winner, how, flag, at_ms FROM ttt_b WHERE eid=? AND mid IN (${ph})`).bind(eid, ...mids).all()).results ?? [];
  return ms.map((m) => ({
    mid: m.mid,
    complete: m.status === "done",
    reg: { round: m.round, idx: m.idx, a: m.a, b: m.b, bye: !!m.bye, winner: m.winner, opened: m.deadline, ms: m.started_ms },
    boards: boardsOf(m).map(([a, b], j) => ({
      j,
      a,
      b,
      events: ev.filter((e) => e.mid === m.mid && e.j === j).map((e) => ({ seq: e.seq, pid: e.pid, sq: e.sq, ms: e.at_ms, client: e.client_ms })),
      reports: rp.filter((r) => r.mid === m.mid && r.j === j).map((r) => ({ pid: r.pid, winner: r.winner })),
      result: ((x) => x ? { winner: x.winner, how: x.how, ms: x.at_ms, ...x.flag ? { flag: true } : {} } : null)(bs.find((y) => y.mid === m.mid && y.j === j))
    }))
  }));
}

// src-tictactoe-4e40c2b/packages/beacon/src/config.ts
var PRIZE_HOUSES = [
  { id: "first", label: "Champion (1st)", how: "Wins the final.", max: 1, kind: "set", dflt: true, squares: "1st" },
  { id: "second", label: "Runner-up (2nd)", how: "Loses the final.", max: 1, kind: "set", dflt: true, squares: "2nd" },
  { id: "third", label: "3rd place", how: "Best of the two semi-final losers (round reached, then points, then points in the last match, then fate).", max: 1, kind: "set", dflt: true, squares: "3rd" },
  { id: "fourth", label: "4th place", how: "The other semi-final loser.", max: 1, kind: "set", dflt: true, squares: "4th" },
  { id: "fifth", label: "5th place", how: "Best of the quarter-final losers by the same order.", max: 1, kind: "set", dflt: true, squares: "5th" }
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
var MAX_ROUNDS = 5;
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
  const cfg = { tickets: base.tickets, rewards: base.rewards, breaks: base.breaks, rounds: base.rounds ?? 1, invites: base.invites ?? defaultInvites(), opening: base.opening ?? [], closing: base.closing ?? [], ...base.name ? { name: base.name } : {}, ...base.brand ? { brand: base.brand } : {}, ...base.mark ? { mark: base.mark } : {}, ...base.join ? { join: base.join } : {}, ...base.tz ? { tz: base.tz } : {}, ...base.verify ? { verify: base.verify } : {}, ...base.employeesOnly ? { employeesOnly: true } : {}, ...base.idKind === "email" ? { idKind: "email" } : {} };
  if (input.rounds !== undefined) {
    if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > MAX_ROUNDS)
      return { ok: false, error: `The number of rounds is a whole number from 1 to ${MAX_ROUNDS}.` };
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
          return { ok: false, error: `An opening lasts 15 to ${OPENING_WINDOW_SECONDS} seconds, in steps of 3.` };
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
function add2(Ah, Al, Bh, Bl) {
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
      ({ h: Eh, l: El } = add2(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
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
    ({ h: Ah, l: Al } = add2(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add2(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add2(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add2(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add2(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add2(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add2(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add2(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
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
function validateW(W2, bits) {
  if (!Number.isSafeInteger(W2) || W2 <= 0 || W2 > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W2);
}
function calcWOpts(W2, scalarBits) {
  validateW(W2, scalarBits);
  const windows = Math.ceil(scalarBits / W2) + 1;
  const windowSize = 2 ** (W2 - 1);
  const maxNumber = 2 ** W2;
  const mask = bitMask(W2);
  const shiftBy = BigInt(W2);
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
  precomputeWindow(point, W2) {
    const { windows, windowSize } = calcWOpts(W2, this.bits);
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
  wNAF(W2, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W2, this.bits);
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
  wNAFUnsafe(W2, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W2, this.bits);
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
  getPrecomputes(W2, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W2);
      if (W2 !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W2 = getW(point);
    return this.wNAF(W2, this.getPrecomputes(W2, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W2 = getW(point);
    if (W2 === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W2, this.getPrecomputes(W2, point, transform), scalar, prev);
  }
  createCache(P2, W2) {
    validateW(W2, this.bits);
    pointWindowSizes.set(P2, W2);
    pointPrecomputes.delete(P2);
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
    const { X, Y, Z, T: T2 } = p;
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
    const ZT = modP(Z * T2);
    if (XY !== ZT)
      throw new Error("bad point: equation left != right (2)");
    return true;
  });

  class Point {
    constructor(X, Y, Z, T2) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T2);
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
      const C2 = modP(_2n2 * modP(Z1 * Z1));
      const D = modP(a * A);
      const x1y1 = X1 + Y1;
      const E = modP(modP(x1y1 * x1y1) - A - B);
      const G = D + B;
      const F = G - C2;
      const H2 = D - B;
      const X3 = modP(E * F);
      const Y3 = modP(G * H2);
      const T3 = modP(E * H2);
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
      const C2 = modP(T1 * d * T2);
      const D = modP(Z1 * Z2);
      const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
      const F = D - C2;
      const G = D + C2;
      const H2 = modP(B - a * A);
      const X3 = modP(E * F);
      const Y3 = modP(G * H2);
      const T3 = modP(E * H2);
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
    let { X, Y, Z, T: T2 } = this.ep;
    const P2 = ed25519_CURVE_p;
    const mod2 = (n) => Fp.create(n);
    const u1 = mod2(mod2(Z + Y) * mod2(Z - Y));
    const u2 = mod2(X * Y);
    const u2sq = mod2(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod2(u1 * u2sq));
    const D1 = mod2(invsqrt * u1);
    const D2 = mod2(invsqrt * u2);
    const zInv = mod2(D1 * D2 * T2);
    let D;
    if (isNegativeLE(T2 * zInv, P2)) {
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

// src-tictactoe-4e40c2b/packages/beacon/src/control.ts
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
async function acceptLog(cfg, engagementId, incoming, known = []) {
  return (await acceptLogDetailed(cfg, engagementId, incoming, known)).log;
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
var cfgOf2 = (f) => ({ pubKey: f.pubKey, maxPauseRounds: f.maxPauseRounds, leadRounds: f.leadRounds });
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
  const cfg = cfgOf2(f);
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
function nextMessage(f, nowRound, a) {
  const lead = a.action === "resume" ? Math.max(1, a.inRounds ?? f.leadRounds) : Math.max(f.leadRounds, a.inRounds ?? 0);
  const at = nowRound + lead;
  const m = { engagementId: f.engagementId, seq: f.messages.length + 1, action: a.action, atBeaconRound: at, signedAtRound: nowRound };
  if (a.action === "pause" && a.pauseForRounds)
    m.untilRound = at + a.pauseForRounds;
  if (a.action === "extend") {
    const open = resolveControl(cfgOf2(f), f.messages).intervals.at(-1);
    m.untilRound = a.untilRound ?? (open ? open.end : at) + (a.addRounds ?? a.pauseForRounds ?? 0);
  }
  return m;
}
// games/tictactoe/kmatch.ts
var BAD_CELLS = [-1, 9, 10, 1.5, NaN, "4", null, undefined, Infinity, -0.5, 100, true];
function theory(b, rule = "T-11") {
  for (const g of b.games) {
    if (!g.result || g.result.kind === "forfeit")
      continue;
    let xm = 0, om = 0;
    const opt = { [g.x]: true, [g.o]: true };
    for (const m of g.moves) {
      if (!optimalCells(xm, om).includes(m.cell))
        opt[m.pid] = false;
      if (m.pid === g.x)
        xm |= 1 << m.cell;
      else
        om |= 1 << m.cell;
    }
    if (g.result.kind === "win") {
      const loser = g.result.winner === g.x ? g.o : g.x;
      ck(!opt[loser], rule, () => `${loser} lost game ${g.no} although every move was optimal`);
    } else
      ck(g.result.kind === "draw", rule);
    if (opt[g.x] && opt[g.o])
      ck(g.result.kind === "draw", rule, () => `two optimal players did not draw game ${g.no}`);
  }
}
async function kMatch(rng) {
  const seed = rng.hex(32);
  const mid = `r${rng.int(1, 6)}m${rng.int(0, 63)}`, j = rng.int(0, 4);
  const moveMs = rng.chance(0.8) ? rng.pick([10, 20, 30, 60]) * 1000 : rng.int(2, 90) * 1000 + rng.int(0, 999);
  const readyMs = rng.chance(0.7) ? rng.pick([15000, 30000]) : rng.int(3, 120) * 1000 + rng.int(0, 999);
  const T0 = 1e6 + rng.int(0, 2000000000);
  const style = rng.int(0, 2);
  const n1 = rng.int(1, 9998);
  const a = pidOf(style, n1), b = pidOf(style, n1 + rng.int(1, 1));
  const sa = rng.weighted(STRATS), sb = rng.weighted(STRATS);
  const pa = rng.weighted(PROFS), pb = rng.weighted(PROFS);
  const illegalRate = rng.pick([0, 0, 0.08, 0.25]);
  let pausesLeft = rng.weighted([[0, 70], [1, 20], [2, 10]]);
  const lookRate = rng.pick([0, 0.2, 0.5]);
  Object.assign(C.params, { kind: "match", seed, mid, j, moveMs, readyMs, T0, a, b, sa, sb, pa, pb, illegalRate, pausesLeft, lookRate });
  const cfg = { seed, moveMs, readyMs };
  const B = await newBoard(cfg, mid, j, a, b, T0), OB = oNew(cfg, mid, j, a, b, T0);
  let now = T0 + rng.int(0, 2000);
  let bad = false, illegal = 0, shifted = 0;
  const accepted = [];
  T(() => `board ${mid}/${j} ${a} vs ${b} seed ${seed.slice(0, 8)}.. move ${moveMs} ready ${readyMs} strategies ${sa}/${sb}`);
  const cmp = async (why) => {
    await advanceBoard(cfg, mid, B, now);
    oAdvance(cfg, mid, OB, now);
    const se = sigE(B), so = sigO(OB);
    if (!ck(se === so, "T-07", () => `${why} @${now}: engine ${se} || model ${so}`))
      bad = true;
  };
  const attempt = async (pid, cell, ply) => {
    await cmp("before tap");
    if (bad)
      return;
    const before = sigE(B);
    const ot = oMove(cfg, mid, OB, pid, cell, now, ply);
    const res = await applyMove(cfg, mid, B, pid, cell, now, ply);
    T(() => `tap ${pid} cell ${String(cell)} ply ${ply} @${now}: engine ${res.ok ? "ok" : res.error}; model ${ot.ok ? "ok" : ot.causes.join("/")}`);
    if (ot.ok) {
      if (ck(res.ok, "T-01", () => `a legal tap was refused: ${res.error} (${pid} ${String(cell)})`))
        accepted.push({ pid, cell, now });
    } else {
      illegal++;
      ck(!res.ok && ot.causes.includes(res.error), "T-01", () => `engine said ${res.ok ? "ok" : res.error}, model says ${ot.causes.join("/")}`);
      ck(sigE(B) === before, "T-01", () => "a refused tap changed the board");
    }
    await cmp("after tap");
  };
  await cmp("start");
  for (let step = 0;step < 170 && !bad && !B.done; step++) {
    const g = lastGame(B);
    const mover = moverOf(g);
    const opp = mover === a ? b : a;
    const strat = mover === a ? sa : sb, prof = mover === a ? pa : pb;
    const win = g.moves.length === 0 && g.no === 1 ? readyMs : moveMs;
    const r = rng.float();
    if (r < illegalRate) {
      const v = rng.int(0, 5);
      const empt = masksOf(g.cells);
      const free = [];
      for (let i = 0;i < 9; i++)
        if (!((empt[0] | empt[1]) >> i & 1))
          free.push(i);
      const taken = [];
      for (let i = 0;i < 9; i++)
        if ((empt[0] | empt[1]) >> i & 1)
          taken.push(i);
      now += rng.int(0, 400);
      if (v === 0)
        await attempt(opp, rng.pick(free.length ? free : [0]), rng.chance(0.5) ? g.moves.length : undefined);
      else if (v === 1)
        await attempt(mover, taken.length ? rng.pick(taken) : 4);
      else if (v === 2)
        await attempt(mover, rng.pick(BAD_CELLS));
      else if (v === 3)
        await attempt(rng.pick(["outsider", "", a + "x"]), rng.pick(free.length ? free : [0]));
      else if (v === 4)
        await attempt(mover, rng.pick(free.length ? free : [0]), g.moves.length + rng.pick([-2, -1, 1, 2]));
      else
        await attempt(opp, rng.pick(BAD_CELLS));
    } else if (pausesLeft > 0 && r < illegalRate + 0.05) {
      await cmp("before pause");
      const L = rng.int(1, 120000);
      shiftBoard(B, L);
      oShift(OB, L);
      now += L;
      pausesLeft--;
      shifted++;
      T(() => `pause of ${L} ms`);
      await cmp("after pause");
    } else if (strat === "absent") {
      now = g.deadline + 1 + rng.int(0, Math.floor(win * 0.5));
      await cmp("clock ran out");
    } else {
      const cell = chooseCell(strat, g.cells, mover === g.x ? 1 : 2, rng);
      const seen = g.moves.length;
      if (rng.chance(0.07))
        now = Math.max(now, g.deadline + (rng.chance(0.5) ? 0 : 1));
      else
        now += thinkMs(prof, win, rng);
      await attempt(mover, cell, rng.chance(0.6) ? seen : undefined);
    }
    if (!bad && rng.chance(lookRate)) {
      now += rng.int(0, 3000);
      await cmp("extra look");
    }
  }
  await cmp("end");
  if (bad) {
    C.dims.board = "mismatch";
    return;
  }
  ck(B.done, "T-10", () => "the board never ended");
  if (!B.done)
    return;
  const illegalWhilePlaying = illegal;
  await attempt(a, 0);
  await attempt(b, 4);
  await attempt("outsider", 4, 0);
  ck(B.winner === a || B.winner === b, "T-10", () => `winner ${B.winner}`);
  ck(B.games.length >= 1 && B.games.length <= 3, "T-03", () => `games ${B.games.length}`);
  ck(B.games.slice(0, -1).every((g) => g.result?.kind === "draw"), "T-03", () => "an earlier game was not a draw");
  const last2 = B.games[B.games.length - 1];
  if (B.via === "fate") {
    ck(B.games.length === 3 && B.games.every((g) => g.result?.kind === "draw"), "T-03");
    const fa = fateO(seed, mid, j, a), fb = fateO(seed, mid, j, b);
    ck(B.winner === (fa < fb ? a : b), "T-03", () => "fate winner differs from the recomputed lower fate");
  } else
    ck(last2.result?.kind === (B.via === "win" ? "win" : "forfeit"), "T-10", () => `via ${B.via} but last game ${last2.result?.kind}`);
  if (B.via === "win") {
    const line = last2.result.line;
    const w = last2.result.winner;
    ck(line.length === 3 && line.every((c) => last2.cells[c] === (w === last2.x ? 1 : 2)), "T-02", () => "the winning line is not three of the winner's marks");
  }
  const decisive = B.games.filter((g) => g.result?.kind === "win" || g.result?.kind === "forfeit").length, drawn = B.games.filter((g) => g.result?.kind === "draw").length;
  ck(B.points[a] + B.points[b] === 2 * decisive + 2 * drawn, "T-10", () => `points ${B.points[a]}+${B.points[b]} for ${decisive} decided and ${drawn} drawn games`);
  ck(B.games[0].x === (coinO(seed, `first|${mid}|${j}`) ? a : b), "T-04", () => "game 1 starter is not the seeded coin");
  if (B.games.length >= 2)
    ck(B.games[1].x === B.games[0].o, "T-03", () => "game 2 did not swap the marks");
  if (B.games.length >= 3)
    ck(B.games[2].x === (coinO(seed, `third|${mid}|${j}`) ? a : b), "T-04", () => "game 3 starter is not its own coin");
  for (const g of B.games) {
    let missedRun = {};
    let okRun = true;
    for (const m of g.moves) {
      if (m.auto) {
        missedRun[m.pid] = (missedRun[m.pid] ?? 0) + 1;
        if (missedRun[m.pid] >= 2)
          okRun = false;
      } else
        missedRun[m.pid] = 0;
    }
    ck(okRun, "T-05", () => "two clock-outs in a row in one game did not end the board");
  }
  if (shifted === 0) {
    let prevEnd = T0 + readyMs - moveMs;
    for (const g of B.games) {
      let dl = g.no === 1 ? T0 + readyMs : prevEnd + moveMs;
      let xm = 0, om = 0;
      for (const m of g.moves) {
        if (m.auto) {
          const free = [];
          for (let i = 0;i < 9; i++)
            if (!((xm | om) >> i & 1))
              free.push(i);
          ck(m.at === dl, "T-06", () => `clock-out move ${m.ply} of game ${g.no} stamped ${m.at}, its clock ran out at ${dl}`);
          ck(m.cell === free[belowO(seed, `auto|${mid}|${j}|${g.no}|${m.ply}`, free.length)], "T-06", () => `clock-out square ${m.cell} is not the seeded pick of ${free}`);
        }
        if (m.pid === g.x)
          xm |= 1 << m.cell;
        else
          om |= 1 << m.cell;
        dl = m.at + moveMs;
      }
      prevEnd = g.result?.at ?? prevEnd;
    }
  }
  const rp = shifted === 0 ? oReplay(cfg, mid, B, T0) : { B: null, err: null };
  if (shifted === 0)
    ck(rp.err === null && sigO(rp.B) === sigE(B), "T-09", () => rp.err ?? `replay ${sigO(rp.B)} vs ${sigE(B)}`);
  theory(B);
  if (shifted === 0) {
    const B2 = await newBoard(cfg, mid, j, a, b, T0);
    for (const m of accepted)
      await applyMove(cfg, mid, B2, m.pid, m.cell, m.now);
    await advanceBoard(cfg, mid, B2, now);
    ck(sigE(B2) === sigE(B), "T-08", () => `lazy ${sigE(B2)} vs ${sigE(B)}`);
  }
  C.dims.board = B.via;
  C.dims.games = B.games.length;
  C.dims.strategies = [sa, sb].sort().join("+");
  C.dims.illegal = illegalWhilePlaying > 0 ? "yes" : "no";
  C.dims.pausedBoard = shifted > 0 ? "yes" : "no";
  C.dims.clockOut = B.games.some((g) => g.moves.some((m) => m.auto)) || B.via === "forfeit" ? "yes" : "no";
}
function kExhaustive() {
  const eo = enumO();
  ck(eo.games === 255168 && eo.x === 131184 && eo.o === 77904 && eo.d === 46080, "T-12", () => `model counted ${JSON.stringify(eo)}`);
  const want = [0, 0, 0, 0, 0, 1440, 5328, 47952, 72576, 127872];
  ck(want.every((v, i) => eo.byPly[i] === v), "T-12", () => `model by length ${eo.byPly}`);
  let games = 0, x = 0, o = 0, d = 0, nodes = 0, badTurn = 0, badLine = 0;
  const byPly = Array(10).fill(0);
  const go = (cells, ply) => {
    nodes++;
    const oc = outcomeOf(cells);
    const [xm, om] = masksOf(cells);
    const code = outcomeCode(xm, om);
    if (oc.kind === "playing") {
      if (code !== 0)
        badLine++;
    } else if (oc.kind === "draw") {
      if (code !== 3)
        badLine++;
    } else if (code !== oc.mark)
      badLine++;
    if (oc.kind !== "playing") {
      games++;
      byPly[ply]++;
      if (oc.kind === "draw")
        d++;
      else if (oc.mark === 1)
        x++;
      else
        o++;
      return;
    }
    const mk = markToMove(cells);
    if (mk !== ((ply & 1) === 0 ? 1 : 2))
      badTurn++;
    for (const c of emptiesOf(cells))
      go(place(cells, c, mk), ply + 1);
  };
  go(emptyCells(), 0);
  C.checks += nodes;
  ck(badLine === 0 && badTurn === 0, "T-02", () => `${badLine} positions with a wrong outcome, ${badTurn} with a wrong turn`);
  ck(games === 255168 && x === 131184 && o === 77904 && d === 46080 && nodes === eo.nodes, "T-12", () => `engine pieces counted ${games}/${x}/${o}/${d} in ${nodes} positions`);
  ck(want.every((v, i) => byPly[i] === v), "T-12", () => `engine by length ${byPly}`);
  ck(mmValue(0, 0) === 0, "T-11", () => "the empty board is not a draw with perfect play");
}

// games/tictactoe/ktour.ts
var BAD_CELLS2 = [-1, 9, 1.5, NaN, "2", null, undefined, 100];
function tsig(t) {
  let s = `${t.done ? 1 : 0}`;
  for (const m of Object.values(t.matches)) {
    s += `#${m.mid}:${m.status}:${m.a}:${m.b}:${m.winner ?? ""}`;
    if (m.status === "live")
      for (const b of m.boards)
        s += `~${b.j}${sigE(b)}`;
  }
  return s;
}
async function drive(t, players, rng, o) {
  const cfg = cfgOf(t);
  let now = o.now, moves = 0, illegal = 0, iter = 0, stuck = false;
  const due0 = new Map;
  while (!t.done && iter++ < 80000) {
    await advanceTournament(t, now);
    if (t.done)
      break;
    let next = Infinity;
    const due = [];
    for (const m of Object.values(t.matches)) {
      if (m.status !== "live")
        continue;
      for (const b of m.boards) {
        if (b.done)
          continue;
        const g = lastGame(b), mover = moverOf(g), pl = players.get(mover);
        next = Math.min(next, g.deadline + 1);
        if (pl.strat === "absent")
          continue;
        const win = g.moves.length === 0 && g.no === 1 ? t.readyMs : t.moveMs;
        const key = `${m.mid}|${b.j}|${g.no}|${g.moves.length}`;
        let td = due0.get(key);
        if (td === undefined) {
          td = g.deadline - win + thinkMs(pl.prof, win, rng);
          if (td >= pl.awayFrom && td < pl.backAt)
            td = pl.backAt === Infinity ? Infinity : pl.backAt + 1;
          due0.set(key, td);
        }
        if (td <= now)
          due.push({ m, b, pid: mover, ply: g.moves.length });
        else
          next = Math.min(next, td);
      }
    }
    if (o.mode === "route" && o.illegalRate > 0 && rng.chance(o.illegalRate)) {
      const pid = rng.chance(0.15) ? "outsider" : rng.pick(o.roster);
      const g0 = boardOf(t, pid)?.board.games.slice(-1)[0];
      const free = [];
      if (g0) {
        for (let i = 0;i < 9; i++)
          if (g0.cells[i] === 0)
            free.push(i);
      }
      const v = rng.int(0, 3);
      const cell = v === 0 ? rng.pick(free.length ? free : [0]) : v === 1 ? rng.pick(BAD_CELLS2) : rng.int(0, 8);
      const ply = v === 2 && g0 ? g0.moves.length + rng.pick([-1, 1]) : undefined;
      const before = tsig(t);
      let causes = [];
      let legal = false;
      const f = boardOf(t, pid);
      if (!f)
        causes = ["no-live-board"];
      else {
        const g = lastGame(f.board);
        const [xm, om] = masksOf(g.cells);
        if (ply !== undefined && ply !== g.moves.length)
          causes.push("stale");
        if (moverOf(g) !== pid)
          causes.push("not-your-turn");
        const valid = typeof cell === "number" && Number.isInteger(cell) && cell >= 0 && cell <= 8;
        if (!valid)
          causes.push("bad-square");
        else if ((xm | om) >> cell & 1)
          causes.push("square-taken");
        legal = causes.length === 0;
      }
      const r = await moveInTournament(t, pid, cell, now, ply);
      if (legal) {
        if (ck(r.ok, "T-28", () => `a legal tap by ${pid} was refused: ${r.error}`)) {
          moves++;
          o.record?.push({ e: now, pid, cell, ply });
        }
      } else {
        illegal++;
        ck(!r.ok && causes.includes(r.error), "T-28", () => `engine ${r.ok ? "ok" : r.error}, model ${causes.join("/")}`);
        ck(tsig(t) === before, "T-28", () => "a refused tap changed the tournament");
      }
      continue;
    }
    if (due.length) {
      for (const d of due) {
        const g = lastGame(d.b);
        if (d.b.done || moverOf(g) !== d.pid || g.moves.length !== d.ply)
          continue;
        const pl = players.get(d.pid);
        const cell = chooseCell(pl.strat, g.cells, d.pid === g.x ? 1 : 2, rng);
        const ply = rng.chance(0.5) ? d.ply : undefined;
        const r = o.mode === "route" ? await moveInTournament(t, d.pid, cell, now, ply) : await applyMove(cfg, d.m.mid, d.b, d.pid, cell, now, ply);
        if (ck(r.ok, "T-28", () => `a bot tap by ${d.pid} on ${d.m.mid} was refused: ${r.error}`)) {
          moves++;
          o.record?.push({ e: now, pid: d.pid, cell, ply });
        }
      }
      continue;
    }
    if (next === Infinity) {
      stuck = true;
      break;
    }
    now = next;
  }
  if (!t.done) {
    await advanceTournament(t, now);
  }
  return { now, moves, illegal, stuck: stuck || !t.done };
}
async function verifyTournament(t, roster, format, teamSize) {
  const ob = oBracket(t.seed, roster, format, teamSize);
  ck(t.size === ob.size && t.rounds === ob.rounds, "T-20", () => `size ${t.size}/${ob.size} rounds ${t.rounds}/${ob.rounds}`);
  ck(t.entrants.length === ob.entrants.length && t.entrants.every((e, i) => e.id === ob.entrants[i].id && e.members.join(",") === ob.entrants[i].members.join(",")), "T-22", () => "the entrants (or the teams cut from the seeded shuffle) differ from the model");
  ck(t.reserve.join(",") === ob.reserve.join(","), "T-22", () => "reserve players differ");
  if (format === "team")
    ck(t.reserve.length === roster.length % teamSize && t.entrants.length === Math.floor(roster.length / teamSize), "T-22");
  let byes = 0, played = 0;
  for (let i = 0;i < ob.r1.length; i++) {
    const m = t.matches[midOf(1, i)];
    ck(m.a === ob.r1[i].a && m.b === ob.r1[i].b, "T-20", () => `round 1 match ${i}: ${m.a}/${m.b} vs model ${ob.r1[i].a}/${ob.r1[i].b}`);
  }
  const cfg = cfgOf(t);
  const entOf = new Map(t.entrants.map((e) => [e.id, e]));
  for (const m of Object.values(t.matches)) {
    if (m.bye) {
      byes++;
      ck(m.round === 1 && m.a === null !== (m.b === null) && m.winner === (m.a ?? m.b) && m.boards.length === 0, "T-20", () => `bye match ${m.mid} is wrong`);
      continue;
    }
    played++;
    ck(m.status === "done" && !!m.a && !!m.b && (m.winner === m.a || m.winner === m.b) && m.loser === (m.winner === m.a ? m.b : m.a), "T-23", () => `match ${m.mid} ${m.status} ${m.a}/${m.b} winner ${m.winner}`);
    if (m.round > 1) {
      const f1 = t.matches[midOf(m.round - 1, 2 * m.idx)], f2 = t.matches[midOf(m.round - 1, 2 * m.idx + 1)];
      ck(m.a === f1.winner && m.b === f2.winner, "T-21", () => `match ${m.mid} has ${m.a}/${m.b} but its feeders were won by ${f1.winner}/${f2.winner}`);
      ck(m.startedAt >= Math.max(f1.doneAt ?? 0, f2.doneAt ?? 0), "T-25", () => `match ${m.mid} started before its feeders ended`);
    } else
      ck(m.startedAt === t.startAt, "T-25");
    const A = entOf.get(m.a);
    const k = format === "team" ? teamSize : 1;
    ck(m.boards.length === k && A.members.length === k, "T-22", () => `match ${m.mid} has ${m.boards.length} boards`);
    let winsA = 0, doneAt = 0;
    for (const b of m.boards) {
      ck(b.done && (b.winner === b.a || b.winner === b.b), "T-23", () => `board ${m.mid}/${b.j} has no proper winner`);
      if (b.winner === A.members[b.j])
        winsA++;
      const rp = oReplay(cfg, m.mid, b, m.startedAt);
      ck(rp.err === null && sigO(rp.B) === sigE(b), "T-09", () => `${m.mid}/${b.j}: ${rp.err ?? sigO(rp.B) + " vs " + sigE(b)} || record ${sigE(b)} || replay ${sigO(rp.B)}`);
      theory(b);
      for (const g of b.games)
        doneAt = Math.max(doneAt, g.result?.at ?? 0);
    }
    ck(m.winner === (winsA * 2 > k ? m.a : m.b), "T-22", () => `match ${m.mid}: side A won ${winsA} of ${k} boards but the winner is ${m.winner}`);
    ck(m.doneAt === doneAt, "T-25", () => `match ${m.mid} doneAt ${m.doneAt} vs ${doneAt}`);
  }
  ck(byes === ob.size - ob.entrants.length, "T-20", () => `byes ${byes} vs ${ob.size - ob.entrants.length}`);
  ck(played === ob.entrants.length - 1 || ob.entrants.length === 0, "T-21", () => `played ${played} of ${ob.entrants.length - 1}`);
  const fin = t.matches[midOf(t.rounds, 0)];
  ck(t.done && t.champion === fin.winner, "T-21", () => `champion ${t.champion} vs final winner ${fin.winner}`);
  const rows = await rankings(t);
  const orows = oRank(t.seed, t.entrants, Object.values(t.matches), t.rounds, t.champion);
  ck(rows.length === orows.length && rows.every((r, i) => r.id === orows[i].id && r.rank === i + 1 && r.rank === orows[i].rank && r.points === orows[i].points && r.roundReached === orows[i].roundReached && r.lastMatchPoints === orows[i].lastMatchPoints && r.decidedBy === orows[i].decidedBy && r.fate === orows[i].fate), "T-24", () => `ranking differs: ${rows.slice(0, 4).map((r) => r.id + ":" + r.points).join(",")} vs ${orows.slice(0, 4).map((r) => r.id + ":" + r.points).join(",")}`);
  ck(rows[0].id === t.champion && (rows.length < 2 || rows[1].id === fin.loser), "T-24", () => "champion is not rank 1 or the final's loser is not rank 2");
  ck(new Set(rows.map((r) => r.rank)).size === rows.length, "T-24");
  const pv = JSON.stringify(publicView(t));
  ck(!pv.includes(t.seed), "T-26", () => "the public view contains the seed");
}
function makePlayers(rng, roster, startAt, mix, absentShare, awayShare) {
  const m = new Map;
  for (const pid of roster) {
    const strat = rng.chance(absentShare) ? "absent" : mix === "perfect" ? "perfect" : rng.weighted([["random", 30], ["greedy", 28], ["perfect", 16], ["blunder", 6]]);
    const prof = rng.weighted(PROFS);
    let awayFrom = Infinity, backAt = Infinity;
    if (rng.chance(awayShare)) {
      awayFrom = startAt + rng.int(0, 240000);
      backAt = rng.chance(0.5) ? Infinity : awayFrom + rng.int(1000, 200000);
    }
    m.set(pid, { pid, strat, prof, awayFrom, backAt });
  }
  return m;
}
async function kTournament(rng) {
  const nb = rng.weighted([["2", 10], ["3-4", 26], ["5-8", 34], ["9-16", 22], ["17+", 8]]);
  const format = rng.chance(0.18) ? "team" : "solo";
  const teamSize = format === "team" ? rng.pick([3, 5]) : 1;
  let n = nb === "2" ? 2 : nb === "3-4" ? rng.int(3, 4) : nb === "5-8" ? rng.int(5, 8) : nb === "9-16" ? rng.int(9, 16) : rng.int(17, 40);
  if (format === "team")
    n = Math.max(n, 2 * teamSize) + rng.int(0, teamSize - 1);
  const style = rng.int(0, 2);
  const base = rng.int(1, 5000);
  const roster = rng.shuffle(Array.from({ length: n }, (_, i) => pidOf(style, base + i)));
  const moveMs = rng.pick([10, 20, 30, 60]) * 1000, readyMs = rng.pick([15000, 30000]);
  const startAt = 1e6 + rng.int(0, 2000000000);
  const eid = "E" + rng.hex(4), secret = rng.hex(32), beacon = rng.chance(0.3) ? rng.hex(4) : "";
  const mix = rng.chance(0.08) ? "perfect" : "mixed";
  const absentShare = rng.pick([0, 0, 0, 0.1, 0.3, 0.6, 1]);
  const awayShare = rng.pick([0, 0, 0, 0.15, 0.4]);
  const illegalRate = rng.pick([0, 0.15, 0.4]);
  Object.assign(C.params, { kind: "tournament", eid, sealInput: secret.slice(0, 8), beacon, n, format, teamSize, moveMs, readyMs, startAt, roster, mix, absentShare, awayShare, illegalRate });
  const commit = await commitOf(secret), seed = await seedOf(secret, eid, roster, beacon);
  ck(commit === commitO(secret), "T-27", () => "commit differs from sha256('TTT-COMMIT|' + secret)");
  ck(seed === seedO(secret, eid, roster, beacon), "T-27", () => "seed differs from the model");
  ck(await verifyReveal(secret, commit), "T-27", () => "a true secret does not verify");
  ck(!await verifyReveal(secret + "0", commit), "T-27", () => "a wrong secret verifies");
  ck(await seedOf(secret, eid, [...roster].reverse(), beacon) === seed, "T-27", () => "the seed depends on the order of the roster");
  ck(await seedOf(secret, eid, roster, beacon + "x") !== seed, "T-27", () => "the beacon does not change the seed");
  const mk = (r) => startTournament({ eid, seed, players: r.map((pid, i) => ({ pid, name: `N${i}` })), format, teamSize, moveMs, readyMs, startAt });
  const t = await mk(roster);
  if (n <= 40 && rng.chance(0.3)) {
    const t2 = await mk([...roster].reverse());
    ck(JSON.stringify(t2.matches) === JSON.stringify(t.matches), "T-20", () => "the order the names arrive in changes the bracket");
  }
  const players = makePlayers(rng, roster, startAt, mix, absentShare, awayShare);
  const mode = t.entrants.length <= 16 ? "route" : "batch";
  T(() => `tournament ${eid}: ${n} players, ${format}${teamSize > 1 ? teamSize : ""}, size ${t.size}, rounds ${t.rounds}, mode ${mode}`);
  const out = await drive(t, players, rng, { mode, illegalRate, record: null, now: startAt + rng.int(0, 3000), roster });
  ck(!out.stuck && t.done, "T-21", () => `the tournament did not finish (stuck=${out.stuck})`);
  if (t.done)
    await verifyTournament(t, roster, format, teamSize);
  C.dims.players = bucket(n);
  C.dims.format = format === "solo" ? "solo" : `team${teamSize}`;
  C.dims.byes = t.size > t.entrants.length ? "some" : "none";
  C.dims.mix = mix === "perfect" ? "all-perfect" : absentShare >= 0.6 ? "mostly-absent" : absentShare > 0 ? "some-absent" : "all-present";
  C.dims.illegalTaps = out.illegal > 0 ? "yes" : "no";
  C.dims.removed = awayShare > 0 ? "yes" : "no";
}
var sigNoTime = (b) => `${b.done}|${b.winner}|${b.via}|${b.points[b.a]},${b.points[b.b]}` + b.games.map((g) => `;${g.x},${g.o},${g.cells.join("")},${g.result ? g.result.kind + (g.result.winner ?? "") : ""},${g.moves.map((m) => `${m.pid}:${m.cell}${m.auto ? "*" : ""}`).join(" ")}`).join("");
async function kPause(rng) {
  const n = rng.int(2, 8);
  const style = rng.int(0, 2);
  const base = rng.int(1, 5000);
  const roster = Array.from({ length: n }, (_, i) => pidOf(style, base + i));
  const moveMs = rng.pick([10, 20, 30, 60]) * 1000, readyMs = rng.pick([15000, 30000]);
  const startAt = 1e6 + rng.int(0, 2000000000);
  const seed = rng.hex(32);
  const absentShare = rng.pick([0, 0.2, 0.5]);
  const mk = () => startTournament({ eid: "P" + seed.slice(0, 6), seed, players: roster.map((pid) => ({ pid, name: pid })), moveMs, readyMs, startAt });
  const A = await mk();
  const players = makePlayers(rng, roster, startAt, "mixed", absentShare, 0);
  const script = [];
  const out = await drive(A, players, rng, { mode: "route", illegalRate: 0, record: script, now: startAt + rng.int(0, 2000), roster });
  const k = rng.weighted([[1, 45], [2, 35], [3, 20]]);
  const ps = [];
  let lastP = startAt;
  for (let i = 0;i < k; i++) {
    const p = lastP + rng.int(1, Math.max(2, Math.floor((out.now - startAt) / k))) + 0.5;
    if (p >= out.now)
      break;
    ps.push({ p, L: rng.pick([1, 999, 15000, 61000, 300000, 3600000]) + rng.int(0, 500) });
    lastP = p;
  }
  Object.assign(C.params, { kind: "pause", seed, n, moveMs, readyMs, startAt, absentShare, pauses: ps, steps: script.length });
  ck(!out.stuck && A.done, "T-30", () => "the reference tournament did not finish");
  if (!A.done)
    return;
  const B = await mk();
  let shift = 0, pi = 0;
  const pauseBefore = async (e) => {
    while (pi < ps.length && ps[pi].p < e) {
      await advanceTournament(B, ps[pi].p + shift);
      shiftTournament(B, ps[pi].L);
      shift += ps[pi].L;
      pi++;
    }
  };
  for (const s of script) {
    await pauseBefore(s.e);
    const r = await moveInTournament(B, s.pid, s.cell, s.e + shift, s.ply);
    ck(r.ok, "T-30", () => `the same tap after a pause was refused: ${r.error}`);
  }
  await pauseBefore(out.now);
  await advanceTournament(B, out.now + shift);
  ck(B.done && B.champion === A.champion, "T-30", () => `with pauses: done=${B.done} champion ${B.champion} vs ${A.champion}`);
  const before = (x) => ps.reduce((s, q) => s + (q.p < x ? q.L : 0), 0);
  if (B.done) {
    let same = true;
    for (const [mid, ma] of Object.entries(A.matches)) {
      const mb = B.matches[mid];
      if (ma.status !== mb.status || ma.a !== mb.a || ma.b !== mb.b || ma.winner !== mb.winner || ma.boards.length !== mb.boards.length) {
        same = false;
        break;
      }
      if (ma.startedAt !== undefined && mb.startedAt !== ma.startedAt + before(ma.startedAt)) {
        same = false;
        break;
      }
      if (ma.doneAt !== undefined && mb.doneAt !== ma.doneAt + before(ma.doneAt)) {
        same = false;
        break;
      }
      for (let j = 0;j < ma.boards.length; j++) {
        const ba = ma.boards[j], bb = mb.boards[j];
        if (sigNoTime(ba) !== sigNoTime(bb)) {
          same = false;
          break;
        }
        for (let gi = 0;gi < ba.games.length; gi++) {
          const ga = ba.games[gi], gb = bb.games[gi];
          for (let mi = 0;mi < ga.moves.length; mi++)
            if (gb.moves[mi].at !== ga.moves[mi].at + before(ga.moves[mi].at))
              same = false;
          if (ga.result && gb.result.at !== ga.result.at + before(ga.result.at))
            same = false;
        }
      }
      if (!same)
        break;
    }
    ck(same, "T-30", () => "a pause changed the play (moves, winners, points) or moved a stamp by something other than the pauses before it");
    const ra = await rankings(A), rb = await rankings(B);
    ck(ra.map((r) => `${r.id}${r.rank}${r.points}${r.decidedBy}`).join() === rb.map((r) => `${r.id}${r.rank}${r.points}${r.decidedBy}`).join(), "T-30", () => "the ranking changed with pauses");
  }
  C.dims.players = bucket(n);
  C.dims.pauses = String(ps.length);
  C.dims.mix = absentShare > 0 ? "some-absent" : "all-present";
}

// games/tictactoe/kmail.ts
async function kMail(rng) {
  const n = rng.weighted([[2, 10], [3, 15], [4, 15], [5, 12], [8, 18], [11, 12], [16, 10], [24, 8]]);
  const style = rng.int(0, 2);
  const base = rng.int(1, 5000);
  const roster = rng.shuffle(Array.from({ length: n }, (_, i) => ({ pid: pidOf(style, base + i), name: `Player ${i + 1}` })));
  const moveMs = rng.pick([10, 20, 30, 60]) * 1000, readyMs = rng.pick([15000, 30000]);
  const T0 = 1e6 + rng.int(0, 2000000000);
  const seed = rng.hex(32);
  const eid = "M" + rng.hex(3);
  const setup = { eid, state: "running", commit: "c", seed, roster, opts: { format: "solo", teamSize: 1, moveMs, readyMs }, startedMs: T0, pauses: [], serverNow: T0 };
  Object.assign(C.params, { kind: "mailbox", eid, seed, roster: roster.map((r) => r.pid), moveMs, readyMs, T0 });
  const plan = await planOf(setup);
  const ob = oBracket(seed, roster.map((r) => r.pid), "solo", 1);
  ck(plan.t.size === ob.size && plan.t.rounds === ob.rounds, "T-33", () => "phone bracket size differs from the model");
  const r1 = Object.values(plan.t.matches).filter((m) => m.round === 1).sort((x, y) => x.idx - y.idx);
  ck(r1.every((m, i) => m.a === ob.r1[i].a && m.b === ob.r1[i].b), "T-33", () => "phone round-1 pairs differ from the model");
  const pay = planPayload(plan);
  ck(pay.matches.length === plan.t.size / 2 && pay.rounds === plan.t.rounds && pay.digest === plan.digest, "T-33", () => "the draw sent to the mailbox lists the wrong number of matches");
  ck(pay.matches.filter((m) => m.bye).length === plan.t.size - n && pay.matches.every((m) => m.bye ? m.boards.length === 0 && !!m.winner : m.boards.length === 1 && m.boards[0].length === 2), "T-33", () => "byes carry a winner and no board; real matches carry one board of two");
  const rev = await planOf({ ...setup, roster: [...roster].reverse() });
  ck(rev.digest === plan.digest && JSON.stringify(rev.t.matches) === JSON.stringify(plan.t.matches), "T-33", () => "the order the list arrives in changes the phone bracket");
  const direct = await startTournament({ eid, seed, players: roster, format: "solo", moveMs, readyMs, startAt: T0 });
  ck(JSON.stringify(direct.matches) === JSON.stringify(plan.t.matches), "T-33", () => "planOf is not what startTournament makes");
  const other = await planOf({ ...setup, seed: seed.slice(1) + "0" });
  if (n >= 14)
    ck(other.digest !== plan.digest, "T-33", () => "another seed gave the same bracket");
  const real = r1.filter((m) => !m.bye);
  const m0 = rng.pick(real);
  const bd = m0.boards[0];
  const { a, b } = bd, mid = m0.mid;
  const cfg = { seed, moveMs, readyMs };
  const D = await newBoard(cfg, mid, 0, a, b, T0);
  const sa = rng.weighted(STRATS), sb = rng.weighted(STRATS), pa = rng.weighted(PROFS), pb = rng.weighted(PROFS);
  const ops = [];
  let now = T0 + rng.int(0, 1500);
  const junkRate = rng.pick([0, 0.1, 0.3]), lookRate = rng.pick([0, 0.2, 0.5]);
  for (let step = 0;step < 90 && !D.done; step++) {
    const g = lastGame(D), mover = moverOf(g), strat = mover === a ? sa : sb, prof = mover === a ? pa : pb;
    const win = g.moves.length === 0 && g.no === 1 ? readyMs : moveMs;
    const r = rng.float();
    if (r < junkRate) {
      now += rng.int(0, 500);
      const free = g.cells.map((c, i) => c === 0 ? i : -1).filter((i) => i >= 0);
      const v = rng.int(0, 3);
      const op = v === 0 ? { e: now, pid: mover === a ? b : a, sq: rng.pick(free) } : v === 1 ? { e: now, pid: mover, sq: g.cells.findIndex((c) => c !== 0) >= 0 ? g.cells.findIndex((c) => c !== 0) : 9 } : v === 2 ? { e: now, pid: "zed", sq: rng.pick(free) } : { e: now, pid: mover, sq: 9 };
      ops.push(op);
      await applyMove(cfg, mid, D, op.pid, op.sq, op.e);
    } else if (r < junkRate + lookRate) {
      now += rng.int(0, Math.floor(win * 1.2));
      ops.push({ e: now, pid: rng.pick([a, b]), sq: ABSENT });
      await advanceBoard(cfg, mid, D, now);
    } else if (strat === "absent") {
      now = g.deadline + 1 + rng.int(0, 2000);
      ops.push({ e: now, pid: mover === a ? b : a, sq: ABSENT });
      await advanceBoard(cfg, mid, D, now);
    } else {
      const cell = chooseCell(strat, g.cells, mover === g.x ? 1 : 2, rng);
      now += thinkMs(prof, win, rng);
      ops.push({ e: now, pid: mover, sq: cell });
      await applyMove(cfg, mid, D, mover, cell, now);
    }
  }
  if (!D.done) {
    now = lastGame(D).deadline + 1;
    ops.push({ e: now, pid: a, sq: ABSENT });
    await advanceBoard(cfg, mid, D, now);
  }
  const endE = now;
  const k = rng.weighted([[0, 45], [1, 30], [2, 25]]);
  const ps = [];
  let lastP = T0;
  for (let i = 0;i < k; i++) {
    const p = lastP + rng.int(1, Math.max(2, Math.floor((endE - T0) / k))) + 0.5;
    if (p >= endE)
      break;
    ps.push({ p, L: rng.pick([1, 700, 15000, 61000, 400000]) + rng.int(0, 99) });
    lastP = p;
  }
  const before = (e) => ps.reduce((s, q) => s + (q.p < e ? q.L : 0), 0);
  let acc = 0;
  const wallPauses = ps.map((q) => {
    const from = q.p + acc;
    acc += q.L;
    return [from, from + q.L];
  });
  if (rng.chance(0.2))
    wallPauses.push([endE + before(endE) + 0.5, null]);
  const rows = (list) => list.map((o, i) => ({ seq: i, pid: o.pid, sq: o.sq, ms: o.e + before(o.e) }));
  const mkRec = (events) => ({ mid, reg: null, complete: false, boards: [{ j: 0, a, b, events, result: null, reports: [] }], t: { state: "running", pauses: wallPauses, serverNow: T0 } });
  const nowEff = rng.chance(0.5) ? endE + rng.int(0, 3000) : endE;
  const replay = async (events, ne) => replayMatch(plan, T0, structuredClone(m0), mkRec(events), T0, wallPauses, ne);
  const full = await replay(rows(ops), nowEff);
  const sd = sigE(D), sf = sigE(full.m.boards[0]);
  ck(sd === sf, "T-32", () => `replayed ${sf} || played ${sd}`);
  const sparse = ops.filter((o) => o.sq !== ABSENT);
  sparse.push({ e: endE, pid: a, sq: ABSENT });
  const sp = await replay(rows(sparse));
  ck(sigE(sp.m.boards[0]) === sd, "T-32", () => `sparse replay ${sigE(sp.m.boards[0])} || played ${sd}`);
  const sh = await replay(rng.shuffle(rows(ops)));
  ck(sigE(sh.m.boards[0]) === sd, "T-32", () => "the order the events arrive in changes the replay");
  const d2 = await replay(rows(ops), nowEff);
  ck(d2.due[0] === (!D.done && nowEff > lastGame(D).deadline), "T-32", () => `due=${d2.due[0]} done=${D.done} nowEff=${nowEff} deadline=${lastGame(D).deadline}`);
  ck(sigE(D) === sd, "T-32");
  const cl = [];
  let t0 = rng.int(0, 5000);
  for (let i = rng.int(0, 4);i > 0; i--) {
    const f = t0 + rng.int(1, 20000);
    const to = f + rng.int(1, 30000);
    cl.push([f, to]);
    t0 = to + rng.int(1, 20000);
  }
  const openEnd = rng.chance(0.3);
  if (openEnd)
    cl.push([t0 + 5, null]);
  const closed = cl.filter((p) => p[1] !== null);
  let prevW = -1, prevE = -1;
  for (const w of [0, ...cl.flatMap((p) => [p[0] - 1, p[0], p[0] + 1, p[1] === null ? p[0] + 100 : p[1] - 1, p[1] ?? p[0] + 200, (p[1] ?? p[0]) + 1]), t0 + 99999].sort((x, y) => x - y)) {
    if (w < 0)
      continue;
    const e = effOf(cl, w);
    ck(e === effO(cl, w), "T-31", () => `effOf(${w}) = ${e}, model ${effO(cl, w)}`);
    if (prevW >= 0) {
      ck(e >= prevE, "T-31", () => "tournament clock went backwards");
      ck(e - prevE <= w - prevW, "T-31", () => "tournament clock ran faster than the wall clock");
    }
    prevW = w;
    prevE = e;
  }
  if (!openEnd) {
    const w = t0 + 12345;
    ck(wallOf(closed, effOf(cl, w)) === w, "T-31", () => "wallOf is not the inverse of effOf outside pauses");
  }
  C.dims.players = bucket(n);
  C.dims.pauses = String(ps.length);
  C.dims.events = junkRate > 0 ? "with-junk" : "clean";
  C.dims.board = D.via ?? "open";
  T(() => `mailbox ${mid}: ${ops.length} stored events, ${ps.length} pauses, board ${D.via}`);
}

// games/tictactoe/kplat.ts
var ROLE_TABLE = {
  organizer: [true, true, true, false],
  host: [true, false, true, false],
  cohost: [false, false, false, false],
  participant: [false, false, false, true],
  family: [false, false, false, true]
};
var ALPHA2 = "abcdefghijklmnopqrstuvwxyz0123456789";
var word = (rng, lo, hi, al = ALPHA2) => {
  let s = "";
  for (let i = rng.int(lo, hi);i > 0; i--)
    s += al[rng.int(0, al.length - 1)];
  return s;
};
var rolesBlock = (rng) => {
  C.dims.platform = "roles";
  for (const [r, t] of Object.entries(ROLE_TABLE)) {
    ck(canControlClock(r) === t[0], "T-40", () => `canControlClock(${r})`);
    ck(canEditSetup(r) === t[1], "T-40", () => `canEditSetup(${r})`);
    ck(getsEndPdf(r) === t[2], "T-40", () => `getsEndPdf(${r})`);
    ck(isPlayer(r) === t[3], "T-40", () => `isPlayer(${r})`);
  }
  for (const r of ["attendance-monitor", "team-lead", "guest", "", "ORGANIZER", "owner", "co-host", "ai", "spectator"])
    ck(!canControlClock(r) && !canEditSetup(r) && !getsEndPdf(r) && !isPlayer(r), "T-40", () => `an unknown role "${r}" has a permission`);
  ck(ROLES.join() === "organizer,host,cohost,participant,family" && FAMILY_SEATS === 4 && WAIT_LAPSE_MS === 1800000, "T-40", () => "role list or family seats or waiting lapse changed");
  for (let i = 0;i < 6; i++) {
    const j = { listed: rng.chance(0.5), closeGroup: rng.chance(0.5), alreadySeated: rng.chance(0.3), full: rng.chance(0.3), open: rng.chance(0.8) };
    const want = !j.open ? "refused" : j.alreadySeated ? "refused" : j.full ? "refused" : j.closeGroup && !j.listed ? "waiting" : "in";
    const got = admit(j);
    ck(got.result === want && (want !== "refused" || !!got.why), "T-42", () => `admit ${JSON.stringify(j)} -> ${got.result}, want ${want}`);
  }
};
var teamBlock = (rng) => {
  C.dims.platform = "team";
  let team = newTeam();
  const hosts = [], cohosts = [], approved = new Set;
  let logLen = 0;
  const all = () => [...hosts, ...cohosts];
  const ids = [];
  const roles = ["organizer", "host", "cohost", "participant", "family"];
  for (let step = 0;step < 26; step++) {
    const op = rng.int(0, 3);
    const by = rng.pick(roles);
    if (op <= 1) {
      const kind = rng.pick(["emp", "email"]);
      const isHost = op === 0;
      const known = ids.length && rng.chance(0.2) ? rng.pick(ids) : null;
      const raw = known ?? (rng.chance(0.1) ? rng.pick(["", "   ", "@@", "..."]) : kind === "emp" ? (rng.chance(0.4) ? "e-" : "E") + word(rng, 1, 6, "abcdefgh0123456789 ") : word(rng, 2, 6, "abcdefgh") + "@" + word(rng, 2, 5, "abcdefgh") + ".com");
      const cleaned = kind === "emp" ? raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase() : raw.replace(/\s/g, "").toLowerCase();
      const norm = kind === "emp" && /@/.test(raw) ? "" : cleaned;
      let want = "ok";
      if (isHost ? by !== "organizer" : !(by === "organizer" || by === "host"))
        want = "fail";
      else if (!norm)
        want = "fail";
      else if (all().includes(norm))
        want = "fail";
      else if (isHost && hosts.length >= 5)
        want = "fail";
      const r = isHost ? addHost(team, by, kind, raw, 1000 + step) : addCohost(team, by, kind, raw, 1000 + step);
      ck(r.ok === (want === "ok"), "T-41", () => `${isHost ? "addHost" : "addCohost"}(${by}, ${kind}, "${raw}") -> ${r.ok ? "ok" : r.why}; want ${want}`);
      if (r.ok && want === "ok") {
        team = r.team;
        (isHost ? hosts : cohosts).push(norm);
        ids.push(raw);
        logLen++;
      } else if (!r.ok)
        ck(team.hosts.length === hosts.length && team.cohosts.length === cohosts.length && team.log.length === logLen, "T-41", () => "a refused add changed the list");
    } else if (op === 2) {
      const id = hosts.length && rng.chance(0.8) ? rng.pick(hosts) : rng.chance(0.5) && cohosts.length ? rng.pick(cohosts) : "NOBODY";
      const r = approveHostKey(team, by, id, 2000 + step);
      const want = by === "organizer" && hosts.includes(id);
      ck(r.ok === want, "T-41", () => `approveHostKey(${by}, ${id}) -> ${r.ok}; want ${want}`);
      if (r.ok) {
        team = r.team;
        if (!approved.has(id)) {
          approved.add(id);
          logLen++;
        }
      }
    } else {
      for (const h of hosts)
        ck(hostMayControl(team, h) === approved.has(h), "T-41", () => `hostMayControl(${h}) before/after approval`);
      ck(!hostMayControl(team, "NOBODY") && !hostMayControl(team, cohosts[0] ?? "x"), "T-41", () => "a non-Host may control the clock");
    }
  }
  ck(team.hosts.length <= 5 && team.hosts.map((h) => h.id).join() === hosts.join() && team.cohosts.map((h) => h.id).join() === cohosts.join(), "T-41", () => `lists ${team.hosts.map((h) => h.id)} / ${team.cohosts.map((h) => h.id)} vs model ${hosts} / ${cohosts}`);
  ck(team.log.every((e) => ROLE_TABLE[e.role] !== undefined && ["Host added", "Co-host added", "Host key approved"].includes(e.what)), "T-41", () => `the change list holds more than a role and a fixed phrase: ${JSON.stringify(team.log.slice(0, 3))}`);
  ck(new Set(all()).size === all().length, "T-41", () => "a person holds two roles");
  if (rng.chance(0.3)) {
    const junk = rng.pick(["@@", "...", "a@b", "no-at-sign", "x@", "@y.com", "a b@c.de"]);
    const r = addHost(newTeam(), "organizer", "email", junk, 1);
    ck(!r.ok, "T-53", () => `the shared Host / Co-host list accepts "${junk}" as an e-mail ID (the server's own cleaner refuses it: apps/edge/src/ids.ts + people.ts EMAIL_ID_RE)`);
  }
  ck(cohostLimitOk(10) && cohostLimitOk(1000) && !cohostLimitOk(9) && !cohostLimitOk(1001) && !cohostLimitOk(10.5) && COHOST_LIST_DEFAULT === 100, "T-41", () => "co-host list limits 10..1000, default 100");
};
var clockBlock = (rng) => {
  C.dims.platform = "clock";
  let c = newClock();
  let phase = "waiting", frozen = null, paused = 0;
  let pausesN = 0;
  let now = rng.int(0, 1e6);
  let lastGame2 = -Infinity;
  const roles = ["organizer", "host", "cohost", "participant", "family"];
  for (let i = 0;i < 24; i++) {
    now += rng.int(0, 90000);
    const op = rng.int(0, 5);
    const by = rng.pick(roles);
    const ctl = by === "organizer" || by === "host";
    if (op === 0) {
      c = start(c);
      if (phase === "waiting")
        phase = "running";
    } else if (op === 1 || op === 2) {
      c = pause(c, by, now);
      if (ctl && phase === "running") {
        phase = "paused";
        frozen = now;
        pausesN++;
      }
    } else if (op === 3) {
      c = resume(c, by, now);
      if (ctl && phase === "paused" && frozen !== null) {
        paused += now - frozen;
        frozen = null;
        phase = "running";
      }
    } else if (op === 4 && rng.chance(0.15)) {
      c = end(c);
      phase = "over";
      frozen = null;
    }
    const gn = (frozen ?? now) - paused;
    ck(c.phase === phase && c.frozenAt === frozen && c.pausedMs === paused && c.pauses.length === pausesN && gameNow(c, now) === gn, "T-43", () => `after op ${op} by ${by}: ${JSON.stringify(c)} vs model ${phase}/${frozen}/${paused}/${pausesN}`);
    ck(gameNow(c, now) >= lastGame2, "T-43", () => "game time went backwards");
    lastGame2 = gameNow(c, now);
  }
  ck(c.pauses.every((p) => ROLE_TABLE[p.role][0]), "T-43", () => "a pause was logged for a role that cannot pause");
  const pub = rng.int(0, 1e6), nn = rng.int(0, 2000000);
  ck(shouldStart("auto", pub, nn, null) === nn >= pub && shouldStart("manual", pub, nn, "host") && shouldStart("manual", pub, nn, "organizer") && !shouldStart("manual", pub, nn, "cohost") && !shouldStart("manual", pub, nn, null) && !shouldStart("manual", pub, nn, "participant"), "T-43", () => "start rules");
};
var lateBlock = (rng) => {
  C.dims.platform = "late-join";
  const m = MANIFESTS.tictactoe;
  ck(m.lateJoin.kind === "none-after-round-1", "T-44", () => `manifest late-join ${m.lateJoin.kind}`);
  for (let i = 0;i < 6; i++) {
    const w = rng.pick([undefined, 0, 30, 300]);
    const rule = { kind: "none-after-round-1", ...w !== undefined ? { windowSeconds: w } : {} };
    const ctx = { round: rng.int(0, 4), over: rng.chance(0.15), msSinceRound1End: rng.int(0, 400000), now: 0 };
    const want = ctx.over ? false : ctx.round <= 1 ? true : ctx.msSinceRound1End <= (w ?? 0) * 1000;
    ck(canJoinLate(rule, ctx) === want, "T-44", () => `canJoinLate ${JSON.stringify(rule)} ${JSON.stringify(ctx)} -> ${!want}`);
  }
  for (const s of [-5, 0, 1, 59.9, 300, 301, 1e9, NaN, Infinity, -Infinity, rng.int(-50, 400) + 0.5]) {
    const want = Number.isNaN(s) ? 0 : s === Infinity ? 300 : s === -Infinity ? 0 : Math.max(0, Math.min(300, Math.floor(s)));
    const got = withLateWindow({ kind: "none-after-round-1" }, s);
    ck(got.kind === "none-after-round-1" && got.windowSeconds === want, "T-44", () => `withLateWindow(${s}) -> ${got.windowSeconds}, want ${want}`);
  }
  ck(withLateWindow({ kind: "until-draw" }, 99).kind === "until-draw" && withLateWindow({ kind: "until-draw" }, 99).windowSeconds === undefined, "T-44", () => "a window was added to a rule that takes none");
};
var invitesBlock = (rng) => {
  C.dims.platform = "invites";
  const KINDS2 = ["family", "colleagues", "friends", "dealers", "vendors", "customers", "partners", "franchisees", "neighbours", "guests"];
  ck(JSON.stringify(defaultInvites()) === JSON.stringify({ on: false, per: 4, cats: ["family", "colleagues"] }) && MAX_INVITES_PER_PERSON === 10 && INVITE_CATEGORIES.map((c) => c.id).join() === KINDS2.join(), "T-45", () => "default guest-invite settings or the table of guest kinds changed");
  for (let i = 0;i < 5; i++) {
    const inp = {};
    const want = { ok: true, inv: { on: false, per: 4, cats: ["family", "colleagues"] }, eo: false, verify: undefined, idKind: undefined };
    if (rng.chance(0.7)) {
      const on = rng.chance(0.5) ? rng.chance(0.5) : rng.pick([1, "yes", null, undefined]);
      const per = rng.pick([undefined, 1, 4, 10, 0, 11, 2.5, "3", -1, 5]);
      const cats = rng.pick([undefined, ["family"], ["colleagues"], ["family", "colleagues"], ["family", "family"], [], ["friends"], ["dealers", "guests", "dealers"], rng.sample(KINDS2, rng.int(1, 10)), ["family", "relatives"], "family", ["family", 3]]);
      inp.invites = rng.chance(0.07) ? null : { on, ...per !== undefined ? { per } : {}, ...cats !== undefined ? { cats } : {} };
      if (inp.invites === null || typeof on !== "boolean")
        want.ok = false;
      else {
        const p = per === undefined ? 4 : per;
        const cs = cats === undefined ? ["family", "colleagues"] : cats;
        if (!Number.isInteger(p) || p < 1 || p > 10)
          want.ok = false;
        else if (!Array.isArray(cs) || cs.some((c) => !KINDS2.includes(c)))
          want.ok = false;
        else {
          const u = [...new Set(cs)];
          if (on && u.length < 1)
            want.ok = false;
          else
            want.inv = { on, per: p, cats: u };
        }
      }
    }
    if (rng.chance(0.4)) {
      const eo = rng.pick([true, false, "true", 1]);
      inp.employeesOnly = eo;
      if (typeof eo !== "boolean")
        want.ok = false;
      else
        want.eo = eo;
    }
    if (rng.chance(0.3)) {
      const v = rng.pick(["mobile", "id", "either", "both", "email", "", 3]);
      inp.verify = v;
      if (!["mobile", "id", "either", "both"].includes(v))
        want.ok = false;
      else
        want.verify = v === "mobile" ? undefined : v;
    }
    if (rng.chance(0.3)) {
      const k = rng.pick(["emp", "email", "phone", null]);
      inp.idKind = k;
      if (k !== "emp" && k !== "email")
        want.ok = false;
      else
        want.idKind = k === "email" ? "email" : undefined;
    }
    const r = validateCfg(inp);
    ck(r.ok === want.ok, "T-45", () => `validateCfg(${JSON.stringify(inp)}) -> ${r.ok ? "ok" : r.error}; want ${want.ok ? "ok" : "an error"}`);
    if (r.ok && want.ok) {
      const inv = want.eo ? { ...want.inv, on: false } : want.inv;
      const g = r.cfg;
      ck(JSON.stringify(g.invites) === JSON.stringify(inv) && !!g.employeesOnly === want.eo && g.verify === want.verify && g.idKind === want.idKind, "T-45", () => `cfg ${JSON.stringify([g.invites, g.employeesOnly, g.verify, g.idKind])} vs model ${JSON.stringify([inv, want.eo, want.verify, want.idKind])}`);
      if (g.employeesOnly)
        ck(g.invites.on === false, "T-45", () => "employees only must switch guest invitations off");
    }
  }
};
var linksBlock = (rng) => {
  C.dims.platform = "links";
  const P2 = exports_people;
  ck(P2.COHOST_FROM === 1e9 && P2.HOST_FROM === 1500000000 && P2.ORG_FROM === 1900000000, "T-46", () => "link code bases changed");
  const hex7 = () => rng.int(0, 268435455).toString(16).padStart(7, "0");
  const cases = [{ inviter: "o", code: 1900000000 }];
  {
    const h = hex7();
    cases.push({ inviter: "h:" + h, code: 1500000000 + parseInt(h, 16) });
    const c = hex7();
    cases.push({ inviter: "c:" + c, code: 1e9 + parseInt(c, 16) });
    const s = rng.int(1, 999999999);
    cases.push({ inviter: "s:" + s, code: s });
  }
  for (const k of cases) {
    ck(P2.fromCodeOf(k.inviter) === k.code, "T-46", () => `fromCodeOf(${k.inviter}) -> ${P2.fromCodeOf(k.inviter)}, want ${k.code}`);
    const own = P2.parseFrom(k.code);
    ck(!!own && P2.inviterOf(own) === k.inviter, "T-46", () => `round trip of ${k.inviter} via ${k.code} gave ${own ? P2.inviterOf(own) : null}`);
    ck(P2.srcOf(k.inviter) === (k.inviter.startsWith("c:") ? "co:" + k.inviter.slice(2) : k.inviter.startsWith("h:") ? "ho:" + k.inviter.slice(2) : "link"), "T-46", () => `srcOf(${k.inviter})`);
  }
  for (let i = 0;i < 6; i++) {
    const f = rng.pick([rng.int(1, 999999999), 1e9 + rng.int(0, 268435456), 1500000000 + rng.int(0, 268435456), 1900000000, 1900000000 + 1, 1268500000 + rng.int(0, 5000000), rng.int(2000000000, 4000000000), 0, -3, 2.5, NaN, "5", null, undefined]);
    const want = typeof f !== "number" || !Number.isInteger(f) || f < 1 ? null : f === 1900000000 ? "org" : f >= 1500000000 && f < 1500000000 + 268435456 ? "host" : f >= 1e9 && f < 1e9 + 268435456 ? "cohost" : f < 1e9 ? "guest" : null;
    const got = P2.parseFrom(f);
    ck((got ? got.kind : null) === want, "T-46", () => `parseFrom(${String(f)}) -> ${got?.kind}, want ${want}`);
  }
};
var NAME_ALPHA = ["a", "B", "z", " ", "  ", "\t", `
`, "=", "+", "-", "@", "<", ">", "`", "\u200B", "\u200F", "\u2028", "\uFEFF", "\x00", "\x7F", "\uD83D\uDE00", "\xE9", "x", "9", "'", '"'];
var cleanNameO = (n) => {
  if (typeof n !== "string")
    return "";
  const keep = [];
  for (const ch of n) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c === 127 || c >= 8203 && c <= 8207 || c === 8232 || c === 8233 || c === 65279)
      continue;
    if (ch === "<" || ch === ">" || ch === "`")
      continue;
    keep.push(ch);
  }
  let out = "";
  let sp = false;
  for (const ch of keep) {
    if (/\s/.test(ch)) {
      sp = true;
      continue;
    }
    if (sp && out)
      out += " ";
    sp = false;
    out += ch;
  }
  let i = 0;
  while (i < out.length && "=+-@ ".includes(out[i]))
    i++;
  return out.slice(i).trim().slice(0, 60);
};
var IDCH = ["A", "b", "7", "-", " ", "/", ".", "\xDF", "\u0131", "\u0149", "\u01F0", "\xE9", "@", "\uFF21", "\uFB03", "\u200B", "\u0663", "z", "Q", "_", "\u212A"];
var idsBlock = (rng) => {
  C.dims.platform = "ids";
  const P2 = exports_people, I = exports_ids2;
  for (let i = 0;i < 4; i++) {
    let s = "";
    for (let k = rng.int(0, 70);k > 0; k--)
      s += rng.pick(NAME_ALPHA);
    if (i === 0 && rng.chance(0.3))
      s = "x".repeat(rng.int(40, 59)).padEnd(59, "y") + rng.pick(["\uD83D\uDE00", " ", "  ", "\uD83D\uDC68\u200D\uD83D\uDC69"]) + "tail";
    const got = P2.cleanName(s), want = cleanNameO(s);
    ck(got === want, "T-47", () => `cleanName(${JSON.stringify(s)}) -> ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    ck(!/[<>`]/.test(got) && !/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/.test(got) && got.length <= 60 && !/^[=+\-@\s]/.test(got), "T-47", () => `cleanName left something forbidden: ${JSON.stringify(got)}`);
    ck(!/\s$/.test(got) && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(got), "T-54", () => `cleanName(${JSON.stringify(s)}) ends in a space or half a character: ${JSON.stringify(got.slice(-4))}`);
  }
  ck(P2.cleanName(12345) === "" && P2.cleanName(null) === "", "T-47", () => "cleanName of a non-string");
  for (let i = 0;i < 4; i++) {
    let s = "";
    for (let k = rng.int(0, 40);k > 0; k--)
      s += rng.pick(IDCH);
    const edge = P2.normId(s, "emp"), core = exports_ids.normId("emp", s);
    let want;
    const nf = s.normalize("NFKC");
    if (!s.trim())
      want = "";
    else if (nf.includes("@"))
      want = null;
    else {
      const c = nf.toUpperCase().replace(/[^A-Z0-9]/g, "");
      want = c && c.length <= 30 ? c : null;
    }
    ck(edge === want, "T-47", () => `server normId(${JSON.stringify(s)}, emp) -> ${JSON.stringify(edge)}, model ${JSON.stringify(want)}`);
    ck((edge || null) === core, "T-52", () => `the server's ID cleaner and the shared game-core ID cleaner disagree on ${JSON.stringify(s)}: server ${JSON.stringify(edge)}, core ${JSON.stringify(core)} (apps/edge/src/ids.ts:6 upper-cases BEFORE it drops non A-Z0-9, vendor/game-core/.../ids.ts:4 after)`);
    const old = P2.normId(s, "emp", 0);
    const so = s.replace(/\s+/g, "").toUpperCase();
    const wantOld = !so ? "" : /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(so) ? so : null;
    ck(old === wantOld, "T-47", () => `old-game rule for ${JSON.stringify(s)}: ${JSON.stringify(old)} vs ${JSON.stringify(wantOld)}`);
  }
  for (let i = 0;i < 3; i++) {
    const local = word(rng, 0, 8, "abcXYZ.-_+ \xA0\u200B\xE9"), dom = word(rng, 0, 8, "abcdeXY.- \xA0\uFF0E"), tld = word(rng, 0, 4, "comCOM1\u200D");
    const s = rng.chance(0.2) ? word(rng, 0, 6, "ab @") : `${local}@${dom}.${tld}`;
    const got = P2.normId(s, "email");
    const k = s.normalize("NFKC").replace(/[\s\u0085\u200B-\u200D\u2060\uFEFF]/g, "").toLowerCase();
    const want = !k ? "" : /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(k) && k.length <= 254 ? k : null;
    ck(got === want, "T-47", () => `server normId(${JSON.stringify(s)}, email) -> ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    ck(I.cleanEmail(s) === exports_ids.normEmail(s), "T-47", () => "the two e-mail cleaners disagree");
  }
};
var dbBlock = async (rng) => {
  C.dims.platform = "invite-limits";
  const seatRole = {}, upper = {};
  const db = { prepare: (sql) => ({ bind: (...a) => ({ first: async () => {
    const seq = a[1];
    if (sql.includes("SELECT role FROM seat"))
      return seq in seatRole ? { role: seatRole[seq] } : null;
    if (sql.includes("JOIN person"))
      return seq in upper ? { inviter: upper[seq] } : null;
    return null;
  } }) }) };
  const per = rng.int(1, 10), lim = rng.pick([undefined, 10, 100, 1000]);
  for (let i = 0;i < 5; i++) {
    const seq = rng.int(1, 50);
    const kind = rng.pick(["o", "h", "c", "s", "s", "x"]);
    if (rng.chance(0.5))
      seatRole[seq] = rng.chance(0.5) ? "team" : null;
    if (rng.chance(0.6))
      upper[seq] = rng.pick(["o", "h:" + "a".repeat(7), "c:" + "b".repeat(7), "s:" + (seq + 1)]);
    const inviter = kind === "o" ? "o" : kind === "x" ? "z:1" : kind === "s" ? "s:" + seq : kind + ":" + "abcdef0";
    const c = { env: { DB: db }, eid: "e", e: lim === undefined ? {} : { cohost_limit: lim }, invites: { on: true, per } };
    const want = inviter.startsWith("c:") ? lim ?? 100 : inviter.startsWith("s:") ? seatRole[seq] ? null : per : null;
    const got = await exports_people.limitOfInviter(c, inviter);
    ck(got === want, "T-48", () => `limitOfInviter(${inviter}) -> ${got}, want ${want}`);
    const chain = await exports_people.chainOf(db, "e", inviter);
    const ids = [inviter];
    if (inviter.startsWith("s:") && upper[seq] && upper[seq] !== inviter)
      ids.push(upper[seq]);
    ck(chain === "," + ids.join(",") + ",", "T-48", () => `chainOf(${inviter}) -> ${chain}`);
  }
  ck(exports_people.COHOST_LIMIT_DEFAULT === 100 && exports_people.COHOST_LIMIT_MIN === 10 && exports_people.COHOST_LIMIT_MAX === 1000 && COHOST_LIST_DEFAULT === 100, "T-48", () => "co-host limits");
};
var constBlock = (rng) => {
  C.dims.platform = "constants";
  const TT = exports_tournament, L = exports_lifetimes, m = MANIFESTS.tictactoe;
  ck(TT.TTT_MOVE_SECONDS.join() === "10,20,30,60", "T-49", () => `move seconds ${TT.TTT_MOVE_SECONDS}`);
  const st = rng.int(0, 2000000000000), ended = rng.int(1, 2000000000000);
  ck(TT.endBoundTtt(st, null) === st + 6 * 3600000 && TT.endBoundTtt(st, { ended_ms: ended }) === ended + 60000 && TT.endBoundTtt(st, { ended_ms: null }) === st + 6 * 3600000, "T-49", () => "end bound = ended + 60 s, or the scheduled start + 6 h");
  ck(L.PURGE_AFTER_MS === 20 * 3600000 && L.REPORT_LINK_MS === 19 * 3600000 && L.REPORT_AFTER_MS === 180000 && AUTO_DELETE_AFTER_MS === L.PURGE_AFTER_MS && L.REPORT_LINK_MS < L.PURGE_AFTER_MS && WINNERS_KEEP_DAYS === 365, "T-49", () => "lifetimes");
  ck(m.caps.auto === 2000 && m.claimType === "auto" && m.pauseSupport === true && m.organizerFinalSay === false && m.prizePositions.join() === "1st,2nd,3rd,4th,5th" && m.goldenButton === "You won", "T-50", () => `manifest ${JSON.stringify(m)}`);
  ck(MAX_PLAYERS === 1e4 && TEAM_SIZES.join() === "3,5" && MAX_GAMES === 3 && MISSED_LIMIT === 2 && DEFAULT_MOVE_MS === 20000 && DEFAULT_READY_MS === 30000, "T-50", () => "engine constants");
  const now = rng.int(1, 2000000000000), t = rng.pick([now - 1, now, now + 15 * 60000, now + 30 * 86400000 + 900000, now + 7 * 86400000, now + rng.int(1, 1e9), Math.ceil(now / 900000) * 900000 + 900000]);
  const want = t <= now ? "Pick a time in the future." : t - now > 30 * 86400000 ? "Pick a time within the next 30 days." : t % 900000 !== 0 ? "Times are in 15-minute steps." : null;
  ck(timeOk(t, now) === want, "T-50", () => `timeOk(${t}, ${now}) -> ${timeOk(t, now)}, want ${want}`);
  const amt = rng.int(0, 1e6), w = rng.int(1, 9);
  const s = splitTie(amt, w);
  ck(s.each * w + s.left === amt && s.left >= 0 && s.left < w && s.each === Math.floor(amt / w), "T-50", () => `splitTie(${amt}, ${w})`);
};
var guardBlock = async (rng) => {
  C.dims.platform = "guards";
  const pl = (n) => Array.from({ length: n }, (_, i) => ({ pid: "g" + i, name: "G" + i }));
  const fails = async (f, re) => {
    try {
      await f();
      return false;
    } catch (e) {
      return re.test(String(e.message));
    }
  };
  const seed = rng.hex(32);
  ck(await fails(() => startTournament({ eid: "x", seed, players: [{ pid: "a", name: "A" }, { pid: "a", name: "B" }], startAt: 0 }), /twice/), "T-20", () => "a player listed twice is accepted");
  ck(await fails(() => startTournament({ eid: "x", seed, players: pl(10), format: "team", teamSize: 4, startAt: 0 }), /3 or 5/), "T-22", () => "teams of 4 are accepted");
  ck(await fails(() => startTournament({ eid: "x", seed, players: pl(2), format: "team", teamSize: 3, startAt: 0 }), /Not enough/), "T-22", () => "a team tournament without a full team is accepted");
  ck(await fails(() => startTournament({ eid: "x", seed, players: [], startAt: 0 }), /At least one/), "T-20", () => "an empty tournament is accepted");
};
var MAX_PLAN_BODY = 400000;
var MAX_PLAN_MATCHES2 = 600;
var capBlock = async (rng) => {
  C.dims.platform = "capacity";
  const n = rng.weighted([[2000, 4], [3000, 2], [4000, 2], [5000, 3], [7000, 2], [1e4, 3]]);
  const longNames = n <= 2000 && rng.chance(0.5);
  const hex16 = (i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(16).padStart(8, "0") + (Math.imul(i + 7, 2246822507) >>> 0).toString(16).padStart(8, "0");
  const roster = Array.from({ length: n }, (_, i) => ({ pid: hex16(i), name: longNames ? ("Employee with a rather long name number " + i).padEnd(60, "x").slice(0, 60) : "Player " + i }));
  const setup = { eid: "cap", state: "running", commit: "c", seed: rng.hex(32), roster, opts: { format: "solo", teamSize: 1, moveMs: 20000, readyMs: 30000 }, startedMs: 1e6, pauses: [], serverNow: 1e6 };
  const plan = await planOf(setup);
  const pl = planPayload(plan);
  ck(pl.matches.length === plan.t.size / 2 && plan.t.size === nextPow2(n), "T-33", () => "plan size");
  let worst = 0, worstAt = 0, tooMany = 0;
  for (let i = 0;i < pl.matches.length || i === 0; i += 400) {
    const last2 = i + 400 >= pl.matches.length;
    const chunk = pl.matches.slice(i, i + 400);
    if (chunk.length > MAX_PLAN_MATCHES2)
      tooMany++;
    const len = JSON.stringify({ matches: chunk, ...i === 0 ? { entrants: pl.entrants } : {}, ...last2 ? { last: true, rounds: pl.rounds, size: pl.size, digest: pl.digest, entrantCount: pl.entrants.length } : {} }).length;
    if (len > worst) {
      worst = len;
      worstAt = i;
    }
  }
  ck(tooMany === 0, "T-51", () => "a request of the draw carries more matches than the mailbox takes");
  ck(worst <= MAX_PLAN_BODY, "T-51", () => `${n} players are accepted by the start route (limit 10,000) but the first request of their draw is ${worst} characters (request at match ${worstAt}) and the mailbox reads at most ${MAX_PLAN_BODY}: it answers "Bad draw." and the tournament stays in "starting" for good`);
};
var BLOCKS = [
  [["roles", rolesBlock], 10],
  [["team", teamBlock], 10],
  [["clock", clockBlock], 10],
  [["late", lateBlock], 7],
  [["invites", invitesBlock], 12],
  [["links", linksBlock], 9],
  [["ids", idsBlock], 14],
  [["db", dbBlock], 7],
  [["constants", constBlock], 8],
  [["guards", guardBlock], 6]
];
async function kPlat(rng) {
  const sub = rng.u32();
  const r = new Rng(sub, 37287);
  const picked = [];
  for (let i = r.int(2, 3);i > 0; i--) {
    const [name, fn] = r.weighted(BLOCKS);
    picked.push(name);
    await fn(r);
  }
  if (r.chance(0.0003)) {
    picked.push("capacity");
    await capBlock(r);
  }
  Object.assign(C.params, { kind: "platform", blocks: picked, sub });
  C.dims.platform = picked[0];
  T(() => `platform blocks ${picked.join(",")} (sub-seed ${sub})`);
}

// games/tictactoe/kctl.ts
import { createHash as createHash2, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "crypto";
var CRYPTO_EVERY = 4999;
var MAXT = MAX_TIMED_PAUSE_ROUNDS;
function oCtl(mp, L, log) {
  const ps = [];
  let stop = null;
  const ignored = [];
  let applied = 0;
  for (const m of [...log].sort((a, b) => a.seq - b.seq)) {
    const at = m.atBeaconRound, lead = at - m.signedAtRound, last2 = ps.length ? ps[ps.length - 1] : null;
    const inPause = !!last2 && last2.start <= at && at < last2.end;
    let bad = stop !== null || m.signedAtRound > at;
    if (!bad)
      switch (m.action) {
        case "pause":
          bad = lead < L || !!last2 && at < last2.end || m.untilRound !== undefined && (m.untilRound <= at || m.untilRound - at > MAXT);
          break;
        case "resume":
          bad = !inPause || lead < 1 || at <= last2.start;
          break;
        case "extend":
          bad = !inPause || last2.resumed || lead < L || m.untilRound === undefined || m.untilRound - at > MAXT || m.untilRound <= last2.end;
          break;
        case "stop":
          bad = lead < L;
          break;
      }
    if (bad) {
      ignored.push(m.seq);
      continue;
    }
    applied++;
    if (m.action === "pause")
      ps.push({ start: at, end: m.untilRound ?? at + mp, resumed: false });
    else if (m.action === "resume") {
      last2.end = at;
      last2.resumed = true;
    } else if (m.action === "extend")
      last2.end = m.untilRound;
    else
      stop = at;
  }
  return { intervals: ps.map((p) => ({ start: p.start, end: p.end })), stopRound: stop, ignored, applied };
}
var isNat = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
var shapeO = (x) => !!x && typeof x === "object" && typeof x.engagementId === "string" && isNat(x.seq) && x.seq >= 1 && ["pause", "resume", "extend", "stop"].includes(x.action) && isNat(x.atBeaconRound) && isNat(x.signedAtRound) && (x.untilRound === undefined || isNat(x.untilRound)) && typeof x.sig === "string";
function genLog(rng, eid, mp, L, n) {
  const log = [];
  let now = rng.int(0, 60);
  for (let seq = 1;seq <= n; seq++) {
    now += rng.int(0, 45);
    const st = oCtl(mp, L, log);
    const cur = st.intervals.length ? st.intervals[st.intervals.length - 1] : null;
    let action = rng.weighted([["pause", 34], ["resume", 24], ["extend", 16], ["stop", 7], ["any", 8]]);
    if (action === "any")
      action = rng.pick(["pause", "resume", "extend", "stop"]);
    let signed = now, at = now, until;
    if (!rng.chance(0.8)) {
      signed = rng.int(0, 300);
      at = rng.int(0, 300);
      if (rng.chance(0.4))
        until = rng.int(0, 400);
    } else if (action === "pause" || action === "stop") {
      const r = rng.float();
      const lead = r < 0.72 ? L + rng.int(0, 4) : r < 0.87 ? Math.max(0, L - rng.int(1, 3)) : -rng.int(1, 4);
      at = signed + lead;
      if (action === "pause") {
        if (cur && rng.chance(0.7) && at < cur.end) {
          const bump = cur.end - at + rng.int(0, 5);
          signed += bump;
          at += bump;
          now = signed;
        }
        const q = rng.float();
        until = q < 0.5 ? undefined : q < 0.85 ? at + rng.int(1, 90) : q < 0.92 ? at - rng.int(0, 2) : q < 0.96 ? at + MAXT : at + MAXT + 1;
      }
    } else if (action === "resume") {
      const lo = cur ? Math.max(cur.start + 1, signed + 1) : 0;
      if (cur && rng.chance(0.8) && cur.end - 1 >= lo)
        at = rng.int(lo, cur.end - 1);
      else
        at = signed + rng.int(0, 3);
    } else {
      if (cur && rng.chance(0.8) && cur.end > cur.start) {
        at = rng.int(cur.start, cur.end - 1);
        signed = Math.max(0, at - (L + rng.int(0, 3)));
      } else
        at = signed + L + rng.int(0, 3);
      until = rng.chance(0.93) ? (cur ? cur.end : at) + rng.int(-2, 80) : undefined;
    }
    log.push({ engagementId: eid, seq, action, atBeaconRound: Math.max(0, at), signedAtRound: Math.max(0, signed), ...until !== undefined ? { untilRound: Math.max(0, until) } : {}, sig: "00" });
  }
  return log;
}
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var mkEid = (rng) => "E" + rng.u32().toString(36);
async function ctlBlock(rng) {
  const eid = mkEid(rng), mp = rng.pick([5, 12, 30, 60, 600]), L = rng.pick([2, 10, 13, 29, 53]);
  const cfg = { pubKey: "00".repeat(32), maxPauseRounds: mp, leadRounds: L };
  const n = rng.int(1, 10);
  const log = genLog(rng, eid, mp, L, n);
  const before = JSON.stringify(log);
  const got = resolveControl(cfg, log), want = oCtl(mp, L, log);
  ck(same(got.intervals, want.intervals) && got.stopRound === want.stopRound && got.applied === want.applied && got.ignored.map((x) => x.seq).join() === want.ignored.join(), "T-55", () => `engine ${JSON.stringify([got.intervals, got.stopRound, got.applied, got.ignored.map((x) => x.seq)])} model ${JSON.stringify([want.intervals, want.stopRound, want.applied, want.ignored])} (maxPause ${mp}, lead ${L}) log ${JSON.stringify(log.map((m) => [m.seq, m.action, m.signedAtRound, m.atBeaconRound, m.untilRound ?? null]))}`);
  ck(JSON.stringify(log) === before, "T-55", () => "resolveControl changed the list it was given");
  ck(same(resolveControl(cfg, rng.shuffle(log)), got), "T-56", () => "the order a log arrives in changes what it means");
  const iv = got.intervals;
  ck(iv.every((p, i) => p.start < p.end && (i === 0 || iv[i - 1].end <= p.start)), "T-56", () => `pauses overlap or are empty: ${JSON.stringify(iv)}`);
  ck(got.ignored.length + got.applied === log.length, "T-55", () => "a message was neither applied nor ignored");
  for (const r of [0, ...iv.flatMap((p) => [p.start - 1, p.start, p.end - 1, p.end]), rng.int(0, 400)])
    if (r >= 0)
      ck(pausedAt(got, r) === iv.some((p) => r >= p.start && r < p.end), "T-56", () => `pausedAt(${r})`);
  const span = iv.reduce((s, p) => s + (p.end - p.start), 0) + (iv.length ? iv[iv.length - 1].end : 0) + (got.stopRound ?? 0);
  const stride = rng.pick([1, 2, 5, 10, 20]), start0 = rng.int(0, 60), K2 = 8;
  const sched = scheduleWithControl(got, start0, stride, K2);
  ck(sched.every((v, k) => v === callRound(got, start0, stride, k)), "T-56", () => "scheduleWithControl is not callRound call by call");
  if (span <= 2500) {
    const np = [];
    for (let r = 0;np.length <= start0 + K2 * stride + 1; r++)
      if (!iv.some((p) => r >= p.start && r < p.end))
        np.push(r);
    for (let k = 0;k < K2; k++) {
      const a = np[start0 + k * stride];
      const wantK = got.stopRound !== null && a >= got.stopRound ? null : a;
      ck(sched[k] === wantK, "T-56", () => `call ${k} (start ${start0}, stride ${stride}) at round ${sched[k]}, brute force ${wantK}; pauses ${JSON.stringify(iv)} stop ${got.stopRound}`);
    }
  }
  let seenNull = false, prev = -1;
  for (const v of sched) {
    if (v === null) {
      seenNull = true;
      continue;
    }
    ck(!seenNull && v > prev && !pausedAt(got, v) && (got.stopRound === null || v < got.stopRound), "T-56", () => `schedule ${JSON.stringify(sched)}`);
    prev = v;
  }
  C.dims.control = got.stopRound !== null ? "stopped" : iv.length ? "paused-" + Math.min(iv.length, 3) : "no-pause";
  C.params.log = { eid, mp, L, n, stride, start0, sub: rng.u32() };
}
async function acceptBlock(rng) {
  const eid = mkEid(rng), cfg = { pubKey: "ab".repeat(32), maxPauseRounds: 30, leadRounds: 13 };
  const mk = (seq, sig) => ({ engagementId: eid, seq, action: "pause", atBeaconRound: seq * 20 + 13, signedAtRound: seq * 20, sig });
  const fakeSig = (seq) => (seq.toString(16).padStart(2, "0") + "e").repeat(64).slice(0, 128);
  const n = rng.int(1, 12);
  const known = [];
  const have = new Map;
  for (let s = 1;s <= n; s++)
    if (rng.chance(0.7)) {
      const m = mk(s, fakeSig(s));
      known.push(m);
      have.set(s, m);
    }
  let incoming;
  const list = [];
  for (let i = rng.int(0, 10);i > 0; i--) {
    const v = rng.int(0, 7), s = rng.int(1, n + 3);
    if (v === 0 && have.has(s))
      list.push({ ...have.get(s) });
    else if (v === 1 && have.has(s))
      list.push(mk(s, fakeSig(s + 100)));
    else if (v === 2)
      list.push({ ...mk(s, "zz"), seq: rng.pick([0, -1, 1.5, "2", null]) });
    else if (v === 3)
      list.push({ ...mk(s, fakeSig(s)), engagementId: eid + "x" });
    else if (v === 4)
      list.push(mk(n + 4 + i, "zz"));
    else if (v === 5)
      list.push(rng.pick([null, 5, "x", [], undefined, true]));
    else if (v === 6)
      list.push({ ...mk(s, "00"), action: "delete" });
    else
      list.push({ ...mk(s, 12345) });
  }
  if (rng.chance(0.03))
    for (let i = 0;i < 510; i++)
      list.push(mk(1000 + i, "zz"));
  incoming = rng.chance(0.06) ? rng.pick([null, "text", {}, 5, undefined]) : rng.shuffle(list);
  const knownBefore = JSON.stringify(known);
  const r = await acceptLogDetailed(cfg, eid, incoming, known);
  let forged = 0;
  if (Array.isArray(incoming))
    for (const raw of incoming.slice(0, 500)) {
      if (!shapeO(raw) || raw.engagementId !== eid) {
        forged++;
        continue;
      }
      const h = have.get(raw.seq);
      if (h) {
        if (h.sig !== raw.sig)
          forged++;
        continue;
      }
      forged++;
    }
  const prefix = [];
  for (let s = 1;have.has(s); s++)
    prefix.push(s);
  ck(r.log.map((m) => m.seq).join() === prefix.join(), "T-57", () => `log ${r.log.map((m) => m.seq)} but the proved prefix of the known messages is ${prefix} (known ${[...have.keys()]})`);
  ck(r.forged === forged, "T-57", () => `forged count ${r.forged}, model ${forged}`);
  ck(JSON.stringify(known) === knownBefore, "T-57", () => "acceptLog changed what the phone already knew");
  ck(same(await acceptLog(cfg, eid, incoming, known), r.log), "T-57", () => "acceptLog and acceptLogDetailed disagree");
  ck(r.log.every((m, i) => m.seq === i + 1), "T-57", () => "the log has a gap");
  ck((await acceptLog(cfg, eid, [], known)).length === prefix.length, "T-57", () => "an empty answer undid known messages");
  for (let i = 0;i < 4; i++) {
    const base = { engagementId: eid, seq: rng.int(1, 5), action: rng.pick(["pause", "resume", "extend", "stop"]), atBeaconRound: rng.int(0, 99), signedAtRound: rng.int(0, 99), sig: "aa" };
    const bad = rng.int(0, 11);
    const x = bad === 0 ? { ...base, seq: rng.pick([0, -2, 2.5, NaN, Infinity, "3", null, undefined]) } : bad === 1 ? { ...base, action: rng.pick(["Pause", "end", "", 3, undefined]) } : bad === 2 ? { ...base, atBeaconRound: rng.pick([-1, 1.5, NaN, "4", Number.MAX_SAFE_INTEGER + 1, null]) } : bad === 3 ? { ...base, signedAtRound: rng.pick([-1, 0.5, undefined, "1"]) } : bad === 4 ? { ...base, untilRound: rng.pick([-1, 2.5, "9", null, 0, 7]) } : bad === 5 ? { ...base, sig: rng.pick([1, null, undefined, {}]) } : bad === 6 ? { ...base, engagementId: rng.pick([3, null, undefined]) } : bad === 7 ? rng.pick([null, undefined, 0, "", [], true]) : base;
    ck(wellFormed(x) === shapeO(x), "T-62", () => `wellFormed(${JSON.stringify(x)}) = ${wellFormed(x)}, model ${shapeO(x)}`);
  }
  const um = { engagementId: eid, seq: rng.int(1, 9), action: rng.pick(["pause", "resume", "extend", "stop"]), atBeaconRound: rng.int(0, 1e6), signedAtRound: rng.int(0, 1e6), ...rng.chance(0.5) ? { untilRound: rng.int(0, 1e6) } : {} };
  const text = new TextDecoder().decode(canonicalBytes(um));
  ck(text === `CBCTL1|${um.engagementId}|${um.seq}|${um.action}|${um.atBeaconRound}|${um.signedAtRound}|${um.untilRound ?? "-"}`, "T-62", () => `canonical bytes ${text}`);
  for (const bad of ["", "a b", "a|b", "a\tb"]) {
    let threw = false;
    try {
      canonicalBytes({ ...um, engagementId: bad });
    } catch {
      threw = true;
    }
    ck(threw, "T-62", () => `engagement id ${JSON.stringify(bad)} was signed`);
  }
  C.dims.control = "accept-log";
  C.params.accept = { eid, n, known: [...have.keys()], sub: rng.u32() };
}
async function trackerBlock(rng) {
  const eid = mkEid(rng), cfg = { pubKey: "cd".repeat(32), maxPauseRounds: 30, leadRounds: 13 };
  const sf = rng.pick([SAFETY_STANDARD, SAFETY_FAST, SAFETY_LEAN30, SAFETY_LEAN60]);
  const joined = rng.int(0, 500);
  const tr = new ControlTracker(cfg, eid, sf, joined);
  let lastGood = joined - sf.holdAfterRounds - 1, failing = null;
  let r = joined;
  const modeO = (now) => now - lastGood <= sf.holdAfterRounds ? "live" : failing !== null && now - failing >= sf.giveUpRounds ? "blind" : "hold";
  ck(tr.mode(joined) === modeO(joined) && tr.mode(joined) === "hold", "T-59", () => `a fresh phone is ${tr.mode(joined)}, it must hold until its first good answer`);
  for (let i = 0;i < 12; i++) {
    r += rng.pick([0, 1, 3, sf.holdAfterRounds, sf.holdAfterRounds + 1, sf.giveUpRounds, rng.int(0, 2 * sf.giveUpRounds)]);
    const kind = rng.weighted([["good", 40], ["null", 10], ["otherEid", 10], ["notArray", 8], ["badSig", 10], ["badShape", 8], ["fail", 14]]);
    let ok;
    if (kind === "fail")
      ok = tr.failed(r);
    else {
      const body = kind === "good" ? { engagementId: eid, messages: [] } : kind === "null" ? rng.pick([null, 5, "x", undefined]) : kind === "otherEid" ? { engagementId: eid + "x", messages: [] } : kind === "notArray" ? { engagementId: eid, messages: {} } : kind === "badSig" ? { engagementId: eid, messages: [{ engagementId: eid, seq: 1, action: "pause", atBeaconRound: 40, signedAtRound: 10, sig: "zz" }] } : { engagementId: eid, messages: [{ seq: 0 }] };
      ok = await tr.ingest(r, body);
    }
    const wantOk = kind === "good";
    ck(ok === wantOk, "T-59", () => `ingest(${kind}) -> ${ok}`);
    if (wantOk) {
      lastGood = r;
      failing = null;
    } else if (failing === null)
      failing = r;
    for (const d of [0, 1, sf.holdAfterRounds, sf.holdAfterRounds + 1, sf.giveUpRounds, sf.giveUpRounds + 1])
      ck(tr.mode(r + d) === modeO(r + d), "T-59", () => `mode at +${d}: ${tr.mode(r + d)}, model ${modeO(r + d)} (last good ${lastGood}, failing since ${failing}, hold ${sf.holdAfterRounds}, give up ${sf.giveUpRounds})`);
  }
  ck(tr.log.length === 0 && tr.state.intervals.length === 0 && tr.state.stopRound === null, "T-59", () => "a lie or an empty answer changed what the tracker applies");
  C.dims.control = "tracker";
  C.params.tracker = { eid, joined, profile: sf.holdAfterRounds, sub: rng.u32() };
}
async function safetyBlock(rng) {
  const S = SAFETY_STANDARD, F = SAFETY_FAST, L30 = SAFETY_LEAN30, L60 = SAFETY_LEAN60;
  ck(PERIOD_SEC === 3 && S.holdAfterRounds === 10 && S.leadRounds === 13 && S.giveUpRounds === 60 && F.holdAfterRounds === 7 && F.leadRounds === 10 && F.giveUpRounds === 60 && L30.holdAfterRounds === 26 && L30.leadRounds === 29 && L30.giveUpRounds === 156 && L60.holdAfterRounds === 50 && L60.leadRounds === 53 && L60.giveUpRounds === 300, "T-58", () => `profiles ${JSON.stringify([S, F, L30, L60])}`);
  for (let i = 0;i < 4; i++) {
    const inp = { pollMaxSec: rng.int(1, 120), cacheTtlSec: rng.int(0, 12), latencySec: rng.int(0, 12), missedPollsTolerated: rng.int(0, 3) };
    const s = deriveSafety(inp);
    const worst = inp.pollMaxSec + inp.cacheTtlSec + inp.latencySec;
    ck(s.leadRounds * 3 > s.holdAfterRounds * 3 + inp.cacheTtlSec, "T-58", () => `lead ${s.leadRounds} rounds does not cover hold ${s.holdAfterRounds} rounds plus cache ${inp.cacheTtlSec} s: ${JSON.stringify(inp)}`);
    ck(s.holdAfterRounds * 3 >= worst + inp.missedPollsTolerated * inp.pollMaxSec && s.holdAfterRounds >= 1, "T-58", () => `hold ${s.holdAfterRounds} rounds is shorter than the worst normal age: ${JSON.stringify(inp)}`);
    ck(s.giveUpRounds >= 60 && s.giveUpRounds >= 6 * s.holdAfterRounds && s.worstNormalAgeSec === worst && s.pollMaxSec === inp.pollMaxSec, "T-58", () => `give-up ${s.giveUpRounds}`);
    const slower = deriveSafety({ ...inp, pollMaxSec: inp.pollMaxSec + rng.int(1, 30) });
    ck(slower.leadRounds >= s.leadRounds && slower.holdAfterRounds >= s.holdAfterRounds, "T-58", () => "a slower poll gave a shorter hold or lead");
  }
  for (const cap of [1, 100, 250, 251, 500, 1000, 1001, 1500, 2000, 2001, 5000, 1e5, rng.int(1, 3000)]) {
    for (const fast of [false, true]) {
      const want = cap <= 250 ? fast ? F : S : cap <= 1000 ? L30 : cap <= 2000 ? L60 : null;
      ck(safetyForCap(cap, fast) === want, "T-58", () => `safetyForCap(${cap}, ${fast})`);
    }
  }
  ck(PAUSE_MAX_PARTICIPANTS === MANIFESTS.tictactoe.caps.auto && safetyForCap(MANIFESTS.tictactoe.caps.auto) !== null, "T-58", () => "a game of the largest allowed size cannot be paused");
  C.dims.control = "safety";
  C.params.safety = { sub: rng.u32() };
}
var PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
async function cryptoBlock(rng) {
  C.dims.control = "ed25519";
  const secret = rng.hex(32), other = rng.hex(32);
  const eid = "C" + rng.hex(4);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(secret, "hex")]), format: "der", type: "pkcs8" });
  const pubKey = createPublicKey(key);
  const pubO = pubKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const pub = publicKeyFromSecret(secret);
  ck(pub === pubO, "T-60", () => "the public key of a secret differs from node:crypto's");
  const mp = rng.pick([20, 60, 600]), safety = SAFETY_STANDARD, L = safety.leadRounds;
  const store = new Map;
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => {
    store.set(k, v);
  } };
  ck((await registerKey(kv, eid, pub, safety, mp)).ok === true, "T-60", () => "a new key was not registered");
  ck((await registerKey(kv, eid, publicKeyFromSecret(other), safety, mp)).ok === false, "T-60", () => "the registered key of an engagement can be swapped");
  ck((await registerKey(kv, "x y", pub)).ok === false && (await registerKey(kv, "ok-id", "zz")).ok === false, "T-60", () => "a bad engagement id or key was registered");
  let now = rng.int(100, 500);
  let accepted = 0;
  let lastSigned = null;
  const sigOf = (m) => {
    const s = signControlWithSecret(secret, m);
    const o = nodeSign(null, Buffer.from(canonicalBytes(m)), key).toString("hex");
    ck(s.sig === o, "T-60", () => `signature of seq ${m.seq} differs from node:crypto's`);
    ck(nodeVerify(null, Buffer.from(canonicalBytes(m)), pubKey, Buffer.from(s.sig, "hex")), "T-60", () => "node:crypto does not verify our signature");
    return s;
  };
  const n = rng.int(3, 4);
  for (let i = 0;i < n; i++) {
    const f = await readPublished(kv, eid);
    const st = oCtl(mp, L, f.messages);
    const cur = st.intervals.length ? st.intervals[st.intervals.length - 1] : null;
    const active = !!cur && cur.end > now + L + 1 && st.stopRound === null;
    const action = active ? rng.weighted([["resume", 40], ["extend", 35], ["pause", 10], ["stop", 15]]) : rng.weighted([["pause", 70], ["stop", 5], ["resume", 15], ["extend", 10]]);
    const m = nextMessage(f, now, { action, ...rng.chance(0.5) ? { pauseForRounds: rng.int(5, 60) } : {}, addRounds: rng.int(1, 40) });
    const signed = sigOf(m);
    const res = await publishControl(kv, eid, signed);
    const wantOk = !oCtl(mp, L, [...f.messages, signed]).ignored.includes(signed.seq);
    ck(res.ok === wantOk && (res.ok || res.status === 422), "T-60", () => `publish of ${action} (seq ${m.seq}) -> ${JSON.stringify(res)}, model says ${wantOk ? "accept" : "reject"}`);
    if (res.ok) {
      accepted++;
      lastSigned = signed;
      ck((await readPublished(kv, eid)).messages.length === accepted, "T-60", () => "an accepted message is not in the stored log");
    } else
      ck((await readPublished(kv, eid)).messages.length === accepted, "T-60", () => "a rejected message was stored");
    now += rng.int(1, 40);
  }
  if (lastSigned) {
    const again = await publishControl(kv, eid, lastSigned);
    ck(again.ok === true && again.duplicate === true, "T-60", () => "a replay was not recognised as one");
    const diff = sigOf({ ...lastSigned, atBeaconRound: lastSigned.atBeaconRound + 1 });
    const rd = await publishControl(kv, eid, diff);
    ck(!rd.ok && rd.status === 409, "T-60", () => `a second message under a used seq: ${JSON.stringify(rd)}`);
    const rs = await publishControl(kv, eid, signControlWithSecret(secret, { ...lastSigned, seq: accepted + 3 }));
    ck(!rs.ok && rs.status === 409, "T-60", () => "a seq with a gap was accepted");
    const rk = await publishControl(kv, eid, signControlWithSecret(other, { ...lastSigned, seq: accepted + 1 }));
    ck(!rk.ok && rk.status === 403, "T-60", () => "a message signed with another key was accepted");
    const re = await publishControl(kv, eid, { ...lastSigned, engagementId: eid + "z" });
    ck(!re.ok && re.status === 400, "T-60", () => "a message for another engagement was accepted");
    ck(await verifyControlSig(pub, lastSigned), "T-60", () => "a true signature does not verify");
    const flips = [
      { ...lastSigned, seq: lastSigned.seq + 1 },
      { ...lastSigned, action: lastSigned.action === "pause" ? "stop" : "pause" },
      { ...lastSigned, atBeaconRound: lastSigned.atBeaconRound + 1 },
      { ...lastSigned, signedAtRound: lastSigned.signedAtRound + 1 },
      { ...lastSigned, untilRound: (lastSigned.untilRound ?? 0) + 1 },
      { ...lastSigned, sig: lastSigned.sig.slice(0, 126) + (lastSigned.sig.endsWith("00") ? "01" : "00") },
      { ...lastSigned, sig: lastSigned.sig.slice(2) }
    ];
    for (const bad of [flips[rng.int(0, 4)], flips[5], flips[6]])
      ck(!await verifyControlSig(pub, bad), "T-60", () => `a changed message verifies: ${JSON.stringify(bad)}`);
    ck(!await verifyControlSig(publicKeyFromSecret(other), lastSigned) && !await verifyControlSig("zz", lastSigned) && !await verifyControlSig(pub, { ...lastSigned, sig: "zz" }), "T-60", () => "a wrong key or a malformed key / signature verifies");
  }
  const stored = (await readPublished(kv, eid)).messages;
  const ccfg = { pubKey: pub, maxPauseRounds: mp, leadRounds: L };
  const forgedOne = stored.length ? { ...stored[0], atBeaconRound: stored[0].atBeaconRound + 5 } : null;
  const r = await acceptLogDetailed(ccfg, eid, rng.shuffle([...stored, ...stored, ...forgedOne ? [forgedOne] : []]));
  ck(r.log.length === stored.length && r.log.every((m, i) => m.seq === i + 1 && m.sig === stored[i].sig), "T-60", () => `acceptLog returned ${r.log.length} of ${stored.length} real messages`);
  if (stored.length >= 2) {
    const cut = rng.int(1, stored.length - 1);
    const withheld = stored.filter((m) => m.seq !== cut);
    const g = await acceptLog(ccfg, eid, withheld);
    ck(g.length === cut - 1, "T-57", () => `message ${cut} withheld: the phone applied ${g.length} messages, it may apply only the ${cut - 1} before the gap`);
  }
  const wrong = await acceptLog({ ...ccfg, pubKey: publicKeyFromSecret(other) }, eid, stored);
  ck(wrong.length === 0, "T-60", () => "a log signed by another key was believed");
  const f2 = await readPublished(kv, eid);
  const A = resolveControl({ pubKey: f2.pubKey, maxPauseRounds: f2.maxPauseRounds, leadRounds: f2.leadRounds }, f2.messages), B = oCtl(mp, L, f2.messages);
  ck(same(A.intervals, B.intervals) && A.stopRound === B.stopRound && A.ignored.length === 0, "T-55", () => "the stored log resolves differently from the model, or holds an ignored message");
  C.params.crypto = { eid, n, mp };
}
async function kCtl(rng, withCrypto) {
  C.params.kind = "control";
  const blocks = [["log", ctlBlock], ["accept", acceptBlock], ["tracker", trackerBlock], ["safety", safetyBlock]];
  const w = [38, 30, 14, 8];
  const picked = [];
  const first = rng.weighted(blocks.map((b, i) => [b, w[i]]));
  picked.push(first[0]);
  await first[1](rng);
  if (rng.chance(0.5)) {
    const second = rng.weighted(blocks.map((b, i) => [b, w[i]]));
    if (second[0] !== first[0]) {
      picked.push(second[0]);
      await second[1](rng);
    }
  }
  if (withCrypto) {
    picked.push("ed25519");
    await cryptoBlock(rng);
  }
  C.params.blocks = picked;
  T(() => `control blocks ${picked.join(",")}`);
}
async function kSeal(rng) {
  C.params.kind = "seal";
  const seed = rng.hex(rng.pick([2, 8, 32]));
  const pool = ["first|M1|0", "auto|R1M3|0|1|4", "roster", "bracket", rng.hex(3), "\xE9|\xFC", "a b", "", "TTT-FATE|R2M1|2|p0001"];
  const NS = [1, 2, 3, 5, 9, 10, 64, 100, 255, 256, 257, 1000, 65536, 2 ** 31, 3000000000, 4294967295, 4294967296];
  for (let i = 0;i < 4; i++) {
    const label = rng.pick(pool) + (rng.chance(0.3) ? "|" + rng.int(0, 99) : "");
    const cnt = rng.pick([1, 7, 8, 9, 20]);
    const a = await stream(seed, label, cnt), b = streamO(seed, label, cnt);
    ck(same(a, b) && a.length === cnt && a.every((v) => Number.isInteger(v) && v >= 0 && v < 4294967296), "T-61", () => `stream(${seed}, ${label}, ${cnt}) differs from the model`);
    ck(await coin(seed, label) === coinO(seed, label), "T-61", () => `coin(${seed}, ${label})`);
    const nn = rng.pick(NS);
    const bv = await below(seed, label, nn);
    ck(bv === belowO(seed, label, nn) && bv >= 0 && bv < nn && Number.isInteger(bv), "T-61", () => `below(${seed}, ${label}, ${nn}) = ${bv}, model ${belowO(seed, label, nn)}`);
    const items = Array.from({ length: rng.pick([0, 1, 2, 3, 8, 17, 30]) }, (_, k) => "i" + k);
    const sh = await shuffled(seed, label, items);
    ck(same(sh, shuffledO(seed, label, items)) && same([...sh].sort(), [...items].sort()), "T-61", () => `shuffled(${seed}, ${label}, ${items.length} items)`);
  }
  for (let i = 0;i < 3; i++) {
    const len = rng.pick([0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, rng.int(0, 200)]);
    let s = "";
    for (let k = 0;k < len; k++)
      s += rng.pick(["a", "Z", "7", "|", " ", "\xE9", "\u20AC", "\uD83D\uDE00", "\u4E2D"]);
    const want = createHash2("sha256").update(s, "utf8").digest("hex");
    ck(await sha256Hex(s) === want && H(s) === want, "T-61", () => `sha256 of ${JSON.stringify(s.slice(0, 20))} (${s.length} units) differs from node:crypto`);
  }
  const secret = rng.hex(32), pids = Array.from({ length: rng.int(0, 6) }, () => "p" + rng.hex(2));
  const ee = "E" + rng.hex(2), bc = rng.chance(0.5) ? rng.hex(8) : "";
  ck(await rosterHash(pids) === rosterHashO(pids) && await commitOf(secret) === commitO(secret) && await seedOf(secret, ee, pids, bc) === seedO(secret, ee, pids, bc), "T-61", () => "rosterHash, commit or seed differ from the model");
  ck(await verifyReveal(secret, await commitOf(secret)) && !await verifyReveal(secret, await commitOf(secret + "0")), "T-61", () => "verifyReveal");
  C.dims.seal = seed.length === 4 ? "short-seed" : seed.length === 16 ? "mid-seed" : "full-seed";
  C.params.seal = { seed, pids: pids.length, sub: rng.u32() };
  T(() => `seal: seed ${seed}`);
}

// games/tictactoe/scenario.ts
var meta = {
  game: "tictactoe",
  sha: "4e40c2b",
  dimensions: {
    kind: ["match", "tournament", "pause", "mailbox", "platform", "control", "seal"],
    board: ["win", "forfeit", "fate", "open", "mismatch"],
    games: [1, 2, 3],
    strategies: "open",
    illegal: ["yes", "no"],
    illegalTaps: ["yes", "no"],
    pausedBoard: ["yes", "no"],
    clockOut: ["yes", "no"],
    removed: ["yes", "no"],
    byes: ["some", "none"],
    players: ["2", "3-4", "5-8", "9-16", "17+"],
    format: ["solo", "team3", "team5"],
    mix: ["all-perfect", "mostly-absent", "some-absent", "all-present"],
    pauses: ["0", "1", "2", "3"],
    events: ["clean", "with-junk"],
    platform: ["roles", "team", "clock", "late", "invites", "links", "ids", "db", "constants", "guards", "capacity"],
    control: ["no-pause", "paused-1", "paused-2", "paused-3", "stopped", "accept-log", "tracker", "safety", "ed25519"],
    seal: ["short-seed", "mid-seed", "full-seed"],
    crash: ["yes"]
  },
  rules: {
    "T-01": "A tap is accepted exactly when the rules allow it (a player of the board, their turn, a free square 0 to 8, not stale), and a refused tap changes nothing.",
    "T-02": "Three marks in a line win: the engine's win test and turn rule agree with the eight lines on every position of all 255,168 games.",
    "T-03": "A board is one pair and up to 3 games: the first decided game ends it, a drawn game is replayed with the marks swapped, and after three draws the lower fate number wins.",
    "T-04": "Who plays X comes from the public coin of the sealed seed: game 1 by its own coin, game 2 swapped, game 3 by its own coin.",
    "T-05": "Two clock-outs in a row by one player in one game lose the board.",
    "T-06": "A move put in for a player whose clock ran out is stamped at the moment the clock ran out, and its square is the seeded pick among the empty squares.",
    "T-07": "After every action (tap, look, pause) the board equals the independent model: squares, marks, moves, clock, deadline, points and how it ended.",
    "T-08": "Looking at a board more or less often gives the very same board.",
    "T-09": "A board is re-verified from its public record alone (seed, moves, times) and the replay gives the very same board.",
    "T-10": "A finished board has exactly one winner of its two players, a proper ending (win, forfeit or fate) and points of 2 per game won and 1 per game drawn.",
    "T-11": "Tic-tac-toe theory holds: a player whose every move in a game was best never loses that game, and two such players draw.",
    "T-12": "The 255,168 possible games count as known (131,184 X wins, 77,904 O wins, 46,080 draws, by length) in the model and in the engine's own pieces.",
    "T-20": "The knockout bracket (size, rounds, byes only in round 1, the first-round pairs) equals the independent model whatever order the names arrive in; bad input is refused.",
    "T-21": "Winners move up: every later match is between the winners of its two feeders, every match that is not a bye is played, and the final's winner is the champion.",
    "T-22": "Entrants and teams are cut from the seeded shuffle (teams of 3 or 5, the rest in reserve); a match is won by the majority of its boards; impossible team sizes are refused.",
    "T-23": "Every played match is done with a winner and a loser from its two sides, and every board has a proper winner.",
    "T-24": "The ranking follows the strict order (round reached, points, points in the last match, fate), equals the independent ranking, and puts the champion first and the final's loser second.",
    "T-25": "A match opens only after both feeders have ended (round 1 at the start time) and its finish time is the last moment of its last game.",
    "T-26": "The spectator view never contains the sealed seed.",
    "T-27": "The sealed seed: the commit is the hash of the secret, the seed depends on the secret, the event, the closed roster (in any order) and the beacon, and only the true secret verifies.",
    "T-28": "Taps made through the tournament routes, legal and illegal, are answered as the model says, and a refused tap changes nothing.",
    "T-30": "Pauses change nothing but time: with pauses the same taps give the same tournament, every stamp later by exactly the pauses before it.",
    "T-31": "The tournament clock (wall time minus pauses) never runs backwards or faster than the wall clock, equals the model, and converts back to wall time outside pauses.",
    "T-32": "A phone rebuilds a board from the stored events (stamps, pauses, junk, absent claims, any order, only a late claim) to the very same board.",
    "T-33": "The bracket a phone computes from the setup equals the model's and startTournament's whatever order the roster arrives in, and the draw sent to the mailbox is complete.",
    "T-40": "Only the Organizer and Hosts control the clock, only the Organizer edits setup, Organizer and Hosts get the end PDF, participants and family play, and any other role has no permission.",
    "T-41": "The Host / Co-host list: at most 5 Hosts, the Organizer adds Hosts, the Organizer or a Host adds Co-hosts, one role per person, a Host needs an approved key before controlling, and the change list holds roles only.",
    "T-42": "Admission: one seat per ID, a closed group lets in only the listed and the rest wait, a full or not-yet-open game refuses.",
    "T-43": "The pause clock: only the Organizer or a Host pauses and resumes, game time is wall time minus time paused and never runs backwards, and start is automatic at the published time or manual by the Organizer or a Host.",
    "T-44": "Late joining: allowed in round 1, after it only inside the Organizer's window (0 to 300 s from the end of round 1), never once the game is over.",
    "T-45": "Guest invitations and entry settings validate as documented (on or off, 1 to 10 each, the known kinds of guest, employees-only switches them off, how a person is identified).",
    "T-46": "Link codes: the Organizer, each Host, each Co-host and each guest seat have their own range and every code converts back to the same inviter.",
    "T-47": "Names and IDs are cleaned as documented: no markup or invisible characters, nothing a spreadsheet would run, employee IDs only A-Z 0-9 up to 30, e-mail IDs with a shape, old games keep the old rule.",
    "T-48": "A Co-host's list limit (default 100, 10 to 1000), a guest's invites each, and the chain of people who may answer a waiting request.",
    "T-49": "Move clocks are 10, 20, 30 or 60 seconds, a game's end bound is its end plus 60 s or its start plus 6 h, and the lifetimes keep the report link before the deletion.",
    "T-50": "The manifest (2000 people, no late join after round 1, five places, automatic claim, pause supported), the time-slot rule, the tie split and the engine limits are as published.",
    "T-51": "Whatever number of players the start route accepts, the draw for that many can be sent to the mailbox within its request limits.",
    "T-52": "The two ID cleaners (the server's and the shared game-core one) give the same ID for the same text.",
    "T-53": "An e-mail ID with no shape is refused by the shared Host / Co-host list as it is by the server.",
    "T-54": "A cleaned name never ends in a space or in half a character.",
    "T-55": "A signed control log resolves to the pause intervals, stop round and ignored messages the rules give (lead time, one pause at a time, resume inside a pause, extend later, stop is final).",
    "T-56": "The call schedule is the plain schedule pushed later by exactly the pauses, never inside a pause, never after a stop, and does not depend on the order the log arrives in.",
    "T-57": "A phone applies only the unbroken prefix of the control log it can prove (a missing message cuts it), drops forged and malformed messages, and replays are harmless.",
    "T-58": "The safety numbers (hold, lead, give-up) are the published ones, keep the lead longer than the hold plus the cache time, and a pause profile exists for every size the game allows.",
    "T-59": "A phone is live while its last good answer is fresh, holds when it is old and goes blind only after a long unbroken run of failures; a lie changes nothing.",
    "T-60": "Real Ed25519: keys and signatures equal node:crypto's, tampered or foreign messages do not verify, and the publish pipeline accepts exactly the messages the rules accept.",
    "T-61": "The public randomness (stream, coin, below, shuffled) and the hashes of the sealed seed equal the model and node:crypto's SHA-256.",
    "T-62": "A control message has the documented shape and its signed bytes have the documented text.",
    CRASH: "The real engine threw an error on input the product can produce."
  }
};
var KINDS2 = [["match", 48], ["tournament", 6], ["pause", 3], ["mailbox", 5], ["platform", 26], ["control", 6], ["seal", 6]];
function run(seed, trace) {
  installShim();
  reset(trace, meta.rules);
  const rng = new Rng(seed);
  const crypto3 = seed % CRYPTO_EVERY === 0;
  const kind = crypto3 ? "control" : rng.weighted(KINDS2);
  sync((async () => {
    switch (kind) {
      case "match":
        await kMatch(rng);
        break;
      case "tournament":
        await kTournament(rng);
        break;
      case "pause":
        await kPause(rng);
        break;
      case "mailbox":
        await kMail(rng);
        break;
      case "platform":
        await kPlat(rng);
        break;
      case "control":
        await kCtl(rng, crypto3);
        break;
      case "seal":
        await kSeal(rng);
        break;
    }
    if (seed % 50000 === 0) {
      kExhaustive();
      C.params.exhaustive = true;
    }
  })());
  C.dims.kind = kind;
  return { params: C.params, dims: C.dims, checks: C.checks, fails: C.fails };
}

// games/tictactoe/main.ts
main(meta, run);
