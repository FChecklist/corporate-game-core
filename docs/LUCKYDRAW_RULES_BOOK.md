# Lucky Draw rules book (plain words) - what the Lucky Draw module implements

Source: spec 410 section 5 and the live Bingo lucky draw (`luckyWinners`). The public beacon value, the game id and the draw time come from the host site and are given to the module. Common-engine matters (roles, pause, rehearsal, prizes, retention, wording) are in the core suite.

## Entering
1. A person registers once. The entry is the person's ID (employee ID or e-mail, as the game is set up), cleaned the same way as in every game. The same person cannot enter twice ("You are already in the draw.").
2. Registration closes at draw time. In an automatic draw that is the published time; in a manual draw it is the moment the Organizer or Host presses Draw. A late registration is refused ("Registration is closed.").
3. The draw holds up to 100,000 entries. A rehearsal ("Try it first") holds up to 10. A full draw refuses more ("The draw is full.").
4. While paused nothing registers and nothing is drawn; the draw time waits (game time, the clock is frozen).
5. There is no Organizer final say on the result.

## The draw
6. The Organizer sets how many winners there are (at least one) and the prize for each place (1st, 2nd, 3rd, then 4th, 5th and so on). Prizes are Auto or Manual as in every game; a manual prize text never changes who won.
7. Automatic: when the draw time has come and the beacon value is available, the draw happens at once. Manual: the Organizer or Host presses Draw. Nobody else can.
8. The draw is made from the public beacon value and the list of entries only. The rank of an entry is the SHA-256 of `CB1-LUCKY|game id|reference|beacon value|ID`, in hex. The entries with the lowest ranks win, 1st place first. This is the same rule the live Bingo lucky draw uses.
9. What the code proves: the winners depend on nothing but the entries and the beacon value, so anybody holding both gets exactly the same winners; the order the entries came in, and the order they are stored in, make no difference; every entry has the same chance; one entry cannot win twice; if there are fewer entries than winners, every entry wins and no place is invented. What the code does NOT prove: that the beacon value is unpredictable. That comes from the public beacon, and fairness wording must say so ("decided by a public value nobody can choose or predict") only for that part.
10. A draw happens once. After it, the result is final and later events change nothing.

## After the draw
11. The result is shown to everyone. Each winner's golden button says "You won" (no Claim, the game announces it). Winners are also e-mailed by the host site. The module reports each win as `{win, player, "1st"}` and then `end`.
12. Participant data is auto-deleted on the core retention schedule (the code auto-deletes at 20 hours).

## For the host site
- `init(setup, [], now)`: `setup.eid` (game id), `setup.winners`, `setup.prizes` (comma list), `setup.draw` ("auto" or "manual"), `setup.closeAt` (auto only, game time), `setup.idKind` ("emp" or "email"), `setup.ref` (which beacon round decides, default "0"), `setup.rehearsal`, `setup.cap`.
- Events: `{type:"register", player}`, `{type:"tick", beacon?}` (an auto draw happens on the first tick at or after the draw time that carries the beacon value), `{type:"draw", by: role, beacon}`.
- `registerWhy(state, id, now, clock)` gives the guided refusal message for the screen. `winnersFor(...)` lets anyone re-check a result.
