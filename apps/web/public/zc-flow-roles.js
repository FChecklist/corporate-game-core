/* Corporate Bingo (?flow=new), same rules as Corporate Tambola: who lets whom in. Pure rules from the owner's note 29, written once and used for the words on every role's screen.
   The engine decides the real outcome; Hosts, Co-host approval and family approval that it cannot do yet are not drawn (see handover 194). */
(() => {
  const FAMILY_CUTOFF_MIN = 15, WAIT_LIMIT_MIN = 30;
  /** The people who may let someone in, by the link that person used. */
  const approvers = (link) => (link === "family" ? ["family host"] : link === "cohost" ? ["Co-host", "Host", "organizer"] : ["Host", "organizer"]);
  /**
   * What happens when a person opens the game link.
   * sc: link (open | listed | family | cohost | host), validation (system | manual), onList, family (card 2 on), pay (pending | paid | free), minutesToStart, capFull.
   * Returns { outcome: in | waiting | not_open | full | refused, approvers: [] }.
   */
  function decide(sc) {
    if (sc.pay === "pending") return { outcome: "not_open", approvers: [] };
    if (sc.capFull) return { outcome: "full", approvers: [] };
    if (sc.link === "family") {
      if (!sc.family) return { outcome: "refused", approvers: [] };                 // no family passes in this game
      if (sc.minutesToStart <= FAMILY_CUTOFF_MIN) return { outcome: "refused", approvers: [] }; // the family host approves up to 15 minutes before the start
      if (sc.waitedMinutes >= WAIT_LIMIT_MIN) return { outcome: "lapsed", approvers: [] };
      return { outcome: "waiting", approvers: approvers("family") };
    }
    if (sc.link === "open") return { outcome: "in", approvers: [] };                // anyone can join: name, mobile, email; no approval
    if (sc.validation === "system" && sc.onList) return { outcome: "in", approvers: [] };
    if (sc.waitedMinutes >= WAIT_LIMIT_MIN) return { outcome: "lapsed", approvers: [] };           // nobody answered in 30 minutes: the person is asked to try again
    return { outcome: "waiting", approvers: approvers(sc.link === "cohost" ? "cohost" : "host") };
  }
  /** The plain sentence a role reads about who lets people in. */
  function approvalText(role) {
    // only what the engine does today: people who join with the game link wait for the organizer or a Host. Co-host and family approval are not in the engine, so no sentence promises them.
    return role === "cohost" ? "" : role === "host" ? "People who join with the game link, a Host link or the organizer link wait for you or the organizer." : "People who join with the game link wait for you or a Host.";
  }
  /** May this role let a waiting person in? (the approvers of that request include the role) */
  const LABEL = { organizer: "organizer", host: "Host", cohost: "Co-host", familyhost: "family host" };
  const canLetIn = (role, approverList) => approverList.indexOf(LABEL[role]) >= 0;
  window.ZROLES = { canLetIn, FAMILY_CUTOFF_MIN, WAIT_LIMIT_MIN, approvers, decide, approvalText };
})();
