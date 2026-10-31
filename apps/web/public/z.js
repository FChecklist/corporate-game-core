/* Corporate Bingo, phone page for zero-server games. All game logic lives in zgame.js (window.ZG); this file only draws it. */
(function () {
  const ZG = window.ZG;
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const LAST = "cb-last-eid";
  const DEMO = window.__CB_DEMO || null; // the free demo (demo.html) runs this same page with a preloaded script and nothing stored on our side
  let EID = DEMO ? DEMO.eid : (q.get("e") || location.hash.replace(/^#/, "") || "").trim();
  if (!DEMO) try { if (EID) localStorage.setItem(LAST, EID); else EID = localStorage.getItem(LAST) || ""; } catch {} // the installed app opens without the link: use the last game
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = DEMO ? DEMO.store : { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const rawApi = DEMO ? DEMO.api : async (method, path, body) => {
    let r;
    try { r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new Error("offline"); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = Object.assign(new Error(j.error || "http " + r.status), { status: r.status, code: j.code, body: j }); if (window.CTG) CTG.wrap(err, { what: method + " " + path.split("?")[0].replace(/\/[A-Za-z0-9_-]{6,}(?=\/|$)/g, "/...") }); throw err; }
    return j;
  };
  // ---------- what the game's public settings say besides the plan: the brand strip, a cancelled game; and a personal invite link's token ----------
  const TOKEN = (q.get("t") || "").trim().slice(0, 80); // a personal link: sent as `token` when joining, so no mobile number is needed
  const INFO = { brand: null, cancelled: null, dns: false, joinPhone: false }; // dns = "this game did not start": nobody paid, the time passed, the guest data was erased
  const cleanBrand = (b) => {
    if (!b || typeof b !== "object") return null;
    const name = String(b.name == null ? "" : b.name).replace(/\s+/g, " ").trim().slice(0, 60);
    let color = String(b.color || ""); if (/^#[0-9a-f]{3}$/i.test(color)) color = "#" + color.slice(1).split("").map((c) => c + c).join("");
    if (!/^#[0-9a-f]{6}$/i.test(color)) color = "#0B5D5B";
    const logo = typeof b.logo === "string" && b.logo.length < 90000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(b.logo) ? b.logo : ""; // only a small picture that travels inside the settings: never an outside address
    if (!name && !logo) return null;
    const lin = (h) => { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(color.slice(1, 3)) + 0.7152 * lin(color.slice(3, 5)) + 0.0722 * lin(color.slice(5, 7));
    return { name, color, logo, fg: (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : "#111111" }; // whichever of white and near-black reads better on the colour
  };
  const noteInfo = (r, fromJoin) => {
    if (!r || typeof r !== "object") return;
    if ("brand" in r && !(fromJoin && INFO.brand)) { INFO.brand = cleanBrand(r.brand); if (!DEMO && EID && INFO.brand && INFO.brand.logo !== undefined) { try { store.set("cbz:" + EID + ":brand", JSON.stringify(INFO.brand)); } catch { /* storage full or blocked: the strip just is not kept */ } } } // a join answer carries the brand without its logo: never let it replace the full one read from info
    if ("joinPhone" in r) INFO.joinPhone = r.joinPhone === true;
    if ("roomMode" in r) { INFO.quiet = r.roomMode === true; if (INFO.quiet && store.get("cbz-sound") === null) { sound = false; if (window.TBAudio) TBAudio.enabled = false; } } // B14: everyone is in one room and the big screen says the numbers: phones start silent unless the person turned sound on
    if ("verify" in r) { INFO.verify = r.verify === "id" || r.verify === "both" ? r.verify : "mobile"; INFO.empOnly = r.employeesOnly === true; INFO.idKind = r.idKind === "email" ? "email" : "emp"; INFO.idClean = r.idClean === true; }
    if ("rehearsal" in r) INFO.rehearsal = r.rehearsal && typeof r.rehearsal === "object" ? r.rehearsal : null; // a rehearsal: its pages carry the REHEARSAL block and, once it is over, the calm "over" page
    if (r.didNotStart === true) INFO.dns = true; else if ("startRound" in r && !fromJoin) INFO.dns = false;
    if ("cancelled" in r || "startRound" in r) INFO.cancelled = r.cancelled ? { message: String(r.message || "").slice(0, 200) } : null;
  };
  if (!DEMO && EID) { try { const kept = JSON.parse(store.get("cbz:" + EID + ":brand") || "null"); if (kept && typeof kept === "object") INFO.brand = cleanBrand(kept); } catch { /* nothing kept yet */ } } // the installed app shows the organizer's logo and name even before (or without) the network
  window.addEventListener("online", () => { if (window.__cbzOff) location.reload(); }); // back online while the page could not reach the game: open it again by itself
  let lastJoin = null; // what the server said when a join was refused: the page decides what to show from it
  const api = async (method, path, body) => {
    const isJoin = method === "POST" && /\/join$/.test(path);
    const sent = isJoin && body && typeof body === "object" ? Object.assign({}, body, TOKEN && !body.token ? { token: TOKEN } : {}, J.consent ? { consent: J.consent } : {}) : body; // the join carries the ticked K4 boxes; the server refuses it without them
    try {
      const r = await rawApi(method, path, sent);
      if (isJoin) { lastJoin = null; noteInfo(r, true); } else if (method === "GET" && /\/info$/.test(path)) noteInfo(r);
      return r;
    } catch (e) { if (isJoin) lastJoin = { status: e && e.status, code: (e && e.code) || (e && e.body && e.body.code) || "", body: (e && e.body) || {}, message: String((e && e.message) || "") }; throw e; }
  };
  const INVITE_FROM = Number(q.get("from")) || 0, INVITE_CAT = q.get("c") || "";
  const NAMES = {};
  // house names and "how to win" come from the one shared table (ZG.PRIZE_HOUSES)
  ZG.PRIZE_HOUSES.forEach((h) => { if (!NAMES[h.id]) NAMES[h.id] = h.label; });
  const HOW = Object.fromEntries(ZG.PRIZE_HOUSES.map((h) => [h.id, h.how]));
  const howLine = (key) => (HOW[key] ? `<small class="zsmall zhow" style="margin:0">${esc(HOW[key])}</small>` : "");
  const getPublic = DEMO ? DEMO.getPublic : async (url) => { let r; try { r = await fetch(url, { cache: "no-store" }); } catch { throw new Error("offline"); } if (!r.ok) throw Object.assign(new Error("http " + r.status), { status: r.status }); return r.json(); };
  const CLAIM_BTN = /[?&]claim=1(?:&|$)/.test(location.search); // the golden Claim button: off by default
  const rt = new ZG.PhoneRuntime(EID, DEMO ? { api, getPublic, beacon: DEMO.beacon, verify: DEMO.verify, mono: DEMO.mono, store } : { api, getPublic, beacon: {}, mono: () => performance.now(), store });
  let lastLen = 0, firstPaint = true, sound = store.get("cbz-sound") !== "off", timer = null;
  if (window.TBAudio) TBAudio.enabled = sound;
  const clock = (s) => { s = Math.max(0, Math.round(s)); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":"); }; // 00:12:34
  const GRACE_SECS = ZG.GRACE_ROUNDS * 3;
  const fmt = (s) => (s >= 90 ? Math.round(s / 60) + " min" : s + "s");

  // ---------- the company strip at the top of the card page (colour and name set by the organizer; the small picture travels inside the settings) ----------
  const brandStrip = (sndBtn) => {
    const b = INFO.brand; if (!b) return `<div class="zbar"><div class="zbrand zdef" data-bg="#0B5D5B" data-fg="#ffffff"><b>CORPORATE BINGO</b></div>${sndBtn || ""}</div>`; // no company brand set: the card carries our own name in writing
    return `<div class="zbar"><div class="zbrand" data-bg="${esc(b.color)}" data-fg="${esc(b.fg)}">${b.logo ? `<img class="zblogo" alt="" src="${esc(b.logo)}">` : ""}${b.name ? `<b>${esc(b.name)}</b>` : ""}</div>${sndBtn || ""}</div><div class="zpow">Powered by Corporate Bingo</div>`;
  };
  const paintBrand = () => document.querySelectorAll(".zbrand").forEach((el) => { if (!el.classList.contains("zdef")) el.style.background = el.dataset.bg; el.style.color = el.dataset.fg; }); // set from the script, so a strict style policy never blocks the colour

  // ---------- joining: a personal link needs no number; a number may be asked for; a request may have to wait to be let in; a person may have been removed ----------
  const J = { k4: {}, consent: null, mode: "", phone: "", emp: "", name: "", wid: "", who: "", timer: null, polling: false, note: "" };
  const inviteOf = () => (INVITE_FROM ? { from: INVITE_FROM, cat: INVITE_CAT } : undefined);
  // What the organizer asked people to give to get in: the usual way (name, and a mobile number if the organizer asked), an employee ID, or a mobile number and an employee ID. Employees only: no way in without the ID.
  const joinWho = (personal, needPhone) => {
    const ek = INFO.idKind === "email", IDN = ek ? "Email ID" : "employee ID", vm = INFO.verify || "mobile", eo = !!INFO.empOnly, pv = esc(J.phone || ""), ev = esc(J.emp || "");
    const phone = (label, hint) => `<label for="ph">${label}</label><input id="ph" inputmode="tel" autocomplete="tel" placeholder="+1 555 010 0100" value="${pv}">${hint ? `<p class="zsmall" style="margin:2px 0 6px">${hint}</p>` : ""}`;
    const emp = (label, hint) => `<label for="emp">${label}</label><input id="emp" autocomplete="off" ${ek ? `inputmode="email" autocapitalize="none" maxlength="254"` : `autocapitalize="characters" maxlength="60"`} value="${ev}"><p class="zsmall" id="empHint" aria-live="polite" style="margin:2px 0 0"></p>${hint ? `<p class="zsmall" style="margin:2px 0 6px">${hint}</p>` : ""}`;
    if (personal) return "";
    if (vm === "id") return emp(`Your ${IDN}`, eo ? "This game is for employees only." : "") + (eo ? "" : phone(`No ${IDN}? Type your mobile number instead`, "Vendors, customers and families use their mobile number."));
    if (vm === "both") return phone("Your mobile number", "") + emp(eo ? `Your ${IDN}` : `Your ${IDN} (employees only)`, eo ? "This game is for employees only." : "Not an employee? Leave this empty.");
    return needPhone ? phone("Your mobile number", "") : "";
  };
  // the same cleaning the server does (NFKC, upper case, only A-Z and 0-9), shown while typing
  document.addEventListener("input", (ev) => { const t = ev.target; if (!t || t.id !== "emp") return; const em = INFO.idKind === "email", v = String(t.value || "").normalize("NFKC"), h = document.getElementById("empHint"); let c = ""; if (em) c = v.replace(/[\s\u0085\u200B-\u200D\u2028\u2029\u2060\uFEFF]/g, "").toLowerCase(); else if (INFO.idClean && v.indexOf("@") < 0) c = v.toUpperCase().replace(/[^A-Z0-9]/g, ""); /* an e-mail typed in an employee-ID game, or a game made before the new rule, gets no "read this as" line: the server refuses it or reads it the old way */ if (h) h.textContent = !em && INFO.idClean && c.length > 30 ? "This ID is too long. An employee ID may be up to 30 characters once cleaned." : c && c !== String(t.value).trim() ? "The system will read this as " + c : ""; });
  const BUSY_TRIES = 15;
  const joinView = (msg) => {
    if (J.mode === "removed") return `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div><div class="zcard" role="status"><h2>You are not on this game's list</h2><p class="zsmall" style="margin:0">You were removed from this game, so there is no card for you here. If you think this is a mistake, please ask the person who invited you.</p></div>`;
    if (J.mode === "gone") return `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div><div class="zcard" role="status"><h2>This link is not active any more</h2><p class="zsmall" style="margin:0">Please ask the person who invited you for a new link.</p></div>`;
    if (J.mode === "busy") return `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div><div class="zcard zwait" role="status"><h2>Many people are joining right now</h2><p style="margin:0 0 6px">Your request is safe. We are trying again for you every few seconds. Keep this page open.</p><p class="zsmall" style="margin:0">Try ${J.busyTries} of ${BUSY_TRIES}.</p></div><div class="zagain"><button class="zbtn s alt" id="again" type="button">Stop and try myself</button></div>`; // a whole office joins from one address: the server asks for a short wait, or the answer never comes: the page asks again by itself
    if (J.mode === "waiting") return `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div><div class="zcard zwait" role="status"><h2>Please wait a moment</h2><p style="margin:0 0 6px">${J.note ? esc(J.note) : `Your request to join has gone to ${J.who ? esc(J.who) : "the organizer"}.`}</p><p class="zsmall" style="margin:0">Keep this page open. As soon as you are let in, your card appears here.</p></div>`;
    if (J.mode === "declined" || J.mode === "lapsed") return `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div><div class="zcard" role="status"><h2>${J.mode === "declined" ? "Your request was not accepted" : "This request has run out"}</h2><p class="zsmall" style="margin:0 0 8px">${J.mode === "declined" ? "You are not on the list for this game. Please ask the person who invited you." : "Nobody answered in time. You can ask again."}</p>${J.mode === "lapsed" ? `<button class="zbtn s" id="again" type="button">Ask again</button>` : ""}</div>`;
    const personal = !!TOKEN && J.mode !== "needPhone"; // a personal link is made for one person: nothing to type unless the server asks
    const needPhone = J.mode === "needPhone" || INFO.joinPhone; // the organizer asked guests to give a mobile number, or the link was already opened elsewhere
    return `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div>
    <div class="zcard zform zjoin"><h2>Join the game</h2>
    <ol class="zsteps" aria-label="How to join"><li><b>1</b><span>Tick the boxes</span></li><li><b>2</b><span>${personal ? "Press the button" : "Type your name"}</span></li><li><b>3</b><span>${personal ? "Watch your card" : "Get your card"}</span></li></ol>
    <p class="zgoalline" style="margin:0 0 6px">A card fills up as numbers are called. Complete a pattern to win a prize. No need to shout Bingo: the software checks every card.</p>${INVITE_FROM ? `<div class="zbanner ok" style="margin:0 0 8px">A colleague invited you. Join with your name to get your own card.</div>` : ""}
    ${J.mode === "needPhone" ? `<div class="zbanner info" role="status" style="margin:0 0 8px">${J.note ? esc(J.note) : "This link was already opened on another phone. Please type your mobile number to get your card."}</div>` : ""}
    ${DEMO ? "" : CBConsent.html("K4")}
    ${personal ? `<p class="zsmall" style="margin:0 0 6px">Your personal link is ready. Press the button to get your card.</p>` : ""}
    ${personal ? "" : `<label for="nm">Your name</label><input id="nm" autocomplete="name" maxlength="60" value="${esc(J.name)}">`}
    ${joinWho(personal, needPhone)}
    ${msg ? `<div class="zbanner bad" role="alert">${esc(msg)}</div>` : ""}
    <button class="zbtn" id="go" ${DEMO ? "" : 'data-needs="K4" disabled aria-disabled="true"'}>Get my card</button>
    <p class="zsmall">We use your name for your card and, if you win, to hand over your prize. Your organizer sees it. Other players do not.</p>
    <p class="spriv">Players are 18 or older. Playing is free: you never pay, and no prize money is held or paid by us.</p>
    <p class="spriv"><a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a></p></div>`;
  };
  const cancelledView = () => `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div><div class="zcard" role="status"><h2>This game was cancelled</h2><p class="zsmall" style="margin:0">${esc((INFO.cancelled && INFO.cancelled.message) || "The organizer cancelled this game.")} There is nothing to do on this page. Thank you for your interest.</p></div>`;
  const dnsView = () => `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div><div class="zcard" role="status"><h2>This game did not start</h2><p class="zsmall" style="margin:0">This game did not start. Your details have been erased. There is nothing to do on this page. Thank you for your interest.</p></div>`;
  const removedView = () => `${brandStrip()}<div class="zhead"><b>Corporate Bingo</b></div><div class="zcard" role="status"><h2>You have been removed from this game</h2><p class="zsmall" style="margin:0">This phone no longer plays in this game. If you think this is a mistake, please ask the person who invited you.</p></div>`;
  // what the server's "me" answer says about this card: removed, and (for a guest invited straight by the organizer's side) whether they may invite
  const ME = { at: -Infinity, role: null, removed: false, canInvite: false, per: 0, used: 0, loaded: false };
  async function pollMe(v) {
    if (DEMO || !v.pid || performance.now() - ME.at < 90000 + (Math.floor(performance.now()) % 30000)) return;
    ME.at = performance.now();
    try {
      const r = await api("GET", `/api/z/${EID}/me?pid=${encodeURIComponent(v.pid)}`);
      ME.loaded = true; ME.removed = r.removed === true || r.state === "removed"; ME.canInvite = r.canInvite === true; ME.per = Number(r.per) || 0; ME.used = Number(r.used) || 0; ME.role = r.role || null;
      if (ME.removed) paint();
    } catch (e) {
      if (e && e.status === 404 && /not a participant/i.test(String(e.message || ""))) { ME.removed = true; paint(); } // removed before the start: the server has deleted the seat, so it no longer knows this card
      /* any other trouble: asked again later */
    }
  }
  // The waiting screen survives a reload: what the person typed and the waiting number are kept on this phone only until they are let in, declined, removed or start again.
  const WAITKEY = "cbz-wait-" + EID;
  const saveWait = () => { try { store.set(WAITKEY, JSON.stringify({ wid: J.wid, who: J.who, note: J.note, phone: J.phone, emp: J.emp, name: J.name, at: Date.now() })); } catch {} };
  const clearWait = () => { try { localStorage.removeItem(WAITKEY); } catch {} try { store.set(WAITKEY, ""); } catch {} };
  function restoreWait() {
    if (DEMO || J.mode) return;
    let w = null; try { w = JSON.parse(store.get(WAITKEY) || "null"); } catch { w = null; }
    if (!w || !w.wid || Date.now() - Number(w.at || 0) > 7 * 86400000) { clearWait(); return; }
    J.mode = "waiting"; J.wid = String(w.wid); J.who = String(w.who || ""); J.note = String(w.note || ""); J.phone = String(w.phone || ""); J.emp = String(w.emp || ""); J.name = String(w.name || "");
    waitPoll();
  }
  function waitPoll() {
    clearInterval(J.timer); J.timer = setInterval(async () => {
      if (J.mode !== "waiting" || !J.wid || J.polling) return;
      J.polling = true;
      try {
        const r = await api("GET", `/api/z/${EID}/me?wid=${encodeURIComponent(J.wid)}`);
        if (r.with) J.who = String(r.with).slice(0, 60);
        if (r.state === "admitted") { clearInterval(J.timer); await doJoin(); }
        else if (r.state === "declined" || r.state === "lapsed" || r.state === "removed") { clearInterval(J.timer); clearWait(); J.mode = r.state === "removed" ? "removed" : r.state; paint(); }
      } catch { /* the next look tries again */ }
      J.polling = false;
    }, 5000);
  }
  /** Joins with what is typed (or just the token). Shows a card, or the calm screen that fits the answer. */
  async function doJoin() {
    const ok = await rt.join(J.phone, J.name, inviteOf(), J.emp);
    if (ok) {
      J.mode = ""; clearInterval(J.timer); clearWait();
      if (TOKEN) { try { const u = new URLSearchParams(location.search); u.delete("t"); history.replaceState(null, "", location.pathname + (u.toString() ? "?" + u : "")); } catch {} } // the personal token leaves the address bar once it has done its job
      paint(); start(); return true;
    }
    const l = lastJoin || {}, b = l.body || {}, code = l.code || b.code || "";
    if (code === "did-not-start" || b.didNotStart) { INFO.dns = true; rt.error = null; clearInterval(J.timer); }
    else if (code === "removed") { J.mode = "removed"; rt.error = null; clearInterval(J.timer); }
    else if (code === "waiting" || b.waiting) { J.mode = "waiting"; J.wid = String(b.wid || J.wid || ""); J.who = String(b.with || J.who || "").slice(0, 60); J.note = String(b.error || l.message || "").slice(0, 300) || (code === "invite-full" ? "The person who invited you has used all their invitations, so your request has gone to the organizer." : ""); rt.error = null; saveWait(); waitPoll(); }
    else if (code === "declined" || b.declined) { J.mode = "declined"; rt.error = null; clearInterval(J.timer); }
    else if (code === "link-used" || b.needPhone) { J.mode = "needPhone"; J.note = ""; rt.error = null; }
    else if (code === "link-gone" || /link-gone/.test(l.message || "")) { J.mode = "gone"; rt.error = null; }
    else if ((code === "busy" || (!l.status && !code && !b.error && !b.waiting)) && (J.busyTries || 0) < BUSY_TRIES) { /* a join that timed out or lost its connection (no answer at all) is asked again by itself like a busy answer: joining is safe to repeat, the same phone gets the same card */ J.busyTries = (J.busyTries || 0) + 1; J.mode = "busy"; rt.error = null; clearTimeout(J.retry); J.retry = setTimeout(() => { if (J.mode === "busy") doJoin(); }, Math.round((4 + Math.min(26, J.busyTries * 2)) * 1000 * (0.7 + Math.random() * 0.6))); }
    else if (J.mode === "waiting" || J.mode === "busy") J.mode = ""; // let in, but the join failed another way: show the usual message
    paint(); return false;
  }

  const LET = ["B", "I", "N", "G", "O"];
  const colOf = (n) => Math.floor((n - 1) / 15);
  const lblOf = (n) => LET[colOf(n)] + " " + n; // "B 7", "G 52"
  const TAP = () => rt.cfg && rt.cfg.mark === "tap"; // tap-to-daub is only a feeling: the software always decides the winners
  const daubKey = (r, ci) => "cbz-daub:" + EID + ":" + r + ":" + ci;
  const daubs = (r, ci) => new Set(readJson(daubKey(r, ci), []));
  const freeHtml = () => (INFO.brand && INFO.brand.logo ? `<img class="zfl" alt="FREE" src="${esc(INFO.brand.logo)}">` : `<span>FREE</span>`);
  /** One 5 x 5 card with the B I N G O heads. Auto-mark: a called number is marked. Tap-to-daub: a called number is marked once the guest taps it (a button then). The FREE square is always marked. */
  const cardHtml = (t, called, label, win, round, ci) => {
    const tap = TAP(), dset = tap ? daubs(round, ci) : null;
    const heads = LET.map((l, c) => `<div class="h l${c}" aria-hidden="true">${l}</div>`).join("");
    const cells = t.flat().map((v) => {
      if (v === null) return `<div class="m free" role="img" aria-label="FREE square, already marked">${freeHtml()}</div>`;
      const isCalled = called.has(v), marked = isCalled && (!tap || dset.has(v)), w = win && win.has(v) && isCalled ? " w" : "";
      if (tap) return `<button type="button" class="c${marked ? " m" : isCalled ? " due" : ""}${w}" data-dn="${v}" data-dr="${round}" data-dc="${ci}" aria-pressed="${marked}" aria-label="${lblOf(v)}${isCalled ? (marked ? ", marked" : ", called, tap to mark") : ", not called yet"}">${v}</button>`;
      return `<div class="c${marked ? " m" : ""}${marked && NEWCALL === v ? " pop" : ""}${w}" aria-label="${lblOf(v)}${marked ? ", marked" : ""}">${v}</div>`;
    }).join("");
    return `<div class="zticket" role="group" aria-label="${label}">${heads}${cells}</div>`;
  };
  const ordinalName = (k) => ["", "1st", "2nd", "3rd"][k] || k + "th";
  const KEYNAME = (key) => NAMES[key] || key;

  function roundCards(v) {
    let out = "";
    if (v.intermission) out += `<div class="zcard zbreak" role="status"><h2>Round ${v.round} is over</h2><div style="font:700 20px var(--sans,inherit);margin:2px 0 4px">Round ${v.intermission.round} of ${v.rounds} starts in ${v.intermission.secondsLeft}s</div><div class="zsmall" style="margin:0">Everyone gets new cards and a fresh set of numbers.</div></div>`;
    const earlier = (v.past || []).filter((p) => p.got.length);
    if (earlier.length) out += `<div class="zcard"><h2>Earlier rounds</h2>${earlier.map((p) => `<div class="zrow"><span>Round ${p.round}</span><em>${p.got.map((g) => esc((g.ordinal > 1 ? ordinalName(g.ordinal) + " " : "") + KEYNAME(g.pattern))).join(", ")}</em></div>`).join("")}</div>`;
    return out;
  }
  // A scratch card is the same fair draw as a lucky draw (the winners are fixed by the public numbers before anyone scratches); only the reveal differs.
  const scratched = new Set(), seenAt = {};
  function luckyCard(v) {
    if (!v.lucky.length) return "";
    const scr = v.lucky.some((l) => l.style === "scratch");
    const rows = v.lucky.map((l) => {
      let right;
      if (!l.published) right = `<i>at the end of the break</i>`;
      else if (l.style === "scratch") {
        seenAt[l.ordinal] = seenAt[l.ordinal] || Date.now();
        const open = scratched.has(l.ordinal) || Date.now() - seenAt[l.ordinal] > 45000; // it opens by itself after 45 seconds
        right = open ? (l.won ? `<em>You won!</em>` : `<i>Not this time</i>`) : `<button class="zscratch" data-scr="${l.ordinal}" aria-label="Scratch to reveal">Scratch here</button>`;
      } else right = l.won ? `<em>You won!</em>` : `<i>Not this time</i>`;
      return `<div class="zrow"><span>${esc(l.title)}<br><small class="zsmall" style="margin:0">${l.winners} ${l.winners === 1 ? "person is" : "people are"} picked at random${l.style === "scratch" ? " · scratch card" : ""}</small></span>${right}</div>`;
    }).join("");
    return `<div class="zcard"><h2>${scr ? "Scratch card" : "Lucky draw"}</h2>${rows}</div>`;
  }
  function icsFor(v) {
    const ms = (1692803367 + (v.scheduledRound - 1) * 3) * 1000, f = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const text = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Corporate Bingo//EN", "BEGIN:VEVENT", "UID:" + EID + "@corporate-bingo", "DTSTAMP:" + f(Date.now()), "DTSTART:" + f(ms), "DTEND:" + f(ms + 45 * 60000), "SUMMARY:Corporate Bingo game", "DESCRIPTION:Open " + location.origin + "/z?e=" + EID + " a few minutes early.", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(text);
  }
  /** Before the first number: what to expect, what can be won, a sound check and a calendar entry. Everything here is known at boot, so it costs no extra requests. */
  function waitingRoom(v) {
    if (v.phase !== "play" || v.locked || v.late || v.log.length || v.nextCallInSec === null || v.nextCallInSec <= 0 || v.round > 1) return "";
    if (DEMO) return DEMO.running ? `<div class="zcard zwait"><h2>Starting in <span id="cd">${Math.max(0, v.nextCallInSec)}</span> seconds</h2><p class="zsmall" style="margin:0">Watch your card below: each number is marked for you.</p></div>` : "";
    const ms = (1692803367 + (v.scheduledRound - 1) * 3) * 1000;
    const when = new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const prizes = ZG.keysInPlay(v.cfg.rewards).map((key) => ZG.linesFor(v.cfg.rewards, key).map((line) => `<li>${esc((ZG.linesFor(v.cfg.rewards, key).length > 1 ? ordinalName(line.ordinal) + " " : "") + KEYNAME(key))}${line.text ? ": <b>" + esc(line.text) + "</b>" : ""}<br>${howLine(key)}</li>`).join("")).join("");
    const toFirst = v.nextCallInSec, setup = toFirst <= GRACE_SECS;
    const top = setup
      ? `<h2>Your game is setting up</h2><div class="zsetup">We are waiting 2 minutes more for everyone to join.</div><div class="zcount" aria-live="off" id="cd">${clock(toFirst)}</div><p class="zsmall" style="margin-top:0">until the first number. Keep this page open: the numbers appear on their own.</p>`
      : `<h2>You are in. See you at ${esc(when)}</h2><div class="zsmall" style="margin:0">Starting in</div><div class="zcount" aria-live="off" id="cd">${clock(toFirst - GRACE_SECS)}</div><p class="zsmall" style="margin-top:0">hours : minutes : seconds. Keep this page open: the numbers appear on their own.</p>`;
    return `<div class="zcard zwait">${top}
      <div class="zdo"><b>What to do:</b> nothing yet. Keep this page open. ${TAP() ? "When a number is called, tap it on your card." : "Your card marks every number for you."}<br>Tip: switch on Do Not Disturb so calls and chats do not interrupt your game.</div>
      ${prizes ? `<h3>What you can win</h3><ul class="zlist">${prizes}</ul>` : ""}
      <h3>How it works</h3><ol class="zlist"><li>Your card is below: 5 x 5 with the letters B I N G O, and FREE in the middle. Numbers are called one by one as a letter and a number, like G 52.</li><li>When your card completes a prize pattern you will see it. The software checks every card, so you do not need to shout Bingo.</li><li>The organizer hands over the rewards.</li></ol>
      <button class="zbtn s alt" id="soundtest">Check my sound</button><a class="zbtn s alt" id="addcal" download="game.ics" href="${icsFor(v)}">Add to my calendar</a></div>`;
  }

  // ---------- winners: a prize record that stays on this phone, the hurray, the final thank-you ----------
  const prizeKey = "cbz-prizes:" + EID;
  const readJson = (k, d) => { try { const v = JSON.parse(store.get(k) || ""); return v || d; } catch { return d; } };
  const winId = (w) => w.round + ":" + w.pattern + ":" + w.ordinal;
  const lineName = (cfg, key, ordinal) => (ZG.linesFor(cfg.rewards, key).length > 1 ? ordinalName(ordinal) + " " : "") + KEYNAME(key);
  let PRIZES = [];
  const celebrated = new Set();
  function syncPrizes(v) {
    const have = readJson(prizeKey, []), ids = new Set(have.map(winId)), fresh = [];
    const add = (w) => { if (!ids.has(winId(w))) { ids.add(winId(w)); have.push(w); if (!celebrated.has(winId(w))) fresh.push(w); celebrated.add(winId(w)); } };
    for (const w of v.won) add({ round: w.round, pattern: w.pattern, ordinal: w.ordinal, text: w.text, name: lineName(v.cfg, w.pattern, w.ordinal) });
    for (const l of v.lucky) if (l.won) add({ round: 1, pattern: "lucky", ordinal: l.ordinal, text: l.title, name: l.title });
    if (fresh.length) store.set(prizeKey, JSON.stringify(have));
    PRIZES = have;
    return fresh;
  }
  function confetti(canvas) {
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = (canvas.width = innerWidth), H = (canvas.height = innerHeight), cols = ["#FFB703", "#0A857A", "#E4572E", "#1565D8", "#D6246B", "#7B3FE4"];
    const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, r: 4 + Math.random() * 6, c: cols[(Math.random() * cols.length) | 0], vy: 2 + Math.random() * 3.5, vx: -1.5 + Math.random() * 3, a: Math.random() * 6.28, va: -0.2 + Math.random() * 0.4 }));
    const t0 = performance.now();
    (function f(t) {
      ctx.clearRect(0, 0, W, H);
      for (const q of ps) { q.x += q.vx; q.y += q.vy; q.a += q.va; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a); ctx.fillStyle = q.c; ctx.fillRect(-q.r / 2, -q.r / 2, q.r, q.r * 1.6); ctx.restore(); }
      if (t - t0 < 6000 && canvas.isConnected) requestAnimationFrame(f); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }
  function showHurray(list) {
    const old = document.getElementById("hurray"); if (old) old.remove();
    const box = document.createElement("div"); box.id = "hurray"; box.className = "zhurray"; box.setAttribute("role", "alertdialog"); box.setAttribute("aria-live", "assertive");
    const what = list.map((w) => esc(w.name)).join(", ");
    const prize = list.filter((w) => w.text).map((w) => `<div class="zhp">${esc(w.text)}</div>`).join("");
    box.innerHTML = `<canvas class="zconf" aria-hidden="true"></canvas><div class="zhcard"><div class="zhbig">Hurray!</div><div class="zhsub">Congratulations, you won</div><div class="zhwhat">${what}</div>${list.length === 1 && HOW[list[0].pattern] ? `<div class="zhsub">${esc(HOW[list[0].pattern])}</div>` : ""}${prize}<button class="zbtn" id="hurok">Wonderful</button></div>`;
    document.body.appendChild(box);
    const done = () => { if (box.isConnected) box.remove(); };
    box.querySelector("#hurok").onclick = done; setTimeout(done, 15000);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) confetti(box.querySelector("canvas"));
    try { navigator.vibrate && navigator.vibrate([200, 100, 200, 100, 400]); } catch {}
    if (sound && window.TBAudio) TBAudio.say("Congratulations! You won " + list.map((w) => w.name).join(", ") + "!");
  }
  // ---------- tell our store that the game is over for this phone, once (tiny): the end-of-game clock relies on it. Winners are reported by the game code itself, and only count when several phones agree.
  const overKey = "cbz-over:" + EID;
  let overPending = false;
  async function reportToStore(v) {
    if (!v.pid || DEMO) return;
    try {
      if (v.phase === "ended" && !store.get(overKey) && !overPending) {
        overPending = true; // spread over a little time so a big crowd does not ask at the same second
        setTimeout(async () => { try { await api("POST", `/api/z/${EID}/over`, { pid: v.pid, device: myDevice() }); store.set(overKey, "1"); } catch { /* tried again later */ } overPending = false; }, Math.floor(Math.random() * 45000));
      }
    } catch { /* never in the way of the game */ }
  }
  // ---------- after the game, a winner confirms the name the prize goes to (the organizer and co-host see any change, with the original) ----------
  const CF = { loaded: false, loading: false, name: "", phone: "", confirmed: false, editing: false, edited: false, prizes: [], note: "", last: 0, busy: false };
  const myDevice = () => store.get("cbz:device") || "";
  async function loadCf(v) {
    if (DEMO || v.phase !== "ended" || !PRIZES.length || !v.pid || CF.loading || (CF.loaded && CF.confirmed) || Date.now() - CF.last < 15000) return;
    CF.last = Date.now(); CF.loading = true;
    try {
      const r = await api("GET", `/api/z/${EID}/myprizes?pid=${encodeURIComponent(v.pid)}&device=${encodeURIComponent(myDevice())}`);
      CF.prizes = r.prizes || []; if (!CF.edited) { CF.name = r.name || ""; CF.phone = r.phone || ""; } CF.confirmed = !!r.confirmed; CF.loaded = CF.prizes.length > 0;
    } catch { /* tried again shortly */ }
    CF.loading = false;
  }
  function confirmCard(v) {
    if (DEMO || v.phase !== "ended" || !PRIZES.length) return "";
    if (!CF.loaded) return `<div class="zcard"><h2>Confirm where your prize goes</h2><p class="zsmall">Waiting for your result to be confirmed by the other phones. This takes a moment.</p></div>`;
    if (CF.confirmed && !CF.editing) return `<div class="zcard"><h2>Details confirmed</h2><p style="margin:4px 0"><b>${esc(CF.name)}</b> &middot; ${esc(CF.phone)}</p><p class="zsmall">Your organizer has these details. <button class="zsnd" id="cfedit">Change</button></p></div>`;
    return `<div class="zcard zform"><h2>Confirm your prize details</h2>
      <p class="zsmall" style="margin:0 0 6px">Your organizer will use this name to hand over your prize. Please check them and correct anything that is wrong. If you change them, your organizer and co-host will see both what you joined with and what you changed it to.</p>
      <label for="cfnm">Your name</label><input id="cfnm" autocomplete="name" maxlength="60" value="${esc(CF.name)}">
      <label for="cfph">Your mobile number (optional)</label><input id="cfph" inputmode="tel" autocomplete="tel" value="${esc(CF.phone)}">
      ${CF.note ? `<div class="zbanner ${CF.note.startsWith("Thank") ? "ok" : "bad"}" role="alert">${esc(CF.note)}</div>` : ""}
      <button class="zbtn" id="cfgo"${CF.busy ? " disabled" : ""}>Confirm</button></div>`;
  }
  function bindConfirm(v) {
    const nm = document.getElementById("cfnm"), ph = document.getElementById("cfph"), go = document.getElementById("cfgo"), ed = document.getElementById("cfedit");
    if (ed) ed.onclick = () => { CF.editing = true; CF.note = ""; paint(); };
    if (nm) nm.oninput = () => { CF.name = nm.value; CF.edited = true; };
    if (ph) ph.oninput = () => { CF.phone = ph.value; CF.edited = true; };
    if (go) go.onclick = async () => {
      CF.busy = true; CF.note = ""; paint();
      try { const r = await api("POST", `/api/z/${EID}/confirm`, { pid: v.pid, device: myDevice(), name: CF.name, phone: CF.phone }); CF.confirmed = true; CF.editing = false; CF.edited = false; CF.note = ""; CF.last = 0; }
      catch (e) { CF.note = (e && e.message) || "Could not save. Please try again."; }
      CF.busy = false; paint();
    };
  }
  function prizesCard() {
    if (!PRIZES.length) return "";
    const rows = PRIZES.slice().sort((a, b) => a.round - b.round).map((w) => `<div class="zrow"><span>${esc(w.name)}${w.text ? `<br><small class="zsmall" style="margin:0">${esc(w.text)}</small>` : ""}${HOW[w.pattern] ? "<br>" + howLine(w.pattern) : ""}</span><em>${w.pattern === "lucky" ? "Lucky draw" : "Round " + w.round}</em></div>`).join("");
    return `<div class="zcard zprizes"><h2>Your prizes</h2>${rows}<p class="zsmall" style="margin:6px 0 0">Saved on this phone. Show this to your organizer to collect.</p></div>`;
  }
  let shareLink = location.origin + "/";
  try { localStorage.removeItem("cbz-phone"); } catch {} // older versions saved the participant's own number on the phone: it is not kept any more
  function demoCard(v) {
    if (!DEMO || v.phase === "ended") return "";
    if (!DEMO.running) return `<div class="zcard zdemo" role="note"><h2>Video <span class="zdemotag">VIDEO</span></h2><p class="zsmall" style="margin:0 0 10px">This is a real card and a real game, about a minute long: 3 numbers, a short break with your host's message, 3 more numbers, and you win <b>Four corners</b> (the four corner squares of your card). Turn your sound on, then press the button.</p><button class="zbtn" id="drun" type="button">Run Demo</button> <button class="zbtn s alt" id="dcopy" type="button">Copy the demo link to send to a colleague</button></div>`;
    return `<div class="zcard zdemo" role="note"><span class="zdemotag">VIDEO</span> <span class="zsmall">A sample game is running. Nothing is saved and nothing is charged.</span> <button class="zbtn s alt" id="dagain" type="button">Run the video again</button></div>`;
  }
  function bindDemo() {
    if (!DEMO) return;
    for (const id of ["drun", "dagain", "dagain2"]) { const b = document.getElementById(id); if (b) b.onclick = () => DEMO.run(); }
    for (const id of ["dcopy", "dcopy2"]) { const b = document.getElementById(id); if (b) b.onclick = async () => { const link = location.origin + "/demo.html"; try { await navigator.clipboard.writeText(link); b.textContent = "Link copied: " + link; } catch { b.textContent = "Send this link: " + link; } }; } // the plain address: whoever opens it runs their own demo
  }
  function finalCard(v) {
    if (DEMO) return `<div class="zcard zfinal"><h2>That was the video <span class="zdemotag">VIDEO</span></h2><div class="zfbig">${PRIZES.length ? "You won Four corners." : "You saw how a game runs."}</div><p class="zsmall" style="font-size:15px;margin:6px 0 10px">A real game calls 75 numbers, has many prizes, your own brand messages and videos, lucky draws and a report. You build it in about five minutes and nobody pays until you are ready.</p><a class="zbtn" style="display:inline-flex;align-items:center;text-decoration:none" href="/">Create my game</a> <button class="zbtn s alt" id="dagain2" type="button">Run the video again</button> <button class="zbtn s alt" id="dcopy2" type="button">Copy the demo link</button></div>`;
    const n = PRIZES.length;
    return `<div class="zcard zfinal"><h2>Game complete</h2>
      <div class="zmedal" aria-hidden="true">${n ? "&#127942;" : "&#127922;"}</div>
      <div class="zfbig">${n ? "You won " + n + (n === 1 ? " prize!" : " prizes!") : "Well played!"}</div>
      <p class="zsmall zthanks">Thank you for joining our extended family of Corporate Bingo.</p>
      <p class="zsmall" style="font-size:15px;margin:6px 0 10px">${n ? "Your prizes are listed below and stay on this phone. Show them to your organizer to collect." : "No prize this time. Every game is a good game, and the next one is another chance."}</p>
</div>`;
  }
  function bindShare() {
    const b = document.getElementById("shr"); if (!b) return;
    b.onclick = async () => {
      const data = { title: "Corporate Bingo", text: "I just played Corporate Bingo with my team. Bring it to your company:", url: shareLink };
      try { if (navigator.share) { await navigator.share(data); return; } } catch { return; }
      try { await navigator.clipboard.writeText(data.text + " " + data.url); b.textContent = "Link copied"; } catch { b.textContent = shareLink; }
    };
  }

  // ---------- break media plays inside the page (YouTube, video and audio files); anything else stays a link ----------
  const mediaHost = document.createElement("div");
  mediaHost.id = "cbmedia"; mediaHost.style.cssText = "position:absolute;z-index:30;display:none;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.3)";
  document.body.appendChild(mediaHost);
  let mediaKey = "";
  const ytId = (u) => { const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/.exec(u || ""); return m ? m[1] : null; };
  const mediaKind = (b) => {
    if (!b || !b.mediaUrl) return null;
    if (ytId(b.mediaUrl)) return "yt";
    if (b.kind === "youtube") return null;
    if (/\.(mp4|webm|m4v|mov|ogv)([?#]|$)/i.test(b.mediaUrl)) return "video";
    if (/\.(mp3|m4a|aac|wav|ogg|oga)([?#]|$)/i.test(b.mediaUrl)) return "audio";
    return null;
  };
  function soundButton(onTap) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = "Tap for sound";
    b.style.cssText = "position:absolute;right:8px;bottom:8px;z-index:2;background:#FFC93C;color:#1b1b1b;border:0;border-radius:8px;padding:6px 12px;font:700 13px system-ui,sans-serif";
    b.onclick = () => { try { onTap(); } catch {} b.remove(); };
    mediaHost.appendChild(b);
  }
  function startMedia(b, kind) {
    const elapsed = Math.max(0, Math.min((b.seconds || 0) - (b.secondsLeft || 0), 3600));
    if (kind === "yt") {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), canSound = !ios && navigator.userActivation && navigator.userActivation.hasBeenActive;
      const f = document.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + ytId(b.mediaUrl) + "?autoplay=1&mute=" + (canSound ? 0 : 1) + "&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&start=" + Math.round(elapsed) + "&origin=" + encodeURIComponent(location.origin);
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.title = b.title; f.setAttribute("allowfullscreen", ""); f.referrerPolicy = "strict-origin-when-cross-origin";
      f.style.cssText = "width:100%;height:100%;border:0"; mediaHost.appendChild(f);
      if (!canSound) soundButton(() => f.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "https://www.youtube-nocookie.com"));
      return;
    }
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.src = b.mediaUrl; el.controls = true; el.autoplay = true; el.setAttribute("playsinline", ""); el.preload = "auto";
    el.style.cssText = kind === "video" ? "width:100%;height:100%;background:#000" : "position:absolute;left:8px;right:8px;top:50%;transform:translateY(-50%);width:calc(100% - 16px)";
    if (kind === "audio") { mediaHost.style.background = "#0B5D5B"; const t = document.createElement("div"); t.textContent = b.title; t.style.cssText = "position:absolute;left:0;right:0;top:18%;text-align:center;color:#fff;font:700 18px system-ui,sans-serif;padding:0 12px"; mediaHost.appendChild(t); } else mediaHost.style.background = "#000";
    el.addEventListener("loadedmetadata", () => { try { if (elapsed && el.duration > elapsed + 1) el.currentTime = elapsed; } catch {} });
    mediaHost.appendChild(el);
    const p = typeof el.play === "function" ? el.play() : null; if (p && p.catch) p.catch(() => { el.muted = true; const q = el.play(); if (q && q.catch) q.catch(() => {}); soundButton(() => { el.muted = false; }); });
  }
  function placeMedia() {
    if (!mediaKey) return;
    const slot = document.getElementById("mslot");
    if (!slot) { mediaHost.style.display = "none"; return; }
    const r = slot.getBoundingClientRect();
    mediaHost.style.display = "block"; mediaHost.style.left = r.left + scrollX + "px"; mediaHost.style.top = r.top + scrollY + "px"; mediaHost.style.width = r.width + "px"; mediaHost.style.height = r.height + "px";
  }
  function syncMedia(v) {
    const b = slotNow(v), kind = b ? mediaKind(b) : null, key = b && kind ? b.title + "|" + b.mediaUrl : "";
    if (key !== mediaKey) {
      mediaHost.textContent = ""; mediaHost.style.display = "none"; mediaHost.style.background = "#000"; mediaKey = key;
      if (key) startMedia(b, kind);
    }
    placeMedia();
  }
  addEventListener("resize", placeMedia);

  /** Joined after the first number: what that means, then the countdown to this phone's own first number. */
  function lateCard(v) {
    const l = v.late; if (!l) return "";
    if (l.secondsUntil > 0) return `<div class="zcard zbreak" role="status"><h2>You joined after the game began</h2><div class="zsetup">Numbers called before you joined are gone, and prizes already awarded stay awarded.</div><div class="zcount" aria-live="off">${clock(l.secondsUntil)}</div><p class="zsmall" style="margin:0">until your numbers start. Your card is ready below.</p></div>`;
    return `<div class="zcard"><div class="zsmall" style="margin:0">You joined after the game began, so you play from your first number. ${l.hidden} number${l.hidden === 1 ? " was" : "s were"} called before you.</div></div>`;
  }
  // ---------- invite your colleagues / family members (when the organizer allows it) ----------
  let inviteCat = "", inviteInfo = null, inviteAt = -Infinity;
  const seatOf = (pid) => { const m = /^(\d+)x/.exec(pid || ""); return m ? Number(m[1]) : 0; };
  async function loadInvites(v) {
    if (!v.pid || !(v.cfg.invites && v.cfg.invites.on) || performance.now() - inviteAt < 45000) return;
    inviteAt = performance.now();
    try { inviteInfo = await api("GET", `/api/z/${EID}/invites?pid=${encodeURIComponent(v.pid)}`); } catch { /* shown next time */ }
  }
  const inviteLink = (v) => `${location.origin}/z.html?e=${encodeURIComponent(EID)}&from=${seatOf(v.pid)}${inviteCat ? "&c=" + encodeURIComponent(inviteCat) : ""}`;
  function inviteCard(v) {
    const iv = v.cfg.invites;
    if (!iv || !iv.on || !seatOf(v.pid)) return "";
    if (inviteInfo && inviteInfo.canInvite === false) return ""; // invited by a participant: plays, but has no invite link (two levels only)
    const cats = (ZG.INVITE_CATEGORIES || []).filter((c) => iv.cats.includes(c.id));
    if (!cats.length) return "";
    if (!inviteCat || !cats.some((c) => c.id === inviteCat)) inviteCat = cats[0].id;
    const used = inviteInfo ? inviteInfo.used : 0, unl = inviteInfo && inviteInfo.unlimited, left = Math.max(0, iv.per - used);
    const counter = unl ? "You can invite as many people as you like." : `You can invite up to <b>${iv.per}</b> people. You have invited <b>${used}</b>${left ? `, so <b>${left}</b> ${left === 1 ? "invitation is" : "invitations are"} left` : ". You have used all your invitations"}.`;
    const chips = cats.map((c) => `<button type="button" class="zchip${c.id === inviteCat ? " on" : ""}" data-icat="${esc(c.id)}">${esc(c.label)}</button>`).join("");
    const link = inviteLink(v), kind = (cats.find((c) => c.id === inviteCat) || cats[0]).label.toLowerCase();
    const text = "Join me for Corporate Bingo! Open this link, enter your name and you get your own card: " + link;
    return `<div class="zcard zinvite"><h2>Invite your colleagues / family members</h2>
      <p class="zsmall" style="margin:0 0 8px">${counter}</p>
      ${!unl && !left ? "" : `<div class="zsmall" style="margin:0 0 4px">Who are you inviting?</div><div class="zchips">${chips}</div>
      <div class="zlink" id="invlink" style="margin-top:8px">${esc(link)}</div>
      <button class="zbtn s" id="invshare">Share invitation (${esc(kind)})</button>
      <a class="zbtn s alt" style="display:inline-flex;align-items:center;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
      <button class="zbtn s alt" id="invcopy">Copy link</button>
      <p class="zsmall" style="margin:8px 0 0">Your guest joins with their own name and gets their own card. ${unl ? "" : `Your link stops working after ${iv.per} people have joined through it.`}</p>`}</div>`;
  }
  function bindInvite(v) {
    document.querySelectorAll("[data-icat]").forEach((b) => (b.onclick = () => { inviteCat = b.dataset.icat; paint(); }));
    const sh = document.getElementById("invshare"); if (sh) sh.onclick = async () => { const data = { title: "Corporate Bingo", text: "Join me for Corporate Bingo! Open this link, enter your name and you get your own card:", url: inviteLink(v) }; try { if (navigator.share) { await navigator.share(data); return; } } catch { return; } try { await navigator.clipboard.writeText(data.text + " " + data.url); sh.textContent = "Link copied"; } catch { sh.textContent = data.url; } };
    const cp = document.getElementById("invcopy"); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(inviteLink(v)); cp.textContent = "Copied"; } catch { cp.textContent = "Press and hold the link above to copy"; } };
  }
  // ---------- My invites: for a guest who may invite (level 1) only. Their own small list: add, send on WhatsApp, resend, remove. A guest invited by a guest sees nothing. ----------
  const MI = { k6: {}, people: [], limit: 0, used: 0, loaded: false, at: -Infinity, busy: false, note: "", bad: false, ask: "", name: "", phone: "" };
  const miQ = (v) => `?me=${encodeURIComponent(v.pid)}&device=${encodeURIComponent(myDevice())}`; // the card id is public: the people calls also carry the phone's own device id
  async function loadMine(v, force) {
    if (DEMO || !ME.canInvite || !v.pid || MI.busy) return;
    if (!force && performance.now() - MI.at < 60000) return;
    MI.at = performance.now();
    try {
      const r = await api("GET", `/api/z/${EID}/people${miQ(v)}`);
      MI.people = Array.isArray(r.people) ? r.people : []; MI.limit = Number(r.limit) || 0; MI.used = Number(r.used) || 0; MI.loaded = true;
      if (force) paint();
    } catch (e) { if (e && e.status === 403) { ME.canInvite = false; paint(); } } // the organizer switched invitations off, or this guest may not invite
  }
  const waOk = (u) => (typeof u === "string" && /^https:\/\/wa\.me\//.test(u) ? u : "");
  function mineCard(v) {
    if (DEMO || !ME.canInvite) return "";
    const left = Math.max(0, MI.limit - MI.used);
    const counter = !MI.loaded ? "Getting your list…" : MI.limit ? `You can invite up to <b>${MI.limit}</b> people. You have invited <b>${MI.used}</b>${left ? `, so <b>${left}</b> ${left === 1 ? "place is" : "places are"} left` : ". You have used all your places"}.` : "";
    const started = v.log.length > 0 || !!v.late || v.phase === "ended"; // a guest can take a name off their list only before the game starts
    const rows = MI.people.map((p) => {
      const wa = waOk(p.waLink), gone = p.status === "removed";
      return `<div class="zrow zmi"><span>${esc(p.name || "Guest")}<br><small class="zsmall" style="margin:0">${esc(p.maskedPhone || "")} · ${gone ? "Removed" : p.status === "joined" ? "Joined" : "Invited"}</small></span>
        <span class="zmia">${!gone && p.status !== "joined" && wa ? `<a class="zbtn s" target="_blank" rel="noopener" href="${esc(wa)}" style="text-decoration:none;display:inline-flex;align-items:center">Send on WhatsApp</a>` : ""}
        ${!gone && p.status !== "joined" ? `<button class="zbtn s alt" type="button" data-mire="${esc(p.id)}">Send a new link</button>` : ""}
        ${!gone && !started ? (MI.ask === p.id ? `<button class="zbtn s" type="button" data-miyes="${esc(p.id)}">Yes, remove</button><button class="zbtn s alt" type="button" data-mino="1">No</button>` : `<button class="zbtn s alt" type="button" data-mirm="${esc(p.id)}">Remove</button>`) : ""}</span></div>`;
    }).join("");
    return `<div class="zcard zinvite" id="mine"><h2>My invites</h2><p class="zsmall" style="margin:0 0 8px">${counter}</p>${rows}
      ${MI.loaded && !left && MI.limit ? "" : `<div class="zform"><label for="mi-name">Name</label><input id="mi-name" autocomplete="off" maxlength="60" value="${esc(MI.name)}"><label for="mi-phone">Mobile number</label><input id="mi-phone" inputmode="tel" autocomplete="off" value="${esc(MI.phone)}" placeholder="98765 43210">${CBConsent.html("K6")}<button class="zbtn s" id="mi-add" type="button" data-needs="K6" disabled aria-disabled="true"${MI.busy ? ' data-hold="1"' : ""}>Add to my invites</button></div>`}
      ${MI.note ? `<div class="zbanner ${MI.bad ? "bad" : "ok"}" role="status" style="margin-top:8px">${esc(MI.note)}</div>` : ""}</div>`;
  }
  function bindMine(v) {
    if (!document.getElementById("mine")) return;
    const nm = document.getElementById("mi-name"), ph = document.getElementById("mi-phone"), add = document.getElementById("mi-add");
    if (nm) nm.oninput = () => { MI.name = nm.value; };
    if (ph) ph.oninput = () => { MI.phone = ph.value; };
    const act = async (fn, okNote) => {
      MI.busy = true; MI.note = ""; MI.bad = false; paint();
      try { await fn(); MI.note = okNote || ""; } catch (e) { MI.bad = true; MI.note = (e && e.status !== 0 && e.message && !/^http \d+$|^offline$/.test(e.message) ? e.message : "Could not do that. Please try again."); }
      MI.busy = false; await loadMine(v, true); paint();
    };
    if (add) CBConsent.wire(document, "K6", MI.k6); // the person who adds a name and number ticks that they may use them
    if (add) add.onclick = () => {
      const name = (nm.value || "").trim(), phone = (ph.value || "").trim();
      if (!CBConsent.all(document, "K6")) { MI.bad = true; MI.note = "Please tick the box to continue."; return paint(); }
      const consent = CBConsent.payload(document, "K6");
      if (name.length < 2) { MI.bad = true; MI.note = "Please type their name."; return paint(); }
      if (phone.replace(/\D/g, "").length < 10) { MI.bad = true; MI.note = "Please type their mobile number."; return paint(); }
      act(async () => {
        const r = await api("POST", `/api/z/${EID}/people${miQ(v)}`, { people: [{ name, phone }], me: v.pid, consent });
        if (r.invalid && r.invalid.length) throw new Error("That number does not look right. Please check it.");
        if (r.duplicates) throw new Error("That number is already invited.");
        MI.name = ""; MI.phone = "";
      }, "Added. Press Send on WhatsApp next to their name.");
    };
    document.querySelectorAll("[data-mire]").forEach((b) => (b.onclick = () => act(async () => { await api("POST", `/api/z/${EID}/people/${encodeURIComponent(b.dataset.mire)}/resend${miQ(v)}`, { me: v.pid }); }, "A new link is ready. Press Send on WhatsApp.")));
    document.querySelectorAll("[data-mirm]").forEach((b) => (b.onclick = () => { MI.ask = b.dataset.mirm; paint(); }));
    document.querySelectorAll("[data-mino]").forEach((b) => (b.onclick = () => { MI.ask = ""; paint(); }));
    document.querySelectorAll("[data-miyes]").forEach((b) => (b.onclick = () => { const id = b.dataset.miyes; MI.ask = ""; act(async () => { await api("POST", `/api/z/${EID}/people/${encodeURIComponent(id)}/remove${miQ(v)}`, { me: v.pid }); }, "Removed. Your place is free again."); }));
  }
  function mediaAct(b) {
    const inPage = !!mediaKind(b);
    return b.mediaUrl ? (inPage ? `<div id="mslot" class="zmslot"></div><a class="zsmall" target="_blank" rel="noopener noreferrer" href="${esc(b.mediaUrl)}">Trouble playing? Open it in a new tab</a>` : `<a class="zbtn s" style="display:inline-flex;align-items:center;text-decoration:none;margin-top:10px" target="_blank" rel="noopener noreferrer" href="${esc(b.mediaUrl)}">${b.kind === "youtube" ? "Watch the video" : "Open"}</a>`) : "";
  }
  // ---------- the OPENING plays while everyone waits for the first number; the CLOSING plays on the final screen ----------
  let closingIdx = 0;
  function openingNow(v) {
    const list = (v.cfg && v.cfg.opening) || [];
    if (!list.length || v.phase !== "play" || v.locked || v.stopped || v.paused || v.late || v.brk || v.log.length > 0 || v.nextCallInSec === null || v.nextCallInSec > GRACE_SECS) return null;
    const elapsed = GRACE_SECS - v.nextCallInSec; let from = 0; // the openings follow one another inside the 2 minutes before the first number
    for (const o of list) { const len = o.seconds || 60; if (elapsed < from + len) return Object.assign({}, o, { seconds: len, secondsLeft: Math.max(1, Math.round(from + len - elapsed)) }); from += len; }
    return null;
  }
  function closingNow(v) {
    const list = (v.cfg && v.cfg.closing) || [];
    if (!list.length || v.phase !== "ended") return null;
    const i = Math.min(closingIdx, list.length - 1);
    return Object.assign({}, list[i], { seconds: 0, secondsLeft: 0, n: i + 1, of: list.length });
  }
  const slotNow = (v) => v.brk || openingNow(v) || closingNow(v);
  const slotWhat = (b) => (b.kind === "speech" ? "Please listen to the host." : b.kind === "slides" ? "Please look at the screen." : "");
  function openingCard(v) {
    const b = openingNow(v); if (!b) return "";
    return `<div class="zcard zbreak" role="status"><h2>A message from your organizer</h2><div style="font:700 20px var(--sans,inherit);margin:2px 0 4px">${esc(b.title)}</div><div class="zsmall" style="margin:0">${slotWhat(b)} The game starts in a moment.</div>${mediaAct(b)}</div>`;
  }
  function closingCard(v) {
    const b = closingNow(v); if (!b) return "";
    return `<div class="zcard zbreak" role="status"><h2>Thank you from your organizer</h2><div style="font:700 20px var(--sans,inherit);margin:2px 0 4px">${esc(b.title)}</div><div class="zsmall" style="margin:0">${slotWhat(b)}</div>${mediaAct(b)}${b.n < b.of ? `<button class="zbtn s alt" id="cnext" type="button" style="margin-top:10px">Next message (${b.n} of ${b.of})</button>` : ""}</div>`;
  }
  function breakCard(b) {
    const act = mediaAct(b);
    const what = b.kind === "lucky" ? `${b.winners || 3} ${b.winners === 1 ? "person is" : "people are"} picked at random when this break ends. Everyone has an equal chance.` : b.kind === "speech" ? "Please listen to the host." : b.kind === "slides" ? "Please look at the screen." : "";
    return `<div class="zcard zbreak" role="status"><h2>A short break</h2><div style="font:700 20px var(--sans,inherit);margin:2px 0 4px">${esc(b.title)}</div><div class="zsmall" style="margin:0">${what} The numbers continue in ${b.secondsLeft}s.</div>${act}</div>`;
  }

  function stillToWinRows(v) {
    const keys = ZG.keysInPlay(v.cfg.rewards);
    return keys.map((key) => {
      const lines = ZG.linesFor(v.cfg.rewards, key);
      const n = ZG.stillToWin(v.tickets, key, v.log);
      const mine = v.myIdx[key];
      return lines.map((line) => {
        const total = lines.length;
        const name = (total > 1 ? ordinalName(line.ordinal) + " " : "") + KEYNAME(key);
        const res = v.results.find((r) => r.pattern === key && r.ordinal === line.ordinal);
        let right;
        if (res) right = (res.winners || []).includes(v.pid) ? `<em>Yours${res.tied > 1 ? " · same number as another card" : ""}</em>` : `<i>Awarded</i>`;
        else if (line.ordinal === 1) right = mine >= 0 ? `<em>Complete</em>` : n >= 99 ? `<i>not possible on your card</i>` : `<i>${n} to go</i>`;
        else right = `<i>after the ${ordinalName(line.ordinal - 1)}</i>`;
        return `<div class="zrow"><span>${esc(name)}${line.text ? `<br><small class="zsmall" style="margin:0">${esc(line.text)}</small>` : ""}<br>${howLine(key)}</span>${right}</div>`;
      }).join("");
    }).join("");
  }

  let annSeen = null, annSpoken = null;
  function annBanner(v) {
    const a = v.announcement;
    if (!a || a.id === annSeen) return "";
    return `<div class="zbanner info zann" role="alert"><b>Message from the organizer</b><br>${esc(a.text)} <button class="zsnd" id="annok">OK</button></div>`;
  }
  /** Tap-to-daub only: a gentle reminder when called numbers on the card are still unmarked. It changes nothing: the software already knows the truth. */
  function missedNudge(v, called) {
    const miss = []; v.tickets.forEach((t, i) => { const d = daubs(v.round, i); for (const n of t.flat()) if (n !== null && called.has(n) && !d.has(n) && !miss.includes(n)) miss.push(n); });
    if (!miss.length) return "";
    const shown = miss.slice(-3).map(lblOf).join(", ");
    return `<p class="zsmall znudge" role="status" style="margin:0 0 8px">You missed ${esc(shown)}${miss.length > 3 ? " and " + (miss.length - 3) + " more" : ""}. Tap ${miss.length === 1 ? "it" : "them"} to mark. Your prizes never depend on this: the software checks every card.</p>`;
  }
  /** The ranking: 1st, 2nd, 3rd ... and the top-10 list (prize order, then call number, then fate). One winner per prize line, so there is never a shared prize. */
  function rankCard(v) {
    const sett = (v.results || []).filter((r) => r.pattern !== "lucky" && r.winners && r.winners.length).map((r) => ({ pattern: r.pattern, ordinal: r.ordinal, idx: r.idx, pids: r.winners, round: v.round, tied: r.tied }));
    if (!sett.length) return "";
    const rows = ZG.rankWinners(ZG.roundEid(EID, v.round), v.cfg, sett, 10);
    const li = rows.map((x) => `<li><b>${esc(ZG.rankName(x.rank))}</b> ${esc(lineName(v.cfg, x.pattern, x.ordinal))}${x.text ? " (" + esc(x.text) + ")" : ""}: card ${esc(String(seatOf(x.pid)))}${x.pid === v.pid ? " <em>(you)</em>" : ""}${x.note ? `<br><small class="zsmall" style="margin:0">${esc(x.note)}</small>` : ""}</li>`).join("");
    return `<div class="zcard zrank"><h2>Winners</h2><ol class="zlist" style="padding-left:0;list-style:none">${li}</ol></div>`;
  }
  // ---------- short, friendly movement (about 200 to 400 ms; none with "reduce motion"). Each one plays once, when the thing it shows first appears (the page redraws itself every second). ----------
  const MOTION = () => { try { return !matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const COUNTS = {};
  const countUps = () => document.querySelectorAll("[data-count]").forEach((el) => {
    const key = el.dataset.ck || el.id || "c", to = Number(el.dataset.count), from = COUNTS[key] === undefined ? to : COUNTS[key]; COUNTS[key] = to;
    if (from === to || !MOTION()) { el.textContent = String(to); return; }
    const t0 = performance.now(); (function f(t) { const k = Math.min(1, (t - t0) / 350); el.textContent = String(Math.round(from + (to - from) * k)); if (k < 1 && el.isConnected) requestAnimationFrame(f); })(t0);
  });
  let NEWCALL = 0; // the number called since the last redraw (0 = none): its ball drops in and its place on the card is stamped
  /** the big ball, a state chip, one plain line about what to do, and the last numbers as small balls */
  function callCard(v, last, recent, sub) {
    const secs = v.nextCallInSec, running = v.phase === "play" && !v.locked && !v.paused && !v.brk && !v.intermission && v.log.length > 0;
    const tone = v.phase === "ended" ? "end" : v.paused || v.locked ? "pause" : running ? (secs !== null && secs <= 3 ? "go" : "soon") : "wait";
    const chip = v.phase === "ended" ? "Game over" : v.paused ? "Paused" : v.locked ? "Waiting to start" : !v.log.length ? "Get ready" : running && secs !== null ? "Next number in " + secs + "s" : "Numbers coming";
    const what = v.phase === "ended" ? "" : TAP() ? "Tap a number on your card when it is called." : "Your card marks every number for you.";
    const total = v.late ? "since you joined" : "of 75";
    return `<div class="zcard zcall"><div class="zchiprow"><span class="zchip2 ${tone}">${esc(chip)}</span><span class="zchip2 plain"><b data-count="${v.log.length}" data-ck="called">${v.log.length}</b>&nbsp;${total} called</span></div>
        <div class="zball"><div class="zbig ${last ? "l" + colOf(last) : "none"}${NEWCALL && NEWCALL === last ? " pop" : ""}" id="big" role="status" aria-live="assertive" aria-label="${last ? "Number " + lblOf(last) : "No number yet"}">${last ? `<small>${LET[colOf(last)]}</small><span>${last}</span>` : "–"}</div></div>
        <div class="zsub">${sub}</div>${what ? `<p class="zsmall zwhat">${esc(what)}</p>` : ""}
        <div class="zlast" aria-label="Last numbers called">${recent.map((n, i) => `<span class="l${colOf(n)}${NEWCALL && i === 0 ? " pop" : ""}" aria-label="${lblOf(n)}"><i>${LET[colOf(n)]}</i>${n}</span>`).join("")}</div></div>`;
  }
  function playView(v) {
    const called = new Set(v.log);
    const last = v.log[v.log.length - 1];
    const banners = [];
    if (v.error) banners.push(`<div class="zbanner warn" role="alert">${esc(v.error)}</div>`);
    if (INFO.quiet && !sound && v.phase === "play") banners.push(`<div class="zbanner info" role="status">This game is played in one room. The big screen says each number, so your phone stays silent. You can switch your sound on at the top.</div>`);
    { const away = v.phase === "play" ? awayBanner(v) : ""; if (away) banners.push(away); }
    if (v.locked) banners.push(ME.role === "organizer" || ME.role === "host" ? `<div class="zbanner warn" role="status"><b>Payment pending for this game.</b> The game starts 2 minutes after the payment is confirmed. Open your console to pay. Your card is safe. Keep this page open.</div>` : `<div class="zbanner warn" role="status"><b>Waiting for the Organizer or Host to start the game.</b> Your card is safe. Keep this page open: it begins as soon as they are done.</div>`);
    else if (v.stopped) banners.push(`<div class="zbanner info">The organizer has ended this game.</div>`);
    else if (v.paused) banners.push(`<div class="zbanner info" role="status">Game paused by the ${v.pausedBy === "host" ? "Host" : "organizer"}${v.pausedFromRound ? " at " + esc(new Date((1692803367 + (v.pausedFromRound - 1) * 3) * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })) : ""}. It restarts soon. Your card is safe.</div>`);
    else if (v.mode === "hold" && v.nowRound !== null) banners.push(`<div class="zbanner warn" role="status">Your connection looks slow. Your card is safe. Numbers carry on as soon as it is back.</div>`); // B08: this is the phone's own network, not the organizer
    else if (v.mode === "blind") banners.push(`<div class="zbanner warn" role="status">Your phone cannot check for a pause right now (a slow connection?). Play continues; a pause may appear late. Your card is safe.</div>`);
    if (v.phase === "ended" && !v.stopped && !v.endedByPrizes) banners.push(`<div class="zbanner ok">${v.rounds > 1 ? "All " + v.rounds + " rounds are finished." : "All 75 numbers have been called."} Thank you for taking part.</div>`);
    const sub = v.phase === "ended" || v.locked || v.brk || v.intermission || (DEMO && !DEMO.running) ? "" : v.late && v.late.secondsUntil > 0 ? "Your numbers start in " + clock(v.late.secondsUntil) : v.log.length === 0 ? (v.nextCallInSec !== null ? (v.nextCallInSec > GRACE_SECS ? "Starting in " + clock(v.nextCallInSec - GRACE_SECS) : "First number in " + clock(v.nextCallInSec)) : "Getting ready…") : v.paused || v.mode === "hold" ? "" : v.nextCallInSec !== null ? "Next number in " + v.nextCallInSec + "s" : "";
    const still = v.tickets.length ? stillToWinRows(v) : "";
    const chk = v.pendingChecks > 0 ? `<p class="zsmall">Double-checking ${v.pendingChecks} earlier number${v.pendingChecks === 1 ? "" : "s"} in the background.</p>` : "";
    const curWins = v.won.filter((w) => w.round === v.round), winSet = new Set(curWins.flatMap((w) => w.cells));
    const ribbon = curWins.length ? `<div class="zwin" role="status">&#127881; Congratulations! You won ${curWins.map((w) => esc(lineName(v.cfg, w.pattern, w.ordinal))).join(", ")}${curWins.some((w) => w.text) ? " &middot; " + curWins.filter((w) => w.text).map((w) => esc(w.text)).join(", ") : ""}</div>` : "";
    // golden Claim button (off unless the page has ?claim=1): a mirror, same word as the common engine (Claim); auto-claim still works without it
    const wonKeys = new Set(v.won.filter((w) => w.round === v.round).map((w) => w.pattern));
    const claimBtn = CLAIM_BTN && v.phase !== "ended" && Object.keys(v.myIdx || {}).some((k) => v.myIdx[k] >= 0 && !wonKeys.has(k)) ? `<p><button class="zbtn zgold" id="zclaim">Claim</button></p>` : "";
    const tix = v.tickets.map((t, i) => (v.tickets.length > 1 ? `<div class="zsmall" style="margin:${i ? 12 : 0}px 0 4px"><b>Card ${"AB"[i]}</b></div>` : "") + cardHtml(t, called, v.tickets.length > 1 ? "Card " + "AB"[i] : DEMO ? "Video card" : "Your card", winSet, v.round, i)).join("");
    const recent = v.log.slice(-6, -1).reverse(), nudge = TAP() ? missedNudge(v, called) : "";
    const sndBtn = `<button class="zsnd zsndin" id="snd" aria-pressed="${sound}">${sound ? "&#128266; Sound on" : "&#128263; Sound off"}</button>`;
    return `${brandStrip(sndBtn)}
      ${demoCard(v)}${annBanner(v)}${banners.join("")}
      ${v.phase === "ended" ? finalCard(v) + closingCard(v) + confirmCard(v) + prizesCard() : ""}
      ${waitingRoom(v)}
      ${openingCard(v)}
      ${lateCard(v)}
      ${roundCards(v)}
      ${v.brk ? breakCard(v.brk) : ""}
      ${rankCard(v)}
      ${callCard(v, last, recent, sub)}
      <div class="zcard${curWins.length ? " zwon" : ""}"><h2>${DEMO ? 'Video card <span class="zdemotag">VIDEO</span>' : v.tickets.length > 1 ? "Your cards" : "Your card"}${TAP() ? ' <span class="zmode">tap to mark</span>' : ""}</h2>${ribbon}${claimBtn}${nudge}${tix}<ol class="zsmall zrules" aria-label="How this game works" style="margin:10px 0 0;padding-left:20px"><li>${TAP() ? "When a number is called, tap it on your card." : "Your card marks every number for you."}</li><li>The software checks every card. You do not shout Bingo or press anything.</li><li>Complete a prize pattern and the prize is yours. Your organizer hands it over.</li></ol></div>
      ${v.phase === "ended" ? "" : prizesCard()}
      ${mineCard(v)}${inviteCard(v)}
      <div class="zcard"><h2>Still to win</h2>${still}${chk}</div>
      ${luckyCard(v)}
      <div class="zcard"><h2>${v.rounds > 1 ? "Round " + v.round + " of " + v.rounds + " · " : ""}${v.late ? "Numbers since you joined · " + v.log.length : "Numbers called · " + v.log.length + " of 75"} called</h2><div class="zboard" role="group" aria-label="Numbers called, 75 numbers">${LET.map((l, c) => `<div class="bl l${c}" aria-hidden="true">${l}</div>` + Array.from({ length: 15 }, (_, i) => { const n = c * 15 + i + 1; return `<div class="${called.has(n) ? "c" : ""}" aria-label="${lblOf(n)}${called.has(n) ? ", called" : ""}">${n}</div>`; }).join("")).join("")}</div></div>`;
  }

  /** REHEARSAL: the same block at the top of every page of a rehearsal (Game ID, REHEARSAL GAME n, the sentence), and the calm page when it is over. */
  function showRehearsalBanner() {
    let el = document.getElementById("rehbanner"); const R = INFO.rehearsal;
    if (!R) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "rehbanner"; el.setAttribute("role", "status"); el.style.cssText = "background:#b3261e;color:#fff;padding:10px 14px;text-align:center;line-height:1.35;position:sticky;top:0;z-index:40"; document.body.insertBefore(el, document.body.firstChild); }
    if (el.dataset.t !== R.block) { el.dataset.t = R.block; const ln = String(R.block).split("\n"); el.innerHTML = `<div>${esc(ln[0] || "")}</div><div style="font-size:1.25rem;font-weight:900">${esc(ln[1] || "")}</div><div style="font-weight:700">${esc(ln.slice(2).join(" "))}</div>`; }
  }
  const rehearsalOverHtml = () => `<div class="zcard" id="rehover"><h2>This rehearsal is over.</h2><p>Thank you for practising.</p>${INFO.rehearsal && INFO.rehearsal.realId ? `<p><a class="zbtn zgold" href="/z.html?e=${encodeURIComponent(INFO.rehearsal.realId)}" id="realgame">Open the real game</a></p>` : ""}</div>`;
  function paint() {
    const v = rt.view();
    showRehearsalBanner();
    if (INFO.rehearsal && INFO.rehearsal.over) { $app.innerHTML = rehearsalOverHtml(); return; } // an ended rehearsal: nothing else is shown, the real game's link is offered
    if (window.ctzView) window.ctzView(v); // the flight recorder (blackbox.js) learns which stage the game is in
    if (!v.won) v.won = []; // an older saved copy of the game code during an update: never break the screen
    if (INFO.dns) { if (timer) { clearInterval(timer); timer = null; } clearInterval(J.timer); mediaHost.style.display = "none"; $app.innerHTML = dnsView(); window.__cbzOff = v.phase === "boot"; paintBrand(); return; } // a game that did not start: one calm screen, nobody can join or pay
    if (v.phase === "missing" || v.phase === "boot") { $app.innerHTML = (INFO.brand || v.phase === "boot" ? brandStrip() : "") + `<p class="zmsg">${esc(v.phase === "boot" && !navigator.onLine ? "No connection right now. Your card is safe on this phone. This page opens the game by itself when you are back online." : v.error || "Loading…")}</p>`; paintBrand(); return; }
    if (INFO.cancelled) { if (timer) { clearInterval(timer); timer = null; } clearInterval(J.timer); mediaHost.style.display = "none"; $app.innerHTML = cancelledView(); paintBrand(); return; } // a cancelled game: one calm screen, nothing else
    if (v.phase === "join") { const f = document.getElementById("ph") || document.getElementById("nm"); if (f && document.activeElement === f) return; $app.innerHTML = joinView(J.mode ? null : v.error); paintBrand(); bindJoin(); return; }
    if (ME.removed) { if (timer) { clearInterval(timer); timer = null; } mediaHost.style.display = "none"; $app.innerHTML = removedView(); paintBrand(); return; } // taken off the list: the phone stops
    const fresh = syncPrizes(v); reportToStore(v); loadCf(v); pollMe(v);
    { const af = document.activeElement; if (af && (af.id === "cfnm" || af.id === "cfph" || af.id === "mi-name" || af.id === "mi-phone")) return; } // never wipe a form someone is typing in
    NEWCALL = v.log.length > lastLen && !firstPaint && MOTION() ? v.log[v.log.length - 1] : 0;
    $app.innerHTML = playView(v);
    countUps();
    paintBrand(); syncMedia(v); bindShare(); bindDemo(); bindConfirm(v); loadInvites(v); bindInvite(v); loadMine(v); bindMine(v);
    if (fresh.length) showHurray(fresh);
    document.querySelectorAll("button[data-dn]").forEach((b) => (b.onclick = () => { const n = Number(b.dataset.dn), r = Number(b.dataset.dr), ci = Number(b.dataset.dc), d = daubs(r, ci); if (!v.log.includes(n)) return; if (d.has(n)) d.delete(n); else d.add(n); store.set(daubKey(r, ci), JSON.stringify([...d])); paint(); }));
    const cl = document.getElementById("zclaim");
    if (cl) cl.onclick = () => { cl.disabled = true; cl.textContent = "Checking…"; rt.claimNow(); };
    const s = document.getElementById("snd");
    if (s) s.onclick = async () => { sound = !sound; store.set("cbz-sound", sound ? "on" : "off"); if (window.TBAudio) { TBAudio.enabled = sound; if (sound) await TBAudio.unlock(); } paint(); };
    if (v.log.length > lastLen) { if (!firstPaint && v.log.length === lastLen + 1 && sound && window.TBAudio) TBAudio.play(v.log[v.log.length - 1]); lastLen = v.log.length; }
    firstPaint = false;
    if (v.phase === "ended" && wake && !wake.released) { try { wake.release(); } catch { /* already let go */ } wake = null; } // the screen may sleep again once the game is over
    const cn = document.getElementById("cnext"); if (cn) cn.onclick = () => { closingIdx += 1; paint(); };
    const ok = document.getElementById("annok"); if (ok) ok.onclick = () => { annSeen = v.announcement.id; paint(); };
    if (v.announcement && v.announcement.id !== annSpoken) { annSpoken = v.announcement.id; if (sound && window.TBAudio) TBAudio.say(v.announcement.text); try { navigator.vibrate && navigator.vibrate(120); } catch {} }
    document.querySelectorAll("[data-scr]").forEach((b) => (b.onclick = () => { scratched.add(Number(b.dataset.scr)); paint(); }));
    const st = document.getElementById("soundtest"); if (st) st.onclick = async () => { if (window.TBAudio) { TBAudio.enabled = true; await TBAudio.unlock(); TBAudio.test(); } };
  }
  function bindJoin() {
    const again = document.getElementById("again"); if (again) again.onclick = () => { clearTimeout(J.retry); J.busyTries = 0; J.mode = ""; J.wid = ""; clearWait(); paint(); };
    const go = document.getElementById("go"); if (!go) return;
    if (!DEMO) CBConsent.wire(document, "K4", J.k4); // never ticked in advance; the button stays off until both boxes are ticked
    go.onclick = async () => {
      if (!DEMO && !CBConsent.all(document, "K4")) return;
      J.consent = DEMO ? null : CBConsent.payload(document, "K4");
      go.disabled = true;
      if (window.TBAudio) TBAudio.unlock();
      const ph = document.getElementById("ph"), nm = document.getElementById("nm"), em = document.getElementById("emp");
      J.phone = ph ? ph.value : J.phone; J.emp = em ? em.value.trim() : J.emp; J.name = nm ? nm.value.trim() : J.name;
      await doJoin(); // shows the card screen at once on success: the first tick may take a few seconds on a slow network
    };
  }
  let rehTick = 0;
  async function loop() { try { await rt.tick(); } catch { /* the loop must never die */ } if (INFO.rehearsal && !INFO.rehearsal.over && ++rehTick % 15 === 0) { try { await api("GET", `/api/z/${EID}/info`); } catch { /* next time */ } } paint(); }
  // B15: the screen stays on while the game plays, and a person who comes back after the phone was locked or another app was in front is told what they missed
  let wake = null, hiddenAt = 0, hiddenLen = 0, AWAY = null;
  async function keepAwake() { try { if (DEMO || !navigator.wakeLock || document.hidden || (wake && !wake.released)) return; wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } catch { /* not allowed on this phone: the game still plays */ } }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); hiddenLen = lastLen; return; }
    if (hiddenAt && Date.now() - hiddenAt > 15000) AWAY = { from: hiddenLen, settleAt: Date.now() + 2500, k: null }; // away for more than 15 seconds
    hiddenAt = 0; keepAwake();
  });
  function awayBanner(v) {
    if (!AWAY) return "";
    if (Date.now() < AWAY.settleAt) return ""; // the phone is still catching up with the numbers
    if (AWAY.k === null) { AWAY.k = Math.max(0, v.log.length - AWAY.from); AWAY.until = Date.now() + 15000; }
    if (Date.now() > AWAY.until || !AWAY.k) { if (Date.now() > AWAY.until) AWAY = null; return ""; }
    return `<div class="zbanner info zaway" role="status">Welcome back. You missed ${AWAY.k} number${AWAY.k === 1 ? "" : "s"}. ${TAP() ? "They are in the list below. Tap them on your card to mark them." : "They are marked on your card."}</div>`;
  }
  function start() { if (timer) return; keepAwake(); loop(); timer = setInterval(loop, 1000); }

  if (!EID) { $app.innerHTML = `<p class="zmsg">This link is incomplete. Please ask your organizer for the game link.</p>`; return; }
  rt.boot().then(() => { if (rt.phase === "play") clearWait(); else restoreWait(); paint(); if (rt.phase === "play") start(); });
  window.__rt = rt;
})();
