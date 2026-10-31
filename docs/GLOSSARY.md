# Glossary — words matter (owner directive 2026-10-01)

"Game" and "player" make this sound like an online/gambling product. We describe what it is: an **engagement** with **participants**.

| Old word (in handout / rules v1.4 / prototype) | Use now | Notes |
|---|---|---|
| Game | **Engagement** | Everywhere: UI, emails, docs, code identifiers, DB tables, URLs (`/e/CODE` instead of `/g/CODE`) |
| Player | **Participant** | Includes roles: Participant, Team Lead, Host. "Player limit" becomes "Participant limit" |
| Play / playing | Participate / take part | "Join" is fine |
| Game link | Engagement link | |
| Game report | Engagement report | |
| "Engagement" as the *price-pack unit* (1 engagement = 1 ticket per number) | **Participant place** ("Up to 1,000 participants") | **Collision:** the old handout used "engagement" for the pack unit. That word now means the event. Packs are sold as "Up to N participants" |
| Game started / Game ended | Engagement started / ended | |

**Approved 2026-10-01:** Prize -> **Reward**; Bogey -> **Not valid**. Still open: Win/Winner (keep "Winner" or use "Reward recipient"); "Claim" stays unless the owner says otherwise. The product name "Corporate Bingo" is unchanged unless the owner says otherwise.

Rule for code: identifiers use `engagement` / `participant` from the start (tables `engagements`, `participants`, class `EngagementEngine`, room `EngagementRoom`). All UI text lives in `strings.en.ts`, so a later wording change is one file.

Rule for docs: `NOTES.md` / `IMPLEMENTATION.md` sections written before this date still say "game/player" in places; read them through this glossary. The Drive documents (Handout v2.0, Rules v1.4) also still say "game/player" and need revised versions; nothing in Drive has been edited.
