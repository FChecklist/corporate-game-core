// "Test your brand moment": shows an organizer exactly what a guest's phone shows during a break, an opening or a closing, with the organizer's REAL link,
// without a game, a guest or a payment. Everything is in the address after the # (it never reaches our server): #w=break|opening|closing&k=kind&t=title&u=https-link&s=seconds
// The playing code below is the same as the phone page's (z.js): YouTube in a privacy-friendly player, video and audio files in the page, anything else only a link.
(function () {
  "use strict";
  const $app = document.getElementById("app");
  const SAMPLE_CARD = [[7, 18, 34, 52, 66], [3, 25, 41, 47, 70], [12, 29, null, 59, 73], [14, 21, 38, 46, 62], [9, 27, 43, 55, 68]];
  const cardGrid = (label) => `<div class="zticket" role="group" aria-label="${label}">${["B", "I", "N", "G", "O"].map((l, c) => `<div class="h l${c}" aria-hidden="true">${l}</div>`).join("")}${SAMPLE_CARD.flat().map((n) => n === null ? `<div class="m free"><span>FREE</span></div>` : `<div class="c">${n}</div>`).join("")}</div>`;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const q = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (q.get("w") === "card") { ticketPreview(); return; }
  const when = ["break", "opening", "closing"].includes(q.get("w")) ? q.get("w") : "break";
  const b = { kind: q.get("k") || "speech", title: (q.get("t") || "Your message").slice(0, 80), mediaUrl: q.get("u") || "", seconds: Math.max(15, Math.min(600, Number(q.get("s")) || 60)) };
  let badLink = false; if (b.mediaUrl && !/^https:\/\/[^\s<>"'`]+$/i.test(b.mediaUrl)) { b.mediaUrl = ""; badLink = true; }

  const mediaHost = document.createElement("div");
  mediaHost.id = "cbmedia"; mediaHost.style.cssText = "position:absolute;z-index:30;display:none;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.3)";
  document.body.appendChild(mediaHost);
  const ytId = (u) => { const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/.exec(u || ""); return m ? m[1] : null; };
  const mediaKind = (x) => {
    if (!x || !x.mediaUrl) return null;
    if (ytId(x.mediaUrl)) return "yt";
    if (x.kind === "youtube") return null;
    if (/\.(mp4|webm|m4v|mov|ogv)([?#]|$)/i.test(x.mediaUrl)) return "video";
    if (/\.(mp3|m4a|aac|wav|ogg|oga)([?#]|$)/i.test(x.mediaUrl)) return "audio";
    return null;
  };
  function soundButton(onTap) {
    const t = document.createElement("button"); t.type = "button"; t.textContent = "Tap for sound";
    t.style.cssText = "position:absolute;right:8px;bottom:8px;z-index:2;background:#FFC93C;color:#1b1b1b;border:0;border-radius:8px;padding:6px 12px;font:700 13px system-ui,sans-serif";
    t.onclick = () => { try { onTap(); } catch {} t.remove(); };
    mediaHost.appendChild(t);
  }
  function startMedia(kind) {
    mediaHost.textContent = ""; mediaHost.style.background = "#000";
    if (kind === "yt") {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), canSound = !ios && navigator.userActivation && navigator.userActivation.hasBeenActive;
      const f = document.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + ytId(b.mediaUrl) + "?autoplay=1&mute=" + (canSound ? 0 : 1) + "&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=" + encodeURIComponent(location.origin);
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.title = b.title; f.setAttribute("allowfullscreen", ""); f.referrerPolicy = "strict-origin-when-cross-origin";
      f.style.cssText = "width:100%;height:100%;border:0"; mediaHost.appendChild(f);
      if (!canSound) soundButton(() => f.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "https://www.youtube-nocookie.com"));
      return;
    }
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.src = b.mediaUrl; el.controls = true; el.autoplay = true; el.setAttribute("playsinline", ""); el.preload = "auto";
    el.style.cssText = kind === "video" ? "width:100%;height:100%;background:#000" : "position:absolute;left:8px;right:8px;top:50%;transform:translateY(-50%);width:calc(100% - 16px)";
    if (kind === "audio") { mediaHost.style.background = "#0B5D5B"; const t = document.createElement("div"); t.textContent = b.title; t.style.cssText = "position:absolute;left:0;right:0;top:18%;text-align:center;color:#fff;font:700 18px system-ui,sans-serif;padding:0 12px"; mediaHost.appendChild(t); }
    el.addEventListener("error", () => { const n = document.getElementById("pvnote"); if (n) n.innerHTML = "<b>This link did not play.</b> Check that it starts with https:// and opens a video or audio file directly (for a YouTube video, that the owner allows it to be shown on other sites)."; });
    mediaHost.appendChild(el);
    const p = typeof el.play === "function" ? el.play() : null; if (p && p.catch) p.catch(() => { el.muted = true; const r = el.play(); if (r && r.catch) r.catch(() => {}); soundButton(() => { el.muted = false; }); });
  }
  function placeMedia() {
    const slot = document.getElementById("mslot");
    if (!slot) { mediaHost.style.display = "none"; return; }
    const r = slot.getBoundingClientRect();
    mediaHost.style.display = "block"; mediaHost.style.left = r.left + scrollX + "px"; mediaHost.style.top = r.top + scrollY + "px"; mediaHost.style.width = r.width + "px"; mediaHost.style.height = r.height + "px";
  }
  addEventListener("resize", placeMedia);

  const kind = mediaKind(b);
  const sampleCard = `<div class="zcard"><h2>Your card (sample)</h2>${cardGrid("Sample card")}</div>`;
  const what = b.kind === "speech" ? "Please listen to the host." : b.kind === "slides" ? "Please look at the screen." : "";
  const heading = when === "break" ? "A short break" : when === "opening" ? "A message from your organizer" : "Thank you from your organizer";
  const verdict = badLink ? "<b>The link you pasted was not used.</b> It must start with https:// and have no spaces. Go back, correct it and press Test it again." : !b.mediaUrl ? "No link: guests see your message only." : kind ? "This link plays inside the game." : "<b>This link will NOT play inside the game.</b> It opens in a new tab and takes the guest out of the game. Use a YouTube link, or a direct link to a video (.mp4) or audio (.mp3) file.";
  let timer = 0, endsAt = 0;

  function paint(secondsLeft) {
    const over = secondsLeft !== null && secondsLeft <= 0;
    const act = b.mediaUrl && !over ? (kind ? `<div id="mslot" class="zmslot"></div><a class="zsmall" target="_blank" rel="noopener noreferrer" href="${esc(b.mediaUrl)}">Trouble playing? Open it in a new tab</a>` : `<a class="zbtn s" style="display:inline-flex;align-items:center;text-decoration:none;margin-top:10px" target="_blank" rel="noopener noreferrer" href="${esc(b.mediaUrl)}">${b.kind === "youtube" ? "Watch the video" : "Open"}</a>`) : "";
    const tail = when === "break" ? ` The numbers continue in ${Math.max(0, secondsLeft)}s.` : when === "opening" ? " The game starts in a moment." : "";
    const card = over ? `<div class="zcard zbreak" role="status"><h2>${when === "break" ? "The break is over" : "The opening is over"}</h2><div class="zsmall" style="margin:0">The message and the video have gone, and ${when === "break" ? "the numbers carry on" : "the first number comes next"}. This is what your guests see: their card is right there again.</div><button class="zbtn s" id="again" type="button" style="margin-top:10px">Play it again</button></div>`
      : `<div class="zcard zbreak" role="status"><h2>${heading}</h2><div style="font:700 20px var(--sans,inherit);margin:2px 0 4px">${esc(b.title)}</div><div class="zsmall" style="margin:0">${what}${tail}</div>${act}</div>`;
    $app.innerHTML = `<div class="zhead"><b>Corporate Bingo</b></div>
      <div class="zbanner info" role="note"><b>Test only.</b> No game is running. It shows what a guest's phone shows during your ${when === "break" ? "break" : when}.</div>
      <div class="zcard"><div class="zsmall" id="pvnote" style="margin:0">${verdict}</div></div>${card}${sampleCard}`;
    if (!over && kind && mediaHost.dataset.k !== "on") { mediaHost.dataset.k = "on"; startMedia(kind); }
    if (over) { mediaHost.textContent = ""; mediaHost.style.display = "none"; delete mediaHost.dataset.k; }
    else placeMedia();
    const again = document.getElementById("again"); if (again) again.onclick = run;
  }
  function run() {
    clearInterval(timer); mediaHost.textContent = ""; delete mediaHost.dataset.k;
    if (when === "closing") { paint(null); return; } // a closing has no countdown: it stays on the final screen
    endsAt = Date.now() + b.seconds * 1000; paint(b.seconds);
    timer = setInterval(() => { const left = Math.round((endsAt - Date.now()) / 1000); const el = document.querySelector(".zbreak .zsmall"); if (left <= 0) { clearInterval(timer); paint(0); } else if (el && when === "break") el.textContent = `${what} The numbers continue in ${left}s.`.trim(); }, 1000);
  }
  run();
  // ---------- "See what guests see": a sample card, marked PREVIEW. #w=card&e=<game id> reads the game's PUBLIC settings (a read only, with the signed-in tab's own key when there is one);
  // without a game it uses the sample values in the address: n=<company name> c=<#colour> p=<prize|prize> b=<break title> l=<lucky draw title>. Nothing here ever writes anything. ----------
  function ticketPreview() {
    // names and "how to win" copied from PRIZE_HOUSES in packages/beacon/src/config.ts (a test keeps them identical)
    const NAMES = {"line":"Line","twolines":"Two Lines","corners":"Four Corners","plus":"Plus","x":"X","frame":"Frame","stamp":"Postage Stamp","letterL":"Letter L","letterT":"Letter T","blackout":"Blackout"};
    const HOW = {"line":"Mark any one row, column or diagonal. FREE counts.","twolines":"Mark any two different lines.","corners":"Mark the four corner squares.","plus":"Mark the whole middle row and the whole middle column.","x":"Mark both diagonals.","frame":"Mark the whole outer border.","stamp":"Mark a 2 x 2 block in any corner.","letterL":"Mark the whole B column and the bottom row.","letterT":"Mark the whole top row and the whole N column.","blackout":"Mark every square on your card. FREE counts."};
    const lin = (h) => { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const cleanBrand = (b) => {
      if (!b || typeof b !== "object") return null;
      const name = String(b.name == null ? "" : b.name).replace(/\s+/g, " ").trim().slice(0, 60);
      let color = String(b.color || ""); if (/^#[0-9a-f]{3}$/i.test(color)) color = "#" + color.slice(1).split("").map((c) => c + c).join("");
      if (!/^#[0-9a-f]{6}$/i.test(color)) color = "#0B5D5B";
      const logo = typeof b.logo === "string" && b.logo.length < 90000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(b.logo) ? b.logo : "";
      if (!name && !logo) return null;
      const L = 0.2126 * lin(color.slice(1, 3)) + 0.7152 * lin(color.slice(3, 5)) + 0.0722 * lin(color.slice(5, 7));
      return { name, color, logo, fg: 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? "#ffffff" : "#111111" };
    };
    const eid = (q.get("e") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    let key = ""; try { key = CTK.get("cbz-org") || ""; } catch {}
    const fromHash = () => ({
      brand: q.get("n") ? { name: q.get("n"), color: q.get("c") || "" } : null,
      rewards: (q.get("p") || "").split("|").map((t) => t.trim()).filter(Boolean).slice(0, 8).map((t, i) => ({ pattern: "", ordinal: 1, text: t })),
      breaks: q.get("b") ? [{ kind: "speech", title: q.get("b").slice(0, 80), seconds: 60 }] : [],
      lucky: q.get("l") ? q.get("l").slice(0, 80) : "",
    });
    function draw(d, note) {
      const brand = cleanBrand(d.brand);
      const rewards = d.rewards && d.rewards.length ? d.rewards : [{ pattern: "line", ordinal: 1, text: "" }, { pattern: "corners", ordinal: 1, text: "" }, { pattern: "blackout", ordinal: 1, text: "" }];
      const prizeLi = rewards.map((r) => { const nm = r.pattern ? (NAMES[r.pattern] || r.pattern) : ""; const t = r.text ? String(r.text) : ""; return `<li>${esc((r.ordinal > 1 ? r.ordinal + "nd " : "") + nm)}${nm && t ? ": " : ""}${t ? "<b>" + esc(t) + "</b>" : ""}${HOW[r.pattern] ? `<br><small class="zsmall">${esc(HOW[r.pattern])}</small>` : ""}</li>`; }).join("");
      const brk = (d.breaks || []).find((x) => x && x.kind !== "lucky");
      const lucky = (d.breaks || []).find((x) => x && x.kind === "lucky");
      const luckyTitle = lucky ? lucky.title : d.lucky || "Lucky draw prize";
      const luckyN = lucky && lucky.winners ? lucky.winners : 3;
      $app.innerHTML = `<div class="zhead"><b>Corporate Bingo</b></div>
        <div class="zbanner info" role="note"><b>PREVIEW.</b> This is a sample card, not a real one. Nothing is saved, nobody is told, and no game is running.${note ? " " + esc(note) : ""}</div>
        ${brand ? `<div class="zbrand" id="pvbrand">${brand.logo ? `<img class="zblogo" alt="" src="${esc(brand.logo)}">` : ""}${brand.name ? `<b>${esc(brand.name)}</b>` : ""}</div><div class="zpow">Powered by Corporate Bingo</div>` : `<div class="zbrand" id="pvbrand0">CORPORATE BINGO</div><div class="zsmall" style="margin:4px 0 0">No company name or logo is set yet, so guests see our name. Set yours in the Brand step to see it here.</div>`}
        <div class="zcard"><h2>Your card <span class="zdemotag">PREVIEW</span></h2>${cardGrid("Sample card")}${brand && brand.logo ? `<p class="zsmall" style="margin:8px 0 0">Your logo sits in the FREE square.</p>` : ""}</div>
        <div class="zcard"><h2>What you can win</h2><ul class="zlist">${prizeLi}</ul></div>
        <div class="zcard zbreak"><h2>A short break</h2><div style="font:700 20px var(--sans,inherit);margin:2px 0 4px">${esc(brk ? brk.title : "A message from your organizer")}</div><div class="zsmall" style="margin:0">Please listen to the host. The numbers continue in ${esc(String(brk && brk.seconds ? brk.seconds : 60))}s.</div></div>
        <div class="zcard"><h2>Lucky draw</h2><div class="zrow"><span>${esc(luckyTitle)}<br><small class="zsmall" style="margin:0">${luckyN} ${luckyN === 1 ? "person is" : "people are"} picked at random</small></span><i>at the end of the break</i></div></div>`;
      const b0 = document.getElementById("pvbrand0"); if (b0) { b0.style.background = "#0B5D5B"; b0.style.color = "#ffffff"; }
      const b = document.getElementById("pvbrand"); if (b && brand) { b.style.background = brand.color; b.style.color = brand.fg; }
    }
    try { document.title = "See what guests see | Corporate Bingo"; } catch {}
    $app.innerHTML = `<p class="zmsg">Loading…</p>`;
    if (!eid) return draw(fromHash(), "");
    fetch(`/api/z/${encodeURIComponent(eid)}/info`, { method: "GET", headers: key ? { "x-organizer": key } : {} })
      .then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then((j) => draw({ brand: j.brand, rewards: Array.isArray(j.rewards) ? j.rewards : [], breaks: Array.isArray(j.breaks) ? j.breaks : [], lucky: "" }, ""))
      .catch(() => draw(fromHash(), "We could not read your game just now, so this shows sample words."));
  }
})();
