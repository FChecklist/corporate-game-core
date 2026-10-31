/* Which organizer screens open at /zc. Bingo ships the new screens as OPT-IN (DEFAULT_NEW = false): /zc.html opens the previous screens unless ?flow=new is in the address or this browser remembered "new".
   When the owner approves, ONE change makes the new screens the default: DEFAULT_NEW = true. ?flow=old opens the previous screens and is remembered on this browser; ?flow=new switches back.
   Links only the previous screens understand (demo game, pass, quick start, new game from the card page, cap, do, k = a Host / AI key link, api) always open the previous screens and the choice is NOT stored.
   A game that needs controls the new screens do not have (manual start, host-called numbers, or live right now) also opens the previous screens, not stored.
   It runs first and only puts flow=new or flow=old into the address, so zc.js (previous screens) and pack/zc-flow.js (new screens) are not touched. */
(function () {
  var DEFAULT_NEW = false;
  // 1.4.1: the new screens cannot sign in on Bingo yet (the shared pack looks for the key under the name "ctz-org" and the prefix ct[hcak]_, Bingo stores "cbz-org" and cb[hca]_), so they are HIDDEN for this release:
  // ?flow=new and a remembered "new" both open the previous screens. Set NEW_SCREENS_ENABLED = true only after the pack reads Bingo's key.
  var NEW_SCREENS_ENABLED = true; /* opt-in only: DEFAULT_NEW stays false, so nobody sees them unless ?flow=new */
  if (!NEW_SCREENS_ENABLED) {
    try { var q0 = new URLSearchParams(location.search); if (q0.get("flow") === "new") { q0.set("flow", "old"); history.replaceState(null, "", location.pathname + "?" + q0.toString() + location.hash); } } catch (e) { /* the page opens as before */ }
    window.CT_ZCFLOW = "old"; window.CT_ZCFORCED = true; return;
  }
  try {
    var q = new URLSearchParams(location.search), f = q.get("flow"), s = null;
    try { s = localStorage.getItem("cbz-zcflow"); } catch (e) {}
    if (f === "new" || f === "old") { try { localStorage.setItem("cbz-zcflow", f); } catch (e) {} }
    else {
      var OLD = ["demo", "pass", "quick", "quickform", "new", "cap", "do", "k", "api"], forced = false;
      for (var i = 0; i < OLD.length; i++) if (q.has(OLD[i])) forced = true;
      var gid = q.get("e");
      if (!forced && gid && /^[A-Za-z0-9_-]{4,40}$/.test(gid)) {
        try {
          var x = new XMLHttpRequest(); x.open("GET", "/api/z/" + encodeURIComponent(gid) + "/info", false); x.send(null);
          if (x.status === 200) {
            var j = JSON.parse(x.responseText), now = Date.now();
            if (j.startMode === "manual" || j.callMode === "host") forced = true;
            if (typeof j.startMs === "number" && now >= j.startMs - 15 * 60000 && now <= j.startMs + 4 * 3600000) forced = true;
          }
        } catch (e) { /* no answer: the default */ }
      }
      window.CT_ZCFORCED = forced;
      f = forced ? "old" : s === "new" ? "new" : s === "old" ? "old" : DEFAULT_NEW ? "new" : "old";
      if (f === "new" || DEFAULT_NEW) { q.set("flow", f); try { history.replaceState(null, "", location.pathname + "?" + q.toString() + location.hash); } catch (e) {} }
    }
    window.CT_ZCFLOW = f;
  } catch (e) { /* the page then opens as before */ }
})();
