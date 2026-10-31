/* The Terms boxes (vanilla JS, no build). One wording for every page; the server checks the same wording and the same version (apps/edge/src/consent.ts).
   A box is never ticked in advance. The button of its point stays disabled until every box of that point is ticked.
   The words Terms, Privacy and Refund Policy inside a label are links to the site's own pages and open in a new tab. */
(function () {
  const C = (window.CBConsent = {});
  C.version = "2026-10-15";
  C.text = {
    K1: {
      A: "I have read and agree to the Terms & Conditions, the Privacy Policy and the Refund Policy.",
      B: "I confirm: players pay nothing to play. I provide and hand over any prize. This game is allowed in my State. I am allowed to invite these guests.",
    },
    K2: { A: "I have read and agree to the Terms & Conditions and the Privacy Policy." },
    K3: { A: "I agree to the Terms and the Refund Policy. I understand there is no refund; my payment stays as credit." },
    K4: {
      A: "I agree that my name (and my mobile number, only if this game asks for it) is used for this game only and deleted within 24 hours after it ends. I know who invited me is recorded until then. If I win, my name (and my mobile number, if I gave one) and prize record are kept for 365 days so the prize can be handed over. We keep billing data for audit and tax reasons. This notice is available in Hindi on request.",
      B: "I am 18 or older.",
    },
    K5: { A: "I will not charge any player. I will hand over prizes as the organizer decides. I follow the Terms." },
    K6: { A: "I am allowed to use these names and numbers for this game. The people have been told." },
  };
  const LINKS = [["Terms & Conditions", "/terms.html"], ["Privacy Policy", "/privacy.html"], ["Refund Policy", "/refund-policy.html"], ["Terms", "/terms.html"]];
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const linkify = (t) => { // the label text stays exactly the wording; only the page names become links
    let out = "", i = 0;
    while (i < t.length) {
      const hit = LINKS.find(([w]) => t.startsWith(w, i));
      if (hit) { out += `<a href="${hit[1]}" target="_blank" rel="noopener">${esc(hit[0])}</a>`; i += hit[0].length; } else { out += esc(t[i]); i++; }
    }
    return out;
  };
  const style = () => {
    if (document.getElementById("cbc-style")) return;
    const s = document.createElement("style"); s.id = "cbc-style";
    s.textContent = ".cbc{margin:12px 0;text-align:left}.cbc-row{display:flex;gap:10px;align-items:flex-start;margin:8px 0;font-size:14px;line-height:1.45}.cbc-row input{flex:0 0 auto;width:22px;height:22px;margin:1px 0 0;accent-color:#0B5D5B}.cbc-row label{flex:1 1 auto;margin:0;font-weight:400;cursor:pointer}.cbc-row a{text-decoration:underline}button[aria-disabled=true]{opacity:.55;cursor:not-allowed}";
    document.head.appendChild(s);
  };
  /** The rows of one point, as HTML. Nothing is ticked. */
  C.html = (kind) => {
    style();
    return `<div class="cbc" data-cbc="${kind}" role="group" aria-label="Terms">` + Object.keys(C.text[kind]).map((b) => `<div class="cbc-row"><input type="checkbox" id="cbc-${kind}-${b}" data-box="${b}"><label for="cbc-${kind}-${b}">${linkify(C.text[kind][b])}</label></div>`).join("") + `</div>`;
  };
  const rows = (root, kind) => Array.from((root || document).querySelectorAll(`[data-cbc="${kind}"] input[type=checkbox]`));
  C.ticked = (root, kind) => rows(root, kind).filter((i) => i.checked).map((i) => i.dataset.box);
  C.all = (root, kind) => { const r = rows(root, kind); return r.length > 0 && r.every((i) => i.checked); };
  /** What to send with the request. */
  C.payload = (root, kind) => ({ v: C.version, boxes: C.ticked(root, kind) });
  /** Ties the boxes of one point to the buttons that need them (`data-needs="K1"` inside `root`, plus `btn` if given): disabled and aria-disabled until every box is ticked.
      `store` ({A:true,...}) remembers the ticks while a page redraws itself; a button marked data-hold="1" stays disabled for another reason. Returns refresh(). */
  C.wire = (root, kind, store, btn) => {
    store = store || {};
    const targets = () => Array.from(root.querySelectorAll(`[data-needs="${kind}"]`)).concat(btn ? [btn] : []);
    const refresh = () => {
      const ok = C.all(root, kind);
      targets().forEach((b) => { const off = !ok || b.dataset.hold === "1"; b.disabled = off; b.setAttribute("aria-disabled", off ? "true" : "false"); });
      return ok;
    };
    rows(root, kind).forEach((i) => { i.checked = !!store[i.dataset.box]; i.addEventListener("change", () => { store[i.dataset.box] = i.checked; refresh(); }); });
    refresh();
    return refresh;
  };
  C.gate = (root, kind, btn, keep) => C.wire(root, kind, keep, btn);
})();
