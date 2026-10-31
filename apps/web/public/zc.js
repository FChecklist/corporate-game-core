/* Corporate Lucky Draw, the organizer console. The six steps of every Corporate Games organizer flow:
   1 Game, 2 People, 3 Time, 4 Prizes, 5 Brand and Breaks, 6 Check and publish. After publishing the same page is the game-day page.
   Roles: Organizer (everything), Host (Draw, Pause, Resume), Co-host (helps with people). Choices are tap chips. English only. */
(function () {
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ss = { get: (k) => (window.CTK ? window.CTK.get(k) : (() => { try { return sessionStorage.getItem(k); } catch (e) { return null; } })()), set: (k, v) => { if (window.CTK) window.CTK.set(k, v); else try { sessionStorage.setItem(k, v); } catch (e) { /* kept for this page only */ } } };
  const PRIVACY = "No personal details needed. All participant information is deleted within 24 hours of the game.";
  const STEPS = ["Game", "People", "Time", "Prizes", "Brand and Breaks", "Check and publish"];
  const COLORS = ["#0B3D91", "#1B7F5C", "#B3261E", "#6A1B9A", "#C26A00", "#00798C", "#37474F", "#AD1457"];
  const LIMITS = [10, 50, 100, 500, 1000, 5000, 10000, 100000];
  const GEN = 1692803367;
  let secret = ss.get("cbz-org") || "";
  { const m = location.hash.match(/^#(?:host|cohost)=(cb[hc]_[0-9a-f]{48})$/); if (m) { secret = m[1]; ss.set("cbz-org", secret); history.replaceState(null, "", location.pathname + location.search); } }
  { const k = q.get("k"); if (k && /^cb[hca]_[0-9a-f]{48}$/.test(k)) { secret = k; ss.set("cbz-org", secret); q.delete("k"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q.toString() : "")); } }
  let eid = q.get("e") || "";
  const S = { who: null, sum: null, step: 1, f: null, note: "", err: "", busy: false, list: null, k1: {}, hostLink: "", ctl: null, ctlErr: "" };
  const api = async (method, path, body) => {
    let r;
    try { r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-organizer": secret }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw Object.assign(new Error("We could not reach the service. Check your internet and try again."), { status: 0 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = Object.assign(new Error(j.error || "Something went wrong. Please try again."), { status: r.status, code: j.code, body: j }); if (window.CTG && method !== "GET") { try { CTG.wrap(err, { what: method + " " + path.split("?")[0].replace(/\/[A-Za-z0-9_-]{6,}(?=\/|$)/g, "/...") }); } catch (e2) { /* the guide is a help */ } } throw err; }
    return j;
  };
  const roleOf = () => (S.who && S.who.kind === "cohost" ? "cohost" : S.who && S.who.kind === "host" ? "host" : "organizer");
  const isOrg = () => roleOf() === "organizer";
  const canRun = () => roleOf() !== "cohost";
  const roundOf = (ms) => Math.ceil((ms / 1000 - GEN) / 3) + 1;
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } })();
  const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const two = (n) => String(n).padStart(2, "0");
  const rid = () => "LD-" + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const chip = (on, attr, label) => `<button type="button" class="zc-chip${on ? " on" : ""}" ${attr} aria-pressed="${on ? "true" : "false"}" style="min-height:44px">${label}</button>`;
  const bar = () => `<header class="zc-bar"><span class="zc-brand"><img src="/icon-192.png" alt="" width="36" height="36"> <b class="zc-name"><i>Corporate</i> <span>Lucky Draw</span></b></span>${S.who ? `<span class="zc-pill zc-pill-role">${esc(({ organizer: "Organizer", host: "Host", cohost: "Co-host" })[roleOf()])}</span>` : ""}</header>`;
  const frame = (inner) => `<div class="zc-frame">${bar()}<div class="zc-main">${S.note ? `<div class="zc-alert" role="status"><p>${esc(S.note)}</p></div>` : ""}${S.err ? `<div class="zc-alert zc-alert-bad" role="alert"><p>${esc(S.err)}</p></div>` : ""}${inner}<p class="zc-small">${PRIVACY}</p></div></div>`;
  const fail = (e) => { S.err = e && e.message ? e.message : "Something went wrong. Please try again."; S.busy = false; if (eid && !S.sum) load().then(paint, paint); else paint(); };

  /* ---------------- sign in ---------------- */
  function signinView() {
    return frame(`<div class="zc-block"><h3>Sign in to make a Lucky Draw</h3><p>It is free to build and free to publish. You pay before the draw.</p><button class="zc-btn" id="si" style="min-height:48px">Sign in</button></div>`);
  }

  /* ---------------- home: your draws ---------------- */
  function homeView() {
    const rows = (S.list || []).map((g) => `<div class="zc-block"><h3>${esc(g.id)}</h3><p class="zc-small">${g.draft ? "Draft" : "Published"} · ${esc(g.startsAtIST || "")} · ${esc(g.participants)} registered</p><div class="zc-chips"><a class="zc-btn zc-btn-s" href="/zc.html?e=${encodeURIComponent(g.id)}" style="min-height:44px">Open</a><button class="zc-btn zc-btn-s zc-btn-alt" data-clone="${esc(g.id)}" style="min-height:44px">New draw like this one</button></div></div>`).join("");
    return frame(`<div class="zc-block"><h3>Your Lucky Draws</h3><div class="zc-chips"><button class="zc-btn" id="new" style="min-height:48px">Make a new draw</button><button class="zc-btn zc-btn-alt" id="demo" style="min-height:48px">Free demo draw (10 people)</button></div></div>${rows || `<p class="zc-small">No draws yet.</p>`}`);
  }

  /* ---------------- the six steps ---------------- */
  function formFromSum(s) {
    const d = s.draw || {};
    const t = d.drawMs || s.startMs || Date.now() + 3 * 86400000;
    const dt = new Date(t);
    return {
      name: s.name || "", idKind: s.idKind === "email" ? "email" : "emp", cap: s.limit || 100,
      day: `${dt.getFullYear()}-${two(dt.getMonth() + 1)}-${two(dt.getDate())}`, time: `${two(dt.getHours())}:${two(dt.getMinutes())}`,
      winners: d.winners || 1, prizes: (d.prizes || []).join("\n"), mode: d.mode || "auto",
      brandName: (s.brand && s.brand.name) || "", brandColor: (s.brand && s.brand.color) || COLORS[0], message: (s.opening && s.opening[0] && s.opening[0].title) || "",
      email: (S.who && S.who.email) || "", phone: "",
    };
  }
  const stepNav = () => `<nav class="zc-chips" aria-label="Steps">${STEPS.map((n, i) => chip(S.step === i + 1, `data-step="${i + 1}"`, `${i + 1} ${n}`)).join("")}</nav>`;
  const field = (id, label, val, attrs) => `<label class="zc-lbl" for="${id}">${label}</label><input class="zc-in" id="${id}" value="${esc(val)}" ${attrs || ""}>`;
  function stepBody() {
    const f = S.f;
    if (S.step === 1) return `<h3>1 Game</h3>${field("f-name", "Name of the draw", f.name, 'maxlength="60" placeholder="Annual day lucky draw"')}<span class="zc-lbl">What do people give to register?</span><div class="zc-chips">${chip(f.idKind === "emp", 'data-idk="emp"', "Employee ID")}${chip(f.idKind === "email", 'data-idk="email"', "Email ID")}</div><p class="zc-small">${f.idKind === "email" ? "Winners are told by e-mail." : "Winners see the result on the page."} One entry for each person.</p>`;
    if (S.step === 2) return `<h3>2 People</h3><span class="zc-lbl">How many people can register? (up to 100,000)</span><div class="zc-chips">${LIMITS.map((n) => chip(f.cap === n, `data-cap="${n}"`, n.toLocaleString("en-IN"))).join("")}</div>${field("f-cap", "Or type a number", f.cap, 'inputmode="numeric" maxlength="6"')}<p class="zc-small">Anyone with the link can register, once. Registration closes at draw time. Try it first: up to 10 people, no prizes.</p>${hostsBlock()}`;
    if (S.step === 3) return `<h3>3 Time</h3><div class="zc-row">${field("f-day", "Date", f.day, 'type="date"')}${field("f-time", "Time (" + esc(tz.replace(/_/g, " ")) + ")", f.time, 'type="time"')}</div><span class="zc-lbl">How does the draw start?</span><div class="zc-chips">${chip(f.mode === "auto", 'data-dmode="auto"', "Automatic at this time")}${chip(f.mode === "manual", 'data-dmode="manual"', "I press Draw")}</div><p class="zc-small">${f.mode === "auto" ? "The draw happens by itself at the published time." : "The time is published. The draw happens when the Organizer or a Host presses Draw. Registration closes then."} Pause and Resume stay with the Organizer and Host.</p>`;
    if (S.step === 4) return `<h3>4 Prizes</h3>${field("f-winners", "Number of winners", f.winners, 'inputmode="numeric" maxlength="4"')}<label class="zc-lbl" for="f-prizes">Prize for each place, one per line (1st, 2nd, 3rd...)</label><textarea class="zc-in" id="f-prizes" rows="5" maxlength="4000" placeholder="Smart watch&#10;Gift voucher&#10;Coffee mug">${esc(f.prizes)}</textarea><p class="zc-small">One entry cannot win twice. If there are fewer entries than winners, every entry wins.</p>`;
    if (S.step === 5) return `<h3>5 Brand and Breaks</h3>${field("f-bn", "Company or brand name (optional)", f.brandName, 'maxlength="40"')}<span class="zc-lbl">Brand colour</span><div class="zc-chips">${COLORS.map((c) => `<button type="button" class="zc-chip${f.brandColor === c ? " on" : ""}" data-color="${c}" aria-label="Colour ${c}" style="min-height:44px;min-width:44px"><span style="display:inline-block;width:22px;height:22px;border-radius:6px;background:${c}"></span></button>`).join("")}</div>${field("f-msg", "A short message while people wait (optional)", f.message, 'maxlength="80"')}<p class="zc-small">There are no breaks in a Lucky Draw: people register, wait, and see the result.</p>`;
    const sm = S.sum || {}, ps = f.prizes.split("\n").map((x) => x.trim()).filter(Boolean);
    return `<h3>6 Check and publish</h3><div class="zc-block"><p><b>${esc(f.name || sm.id)}</b></p><p class="zc-small">${esc(f.idKind === "email" ? "Email ID" : "Employee ID")} · up to ${Number(f.cap).toLocaleString("en-IN")} people · ${esc(f.winners)} winner${f.winners == 1 ? "" : "s"}${ps.length ? " · " + esc(ps.join(", ")) : ""} · ${f.mode === "auto" ? "automatic" : "manual draw"}</p><p class="zc-small">Draw time: ${esc(fmt(new Date(`${f.day}T${f.time}`).getTime()))}</p></div>
      ${field("f-email", "Your e-mail (the result is sent here)", f.email, 'type="email" autocomplete="email"')}${field("f-phone", "Your mobile number", f.phone, 'type="tel" inputmode="tel" autocomplete="tel"')}<div id="k1"></div>
      <button class="zc-btn" id="pub" data-needs="K1" style="min-height:48px;margin-top:10px">Publish</button><p class="zc-small">Publishing is free. The draw does not happen until it is paid for.</p>`;
  }
  function hostsBlock() {
    if (!isOrg()) return "";
    return `<div class="zc-block"><h3>Host and Co-host (optional)</h3><p class="zc-small">A Host can press Draw, Pause and Resume. A Co-host helps with people. Each gets their own link.</p>${field("f-hn", "Host name", "", 'maxlength="40"')}${field("f-he", "Host e-mail", "", 'type="email"')}<button type="button" class="zc-btn zc-btn-s" id="addhost" style="min-height:44px;margin-top:8px">Add a Host</button>${S.hostLink ? `<p class="zc-small">Send this link to your Host: <code style="word-break:break-all">${esc(S.hostLink)}</code></p>` : ""}${field("f-cn", "Co-host name", "", 'maxlength="40"')}${field("f-cp", "Co-host mobile", "", 'type="tel"')}<button type="button" class="zc-btn zc-btn-s" id="addcohost" style="min-height:44px;margin-top:8px">Add a Co-host</button>${S.coLink ? `<p class="zc-small">Send this link to your Co-host: <code style="word-break:break-all">${esc(S.coLink)}</code></p>` : ""}</div>`;
  }
  function readStep() {
    const f = S.f, v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    if (S.step === 1 && v("f-name") !== null) f.name = v("f-name").trim();
    if (S.step === 2 && v("f-cap") !== null) f.cap = Math.floor(Number(v("f-cap"))) || f.cap;
    if (S.step === 3 && v("f-day") !== null) { f.day = v("f-day"); f.time = v("f-time"); }
    if (S.step === 4 && v("f-winners") !== null) { f.winners = Math.floor(Number(v("f-winners"))) || 1; f.prizes = v("f-prizes") || ""; }
    if (S.step === 5 && v("f-bn") !== null) { f.brandName = v("f-bn").trim(); f.message = v("f-msg").trim(); }
    if (S.step === 6 && v("f-email") !== null) { f.email = v("f-email").trim(); f.phone = v("f-phone").trim(); }
  }
  async function save() { // every step saves what it holds; the first save makes the draft
    const f = S.f, startMs = new Date(`${f.day}T${f.time}`).getTime();
    if (!Number.isFinite(startMs)) throw new Error("Pick the date and time of the draw.");
    if (!eid) {
      eid = rid();
      await api("POST", "/api/z", { id: eid, startRound: roundOf(Math.max(startMs, Date.now() + 120000)), callSeconds: 12, cap: Math.max(1, Math.min(100000, f.cap)), name: f.name || undefined, verify: "id", idKind: f.idKind, whoCanJoin: "anyone" });
      history.replaceState(null, "", "/zc.html?e=" + eid);
    } else {
      await api("PATCH", `/api/z/${eid}/settings`, { startRound: roundOf(startMs), callSeconds: 12, cap: Math.max(1, Math.min(100000, f.cap)), name: f.name || "", verify: "id", idKind: f.idKind, brand: f.brandName ? { name: f.brandName, color: f.brandColor } : null, opening: f.message ? [{ kind: "speech", title: f.message }] : [] });
    }
    const prizes = f.prizes.split("\n").map((x) => x.trim()).filter(Boolean);
    await api("POST", `/api/z/${eid}/drawset`, { winners: f.winners, prizes, mode: f.mode });
  }

  /* ---------------- game day ---------------- */
  function dayView() {
    const s = S.sum, d = s.draw || {}, origin = location.origin, link = `${origin}/z.html?e=${eid}`;
    let h = `<div class="zc-block"><h3>${esc(s.name || s.id)}</h3><p>${esc(s.participants)} registered${s.limit ? " of " + Number(s.limit).toLocaleString("en-IN") : ""}. ${d.drawn ? "The draw is done." : d.closed ? "Registration is closed." : "Registration is open."}</p><p class="zc-small">Draw time: ${esc(fmt(s.startMs))} · ${d.mode === "manual" ? "manual: the Organizer or a Host presses Draw" : "automatic"}</p></div>`;
    if (s.status && /NOT PAID|payment due/.test(s.status)) h += `<div class="zc-alert"><h3>Pay before the draw</h3><p>The draw does not happen until it is paid for.</p><a class="zc-btn" href="${esc(s.payUrl || "/pay.html?e=" + eid)}" style="min-height:48px">Pay now</a></div>`;
    h += `<div class="zc-block"><h3>Share this link</h3><p><code style="word-break:break-all">${esc(link)}</code></p><button class="zc-btn zc-btn-s" id="copy" style="min-height:44px">Copy link</button></div>`;
    if (canRun() && !d.drawn) {
      h += `<div class="zc-block"><h3>Controls</h3><div class="zc-chips">${d.mode === "manual" ? `<button class="zc-btn" id="drawnow" style="min-height:48px"${d.paused ? " disabled" : ""}>Draw now</button>` : ""}${d.paused ? `<button class="zc-btn zc-btn-alt" id="resume" style="min-height:48px">Resume</button>` : `<button class="zc-btn zc-btn-alt" id="pause" style="min-height:48px">Pause</button>`}</div>${d.paused ? `<p class="zc-small"><b>Paused.</b> Nothing registers and nothing is drawn. The draw time waits.</p>` : ""}${S.ctlErr ? `<p class="zc-small">${esc(S.ctlErr)}</p>` : ""}<p class="zc-small">Only the Organizer and the Host can press Draw, Pause or Resume. Each is logged with the role.</p></div>`;
      if (roleOf() === "host" && S.hk === "waiting") h += `<div class="zc-alert"><h3>Waiting for the Organizer</h3><p>Your pause key was sent. The Organizer approves it in their console. Then Pause and Resume work for you.</p></div>`;
      if (isOrg() && S.hkKey) h += `<div class="zc-alert"><h3>A Host asks to pause and resume</h3><p>Approve the Host key. It can only Pause and Resume, and every use is logged as Host.</p><button class="zc-btn" id="hkok" style="min-height:48px">Approve Host key</button></div>`;
      if (isOrg() && !s.rehearsal && !/draft/.test(s.status || "")) h += `<div class="zc-block"><h3>Try it first</h3><p class="zc-small">A rehearsal has up to 10 people and no prizes. It does not change your real draw.</p><button class="zc-btn zc-btn-s zc-btn-alt" id="rehearse" style="min-height:44px">Start a rehearsal</button>${S.rehLink ? `<p class="zc-small">People link: <code style="word-break:break-all">${esc(S.rehLink)}</code></p>` : ""}</div>`;
    }
    if (d.drawn) h += `<div class="zc-block"><h3>Result</h3>${(d.result || []).map((w) => `<div class="zrow"><span><b>${esc(w.place)}</b> ${esc(w.who)}</span><i>${esc(w.prize)}</i></div>`).join("")}<p class="zc-small">${esc(d.entries)} entries. Beacon round ${esc(d.round)}. ${esc(d.fairness)}</p></div>`;
    h += `<div class="zc-block"><h3>Next</h3><button class="zc-btn zc-btn-s zc-btn-alt" id="cloneme" style="min-height:44px">New draw like this one</button><p class="zc-small">Copies the settings only: number of winners, prizes, automatic or manual. Never the people, the time or the result.</p><a class="zc-small" href="/zc.html">Your draws</a></div>`;
    return h;
  }

  function view() {
    if (!secret) return signinView();
    if (!S.who) return frame(`<p class="zmsg" style="margin:20px 0">Loading…</p>`);
    if (!eid) return S.f ? frame(stepNav() + `<div class="zc-block" id="stepbody">${stepBody()}</div>${navButtons()}`) : homeView();
    if (!S.sum) return frame(`<p class="zmsg" style="margin:20px 0">Loading…</p>`);
    if (S.sum.status === "draft" || S.editing) return frame(stepNav() + `<div class="zc-block" id="stepbody">${stepBody()}</div>${navButtons()}`);
    return frame(dayView());
  }
  const navButtons = () => `<div class="zc-chips" style="margin-top:10px">${S.step > 1 ? `<button class="zc-btn zc-btn-alt" id="back" style="min-height:48px">Back</button>` : ""}${S.step < 6 ? `<button class="zc-btn" id="next" style="min-height:48px">Save and continue</button>` : ""}</div>`;

  function paint() {
    $app.className = "zapp zc";
    $app.innerHTML = view();
    const $ = (id) => document.getElementById(id), on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on("si", () => { try { sessionStorage.setItem("cbz-next", "/zc.html"); } catch (e) { /* the sign-in page still returns here */ } location.href = "/#login"; });
    on("new", () => { S.f = formFromSum({}); S.step = 1; S.note = ""; S.err = ""; paint(); });
    on("demo", async () => {
      try { S.busy = true; const id = rid(), t = Date.now() + 3600000; await api("POST", "/api/z", { id, startRound: roundOf(t), callSeconds: 12, cap: 10, name: "Free demo draw", verify: "id", idKind: "emp", whoCanJoin: "anyone" }); await api("POST", `/api/z/${id}/drawset`, { winners: 1, prizes: [], mode: "manual" }); location.href = "/zc.html?e=" + id; } catch (e) { fail(e); }
    });
    document.querySelectorAll("[data-clone]").forEach((b) => (b.onclick = () => cloneGame(b.dataset.clone)));
    on("cloneme", () => cloneGame(eid));
    document.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => { readStep(); S.step = Number(b.dataset.step); S.err = ""; paint(); }));
    document.querySelectorAll("[data-idk]").forEach((b) => (b.onclick = () => { readStep(); S.f.idKind = b.dataset.idk; paint(); }));
    document.querySelectorAll("[data-cap]").forEach((b) => (b.onclick = () => { readStep(); S.f.cap = Number(b.dataset.cap); paint(); }));
    document.querySelectorAll("[data-dmode]").forEach((b) => (b.onclick = () => { readStep(); S.f.mode = b.dataset.dmode; paint(); }));
    document.querySelectorAll("[data-color]").forEach((b) => (b.onclick = () => { readStep(); S.f.brandColor = b.dataset.color; paint(); }));
    on("back", () => { readStep(); S.step -= 1; S.err = ""; paint(); });
    on("next", async () => { readStep(); if (S.busy) return; S.busy = true; S.err = ""; try { await save(); S.note = "Saved."; S.step += 1; await load(); } catch (e) { return fail(e); } S.busy = false; paint(); });
    const k1 = $("k1");
    if (k1 && window.CBConsent) { k1.innerHTML = CBConsent.html("K1"); CBConsent.wire($("app"), "K1", S.k1); }
    on("pub", async () => {
      readStep(); if (S.busy) return; S.busy = true; S.err = "";
      try {
        await save();
        try { if (window.TBControl) await TBControl.ensureKey(eid, { token: secret, base: BASE, prefix: "/api/z" }); } catch (e) { /* pause needs this key; the console says so on the day */ }
        const r = await api("POST", `/api/z/${eid}/publish`, { email: S.f.email, phone: S.f.phone, consent: CBConsent.payload($("app"), "K1") });
        S.editing = false; S.note = r.paid ? "Published. Share the link." : "Published. Pay before the draw so it can happen."; await load();
      } catch (e) { return fail(e); }
      S.busy = false; paint();
    });
    on("addhost", async () => { try { const r = await api("POST", "/api/org/host", { label: $("f-hn").value.trim() || "Host", email: $("f-he").value.trim() }); S.hostLink = r.link || ""; S.note = "Host added. Send them their link."; } catch (e) { S.err = e.message; } paint(); });
    on("addcohost", async () => { try { const r = await api("POST", "/api/org/cohost", { label: $("f-cn").value.trim(), phone: $("f-cp").value.trim(), e: eid }); S.coLink = r.link || ""; S.note = "Co-host added. Send them their link."; } catch (e) { S.err = e.message; } paint(); });
    on("copy", async () => { try { await navigator.clipboard.writeText(`${location.origin}/z.html?e=${eid}`); S.note = "Link copied."; } catch (e) { S.note = "Select the link and copy it."; } paint(); });
    on("drawnow", async () => { if (!confirm("Draw now? Registration closes and the winners are picked.")) return; try { await api("POST", `/api/z/${eid}/drawnow`, {}); S.note = "The draw is done."; try { window.CBReact && window.CBReact.react("winners_drawn"); } catch (e) { /* optional */ } await load(); } catch (e) { S.err = e.message; } paint(); });
    on("hkok", async () => { try { const r = await TBControl.hostApprove(eid, { token: secret, base: BASE, prefix: "/api/z" }, S.hkKey); if (!r.ok) throw new Error(r.reason); S.hkKey = ""; S.note = "Host key approved."; } catch (e) { S.err = e.message; } paint(); });
    on("pause", () => control("pause"));
    on("resume", () => control("resume"));
    on("rehearse", async () => { try { const r = await api("POST", `/api/z/${eid}/rehearsal`, {}); S.rehLink = r.guestUrl || ""; S.note = r.message || "Rehearsal ready."; } catch (e) { S.err = e.message; } paint(); });
  }
  async function control(action) {
    S.err = ""; S.ctlErr = "";
    try {
      const au = { token: secret, base: BASE, prefix: "/api/z" };
      const r = roleOf() === "host" ? await TBControl.hostPublish(eid, au, action) : await TBControl.publish(eid, au, action);
      if (r.status >= 400) throw new Error((r.data && r.data.error) || "Could not " + action + ".");
      try { window.CBReact && window.CBReact.react(action); } catch (e) { /* optional */ }
      S.note = action === "pause" ? "Pause sent. It starts in about 40 seconds, so every phone stops together." : "Resume sent. It starts in about 40 seconds.";
      await new Promise((ok) => setTimeout(ok, 1500)); await load();
    } catch (e) { S.err = e.message || "Could not " + action + "."; }
    paint();
  }
  async function cloneGame(from) {
    try { const r = await api("POST", `/api/z/${from}/clone`, {}); location.href = "/zc.html?e=" + r.id; } catch (e) { S.err = e.message; paint(); }
  }
  async function load() {
    if (!eid) return;
    S.sum = await api("GET", `/api/z/${eid}/summary`);
    S.f = S.f || formFromSum(S.sum);
    if (S.sum.status === "draft" && !S.fLoaded) { S.f = formFromSum(S.sum); S.fLoaded = true; }
    try { // the Host key: a Host offers theirs, the Organizer approves it
      const au = { token: secret, base: BASE, prefix: "/api/z" };
      if (window.TBControl && S.sum.status !== "draft" && !(S.sum.draw && S.sum.draw.drawn)) {
        if (roleOf() === "host") { const o = await TBControl.hostOffer(eid, au); S.hk = o.ok && !o.approved ? "waiting" : ""; }
        else if (isOrg()) S.hkKey = (await TBControl.hostWaiting(eid, au)) || "";
      }
    } catch (e) { /* the pause buttons still say what is missing */ }
    if (S.sum.startPending) { S.f.day = ""; S.f.time = ""; S.step = 3; }
  }
  async function boot() {
    paint();
    if (!secret) return;
    try { S.who = await api("GET", "/api/whoami"); }
    catch (e) { if (e.status === 401 || e.status === 403) { secret = ""; ss.set("cbz-org", ""); } else S.err = e.message; return paint(); }
    if (!S.who.email && q.get("demo") === "1") { /* host/cohost have no e-mail */ }
    try { if (!eid) { S.list = (await api("GET", "/api/history")).engagements || []; if (q.get("new") === "1" || q.get("demo") === "1") { S.f = formFromSum({}); } } else await load(); } catch (e) { S.err = e.message; }
    if (q.get("demo") === "1" && !eid) { document.getElementById("demo") && document.getElementById("demo").click(); }
    paint();
    setInterval(async () => { if (eid && S.sum && S.sum.status !== "draft" && !document.hidden && !S.busy) { try { await load(); paint(); } catch (e) { /* next time */ } } }, 15000);
  }
  boot();
})();
