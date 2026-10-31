/* Corporate Lucky Draw, the participant page. Register once, wait for the draw, see the result. "You won" opens the prize details.
   All rules live on the server (the common engine's Lucky Draw module); this file only draws them. English only, short copy. */
(function () {
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const LAST = "ld-last-eid";
  let EID = (q.get("e") || location.hash.replace(/^#/, "") || "").trim();
  try { if (EID) localStorage.setItem(LAST, EID); else EID = localStorage.getItem(LAST) || ""; } catch (e) { /* the page still works */ }
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  const TOKEN = (q.get("t") || "").trim().slice(0, 80); // a personal invitation link: sent as `token`
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* kept for this visit only */ } } };
  const PRIVACY = "No personal details needed. All participant information is deleted within 24 hours of the game.";
  const api = async (method, path, body) => {
    let r;
    try { r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw Object.assign(new Error("We could not reach the service. Check your internet and try again."), { status: 0 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = Object.assign(new Error(j.error || "Something went wrong. Please try again."), { status: r.status, code: j.code }); if (window.CTG) { try { CTG.wrap(err, { what: method + " " + path.split("?")[0].replace(/\/[A-Za-z0-9_-]{6,}(?=\/|$)/g, "/...") }); } catch (e2) { /* the guide is a help */ } } throw err; }
    return j;
  };
  const device = () => { let d = store.get("cbz:device"); if (!d || !/^[0-9a-f]{32}$/.test(d)) { d = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""); store.set("cbz:device", d); } return d; };
  const pidKey = () => "ld-pid-" + EID;
  const when = (ms) => { try { return new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return new Date(ms).toISOString(); } };
  const left = (ms) => { let s = Math.max(0, Math.round(ms / 1000)); const d = Math.floor(s / 86400); s -= d * 86400; const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60; return (d ? d + "d " : "") + (d || h ? h + "h " : "") + m + "m " + s + "s"; };
  const brandHead = (I) => { const b = I.brand; if (!b || !b.name) return ""; const c = /^#[0-9a-fA-F]{6}$/.test(b.color || "") ? b.color : "#0B3D91"; return `<div class="zbanner" style="background:${c};color:#fff;display:flex;align-items:center;gap:10px">${b.logo && /^data:image\/(png|jpeg|webp);base64,/.test(b.logo) ? `<img src="${esc(b.logo)}" alt="" style="height:28px;max-width:96px;background:#fff;border-radius:6px;padding:2px">` : ""}<span>${esc(b.name)}</span></div>`; };
  const head = (I) => `<div class="zhead"><b>Corporate Lucky Draw</b></div>${brandHead(I)}`;
  let I = null, D = null, timer = null, S = { pid: store.get("ld-pid-" + EID) || "", err: "", busy: false, won: false, prize: null, prizeDone: false, tick: 0 };

  const prizeList = (d) => { const rows = []; for (let i = 0; i < d.winners && i < 12; i++) rows.push(`<li><b>${["1st", "2nd", "3rd"][i] || i + 1 + "th"}</b>${d.prizes[i] ? " " + esc(d.prizes[i]) : ""}</li>`); return `<ul class="zlist">${rows.join("")}${d.winners > 12 ? `<li>and ${d.winners - 12} more places</li>` : ""}</ul>`; };

  function view() {
    if (!EID) return `<div class="zcard"><h2>Lucky Draw</h2><p>Open the link you were sent to join a draw.</p></div>`;
    if (!I) return `<p class="zmsg">${esc(S.err || "Loading…")}</p>`;
    const d = D;
    if (I.cancelled) return head(I) + `<div class="zbanner bad">This draw was cancelled by the organizer.</div>`;
    if (I.draft) return head(I) + `<div class="zbanner warn">This draw is not open yet. Please try again later.</div>`;
    if (!d) return head(I) + `<div class="zbanner warn">This link is not a Lucky Draw.</div>`;
    const now = Date.now() + (S.skew || 0);
    const title = esc((I.name || EID));
    let h = head(I) + `<div class="zcard"><h2>${title}</h2>`;
    if (d.rehearsal) h += `<p class="zsmall"><b>Rehearsal.</b> Up to 10 people. No prizes.</p>`;
    h += `<p><b>${d.winners}</b> winner${d.winners === 1 ? "" : "s"}. ${d.mode === "auto" ? "The draw happens by itself on " + esc(when(d.drawMs)) + "." : "The organizer presses Draw. The time is " + esc(when(d.drawMs)) + "."}</p>`;
    if (!d.rehearsal && d.prizes.some(Boolean)) h += prizeList(d);
    h += `</div>`;
    if (d.paused) h += `<div class="zbanner warn">Paused. The draw waits until the organizer or host resumes it.</div>`;
    if (d.drawn) return h + resultView(d);
    if (S.pid) {
      h += `<div class="zbanner ok">You are in the draw.</div>`;
      h += `<div class="zcard zwait"><h3>${d.paused ? "Paused" : now < d.drawMs ? "Draw in" : "Drawing now"}</h3><div class="zcount" id="cd">${d.paused ? "–" : now < d.drawMs ? left(d.drawMs - now) : "…"}</div><p class="zsmall">Keep this page open. The result appears here.</p></div>`;
    } else if (d.closed) {
      h += `<div class="zbanner bad">Registration is closed.</div>`;
    } else {
      const email = I.idKind === "email";
      h += `<form class="zcard zform" id="reg" novalidate><h2>Register once</h2>
        <label for="rid">${email ? "Your Email ID" : "Your Employee ID"}</label>
        <input id="rid" name="id" autocomplete="${email ? "email" : "off"}" inputmode="${email ? "email" : "text"}" maxlength="80" required>
        <label for="rnm">Your name (optional)</label><input id="rnm" name="name" autocomplete="name" maxlength="60">
        <div id="k4"></div>
        ${S.err ? `<div class="zbanner bad" role="alert" style="margin-top:12px">${esc(S.err)}</div>` : ""}
        <button class="zbtn" id="go" type="submit" data-needs="K4" style="min-height:48px">Register</button>
        <p class="zsmall">${PRIVACY}</p></form>`;
    }
    return h + footer();
  }
  const footer = () => `<p class="zsmall" style="text-align:center">${PRIVACY}</p>`;

  function resultView(d) {
    let h = "";
    const mine = d.mine;
    if (mine) h += `<div class="zcard" style="text-align:center"><button class="zbtn" id="won" style="background:linear-gradient(180deg,#FFD65C,#F5A000);color:#3b2600;min-height:56px;font-size:20px">You won</button><p class="zsmall">${esc(mine.place)} place${mine.prize ? ": " + esc(mine.prize) : ""}</p></div>` + (S.won ? prizeForm(mine) : "");
    else if (S.pid) h += `<div class="zbanner info">The draw is done. You were not picked this time.</div>`;
    else h += `<div class="zbanner info">The draw is done.</div>`;
    h += `<div class="zcard"><h2>Winners</h2>${(d.result || []).map((w) => `<div class="zrow"><span><b>${esc(w.place)}</b> ${esc(w.who)}</span><i>${esc(w.prize)}</i></div>`).join("") || "<p>No entries.</p>"}`;
    h += `<p class="zsmall">${esc(d.entries)} ${d.entries === 1 ? "entry" : "entries"}. ${esc(d.fairness)}</p>`;
    h += `<details class="zsmall"><summary>Check it yourself</summary><p>Beacon round ${esc(d.round)}. Value: <code style="word-break:break-all">${esc(d.beacon)}</code></p><p>Each entry is ranked by SHA-256 of <code>CB1-LUCKY|game code|${esc(d.ref || "0")}|beacon value|entry ID</code>. The lowest ranks win, 1st place first. Game code: <code>${esc(EID)}</code>.</p></details></div>`;
    return h + footer();
  }
  function prizeForm(m) {
    if (S.prizeDone) return `<div class="zbanner ok">Thank you. Your details are saved for the prize hand-over.</div>`;
    return `<form class="zcard zform" id="pz"><h2>Where should the prize go?</h2><label for="pn">Your name</label><input id="pn" maxlength="60" autocomplete="name" value="${esc(S.pname || "")}"><label for="pp">Mobile number (optional)</label><input id="pp" inputmode="tel" maxlength="20" autocomplete="tel">${S.perr ? `<div class="zbanner bad" role="alert">${esc(S.perr)}</div>` : ""}<button class="zbtn" type="submit">Save details</button><p class="zsmall">Winners' details are kept for 365 days so the prize can be handed over. Everyone else's are deleted within 24 hours.</p></form>`;
  }

  function paint() {
    $app.innerHTML = view();
    const reg = document.getElementById("reg");
    if (reg) {
      const k = document.getElementById("k4");
      if (window.CBConsent && k) { k.innerHTML = CBConsent.html("K4"); CBConsent.wire(reg, "K4", S.k4 || (S.k4 = {})); }
      reg.onsubmit = async (ev) => {
        ev.preventDefault(); if (S.busy) return;
        const id = document.getElementById("rid").value.trim(), name = document.getElementById("rnm").value.trim();
        if (!id) { S.err = I.idKind === "email" ? "Enter your Email ID." : "Enter your Employee ID."; return paint(); }
        S.busy = true; S.err = "";
        try {
          const r = await api("POST", `/api/z/${EID}/join`, { empId: id, name: name || undefined, device: device(), consent: CBConsent.payload(reg, "K4"), ...(TOKEN ? { token: TOKEN } : {}) });
          S.pid = r.pid; store.set(pidKey(), r.pid); rx("good_luck");
        } catch (e) { S.err = e.code === "draw-closed" ? e.message : e.code === "device-used" ? "This phone has already registered. One entry for each person." : e.status === 423 ? "This ID is already in the draw from another phone." : e.status === 409 ? "The draw is full." : e.status === 429 ? "It is busy right now. Please try again in a few minutes." : e.message; }
        S.busy = false; await refresh();
      };
    }
    const won = document.getElementById("won"); if (won) won.onclick = () => { S.won = !S.won; paint(); };
    const pz = document.getElementById("pz");
    if (pz) pz.onsubmit = async (ev) => {
      ev.preventDefault(); const name = document.getElementById("pn").value.trim(), phone = document.getElementById("pp").value.trim();
      S.pname = name;
      try { await api("POST", `/api/z/${EID}/confirm`, { pid: S.pid, device: device(), name, ...(phone ? { phone } : {}) }); S.prizeDone = true; S.perr = ""; } catch (e) { S.perr = e.message; }
      paint();
    };
  }

  const rx = (id) => { try { if (window.CBReact) window.CBReact.react(id); } catch (e) { /* a missing word never stops the page */ } };
  async function refresh() {
    try {
      I = await api("GET", `/api/z/${EID}/info`);
      D = I.draw || null;
      if (D && D.drawMs && Date.now() + (S.skew || 0) >= D.drawMs && !D.drawn && !D.paused) { const r = await api("GET", `/api/z/${EID}/draw${S.pid ? "?pid=" + encodeURIComponent(S.pid) : ""}`); D = r.draw; }
      else if (D && D.drawn && S.pid) { const r = await api("GET", `/api/z/${EID}/draw?pid=${encodeURIComponent(S.pid)}`); D = r.draw; }
      S.err = S.err && !I ? S.err : S.err;
      if (D) { // one short word at the big moments, only when this page saw the change happen
        if (S.wasPaused === false && D.paused) rx("pause"); else if (S.wasPaused === true && !D.paused) rx("resume");
        if (S.wasDrawn === false && D.drawn) { rx("draw"); setTimeout(() => rx(D.mine ? "win" : "winners_drawn"), 1300); }
        S.wasPaused = !!D.paused; S.wasDrawn = !!D.drawn;
      }
    } catch (e) { if (!I) { I = e.status === 404 ? { draft: false } : null; S.err = e.status === 404 ? "This link is not valid. Ask the organizer to send it again." : e.message; if (e.status === 404) { D = null; I = { name: "" }; } } }
    paint();
  }
  function loop() {
    clearInterval(timer);
    timer = setInterval(() => {
      const cd = document.getElementById("cd");
      if (cd && D && !D.paused && !D.drawn) { const now = Date.now() + (S.skew || 0); cd.textContent = now < D.drawMs ? left(D.drawMs - now) : "…"; if (now < D.drawMs && D.drawMs - now <= 3000 && !S.cdShown) { S.cdShown = 1; rx("countdown"); } }
      S.tick++;
      const near = D && !D.drawn && Date.now() + (S.skew || 0) >= D.drawMs - 5000;
      if (!document.hidden && !document.getElementById("reg") && (near ? S.tick % 3 === 0 : S.tick % 15 === 0)) refresh();
    }, 1000);
  }
  if (!EID) paint(); else { paint(); refresh().then(loop); }
})();
