/* Lets the shared new organizer screens (pack/zc-flow.js) use Bingo's sign-in storage: the pack asks for "ctz-org" and "ctz-email", Bingo keeps them as "cbz-org" and "cbz-email". Runs before the pack; the pack is not touched. */
(function () {
  var K = window.CTK; if (!K || K.__bridged) return;
  var MAP = { "ctz-org": "cbz-org", "ctz-email": "cbz-email" }, m = function (k) { return MAP[k] || k; };
  var g = K.get, s = K.set, r = K.remove;
  K.get = function (k) { return g.call(K, m(k)); };
  K.set = function (k, v) { return s.call(K, m(k), v); };
  K.remove = function (k) { return r.call(K, m(k)); };
  K.__bridged = true;
})();
