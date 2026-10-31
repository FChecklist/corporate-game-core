/* Corporate Bingo public website: pricing, checkout, organizer login. Vanilla JS; needs common.js (window.TB). */
(function () {
  const $ = TB.$, esc = TB.esc, ic = TB.ic;
  const nf = (n) => Number(n).toLocaleString("en-IN");
  const S = { cur: TB.guessCurrency(), pack: 1000 };
  const DEMO = "demo"; // the first choice in both size lists: a demo game, a real game for 10 people at Rs 0; every other step is the same
  const isDemo = () => S.pack === DEMO;
  const packOptions = (sel) => `<option value="${DEMO}" ${sel === DEMO ? "selected" : ""}>Demo game · 10 people · Rs 0</option>` + TB.PACKS.map(([n]) => `<option value="${n}" ${n === sel ? "selected" : ""}>Up to ${nf(n)} players</option>`).join("");
  const FREE = { on: true, cap: 1e9 }; // the process: sign in, build the engagement, pay only when publishing
  let ORDER = null;

  // ---------- price display ----------
  function breakdown(pack, cur) {
    const x = TB.price(pack, cur);
    return cur === "INR"
      ? `<span>Total <b>${TB.money(x.total, "INR")}</b></span>`
      : `<span>Total <b>${TB.money(x.total, "USD")}</b></span><span>No tax added · billed in US dollars</span>`;
  }
  function renderPrices() {
    document.querySelectorAll("[data-cur]").forEach((el) => {
      el.innerHTML = ["INR", "USD"].map((k) => `<button type="button" class="${S.cur === k ? "on" : ""}" aria-pressed="${S.cur === k}" data-c="${k}">${k === "INR" ? "₹ INR" : "US$"}</button>`).join("");
    });
    $("pack").innerHTML = packOptions(S.pack); $("pack").value = String(S.pack);
    { const pb = $("payBtn"), bt = pb && pb.querySelector(".bt"); if (bt) bt.innerHTML = isDemo() ? "Start your demo game" : "Create your Corporate Bingo <small>(closed-group corporate bingo)</small>"; }
    if (isDemo()) { // the demo game: the same process (sign in, then the draft), nothing to pay
      if ($("heroBrk")) $("heroBrk").innerHTML = `<span>Total <b>Rs 0</b></span><span>Demo game · 10 people</span>`;
      $("packs").innerHTML = `<div class="pcard"><div class="pwho"><label for="pack2">How many players?</label><div class="selwrap"><select id="pack2" aria-label="Number of players">${packOptions(S.pack)}</select><svg class="ic chev"><use href="#i-chev"/></svg></div></div><div class="pmain"><div class="pamt"><span class="tot"><small>Demo game</small> Rs 0</span></div><button type="button" class="btn pcta" data-demo="1" aria-label="Start your demo game">Start your demo game ${ic("arrow")}</button></div><ul class="pperks"><li><span class="tick" aria-hidden="true">&#10003;</span>Up to 10 people, nothing to pay</li><li><span class="tick" aria-hidden="true">&#10003;</span>A real game with every feature</li><li><span class="tick" aria-hidden="true">&#10003;</span>Need more people? Make a new game for the size you need</li></ul></div>`;
      if ($("pack2")) $("pack2").value = String(S.pack);
      $("priceNote").textContent = "A demo game is for up to 10 people and costs Rs 0. Sign in with your e-mail and build it the same way as any game."; return;
    }
    if ($("heroBrk")) $("heroBrk").innerHTML = breakdown(S.pack, S.cur);
    { // one price card: the organizer picks the size, then sees the festive price (never a list of every pack)
      const n = S.pack, x = TB.price(n, S.cur), shown = S.cur === "INR" ? x.base : x.total, was = S.cur === "INR" ? shown * 2 + 1 : shown * 2; // "was" is the regular price that applies after the festive offer
      const opts = packOptions(n);
      const perks = ["All features included", "Bingo for your whole team, wherever they are", "Your message, video or audio between numbers", "Build it free, pay just before the game starts", "No fee to create or edit your game", "Guest names erased within 24 hours of the game", "One payment per game, no yearly plan"];
      $("packs").innerHTML = `<div class="pcard"><div class="pwho"><label for="pack2">How many players?</label><div class="selwrap"><select id="pack2" aria-label="Number of players">${opts}</select><svg class="ic chev"><use href="#i-chev"/></svg></div></div>` +
        `<div class="pmain"><div class="pburst" title="Festive offer: 50% off"><b>50% OFF</b><span>Festive offer</span><span class="sr">Festive offer: 50% off</span></div>` +
        `<div class="pamt"><span class="was" title="Regular price after the festive offer"><span class="sr">Regular price after the festive offer </span>${TB.money(was, S.cur)}</span>` +
        `<span class="tot"><small>Festive price</small> ${TB.money(shown, S.cur)}</span></div>` +
        `<button type="button" class="btn pcta" data-buy="${n}" aria-label="Create your game for up to ${nf(n)} players">Create your game ${ic("arrow")}</button></div>` +
        `<ul class="pperks">${perks.map((t) => `<li><span class="tick" aria-hidden="true">&#10003;</span>${t}</li>`).join("")}</ul></div>`;
    }
    if ($("pack2")) $("pack2").value = String(S.pack);
    if (FREE.on) { $("priceNote").textContent = "You build and publish your game for free. It does not begin until it is paid for. A late payment starts the first number 2 minutes after the payment is confirmed. " + (S.cur === "INR" ? "Prices in Indian rupees." : "Prices in US dollars."); return; }
    $("priceNote").textContent = S.cur === "INR" ? "Prices in Indian rupees. Billed in India." : "Prices in US dollars. Billed outside India.";
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-c]"); if (c) { S.cur = c.dataset.c; renderPrices(); if ($("ordSum")) sumRefresh(); return; }
    if (e.target.closest("[data-demo]")) { startDemo(); return; }
    const b = e.target.closest("[data-buy]"); if (b) { S.pack = +b.dataset.buy; renderPrices(); openCheckout(S.pack); return; }
    if (e.target.closest("[data-close]")) TB.closeSheet();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") TB.closeSheet(); });
  $("pack").addEventListener("change", (e) => { S.pack = e.target.value === DEMO ? DEMO : +e.target.value; renderPrices(); });
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "pack2") { S.pack = e.target.value === DEMO ? DEMO : +e.target.value; renderPrices(); const f = $("pack2"); if (f) f.focus(); } });
  function startDemo() { try { sessionStorage.setItem("cbz-next", "/zc.html?demo=1"); } catch {} const t = (() => { try { return (window.CTK ? CTK.get("cbz-org") : sessionStorage.getItem("cbz-org")); } catch { return null; } })(); if (t) location.href = "/zc.html?demo=1"; else openLogin(""); } // signed in already: straight to the demo draft; otherwise the same sign-in as every game
  $("payBtn").addEventListener("click", () => (isDemo() ? startDemo() : openCheckout(S.pack)));
  $("loginLink").addEventListener("click", (e) => { e.preventDefault(); openLogin(""); });

  // ---------- helpers ----------
  const xbtn = `<button type="button" class="xbtn" data-close aria-label="Close">${ic("x")}</button>`;
  const err = (t) => `<div class="err" role="alert">${ic("alert")}<span>${esc(t)}</span></div>`;
  const setErr = (t) => { $("fErr").innerHTML = t ? err(t) : ""; };
  const focusFirst = (id) => setTimeout(() => { const el = $(id); if (el) el.focus(); }, 60);
  // "Continue with Google": shown above the e-mail way only when the server has a Google client id (google.js); the e-mail code stays the other way
  const gBox = `<div id="gWrap" class="gwrap" hidden></div><p id="gOr" class="gor" hidden>or</p>`;
  const mountGoogle = (intent, consent) => { const w = $("gWrap"); if (!w || !TB.google) return; TB.google.mount(w, { intent, consent, onDone: TB.google.finish, onError: (m) => { const f = $("fErr"); if (f) f.innerHTML = err(m); } }).then((shown) => { const o = $("gOr"); if (o && shown) o.hidden = false; }).catch(() => {}); };
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.dataset.l = btn.dataset.l || btn.innerHTML; btn.innerHTML = on ? label : btn.dataset.l || btn.innerHTML; }

  // ---------- checkout ----------
  function sumHTML(pack, cur) {
    const x = TB.price(pack, cur);
    return cur === "INR"
      ? `<div class="kv t"><span>Total</span><b>${TB.money(x.total, cur)}</b></div>`
      : `<div class="kv"><span>Price of Software</span><b>${TB.money(x.base, cur)}</b></div><div class="kv"><span>Tax</span><b>None added</b></div><div class="kv t"><span>Total</span><b>${TB.money(x.total, cur)}</b></div><p class="tiny muted" style="margin:0 0 10px">No tax added · billed in US dollars</p>`;
  }
  function sumRefresh() { $("ordSum").innerHTML = sumHTML(ORDER.pack, S.cur); }
  function taxField() {
    const c = $("oCty").value, india = c === "IN";
    $("taxBox").innerHTML = india
      ? `<input type="hidden" id="oGst" value="">`
      : `<label class="lb" for="oGst">Company tax / VAT number (optional)</label><input class="inp" id="oGst" maxlength="30" autocomplete="off" placeholder="Shown on your invoice">`;
    S.cur = india ? "INR" : "USD"; renderPrices(); sumRefresh();
  }
  function openCheckout(pack) {
    if (FREE.on) return openFree();
    ORDER = { pack };
    const def = TB.guessCountry();
    TB.sheet(`${xbtn}<div class="eyebrow">Your order</div><h2>Up to ${nf(pack)} players</h2>
      <ul class="facts"><li>${ic("ticket")}Every guest gets their own bingo card on their phone</li><li>${ic("phone")}Name only. No app to download, no password for guests</li><li>${ic("users")}A close group game for your people, in any country</li><li>${ic("gift")}Players never pay. You give the prizes</li></ul>
      <div class="sum" id="ordSum"></div>
      <form id="coForm" novalidate>
        <label class="lb" for="oName">Organization name</label><input class="inp" id="oName" autocomplete="organization" placeholder="e.g. Acme Industries">
        <label class="lb" for="oMail">Your e-mail (invoice and login)</label><input class="inp" id="oMail" type="email" autocomplete="email" placeholder="your e-mail">
        <label class="lb" for="oPh">Your mobile number (optional)</label><input class="inp" id="oPh" type="tel" autocomplete="tel" placeholder="98765 43210">
        <label class="lb" for="oCty">Country of your organization</label><select class="inp" id="oCty">${TB.countryOpts(def)}</select>
        <div id="taxBox"></div><div id="k3wrap">${CBConsent.html("K3")}</div><div id="fErr"></div>
        <button class="btn block" style="margin-top:16px" type="submit" id="payGo" disabled aria-disabled="true">${ic("lock")} ${PAYMODE === "razorpay" ? "Pay securely with Razorpay" : PAYMODE === "off" ? "Payments are not switched on yet" : "Pay (local test payment)"}</button>
      </form>
      <p class="proto">${PAYMODE === "razorpay" ? "Secure payment by Razorpay. We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365. The organizer keeps the credit in their account. Once it has started, a paid game cannot be cancelled. Payment to <a href='https://itservices-rajat-agarwal.pages.dev/' rel='noopener' target='_blank'>IT Services by Rajat Agarwal</a>. An invoice is emailed to you." : "Local test payment: no real money is taken. Unused places are not credited."}</p>`);
    $("oCty").addEventListener("change", taxField);
    $("coForm").addEventListener("submit", (e) => { e.preventDefault(); pay(); });
    CBConsent.gate($("k3wrap"), "K3", $("payGo"));
    taxField(); focusFirst("oName");
  }
  // ---------- refer & earn: remember who sent this visitor for 30 days (kept in this browser only) ----------
  const REF = (() => {
    try {
      const p = new URLSearchParams(location.search).get("ref"); const d = p && /^[A-Za-z2-9]{8}$/.test(p.trim()) ? p.trim().toUpperCase() : "";
      if (d) localStorage.setItem("cbz-ref", JSON.stringify({ code: d, at: Date.now() }));
      const v = JSON.parse(localStorage.getItem("cbz-ref") || "null");
      if (v && Date.now() - v.at < 30 * 86400000) return v.code;
      localStorage.removeItem("cbz-ref");
    } catch {}
    return "";
  })();
  if (REF) TB.api("GET", "/api/partner/check?code=" + REF).then((r) => { if (!r.valid) { try { localStorage.removeItem("cbz-ref"); } catch {} } }).catch(() => {});
  let PAYMODE = "test"; // razorpay | test | off, from the server
  TB.api("GET", "/api/payments/status").then((s) => { PAYMODE = s.mode; }).catch(() => {});
  // ---------- free launch: create an organizer account with a e-mail; the key arrives only through the e-mailed code ----------
  function openFree() {
    try { if (Number.isInteger(S.pack) && S.pack > 10) { sessionStorage.setItem("cbz-cap", String(S.pack)); } } catch {} // the size chosen on the website carries through the sign-in: Quick setup opens with it
    TB.sheet(`${xbtn}<div class="openfree" role="group" aria-labelledby="ofTitle">
      <div class="sheethead"><span class="rolepill">For the organizer or host</span><span class="sbrand" role="img" aria-label="Corporate Bingo"><span class="mark"><img src="/logo-mark.svg" alt="" width="26" height="26"></span><span class="word">Corporate Bingo<i>.</i></span></span></div>
      <div class="eyebrow ofeye">Build it and publish it free.</div><h2 id="ofTitle">Create your game</h2>
      <ul class="bgrid"><li><span class="bico">${ic("play")}</span><span>Add a message, video or lucky draw between calls</span></li><li><span class="bico">${ic("trophy")}</span><span>Pick your prizes: Line, Four Corners, X, Blackout</span></li><li><span class="bico">${ic("users")}</span><span>A closed-group Bingo for your company</span></li><li><span class="bico">${ic("ticket")}</span><span>Every card is unique: no two can ever match</span></li><li><span class="bico">${ic("phone")}</span><span>Each guest gets their own card on their phone</span></li><li><span class="bico">${ic("gift")}</span><span>Players never pay. You provide the prizes</span></li><li><span class="bico">${ic("trash")}</span><span>Guest names are erased within 24 hours of the game ending</span></li><li><span class="bico">${ic("shield")}</span><span>Designed to follow DPDP Act, GDPR and CCPA</span></li></ul>
      <div id="k2wrap">${CBConsent.html("K2")}</div>${gBox}<form id="frForm" novalidate><label class="lb" for="fMail">Your e-mail</label><input class="inp big" id="fMail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="your e-mail" aria-describedby="fErr"><div id="fErr" role="alert"></div>
      <button class="btn block big" style="margin-top:14px" type="submit" id="frGo" disabled aria-disabled="true">Create my game ${ic("arrow")}</button></form>
      <p class="trust">${ic("shield")}Free to build and publish. No password.</p>
      <p class="proto">Your console opens at once. We use your email for your invoice and to sign you in later.</p><p class="proto"><a href="/demo.html">Want to see it first? Try the free 70-second demo.</a></p>
      <p class="spriv accept">Read the <a href="/terms.html" target="_blank" rel="noopener">Terms</a> and the <a href="/legal.html#privacy" target="_blank" rel="noopener">Privacy &amp; Data Policy</a> before you tick the box.</p></div>`);
    const k2 = $("k2wrap"), gw = $("gWrap");
    const refresh = CBConsent.gate(k2, "K2", $("frGo")), sync = () => { const ok = refresh(); if (gw) { gw.style.opacity = ok ? "" : ".45"; gw.style.pointerEvents = ok ? "" : "none"; } };
    k2.addEventListener("change", sync); sync();
    $("frForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const m = $("fMail").value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m)) return setErr("Please enter a valid e-mail address.");
      if (!CBConsent.all(k2, "K2")) return setErr("Please tick the box to continue.");
      const b = $("frGo"); b.disabled = true; setErr("");
      try {
        const r = await TB.api("POST", "/api/start", { email: m, consent: CBConsent.payload(k2, "K2"), ...(passTok() ? { pass: passTok() } : {}) });
        if (r.exists) { TB.toast("You already have an account, so we are emailing you a code to confirm it is you"); return askCode(m, b); }
        try { CTK.set("cbz-org", r.token); sessionStorage.setItem("cbz-aimsg", r.aiMessage); CTK.set("cbz-email", m); } catch {}
        location.href = nextAfterSignIn();
      } catch (x) { sync(); setErr(x.message); }
    });
    mountGoogle("signup", () => (CBConsent.all(k2, "K2") ? CBConsent.payload(k2, "K2") : null));
    if (matchMedia("(min-width:700px)").matches) focusFirst("fMail"); else { const sh = document.getElementById("sheet"); if (sh) { sh.setAttribute("tabindex", "-1"); sh.focus({ preventScroll: true }); sh.scrollTop = 0; } } // on a phone the top of the pop-up stays in view; the keypad opens when the field is tapped
  }
  async function pay() {
    const org = $("oName").value.trim(), email = $("oMail").value.trim().toLowerCase(), country = $("oCty").value, taxId = $("oGst").value.trim().toUpperCase();
    if (org.length < 2) return setErr("Please enter your organization name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return setErr("Please enter a valid e-mail address.");
    setErr("");
    const btn = $("payGo"); btn.disabled = true; const keep = btn.innerHTML; btn.textContent = "Processing…";
    try {
      let r = await TB.api("POST", "/api/checkout", { consent: CBConsent.payload($("k3wrap"), "K3"), org, email, country, taxId, pack: ORDER.pack, currency: S.cur, ref: (() => { try { const v = JSON.parse(localStorage.getItem("cbz-ref") || "null"); return v && Date.now() - v.at < 30 * 86400000 ? v.code : ""; } catch { return ""; } })(), phone: ($("oPh") ? $("oPh").value.trim() : "") });
      if (r.mode === "razorpay") r = await TB.pay(r.razorpay, r.paymentId, r.hop); // opens Razorpay Checkout; the server verifies the payment
      else if (r.result) r = Object.assign({ mode: r.mode }, r.result); // local test mode answers with the finished order
      ORDER = Object.assign(ORDER, { org, email, mode: r.mode }, r);
      done();
    } catch (e) { setErr(e.message); btn.disabled = false; btn.innerHTML = keep; }
  }
  function done() {
    const o = ORDER;
    TB.sheet(`${xbtn}<div class="res ok">${ic("check")}</div><h2 class="center">Your game is ready</h2>
      <div class="sum"><div class="kv"><span>Order</span><b class="mono">${esc(o.orderId)}</b></div><div class="kv"><span>Organization</span><b>${esc(o.org)}</b></div><div class="kv"><span>Players</span><b>Up to ${nf(o.pack)}</b></div><div class="kv t"><span>${o.mode === "test" ? "Paid (test)" : "Paid"}</span><b>${TB.money(o.total, o.currency)}</b></div>${o.invoiceNumber ? `<div class="kv"><span>Invoice</span><b class="mono"><a href="${esc(o.invoiceUrl)}" target="_blank" rel="noopener">${esc(o.invoiceNumber)}</a></b></div>` : ""}</div>
      ${o.organizerKey ? `<div class="note info" role="note"><b>Your organizer key</b> (shown only once, and we have emailed it to you):<div class="mono" id="orgKey" style="word-break:break-all;margin:6px 0">${esc(o.organizerKey)}</div><button class="btn sm" type="button" id="cpKey">Copy key</button></div>` : `<p class="small muted center">You already have an organizer key. Sign in with your e-mail to continue.</p>`}
      <p class="small muted center">Next step: open your console to set the date, pick your prizes and share the link. We sent the details and your invoice to <b>${esc(o.email)}</b>.</p>
      <div id="fErr"></div>
      <button class="btn block" id="toLogin" type="button">Open my console ${ic("arrow")}</button>`);
    const cp = $("cpKey"); if (cp) cp.addEventListener("click", () => { try { navigator.clipboard.writeText(o.organizerKey); TB.toast("Key copied"); } catch {} });
    $("toLogin").addEventListener("click", () => { if (o.organizerKey) { try { CTK.set("cbz-org", o.organizerKey); } catch {} location.href = "/zc.html"; } else askCode(o.email, $("toLogin")); });
  }

  // ---------- login ----------
  /** Where a signed-in organizer goes next: the page the visit began on (the console, a pay page, or the free demo link) or the console. */
  function nextAfterSignIn() { let nx = "/zc.html"; try { const n = sessionStorage.getItem("cbz-next"); if (n && /^\/(zc|pay)(\.html)?(\?(e=[A-Za-z0-9_-]{4,40}|demo=1|quick=1(&cap=\d{1,5})?))?$/.test(n)) nx = n; sessionStorage.removeItem("cbz-next"); } catch {} return nx; }
  function openLogin(email) {
    TB.sheet(`${xbtn}<div class="eyebrow">Organizer sign-in</div><h2>Sign in or create your account</h2><p class="muted small">Type your e-mail and press Continue. That is all: there is no password. New here? Your account is made at once. Coming back? We e-mail you two ways to get in; you use <b>one</b> of them. Participants never sign in here: they join with your game link.</p>
      ${gBox}<form id="lgForm" novalidate><label class="lb" for="lMail">Your e-mail</label><input class="inp big" id="lMail" data-need="1" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="your e-mail" value="${esc(email || "")}"><div id="k2slot"></div><div id="fErr" role="alert"></div>
      <button class="btn block big" style="margin-top:14px" type="submit" id="lgGo">Continue ${ic("arrow")}</button></form>
      <p class="spriv accept">Our <a href="/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="/legal.html#privacy" target="_blank" rel="noopener">Privacy &amp; Data Policy</a> are on our site.</p>`);
    let termsShown = false;
    $("lgForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const m = $("lMail").value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m)) return setErr("Please enter a valid e-mail address.");
      const k2 = $("k2slot"); if (termsShown && !CBConsent.all(k2, "K2")) return setErr("Please tick the box to continue.");
      const b = $("lgGo"); b.disabled = true; setErr("");
      try { // one door for everyone: an address that already has an account is sent a code; a new address gets an account (after the Terms box) and goes straight in
        const r = await TB.api("POST", "/api/start", termsShown ? { email: m, consent: CBConsent.payload(k2, "K2") } : { email: m });
        if (r.exists) return askCode(m, b);
        try { CTK.set("cbz-org", r.token); sessionStorage.setItem("cbz-aimsg", r.aiMessage); CTK.set("cbz-email", m); } catch {}
        location.href = nextAfterSignIn();
      } catch (x) {
        b.disabled = false;
        if (termsShown && x.code === "consent-required") { setErr(x.message); return; }
        if (!termsShown && x.status === 400 && x.code === "consent-required") { termsShown = true; const k = $("k2slot"); k.innerHTML = `<p class="small muted" style="margin:12px 0 4px"><b>New here?</b> Tick the box below and we create your organizer account at once. It is free to build and publish.</p>` + CBConsent.html("K2"); setErr(""); const refresh = CBConsent.gate(k, "K2", $("lgGo")); k.addEventListener("change", refresh); refresh(); const f = k.querySelector("input"); if (f) f.focus(); return; }
        setErr(x.message);
      }
    });
    mountGoogle("signin"); focusFirst("lMail");
  }
  /** A demo link opened in this browser (kept by the console): sent with the e-mail so the server uses it whichever browser finishes the sign-in. */
  const passTok = () => { try { const v = JSON.parse(localStorage.getItem("cbz-pass") || "null"); return v && /^[0-9a-f]{32}$/.test(v.t || "") && Date.now() - (Number(v.at) || 0) < 14 * 86400000 ? v.t : undefined; } catch { return undefined; } };
  async function askCode(email, btn) {
    if (btn) { btn.disabled = true; }
    try {
      const r = await TB.api("POST", "/api/auth/email", { email, ...(passTok() ? { pass: passTok() } : {}) });
      codeView(email, r.devCode); return true;
    } catch (e) { if (btn) btn.disabled = false; const f = $("fErr"); if (f) f.innerHTML = err(e.message); else TB.toast(esc(e.message)); return false; }
  }
  function codeView(email, devCode) {
    const boxes6 = [0, 1, 2, 3, 4, 5].map((i) => `<input class="otpb" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="${i === 0 ? "one-time-code" : "off"}" aria-label="Digit ${i + 1} of 6" autocapitalize="off" spellcheck="false">`).join("");
    TB.sheet(`${xbtn}<div class="sheethead"><div class="eyebrow">Step 2 of 2</div><span class="sbrand" role="img" aria-label="Corporate Bingo"><span class="mark"><img src="/logo-mark.svg" alt="" width="26" height="26"></span><span class="word">Corporate Bingo<i>.</i></span></span></div>
      <h2 id="cdTitle">Now open your e-mail</h2>
      <p class="sheetbody">We sent an e-mail to <b class="sendto">${esc(email)}</b>. Pick <b>ONE</b> of these two ways. You do not need both.</p>
      <div class="optbox"><div class="optn">Option 1</div><p class="optt">Go to your e-mail and type the 6-digit number here</p><p class="opts">Open the e-mail. Find the 6 numbers. Type them in the six boxes below and press <b>Submit</b>.</p></div>
      <div class="optbox"><div class="optn">Option 2</div><p class="optt">Go to your e-mail and tap the button</p><p class="opts">Open the e-mail and tap the button <b>Sign me in</b>. You are signed in at once. You do not type anything. (You can then close this page.)</p></div>
      ${devCode ? `<div class="note info devcode" role="note"><span>Local test mode: your code is <b>${esc(devCode)}</b></span><button type="button" class="btn sm" id="useCode">Use this code</button></div>` : ""}
      <form id="cdForm" novalidate><label class="lb" id="otpLabel">Option 1: type your 6-digit code here</label>
      <div class="otp" role="group" aria-labelledby="otpLabel">${boxes6}</div>
      <input id="lCode" class="otphid" inputmode="numeric" autocomplete="off" maxlength="6" aria-hidden="true" tabindex="-1">
      <div id="fErr" role="alert"></div>
      <button class="btn block big" style="margin-top:16px" type="submit" id="cdGo">Submit</button></form>
      <button class="btn line block big" style="margin-top:8px" type="button" id="resend">Send a new code</button>
      <p class="sheethelp" id="cdHelp" role="status" aria-live="polite">The e-mail can take a minute. Not there? Look in your spam or junk folder, or press <b>Send a new code</b>. Both options work for 10 minutes.</p>`);
    const boxes = Array.from(document.querySelectorAll(".otpb")), hid = $("lCode");
    const sync = () => { hid.value = boxes.map((b) => b.value).join(""); };
    const spread = (digits) => { const d = digits.replace(/\D/g, "").slice(0, 6); boxes.forEach((b, i) => { b.value = d[i] || ""; }); sync(); const n = Math.min(d.length, 5); boxes[n].focus(); };
    boxes.forEach((b, i) => {
      b.addEventListener("input", () => { const v = b.value.replace(/\D/g, ""); if (v.length > 1) return spread(boxes.slice(0, i).map((x) => x.value).join("") + v); b.value = v; sync(); if (v && i < 5) boxes[i + 1].focus(); });
      b.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !b.value && i > 0) { boxes[i - 1].value = ""; boxes[i - 1].focus(); sync(); e.preventDefault(); } else if (e.key === "ArrowLeft" && i > 0) boxes[i - 1].focus(); else if (e.key === "ArrowRight" && i < 5) boxes[i + 1].focus(); });
      b.addEventListener("paste", (e) => { const txt = (e.clipboardData || window.clipboardData).getData("text") || ""; if (/\d{2,}/.test(txt)) { e.preventDefault(); spread(txt); } });
      b.addEventListener("focus", () => b.select());
    });
    hid.addEventListener("input", () => { const d = hid.value.replace(/\D/g, "").slice(0, 6); boxes.forEach((b, i) => { b.value = d[i] || ""; }); hid.value = d; }); // a test tool or password manager may fill the hidden field: mirror it into the boxes
    const verify = async () => {
      const code = hid.value.replace(/\D/g, "");
      if (code.length !== 6) return setErr("Please enter all 6 digits of the code.");
      const b = $("cdGo"); b.disabled = true; setErr("");
      try {
        const r = await TB.api("POST", "/api/auth/verify", { email, code });
        try { CTK.set("cbz-org", r.token); CTK.set("cbz-email", email); if (r.alt) CTK.set("cbz-alt", JSON.stringify(r.alt)); else CTK.remove("cbz-alt"); } catch {} location.href = nextAfterSignIn();
      } catch (e) { b.disabled = false; setErr(e.message); boxes[0].focus(); }
    };
    $("cdForm").addEventListener("submit", (e) => { e.preventDefault(); verify(); });
    $("resend").addEventListener("click", async () => { if (await askCode(email, $("resend"))) TB.toast("A new code was sent"); });
    const u = $("useCode"); if (u) u.addEventListener("click", () => { spread(devCode); verify(); });
    boxes[0].focus();
  }

  // ---------- init ----------
  renderPrices();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let wi = 0; const tick = () => { const L = document.querySelectorAll("#whoL li"); L.forEach((l, i) => l.classList.toggle("on", i === wi % L.length)); wi++; };
    tick(); setInterval(tick, 1300);
    let bb = 0; setInterval(() => { bb = (bb + 2) % 102; const e = $("bbp"); if (e) e.style.setProperty("--p", bb + "%"); }, 200);
  }
  const hashLogin = () => { if (location.hash === "#login") { let em = ""; try { em = sessionStorage.getItem("cbz-login-email") || ""; sessionStorage.removeItem("cbz-login-email"); } catch {} openLogin(em); } };
  window.addEventListener("hashchange", hashLogin); hashLogin();
  // ---------- who is signed in: the top link says it ("Organizer" or "Host") and goes to the right place ----------
  (async () => {
    let t = ""; try { t = CTK.get("cbz-org") || ""; } catch {}
    const a = $("loginLink"); if (!t || !a) return;
    try {
      const r = await fetch("/api/whoami", { headers: { "x-organizer": t }, cache: "no-store" });
      if (!r.ok) return;
      const k = (await r.json()).kind, who = k === "host" ? "Host" : k === "master" ? "Organizer" : "";
      if (!who) return;
      let both = false; try { both = !!CTK.get("cbz-alt"); } catch {}
      a.textContent = `Signed in as ${who}${both ? " (also " + (who === "Host" ? "Organizer" : "Host") + ")" : ""} · Open my console`;
      a.href = "/zc.html"; a.classList.add("signedin");
      a.addEventListener("click", (e) => e.stopImmediatePropagation(), true);
    } catch { /* offline: the normal link stays */ }
  })();
})();

// ---------- small sticky bar: appears after scrolling; the brand returns to the top, the button jumps to the price card ----------
(function () {
  if (document.getElementById("topbar")) return;
  var bar = document.createElement("div");
  bar.id = "topbar"; bar.setAttribute("role", "navigation"); bar.setAttribute("aria-label", "Quick links"); bar.hidden = true;
  bar.innerHTML = '<button type="button" class="tb-brand" id="tbTop" aria-label="Back to the top"><span class="tb-mark" aria-hidden="true"><img src="/logo-mark.svg" alt="" width="28" height="28"></span><b>Corporate Bingo</b><span class="tb-up" aria-hidden="true">&#8593; Top</span></button>' +
    '<a class="tb-cta" id="tbBuy" href="#pricing">Create your game</a>';
  document.body.appendChild(bar);
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches, shown = false, tick = 0;
  function onScroll() {
    if (tick) return; tick = requestAnimationFrame(function () {
      tick = 0; var show = (window.scrollY || document.documentElement.scrollTop || 0) > 360;
      if (show !== shown) { shown = show; bar.hidden = !show; bar.classList.toggle("on", show); }
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  document.getElementById("tbTop").addEventListener("click", function () { window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); });
  document.getElementById("tbBuy").addEventListener("click", function (e) {
    var t = document.getElementById("pricing"); if (!t) return; e.preventDefault();
    t.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  });
})();
