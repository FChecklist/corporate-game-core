// The free demo game. It runs the REAL phone game (z.js and zgame.js) with a preloaded script and no server game behind it, so a prospective organizer can
// get the feel in about 70 seconds without signing in, paying or typing anything, as often as they like: 3 numbers, a 15-second break, 3 numbers, and Four corners.
// What is scripted (all in packages/beacon/src/demo-script.ts, proven by a test): the ticket, the six numbers, the break. What is real: the number drawing, the
// marking, the winner check, the Hurray, the break player, the end screen. The demo starts only when the person presses "Run Demo": that press puts the moment of the
// first number (3 seconds later) in the address (#r=...) and reloads, so every run is a fresh game. No date, no time, no sign-in; nothing is stored anywhere.
(function () {
  "use strict";
  const ZG = window.ZG, D = ZG.DEMO;
  // A test may supply its own faster clock (window.__CB_DEMO_CLOCK); a real visitor never does.
  const TESTCLOCK = window.__CB_DEMO_CLOCK || null;
  const clock = TESTCLOCK || { now: () => Date.now(), mono: () => performance.now() };
  const CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
  const LEAD_MS = 3000; // the first number comes 3 seconds after "Run Demo" is pressed
  const RUN_WINDOW_MS = 150000; // an address older than this shows the idle screen again instead of a half-finished demo
  // Links to see the ticket at one moment of the game: demo.html?stage=before | start | middle | end (each opens a fresh run placed at that moment). Pressing Run Demo always wins.
  const STAGE_AT = { start: 3000, middle: -22000, end: -66000 }; // where the first number is, compared with now: just about to come / the break is showing / the winner has just been found
  const stage = new URLSearchParams(location.search).get("stage") || "";
  const stageR = Object.prototype.hasOwnProperty.call(STAGE_AT, stage) ? clock.now() + STAGE_AT[stage] : 0;
  const R = Number(new URLSearchParams(location.hash.replace(/^#/, "")).get("r")) || stageR || 0;
  const running = R > 0 && clock.now() <= R + RUN_WINDOW_MS && R <= clock.now() + 60000;
  // Idle (not pressed yet): the first number is "tomorrow", so nothing happens until the button is pressed.
  const S = running ? R : clock.now() + 24 * 3600 * 1000;
  const F = ZG.roundAt(S) + 1; // the beacon round of the first number
  const cfg = D.demoCfg(window.CB_DEMO_VIDEO);
  const filler = (r) => r.toString(16).padStart(64, "0");

  // The clock still comes from the real public beacon (so phones with a wrong clock stay in step); only the six scripted rounds carry scripted numbers.
  const fetcher = async (url) => {
    const last = String(url).split("/").pop();
    if (last === "latest") {
      if (!TESTCLOCK) try {
        const ac = new AbortController(), t = setTimeout(() => ac.abort(), 2500);
        const r = await fetch("https://api.drand.sh/" + CHAIN + "/public/latest", { signal: ac.signal, cache: "no-store" }); clearTimeout(t);
        if (r.ok) return r;
      } catch { /* the device clock is used instead */ }
      const rr = ZG.roundAt(clock.now());
      return { ok: true, status: 200, json: async () => ({ round: rr, randomness: filler(rr), signature: "aa" }) };
    }
    const r = Number(last), rand = D.demoRandomnessFor(F, r);
    return { ok: true, status: 200, json: async () => ({ round: r, randomness: rand || filler(r), signature: "aa" }) };
  };
  const info = () => ({ startRound: F - ZG.GRACE_ROUNDS, callSeconds: D.DEMO_CALL_SECONDS, cap: 3, trackClaims: false, tickets: 1, rounds: 1, rewards: cfg.rewards, breaks: cfg.breaks, opening: [], closing: [], invites: { on: false, per: 4, cats: ["family"] } });
  const api = async (method, path) => {
    if (/\/info$/.test(path)) return info();
    if (/\/control$/.test(path)) throw Object.assign(new Error("none"), { status: 404 }); // nothing can be paused in a demo
    if (/\/seats\?/.test(path)) return { ready: true, seats: [[1, D.DEMO_PID, 0]], upto: 1 };
    if (/\/results$/.test(path)) return { results: [] };
    if (/\/myprizes/.test(path)) return { prizes: [] };
    return { ok: true };
  };
  const mem = new Map([["cbz:" + D.DEMO_EID + ":pid", D.DEMO_PID], ["cbz:" + D.DEMO_EID + ":jr", "0"]]);
  window.__CB_DEMO = {
    eid: D.DEMO_EID, api, getPublic: async () => { throw Object.assign(new Error("none"), { status: 404 }); }, beacon: { fetcher }, verify: () => true,
    store: { get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => { mem.set(k, String(v)); } },
    mono: clock.mono, startMs: S, running,
    run: () => { history.replaceState(null, "", location.pathname + "#r=" + Math.round(clock.now() + LEAD_MS)); location.reload(); },
    seconds: { lead: LEAD_MS / 1000, play: D.DEMO_PLAY_SECONDS },
  };
})();
