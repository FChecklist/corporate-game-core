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

// node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

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
  const { BASE, Fp: Fp3, Fn } = Point;
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

// src-tambola-fe030e8/packages/beacon/src/control.ts
var PERIOD_SEC = 3;
var NEXT_LEAD_ROUNDS = 2;
var MAX_HOST_KEYS = 5;
function hostGapsFor(breaks, rounds = 1, intermissionRounds = 30) {
  const out = breaks.map((b) => ({ at: b.after, rounds: b.seconds / PERIOD_SEC }));
  for (let r = 2;r <= rounds; r++)
    out.push({ at: (r - 1) * 90, rounds: intermissionRounds });
  return out.sort((a, b) => a.at - b.at);
}
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
  return new TextEncoder().encode(`CTCTL1|${m.engagementId}|${m.seq}|${m.action}|${m.atBeaconRound}|${m.signedAtRound}|${m.untilRound ?? "-"}`);
}
function signControlWithSecret(secretHex, m) {
  return { ...m, sig: hex(ed25519.sign(canonicalBytes(m), unhex(secretHex))) };
}
var publicKeyFromSecret = (secretHex) => hex(ed25519.getPublicKey(unhex(secretHex)));
async function verifyAnySig(cfg, m) {
  for (const k of [cfg.pubKey, ...cfg.hostKeys ?? []])
    if (await verifyControlSig(k, m))
      return true;
  return false;
}
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
  return !!x && typeof x === "object" && typeof x.engagementId === "string" && isInt(x.seq) && x.seq >= 1 && ["pause", "resume", "extend", "stop", "next", "go"].includes(x.action) && isInt(x.atBeaconRound) && isInt(x.signedAtRound) && (x.untilRound === undefined || isInt(x.untilRound)) && typeof x.sig === "string";
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
    if (await verifyAnySig(cfg, raw))
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
var NEXT_REFUSALS = {
  auto: "In this game the software calls the numbers, so there is no button to press.",
  lead: "That press did not go through. Please press again.",
  paused: "The game is paused. Press Resume first, then the next number.",
  order: "One moment: the last number is still on its way to the phones.",
  gap: "Please wait: the break is still on. The next number can come when it ends.",
  done: "Every number has been called.",
  start: "Press Start first. The numbers begin after Start.",
  early: "Please wait a moment: the game is just starting."
};
var BIG_GAME_REFUSAL = "Pause and End are available for games of up to 2,000 people. This game runs without them.";
var GO_REFUSALS = {
  auto: 'This game starts by itself at the scheduled time, so there is no Start button. To start by pressing Start, change "How does it start?" first.',
  early: "The game cannot be started before its start time. To start earlier, change the start time first.",
  lead: "That press did not go through. Please press Start again.",
  again: "The game has already been started."
};
function check(m, cfg, cur, stopped, nexts, go) {
  if (stopped)
    return "engagement already stopped";
  if (m.signedAtRound > m.atBeaconRound)
    return "takes effect before it was signed";
  if (cfg.startOnly && (m.action === "pause" || m.action === "resume" || m.action === "extend" || m.action === "stop"))
    return BIG_GAME_REFUSAL;
  const lead = m.atBeaconRound - m.signedAtRound;
  const paused = cur && cur.start <= m.atBeaconRound && m.atBeaconRound < effEnd(cur, cfg.maxPauseRounds);
  switch (m.action) {
    case "next": {
      if (cfg.callMode !== "host")
        return NEXT_REFUSALS.auto;
      if (lead !== NEXT_LEAD_ROUNDS || m.untilRound !== undefined)
        return NEXT_REFUSALS.lead;
      if (paused)
        return NEXT_REFUSALS.paused;
      if (cfg.startMode === "manual") {
        if (go === null)
          return NEXT_REFUSALS.start;
        if (m.atBeaconRound < go)
          return NEXT_REFUSALS.early;
      }
      const k = nexts.length, prev = k ? nexts[k - 1] : -1;
      if (k >= (cfg.maxNexts ?? 450))
        return NEXT_REFUSALS.done;
      if (m.atBeaconRound <= prev)
        return NEXT_REFUSALS.order;
      const gap = (cfg.hostGaps ?? []).find((g) => g.at === k);
      if (gap && k > 0 && m.atBeaconRound < prev + 1 + gap.rounds)
        return NEXT_REFUSALS.gap;
      return null;
    }
    case "go":
      if (cfg.startMode !== "manual")
        return GO_REFUSALS.auto;
      if (go !== null)
        return GO_REFUSALS.again;
      if (cfg.startNotBefore !== undefined && m.signedAtRound < cfg.startNotBefore)
        return GO_REFUSALS.early;
      if (lead < cfg.leadRounds || m.untilRound !== undefined)
        return GO_REFUSALS.lead;
      return null;
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
  let cur = null, stop = null, applied = 0, goAt = null;
  const ignored = [], nextRounds = [];
  for (const m of [...log].sort((a, b) => a.seq - b.seq)) {
    const why = check(m, cfg, cur, stop !== null, nextRounds, goAt);
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
    else if (m.action === "next")
      nextRounds.push(m.atBeaconRound);
    else if (m.action === "go")
      goAt = m.atBeaconRound;
    else
      stop = m.atBeaconRound;
  }
  return { intervals: withHolds(ivs.map((c) => ({ start: c.start, end: effEnd(c, cfg.maxPauseRounds) })), cfg.callMode === "host" ? [] : holds), stopRound: stop, ignored, applied, nextRounds, host: cfg.callMode === "host", manualStart: cfg.startMode === "manual", goRound: goAt, ...cfg.fullGap ? { fullGap: true } : {} };
}
var pausedAt = (s, round) => s.intervals.some((i) => round >= i.start && round < i.end);
function hostCallRound(s, k) {
  const r = s.nextRounds[k];
  if (r !== undefined)
    return s.stopRound !== null && r >= s.stopRound ? null : r;
  return s.stopRound !== null ? null : Infinity;
}
var MAX_CALLS = 450;
var shiftCache = new Map;
function pauseShifts(ivs, stride, base, key, fullGap = true) {
  if (!fullGap)
    return ivs.map((i) => i.end - i.start);
  const ck = `${key}|${stride}|${ivs.map((i) => `${i.start}-${i.end}`).join(",")}`;
  const hit = shiftCache.get(ck);
  if (hit)
    return hit;
  const sh = [];
  for (let j = 0;j < ivs.length; j++) {
    const s = ivs[j].start, len = ivs[j].end - s;
    let first = -1;
    for (let k = 0;k < MAX_CALLS; k++) {
      let a = base(k);
      for (let m = 0;m < j; m++)
        if (a >= ivs[m].start)
          a += sh[m];
      if (a >= s) {
        first = a;
        break;
      }
    }
    sh.push(first < 0 ? len : len + Math.max(0, stride - (first - s)));
  }
  if (shiftCache.size > 200)
    shiftCache.clear();
  shiftCache.set(ck, sh);
  return sh;
}
function pushedByPauses(a, ivs, shifts) {
  for (let j = 0;j < ivs.length; j++)
    if (a >= ivs[j].start)
      a += shifts[j];
  return a;
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
var SAFETY_BIG10K = deriveSafety({ pollMaxSec: 90, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 });
var SAFETY_BIG = deriveSafety({ pollMaxSec: 120, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 });
var PAUSE_MAX_PARTICIPANTS = 2000;
var MANUAL_MAX_PARTICIPANTS = 1000;
function safetyForCap(cap, fast = false) {
  if (cap <= 250)
    return fast ? SAFETY_FAST : SAFETY_STANDARD;
  if (cap <= 1000)
    return SAFETY_LEAN30;
  if (cap <= PAUSE_MAX_PARTICIPANTS)
    return SAFETY_LEAN60;
  return null;
}
function startSafetyForCap(cap) {
  const s = safetyForCap(cap);
  if (s)
    return { safety: s, startOnly: false };
  return { safety: cap <= 1e4 ? SAFETY_BIG10K : SAFETY_BIG, startOnly: true };
}
var fileKey = (id) => `control/${id}.json`;
async function readPublished(kv, engagementId) {
  const t = await kv.get(fileKey(engagementId));
  return t ? JSON.parse(t) : null;
}
var hostControlOf = (game) => ({
  ...game?.callMode === "host" ? { callMode: "host", hostGaps: hostGapsFor(game.breaks ?? [], game.rounds ?? 1), maxNexts: 90 * (game.rounds ?? 1) } : { callMode: "auto", hostGaps: [], maxNexts: 0 },
  startMode: game?.startMode === "manual" ? "manual" : "auto",
  startNotBefore: game?.startMode === "manual" ? game.startNotBefore : undefined
});
var cfgOf = (f, game) => ({
  pubKey: f.pubKey,
  maxPauseRounds: f.maxPauseRounds,
  leadRounds: f.leadRounds,
  ...f.hostKeys?.length ? { hostKeys: f.hostKeys } : {},
  ...f.startOnly ? { startOnly: true } : {},
  ...f.fullGap ? { fullGap: true } : {},
  ...game?.callMode === "host" || game?.startMode === "manual" ? hostControlOf(game) : {}
});
async function addHostKey(kv, engagementId, pubKeyHex) {
  if (!/^[0-9a-f]{64}$/i.test(pubKeyHex))
    return { ok: false, error: "The public key must be 32 bytes in hex." };
  const f = await readPublished(kv, engagementId);
  if (!f)
    return { ok: false, error: "No key is registered for this engagement." };
  const k = pubKeyHex.toLowerCase(), have = f.hostKeys ?? [];
  if (k === f.pubKey || have.includes(k))
    return { ok: true, added: false };
  if (have.length >= MAX_HOST_KEYS)
    return { ok: false, error: `At most ${MAX_HOST_KEYS} Host keys can sign for one game.` };
  f.hostKeys = [...have, k];
  await kv.put(fileKey(engagementId), JSON.stringify(f));
  return { ok: true, added: true };
}
async function registerKey(kv, engagementId, pubKeyHex, safety = SAFETY_STANDARD, maxPauseRounds = 600, opts = {}) {
  if (!/^[0-9a-f]{64}$/i.test(pubKeyHex))
    return { ok: false, error: "The public key must be 32 bytes in hex." };
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(engagementId))
    return { ok: false, error: "Bad engagement id." };
  if (await readPublished(kv, engagementId))
    return { ok: false, error: "A key is already registered for this engagement and cannot be changed." };
  const f = { v: 1, engagementId, pubKey: pubKeyHex.toLowerCase(), maxPauseRounds, leadRounds: safety.leadRounds, messages: [], fullGap: true, ...opts.startOnly ? { startOnly: true } : {} };
  await kv.put(fileKey(engagementId), JSON.stringify(f));
  return { ok: true };
}
async function publishControl(kv, engagementId, msg, game) {
  const f = await readPublished(kv, engagementId);
  if (!f)
    return { ok: false, status: 404, error: "No key is registered for this engagement." };
  if (!wellFormed(msg) || msg.engagementId !== engagementId)
    return { ok: false, status: 400, error: "Malformed control message." };
  const cfg = cfgOf(f, game);
  if (!await verifyAnySig(cfg, msg))
    return { ok: false, status: 403, error: "Signature does not match the organizer key." };
  const existing = f.messages.find((m) => m.seq === msg.seq);
  if (existing)
    return existing.sig === msg.sig ? { ok: true, seq: msg.seq, duplicate: true } : { ok: false, status: 409, error: "That sequence number is already used." };
  if (msg.seq !== f.messages.length + 1)
    return { ok: false, status: 409, error: `Next sequence number is ${f.messages.length + 1}.` };
  const after = resolveControl(cfg, [...f.messages, msg]);
  const bad = after.ignored.find((x) => x.seq === msg.seq);
  if (bad)
    return { ok: false, status: 422, error: msg.action === "next" || msg.action === "go" || bad.why === BIG_GAME_REFUSAL ? bad.why : `Not accepted: ${bad.why}.` };
  f.messages.push(msg);
  await kv.put(fileKey(engagementId), JSON.stringify(f));
  return { ok: true, seq: msg.seq };
}
function describeControl(f, nowRound, game) {
  if (!f)
    return { registered: false };
  const st = resolveControl(cfgOf(f, game), f.messages);
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
    nextRounds: st.nextRounds,
    goRound: st.goRound,
    pausedNow: nowRound === undefined ? undefined : pausedAt(st, nowRound),
    stopped: nowRound === undefined || st.stopRound === null ? undefined : nowRound >= st.stopRound
  };
}

// src-tambola-fe030e8/packages/beacon/src/index.ts
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
var NUMBERS = 90;
var u8 = (n) => String(n);
function pickNumber(engagementId, k, randomnessHex, called) {
  const taken = new Set(called);
  const remaining = [];
  for (let n = 1;n <= NUMBERS; n++)
    if (!taken.has(n))
      remaining.push(n);
  if (remaining.length === 0)
    throw new Error("All 90 numbers have been called.");
  const h = sha2562(utf8ToBytes(`CT1|${engagementId}|${u8(k)}|${randomnessHex}`));
  let v = 0n;
  for (const b of h)
    v = v << 8n | BigInt(b);
  return remaining[Number(v % BigInt(remaining.length))];
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
// src-tambola-fe030e8/packages/beacon/src/config.ts
var baseKey = (k) => {
  const i = k.indexOf("@");
  return i < 0 ? k : k.slice(0, i);
};
var ticketOfKey = (k) => {
  const i = k.indexOf("@");
  return i < 0 ? 0 : Number(k.slice(i + 1)) === 2 ? 2 : Number(k.slice(i + 1)) === 1 ? 1 : 0;
};
var MAX_PLANNED_PRIZES = 30;
var cleanPlan = (raw) => {
  if (raw === null)
    return null;
  const r = raw;
  if (!r || typeof r !== "object" || r.mode !== "auto" && r.mode !== "manual")
    return "bad";
  const currency = typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency) ? r.currency : "INR";
  const budget = Number.isInteger(r.budget) && r.budget >= 0 && r.budget <= 10000000000 ? r.budget : "bad";
  const count = Number.isInteger(r.count) && r.count >= 1 && r.count <= MAX_PLANNED_PRIZES ? r.count : "bad";
  if (budget === "bad" || count === "bad" || !Array.isArray(r.prizes) || r.prizes.length < 1 || r.prizes.length > MAX_PLANNED_PRIZES)
    return "bad";
  const seen = new Set, prizes = [];
  for (const p of r.prizes) {
    if (!p || typeof p.id !== "string" || !/^[0-2]:[a-z0-9]{3,12}:[1-9][0-9]?$/.test(p.id) || seen.has(p.id) || !Number.isInteger(p.amount) || p.amount < 1 || p.amount > 10000000000)
      return "bad";
    seen.add(p.id);
    const gift = typeof p.gift === "string" ? p.gift.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    prizes.push({ id: p.id, amount: p.amount, ...gift ? { gift } : {} });
  }
  return { mode: r.mode, currency, budget, count, prizes };
};
var MAX_WINNERS_PER_HOUSE = 100;
var PRIZE_HOUSES = [
  { id: "early5", label: "Early Five", how: "Be the first to mark any 5 of your numbers.", max: MAX_WINNERS_PER_HOUSE, kind: "any", legacy: true },
  { id: "early7", label: "Early Seven", how: "Be the first to mark any 7 of your numbers.", max: MAX_WINNERS_PER_HOUSE, kind: "any" },
  { id: "early10", label: "Early Ten", how: "Be the first to mark any 10 of your numbers.", max: MAX_WINNERS_PER_HOUSE, kind: "any" },
  { id: "top", label: "Top Line", how: "Mark all 5 numbers of the top line.", max: MAX_WINNERS_PER_HOUSE, kind: "set", legacy: true },
  { id: "mid", label: "Middle Line", how: "Mark all 5 numbers of the middle line.", max: MAX_WINNERS_PER_HOUSE, kind: "set", legacy: true },
  { id: "bot", label: "Bottom Line", how: "Mark all 5 numbers of the bottom line.", max: MAX_WINNERS_PER_HOUSE, kind: "set", legacy: true },
  { id: "twolines", label: "Two Lines", how: "Be the first to complete any two of your three lines.", max: MAX_WINNERS_PER_HOUSE, kind: "lines" },
  { id: "corners", label: "Four Corners", how: "Mark the first and last number of the top and bottom lines.", max: MAX_WINNERS_PER_HOUSE, kind: "set", legacy: true },
  { id: "star", label: "Star", how: "Mark the four corners and the centre number of the middle line.", max: MAX_WINNERS_PER_HOUSE, kind: "set", legacy: true },
  { id: "plus", label: "Plus", how: "Mark the whole middle line and the middle number of the top and bottom lines.", max: MAX_WINNERS_PER_HOUSE, kind: "set" },
  { id: "frame", label: "Frame", how: "Mark the top line, the bottom line and the first and last number of the middle line.", max: MAX_WINNERS_PER_HOUSE, kind: "set" },
  { id: "topbottom", label: "Top and Bottom", how: "Mark both the top line and the bottom line.", max: MAX_WINNERS_PER_HOUSE, kind: "set" },
  { id: "midcorners", label: "Middle and Corners", how: "Mark the whole middle line and the four corners.", max: MAX_WINNERS_PER_HOUSE, kind: "set" },
  { id: "odd5", label: "Odd Five", how: "Be the first to mark any 5 odd numbers.", max: MAX_WINNERS_PER_HOUSE, kind: "any" },
  { id: "even5", label: "Even Five", how: "Be the first to mark any 5 even numbers.", max: MAX_WINNERS_PER_HOUSE, kind: "any" },
  { id: "low5", label: "Low Five", how: "Be the first to mark 5 numbers from 1 to 30.", max: MAX_WINNERS_PER_HOUSE, kind: "any" },
  { id: "high5", label: "High Five", how: "Be the first to mark 5 numbers from 61 to 90.", max: MAX_WINNERS_PER_HOUSE, kind: "any" },
  { id: "full", label: "Full House", how: "Mark all 15 numbers of your ticket.", max: MAX_WINNERS_PER_HOUSE, kind: "set", legacy: true },
  { id: "full2", label: "Super Bumper House", how: "Mark all 30 numbers of your two tickets together.", max: MAX_WINNERS_PER_HOUSE, kind: "set", scope: "two_ticket" },
  { id: "unlucky", label: "Unlucky", how: "Goes to the ticket with the fewest numbers marked when the first Full House is completed (or when the game ends). A tie is settled fairly by the game's public random number.", max: 1, kind: "global" }
];
var HOUSES_LINE = PRIZE_HOUSES.filter((h) => h.id !== "full2").map((h) => `${h.id} = ${h.label} (${h.max === 1 ? "1 winner" : `up to ${h.max} winners`})`).join(", ");
var HOUSES_HELP_LIST = PRIZE_HOUSES.map((h) => `${h.id}: ${h.label}. ${h.how} ${h.max === 1 ? "1 winner." : `Up to ${h.max} winners.`}`);
var HOUSES_HELP = HOUSES_HELP_LIST.join(String.fromCharCode(10));
var HOUSE_ORDER = PRIZE_HOUSES.map((h) => h.id);
var HOUSE_BY_ID = new Map(PRIZE_HOUSES.map((h) => [h.id, h]));
var houseLabel = (id) => {
  const t = ticketOfKey(id), b = baseKey(id);
  return (t ? `Ticket ${t}: ` : "") + (HOUSE_BY_ID.get(b)?.label ?? b);
};
var maxWinnersFor = (id) => HOUSE_BY_ID.get(baseKey(id))?.max ?? 1;
var LEGACY_MAX_ORDINAL = 5;
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
var CLAIM_WINDOW_CALLS = 1;
var VERIFY_MODES = ["mobile", "id", "either", "both"];
var quorumFor = (people) => people <= 6 ? Math.max(1, Math.ceil(people / 2)) : Math.min(25, Math.max(3, Math.ceil(people * 0.05)));
var votersFor = (people) => people <= 12 ? people : 4 * quorumFor(people);
var MAX_ROUNDS = 5;
var GRACE_ROUNDS = 40;
var LATE_LAG_ROUNDS = 30;
var INTERMISSION_ROUNDS = 30;
var roundEid = (eid, round) => round <= 1 ? eid : `${eid}~r${round}`;
var PATTERN_ORDER = ["early5", "top", "mid", "bot", "corners", "star", "full"];
var MAX_MID_PER_TICKET = 3;
var maxMidFor = (tickets) => MAX_MID_PER_TICKET * tickets;
var maxEdgeFor = (tickets) => tickets;
var brandMomentsFor = (tickets) => 5 * tickets;
var OPENING_WINDOW_SECONDS = GRACE_ROUNDS * 3;
var autoAfter = (n, k) => Math.min(89, Math.max(1, Math.round(90 * k / (n + 1))));
var MAX_REWARD_LINES = 300;
var MAX_ORDINAL = Math.max(LEGACY_MAX_ORDINAL, ...PRIZE_HOUSES.map((h) => h.max));
var KINDS = new Set(["file", "youtube", "slides", "speech", "lucky"]);
var LUCKY_WINNERS = [1, 3, 5, 10];
var defaultRewards = () => PATTERN_ORDER.map((pattern) => ({ pattern, scope: "ticket", ordinal: 1, text: "" }));
var defaultCfg = () => ({ tickets: 1, ties: "next", rewards: defaultRewards(), breaks: [], rounds: 1, invites: defaultInvites(), opening: [], closing: [] });
var keyOfLine = (l) => l.scope === "two_ticket" ? "full2" : l.scope === "ticket_1" ? `${l.pattern}@1` : l.scope === "ticket_2" ? `${l.pattern}@2` : l.pattern;
var keysInPlay = (rewards) => {
  const seen = new Set;
  const order = HOUSE_ORDER;
  for (const l of rewards)
    seen.add(keyOfLine(l));
  const plain = order.filter((k) => seen.has(k));
  const perTicket = [...seen].filter((k) => ticketOfKey(k) > 0).sort((a, b) => ticketOfKey(a) - ticketOfKey(b) || order.indexOf(baseKey(a)) - order.indexOf(baseKey(b)));
  return perTicket.length ? [...perTicket, ...plain] : plain;
};
var linesFor = (rewards, key) => rewards.filter((l) => keyOfLine(l) === key).sort((a, b) => a.ordinal - b.ordinal);
var breakShift = (breaks, k) => breaks.reduce((s, b) => s + (b.after <= k ? b.seconds / 3 : 0), 0);
var cleanText = (s, max) => typeof s === "string" ? s.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
var YT = /^https:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;
var SITE_MEDIA = /^\/[A-Za-z0-9._-]{1,80}\.(mp4|webm|m4a|mp3)$/i;
function validateCfg(input, base = defaultCfg(), opts = {}) {
  const cfg = { tickets: base.tickets, ...base.ties ? { ties: base.ties } : {}, rewards: base.rewards, breaks: base.breaks, rounds: base.rounds ?? 1, invites: base.invites ?? defaultInvites(), opening: base.opening ?? [], closing: base.closing ?? [], ...base.name ? { name: base.name } : {}, ...base.brand ? { brand: base.brand } : {}, ...base.callMode === "host" ? { callMode: "host" } : {}, ...base.startMode === "manual" ? { startMode: "manual" } : {}, ...base.keepCalling ? { keepCalling: true } : {}, ...base.demo ? { demo: true } : {}, ...base.verify ? { verify: base.verify } : {}, ...base.employeesOnly ? { employeesOnly: true } : {}, ...base.idKind === "email" ? { idKind: "email" } : {}, ...base.prizePlan ? { prizePlan: base.prizePlan } : {} };
  if (input.callMode !== undefined) {
    if (input.callMode !== "auto" && input.callMode !== "host")
      return { ok: false, error: "Who calls the numbers: choose the software (auto) or a Host pressing a button for each number (host)." };
    if (input.callMode === "host")
      cfg.callMode = "host";
    else
      delete cfg.callMode;
  }
  if (input.startMode !== undefined) {
    if (input.startMode !== "auto" && input.startMode !== "manual")
      return { ok: false, error: "How does the game start: by itself at the time (auto) or when you press Start (manual)." };
    if (input.startMode === "manual")
      cfg.startMode = "manual";
    else
      delete cfg.startMode;
  }
  if (input.afterPrizes !== undefined) {
    if (input.afterPrizes !== "keep" && input.afterPrizes !== "end")
      return { ok: false, error: "When every prize is won: keep calling until all 90 numbers (keep), or end the game (end)." };
    if (input.afterPrizes === "keep")
      cfg.keepCalling = true;
    else
      delete cfg.keepCalling;
  }
  if (input.demo !== undefined) {
    if (input.demo === true || input.demo === 1 || input.demo === "1" || input.demo === "yes")
      cfg.demo = true;
    else
      delete cfg.demo;
  }
  if (input.rounds !== undefined) {
    if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > MAX_ROUNDS)
      return { ok: false, error: `An engagement has 1 to ${MAX_ROUNDS} rounds.` };
    cfg.rounds = input.rounds;
  }
  if (input.ties !== undefined) {
    if (input.ties !== "share" && input.ties !== "next")
      return { ok: false, error: "Choose how people who finish on the same number are handled: share the winner position, or take the next positions one after the other." };
    cfg.ties = input.ties;
  } else if (opts.stored)
    cfg.ties = "share";
  if (input.tickets !== undefined) {
    if (input.tickets !== 1 && input.tickets !== 2)
      return { ok: false, error: "Each participant gets 1 or 2 tickets." };
    cfg.tickets = input.tickets;
  }
  if (input.rewards !== undefined) {
    if (!Array.isArray(input.rewards) || input.rewards.length < 1 || input.rewards.length > MAX_REWARD_LINES)
      return { ok: false, error: `Add between 1 and ${MAX_REWARD_LINES} rewards.` };
    const out = [];
    const seen = new Set;
    for (const r of input.rewards) {
      const pattern = r?.pattern;
      const scope = r?.scope === "two_ticket" ? "two_ticket" : r?.scope === "ticket_1" ? "ticket_1" : r?.scope === "ticket_2" ? "ticket_2" : "ticket";
      const ordinal = r?.ordinal === undefined ? 1 : r.ordinal;
      if (!HOUSE_ORDER.includes(pattern) || pattern === "full2")
        return { ok: false, error: "Unknown house in the rewards." };
      if (scope === "two_ticket" && pattern !== "full")
        return { ok: false, error: "Only the Full House can be won across two tickets." };
      if ((scope === "ticket_1" || scope === "ticket_2") && (pattern === "unlucky" || (input.tickets ?? cfg.tickets) !== 2))
        return { ok: false, error: "A prize for one ticket needs two tickets per participant." };
      if (!Number.isInteger(ordinal) || ordinal < 1)
        return { ok: false, error: "A winner number must be 1 or more." };
      const most = Math.max(maxWinnersFor(scope === "two_ticket" ? "full2" : pattern), opts.stored ? LEGACY_MAX_ORDINAL : 0);
      const kept = base.rewards.some((x) => x.pattern === pattern && x.scope === scope && x.ordinal === ordinal);
      if (ordinal > most && !kept)
        return { ok: false, error: `${houseLabel(scope === "two_ticket" ? "full2" : pattern)} can have ${most === 1 ? "only 1 winner" : `at most ${most} winners`}. Please remove the extra ones.` };
      const id = `${scope}:${pattern}#${ordinal}`;
      if (seen.has(id))
        return { ok: false, error: "The same reward is listed twice." };
      seen.add(id);
      const textB = scope === "ticket" ? cleanText(r?.textB, 80) : "";
      out.push({ pattern, scope, ordinal, text: cleanText(r?.text, 80), ...textB ? { textB } : {} });
    }
    for (const l of out)
      if (l.ordinal > 1 && !out.some((x) => x.pattern === l.pattern && x.scope === l.scope && x.ordinal === l.ordinal - 1))
        return { ok: false, error: "A 2nd, 3rd... reward needs the one before it. Note that sending rewards REPLACES the whole list, so send every reward line each time, with ordinals starting at 1 for each house." };
    if (out.some((l) => l.scope === "two_ticket") && (input.tickets ?? cfg.tickets) !== 2)
      return { ok: false, error: "A Super Bumper House needs two tickets per participant." };
    cfg.rewards = out;
  }
  if (cfg.tickets === 1 && cfg.rewards.some((l) => l.scope === "two_ticket" || l.scope === "ticket_1" || l.scope === "ticket_2"))
    cfg.rewards = cfg.rewards.filter((l) => l.scope === "ticket");
  if (cfg.tickets === 1 && cfg.rewards.some((l) => l.textB))
    cfg.rewards = cfg.rewards.map((l) => {
      const { textB: _drop, ...rest } = l;
      return rest;
    });
  if (cfg.rewards.length === 0)
    cfg.rewards = defaultRewards();
  if (input.breaks !== undefined) {
    if (!Array.isArray(input.breaks) || input.breaks.length > maxMidFor(cfg.tickets))
      return { ok: false, error: `At most ${maxMidFor(cfg.tickets)} brand moments during the game with ${cfg.tickets} ticket${cfg.tickets === 1 ? "" : "s"} per person (lucky draws count too).` };
    const out = [];
    for (const b of input.breaks) {
      const auto = b?.auto === true || b?.after === undefined || b?.after === null || b?.after === "";
      const after = auto ? 0 : b?.after, seconds = auto && (b?.seconds === undefined || b?.seconds === null || b?.seconds === "") ? 60 : b?.seconds, kind = b?.kind;
      if (!auto && (!Number.isInteger(after) || after < 1 || after > 89))
        return { ok: false, error: "A break starts after 1 to 89 numbers have been called." };
      if (!Number.isInteger(seconds) || seconds < 15 || seconds > 600 || seconds % 3)
        return { ok: false, error: "A moment during the game lasts 15 to 600 seconds, in steps of 3 (for example 30, 45, 60 or 90)." };
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
      return { ok: false, error: `At most ${max} brand moment${max === 1 ? "" : "s"} ${label} with ${cfg.tickets} ticket${cfg.tickets === 1 ? "" : "s"} per person.` };
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
      return { ok: false, error: `With ${t} ticket${t === 1 ? "" : "s"} per person you can use ${brandMomentsFor(t)} brand moments: ${maxEdgeFor(t)} before the game, ${maxMidFor(t)} during it and ${maxEdgeFor(t)} at the end. Please switch some off.` };
  }
  if (input.verify !== undefined) {
    if (!VERIFY_MODES.includes(input.verify))
      return { ok: false, error: "What a person must give: choose mobile number, employee ID, mobile number or employee ID, or both." };
    if (input.verify === "mobile")
      delete cfg.verify;
    else
      cfg.verify = input.verify;
  }
  if (input.employeesOnly !== undefined) {
    if (typeof input.employeesOnly !== "boolean")
      return { ok: false, error: "Employees only: say yes or no." };
    if (input.employeesOnly)
      cfg.employeesOnly = true;
    else
      delete cfg.employeesOnly;
  }
  if (input.prizePlan !== undefined) {
    const pp = cleanPlan(input.prizePlan);
    if (pp === "bad")
      return { ok: false, error: "The prize plan needs a budget, a prize count and, for each prize, a whole amount above 0 (at most 30 prizes)." };
    if (pp === null)
      delete cfg.prizePlan;
    else
      cfg.prizePlan = pp;
  }
  if (input.idKind !== undefined) {
    if (input.idKind !== "email" && input.idKind !== "emp")
      return { ok: false, error: "What the ID is: an employee ID or an Email ID." };
    if (input.idKind === "email")
      cfg.idKind = "email";
    else
      delete cfg.idKind;
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
// src-tambola-fe030e8/packages/shared/src/ticket.ts
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
var columnRange = (c) => [c === 0 ? 1 : c * 10, c === 8 ? 90 : c * 10 + 9];
function generateTicket(rand = cryptoRand) {
  for (;; ) {
    const mask = [0, 1, 2].map(() => {
      const row = Array(9).fill(false);
      shuffle([...Array(9).keys()], rand).slice(0, 5).forEach((c) => row[c] = true);
      return row;
    });
    if (![...Array(9).keys()].every((c) => mask.some((r) => r[c])))
      continue;
    const t = [[], [], []];
    for (let c = 0;c < 9; c++) {
      const [lo, hi] = columnRange(c);
      const pool = [];
      for (let v = lo;v <= hi; v++)
        pool.push(v);
      const k = [0, 1, 2].filter((r) => mask[r][c]).length;
      const picked = shuffle(pool, rand).slice(0, k).sort((a, b) => a - b);
      let i = 0;
      for (let r = 0;r < 3; r++)
        t[r][c] = mask[r][c] ? picked[i++] : null;
    }
    return t;
  }
}
var ticketNumbers = (t) => t.flat().filter((v) => v !== null);
function isValidTicket(t) {
  if (t.length !== 3 || t.some((r) => r.length !== 9))
    return false;
  for (const r of t)
    if (r.filter((v) => v !== null).length !== 5)
      return false;
  const seen = new Set;
  for (let c = 0;c < 9; c++) {
    const [lo, hi] = columnRange(c);
    const col = [0, 1, 2].map((r) => t[r][c]).filter((v) => v !== null);
    if (col.length < 1)
      return false;
    for (let i = 0;i < col.length; i++) {
      const v = col[i];
      if (v < lo || v > hi || seen.has(v))
        return false;
      if (i > 0 && v <= col[i - 1])
        return false;
      seen.add(v);
    }
  }
  return seen.size === 15;
}

// src-tambola-fe030e8/packages/beacon/src/house-rules.ts
var row = (t, r) => t[r].filter((v) => v !== null);
function ruleOf(t, keyIn) {
  const key = keyIn.includes("@") ? keyIn.slice(0, keyIn.indexOf("@")) : keyIn;
  const a = row(t, 0), b = row(t, 1), c = row(t, 2), all = ticketNumbers(t);
  const set = (n) => ({ pool: n, k: n.length });
  const any = (pool, k) => ({ pool, k });
  switch (key) {
    case "early5":
      return any(all, 5);
    case "early7":
      return any(all, 7);
    case "early10":
      return any(all, 10);
    case "top":
      return set(a);
    case "mid":
      return set(b);
    case "bot":
      return set(c);
    case "twolines":
      return { lines: [a, b, c] };
    case "corners":
      return set([a[0], a[4], c[0], c[4]]);
    case "star":
      return set([a[0], a[4], c[0], c[4], b[2]]);
    case "plus":
      return set([...b, a[2], c[2]]);
    case "frame":
      return set([...a, ...c, b[0], b[4]]);
    case "topbottom":
      return set([...a, ...c]);
    case "midcorners":
      return set([...b, a[0], a[4], c[0], c[4]]);
    case "odd5":
      return any(all.filter((n) => n % 2 === 1), 5);
    case "even5":
      return any(all.filter((n) => n % 2 === 0), 5);
    case "low5":
      return any(all.filter((n) => n <= 30), 5);
    case "high5":
      return any(all.filter((n) => n >= 61), 5);
    case "full":
      return set(all);
    default:
      return null;
  }
}
function ticketCompletion(t, key, log) {
  const r = ruleOf(t, key);
  if (!r)
    return -1;
  if ("lines" in r) {
    const done = [];
    for (const ln of r.lines) {
      const i = firstFull(ln, ln.length, log);
      if (i >= 0)
        done.push(i);
    }
    return done.length < 2 ? -1 : done.sort((x, y) => x - y)[1];
  }
  return firstFull(r.pool, r.k, log);
}
function firstFull(pool, k, log) {
  if (pool.length < k)
    return -1;
  const left = new Set(pool);
  let hit = 0;
  for (let i = 0;i < log.length; i++)
    if (left.delete(log[i]) && ++hit === k)
      return i;
  return -1;
}

// src-tambola-fe030e8/packages/beacon/src/unique-ticket.ts
var MIX_PRIME = 2305843009213693951n;
var SETS_PER_SHAPE = 2 ** 29;
var ROW5 = [];
for (let m = 0;m < 512; m++) {
  let c = 0;
  for (let b = 0;b < 9; b++)
    c += m >> b & 1;
  if (c === 5)
    ROW5.push(m);
}
var SHAPES = null;
function shapes() {
  if (SHAPES)
    return SHAPES;
  const out = [];
  for (let a = 0;a < ROW5.length; a++)
    for (let b = 0;b < ROW5.length; b++) {
      const ab = ROW5[a] | ROW5[b];
      for (let c = 0;c < ROW5.length; c++)
        if ((ab | ROW5[c]) === 511)
          out.push(a << 14 | b << 7 | c);
    }
  return SHAPES = Uint32Array.from(out);
}
var BINOM = [];
for (let n = 0;n <= 12; n++) {
  BINOM[n] = [];
  for (let k = 0;k <= 3; k++)
    BINOM[n][k] = k === 0 ? 1 : n === 0 ? 0 : BINOM[n - 1][k - 1] + (k <= n - 1 ? BINOM[n - 1][k] : 0);
}
var SIZE = Array.from({ length: 9 }, (_, c) => {
  const [lo, hi] = columnRange(c);
  return hi - lo + 1;
});
function unrankCombination(rank, n, k) {
  const out = [];
  let x = 0;
  for (let i = 0;i < k; i++) {
    for (let e = x;; e++) {
      const cnt = BINOM[n - e - 1][k - i - 1];
      if (rank < cnt) {
        out.push(e);
        x = e + 1;
        break;
      }
      rank -= cnt;
    }
  }
  return out;
}
function setsOfShape(packed) {
  const rows = [ROW5[packed >> 14 & 127], ROW5[packed >> 7 & 127], ROW5[packed & 127]];
  let prod = 1;
  for (let c = 0;c < 9; c++) {
    let k = 0;
    for (const r of rows)
      k += r >> c & 1;
    prod *= BINOM[SIZE[c]][k];
  }
  return prod;
}
var keyCache = new Map;
var keyOf = (eid) => {
  let k = keyCache.get(eid);
  if (!k) {
    if (keyCache.size > 64)
      keyCache.clear();
    k = sha2562(utf8ToBytes("ticket-space|" + eid));
    keyCache.set(eid, k);
  }
  return k;
};
function feistel(x, half, key) {
  const M2 = 2 ** half, mask = M2 - 1;
  let left = Math.floor(x / M2), right = x % M2;
  const buf = new Uint8Array(key.length + 5);
  buf.set(key);
  for (let r = 0;r < 6; r++) {
    buf[key.length] = r;
    buf[key.length + 1] = right >>> 24 & 255;
    buf[key.length + 2] = right >>> 16 & 255;
    buf[key.length + 3] = right >>> 8 & 255;
    buf[key.length + 4] = right & 255;
    const h = sha2562(buf), f = (h[0] << 24 | h[1] << 16 | h[2] << 8 | h[3]) >>> 0 & mask;
    const next = (left ^ f) >>> 0;
    left = right;
    right = next;
  }
  return left * M2 + right;
}
function permute(i, n, key) {
  if (!Number.isInteger(i) || i < 0 || i >= n)
    throw new Error("position outside the list");
  let bits = 2;
  while (2 ** bits < n)
    bits++;
  if (bits & 1)
    bits++;
  const half = bits / 2;
  let x = i;
  do
    x = feistel(x, half, key);
  while (x >= n);
  return x;
}
function ticketAt(engagementId, position) {
  const sh = shapes(), V = sh.length;
  const p = permute(position, V * SETS_PER_SHAPE, keyOf(engagementId));
  const shape = sh[p % V];
  const rows = [ROW5[shape >> 14 & 127], ROW5[shape >> 7 & 127], ROW5[shape & 127]];
  let rest = Number(BigInt((p - p % V) / V) * MIX_PRIME % BigInt(setsOfShape(shape)));
  const t = [[], [], []];
  for (let c = 0;c < 9; c++) {
    const present = [0, 1, 2].filter((r) => rows[r] >> c & 1);
    const k = present.length, total = BINOM[SIZE[c]][k];
    const rc = rest % total;
    rest = (rest - rc) / total;
    const [lo] = columnRange(c);
    const picks = unrankCombination(rc, SIZE[c], k);
    for (let r = 0;r < 3; r++)
      t[r][c] = null;
    present.forEach((r, i) => t[r][c] = lo + picks[i]);
  }
  return t;
}
var seatOfPid = (pid) => {
  const m = /^(\d{1,7})x[0-9a-f]{8,}$/.exec(pid);
  const s = m ? Number(m[1]) : 0;
  return s >= 1 ? s : null;
};
var positionOf = (seat, which) => 2 * (seat - 1) + which;

// src-tambola-fe030e8/packages/beacon/src/game.ts
var hostGameOf = (cfg, scheduledRound) => ({ callMode: cfg.callMode === "host" ? "host" : "auto", startMode: cfg.startMode === "manual" ? "manual" : "auto", ...scheduledRound !== undefined ? { startNotBefore: scheduledRound } : {}, breaks: cfg.breaks, rounds: cfg.rounds });
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
  throw new Error("Could not make a second ticket.");
}
function completionIndex(t, pat, log) {
  return ticketCompletion(t, pat, log);
}
function completionIndexKey(tickets, key, log) {
  if (key === "full2") {
    if (tickets.length < 2)
      return -1;
    const left = new Set(tickets.flatMap(ticketNumbers));
    for (let i = 0;i < log.length; i++)
      if (left.delete(log[i]) && left.size === 0)
        return i;
    return -1;
  }
  const only = ticketOfKey(key);
  let best = -1;
  for (let n = 0;n < tickets.length; n++) {
    if (only && n !== only - 1)
      continue;
    const i = completionIndex(tickets[n], key, log);
    if (i >= 0 && (best < 0 || i < best))
      best = i;
  }
  return best;
}
function winnersOfHouse(engagementId, key, groups, mode, randomnessAt) {
  if (mode !== "next")
    return groups.map(([idx, pids]) => ({ idx, pids: pids.slice() }));
  const out = [];
  for (const [idx, pids] of groups) {
    if (pids.length === 1) {
      out.push({ idx, pids: [pids[0]] });
      continue;
    }
    const rand = randomnessAt(idx);
    const rank = (pid) => bytesToHex(sha2562(utf8ToBytes(`CT1-TIE|${engagementId}|${rand}|${key}|${pid}`)));
    for (const pid of [...new Set(pids)].map((x) => [rank(x), x]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map((x) => x[1]))
      out.push({ idx, pids: [pid] });
  }
  return out;
}
var BOGEYS_OUT = 2;
var claimInTime = (atMs, nextCallRound) => nextCallRound === undefined || nextCallRound === null || !Number.isFinite(nextCallRound) || atMs < roundTimeMs(nextCallRound);
function claimsByHouse(cl, round) {
  const out = new Map;
  for (const c of cl) {
    if ((c.round ?? 1) !== round)
      continue;
    let m = out.get(c.pattern);
    if (!m) {
      m = new Map;
      out.set(c.pattern, m);
    }
    let e = m.get(c.pid);
    if (!e) {
      e = { claim: null, bogeys: [] };
      m.set(c.pid, e);
    }
    if (c.bogey)
      e.bogeys.push(c.atMs);
    else if (!e.claim || c.atMs < e.claim.atMs)
      e.claim = c;
  }
  return out;
}
function claimCounts(h, k, pid, i, nextCallRound) {
  const e = h.get(k)?.get(pid);
  if (!e || !e.claim || e.claim.idx !== i || !claimInTime(e.claim.atMs, nextCallRound))
    return false;
  return e.bogeys.filter((t) => t < e.claim.atMs).length < BOGEYS_OUT;
}
function settleAll(engagementId, pids, log, cfg = defaultCfg(), round = 1, late, un, cl) {
  const eid = roundEid(engagementId, round);
  const inPlay = keysInPlay(cfg.rewards);
  const wantUnlucky = inPlay.includes("unlucky");
  const keys = inPlay.filter((k) => k !== "unlucky");
  const loop = wantUnlucky && !keys.includes("full") ? [...keys, "full"] : keys;
  const best = new Map(loop.map((k) => [k, new Map]));
  const fullAll = new Map;
  const byHouse = cl ? claimsByHouse(cl.claims, round) : null;
  const marked = new Map, cfOf = new Map, minePid = new Map;
  for (const pid of pids) {
    const tk = ticketsFor(eid, pid, cfg.tickets);
    const cf = late?.countFrom.get(pid) ?? 0;
    const mine = cf > 0 && late ? log.map((n, k) => (late.callRounds[k] ?? Infinity) >= cf ? n : 0) : log;
    if (wantUnlucky) {
      marked.set(pid, tk);
      cfOf.set(pid, cf);
      minePid.set(pid, mine);
    }
    for (const k of loop) {
      const i = completionIndexKey(tk, k, mine);
      if (i < 0)
        continue;
      if (k === "full") {
        const a = fullAll.get(i);
        if (a)
          a.push(pid);
        else
          fullAll.set(i, [pid]);
      }
      if (byHouse && !claimCounts(byHouse, k, pid, i, cl.callRounds?.[i + CLAIM_WINDOW_CALLS]))
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
    const groups = winnersOfHouse(eid, k, [...best.get(k).entries()].sort((a, b) => a[0] - b[0]), cfg.ties ?? "share", (i) => un?.randomness?.[i] ?? "");
    for (const line of linesFor(cfg.rewards, k)) {
      const g = groups[line.ordinal - 1];
      if (g)
        out.push({ pattern: k, ordinal: line.ordinal, idx: g.idx, pids: g.pids, round });
    }
  }
  if (wantUnlucky && log.length) {
    const fk = [...fullAll.keys()];
    const lines = cfg.rewards.filter((l) => l.pattern !== "unlucky");
    const allDone = lines.length > 0 && lines.every((l) => out.some((x) => x.pattern === keyOfLine(l) && x.ordinal === l.ordinal));
    const at = unluckyAt(fk.length ? Math.min(...fk) : -1, allDone ? Math.max(...out.map((x) => x.idx)) : -1, log.length, !!un?.over || log.length >= NUMBERS);
    if (at >= 0) {
      const br = late?.callRounds[at] ?? Infinity, cand = [];
      for (const pid of pids) {
        if (un?.out?.has(pid))
          continue;
        const cf = cfOf.get(pid) ?? 0;
        if (cf > br)
          continue;
        const upto = new Set(minePid.get(pid).slice(0, at + 1));
        cand.push({ pid, marked: Math.min(...marked.get(pid).map((t) => ticketNumbers(t).filter((n) => upto.has(n)).length)) });
      }
      const w = unluckyPick(eid, un?.randomness?.[at] ?? "", cand);
      if (w !== null)
        out.push({ pattern: "unlucky", ordinal: 1, idx: at, pids: [w], round });
    }
  }
  return out;
}
function unluckyAt(firstFull2, othersDone, calls, over) {
  const c = [firstFull2, othersDone].filter((x) => x >= 0);
  if (over && calls > 0)
    c.push(calls - 1);
  return c.length ? Math.min(...c) : -1;
}
function unluckyPick(engagementId, randomnessHex, cands) {
  const rank = (pid) => bytesToHex(sha2562(utf8ToBytes(`CT1-UNLUCKY|${engagementId}|${randomnessHex}|${pid}`)));
  const sorted = [...new Map(cands.map((c) => [c.pid, c])).values()].map((c) => [c.marked, rank(c.pid), c.pid]).sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return sorted.length ? sorted[0][2] : null;
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
function luckyWinners(engagementId, breakAfter, randomnessHex, pids, n) {
  const rank = (pid) => bytesToHex(sha2562(utf8ToBytes(`CT1-LUCKY|${engagementId}|${breakAfter}|${randomnessHex}|${pid}`)));
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
  if (st?.host)
    return hostCallRound(st, (round - 1) * NUMBERS + k);
  if (st?.manualStart) {
    if (st.goRound === null)
      return st.stopRound !== null ? null : Infinity;
    start = st.goRound;
  }
  let a = unshiftedRound(start, stride, breaks, round, k);
  if (st) {
    if (st.intervals.length) {
      const base = (g) => unshiftedRound(start, stride, breaks, Math.floor(g / NUMBERS) + 1, g % NUMBERS);
      a = pushedByPauses(a, st.intervals, pauseShifts(st.intervals, stride, base, `R${start}|${JSON.stringify(breaks)}`, st.fullGap === true));
    }
    if (st.stopRound !== null && a >= st.stopRound)
      return null;
  }
  return a;
}
function callRoundFull(st, start, stride, breaks, k) {
  return callRoundR(st, start, stride, breaks, 1, k);
}
function activeIntermission(st, start, stride, breaks, round, nowRound) {
  if (round < 2)
    return null;
  const prevLast = callRoundR(st, start, stride, breaks, round - 1, NUMBERS - 1);
  let first = callRoundR(st, start, stride, breaks, round, 0);
  if (prevLast === null || first === null || prevLast === Infinity)
    return null;
  if (first === Infinity)
    first = prevLast + 1 + INTERMISSION_ROUNDS;
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
// src-tambola-fe030e8/packages/beacon/src/prize-engine.ts
var countFromOf = (jr) => jr && jr > 0 ? jr + LATE_LAG_ROUNDS : 0;

class PrizeEngine {
  cfg;
  round;
  keys;
  eid;
  wantUnlucky;
  twoBit;
  nb;
  auxBase;
  bit = new Map;
  unitPid = [];
  unitCf = [];
  unitMask = [];
  unitIsTicket = [];
  unitNums = [];
  unitLeft0 = [];
  unitLeft = [];
  inv = Array.from({ length: 91 }, () => []);
  callNum = [];
  callBr = [];
  donePid;
  byKey;
  known = new Set;
  queue = [];
  callRand = [];
  pos = new Int16Array(91).fill(-1);
  out = new Set;
  outVer = 0;
  over = false;
  uCache = null;
  claims = null;
  roundOfCall = null;
  setCallRound(f) {
    this.roundOfCall = f;
  }
  constructor(engagementId, cfg, round = 1) {
    this.cfg = cfg;
    this.round = round;
    this.eid = roundEid(engagementId, round);
    const all = keysInPlay(cfg.rewards);
    this.wantUnlucky = all.includes("unlucky");
    const ks = all.filter((k) => k !== "unlucky");
    if (this.wantUnlucky && !ks.includes("full"))
      ks.push("full");
    this.keys = ks;
    this.keys.forEach((k, i) => this.bit.set(k, i));
    this.auxBase = this.keys.length;
    this.nb = this.keys.length + (this.bit.has("twolines") ? 4 : 0);
    this.twoBit = this.bit.get("twolines") ?? -1;
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
        if (s.ex || s.blk)
          this.setOut(s.pid, true);
      }
  }
  setOut(pid, out) {
    if (out === this.out.has(pid))
      return;
    if (out)
      this.out.add(pid);
    else
      this.out.delete(pid);
    this.outVer++;
  }
  setOver(over) {
    this.over = over;
  }
  setClaims(claims) {
    this.claims = claimsByHouse(claims, this.round);
  }
  claimedGroups(k, b) {
    const all = [...this.byKey[b].entries()].sort((a, c) => a[0] - c[0]);
    if (!this.claims)
      return all;
    const h = this.claims;
    const out = [];
    for (const [j, pids] of all) {
      const nextBr = this.callBr[j + CLAIM_WINDOW_CALLS] ?? this.roundOfCall?.(j + CLAIM_WINDOW_CALLS) ?? undefined;
      const kept = pids.filter((pid) => claimCounts(h, k, pid, j, nextBr));
      if (kept.length)
        out.push([j, kept]);
    }
    return out;
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
    const tickets = ticketsFor(this.eid, s.pid, this.cfg.tickets);
    const first = this.unitPid.length;
    for (let ti = 0;ti < tickets.length; ti++) {
      const t = tickets[ti];
      const mask = new Uint32Array(91), left = new Uint8Array(this.nb + 1);
      for (const k of this.keys) {
        if (k === "full2")
          continue;
        const b = this.bit.get(k), r = ruleOf(t, k);
        if (!r)
          continue;
        const only = ticketOfKey(k);
        if (only && only !== ti + 1) {
          left[b] = 250;
          continue;
        }
        if ("lines" in r) {
          r.lines.forEach((ln, i) => {
            for (const n of ln)
              mask[n] |= 1 << this.auxBase + i;
            left[this.auxBase + i] = ln.length;
          });
          left[this.auxBase + 3] = 2;
          left[b] = 250;
        } else {
          for (const n of r.pool)
            mask[n] |= 1 << b;
          left[b] = r.pool.length < r.k ? 250 : r.k;
        }
      }
      this.push(s, mask, left, true, Uint8Array.from(ticketNumbers(t)));
    }
    if (tickets.length === 2 && this.bit.has("full2")) {
      const b = this.bit.get("full2"), all = new Set(tickets.flatMap(ticketNumbers)), mask = new Uint32Array(91), left = new Uint8Array(this.nb + 1);
      for (const n of all)
        mask[n] |= 1 << b;
      left[b] = all.size;
      this.push(s, mask, left, false, new Uint8Array(0));
    }
    for (let j = 0;j < this.callNum.length; j++)
      for (let u = first;u < this.unitPid.length; u++)
        this.apply(u, j, this.callNum[j], this.callBr[j]);
  }
  push(s, mask, left, isTicket, nums) {
    const u = this.unitPid.length;
    this.unitPid.push(s.pid);
    this.unitCf.push(s.countFrom);
    this.unitIsTicket.push(isTicket);
    this.unitNums.push(nums);
    this.unitMask.push(mask);
    this.unitLeft0.push(left);
    this.unitLeft.push(left.slice());
    for (let n = 1;n <= 90; n++)
      if (mask[n])
        this.inv[n].push(u);
  }
  apply(u, j, n, br) {
    if (br < this.unitCf[u])
      return;
    const m = this.unitMask[u][n];
    if (!m)
      return;
    const left = this.unitLeft[u];
    for (let b = 0;b < this.nb; b++) {
      if (!(m >> b & 1))
        continue;
      if (--left[b] !== 0)
        continue;
      let h = b;
      if (b >= this.auxBase) {
        if (--left[this.auxBase + 3] !== 0)
          continue;
        h = this.twoBit;
      }
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
  feed(number, beaconRound, randomness = "") {
    const j = this.callNum.length;
    this.callNum.push(number);
    this.callBr.push(beaconRound);
    this.callRand.push(randomness);
    if (number >= 1 && number <= 90)
      this.pos[number] = j;
    for (const u of this.inv[number])
      this.apply(u, j, number, beaconRound);
  }
  resetCalls() {
    this.callNum = [];
    this.callBr = [];
    this.callRand = [];
    this.pos.fill(-1);
    this.uCache = null;
    this.unitLeft = this.unitLeft0.map((l) => l.slice());
    this.donePid = this.keys.map(() => new Set);
    this.byKey = this.keys.map(() => new Map);
  }
  results() {
    const out = [];
    this.keys.forEach((k, b) => {
      const groups = winnersOfHouse(this.eid, k, this.claimedGroups(k, b), this.cfg.ties ?? "share", (i) => this.callRand[i] ?? "");
      for (const line of linesFor(this.cfg.rewards, k)) {
        const g = groups[line.ordinal - 1];
        if (g)
          out.push({ pattern: k, ordinal: line.ordinal, idx: g.idx, pids: g.pids, round: this.round });
      }
    });
    const u = this.unluckyResult(out);
    if (u)
      out.push(u);
    return out;
  }
  unluckyResult(done) {
    if (!this.wantUnlucky || !this.callNum.length)
      return null;
    const fk = [...this.byKey[this.bit.get("full")].keys()];
    const firstFull2 = fk.length ? Math.min(...fk) : -1;
    const lines = this.cfg.rewards.filter((l) => l.pattern !== "unlucky");
    const allDone = lines.length > 0 && lines.every((l) => done.some((x) => x.pattern === (l.scope === "two_ticket" ? "full2" : l.pattern) && x.ordinal === l.ordinal));
    const othersDone = allDone ? Math.max(...done.map((x) => x.idx)) : -1;
    const at = unluckyAt(firstFull2, othersDone, this.callNum.length, this.over || this.callNum.length >= NUMBERS);
    if (at < 0)
      return null;
    const key = `${at}|${this.unitPid.length}|${this.outVer}`;
    if (this.uCache?.key === key)
      return this.uCache.r;
    const br = this.callBr[at], best = new Map;
    for (let u = 0;u < this.unitPid.length; u++) {
      if (!this.unitIsTicket[u])
        continue;
      const pid2 = this.unitPid[u], cf = this.unitCf[u];
      if (this.out.has(pid2) || cf > br)
        continue;
      let c = 0;
      for (const n of this.unitNums[u]) {
        const p = this.pos[n];
        if (p >= 0 && p <= at && this.callBr[p] >= cf)
          c++;
      }
      const had = best.get(pid2);
      if (had === undefined || c < had)
        best.set(pid2, c);
    }
    const pid = unluckyPick(this.eid, this.callRand[at] ?? "", [...best].map(([p, marked]) => ({ pid: p, marked })));
    const r = pid === null ? null : { pattern: "unlucky", ordinal: 1, idx: at, pids: [pid], round: this.round };
    this.uCache = { key, r };
    return r;
  }
}
// src-tambola-fe030e8/packages/beacon/src/prize-status.ts
var ordName = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13)
    return n + "th";
  return n + (n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th");
};
function prizeStatus(cfg, results, round = 1) {
  const out = [];
  for (const key of keysInPlay(cfg.rewards)) {
    if (key === "unlucky")
      continue;
    const lines = linesFor(cfg.rewards, key);
    for (const l of lines) {
      const claimed = results.some((x) => x.pattern === keyOfLine(l) && x.ordinal === l.ordinal && (x.round ?? 1) === round);
      const label = houseLabel(keyOfLine(l));
      out.push({ key, label, ordinal: l.ordinal, of: lines.length, name: lines.length > 1 ? `${ordName(l.ordinal)} ${label}` : label, text: l.text, claimed });
    }
  }
  return [...out.filter((p) => !p.claimed), ...out.filter((p) => p.claimed)];
}
// src-tambola-fe030e8/apps/edge/src/empid.ts
var EMP_CLEAN_FROM_MS = 1793554453235;
var EMP_MAX = 30;
var cleanEmpId = (raw) => String(raw ?? "").normalize("NFKC").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
var hasForeignChars = (raw) => /[\p{L}\p{N}]/u.test(String(raw ?? "").normalize("NFKC").replace(/[A-Za-z0-9]/g, ""));
var empCleanOn = (e) => Number(e?.created_ms) >= EMP_CLEAN_FROM_MS;
var normEmail = (raw) => String(raw ?? "").normalize("NFKC").replace(/[\s\u200b-\u200d\u2060\ufeff\u0085\u2028\u2029]/g, "").toLowerCase();
var looksLikeEmail = (raw) => String(raw ?? "").normalize("NFKC").includes("@");
function normEmpFor(raw, e) {
  if (!empCleanOn(e)) {
    const s = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
    if (!s)
      return "";
    return /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(s) ? s : null;
  }
  if (String(raw ?? "").trim() === "")
    return "";
  if (looksLikeEmail(raw))
    return null;
  if (hasForeignChars(raw))
    return null;
  const c = cleanEmpId(raw);
  return c && c.length <= EMP_MAX ? c : null;
}

// src-tambola-fe030e8/apps/edge/src/approvals.ts
var WAIT_LIMIT_MS = 30 * 60000;
var FAMILY_CUTOFF_MS = 15 * 60000;
var GENESIS = 1692803367;
var roundStartMs = (round) => (GENESIS + (round - 1) * 3) * 1000;
var waitingLapsed = (atMs, now) => now - atMs >= WAIT_LIMIT_MS;
var waitingValidUntil = (atMs) => atMs + WAIT_LIMIT_MS;
var familyCutoffPassed = (startMs, now) => now >= startMs - FAMILY_CUTOFF_MS;
var mayDecide = (who, chain) => who.all || String(chain).includes(`,${who.id},`);
var EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
var cleanEmail = (raw) => {
  const s = normEmail(raw);
  return s.length <= 120 && EMAIL.test(s) ? s : null;
};
var APPROVAL_RULES_FROM_MS = 1793316967027;
var approvalRulesOn = (e) => Number(e?.created_ms) >= APPROVAL_RULES_FROM_MS;
var waitSince = (e, now) => approvalRulesOn(e) ? now - WAIT_LIMIT_MS : 0;
// src-tambola-fe030e8/apps/edge/src/pii.ts
var enc = new TextEncoder;
var dec = new TextDecoder;
var AAD = enc.encode("corporate-tambola/pii/v1");
var keys = new Map;

// src-tambola-fe030e8/apps/edge/src/brand.ts
var BRAND = {
  name: "Corporate Tambola",
  tagline: "Live engagements for companies",
  tag: "Tambola",
  support: "hello@corporatetambola.com",
  legalPath: "/legal.html",
  defaultOrigin: "https://housie.corporatetambola.com",
  wine: "#0B3D91",
  gold: "#E0B872",
  gold2: "#F3D9A4",
  ivory: "#F4F7FC",
  line: "#D9E1F0"
};
var mailTag = `[${BRAND.tag}] `;
// src-tambola-fe030e8/apps/edge/src/consent.ts
var encoder = new TextEncoder;

// src-tambola-fe030e8/apps/edge/src/phonekit.ts
var KNOWN_DIAL = new Set("1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 509 590 591 592 593 594 595 596 597 598 599 670 673 674 675 676 677 678 679 680 682 685 686 687 688 689 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998".split(" "));

// src-tambola-fe030e8/apps/edge/src/checkin.ts
var CHECKIN_FROM_MS = Date.UTC(2026, 9, 23, 10, 0, 0);
var CHECKIN_OPENS_BEFORE_MS = 5 * 60000;
var CHECKIN_LOCK_MS = 10 * 60000;
var checkinOpensMs = (startMs) => startMs - CHECKIN_OPENS_BEFORE_MS;
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
// src-tambola-fe030e8/apps/edge/src/people.ts
var COHOST_FROM = 1e9;
var HOST_FROM = 1500000000;
var ORG_FROM = 1900000000;
var COHOST_LIMIT_DEFAULT = 100;
var COHOST_LIMIT_MIN = 10;
var COHOST_LIMIT_MAX = 1000;
var MAX_ADD_BATCH = 200;
var WAITING_MAX = 500;
var encoder2 = new TextEncoder;
var normEmp = (raw) => {
  const s = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
  if (!s)
    return "";
  return /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(s) ? s : null;
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
// src-tambola-fe030e8/apps/edge/src/modes.ts
var needsControl = (c) => c.callMode === "host" || c.startMode === "manual";
var MANUAL_LIMIT_MSG = `Games above ${MANUAL_MAX_PARTICIPANTS.toLocaleString("en-IN")} people are called by the game itself: choose "The game does". You can still press Start yourself.`;
var modeTooBig = (c, cap) => c.callMode === "host" && cap > MANUAL_MAX_PARTICIPANTS ? MANUAL_LIMIT_MSG : null;
// games/tambola/common.ts
var RULES = {
  "T-01": "Every ticket is valid: 3 rows of 5 numbers, 15 different numbers, each in its own column's range.",
  "T-02": "A person's two tickets differ, and the tickets of different seats in one game never match.",
  "T-03": "A house is complete at exactly the call where the marked numbers first satisfy that house's rule.",
  "T-04": "A prize is won only by a claim made at the exact completion call; a claim for another call or house, or no claim, wins nothing.",
  "T-05": "A claim must arrive strictly before the next number is called: one millisecond earlier is in time, exactly at that moment is late.",
  "T-06": "Two wrong claims (bogeys) on a house before a claim put that ticket out of that house; one bogey does not.",
  "T-07": "Repeated claims count once and the earliest claim is the one used.",
  "T-08": "The earliest valid completion takes position 1, later calls take later positions, and nobody takes the same house twice.",
  "T-09": "With 'share', everyone who finishes on the same call shares one position.",
  "T-10": "With 'next', people who finish on the same call take the next positions one after the other, in a public hash order.",
  "T-11": "Someone who joined late counts only the numbers called from 30 rounds after joining.",
  "T-12": "Unlucky goes to the ticket with the fewest numbers marked at the first Full House (or the end); a tie goes to the public hash; removed or flagged seats never win it.",
  "T-13": "A lucky draw picks the lowest public hashes, nobody twice, as many as asked (everyone if there are fewer people).",
  "T-14": "The winners do not depend on the order of the people or of the claims.",
  "T-15": "The phone's step-by-step prize engine gives the same winners as the whole-log settlement.",
  "T-16": "Claims of another round never change this round's winners.",
  "T-17": "The prize list shows exactly the prizes that were awarded as claimed.",
  "T-18": "Numbers made from the public randomness are all different, inside 1..90, and number k depends only on the rounds up to k.",
  "T-19": "A claim checks as good only when its call index is the real completion call.",
  "S-01": "The call schedule equals an independent call-by-call re-simulation (breaks, rounds with intermission, pauses, stop, Start, Host presses).",
  "S-02": "No number is called inside a pause, numbers never go backwards, and two numbers are never closer than the chosen speed.",
  "S-03": "The first number after a Resume comes a full gap after the Resume.",
  "S-04": "Every control message is accepted, or ignored with the documented plain reason.",
  "S-05": "A timed pause ends by itself, an open pause ends at the maximum pause, and a resume after that is refused.",
  "S-06": "A Host press needs exactly 2 rounds of lead, must be in order, waits for breaks, and stops at the last number.",
  "S-07": "In a manual-start game nothing is called before Start; Start works once, not before its time, and with enough lead.",
  "S-08": "In a big game (above 2,000 people) only Start exists: pause, resume, extend and end are refused with the plain message.",
  "S-09": "Claim holds stop the numbers like a pause in an auto game and are ignored in a Host game.",
  "S-10": "Lead, safety and size limits follow their tables: more people never means less lead, at most 5 Host keys, Host calling only up to 1,000 people.",
  "S-11": "Signed control: forged, changed, other-game, repeated and out-of-order messages are never believed; a short list only makes phones know less; only the Organizer's and Hosts' keys may sign.",
  "C-01": "Settings the console can produce are accepted and cleaned.",
  "C-02": "Invalid settings are refused with a plain sentence.",
  "C-03": "Breaks are sorted and unique, and houses and winners stay within their limits.",
  "F-01": "The participant limit includes family and guests; nobody is added over it.",
  "F-02": "A person's own list never holds more than their limit (guest 1 to 4, Co-host 10 to 1000); the Organizer and Hosts have none.",
  "F-03": "A waiting request lapses at exactly 30 minutes (games made under the new rules); older games never lapse.",
  "F-04": "A family host cannot approve from 15 minutes before the start; the Organizer and Hosts still can.",
  "F-05": "Only the Organizer, Hosts and the people on a request's own chain can decide it.",
  "F-06": "Removing someone before the start frees the place; during the game their seat stays but is blocked and cannot win Unlucky.",
  "F-07": "A guest invited by a guest can play but cannot invite more people.",
  "F-08": "A link code always leads back to the same inviter.",
  "F-09": "Check-in codes are never the same for two seats, and ID/e-mail cleaning gives the same answer every time.",
  "X-01": "The real engine never throws on input the product can produce."
};
var MAXFAILS = 6;

class Acc {
  checks = 0;
  fails = [];
  dims = {};
  ok(cond, rule, detail) {
    this.checks++;
    if (!cond && this.fails.length < MAXFAILS) {
      let d;
      try {
        d = detail ? detail() : undefined;
      } catch (e) {
        d = "detail failed: " + String(e);
      }
      this.fails.push({ rule, sentence: RULES[rule] ?? rule, detail: d });
    }
  }
  eq(a, b, rule, what) {
    this.checks++;
    if (a === b)
      return;
    if (this.fails.length < MAXFAILS)
      this.fails.push({ rule, sentence: RULES[rule] ?? rule, detail: `${what}: engine=${String(a)} oracle=${String(b)}` });
  }
  fail(rule, detail) {
    this.checks++;
    if (this.fails.length < MAXFAILS)
      this.fails.push({ rule, sentence: RULES[rule] ?? rule, detail });
  }
  d(name, v) {
    this.dims[name] = v;
  }
}
var isLive = (t) => t.toString().replace(/\s/g, "") !== "()=>{}";
var rnd = (seedHex, r) => {
  let s = "";
  for (let i = 0;i < 4; i++)
    s += hashStr(seedHex + "|" + r, i + 1).toString(16).padStart(8, "0");
  return s + s;
};
var TC = new Map;
function tix(eid, pid, n) {
  const k = eid + "\x01" + pid + "\x01" + n;
  let v = TC.get(k);
  if (!v) {
    if (TC.size > 30000)
      TC.clear();
    v = ticketsFor(eid, pid, n);
    TC.set(k, v);
  }
  return v;
}
var hex8 = (a) => hashStr(a).toString(16).padStart(8, "0");

// games/tambola/oracle.ts
import { createHash } from "crypto";
var GEN = 1692803367;
var rtime = (r) => (GEN + (r - 1) * 3) * 1000;
var sha = (s) => createHash("sha256").update(s).digest("hex");
var ROWS = new WeakMap;
var rowsOf = (t) => {
  let r = ROWS.get(t);
  if (!r) {
    r = t.map((x) => x.filter((v) => v !== null));
    ROWS.set(t, r);
  }
  return r;
};
var numsOf = (t) => rowsOf(t).flat();
var SETS = new WeakMap;
var PRE = new WeakMap;
var preOf = (t) => {
  let p = PRE.get(t);
  if (!p) {
    const R = rowsOf(t);
    p = { R, all: R.flat(), corners: [R[0][0], R[0][4], R[2][0], R[2][4]] };
    PRE.set(t, p);
  }
  return p;
};
function houseDone(t, base, marked) {
  const { R, all, corners } = preOf(t);
  const row2 = (r) => {
    for (const n of R[r])
      if (!marked.has(n))
        return false;
    return true;
  };
  const cnt = (f) => {
    let c = 0;
    for (const n of all)
      if (marked.has(n) && f(n))
        c++;
    return c;
  };
  const cor = () => {
    for (const n of corners)
      if (!marked.has(n))
        return false;
    return true;
  };
  switch (base) {
    case "early5":
      return cnt(() => true) >= 5;
    case "early7":
      return cnt(() => true) >= 7;
    case "early10":
      return cnt(() => true) >= 10;
    case "top":
      return row2(0);
    case "mid":
      return row2(1);
    case "bot":
      return row2(2);
    case "twolines":
      return (row2(0) ? 1 : 0) + (row2(1) ? 1 : 0) + (row2(2) ? 1 : 0) >= 2;
    case "corners":
      return cor();
    case "star":
      return cor() && marked.has(R[1][2]);
    case "plus":
      return row2(1) && marked.has(R[0][2]) && marked.has(R[2][2]);
    case "frame":
      return row2(0) && row2(2) && marked.has(R[1][0]) && marked.has(R[1][4]);
    case "topbottom":
      return row2(0) && row2(2);
    case "midcorners":
      return row2(1) && cor();
    case "odd5":
      return cnt((n) => n % 2 === 1) >= 5;
    case "even5":
      return cnt((n) => n % 2 === 0) >= 5;
    case "low5":
      return cnt((n) => n <= 30) >= 5;
    case "high5":
      return cnt((n) => n >= 61) >= 5;
    case "full":
      return all.length === 15 && all.every((n) => marked.has(n));
  }
  throw new Error("oracle: unknown house " + base);
}
function completionsAll(tickets, keys2, calls, rounds, cf) {
  const res = keys2.map(() => -1);
  let left = keys2.length;
  const bases = keys2.map((k) => {
    const at = k.indexOf("@");
    return { base: at < 0 ? k : k.slice(0, at), only: at < 0 ? 0 : Number(k.slice(at + 1)) };
  });
  const sets = tickets.map((t) => {
    let s = SETS.get(t);
    if (!s) {
      s = new Set(numsOf(t));
      SETS.set(t, s);
    }
    return s;
  });
  const marked = new Set;
  for (let i = 0;i < calls.length && left > 0; i++) {
    if (cf > 0 && (rounds?.[i] ?? Infinity) < cf)
      continue;
    const n = calls[i];
    marked.add(n);
    const h0 = sets[0].has(n), h1 = sets.length > 1 && sets[1].has(n);
    if (!h0 && !h1)
      continue;
    for (let q = 0;q < keys2.length; q++) {
      if (res[q] >= 0)
        continue;
      const { base, only } = bases[q];
      if (keys2[q] === "full2") {
        if (tickets.length === 2) {
          let all = true;
          for (const x of sets[0])
            if (!marked.has(x)) {
              all = false;
              break;
            }
          if (all) {
            for (const x of sets[1])
              if (!marked.has(x)) {
                all = false;
                break;
              }
          }
          if (all) {
            res[q] = i;
            left--;
          }
        }
        continue;
      }
      for (let ti = 0;ti < tickets.length; ti++) {
        if (only && ti !== only - 1)
          continue;
        if ((ti === 0 ? h0 : h1) && houseDone(tickets[ti], base, marked)) {
          res[q] = i;
          left--;
          break;
        }
      }
    }
  }
  return res;
}
var completionAt = (tickets, key, calls, rounds, cf) => completionsAll(tickets, [key], calls, rounds, cf)[0];
function markedAt(t, calls, rounds, cf, at) {
  const mine = new Set(numsOf(t));
  const seen = new Set;
  let c = 0;
  for (let i = 0;i <= at && i < calls.length; i++) {
    if (cf > 0 && (rounds?.[i] ?? Infinity) < cf)
      continue;
    const n = calls[i];
    if (mine.has(n) && !seen.has(n)) {
      seen.add(n);
      c++;
    }
  }
  return c;
}
var BOGEYS = 2;
var inTime = (atMs, nextRound) => nextRound === undefined || nextRound === null || !Number.isFinite(nextRound) || atMs < rtime(nextRound);
function oracleSettle(a) {
  const H = a.calls.length;
  const keys2 = [];
  for (const l of a.lines)
    if (!keys2.includes(l.key))
      keys2.push(l.key);
  const wantUnlucky = keys2.includes("unlucky");
  const houseKeys = keys2.filter((k) => k !== "unlucky");
  const loopKeys = wantUnlucky && !houseKeys.includes("full") ? [...houseKeys, "full"] : houseKeys;
  const byPP = new Map;
  if (a.claims)
    for (const c of a.claims) {
      if (c.round !== a.round)
        continue;
      const k = c.pattern + "\x01" + c.pid;
      let e = byPP.get(k);
      if (!e) {
        e = { claim: null, bogeys: [] };
        byPP.set(k, e);
      }
      if (c.bogey)
        e.bogeys.push(c.atMs);
      else if (!e.claim || c.atMs < e.claim.atMs)
        e.claim = c;
    }
  const groups = new Map;
  for (const k of loopKeys)
    groups.set(k, new Map);
  const fullAny = new Map;
  for (const p of a.people)
    for (const k of loopKeys) {
      const i = a.comp.get(p.pid).get(k);
      if (i < 0 || i >= H)
        continue;
      if (k === "full") {
        const f = fullAny.get(i);
        if (f)
          f.push(p.pid);
        else
          fullAny.set(i, [p.pid]);
      }
      if (a.claims) {
        const e = byPP.get(k + "\x01" + p.pid);
        if (!e || !e.claim || e.claim.idx !== i)
          continue;
        if (!inTime(e.claim.atMs, a.callRounds?.[i + 1]))
          continue;
        let nb = 0;
        for (const t of e.bogeys)
          if (t < e.claim.atMs)
            nb++;
        if (nb >= BOGEYS)
          continue;
      }
      const g = groups.get(k);
      const arr = g.get(i);
      if (arr)
        arr.push(p.pid);
      else
        g.set(i, [p.pid]);
    }
  const out = [];
  for (const k of houseKeys) {
    const g = groups.get(k);
    const idxs = [...g.keys()].sort((x, y) => x - y);
    const positions = [];
    for (const i of idxs) {
      const pids = g.get(i);
      if (a.ties === "share" || pids.length === 1)
        positions.push({ idx: i, pids: pids.slice() });
      else {
        const ranked = pids.map((pid) => [sha(`CT1-TIE|${a.eid}|${a.rand(i)}|${k}|${pid}`), pid]).sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
        for (const r of ranked)
          positions.push({ idx: i, pids: [r[1]] });
      }
    }
    for (const l of a.lines)
      if (l.key === k) {
        const pos = positions[l.ordinal - 1];
        if (pos)
          out.push({ pattern: k, ordinal: l.ordinal, idx: pos.idx, pids: pos.pids });
      }
  }
  if (wantUnlucky && H > 0) {
    const cand = [];
    const fk = [...fullAny.keys()];
    if (fk.length)
      cand.push(Math.min(...fk));
    const others = a.lines.filter((l) => l.key !== "unlucky");
    const allDone = others.length > 0 && others.every((l) => out.some((x) => x.pattern === l.key && x.ordinal === l.ordinal));
    if (allDone)
      cand.push(Math.max(...out.map((x) => x.idx)));
    if ((a.over || H >= 90) && H > 0)
      cand.push(H - 1);
    if (cand.length) {
      const at = Math.min(...cand);
      const br = a.lateOn ? a.callRounds?.[at] ?? Infinity : Infinity;
      const scored = [];
      for (const p of a.people) {
        if (a.out.has(p.pid))
          continue;
        if (a.lateOn && p.cf > br)
          continue;
        const cf = a.lateOn ? p.cf : 0;
        const marked = Math.min(...p.tickets.map((t) => markedAt(t, a.calls, a.callRounds ?? null, cf, at)));
        scored.push({ pid: p.pid, marked, rank: sha(`CT1-UNLUCKY|${a.eid}|${a.rand(at)}|${p.pid}`) });
      }
      scored.sort((x, y) => x.marked - y.marked || (x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : 0));
      if (scored.length)
        out.push({ pattern: "unlucky", ordinal: 1, idx: at, pids: [scored[0].pid] });
    }
  }
  return out;
}
var normSettled = (xs) => xs.map((x) => `${x.pattern}#${x.ordinal}@${x.idx}:${[...x.pids].sort().join(",")}`).sort().join(" | ");
function oracleLucky(eid, breakAfter, rand, pids, n) {
  const uniq = [...new Set(pids)];
  return uniq.map((p) => [sha(`CT1-LUCKY|${eid}|${breakAfter}|${rand}|${p}`), p]).sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0).slice(0, Math.max(0, n)).map((x) => x[1]);
}
function oracleResolve(c, log, holds, W, maxTimed) {
  const pauses = [];
  const endOf = (p) => Math.min(p.resumedAt ?? Infinity, p.until ?? p.start + c.maxPauseRounds);
  let stopAt = null, goAt = null, applied = 0;
  const nexts = [], ignored = [];
  for (const m of [...log].sort((x, y) => x.seq - y.seq)) {
    const last = pauses.length ? pauses[pauses.length - 1] : null;
    const lead = m.atBeaconRound - m.signedAtRound;
    const pausedNow = last !== null && last.start <= m.atBeaconRound && m.atBeaconRound < endOf(last);
    let why = null;
    if (stopAt !== null)
      why = "engagement already stopped";
    else if (m.signedAtRound > m.atBeaconRound)
      why = "takes effect before it was signed";
    else if (c.startOnly && (m.action === "pause" || m.action === "resume" || m.action === "extend" || m.action === "stop"))
      why = W.big;
    else if (m.action === "next") {
      if (c.callMode !== "host")
        why = W.auto;
      else if (lead !== 2 || m.untilRound !== undefined)
        why = W.lead;
      else if (pausedNow)
        why = W.paused;
      else if (c.startMode === "manual" && goAt === null)
        why = W.start;
      else if (c.startMode === "manual" && m.atBeaconRound < goAt)
        why = W.early;
      else if (nexts.length >= c.maxNexts)
        why = W.done;
      else if (nexts.length > 0 && m.atBeaconRound <= nexts[nexts.length - 1])
        why = W.order;
      else {
        const gap = c.hostGaps.find((g) => g.at === nexts.length);
        if (gap && nexts.length > 0 && m.atBeaconRound < nexts[nexts.length - 1] + 1 + gap.rounds)
          why = W.gap;
      }
    } else if (m.action === "go") {
      if (c.startMode !== "manual")
        why = W.goAuto;
      else if (goAt !== null)
        why = W.goAgain;
      else if (c.startNotBefore !== undefined && m.signedAtRound < c.startNotBefore)
        why = W.goEarly;
      else if (lead < c.leadRounds || m.untilRound !== undefined)
        why = W.goLead;
    } else if (m.action === "pause") {
      if (lead < c.leadRounds)
        why = `pause needs at least ${c.leadRounds} rounds of lead`;
      else if (last && m.atBeaconRound < endOf(last))
        why = "already paused";
      else if (m.untilRound !== undefined && (m.untilRound <= m.atBeaconRound || m.untilRound - m.atBeaconRound > maxTimed))
        why = "bad pause end";
    } else if (m.action === "resume") {
      if (!pausedNow || !last)
        why = "not paused";
      else if (lead < 1)
        why = "resume must be after it was signed";
      else if (!(m.atBeaconRound > last.start))
        why = "resume before the pause began";
    } else if (m.action === "extend") {
      if (!last || !pausedNow)
        why = "not paused";
      else if (last.resumedAt !== null)
        why = "pause already ending";
      else if (lead < c.leadRounds)
        why = `extend needs at least ${c.leadRounds} rounds of lead`;
      else if (m.untilRound === undefined || m.untilRound - m.atBeaconRound > maxTimed)
        why = "extend needs a sensible end round";
      else if (!(m.untilRound > endOf(last)))
        why = "extend must move the end later";
    } else if (m.action === "stop") {
      if (lead < c.leadRounds)
        why = `stop needs at least ${c.leadRounds} rounds of lead`;
    }
    if (why) {
      ignored.push({ seq: m.seq, why });
      continue;
    }
    applied++;
    if (m.action === "pause")
      pauses.push({ start: m.atBeaconRound, until: m.untilRound ?? null, resumedAt: null });
    else if (m.action === "resume")
      last.resumedAt = m.atBeaconRound;
    else if (m.action === "extend")
      last.until = m.untilRound;
    else if (m.action === "next")
      nexts.push(m.atBeaconRound);
    else if (m.action === "go")
      goAt = m.atBeaconRound;
    else
      stopAt = m.atBeaconRound;
  }
  const all = [...pauses.map((p) => ({ start: p.start, end: endOf(p) })), ...c.callMode === "host" ? [] : holds.map((h) => ({ start: h.start, end: h.end }))].sort((x, y) => x.start - y.start || x.end - y.end);
  const merged = [];
  for (const iv of all) {
    const l = merged[merged.length - 1];
    if (l && iv.start <= l.end)
      l.end = Math.max(l.end, iv.end);
    else
      merged.push({ start: iv.start, end: iv.end });
  }
  return { intervals: merged, stopRound: stopAt, ignored, nextRounds: nexts, goRound: goAt, applied };
}
function planned(s, g) {
  const rd = Math.floor(g / 90) + 1, k = g % 90;
  if (rd === 1) {
    let r = s.start + k * s.stride;
    for (const b of s.breaks)
      if (b.after <= k)
        r += b.seconds / 3;
    return r;
  }
  return planned(s, (rd - 1) * 90 - 1) + s.stride + s.intermission + k * s.stride;
}
function simulate(s, ivs, fullGap, stopRound, count) {
  const out = [];
  let off = 0, pj = 0;
  for (let g = 0;g < count; g++) {
    let a = planned(s, g) + off;
    while (pj < ivs.length && a >= ivs[pj].start) {
      const st = ivs[pj].start, len = ivs[pj].end - st;
      const extra = fullGap ? len + Math.max(0, s.stride - (a - st)) : len;
      off += extra;
      a += extra;
      pj++;
    }
    out.push(stopRound !== null && a >= stopRound ? null : a);
  }
  return out;
}
function oracleCalls(s, st, ctl, count) {
  if (ctl.callMode === "host")
    return Array.from({ length: count }, (_, g) => {
      const r = st.nextRounds[g];
      return r !== undefined ? st.stopRound !== null && r >= st.stopRound ? null : r : st.stopRound !== null ? null : Infinity;
    });
  let start = s.start;
  if (ctl.startMode === "manual") {
    if (st.goRound === null)
      return Array.from({ length: count }, () => st.stopRound !== null ? null : Infinity);
    start = st.goRound;
  }
  return simulate({ ...s, start }, st.intervals, ctl.fullGap === true, st.stopRound, count);
}

// games/tambola/ctl.ts
var WORDS = {
  auto: NEXT_REFUSALS.auto,
  lead: NEXT_REFUSALS.lead,
  paused: NEXT_REFUSALS.paused,
  order: NEXT_REFUSALS.order,
  gap: NEXT_REFUSALS.gap,
  done: NEXT_REFUSALS.done,
  start: NEXT_REFUSALS.start,
  early: NEXT_REFUSALS.early,
  goAuto: GO_REFUSALS.auto,
  goEarly: GO_REFUSALS.early,
  goLead: GO_REFUSALS.lead,
  goAgain: GO_REFUSALS.again,
  big: BIG_GAME_REFUSAL
};
var gapsOracle = (breaks, rounds) => {
  const g = breaks.map((b) => ({ at: b.after, rounds: b.seconds / 3 }));
  for (let r = 2;r <= rounds; r++)
    g.push({ at: (r - 1) * 90, rounds: 30 });
  return g.sort((a, b) => a.at - b.at);
};
var schedOf = (s) => ({ start: s.start, stride: s.stride, breaks: s.breaks, rounds: s.rounds, intermission: 30 });
var octlOf = (s) => ({ maxPauseRounds: s.maxPause, leadRounds: s.lead, callMode: s.callMode, startMode: s.startMode, ...s.startMode === "manual" ? { startNotBefore: s.start } : {}, startOnly: s.startOnly, fullGap: s.fullGap, hostGaps: s.callMode === "host" ? gapsOracle(s.breaks, s.rounds) : [], maxNexts: s.callMode === "host" ? 90 * s.rounds : 0 });
var ectlOf = (s) => {
  const file = { v: 1, engagementId: "E1", pubKey: "00".repeat(32), maxPauseRounds: s.maxPause, leadRounds: s.lead, messages: [], ...s.fullGap ? { fullGap: true } : {}, ...s.startOnly ? { startOnly: true } : {} };
  return cfgOf(file, hostGameOf({ callMode: s.callMode, startMode: s.startMode, breaks: s.breaks, rounds: s.rounds }, s.start));
};
var SIG = "0".repeat(128);
var asMsgs = (m) => m.map((x) => ({ engagementId: "E1", seq: x.seq, action: x.action, atBeaconRound: x.atBeaconRound, signedAtRound: x.signedAtRound, ...x.untilRound !== undefined ? { untilRound: x.untilRound } : {}, sig: SIG }));
var PAUSE_STYLES = ["none", "before-first", "mid-gap", "claim-window", "at-call", "multiple", "timed", "extended", "long", "after-max", "refused-lead", "stop", "before-win", "after-win", "in-break", "in-intermission", "mixed"];
function genCtl(rng, s, style, anchor) {
  const sc = schedOf(s);
  const P2 = (g) => planned(sc, g);
  const m = [];
  let seq = 1;
  const flaws = [];
  const push = (action, at, lead, until) => {
    m.push({ seq: seq++, action, atBeaconRound: at, signedAtRound: at - lead, ...until !== undefined ? { untilRound: until } : {} });
  };
  const L = s.lead;
  const callAt = (kk) => P2(Math.min(kk, s.rounds * 90 - 1));
  const anchorCall = () => rng.weighted([[0, 3], [1, 3], [rng.int(2, 10), 6], [rng.int(11, 60), 6], [rng.int(61, Math.max(61, s.rounds * 90 - 2)), 3]]);
  const episode = (kind, at) => {
    switch (kind) {
      case "pause-resume": {
        push("pause", at, L + rng.int(0, 6));
        push("resume", at + rng.int(1, 70), rng.int(1, 14));
        return;
      }
      case "timed": {
        push("pause", at, L + rng.int(0, 3), at + rng.int(2, 90));
        return;
      }
      case "extended": {
        const d = rng.int(6, 50);
        push("pause", at, L, at + d);
        push("extend", at + rng.int(0, d - 1), L + rng.int(0, 4), at + d + rng.int(1, 70));
        if (rng.chance(0.5))
          push("resume", at + d + rng.int(1, 10), rng.int(1, 6));
        return;
      }
      case "long": {
        push("pause", at, L);
        return;
      }
      case "after-max": {
        push("pause", at, L);
        push("resume", at + s.maxPause + rng.pick([-2, -1, 0, 1, 2, 9]), rng.int(1, 8));
        return;
      }
      case "refused-lead": {
        if (L > 0)
          push("pause", at, rng.int(0, L - 1));
        else
          push("pause", at, 0);
        flaws.push("lead");
        return;
      }
      case "double": {
        push("pause", at, L);
        push("pause", at + rng.int(0, 10), L + 1);
        flaws.push("double");
        return;
      }
      case "resume-unpaused": {
        push("resume", at, rng.int(1, 6));
        flaws.push("resume-unpaused");
        return;
      }
      case "extend-unpaused": {
        push("extend", at, L, at + 30);
        flaws.push("extend-unpaused");
        return;
      }
      case "stop": {
        push("stop", at, L + rng.int(0, 3));
        return;
      }
      case "stop-short": {
        push("stop", at, L > 0 ? rng.int(0, L - 1) : 0);
        flaws.push("stop-short");
        return;
      }
      case "bad-until": {
        push("pause", at, L, rng.chance(0.5) ? at - rng.int(0, 3) : at + MAX_TIMED_PAUSE_ROUNDS + rng.int(1, 5));
        flaws.push("bad-until");
        return;
      }
      case "backdated": {
        m.push({ seq: seq++, action: rng.pick(["pause", "stop", "resume"]), atBeaconRound: at, signedAtRound: at + rng.int(1, 5) });
        flaws.push("backdated");
        return;
      }
    }
  };
  const normal = ["pause-resume", "pause-resume", "timed", "extended", "long"];
  const place = () => {
    switch (style) {
      case "before-first":
        return s.start - rng.int(1, 40);
      case "mid-gap":
        return P2(anchor) + (s.stride > 1 ? rng.int(1, s.stride - 1) : 0);
      case "claim-window":
        return P2(anchor) + rng.int(0, 1);
      case "at-call":
        return P2(anchor);
      case "before-win":
        return P2(anchor) - rng.int(1, 3);
      case "after-win":
        return P2(anchor) + rng.int(1, 3);
      case "in-break": {
        const b = s.breaks.length ? rng.pick(s.breaks) : null;
        return b ? P2(b.after - 1) + rng.int(1, Math.max(1, b.seconds / 3)) : P2(anchor) + 1;
      }
      case "in-intermission":
        return s.rounds >= 2 ? P2(89) + rng.int(1, s.stride + 30) : P2(anchor) + 1;
      default:
        return callAt(anchorCall()) + rng.int(0, s.stride);
    }
  };
  let epStyle = style;
  if (s.callMode === "host") {
    const gaps2 = gapsOracle(s.breaks, s.rounds);
    let go = 0;
    if (s.startMode === "manual") {
      const pre = rng.chance(0.12);
      if (rng.chance(0.15)) {
        push("go", s.start + rng.int(0, 5), rng.int(0, Math.max(0, L - 1)));
        flaws.push("go-lead");
      }
      if (rng.chance(0.12)) {
        push("go", s.start + rng.int(0, 30), rng.int(1, 40) + L + 100);
        flaws.push("go-early");
      }
      if (pre) {
        push("next", s.start + 5, 2);
        flaws.push("press-before-go");
      }
      const lead = L + rng.int(0, 12);
      go = s.start + lead + rng.int(0, 50);
      push("go", go, lead);
      if (rng.chance(0.12)) {
        push("go", go + 30, L + 2);
        flaws.push("go-again");
      }
      if (rng.chance(0.1)) {
        push("next", go - rng.int(1, 3), 2);
        flaws.push("press-early");
      }
    }
    const K = rng.weighted([[rng.int(1, 12), 28], [rng.int(13, 60), 24], [90, 22], [s.rounds * 90, 14], [s.rounds * 90 + rng.int(1, 4), 4], [0, 8]]);
    let prev = (s.startMode === "manual" ? go : s.start) - 1;
    const pauseAt = style !== "none" && style !== "mixed" ? rng.int(1, Math.max(1, Math.min(K, 80))) : rng.chance(0.2) ? rng.int(1, Math.max(1, Math.min(K, 80))) : -1;
    let k = 0, at = prev;
    for (let n = 0;n < K; n++) {
      if (n === pauseAt && s.startOnly === false) {
        episode(rng.pick(["pause-resume", "timed", "pause-resume"]), prev + rng.int(1, 4));
      }
      let base = prev + 1 + (rng.chance(0.65) ? 0 : rng.int(0, 7));
      const gap = gaps2.find((g) => g.at === k);
      if (gap && k > 0) {
        if (rng.chance(0.2)) {
          push("next", prev + gap.rounds, 2);
          flaws.push("press-in-gap");
        }
        base = Math.max(base, prev + 1 + gap.rounds);
      }
      const f = rng.float();
      if (f < 0.025) {
        push("next", base, rng.pick([0, 1, 3, 4]));
        flaws.push("press-lead");
      } else if (f < 0.045) {
        push("next", Math.max(0, prev - rng.int(0, 2)), 2);
        flaws.push("press-order");
      }
      at = base;
      push("next", at, 2);
      k++;
      prev = at;
    }
    if (rng.chance(0.1)) {
      push("next", prev + 10, 2);
      flaws.push("press-after");
    }
    epStyle = style;
  } else {
    if (s.startMode === "manual") {
      if (rng.chance(0.12)) {
        push("go", s.start + rng.int(0, 5), L > 0 ? rng.int(0, L - 1) : 0);
        flaws.push("go-lead");
      }
      if (rng.chance(0.1)) {
        push("go", s.start + 5, L + 4 + (s.start > 1000 ? 100 : 0));
        flaws.push("go-early");
      }
      const lead = L + rng.int(0, 15), go = s.start + lead + rng.int(0, 40);
      push("go", go, lead);
      if (rng.chance(0.12)) {
        push("go", go + 12, L + 1);
        flaws.push("go-again");
      }
    } else if (rng.chance(0.06)) {
      push("go", s.start + 40, L + 3);
      flaws.push("go-in-auto");
    }
    const n = style === "none" ? 0 : style === "multiple" ? rng.int(2, 5) : style === "mixed" ? rng.weighted([[0, 2], [1, 3], [2, 3], [rng.int(3, 8), 2]]) : 1;
    let cursor = -Infinity;
    for (let i = 0;i < n; i++) {
      let at = place();
      if (style === "multiple")
        at = Math.max(at, cursor + 3);
      let kind;
      switch (style) {
        case "timed":
          kind = "timed";
          break;
        case "extended":
          kind = "extended";
          break;
        case "long":
          kind = "long";
          break;
        case "after-max":
          kind = "after-max";
          break;
        case "refused-lead":
          kind = "refused-lead";
          break;
        case "stop":
          kind = "stop";
          at = P2(rng.int(5, 89));
          break;
        case "mixed":
          kind = rng.pick([...normal, "double", "resume-unpaused", "extend-unpaused", "stop", "stop-short", "bad-until", "backdated", "after-max", "refused-lead"]);
          break;
        default:
          kind = rng.pick(normal);
      }
      episode(kind, at);
      cursor = at + 40;
      if (kind === "stop")
        break;
    }
    if (style === "stop" && rng.chance(0.6))
      episode(rng.pick(["pause-resume", "stop"]), P2(95));
  }
  const holds = [];
  if (rng.chance(0.07)) {
    const nh = rng.int(1, 3);
    let c = P2(rng.int(1, 40));
    for (let i = 0;i < nh; i++) {
      const a = c + rng.int(0, 6), len = rng.int(1, MAX_HOLD_ROUNDS);
      holds.push({ start: a, end: a + len });
      c = a + len + rng.int(0, 30);
    }
  }
  return { spec: s, omsgs: m, holds, style: epStyle, flaws };
}
function checkCtl(A, o, count, live, log) {
  const s = o.spec;
  const ectl = ectlOf(s), octl = octlOf(s), msgs = asMsgs(o.omsgs);
  const est = resolveControl(ectl, msgs, cleanHolds(o.holds));
  const ost = oracleResolve(octl, o.omsgs, o.holds.filter((h) => h.end > h.start && h.end - h.start <= MAX_HOLD_ROUNDS + 1), WORDS, MAX_TIMED_PAUSE_ROUNDS);
  const j = (x) => JSON.stringify(x);
  A.eq(j(est.ignored), j(ost.ignored), "S-04", "ignored messages");
  A.eq(est.applied, ost.applied, "S-04", "applied count");
  const mg = (iv) => {
    const o2 = [];
    for (const i of iv) {
      const l = o2[o2.length - 1];
      if (l && i.start <= l.end)
        l.end = Math.max(l.end, i.end);
      else
        o2.push({ start: i.start, end: i.end });
    }
    return o2;
  };
  A.eq(j(mg(est.intervals)), j(mg(ost.intervals)), "S-05", "pause intervals");
  A.eq(est.stopRound, ost.stopRound, "S-05", "stop round");
  A.eq(j(est.nextRounds), j(ost.nextRounds), "S-06", "host press rounds");
  A.eq(est.goRound, ost.goRound, "S-07", "Start round");
  if (s.callMode === "host")
    A.eq(j(ectl.hostGaps ?? []), j(octl.hostGaps), "S-06", "host gaps list");
  if (s.startOnly)
    A.ok(o.omsgs.filter((x) => x.action !== "next" && x.action !== "go").every((x) => ost.ignored.some((y) => y.seq === x.seq && (y.why === WORDS.big || x.signedAtRound > x.atBeaconRound))), "S-08", () => "a pause/resume/extend/stop was not refused in a big game");
  const sc = schedOf(s);
  const ecalls = [], calls = oracleCalls(sc, ost, octl, count);
  let bad = 0;
  for (let g = 0;g < count; g++) {
    const r = callRoundR(est, s.start, s.stride, s.breaks, Math.floor(g / 90) + 1, g % 90);
    ecalls.push(r);
    if (r !== calls[g] && bad++ < 3)
      A.fails.length < 6 && A.fails.push({ rule: "S-01", sentence: "call schedule vs independent re-simulation", detail: `call ${g}: engine=${r} oracle=${calls[g]}` });
  }
  A.checks += count;
  if (log)
    live(`control: ${o.omsgs.length} messages, ${ost.applied} applied, ${ost.ignored.length} ignored, pauses=${j(ost.intervals)} stop=${ost.stopRound} go=${ost.goRound}`);
  const fin = calls.map((c, g) => [c, g]).filter((x) => x[0] !== null && Number.isFinite(x[0]));
  let prevR = -Infinity, back = 0, close = 0, inside = 0;
  for (const [r] of fin) {
    if (r <= prevR)
      back++;
    else if (prevR !== -Infinity && r - prevR < s.stride && s.callMode === "auto")
      close++;
    prevR = r;
  }
  A.ok(back === 0, "S-02", () => "numbers went backwards or stood still");
  if (s.callMode === "auto") {
    A.ok(close === 0, "S-02", () => "two numbers closer than the chosen speed");
    for (const [r] of fin)
      for (const iv of ost.intervals)
        if (r >= iv.start && r < iv.end)
          inside++;
    A.ok(inside === 0, "S-02", () => `${inside} number(s) called inside a pause`);
    if (s.fullGap)
      for (const iv of ost.intervals) {
        const first = fin.find((x) => x[0] >= iv.end);
        const prevCall = fin.find((x) => x[0] < iv.start);
        if (first && prevCall)
          A.ok(first[0] >= iv.end + s.stride, "S-03", () => `first number after resume at ${first[0]} < resume ${iv.end} + stride ${s.stride}`);
      }
  }
  return { ost, est, calls, ecalls };
}

// games/tambola/kinds.ts
var HOUSES = PRIZE_HOUSES.map((h) => h.id);
function claimKind(rng, A, live, tr) {
  const M2 = rng.weighted([[rng.int(1, 3), 22], [rng.int(4, 8), 40], [rng.int(9, 20), 28], [rng.int(21, 60), 10]]);
  const sd = rng.hex(4), eid = "C" + sd, round = rng.weighted([[1, 70], [2, 12], [3, 6], [4, 5], [5, 7]]);
  const key = rng.pick([...HOUSES.filter((h) => h !== "unlucky"), "top@1", "full2", "mid@2"]);
  const mode = rng.chance(0.5) ? "next" : "share";
  const stride = rng.pick([2, 3, 4, 5, 8]), base = 33000000 + rng.int(0, 500000);
  const rounds = [];
  let r = base;
  for (let i = 0;i < 92; i++) {
    rounds.push(r);
    r += stride + (rng.chance(0.06) ? rng.int(1, 60) : 0);
  }
  const style = rng.weighted([["on-time", 16], ["mixed", 30], ["boundary", 14], ["late", 8], ["dup", 8], ["tie", 12], ["bogey", 14], ["wrong", 8], ["other-round", 6]]);
  A.d("claimSlice", style);
  A.d("ties", mode);
  const cluster = rng.int(3, 80), claims = [];
  const comp = new Map;
  const pids = Array.from({ length: M2 }, (_, i) => `q${i}x${hex8(sd + i)}`);
  for (const pid of pids)
    comp.set(pid, style === "tie" || rng.chance(0.25) ? cluster + (rng.chance(0.5) ? 0 : rng.int(0, 2)) : rng.int(2, 88));
  const mk = (pid, idx, at, bogey) => ({ pid, pattern: key, round, idx: bogey ? -1 : idx, atMs: at, ...bogey ? { bogey } : {} });
  const meta = new Map;
  for (const pid of pids) {
    const c = comp.get(pid), t0 = rtime(rounds[c]), dl = rtime(rounds[c + 1]);
    const beh = style === "on-time" ? "ok" : style === "late" ? rng.pick(["late", "late", "ok"]) : style === "boundary" ? rng.pick(["b-in", "b-late", "b-in", "b-late", "ok"]) : style === "dup" ? rng.pick(["dup", "dup", "ok", "none"]) : style === "bogey" ? rng.pick(["bog0", "bog1", "bog2", "bog3", "bogEq", "bog-after"]) : style === "wrong" ? rng.pick(["idx+", "idx-", "other-key", "none", "ok"]) : style === "other-round" ? rng.pick(["other-round", "ok"]) : style === "tie" ? rng.pick(["ok", "ok", "ok", "none", "late"]) : rng.pick(["ok", "ok", "ok", "late", "b-in", "b-late", "dup", "none", "bog1", "bog2", "idx+"]);
    const ok = t0 + rng.int(0, Math.min(dl - t0 - 1, 60000));
    meta.set(pid, beh);
    switch (beh) {
      case "ok":
        claims.push(mk(pid, c, ok));
        break;
      case "b-in":
        claims.push(mk(pid, c, dl - 1));
        break;
      case "b-late":
        claims.push(mk(pid, c, dl));
        break;
      case "late":
        claims.push(mk(pid, c, dl + rng.int(1, 30000)));
        break;
      case "dup": {
        claims.push(mk(pid, c, ok + 5), mk(pid, c, ok), mk(pid, c, ok + rng.int(0, 40000)));
        break;
      }
      case "bog0":
        claims.push(mk(pid, c, ok));
        break;
      case "bog1":
        claims.push(mk(pid, 0, ok - 1, true), mk(pid, c, ok));
        break;
      case "bog2":
        claims.push(mk(pid, 0, t0, true), mk(pid, 0, ok - 1 > t0 ? ok - 1 : ok, true), mk(pid, c, ok + 2));
        break;
      case "bog3":
        claims.push(mk(pid, 0, t0, true), mk(pid, 0, t0, true), mk(pid, 0, t0, true), mk(pid, c, ok + 1));
        break;
      case "bogEq":
        claims.push(mk(pid, 0, ok, true), mk(pid, 0, ok, true), mk(pid, c, ok));
        break;
      case "bog-after":
        claims.push(mk(pid, c, ok), mk(pid, 0, ok + 1, true), mk(pid, 0, ok + 2, true));
        break;
      case "idx+":
        claims.push(mk(pid, c + rng.int(1, 3), ok));
        break;
      case "idx-":
        claims.push(mk(pid, Math.max(0, c - rng.int(1, 3)), ok));
        break;
      case "other-key":
        claims.push({ pid, pattern: "zz-" + key, round, idx: c, atMs: ok });
        break;
      case "other-round":
        claims.push({ pid, pattern: key, round: round + 1, idx: c, atMs: ok });
        break;
      default:
        break;
    }
  }
  const claimsShuffled = rng.shuffle(claims);
  const byHouse = claimsByHouse(claimsShuffled, round);
  const per = new Map;
  for (const c of claims) {
    if (c.round !== round || c.pattern !== key)
      continue;
    let e = per.get(c.pid);
    if (!e) {
      e = { claim: null, bog: [] };
      per.set(c.pid, e);
    }
    if (c.bogey)
      e.bog.push(c.atMs);
    else if (!e.claim || c.atMs < e.claim.atMs)
      e.claim = c;
  }
  const groups = new Map;
  for (const pid of pids) {
    const c = comp.get(pid), e = per.get(pid);
    const want = !!e && !!e.claim && e.claim.idx === c && e.claim.atMs < rtime(rounds[c + 1]) && e.bog.filter((t) => t < e.claim.atMs).length < 2;
    A.eq(claimCounts(byHouse, key, pid, c, rounds[c + 1]), want, "T-04", `claim counts for ${pid} (${meta.get(pid)})`);
    if (want) {
      const g = groups.get(c);
      if (g)
        g.push(pid);
      else
        groups.set(c, [pid]);
    }
    const dl = rounds[c + 1];
    A.eq(claimInTime(rtime(dl) - 1, dl), true, "T-05", "1 ms before the next call is in time");
    A.eq(claimInTime(rtime(dl), dl), false, "T-05", "exactly at the next call is late");
    A.eq(claimInTime(rtime(dl) + 1, dl), false, "T-05", "1 ms after is late");
  }
  A.eq(claimInTime(9000000000000000, undefined), true, "T-05", "no next call yet: in time");
  A.eq(claimInTime(9000000000000000, Infinity), true, "T-05", "Host has not pressed: in time");
  const gl = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  const eng = winnersOfHouse(eid, key, gl, mode, (i) => rnd(sd, rounds[i]));
  const pos = [];
  for (const [i, ps] of gl) {
    if (mode === "share" || ps.length === 1)
      pos.push({ idx: i, pids: ps });
    else
      for (const x of ps.map((p) => [sha(`CT1-TIE|${eid}|${rnd(sd, rounds[i])}|${key}|${p}`), p]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        pos.push({ idx: i, pids: [x[1]] });
  }
  const f = (xs) => xs.map((x) => `${x.idx}:${[...x.pids].sort().join(",")}`).join("|");
  A.eq(f(eng), f(pos), mode === "next" ? "T-10" : "T-09", `winner positions (${mode})`);
  A.ok(new Set(eng.flatMap((x) => x.pids)).size === eng.flatMap((x) => x.pids).length, "T-08", () => "a person took two positions of one house");
  const maxTie = gl.reduce((m, g) => Math.max(m, g[1].length), 0);
  A.d("tieSize", maxTie >= 3 ? "3+" : maxTie === 2 ? "2" : "none");
  if (live)
    tr(`claim slice: ${M2} people, house ${key}, ${style}, ties ${mode}, ${claims.length} records`);
  return { k: "claim", sd, M: M2, round, key, mode, stride, style, cl: claims.length };
}
function drawKind(rng, A, live, tr) {
  const sd = rng.hex(4), eid = "D" + sd;
  const which = rng.weighted([["unlucky-at", 25], ["unlucky-pick", 30], ["lucky", 45]]);
  A.d("draw", which);
  if (which === "unlucky-at") {
    const ff = rng.chance(0.7) ? rng.int(0, 89) : -1, od = rng.chance(0.5) ? rng.int(0, 89) : -1, calls = rng.int(0, 90), over = rng.chance(0.5);
    const c = [ff, od].filter((x) => x >= 0);
    if (over && calls > 0)
      c.push(calls - 1);
    A.eq(unluckyAt(ff, od, calls, over), c.length ? Math.min(...c) : -1, "T-12", "when Unlucky is decided");
    return { k: "draw", sd, which, ff, od, calls, over };
  }
  if (which === "unlucky-pick") {
    const n2 = rng.weighted([[0, 4], [1, 8], [rng.int(2, 6), 40], [rng.int(7, 30), 38], [rng.int(31, 120), 10]]);
    const cands = Array.from({ length: n2 }, (_, i) => ({ pid: `u${i}x${hex8(sd + i)}`, marked: rng.int(0, rng.chance(0.5) ? 2 : 14) }));
    if (n2 > 2 && rng.chance(0.2))
      cands.push({ ...cands[0], marked: cands[0].marked + 3 });
    const r2 = rnd(sd, rng.int(1, 9999));
    const got2 = unluckyPick(eid, r2, cands);
    const last = new Map(cands.map((c) => [c.pid, c.marked]));
    const ranked = [...last.entries()].map(([pid, marked]) => ({ pid, marked, rank: sha(`CT1-UNLUCKY|${eid}|${r2}|${pid}`) })).sort((a, b) => a.marked - b.marked || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    A.eq(got2, ranked.length ? ranked[0].pid : null, "T-12", "Unlucky pick");
    const ties = ranked.length > 1 && ranked[0].marked === ranked[1].marked;
    A.d("unluckyTie", ties ? "tie" : "clear");
    return { k: "draw", sd, which, n: n2, r: r2.slice(0, 8) };
  }
  const n = rng.weighted([[0, 3], [1, 8], [rng.int(2, 12), 44], [rng.int(13, 60), 35], [rng.int(61, 250), 10]]);
  const pids = Array.from({ length: n }, (_, i) => `l${i}x${hex8(sd + i)}`);
  if (n > 3 && rng.chance(0.25))
    pids.push(pids[0], pids[1]);
  const want = rng.weighted([[1, 20], [3, 20], [5, 18], [10, 18], [rng.int(11, 40), 24]]);
  const after = rng.int(1, 89), r = rnd(sd, rng.int(1, 1e6));
  const got = luckyWinners(eid, after, r, pids, want), exp = oracleLucky(eid, after, r, pids, want);
  A.eq(got.join(","), exp.join(","), "T-13", "lucky winners");
  A.ok(new Set(got).size === got.length && got.length === Math.min(want, new Set(pids).size) && got.every((g) => pids.includes(g)), "T-13", () => "count or repeats");
  A.d("luckyN", want <= 1 ? "1" : want <= 3 ? "3" : want <= 5 ? "5" : want <= 10 ? "10" : "other");
  return { k: "draw", sd, which, n, want, after };
}
var URLS = ["https://example.com/a.mp4", "https://cdn.example.org/clip.webm", "/demo.mp4", "https://youtu.be/abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk"];
function validBreak(rng, kind) {
  const k = kind ?? rng.pick(["file", "youtube", "slides", "speech", "lucky"]);
  const b = { after: rng.int(1, 89), seconds: 3 * rng.int(5, 200), kind: k, title: "Moment " + rng.hex(2) };
  if (k === "file")
    b.mediaUrl = rng.pick(URLS.filter((u) => !/youtu/.test(u)));
  if (k === "youtube")
    b.mediaUrl = rng.pick(URLS.filter((u) => /youtu/.test(u)));
  if (k === "lucky") {
    b.winners = rng.pick([1, 3, 5, 10]);
    if (rng.chance(0.4))
      b.style = rng.pick(["draw", "scratch"]);
  }
  if (k === "speech" && rng.chance(0.3))
    b.mediaUrl = "https://example.com/talk";
  return b;
}
function genRewards(rng, tickets) {
  const ids = HOUSES.filter((h) => h !== "full2" && h !== "unlucky");
  const n = rng.weighted([[1, 12], [2, 12], [3, 12], [4, 11], [5, 10], [6, 8], [7, 14], [rng.int(8, 14), 12], [ids.length, 3]]);
  const legacy = rng.chance(0.12), chosen = legacy ? ["early5", "top", "mid", "bot", "corners", "star", "full"] : rng.sample(ids, n);
  if (rng.chance(0.68) && !chosen.includes("full"))
    chosen.push("full");
  const out = [];
  const winners = () => rng.weighted([[1, 66], [2, 18], [3, 9], [rng.int(4, 8), 5], [rng.int(9, 100), 2]]);
  for (const h of chosen) {
    const sc = tickets === 2 ? rng.weighted([["ticket", 78], ["ticket_1", 11], ["ticket_2", 11]]) : "ticket";
    const m = winners();
    for (let o = 1;o <= m && out.length < 290; o++)
      out.push({ pattern: h, scope: sc, ordinal: o, text: o === 1 ? "Prize " + h : "" });
    if (tickets === 2 && sc !== "ticket" && rng.chance(0.4))
      for (let o = 1;o <= Math.min(2, m); o++)
        out.push({ pattern: h, scope: "ticket", ordinal: o, text: "" });
  }
  if (tickets === 2 && rng.chance(0.3)) {
    const m = Math.min(3, winners());
    for (let o = 1;o <= m; o++)
      out.push({ pattern: "full", scope: "two_ticket", ordinal: o, text: "Bumper" });
  }
  if (rng.chance(0.2))
    out.push({ pattern: "unlucky", scope: "ticket", ordinal: 1, text: "Unlucky" });
  if (out.length > 299)
    out.length = 299;
  return out;
}
function genBreaks(rng, tickets) {
  const cap = 3 * tickets, n = rng.weighted([[0, 58], [1, 18], [2, 11], [3, 8], [Math.min(cap, rng.int(4, 6)), 5]]);
  const out = [];
  const m = Math.min(n, cap);
  const isAuto = Array.from({ length: m }, () => rng.chance(0.15));
  const nAuto = isAuto.filter(Boolean).length;
  const used = new Set;
  for (let k = 1;k <= nAuto; k++)
    used.add(autoAfter(nAuto, k));
  for (let i = 0;i < m; i++) {
    const b = validBreak(rng);
    if (isAuto[i]) {
      delete b.after;
      if (rng.chance(0.4))
        delete b.seconds;
    } else {
      while (used.has(b.after))
        b.after = rng.int(1, 89);
      used.add(b.after);
    }
    out.push(b);
  }
  return out;
}
function cfgKind(rng, A, live, tr) {
  const sd = rng.hex(4);
  const bad = rng.chance(0.42);
  const tickets = rng.chance(0.4) ? 2 : 1;
  const input = { tickets, ties: rng.pick(["share", "next"]), rounds: rng.weighted([[1, 40], [2, 15], [3, 12], [4, 12], [5, 21]]), rewards: genRewards(rng, tickets), breaks: genBreaks(rng, tickets) };
  if (rng.chance(0.4))
    input.callMode = rng.pick(["auto", "host"]);
  if (rng.chance(0.4))
    input.startMode = rng.pick(["auto", "manual"]);
  if (rng.chance(0.3))
    input.afterPrizes = rng.pick(["keep", "end"]);
  if (rng.chance(0.3))
    input.invites = { on: rng.chance(0.7), per: rng.int(1, 4), cats: rng.sample(INVITE_CATEGORIES.map((c) => c.id), rng.int(1, 4)) };
  if (rng.chance(0.2))
    input.name = "  Game <b>" + rng.hex(2) + "`  ";
  if (rng.chance(0.15))
    input.brand = { name: "Acme " + rng.hex(1), color: rng.pick([...BRAND_COLORS]) };
  if (rng.chance(0.2))
    input.opening = [{ kind: rng.pick(["speech", "slides"]), title: "Welcome", seconds: 3 * rng.int(5, 40) }];
  if (rng.chance(0.15))
    input.closing = [{ kind: "speech", title: "Thanks" }];
  if (rng.chance(0.15))
    input.verify = rng.pick(["mobile", "id", "either", "both"]);
  if (rng.chance(0.1))
    input.employeesOnly = rng.chance(0.5);
  let label = "valid";
  if (bad) {
    const cases = [
      ["tickets", () => {
        input.tickets = rng.pick([0, 3, "2", null, 1.5, -1]);
      }],
      ["rounds", () => {
        input.rounds = rng.pick([0, 6, 1.5, -2, "3", 99]);
      }],
      ["ties", () => {
        input.ties = rng.pick(["tie", 1, "", null]);
      }],
      ["rewards-empty", () => {
        input.rewards = [];
      }],
      ["rewards-notarray", () => {
        input.rewards = rng.pick([{}, "top", 5]);
      }],
      ["rewards-toomany", () => {
        input.rewards = Array.from({ length: MAX_REWARD_LINES + 1 }, (_, i) => ({ pattern: "top", scope: "ticket", ordinal: i % 100 + 1 }));
      }],
      ["house-unknown", () => {
        input.rewards = [{ pattern: "diamond", scope: "ticket", ordinal: 1 }];
      }],
      ["house-full2", () => {
        input.rewards = [{ pattern: "full2", scope: "ticket", ordinal: 1 }];
      }],
      ["two-ticket-not-full", () => {
        input.tickets = 2;
        input.rewards = [{ pattern: "top", scope: "two_ticket", ordinal: 1 }];
      }],
      ["one-ticket-scope", () => {
        input.tickets = 1;
        input.rewards = [{ pattern: "top", scope: "ticket_1", ordinal: 1 }];
      }],
      ["unlucky-per-ticket", () => {
        input.tickets = 2;
        input.rewards = [{ pattern: "unlucky", scope: "ticket_1", ordinal: 1 }];
      }],
      ["ordinal-zero", () => {
        input.rewards = [{ pattern: "top", scope: "ticket", ordinal: rng.pick([0, -1, 1.5]) }];
      }],
      ["unlucky-two", () => {
        input.rewards = [{ pattern: "unlucky", scope: "ticket", ordinal: 1 }, { pattern: "unlucky", scope: "ticket", ordinal: 2 }];
      }],
      ["ordinal-over-max", () => {
        input.rewards = [{ pattern: "top", scope: "ticket", ordinal: MAX_WINNERS_PER_HOUSE + 1 }];
      }],
      ["duplicate", () => {
        input.rewards = [{ pattern: "top", scope: "ticket", ordinal: 1 }, { pattern: "top", scope: "ticket", ordinal: 1 }];
      }],
      ["ordinal-gap", () => {
        input.rewards = [{ pattern: "top", scope: "ticket", ordinal: 2 }];
      }],
      ["breaks-too-many", () => {
        input.breaks = Array.from({ length: maxMidFor(input.tickets === 2 ? 2 : 1) + 1 }, (_, i) => ({ after: 5 + i * 10, seconds: 30, kind: "speech", title: "Break" }));
      }],
      ["break-after", () => {
        input.breaks = [{ after: rng.pick([0, 90, -3, 1.5, 500]), seconds: 30, kind: "speech", title: "Break" }];
      }],
      ["break-seconds", () => {
        input.breaks = [{ after: 10, seconds: rng.pick([14, 16, 601, 0, 31, 100]), kind: "speech", title: "Break" }];
      }],
      ["break-kind", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: rng.pick(["dance", "", null]), title: "Break" }];
      }],
      ["break-lucky-winners", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: "lucky", title: "Draw", winners: rng.pick([2, 4, 11, 0]) }];
      }],
      ["break-lucky-style", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: "lucky", title: "Draw", style: "spin" }];
      }],
      ["break-style-nonlucky", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: "speech", title: "Break", style: "scratch" }];
      }],
      ["break-title", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: "speech", title: rng.pick(["", "x", "<>"]) }];
      }],
      ["break-nolink", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: rng.pick(["file", "youtube"]), title: "Break" }];
      }],
      ["break-http", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: "file", title: "Break", mediaUrl: "http://example.com/a.mp4" }];
      }],
      ["break-notyoutube", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: "youtube", title: "Break", mediaUrl: "https://youtube.com.evil.example/x" }];
      }],
      ["break-lucky-link", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: "lucky", title: "Draw", mediaUrl: "https://example.com/a.mp4" }];
      }],
      ["break-same-after", () => {
        input.breaks = [{ after: 10, seconds: 30, kind: "speech", title: "A one" }, { after: 10, seconds: 30, kind: "speech", title: "B two" }];
      }],
      ["invites-per", () => {
        input.invites = { on: true, per: rng.pick([0, 5, 1.5, -1, 99]), cats: ["family"] };
      }],
      ["invites-cats", () => {
        input.invites = { on: true, per: 2, cats: [rng.pick(["aliens", "", 5])] };
      }],
      ["invites-on-nocats", () => {
        input.invites = { on: true, per: 2, cats: [] };
      }],
      ["invites-on-type", () => {
        input.invites = { on: rng.pick(["yes", 1, null]), per: 2 };
      }],
      ["brand-colour", () => {
        input.brand = { name: "Acme", color: rng.pick(["#123456", "red", ""]) };
      }],
      ["brand-name", () => {
        input.brand = { name: rng.pick(["", "x".repeat(41)]), color: BRAND_COLORS[0] };
      }],
      ["brand-extra", () => {
        input.brand = { name: "Acme", color: BRAND_COLORS[0], size: 3 };
      }],
      ["callmode", () => {
        input.callMode = rng.pick(["robot", 1, ""]);
      }],
      ["startmode", () => {
        input.startMode = rng.pick(["later", 2, ""]);
      }],
      ["afterprizes", () => {
        input.afterPrizes = rng.pick(["stop", 3]);
      }],
      ["verify", () => {
        input.verify = rng.pick(["face", 1]);
      }],
      ["employeesonly", () => {
        input.employeesOnly = rng.pick(["yes", 1]);
      }],
      ["opening-lucky", () => {
        input.opening = [{ kind: "lucky", title: "Draw" }];
      }],
      ["opening-seconds", () => {
        input.opening = [{ kind: "speech", title: "Hello", seconds: rng.pick([14, 17, 123, 3000]) }];
      }],
      ["opening-sum", () => {
        input.opening = [{ kind: "speech", title: "Hello", seconds: 120 }, { kind: "speech", title: "Again", seconds: 60 }];
        input.tickets = 2;
      }],
      ["opening-too-many", () => {
        input.tickets = 1;
        input.opening = [{ kind: "speech", title: "One" }, { kind: "speech", title: "Two" }];
      }],
      ["closing-kind", () => {
        input.closing = [{ kind: rng.pick(["lucky", "nope"]), title: "Bye" }];
      }],
      ["plan", () => {
        input.prizePlan = { mode: "auto", currency: "INR", budget: -5, count: 3, prizes: [{ id: "0:top:1", amount: 10 }] };
      }]
    ];
    const [lab, f] = rng.pick(cases);
    label = lab;
    f();
  }
  A.d("cfg", bad ? "invalid:" + label : "valid");
  A.d("cfgTickets", input.tickets === 2 ? 2 : 1);
  const res = validateCfg(input);
  if (bad) {
    A.ok(res.ok === false, "C-02", () => `accepted an invalid setting (${label}): ${JSON.stringify(input).slice(0, 300)}`);
    if (!res.ok)
      A.ok(typeof res.error === "string" && res.error.length >= 10 && res.error.length < 420 && !/undefined|NaN|\[object|null/.test(res.error) && /[.!?)]$/.test(res.error.trim()), "C-02", () => `not a plain sentence: ${res.error}`);
  } else {
    A.ok(res.ok === true, "C-01", () => `refused a valid setting: ${res.ok ? "" : res.error} :: ${JSON.stringify(input).slice(0, 400)}`);
    if (res.ok) {
      const c = res.cfg;
      A.ok(c.tickets === 1 || c.tickets === 2, "C-03", () => "tickets");
      A.ok(c.rounds >= 1 && c.rounds <= MAX_ROUNDS, "C-03", () => "rounds");
      A.ok(c.rewards.length >= 1 && c.rewards.length <= MAX_REWARD_LINES, "C-03", () => "reward count");
      A.ok(c.breaks.length <= maxMidFor(c.tickets), "C-03", () => "too many breaks");
      A.ok(c.breaks.every((b, i) => b.after >= 1 && b.after <= 89 && b.seconds % 3 === 0 && b.seconds >= 15 && b.seconds <= 600 && (i === 0 || c.breaks[i - 1].after < b.after)), "C-03", () => "breaks not sorted/unique/in range: " + JSON.stringify(c.breaks));
      for (const l of c.rewards)
        A.ok(l.ordinal >= 1 && l.ordinal <= Math.max(maxWinnersFor(l.pattern), 5) && c.rewards.some((x) => x.pattern === l.pattern && x.scope === l.scope && x.ordinal === l.ordinal - 1) === l.ordinal > 1, "C-03", () => `ordinals ${l.pattern}#${l.ordinal}`);
      if (c.tickets === 1)
        A.ok(c.rewards.every((l) => l.scope === "ticket"), "C-03", () => "one-ticket game kept a two-ticket prize");
      A.ok(c.invites.per >= 1 && c.invites.per <= 4, "C-03", () => "invites per");
      const keys2 = keysInPlay(c.rewards);
      A.ok(c.rewards.every((l) => keys2.includes(keyOfLine(l))), "C-03", () => "keysInPlay misses a house");
      if (!c.breaks.some((b) => b.auto) && !input.name && !input.opening) {
        const again = validateCfg({ tickets: c.tickets, ties: c.ties, rewards: c.rewards, breaks: c.breaks, rounds: c.rounds }, c);
        A.ok(again.ok && JSON.stringify(again.cfg.rewards) === JSON.stringify(c.rewards) && JSON.stringify(again.cfg.breaks) === JSON.stringify(c.breaks), "C-01", () => "saving the cleaned settings again changed them");
      }
      A.ok(res.cfg.name === undefined || !/[<>`]/.test(res.cfg.name), "C-01", () => "markup left in the name");
    }
  }
  if (live)
    tr(`cfg ${bad ? "invalid(" + label + ")" : "valid"} -> ${res.ok ? "ok" : res.error}`);
  return { k: "cfg", sd, bad, label, input: JSON.stringify(input).length, t: tickets, r: input.rounds, sdx: hex8(JSON.stringify(input)) };
}

// games/tambola/game.ts
var pickOracle = (eid, k, rand, called) => {
  const taken = new Set(called);
  const rem = [];
  for (let n = 1;n <= 90; n++)
    if (!taken.has(n))
      rem.push(n);
  return rem[Number(BigInt("0x" + sha(`CT1|${eid}|${k}|${rand}`)) % BigInt(rem.length))];
};
var STRIDES = [[2, 18], [3, 22], [4, 16], [5, 12], [6, 10], [8, 8], [10, 6], [20, 4]];
var BEH = [["ok", 38], ["b-in", 5], ["b-late", 5], ["late", 6], ["none", 12], ["dup", 5], ["bog1", 4], ["bog2", 4], ["bogEq", 2], ["bog-after", 2], ["idx+", 3], ["idx-", 3], ["other-key", 3]];
var BEH_ADV = [["ok", 12], ["b-in", 9], ["b-late", 10], ["late", 10], ["none", 8], ["dup", 9], ["bog1", 8], ["bog2", 9], ["bogEq", 4], ["bog-after", 4], ["idx+", 5], ["idx-", 5], ["other-key", 7]];
var PRIO = ["bog2", "bog1", "bogEq", "bog-after", "dup", "b-late", "b-in", "late", "idx+", "idx-", "other-key", "none", "ok"];
function gameKind(rng, A, live, tr) {
  const sd = rng.hex(4);
  const eid = rng.chance(0.72) ? `G${rng.int(0, 199)}` : `F${sd}`;
  const tickets = rng.chance(0.38) ? 2 : 1;
  const rounds = rng.weighted([[1, 35], [2, 15], [3, 13], [4, 13], [5, 24]]);
  const ties = rng.chance(0.5) ? "next" : "share";
  const capClass = rng.weighted([["small", 66], ["mid", 14], ["large", 9], ["big", 7], ["huge", 4]]);
  const cap = capClass === "small" ? rng.int(2, 250) : capClass === "mid" ? rng.int(251, 1000) : capClass === "large" ? rng.int(1001, 2000) : capClass === "big" ? rng.int(2001, 1e4) : rng.int(10001, 300000);
  let callMode = rng.chance(0.22) ? "host" : "auto";
  if (callMode === "host" && cap > MANUAL_MAX_PARTICIPANTS)
    callMode = "auto";
  const startMode = rng.chance(0.3) ? "manual" : "auto";
  const startOnly = cap > PAUSE_MAX_PARTICIPANTS;
  const safety = callMode === "host" || startMode === "manual" || startOnly ? startSafetyForCap(cap).safety : safetyForCap(cap, rng.chance(0.3));
  const input = { tickets, ties, rounds, rewards: genRewards(rng, tickets), breaks: genBreaks(rng, tickets), callMode, startMode };
  const v = validateCfg(input);
  A.ok(v.ok, "C-01", () => "the settings of a game were refused: " + (v.ok ? "" : v.error));
  if (!v.ok)
    return { k: "game", refused: true, h: hex8(JSON.stringify(input)) };
  const cfg = v.cfg;
  const r = rounds === 1 ? 1 : rng.chance(0.2) ? 1 : rng.int(1, rounds);
  const reid = r <= 1 ? eid : `${eid}~r${r}`;
  A.eq(roundEid(eid, r), reid, "T-16", "the id of a round");
  const stride = rng.weighted(STRIDES), start = 33000000 + rng.int(0, 4000000);
  const spec = { callMode, startMode, start, stride, breaks: cfg.breaks.map((b2) => ({ after: b2.after, seconds: b2.seconds })), rounds: cfg.rounds, cap, lead: safety.leadRounds, maxPause: rng.pick([20, 60, 200, 600]), fullGap: rng.chance(0.85), startOnly };
  const N = rng.weighted([[1, 14], [2, 18], [3, 16], [4, 13], [5, 9], [6, 7], [7, 5], [8, 4], [rng.int(9, 12), 5], [rng.int(13, 25), 3], [rng.int(26, 38), 2.4], [rng.int(61, 72), 2.2]]);
  const pstyle = rng.weighted([["seat", 55], ["plain", 25], ["mixed", 20]]);
  let seat = rng.chance(0.7) ? 1 : rng.int(2, 9000);
  const pids = [];
  for (let i = 0;i < N; i++) {
    if (pstyle === "seat" || pstyle === "mixed" && rng.chance(0.5)) {
      pids.push(`${seat}x${hex8(eid + "|" + i)}`);
      seat += rng.chance(0.85) ? 1 : rng.int(2, 6);
    } else
      pids.push(hex8(eid + "|p" + i) + hex8(eid + "|q" + i));
  }
  const tk = pids.map((p) => tix(reid, p, tickets));
  const lines = cfg.rewards.map((l) => ({ key: keyOfLine(l), ordinal: l.ordinal }));
  const keys2 = [];
  for (const l of lines)
    if (!keys2.includes(l.key))
      keys2.push(l.key);
  const wantUnlucky = keys2.includes("unlucky");
  const loopKeys = keys2.filter((k) => k !== "unlucky");
  if (wantUnlucky && !loopKeys.includes("full"))
    loopKeys.push("full");
  A.d("mode", `${startMode}-start/${callMode}-play`);
  A.d("tickets", tickets);
  A.d("ties", ties);
  A.d("rounds", rounds);
  A.d("nHouses", keys2.length <= 1 ? "1" : keys2.length <= 3 ? "2-3" : keys2.length <= 7 ? "4-7" : "8+");
  A.d("hasUnlucky", wantUnlucky);
  A.d("hasFull2", keys2.includes("full2"));
  A.d("perTicket", keys2.some((k) => k.includes("@")));
  A.d("pidStyle", pstyle);
  A.d("people", N <= 1 ? "1" : N <= 4 ? "2-4" : N <= 8 ? "5-8" : N <= 25 ? "9-25" : N <= 60 ? "26-60" : "61+");
  A.d("capClass", capClass);
  A.d("playRound", r);
  const beacon = rng.chance(0.12);
  A.d("numbers", beacon ? "public-randomness" : "shuffled");
  const perm = beacon ? null : rng.shuffle(Array.from({ length: 90 }, (_, i) => i + 1));
  let anchor = rng.int(0, 40);
  const fullComp = perm ? tk.map((t) => completionsAll(t, loopKeys, perm, null, 0)) : [];
  if (perm) {
    const cs = [];
    for (const row2 of fullComp)
      for (const c of row2)
        if (c >= 0)
          cs.push(c);
    if (cs.length)
      anchor = rng.pick(cs);
  }
  const style = rng.chance(0.5) ? "none" : rng.pick(PAUSE_STYLES.filter((s) => s !== "none"));
  const co = genCtl(rng, spec, style, anchor);
  const res = checkCtl(A, co, r * 90, tr, live);
  A.d("pauseStyle", co.style);
  A.d("startOnly", startOnly);
  const rr = res.calls.slice((r - 1) * 90, r * 90);
  let maxH = 0;
  while (maxH < 90 && typeof rr[maxH] === "number" && Number.isFinite(rr[maxH]))
    maxH++;
  for (const b2 of cfg.breaks)
    if (b2.kind === "lucky" && b2.after - 1 < res.calls.length) {
      const prev = res.calls[b2.after - 1];
      const want = prev === null || prev === undefined ? null : prev + 1 + b2.seconds / 3;
      const got = luckyRound(res.est, start, stride, cfg.breaks, b2);
      A.eq(got, want, "S-01", "the round that decides a lucky draw");
      if (want !== null && Number.isFinite(want) && N > 0) {
        const rn = rnd(sd, want), nw = b2.winners ?? 3;
        A.eq(luckyWinners(eid, b2.after, rn, pids, nw).join(","), oracleLucky(eid, b2.after, rn, pids, nw).join(","), "T-13", "lucky draw winners");
      }
    }
  if (maxH === 0) {
    A.d("horizon", "no number yet");
    return { k: "game", eid, r, c: hex8(JSON.stringify(cfg)), n: N, p: hex8(pids.join()), o: hex8(JSON.stringify(co.omsgs)), s: [start, stride, cap], h: 0 };
  }
  let H;
  if (beacon)
    H = Math.min(maxH, rng.weighted([[rng.int(1, 12), 40], [rng.int(13, 30), 40], [rng.int(31, 60), 15], [90, 5]]));
  else {
    const f = rng.float();
    if (f < 0.3)
      H = maxH;
    else if (f < 0.7) {
      const cs = [];
      for (const row2 of fullComp)
        for (const c of row2)
          if (c >= 0)
            cs.push(c);
      H = cs.length ? Math.min(maxH, 1 + rng.pick(cs) + rng.pick([0, 0, 1, 2, 5])) : rng.int(1, maxH);
    } else
      H = rng.int(1, maxH);
  }
  H = Math.max(1, H);
  const log = [];
  const rands = Array.from({ length: H }, (_, i) => rnd(sd, rr[i]));
  if (perm)
    for (let i = 0;i < H; i++)
      log.push(perm[i]);
  else {
    for (let k = 0;k < H; k++)
      log.push(pickNumber(reid, k, rands[k], log));
    let ok = new Set(log).size === log.length && log.every((n) => n >= 1 && n <= 90);
    for (let k = 0;k < H && ok; k++)
      if (log[k] !== pickOracle(reid, k, rands[k], log.slice(0, k)))
        ok = false;
    A.ok(ok, "T-18", () => `numbers from the public randomness differ from the independent derivation: ${log.join(",")}`);
    if (H >= 2) {
      const alt = pickNumber(reid, H - 1, rands[H - 1], log.slice(0, H - 1));
      A.eq(alt, log[H - 1], "T-18", "number k depends only on the rounds up to k");
    }
  }
  const nextR = rr[H];
  const callRounds = rr.slice(0, H);
  if (typeof nextR === "number" && Number.isFinite(nextR) && rng.chance(0.6))
    callRounds.push(nextR);
  A.d("horizon", H >= 90 ? "all 90" : H <= 5 ? "1-5" : H <= 20 ? "6-20" : H <= 45 ? "21-45" : "46-89");
  const over = H >= 90 || rng.chance(0.3);
  A.d("gameOver", over);
  const lateOn = rng.chance(0.25);
  A.d("lateJoiners", lateOn);
  const cfOf = new Map;
  if (lateOn) {
    for (const p of pids)
      if (rng.chance(0.45)) {
        const kk = rng.int(0, H - 1);
        cfOf.set(p, rr[kk] + rng.pick([-1, 0, 0, 1, 2, 5]));
      }
  }
  const outSet = new Set;
  if (rng.chance(0.15))
    for (const p of rng.sample(pids, rng.int(1, 2)))
      outSet.add(p);
  A.d("removedSeats", outSet.size > 0);
  if (lateOn) {
    A.eq(countFromOf(0), 0, "T-11", "no late join");
    A.eq(countFromOf(null), 0, "T-11", "no late join (null)");
    for (const cf of cfOf.values())
      A.eq(countFromOf(cf - 30), cf, "T-11", "first round that counts = join round + 30");
  }
  const comp = new Map;
  const people = [];
  const items = [];
  for (let i = 0;i < N; i++) {
    const pid = pids[i], cf = lateOn ? cfOf.get(pid) ?? 0 : 0, m = new Map;
    comp.set(pid, m);
    people.push({ pid, tickets: tk[i], cf });
    const mine = cf > 0 ? log.map((n, k) => (callRounds[k] ?? Infinity) >= cf ? n : 0) : log;
    const cs = perm && cf === 0 ? fullComp[i].map((c) => c >= 0 && c < H ? c : -1) : completionsAll(tk[i], loopKeys, log, callRounds, cf);
    const direct = i < 3 || rng.chance(0.3);
    loopKeys.forEach((k, q) => {
      const c = cs[q];
      m.set(k, c);
      if (c >= 0)
        items.push({ pid, key: k, c });
      if (direct)
        A.eq(completionIndexKey(tk[i], k, mine), c, "T-03", `completion call of ${k} for ${pid}`);
    });
  }
  const cstyle = rng.weighted([["clean", 20], ["mixed", 45], ["adv", 35]]);
  const behs = new Set;
  const claims = [];
  const nextOf = (c) => {
    const x = callRounds[c + 1];
    return typeof x === "number" && Number.isFinite(x) ? x : undefined;
  };
  const mk = (pid, key, idx, at, bogey) => ({ pid, pattern: key, round: r, idx: bogey ? -1 : idx, atMs: at, ...bogey ? { bogey } : {} });
  const loopAll = [...new Set([...loopKeys, ...keys2])];
  for (const { pid, key, c } of items) {
    const t0 = rtime(rr[c]), nx = nextOf(c), dl = nx === undefined ? null : rtime(nx);
    const span = dl === null ? 30000 : Math.max(0, dl - t0 - 1), okAt = () => t0 + rng.int(0, Math.min(span, 30000));
    let beh = cstyle === "clean" ? "ok" : rng.weighted(cstyle === "adv" ? BEH_ADV : BEH);
    if (dl === null && (beh === "b-in" || beh === "b-late" || beh === "late"))
      beh = "ok";
    behs.add(beh);
    const ok = okAt();
    switch (beh) {
      case "ok":
        claims.push(mk(pid, key, c, ok));
        break;
      case "b-in":
        claims.push(mk(pid, key, c, dl - 1));
        break;
      case "b-late":
        claims.push(mk(pid, key, c, dl));
        break;
      case "late":
        claims.push(mk(pid, key, c, dl + rng.int(1, 20000)));
        break;
      case "dup":
        claims.push(mk(pid, key, c, ok + 7), mk(pid, key, c, ok), mk(pid, key, c, ok + rng.int(0, 5000)));
        break;
      case "bog1":
        claims.push(mk(pid, key, 0, Math.max(0, ok - 1), true), mk(pid, key, c, ok));
        break;
      case "bog2":
        claims.push(mk(pid, key, 0, t0, true), mk(pid, key, 0, Math.max(t0, ok - 1), true), mk(pid, key, c, ok + 2));
        break;
      case "bogEq":
        claims.push(mk(pid, key, 0, ok, true), mk(pid, key, 0, ok, true), mk(pid, key, c, ok));
        break;
      case "bog-after":
        claims.push(mk(pid, key, c, ok), mk(pid, key, 0, ok + 1, true), mk(pid, key, 0, ok + 2, true));
        break;
      case "idx+":
        claims.push(mk(pid, key, c + rng.int(1, 3), ok));
        break;
      case "idx-":
        claims.push(mk(pid, key, Math.max(0, c - rng.int(1, 3)), ok));
        break;
      case "other-key":
        claims.push(mk(pid, rng.pick(loopAll.filter((x) => x !== key).concat("top")), c, ok));
        break;
    }
  }
  if (cstyle !== "clean" && N > 0 && rng.chance(0.3))
    for (let i = 0;i < rng.int(1, 3); i++) {
      const p = rng.pick(pids), k = rng.pick(loopAll), t = rtime(rr[rng.int(0, H - 1)]) + rng.int(0, 2000);
      claims.push(mk(p, k, 0, t, true));
      if (rng.chance(0.4))
        claims.push(mk(p, k, rng.int(0, H - 1), t + 5));
    }
  const noise = cstyle !== "clean" && rng.chance(0.3);
  if (noise)
    for (const c of claims.slice(0, 6))
      claims.push({ ...c, round: c.round + (rng.chance(0.5) ? 1 : -1) || 7 });
  const main2 = behs.size ? rng.pick([...behs]) : "none-needed";
  A.d("claim", main2);
  A.d("claimStyle", cstyle);
  A.d("otherRoundClaims", noise);
  const un = { out: outSet, randomness: rands, over };
  const late = lateOn ? { countFrom: cfOf, callRounds } : undefined;
  const cl = { claims, callRounds };
  const eng = settleAll(eid, pids, log, cfg, r, late, un, cl);
  const oin = { eid: reid, round: r, people, calls: log, callRounds, lines, ties, claims, rand: (i) => rands[i], out: outSet, over: over || H >= 90, lateOn, comp };
  const ores = oracleSettle(oin);
  const a = normSettled(eng), b = normSettled(ores);
  const diffRule = () => a.includes("unlucky") !== b.includes("unlucky") || a.split(" | ").filter((x) => x.startsWith("unlucky")).join() !== b.split(" | ").filter((x) => x.startsWith("unlucky")).join() ? "T-12" : lateOn && [...cfOf.values()].length ? "T-11" : ties === "next" ? "T-10" : "T-04";
  if (a !== b)
    A.fail(diffRule(), `engine: ${a.slice(0, 700)} || oracle: ${b.slice(0, 700)}`);
  else
    A.checks++;
  A.d("prizesAwarded", ores.length === 0 ? "none" : ores.length <= 2 ? "1-2" : ores.length <= 6 ? "3-6" : "7+");
  const maxTie = Math.max(0, ...ores.map((x) => x.pids.length));
  A.d("tieSize", maxTie >= 3 ? "3+" : maxTie === 2 ? "2" : "none");
  const seen = new Map;
  for (const x of eng) {
    const s = seen.get(x.pattern) ?? new Set;
    for (const p of x.pids) {
      A.ok(!s.has(p), "T-08", () => `${p} took ${x.pattern} twice`);
      s.add(p);
    }
    seen.set(x.pattern, s);
  }
  for (const k of keys2) {
    let last = -1;
    for (const x of eng.filter((y) => y.pattern === k)) {
      A.ok(x.idx >= last, "T-08", () => `positions of ${k} go backwards`);
      last = x.idx;
    }
  }
  const ps = prizeStatus(cfg, ores.map((x) => ({ ...x, round: r })), r);
  const planned3 = lines.filter((l) => l.key !== "unlucky");
  A.eq(ps.length, planned3.length, "T-17", "number of prize lines shown");
  A.eq(ps.filter((p) => p.claimed).length, planned3.filter((l) => ores.some((x) => x.pattern === l.key && x.ordinal === l.ordinal)).length, "T-17", "number of claimed prizes shown");
  A.ok(ps.every((p, i) => i === 0 || !(ps[i - 1].claimed && !p.claimed)), "T-17", () => "claimed prizes must come after the open ones");
  if (N <= 8 && rng.chance(0.1)) {
    const e2 = settleAll(eid, rng.shuffle(pids), log, cfg, r, late, un, { claims: rng.shuffle(claims), callRounds });
    A.eq(normSettled(e2), a, "T-14", "settlement after shuffling people and claims");
    A.d("shuffled", true);
  }
  if (N <= 8 && rng.chance(0.1)) {
    const pe = new PrizeEngine(eid, cfg, r);
    pe.addSeats(pids.map((pid) => ({ pid, countFrom: lateOn ? cfOf.get(pid) ?? 0 : 0, ...outSet.has(pid) ? { blk: true } : {} })));
    pe.work(1000000000000, () => 0);
    pe.setClaims(claims);
    pe.setCallRound((k) => callRounds[k] ?? null);
    for (let i = 0;i < H; i++)
      pe.feed(log[i], rr[i], rands[i]);
    pe.setOver(over);
    A.eq(normSettled(pe.results()), a, "T-15", "the phone's prize engine vs the whole-log settlement");
    A.d("phoneEngine", true);
  }
  if (N <= 5 && rng.chance(0.08)) {
    const cc = claims.filter((c) => c.pattern !== "unlucky" && (!c.bogey && c.round === r && keys2.includes(c.pattern) || !c.bogey && c.round === r)).slice(0, 8).map((c) => ({ pid: c.pid, pattern: c.pattern, idx: c.idx, round: r }));
    const ck = checkClaims(eid, cc, { [r]: log }, cfg, lateOn ? { countFrom: cfOf, callRounds: { [r]: callRounds } } : undefined);
    let good = 0;
    for (const c of cc) {
      const pi = pids.indexOf(c.pid), cf = lateOn ? cfOf.get(c.pid) ?? 0 : 0;
      const w = completionAt(tk[pi], c.pattern, log, callRounds, cf) === c.idx;
      if (w)
        good++;
    }
    A.eq(ck.good.length, good, "T-19", "claims that check as good");
    A.eq(ck.good.length + ck.bad.length, cc.length, "T-19", "every claim is good or bad");
  }
  if (live) {
    tr(`game ${eid} round ${r}/${rounds} ${startMode}-start/${callMode}-play tickets ${tickets} ties ${ties}; ${N} people (${pstyle}); numbers ${beacon ? "from public randomness" : "shuffled"}; ${H} known`);
    tr(`houses: ${keys2.join(", ")}  rewards: ${lines.length}`);
    tr(`schedule style ${co.style}; call rounds: ${rr.slice(0, 8).join(",")}...`);
    for (const x of items.slice(0, 20))
      tr(`  completes ${x.key} at call ${x.c}: ${x.pid}`);
    tr(`claims (${cstyle}): ${claims.length}, behaviours ${[...behs].join(",")}`);
    tr(`engine: ${a}`);
    tr(`oracle: ${b}`);
  }
  return { k: "game", eid, r, c: hex8(JSON.stringify(cfg)), n: N, p: hex8(pids.join()), o: hex8(JSON.stringify(co.omsgs) + JSON.stringify(co.holds)), s: [start, stride, cap, spec.lead, spec.maxPause, spec.fullGap], b: beacon ? sd : hex8(perm.join()), h: H, l: hex8(JSON.stringify([...cfOf])), out: [...outSet], over, cl: hex8(JSON.stringify(claims)) };
}

// games/tambola/more.ts
var leadOf = (poll) => {
  const worst = poll + 3 + 3;
  const hold = Math.ceil((worst + poll) / 3);
  return hold + 1 + 2;
};
var pollOf = (cap, fast) => cap <= 250 ? fast ? 7 : 12 : cap <= 1000 ? 36 : cap <= 2000 ? 72 : cap <= 1e4 ? 90 : 120;
function schedKind(rng, A, live, tr) {
  const capClass = rng.weighted([["small", 58], ["mid", 14], ["large", 9], ["big", 12], ["huge", 7]]);
  const cap = capClass === "small" ? rng.int(1, 250) : capClass === "mid" ? rng.int(251, 1000) : capClass === "large" ? rng.int(1001, 2000) : capClass === "big" ? rng.int(2001, 1e4) : rng.int(10001, 400000);
  const mode = rng.weighted([["aa", 40], ["ah", 15], ["ma", 28], ["mh", 17]]);
  const callMode = mode[1] === "h" ? "host" : "auto", startMode = mode[0] === "m" ? "manual" : "auto";
  A.d("mode", `${startMode}-start/${callMode}-play`);
  A.d("capClass", capClass);
  const fast = rng.chance(0.3);
  const tooBig = callMode === "host" && cap > 1000;
  A.eq(modeTooBig({ callMode, startMode }, cap) !== null, tooBig, "S-10", "Host calling is refused above 1,000 people");
  A.eq(needsControl({ callMode, startMode }), callMode === "host" || startMode === "manual", "S-10", "needs a control file");
  const ss = startSafetyForCap(cap), sp = safetyForCap(cap, fast);
  A.eq(ss.startOnly, cap > 2000, "S-10", "only Start above 2,000 people");
  A.eq(sp === null, cap > 2000, "S-10", "no pause profile above 2,000 people");
  A.eq(ss.safety.leadRounds, leadOf(pollOf(cap, false)), "S-10", "the lead of the Start profile");
  if (sp)
    A.eq(sp.leadRounds, leadOf(pollOf(cap, fast)), "S-10", "the lead of the pause profile");
  const cap2 = cap + rng.int(1, 5000);
  A.ok(startSafetyForCap(cap2).safety.leadRounds >= ss.safety.leadRounds, "S-10", () => `more people (${cap2}) gave less lead than ${cap}`);
  A.ok(MAX_HOST_KEYS === 5 && PAUSE_MAX_PARTICIPANTS === 2000 && MANUAL_MAX_PARTICIPANTS === 1000 && NEXT_LEAD_ROUNDS === 2, "S-10", () => "a documented limit changed");
  if (tooBig) {
    A.d("pauseStyle", "refused-big-host");
    return { k: "sched", cap, mode, fast, refused: true };
  }
  const rounds = rng.weighted([[1, 45], [2, 15], [3, 12], [4, 10], [5, 18]]);
  const breaks = genBreaks(rng, rng.chance(0.4) ? 2 : 1).filter((b) => b.after).map((b) => ({ after: b.after, seconds: b.seconds ?? 60, kind: b.kind }));
  const uniq = breaks.filter((b, i) => breaks.findIndex((x) => x.after === b.after) === i).sort((x, y) => x.after - y.after).slice(0, rounds === 1 ? 6 : 3);
  const stride = rng.weighted([[2, 18], [3, 22], [4, 16], [5, 12], [6, 10], [8, 8], [10, 6], [20, 4]]);
  const startOnly = cap > 2000;
  const spec = { callMode, startMode, start: 33000000 + rng.int(0, 4000000), stride, breaks: uniq.map((b) => ({ after: b.after, seconds: b.seconds })), rounds, cap, lead: ss.safety.leadRounds, maxPause: rng.pick([20, 60, 200, 600]), fullGap: rng.chance(0.85), startOnly };
  const style = rng.chance(0.2) ? "none" : rng.pick(PAUSE_STYLES.filter((s) => s !== "none"));
  const co = genCtl(rng, spec, style, rng.weighted([[0, 3], [1, 3], [rng.int(2, 10), 6], [rng.int(11, 60), 6], [rng.int(61, Math.max(61, rounds * 90 - 2)), 3]]));
  A.d("pauseStyle", co.style);
  A.d("fullGap", spec.fullGap);
  A.d("rounds", rounds);
  A.d("startOnly", startOnly);
  A.d("breaks", uniq.length === 0 ? "0" : uniq.length === 1 ? "1" : uniq.length === 2 ? "2" : "3+");
  const res = checkCtl(A, co, rounds * 90, tr, live);
  const calls = res.calls;
  const bk = spec.breaks.map((b) => ({ after: b.after, seconds: b.seconds, kind: "speech", title: "Break" }));
  for (const b of bk) {
    const prev = calls[b.after - 1];
    if (typeof prev !== "number" || !Number.isFinite(prev))
      continue;
    const from = prev + 1, to = from + b.seconds / 3;
    for (const now of [from - 1, from, to - 1, to]) {
      const got = activeBreak(res.est, spec.start, stride, bk, now)?.brk.after ?? null;
      const want = bk.find((x) => {
        const p = calls[x.after - 1];
        return typeof p === "number" && Number.isFinite(p) && now >= p + 1 && now < p + 1 + x.seconds / 3;
      })?.after ?? null;
      A.eq(got, want, "S-01", `the break showing at round ${now}`);
    }
  }
  for (let rd = 2;rd <= rounds; rd++) {
    const prevLast = calls[(rd - 1) * 90 - 1];
    let first = calls[(rd - 1) * 90];
    if (typeof prevLast !== "number" || !Number.isFinite(prevLast) || first === null || first === undefined)
      continue;
    if (first === Infinity)
      first = prevLast + 1 + INTERMISSION_ROUNDS;
    for (const now of [prevLast, prevLast + 1, first - 1, first]) {
      const got = activeIntermission(res.est, spec.start, stride, bk, rd, now)?.endsAtRound ?? null;
      A.eq(got, now > prevLast && now < first ? first : null, "S-01", `the intermission before round ${rd} showing at round ${now}`);
    }
  }
  if (live)
    tr(`sched ${mode} cap ${cap} rounds ${rounds} style ${co.style} lead ${spec.lead}`);
  return { k: "sched", cap, mode, fast, st: spec.start, stride, rounds, br: uniq.map((b) => b.after + "/" + b.seconds), mp: spec.maxPause, fg: spec.fullGap, o: hex8(JSON.stringify(co.omsgs) + JSON.stringify(co.holds)) };
}
var GEN2 = 1692803367;
var MIN = 60000;
var FROM_ORACLE = Date.UTC(2026, 9, 29, 23, 36, 7, 27);
function familyKind(rng, A, live, tr) {
  const sd = rng.hex(3);
  const created = rng.chance(0.75) ? FROM_ORACLE + rng.pick([0, 0, 1, rng.int(2, 9000000000)]) : FROM_ORACLE - rng.pick([1, 1, rng.int(2, 9000000000)]);
  const rulesOn = created >= FROM_ORACLE;
  A.eq(APPROVAL_RULES_FROM_MS, FROM_ORACLE, "F-03", "the instant the approval rules came in");
  A.eq(approvalRulesOn({ created_ms: created }), rulesOn, "F-03", `approval rules on for a game made at ${created}`);
  A.ok(approvalRulesOn(null) === false && approvalRulesOn({ created_ms: null }) === false && approvalRulesOn({}) === false, "F-03", () => "a game with no creation time must follow the old rules");
  A.d("rules", rulesOn ? "new" : "old");
  const startRound = 33000000 + rng.int(0, 2000000), startMs = (GEN2 + (startRound - 1) * 3) * 1000;
  A.eq(roundStartMs(startRound), startMs, "F-04", "start time of a round");
  const atMs = startMs - rng.int(0, 5 * 3600000);
  const lapsePts = [atMs, atMs + 1, atMs + 30 * MIN - 1, atMs + 30 * MIN, atMs + 30 * MIN + 1, atMs + rng.int(0, 90 * MIN)];
  for (const now2 of lapsePts) {
    A.eq(waitingLapsed(atMs, now2), now2 - atMs >= 30 * MIN, "F-03", `a request made at ${atMs} seen at ${now2}`);
    A.eq(waitSince({ created_ms: created }, now2), rulesOn ? now2 - 30 * MIN : 0, "F-03", "earliest answerable request time");
  }
  A.eq(waitingValidUntil(atMs), atMs + 30 * MIN, "F-03", "a request can be answered until");
  const cutPts = [startMs - 15 * MIN - 1, startMs - 15 * MIN, startMs - 15 * MIN + 1, startMs - 1, startMs, startMs + rng.int(1, 3600000), startMs - rng.int(15 * MIN, 6 * 3600000)];
  for (const now2 of cutPts)
    A.eq(familyCutoffPassed(startMs, now2), now2 >= startMs - 15 * MIN, "F-04", `family approval at ${now2 - startMs} ms from the start`);
  const hex7 = () => rng.int(0, 268435455).toString(16).padStart(7, "0");
  const inviters = ["o", "h:" + hex7(), "c:" + hex7(), "s:" + rng.int(1, 999999), "h:0000000", "h:fffffff", "c:0000000", "c:fffffff", "s:1"];
  for (const inv of rng.sample(inviters, 4)) {
    const code = fromCodeOf(inv);
    const own = code === null ? null : parseFrom(code);
    A.ok(code !== null && own !== null && inviterOf(own) === inv, "F-08", () => `link code of ${inv} -> ${code} -> ${own ? inviterOf(own) : null}`);
    const src = srcOf(inv);
    A.eq(src, inv.startsWith("c:") ? "co:" + inv.slice(2) : inv.startsWith("h:") ? "ho:" + inv.slice(2) : "link", "F-08", "where a person came in from");
  }
  for (const bad of [0, -1, 1.5, "5", null, undefined, COHOST_FROM + 268435456, HOST_FROM + 268435456, ORG_FROM + 1, 2 ** 40])
    A.ok(parseFrom(bad) === null, "F-08", () => `a made-up code ${String(bad)} was believed`);
  A.eq(fromCodeOf("x:12"), null, "F-08", "unknown inviter kind");
  A.ok(COHOST_LIMIT_DEFAULT === 100 && COHOST_LIMIT_MIN === 10 && COHOST_LIMIT_MAX === 1000 && WAITING_MAX === 500 && MAX_ADD_BATCH === 200 && MAX_INVITES_PER_PERSON === 4, "F-02", () => "a documented limit changed");
  const cap = rng.weighted([[rng.int(1, 6), 30], [rng.int(7, 40), 45], [rng.int(41, 300), 25]]);
  const per = rng.int(1, 4), invitesOn = rng.chance(0.85), coLimit = rng.chance(0.4) ? COHOST_LIMIT_DEFAULT : rng.int(COHOST_LIMIT_MIN, COHOST_LIMIT_MAX);
  const people = [];
  let nextId = 1;
  const alive = () => people.filter((p) => !p.gone);
  const listCount = (inv) => people.filter((p) => !p.gone && p.inviter === inv).length;
  const coId = "c:" + hex7(), hoId = "h:" + hex7();
  const limitOf = (inv, _level) => {
    if (inv.startsWith("c:"))
      return coLimit;
    if (!inv.startsWith("s:"))
      return null;
    const h = people.find((p) => p.id === Number(inv.slice(2)));
    return h && h.level === 1 && invitesOn ? per : 0;
  };
  const guestsL1 = () => alive().filter((p) => p.level === 1);
  let refusedFull = 0, refusedList = 0, refusedL2 = 0, added = 0, removed = 0, readded = 0;
  const ops = rng.int(8, 40);
  for (let i = 0;i < ops; i++) {
    const op = rng.weighted([["org", 20], ["host", 8], ["cohost", 20], ["guest", 25], ["l2", 6], ["remove", 14], ["readd", 7]]);
    if (op === "remove") {
      const l = alive();
      if (!l.length)
        continue;
      rng.pick(l).gone = true;
      removed++;
      A.d("removal", "freed-place");
      continue;
    }
    if (op === "readd") {
      const g = people.filter((p2) => p2.gone);
      if (!g.length)
        continue;
      const p = rng.pick(g);
      const lim2 = limitOf(p.inviter, p.level);
      const okTotal = alive().length < cap, okList = lim2 === null || listCount(p.inviter) < lim2;
      if (okTotal && okList) {
        p.gone = false;
        readded++;
      }
      continue;
    }
    let inviter = "o", level = 1;
    if (op === "host")
      inviter = hoId;
    else if (op === "cohost")
      inviter = coId;
    else if (op === "guest") {
      const g = guestsL1();
      if (!g.length) {
        inviter = "o";
      } else
        inviter = "s:" + rng.pick(g).id;
    } else if (op === "l2") {
      const g = alive().filter((p) => p.level === 2);
      if (!g.length)
        continue;
      inviter = "s:" + rng.pick(g).id;
    }
    if (op === "guest" && inviter.startsWith("s:"))
      level = 2;
    const holder = inviter.startsWith("s:") ? people.find((p) => p.id === Number(inviter.slice(2))) : null;
    const lim = holder ? holder.level === 1 ? invitesOn ? per : 0 : 0 : limitOf(inviter, 1);
    const l2try = holder !== null && holder.level === 2;
    const full = alive().length >= cap, listFull = lim !== null && listCount(inviter) >= lim;
    if (l2try) {
      refusedL2++;
      A.d("guestOfGuest", "cannot-invite");
      continue;
    }
    if (full) {
      refusedFull++;
      A.d("capReached", true);
      continue;
    }
    if (listFull) {
      refusedList++;
      A.d("listFull", true);
      continue;
    }
    people.push({ id: nextId++, inviter, level: inviter === "o" || inviter === hoId || inviter === coId ? 1 : level, gone: false });
    added++;
    A.ok(alive().length <= cap, "F-01", () => `${alive().length} people in a game of ${cap}`);
    for (const inv of new Set(people.map((p) => p.inviter))) {
      const l = limitOf(inv, 1);
      if (l !== null && !inv.startsWith("s:"))
        A.ok(listCount(inv) <= l, "F-02", () => `${inv} has ${listCount(inv)} people, limit ${l}`);
      else if (inv.startsWith("s:"))
        A.ok(listCount(inv) <= per, "F-02", () => `${inv} has ${listCount(inv)} people, limit ${per}`);
    }
  }
  A.ok(alive().length <= cap, "F-01", () => "the room is over its limit");
  A.ok(removed >= readded, "F-06", () => "more re-added than removed");
  const reqInv = rng.pick(["o", coId, hoId, "s:" + rng.int(1, 40)]);
  const above = reqInv.startsWith("s:") ? rng.pick(["o", coId]) : null;
  const chain = "," + [reqInv, ...above ? [above] : []].join(",") + ",";
  const deciders = [
    { name: "organizer", who: { all: true, id: "o" }, family: false, want: true },
    { name: "host", who: { all: true, id: hoId }, family: false, want: true },
    { name: "cohost-own", who: { all: false, id: coId }, family: false, want: chain.includes("," + coId + ",") },
    { name: "cohost-other", who: { all: false, id: "c:" + hex7() }, family: false, want: false },
    { name: "family-own", who: { all: false, id: reqInv.startsWith("s:") ? reqInv : "s:7" }, family: true, want: reqInv.startsWith("s:") || chain.includes(",s:7,") },
    { name: "family-other", who: { all: false, id: "s:" + (900 + rng.int(0, 90)) }, family: true, want: false }
  ];
  const now = rng.pick(cutPts);
  for (const d of deciders) {
    A.eq(mayDecide(d.who, chain), d.want, "F-05", `${d.name} may decide ${chain}`);
    const can = d.want && !(d.family && rulesOn && familyCutoffPassed(startMs, now));
    A.eq(can, d.want && !(d.family && rulesOn && now >= startMs - 15 * MIN), "F-04", `${d.name} can approve now`);
    A.d("decider", d.name);
  }
  A.ok(mayDecide({ all: false, id: "s:1" }, ",s:11,") === false && mayDecide({ all: false, id: "s:11" }, ",s:1,") === false, "F-05", () => "list ids must match whole (s:1 is not s:11)");
  if (live)
    tr(`family: cap ${cap}, per ${per}, invites ${invitesOn}, added ${added}, full ${refusedFull}, list full ${refusedList}, l2 ${refusedL2}, removed ${removed}, re-added ${readded}`);
  return { k: "family", c: created, st: startRound, at: atMs - startMs, cap, per, on: invitesOn, co: coLimit, ops, sd, now: now - startMs };
}
var colRange = (c) => c === 0 ? [1, 9] : c === 8 ? [80, 90] : [c * 10, c * 10 + 9];
function validTicket(t) {
  if (t.length !== 3)
    return "not 3 rows";
  const seen = new Set;
  for (let r = 0;r < 3; r++) {
    if (t[r].length !== 9)
      return "row not 9 wide";
    if (t[r].filter((x) => x !== null).length !== 5)
      return "row without 5 numbers";
  }
  for (let c = 0;c < 9; c++) {
    const [lo, hi] = colRange(c);
    let prev = 0, cnt = 0;
    for (let r = 0;r < 3; r++) {
      const v = t[r][c];
      if (v === null || v === undefined)
        continue;
      cnt++;
      if (v < lo || v > hi)
        return `column ${c} has ${v}`;
      if (v <= prev)
        return "column not rising";
      prev = v;
      if (seen.has(v))
        return "repeated number";
      seen.add(v);
    }
    if (cnt === 0)
      return `column ${c} empty`;
  }
  return seen.size === 15 ? null : "not 15 numbers";
}
function ticketKind(rng, A, live, tr) {
  const eid = rng.chance(0.5) ? `T${rng.int(0, 99)}` : `U${rng.hex(4)}`;
  const n = rng.chance(0.5) ? 2 : 1;
  const style = rng.weighted([["seat", 60], ["plain", 40]]);
  A.d("ticketStyle", style);
  A.d("tickets", n);
  const S = rng.int(2, 4), seat0 = rng.chance(0.6) ? 1 : rng.int(2, 1e5);
  const all = new Set;
  let count = 0;
  for (let i = 0;i < S; i++) {
    const seat = seat0 + i, pid = style === "seat" ? `${seat}x${hex8(eid + i)}` : hex8(eid + "|" + i) + hex8("z" + eid + i);
    const ts = ticketsFor(eid, pid, n);
    A.eq(ts.length, n, "T-01", "number of tickets");
    for (const t of ts) {
      const why = validTicket(t);
      A.ok(why === null && isValidTicket(t), "T-01", () => `${pid}: ${why ?? "isValidTicket refused it"} ${JSON.stringify(t)}`);
      all.add(JSON.stringify(t));
      count++;
    }
    if (n === 2)
      A.ok(JSON.stringify(ts[0]) !== JSON.stringify(ts[1]), "T-02", () => "a person's two tickets are the same");
    if (style === "seat") {
      A.eq(seatOfPid(pid), seat, "T-02", "seat of a pid");
      A.eq(JSON.stringify(ticketAt(eid, positionOf(seat, 0))), JSON.stringify(ts[0]), "T-02", "first ticket = the seat's list position");
      if (n === 2)
        A.eq(JSON.stringify(ticketAt(eid, positionOf(seat, 1))), JSON.stringify(ts[1]), "T-02", "second ticket = the next list position");
    } else
      A.eq(seatOfPid(pid), null, "T-02", "a plain id has no seat");
  }
  A.ok(all.size === count || style === "plain", "T-02", () => "two seats of one game got the same ticket");
  for (const c of [0, 1, 4, 8])
    A.eq(JSON.stringify(columnRange(c)), JSON.stringify(colRange(c)), "T-01", `range of column ${c}`);
  const K = rng.int(1, 6), log = [];
  for (let k = 0;k < K; k++) {
    const rn = rnd(eid + rng.hex(2), 1000 + k);
    const nn = pickNumber(eid, k, rn, log);
    A.eq(nn, pickOracle(eid, k, rn, log), "T-18", `number ${k}`);
    A.ok(nn >= 1 && nn <= 90 && !log.includes(nn), "T-18", () => `number ${nn} repeated or out of range`);
    log.push(nn);
  }
  if (live)
    tr(`ticket ${eid} ${style} x${n} seats ${seat0}..${seat0 + S - 1}`);
  return { k: "ticket", eid, n, style, S, seat0, K, h: hex8(log.join()) };
}
var PERM_OK = (() => {
  const seen = new Set;
  const key = "5a".repeat(32);
  for (let x = 0;x < 1e4; x++)
    seen.add(perm10k(key, x));
  return { ok: seen.size === 1e4 && Math.max(...seen) === 9999 && Math.min(...seen) === 0 };
})();
var SEPS = [" ", "-", "/", ".", "_", "  ", "\u3000", "\u200B"];
function miscKind(rng, A, live, tr) {
  const which = rng.weighted([["perm", 12], ["empid", 30], ["email", 14], ["quorum", 12], ["name", 14], ["checkin", 8], ["tables", 10]]);
  A.d("misc", which);
  if (which === "perm") {
    A.ok(PERM_OK.ok, "F-09", () => "perm10k is not a permutation of 0..9999");
    const key = rng.hex(32), xs = new Set, outs = new Set;
    while (xs.size < 40)
      xs.add(rng.int(0, 9999));
    for (const x of xs) {
      const y = perm10k(key, x);
      A.ok(Number.isInteger(y) && y >= 0 && y < 1e4, "F-09", () => `perm10k(${x}) = ${y}`);
      A.ok(!outs.has(y), "F-09", () => `two check-in codes the same: ${y}`);
      outs.add(y);
      A.eq(perm10k(key, x), y, "F-09", "same input, same code");
    }
    return { k: "misc", which, key };
  }
  if (which === "empid") {
    const base = rng.hex(rng.int(1, 8)).toUpperCase().replace(/[^A-Z0-9]/g, "A") + rng.pick(["", "B", "7Z"]);
    let typed = "";
    for (const ch of base)
      typed += (rng.chance(0.4) ? ch.toLowerCase() : ch) + (rng.chance(0.3) ? rng.pick(SEPS) : "");
    typed = rng.pick(["", " ", "  "]) + typed + rng.pick(["", " "]);
    const c = cleanEmpId(typed);
    A.eq(c, base, "F-09", `"${typed}" cleaned`);
    A.eq(cleanEmpId(c), c, "F-09", "cleaning twice");
    A.ok(/^[A-Z0-9]*$/.test(cleanEmpId(rng.pick(["\uFF11\uFF22-678", "ab\u0301c", "x\u200By", "\u2460\u2461", "\u0663\u0664"]) + typed)), "F-09", () => "something other than A-Z and 0-9 was left");
    const newGame = { created_ms: 1793554453235 + rng.int(0, 1e9) }, oldGame = { created_ms: rng.int(0, 1793554453234) };
    A.eq(normEmpFor(typed, newGame), typed.trim() === "" ? "" : base.length <= 30 && base ? base : null, "F-09", "ID in a new game");
    const oldWant = (() => {
      const s = String(typed).replace(/\s+/g, "").toUpperCase();
      if (!s)
        return "";
      return /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(s) ? s : null;
    })();
    A.eq(normEmpFor(typed, oldGame), oldWant, "F-09", "ID in an older game");
    A.eq(normEmpFor("a@b.com", newGame), null, "F-09", "an email typed where an ID is asked");
    A.eq(normEmp(typed), oldWant, "F-09", "people.ts normEmp is the old rule");
    return { k: "misc", which, typed };
  }
  if (which === "email") {
    const user = rng.hex(rng.int(1, 6)), dom = rng.pick(["example.com", "mail.example.org", "a-b.co.in"]);
    const typed = rng.pick(["", " "]) + (rng.chance(0.5) ? user.toUpperCase() : user) + rng.pick(["@", "\uFF20"]) + dom + rng.pick(["", " "]);
    const n = normEmail(typed);
    A.eq(n, (user + "@" + dom).toLowerCase(), "F-09", "email cleaned");
    A.eq(normEmail(n), n, "F-09", "email cleaning twice");
    A.eq(cleanEmail(typed), n, "F-09", "a good email is accepted in its clean form");
    for (const bad of [user + dom, user + "@", "@" + dom, user + "@" + dom.split(".")[0], user + "@@" + dom])
      A.ok(cleanEmail(bad) === null, "F-09", () => `bad email accepted: ${bad}`);
    return { k: "misc", which, typed };
  }
  if (which === "quorum") {
    const ps = [];
    for (let i = 0;i < 4; i++) {
      const p = rng.weighted([[rng.int(0, 12), 50], [rng.int(13, 200), 30], [rng.int(201, 1e5), 20]]);
      ps.push(p);
      const q = p <= 6 ? Math.max(1, Math.ceil(p / 2)) : Math.min(25, Math.max(3, Math.ceil(p * 0.05)));
      A.eq(quorumFor(p), q, "F-09", `quorum for ${p}`);
      A.eq(votersFor(p), p <= 12 ? p : 4 * q, "F-09", `voters for ${p}`);
      A.ok(quorumFor(p) <= Math.max(1, votersFor(p)), "F-09", () => "quorum bigger than the voters");
    }
    return { k: "misc", which, p: ps };
  }
  if (which === "name") {
    const parts = ["Asha", "  Ravi ", "\u200BX", "=SUM(A1)", "+91", "-x", "@h", "a<b>c", "`tick`", "\x07bell", "\u2028", "  ", "Zo\xEB", "\u540D\u524D"];
    let raw = "";
    for (let i = rng.int(1, 4);i > 0; i--)
      raw += rng.pick(parts);
    if (rng.chance(0.1))
      raw += "x".repeat(70);
    const c = cleanName(raw);
    A.ok(c.length <= 60 && !/[<>`\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/.test(c) && !/^[=+\-@\s]/.test(c) && c === c.trim(), "F-09", () => `name not clean: ${JSON.stringify(c)} from ${JSON.stringify(raw)}`);
    A.eq(cleanName(c), c, "F-09", "name cleaned twice");
    A.eq(cleanName(123), "", "F-09", "not a string");
    return { k: "misc", which, raw };
  }
  if (which === "checkin") {
    const st = rng.int(1000000000000, 2000000000000);
    A.eq(checkinOpensMs(st), st - 300000, "F-09", "check-in opens 5 minutes before");
    A.eq(CHECKIN_OPENS_BEFORE_MS, 300000, "F-09", "constant");
    return { k: "misc", which, st };
  }
  const ids = PRIZE_HOUSES.map((h) => h.id);
  A.ok(new Set(ids).size === ids.length && ids.includes("full2") && ids.includes("unlucky"), "C-03", () => "the table of houses has a repeat");
  const keysUsed = [];
  for (let ti = 0;ti < 3; ti++) {
    const h = rng.pick(ids), t = rng.pick(["", "@1", "@2"]);
    const key = h + t;
    A.eq(baseKey(key), h, "C-03", "base of a key");
    A.eq(ticketOfKey(key), t === "@1" ? 1 : t === "@2" ? 2 : 0, "C-03", "ticket of a key");
    A.eq(maxWinnersFor(key), h === "unlucky" ? 1 : 100, "C-03", `most winners for ${key}`);
    A.ok(houseLabel(key).startsWith(t ? "Ticket " + t.slice(1) + ": " : ""), "C-03", () => "label of " + key);
    keysUsed.push(key);
  }
  A.ok(MAX_REWARD_LINES === 300 && MAX_ROUNDS === 5 && INTERMISSION_ROUNDS === 30 && GRACE_ROUNDS === 40 && LATE_LAG_ROUNDS === 30 && CLAIM_WINDOW_CALLS === 1 && BOGEYS_OUT === 2, "C-03", () => "a documented constant changed");
  return { k: "misc", which, key: keysUsed };
}
var secretOf = (name) => {
  let s = "";
  for (let i = 0;i < 8; i++)
    s += hashStr(name, i + 1).toString(16).padStart(8, "0");
  return s;
};
var SEC = { org: secretOf("org"), h1: secretOf("host1"), h2: secretOf("host2"), out: secretOf("outsider") };
var PUB = { org: publicKeyFromSecret(SEC.org), h1: publicKeyFromSecret(SEC.h1), h2: publicKeyFromSecret(SEC.h2), out: publicKeyFromSecret(SEC.out) };
var STARTUP = [];
var mem = () => {
  const m = new Map;
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => {
    m.set(k, v);
  } };
};
var SIGN_CASES = [];
async function buildSign() {
  const ACTIONS = ["pause", "resume", "pause", "extend", "stop"];
  for (let i = 0;i < 70; i++) {
    const r = new Rng(777000 + i), eid = "SG" + i, kinds = [];
    const withHosts = r.chance(0.5), cfg = { pubKey: PUB.org, maxPauseRounds: 600, leadRounds: 13, ...withHosts ? { hostKeys: [PUB.h1, PUB.h2] } : {} };
    const n = r.int(1, 7), incoming = [], truth = new Map;
    let forgedExpected = false;
    const msgs = [];
    const sign = (secName, m) => signControlWithSecret(SEC[secName], m);
    for (let s = 1;s <= n; s++) {
      const at = 33000100 + s * 10 + r.int(0, 5), base = { engagementId: eid, seq: s, action: ACTIONS[(s - 1) % 5], atBeaconRound: at, signedAtRound: at - 14, ...ACTIONS[(s - 1) % 5] === "extend" ? { untilRound: at + 50 } : {} };
      const signer = withHosts && r.chance(0.4) ? r.pick(["h1", "h2"]) : "org";
      const good = sign(signer, base);
      msgs.push({ m: base, sec: SEC[signer], pub: PUB[signer] });
      const f2 = r.float();
      if (f2 < 0.06) {
        incoming.push(sign("out", base));
        kinds.push("forged");
        forgedExpected = true;
        continue;
      }
      if (f2 < 0.12) {
        incoming.push({ ...good, atBeaconRound: good.atBeaconRound + 1 });
        kinds.push("tampered");
        forgedExpected = true;
        continue;
      }
      if (f2 < 0.16) {
        incoming.push(sign(signer, { ...base, engagementId: eid + "x" }));
        kinds.push("other-game");
        forgedExpected = true;
        continue;
      }
      if (f2 < 0.2) {
        incoming.push({ ...good, sig: "zz" + good.sig.slice(2) });
        kinds.push("bad-sig-text");
        forgedExpected = true;
        continue;
      }
      if (f2 < 0.24) {
        incoming.push({ ...good, seq: r.pick([0, -1, 1.5, "2"]) });
        kinds.push("malformed");
        forgedExpected = true;
        continue;
      }
      if (f2 < 0.27) {
        kinds.push("missing");
        continue;
      }
      incoming.push(good);
      if (!truth.has(s))
        truth.set(s, good.sig);
      if (r.chance(0.12)) {
        incoming.push(good);
        kinds.push("repeat");
      }
      if (r.chance(0.07)) {
        incoming.push(sign("org", { ...base, atBeaconRound: base.atBeaconRound + 3 }));
        kinds.push("conflict");
        forgedExpected = true;
      }
    }
    const order = !kinds.includes("conflict") && r.chance(0.5) ? r.shuffle(incoming) : incoming;
    if (order !== incoming)
      kinds.push("shuffled");
    const first = new Map;
    for (const m of order)
      if (m && Number.isInteger(m.seq) && m.seq >= 1 && m.engagementId === eid && truth.get(m.seq) === m.sig && !first.has(m.seq))
        first.set(m.seq, m.sig);
    const expSigs = [];
    for (let s = 1;first.has(s); s++)
      expSigs.push(first.get(s));
    const real = await acceptLogDetailed(cfg, eid, order);
    SIGN_CASES.push({ eid, expect: expSigs.join(","), real: real.log.map((m) => m.sig).join(","), expForged: forgedExpected, realForged: real.forged > 0, kinds, msgs });
  }
  const ok = (name, cond, detail) => STARTUP.push({ name, ok: cond, detail: cond ? "" : JSON.stringify(detail) });
  const kv = mem();
  const id = "PUB1";
  ok("bad key text", (await registerKey(kv, id, "xyz")).ok === false, 0);
  ok("bad game id", (await registerKey(kv, "a b", PUB.org)).ok === false, 0);
  ok("register", (await registerKey(kv, id, PUB.org, SAFETY_STANDARD, 600)).ok === true, 0);
  ok("register twice", (await registerKey(kv, id, PUB.h1)).ok === false, 0);
  const mk = (seq, action, at, lead, sec = SEC.org, extra = {}) => signControlWithSecret(sec, { engagementId: id, seq, action, atBeaconRound: at, signedAtRound: at - lead, ...extra });
  const L = SAFETY_STANDARD.leadRounds;
  const p1 = await publishControl(kv, "NOPE", mk(1, "pause", 100, L));
  ok("unknown game 404", !p1.ok && p1.status === 404, p1);
  const p2 = await publishControl(kv, id, { nonsense: true });
  ok("malformed 400", !p2.ok && p2.status === 400, p2);
  const p3 = await publishControl(kv, id, mk(1, "pause", 100, L, SEC.out));
  ok("forged 403", !p3.ok && p3.status === 403, p3);
  const p4 = await publishControl(kv, id, mk(1, "pause", 100, L - 1));
  ok("short lead 422", !p4.ok && p4.status === 422, p4);
  const p5 = await publishControl(kv, id, mk(2, "pause", 100, L));
  ok("seq gap 409", !p5.ok && p5.status === 409, p5);
  const m1 = mk(1, "pause", 100, L), p6 = await publishControl(kv, id, m1);
  ok("first message", p6.ok === true && p6.seq === 1, p6);
  const p7 = await publishControl(kv, id, m1);
  ok("same message again", p7.ok === true && p7.duplicate === true, p7);
  const p8 = await publishControl(kv, id, mk(1, "pause", 101, L));
  ok("same seq, other content 409", !p8.ok && p8.status === 409, p8);
  const p9 = await publishControl(kv, id, mk(2, "resume", 130, 3));
  ok("resume ok", p9.ok === true, p9);
  const hk = [PUB.h1, PUB.h2, secretOf("h3"), secretOf("h4"), secretOf("h5"), secretOf("h6")].map((x, i) => i < 2 ? x : publicKeyFromSecret(x));
  const adds = [];
  for (const k of hk)
    adds.push((await addHostKey(kv, id, k)).ok === true);
  ok("five host keys, not six", adds.slice(0, 5).every(Boolean) && adds[5] === false, adds);
  ok("host key twice is harmless", (await addHostKey(kv, id, hk[0])).ok === true && (await addHostKey(kv, id, PUB.org)).added === false, 0);
  ok("bad host key text", (await addHostKey(kv, id, "12")).ok === false && (await addHostKey(mem(), "NONE", PUB.h1)).ok === false, 0);
  const p10 = await publishControl(kv, id, mk(3, "stop", 500, L, SEC.h1));
  ok("a Host may sign", p10.ok === true, p10);
  const f = await readPublished(kv, id);
  ok("file holds the messages", !!f && f.messages.length === 3 && f.hostKeys.length === 5, f);
  const kvb = mem();
  await registerKey(kvb, "BIG1", PUB.org, SAFETY_BIG10K, 600, { startOnly: true });
  const q1 = await publishControl(kvb, "BIG1", signControlWithSecret(SEC.org, { engagementId: "BIG1", seq: 1, action: "pause", atBeaconRound: 300, signedAtRound: 100 }));
  ok("big game: pause refused in its words", !q1.ok && q1.error === BIG_GAME_REFUSAL, q1);
  const q2 = await publishControl(kvb, "BIG1", signControlWithSecret(SEC.org, { engagementId: "BIG1", seq: 1, action: "go", atBeaconRound: 300, signedAtRound: 100 }), { startMode: "manual", startNotBefore: 50 });
  ok("big game: Start works", q2.ok === true, q2);
  const kvh = mem();
  await registerKey(kvh, "HST1", PUB.org);
  const hg = { callMode: "host", startMode: "auto", breaks: [], rounds: 1 };
  const h1 = await publishControl(kvh, "HST1", signControlWithSecret(SEC.org, { engagementId: "HST1", seq: 1, action: "next", atBeaconRound: 200, signedAtRound: 197 }), hg);
  ok("press with 3 rounds of lead refused in the Host's words", !h1.ok && h1.error === NEXT_REFUSALS.lead, h1);
  const h2 = await publishControl(kvh, "HST1", signControlWithSecret(SEC.org, { engagementId: "HST1", seq: 1, action: "next", atBeaconRound: 200, signedAtRound: 198 }), hg);
  ok("press with 2 rounds of lead accepted", h2.ok === true, h2);
  const d = describeControl(await readPublished(kvh, "HST1"));
  ok("description", d.registered === true, d);
}
await buildSign();
var SIGN_GROUPS = (() => {
  const g = new Map;
  SIGN_CASES.forEach((c, i) => {
    const k = c.kinds.length ? c.kinds[0] : "clean";
    (g.get(k) ?? g.set(k, []).get(k)).push(i);
  });
  return [...g.values()];
})();
function signKind(rng, A, live, tr) {
  const grp = rng.pick(SIGN_GROUPS), ci = rng.pick(grp), c = SIGN_CASES[ci];
  A.d("signCase", c.kinds.length ? c.kinds[0] : "clean");
  A.eq(c.real, c.expect, "S-11", `case ${ci} (${c.kinds.join(",")}): the longest genuine prefix`);
  A.eq(c.realForged, c.expForged, "S-11", `case ${ci}: something forged was noticed`);
  const j0 = rng.int(0, STARTUP.length - 1);
  for (let j = 0;j < 4; j++) {
    const s = STARTUP[(j0 + j) % STARTUP.length];
    A.ok(s.ok, "S-11", () => `${s.name}: ${s.detail}`);
  }
  const m = c.msgs[rng.int(0, c.msgs.length - 1)];
  const pubBytes = Uint8Array.from(m.pub.match(/../g).map((x) => parseInt(x, 16)));
  const fm = { ...m.m, engagementId: "E" + hex8(String(rng.int(1, 1e9))), seq: rng.int(1, 400), atBeaconRound: rng.int(1, 3000000), signedAtRound: rng.int(1, 3000000) };
  let o = "-", flip = -1;
  if (rng.chance(0.25) || live) {
    const fsig = signControlWithSecret(m.sec, fm).sig, fb = Uint8Array.from(fsig.match(/../g).map((x) => parseInt(x, 16))), fbytes = canonicalBytes(fm);
    o = hex8(fsig);
    A.ok(ed25519.verify(fb, fbytes, pubBytes), "S-11", () => "a fresh genuine signature did not verify");
    flip = rng.int(0, fb.length - 1);
    const fbad = fb.slice();
    fbad[flip] = fbad[flip] ^ 1 << rng.int(0, 7);
    A.ok(!ed25519.verify(fbad, fbytes, pubBytes), "S-11", () => "a signature with one bit flipped still verified");
  }
  A.d("signedBy", m.pub === PUB.org ? "organizer" : "host");
  if (live)
    tr(`sign case ${ci}: ${c.kinds.join(",") || "clean"} real=${c.real.slice(0, 20)} expect=${c.expect.slice(0, 20)}`);
  return { k: "sign", ci, j0, mi: c.msgs.indexOf(m), o, f: [fm.engagementId, fm.seq, fm.atBeaconRound, fm.signedAtRound, flip] };
}

// games/tambola/scenario.ts
var meta = {
  game: "tambola",
  sha: "fe030e8",
  dimensions: {
    kind: ["game", "sched", "claim", "cfg", "family", "draw", "ticket", "misc", "sign"],
    mode: ["auto-start/auto-play", "auto-start/host-play", "manual-start/auto-play", "manual-start/host-play"],
    tickets: [1, 2],
    ties: ["share", "next"],
    rounds: [1, 2, 3, 4, 5],
    playRound: [1, 2, 3, 4, 5],
    nHouses: ["1", "2-3", "4-7", "8+"],
    hasUnlucky: [true, false],
    hasFull2: [true, false],
    perTicket: [true, false],
    pidStyle: ["seat", "plain", "mixed"],
    people: ["1", "2-4", "5-8", "9-25", "26-60", "61+"],
    capClass: ["small", "mid", "large", "big", "huge"],
    numbers: ["shuffled", "public-randomness"],
    pauseStyle: [...PAUSE_STYLES, "refused-big-host"],
    startOnly: [true, false],
    fullGap: [true, false],
    horizon: ["no number yet", "1-5", "6-20", "21-45", "46-89", "all 90"],
    gameOver: [true, false],
    lateJoiners: [true, false],
    removedSeats: [true, false],
    claim: ["ok", "b-in", "b-late", "late", "none", "dup", "bog1", "bog2", "bogEq", "bog-after", "idx+", "idx-", "other-key", "none-needed"],
    claimStyle: ["clean", "mixed", "adv"],
    otherRoundClaims: [true, false],
    prizesAwarded: ["none", "1-2", "3-6", "7+"],
    tieSize: ["none", "2", "3+"],
    shuffled: [true],
    phoneEngine: [true],
    breaks: ["0", "1", "2", "3+"],
    claimSlice: ["on-time", "mixed", "boundary", "late", "dup", "tie", "bogey", "wrong", "other-round"],
    cfg: "open",
    cfgTickets: [1, 2],
    draw: ["unlucky-at", "unlucky-pick", "lucky"],
    unluckyTie: ["tie", "clear"],
    luckyN: ["1", "3", "5", "10", "other"],
    rules: ["new", "old"],
    decider: ["organizer", "host", "cohost-own", "cohost-other", "family-own", "family-other"],
    removal: ["freed-place"],
    guestOfGuest: ["cannot-invite"],
    capReached: [true],
    listFull: [true],
    ticketStyle: ["seat", "plain"],
    misc: ["perm", "empid", "email", "quorum", "name", "checkin", "tables"],
    signCase: "open",
    signedBy: ["organizer", "host"]
  },
  rules: RULES
};
var KINDS2 = [["game", 20], ["sched", 20], ["claim", 18], ["cfg", 9], ["family", 10], ["draw", 6], ["ticket", 4], ["misc", 8], ["sign", 5.5]];
function run(seed, trace) {
  const rng = new Rng(seed), A = new Acc, live = isLive(trace);
  const kind = rng.weighted(KINDS2);
  A.d("kind", kind);
  let params;
  switch (kind) {
    case "game":
      params = gameKind(rng, A, live, trace);
      break;
    case "sched":
      params = schedKind(rng, A, live, trace);
      break;
    case "claim":
      params = claimKind(rng, A, live, trace);
      break;
    case "cfg":
      params = cfgKind(rng, A, live, trace);
      break;
    case "family":
      params = familyKind(rng, A, live, trace);
      break;
    case "draw":
      params = drawKind(rng, A, live, trace);
      break;
    case "ticket":
      params = ticketKind(rng, A, live, trace);
      break;
    case "misc":
      params = miscKind(rng, A, live, trace);
      break;
    default:
      params = signKind(rng, A, live, trace);
  }
  return { params, dims: A.dims, checks: A.checks, fails: A.fails };
}

// games/tambola/main.ts
main(meta, run);
