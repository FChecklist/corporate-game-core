/* What Corporate Bingo tells the shared new organizer flow (pack/zc-flow.js) about itself. The flow holds no game rules: the prize list comes from this game's own table (ZG.PRIZE_HOUSES: Line, Four Corners, X, Frame, Blackout and more).
   Owner rule: hide what Bingo cannot do (no coming soon, no demo stub). So: one card per player, no Super Bumper, no rehearsals, no lucky draw, no next-number control. */
window.ZFLOW_GAME = {
  brand: "Corporate Bingo",
  tickets: [1],               // one card for each player
  bumper: false,
  boardMax: 75, boardCols: 15, boardTitle: "BINGO", // the called-number sheet: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75, one row each
  idKind: false, /* hidden until the shared pack ties it to "what a person must give" (verify): shown alone it changes nothing */               // the pack shows "Which ID?" (Employee ID | Email ID) in step 2 and saves it as the game setting idKind (emp | email)
  sample: false,              // the sample-ticket preview draws a 3 x 9 ticket; Bingo's 5 x 5 card is not drawn there
  rehearsal: true, feed: true, presence: false, control: false, lucky: false,
  popular: ["line", "corners", "blackout"],
  recommended: ["line", "corners", "x", "blackout"],
};
