# Reaction pack: original work (0.8.0)

The design of the Reaction pack was made for this product: nothing is copied or traced from a sticker sheet, a stock asset, a licensed font or another product.

- **Shapes (8):** spiky burst, round pop, cloud puff, jagged zigzag, wobbly bubble, ribbon, starburst, drip. Each is a polygon computed by our own formula in `tools/shapes.ts` (alternating radii, sine lobes, edge steps) and written to `reactions.css` as `clip-path`. No images, no external fonts, no SVG from outside.
- **Colours (8 pairs):** sun, coral, mint, sky, grape, lime, pink, night. Each has a fill, an ink and a line colour; ink on fill is at least 4.5:1 (checked by `tools/conformance.ts`).
- **Lettering:** the system bold font in capitals, outlined in the pair's line colour with a hard offset shadow, tilted a few degrees (our choice per reaction).
- **Words:** exactly 50 short phrases of at most four words, mostly one or two, in everyday English (Hello, Yeah, Bam, Pow, Zap, Boom, Crash, Kapow, Oh, No, Poof and so on). They are ordinary words, so we use them where they fit the event; only the design has to be original. Nothing rude (`tools/conformance.ts` fails the build on rude words or more than four words).
- **Motions (10):** pop, shake, wobble, slide left, slide right, drop, zoom, spin, bounce, flip; plain CSS keyframes, small movements inside the corner strip.
- **Rules kept:** 2.2 s (2.6 s for finish and win), corner strip at most 25% of the width, one at a time with a queue of one, 15 s gap, at most 15 per 10 minutes of game time, personal vs shared, reduced motion shows the same word still, Organizer can switch it off.

Each reaction is one choice of shape + colour + phrase + motion:

| id | phrase | shape | colour | motion | event |
|---|---|---|---|---|---|
| hello | Hello! | puff | mint | pop, tilt -3 | join |
| hi_there | Hi there! | pop | pink | bounce, tilt 3 | join |
| good_luck | Good luck! | puff | lime | wobble, tilt 2 | game_start |
| lets_go | Let's go! | pop | mint | zoom, tilt -3 | game_start, resume |
| ready_set_go | Ready, set, go! | burst | sky | zoom, tilt -2 | round_start, countdown |
| yeah | Yeah! | pop | lime | bounce, tilt -3 | good |
| yes | Yes! | wobble | mint | pop, tilt 3 | good |
| super | Super! | ribbon | sun | slidel, tilt 2 | good |
| cool | Cool! | pop | sky | flip, tilt -2 | good |
| wow | Wow! | star | pink | pop, tilt 3 | surprise |
| nice_one | Nice one! | wobble | mint | pop, tilt 3 | good_move |
| bam | Bam! | burst | coral | zoom, tilt -4 | hit |
| pow | Pow! | burst | sun | pop, tilt 4 | hit |
| zap | Zap! | zigzag | sky | slidel, tilt -3 | hit, quick |
| boom | Boom! | star | sun | zoom, tilt 4 | big_win |
| ta_da | Ta-da! | star | pink | flip, tilt 3 | reveal, draw_done |
| hurray | Hurray! | burst | lime | bounce, tilt -3 | round_win |
| lucky_you | Lucky you! | puff | sun | wobble, tilt 3 | lucky |
| jackpot | Jackpot! | star | sun | spin, tilt -4 | jackpot |
| spot_on | Spot on! | pop | mint | pop, tilt 2 | exact |
| climb_on | Climb on! | ribbon | mint | bounce, tilt -3 | ladder |
| up_you_go | Up you go! | ribbon | lime | slidel, tilt 2 | upgrade |
| big_jump | Big jump! | star | mint | bounce, tilt -3 | ladder_big |
| extra_throws | Extra throws! | burst | sky | spin, tilt 3 | extra_throw, reward |
| bonus_time | Bonus time! | pop | sun | pop, tilt 4 | bonus, reward |
| bullseye | Bullseye! | burst | mint | pop, tilt -2 | finish |
| oh | Oh! | wobble | grape | wobble, tilt 3 | bad_luck |
| no | No! | zigzag | coral | shake, tilt 3 | bad_luck |
| why_me | Why me? | wobble | night | drop, tilt -2 | bad_luck |
| oops | Oops! | puff | pink | wobble, tilt -4 | mistake, missed_turn |
| ouch | Ouch! | burst | coral | shake, tilt -4 | pain, penalty |
| aaah_bitten | Aaah, bitten! | drip | coral | shake, tilt -4 | snake_bite |
| not_again | Not again! | drip | grape | drop, tilt -2 | snake_bite_again, bad_repeat |
| slip_slide | Slip slide! | drip | night | drop, tilt -2 | downgrade |
| oh_my | Oh my! | wobble | grape | wobble, tilt 3 | bad_repeat |
| crash | Crash! | zigzag | coral | drop, tilt -3 | snake_far |
| yikes | Yikes! | burst | coral | shake, tilt -3 | danger |
| phew | Phew! | puff | sky | drop, tilt 2 | relief |
| so_close | So close! | wobble | sky | shake, tilt -2 | close_call |
| missed_it | Missed it! | zigzag | night | drop, tilt 2 | missed_turn, time_up |
| hurry_up | Hurry up! | zigzag | coral | shake, tilt 2 | time_warning |
| tick_tock | Tick tock! | pop | sky | flip, tilt 0 | countdown |
| last_chance | Last chance! | zigzag | coral | zoom, tilt -2 | last, time_warning |
| hang_on | Hang on! | pop | night | flip, tilt 0 | pause, wait |
| comeback_time | Comeback time! | ribbon | mint | slider, tilt 2 | comeback |
| youre_ahead | You're ahead! | ribbon | mint | slidel, tilt 1 | ahead, streak |
| catch_up | Catch up! | zigzag | sky | slider, tilt -1 | behind |
| poof_gone | Poof, gone! | puff | night | drop, tilt 2 | out, drop_out |
| kapow | Kapow! | burst | grape | zoom, tilt -5 | big_hit |
| champion | Champion! | star | sun | pop, tilt 3 | win |
