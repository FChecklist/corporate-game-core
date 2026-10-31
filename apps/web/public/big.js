/* Corporate Bingo big screen: shows the game to a room on a projector or TV. No sign-in and no personal data: it only reads the public
   numbers (the same ones every phone uses) and the public count of winners. It never joins the game. */
(function () {
  const ZG = window.ZG;
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const EID = (q.get("e") || "").trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const VOICE = { on: false }; // B14: this screen can say each number out loud (a tap switches it on, because a browser allows sound only after a tap)
  const NAMES = { lucky: "Lucky draw" };
  (ZG.PRIZE_HOUSES || []).forEach((h) => { if (!NAMES[h.id]) NAMES[h.id] = h.label; }); // every house name comes from the shared table
  const ORD = (k) => ["", "1st", "2nd", "3rd"][k] || k + "th";
  const S = { info: null, infoAge: 0, cf: null, store: new ZG.RoundStore({}), logs: {}, round: 1, now: null, st: null, results: [], err: "", lastNum: null, t0: Date.now() };
  const j = async (url) => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw Object.assign(new Error("http " + r.status), { status: r.status }); return r.json(); };
  const hms = (s) => { s = Math.max(0, Math.round(s)); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":"); };
  const mmss = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  async function tick() {
    try {
      if (!S.info) S.info = await j(`/api/z/${EID}/info`);
      const cf0 = await fetch(`/api/z/${EID}/control`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => S.cf); S.cf = cf0 && cf0.pubKey ? cf0 : null; S.locked = !!(cf0 && cf0.locked); S.cancelled = !!(cf0 && cf0.cancelled); S.dns = !!(cf0 && cf0.didNotStart); S.ann = cf0 && cf0.ann && cf0.ann.text ? cf0.ann : null; // held for non-payment: nothing is shown
      const l = await ZG.fetchRound("latest"); if (l) { S.now = l.round; S.nowAt = Date.now(); }
      if (S.now === null) { S.err = "Waiting for the clock…"; return; }
      S.st = S.cf ? ZG.resolveControl(ZG.cfgOf(S.cf), S.cf.messages) : null;
      const cfg = { tickets: S.info.tickets, rewards: S.info.rewards, breaks: S.info.breaks, rounds: S.info.rounds || 1 };
      S.cfg = cfg;
      const stride = S.info.callSeconds / 3;
      let budget = 60;
      for (let r = 1; r <= cfg.rounds; r++) {
        const sched = Array.from({ length: 75 }, (_, k) => ZG.callRoundR(S.st, S.info.startRound + ZG.GRACE_ROUNDS, stride, cfg.breaks, r, k));
        const upto = sched.filter((x) => x !== null && !S.locked && x <= S.now);
        const need = upto.filter((x) => !S.store.rounds.has(x)).slice(0, budget); budget -= need.length;
        await Promise.all(need.map((x, i) => (S.now - x <= 2 ? S.store.fetchLive(x, i) : S.store.fetchBackfill(x, i))));
        S.logs[r] = ZG.logFrom(ZG.roundEid(EID, r), sched.filter((x) => x !== null), S.store, upto.length);
      }
      S.store.verifySome(3);
      S.round = Math.max(1, ...Object.keys(S.logs).filter((r) => S.logs[r].length > 0).map(Number));
      try { S.results = (await j(`/api/z/${EID}/results`)).results || []; } catch {}
      S.err = "";
    } catch (e) { S.err = e.status === 403 ? "This game is not published yet. Publish it first (step 7 in your console). This screen then starts by itself: you do not need to refresh." : e.status === 404 ? "That game was not found." : "Connecting…"; }
  }

  function draw() {
    if (!S.info) return ($app.innerHTML = `<p class="msg">${esc(S.err || "Loading…")}</p>`);
    const info = S.info, cfg = S.cfg || { rounds: 1 };
    const secsToStart = S.now === null ? null : (info.startRound + ZG.GRACE_ROUNDS - S.now) * 3 - (Date.now() - (S.nowAt || Date.now())) / 1000;
    const log = S.locked ? [] : S.logs[S.round] || [];
    if (S.dns) return ($app.innerHTML = `<div class="top"><div class="brand">Corporate Bingo</div></div><div class="big"><h1>This game did not start</h1><p>This game did not start. Your details have been erased.</p></div><div class="foot">${esc(location.host)}/z?e=${esc(EID)}</div>`); // nobody paid; the time and 23 hours went by
    if (S.cancelled) return ($app.innerHTML = `<div class="top"><div class="brand">Corporate Bingo</div></div><div class="big"><h1>This game was cancelled</h1><p>This game was cancelled by the organizer.</p></div><div class="foot">${esc(location.host)}/z?e=${esc(EID)}</div>`);
    if (S.locked) return ($app.innerHTML = `<div class="top"><div class="brand">Corporate Bingo</div></div><div class="big"><h1>Waiting for the Organizer or Host</h1><p>Waiting for the Organizer or Host to start the game.</p></div><div class="foot">${esc(location.host)}/z?e=${esc(EID)}</div>`);
    const paused = S.st && S.now !== null && S.st.intervals.some((i) => S.now >= i.start && S.now < i.end);
    const lost = (S.now === null ? Date.now() - S.t0 : Date.now() - (S.nowAt || Date.now())) > 15000; // no answer from the public clock for 15 seconds: the numbers on this screen may be late
    const lostBar = lost ? `<div class="lostbar" role="alert">Connection lost. The numbers on this screen may be late. Reconnecting…</div>` : "";
    const annBar = S.ann ? `<div class="annbar" role="alert">${esc(S.ann.text)}</div>` : "";
    const bd = info.brand && typeof info.brand === "object" ? info.brand : null, bLogo = bd && typeof bd.logo === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(bd.logo) ? bd.logo : ""; // the organizer's own logo and name, or ours in writing
    const quiet = info.roomMode === true;
    const voiceBtn = window.TBAudio ? `<button type="button" class="bigvoice${VOICE.on ? " on" : ""}${quiet && !VOICE.on ? " ask" : ""}" id="bigvoice" aria-pressed="${VOICE.on}">${VOICE.on ? "Voice on" : quiet ? "Tap once: this screen will say the numbers" : "Turn on voice"}</button>` : "";
    const head = `${lostBar}${annBar}<div class="top"><div class="brand">${bLogo ? `<img class="blogo" alt="" src="${esc(bLogo)}">` : ""}${esc(bd && bd.name ? bd.name : "Corporate Bingo")}</div><div class="meta">${cfg.rounds > 1 ? "Round " + S.round + " of " + cfg.rounds + " · " : ""}${log.length} of 75 numbers called</div>${voiceBtn}</div>`;
    const sett = (S.results || []).filter((r) => (r.round === S.round || r.round === undefined) && r.pattern !== "lucky" && r.winners && r.winners.length).map((r) => ({ pattern: r.pattern, ordinal: r.ordinal, idx: r.idx, pids: r.winners, round: S.round, tied: r.tied }));
    const ranked = sett.length ? ZG.rankWinners(ZG.roundEid(EID, S.round), ZG.validateCfg({ tickets: info.tickets, rewards: info.rewards }, undefined, { stored: true }).cfg, sett, 10) : [];
    const wins = ranked.map((x) => `<span><b>${esc(ZG.rankName(x.rank))} ${esc(NAMES[x.pattern] || x.pattern)}</b> · card ${esc(String((/^(\d+)x/.exec(x.pid) || [0, "?"])[1]))}${x.note ? " · same number as another card" : ""}</span>`).join("");
    if (!log.length) {
      const sec = secsToStart;
      return ($app.innerHTML = `${head}<div class="big">${sec !== null && sec > 120 ? `<p>The game starts in</p><div class="cd">${hms(sec - 120)}</div><p>Open the link on your phone and get your card.</p>` : sec !== null && sec > 0 ? `<h1>Your game is setting up</h1><p>We are waiting 2 minutes more for everyone to join.</p><div class="cd">${mmss(sec)}</div><p>Open the link on your phone and get your card.</p>` : `<h1>Get ready</h1><p>The first number is about to be called…</p>`}</div><div class="foot">${esc(location.host)}</div>`);
    }
    const last = log[log.length - 1];
    const fresh = S.lastNum !== null && S.lastNum !== last; S.lastNum = last;
    if (fresh && VOICE.on && window.TBAudio) { TBAudio.enabled = true; TBAudio.play(last); } // B14: the room hears each new number from this screen
    const called = new Set(log);
    const LET = ["B", "I", "N", "G", "O"], colOf = (n) => Math.floor((n - 1) / 15);
    const board = LET.map((l, c) => `<div class="bl l${c}" aria-hidden="true">${l}</div>` + Array.from({ length: 15 }, (_, i) => c * 15 + i + 1).map((n) => `<div class="${n === last ? "l" : called.has(n) ? "c" : ""}" aria-label="${LET[colOf(n)]} ${n}${called.has(n) ? ", called" : ""}">${n}</div>`).join("")).join("");
    const recent = log.slice(-6, -1).reverse().map((n) => `<span class="l${colOf(n)}" aria-label="${LET[colOf(n)]} ${n}">${LET[colOf(n)]} ${n}</span>`).join("");
    const banner = paused ? `<div class="big" style="margin-bottom:1vh"><h1>Paused</h1><p>The organizer has paused the game. It will resume shortly.</p></div>` : "";
    $app.innerHTML = `${head}${banner}<div class="main"><div class="now"><div class="lbl">Now calling</div><div class="num l${colOf(last)} ${fresh ? "fresh" : ""}" aria-label="${LET[colOf(last)]} ${last}"><small>${LET[colOf(last)]}</small>${last}</div><div class="recent" aria-label="Recent numbers">${recent}</div></div><div class="board" role="group" aria-label="Numbers called, 75 numbers">${board}</div></div><div>${wins ? `<div class="wins">${wins}</div>` : ""}<div class="foot">Join: ${esc(location.host)}/z?e=${esc(EID)}</div></div>`;
  }

  $app.addEventListener("click", async (ev) => { // the screen is redrawn every few seconds, so one listener on the page handles the voice button
    const t = ev.target && ev.target.closest ? ev.target.closest("#bigvoice") : null; if (!t || !window.TBAudio) return;
    VOICE.on = !VOICE.on; TBAudio.enabled = VOICE.on;
    if (VOICE.on) { await TBAudio.unlock(); TBAudio.say("Voice is on. The numbers will be said from this screen.", ""); }
    draw();
  });
  if (!EID) { $app.innerHTML = `<p class="msg">No game was chosen.</p>`; return; }
  const loop = async () => { await tick(); draw(); };
  loop(); setInterval(loop, 3000);
  setInterval(() => { if (S.info && !(S.logs[S.round] || []).length) draw(); }, 1000); // the countdown ticks every second
})();
