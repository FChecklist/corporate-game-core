# Reaction pack: original work (0.8.0)

Everything in the Reaction pack was made for this product. Nothing is copied or traced from a sticker sheet, a stock asset, a licensed font or another product.

- **Shapes (8):** spiky burst, round pop, cloud puff, jagged zigzag, wobbly bubble, ribbon, starburst, drip. Each is a polygon computed by our own formula in `tools/shapes.ts` (alternating radii, sine lobes, edge steps) and written to `reactions.css` as `clip-path`. No images, no external fonts, no SVG from outside.
- **Colours (8 pairs):** sun, coral, mint, sky, grape, lime, pink, night. Each has a fill, an ink and a line colour; ink on fill is at least 4.5:1 (checked by `tools/conformance.ts`).
- **Lettering:** the system bold font in capitals, outlined in the pair's line colour with a hard offset shadow, tilted a few degrees (our choice per reaction).
- **Words:** our own phrases. `tools/conformance.ts` fails the build if a phrase or id is one of the words on the owner's do-not-copy list (the stock sheet), or is profane, or is an abbreviation.
- **Motions (10):** pop, shake, wobble, slide left, slide right, drop, zoom, spin, bounce, flip; plain CSS keyframes, small movements inside the corner strip.
- **Rules kept:** 2.2 s (2.6 s for finish and win), corner strip at most 25% of the width, one at a time with a queue of one, 15 s gap, at most 15 per 10 minutes of game time, personal vs shared, reduced motion shows the same word still, Organizer can switch it off.

Each reaction is one choice of shape + colour + phrase + motion:

| id | phrase | shape | colour | motion | event |
|---|---|---|---|---|---|
| snake_bite | Aaahaa, bitten! | drip | coral | shake, tilt -4 | snake_bite |
| snake_bite_again | Oh my, again! | wobble | grape | wobble, tilt 3 | snake_bite_again |
| ladder | Lucky! Ladder! | star | mint | bounce, tilt -3 | ladder |
| upgrade | Level up! | ribbon | lime | slidel, tilt 2 | upgrade |
| downgrade | Down we go | drip | night | drop, tilt -2 | downgrade |
| reward | Reward! | pop | sun | pop, tilt 4 | reward |
| punishment | Penalty! | zigzag | coral | shake, tilt -3 | punishment |
| extra_throw | Throw again! | burst | sky | spin, tilt 3 | extra_throw |
| missed_turn | Oops! | puff | pink | wobble, tilt -4 | missed_turn |
| dice_roll | Roll! | pop | sky | spin, tilt 0 | dice_roll |
| six | Six! | star | sun | zoom, tilt 5 | six |
| finish | Finished! | burst | mint | pop, tilt -2 | finish |
| win | You won! | star | sun | pop, tilt 3 | win |
| out | Out! | zigzag | night | drop, tilt -3 | out |
| close_call | So close! | wobble | sky | shake, tilt -2 | close_call |
| comeback | Comeback! | ribbon | mint | slider, tilt 2 | comeback |
| streak | On a roll! | puff | lime | bounce, tilt -3 | streak |
| ahead | In front! | ribbon | mint | slidel, tilt 1 | ahead |
| behind | Catch up! | zigzag | sky | slider, tilt -1 | behind |
| tie | Tie! | pop | night | flip, tilt 0 | tie |
| round_start | Round starts! | burst | sky | zoom, tilt -2 | round_start |
| round_end | Round over | ribbon | night | flip, tilt 1 | round_end |
| pause | Paused | pop | night | flip, tilt 0 | pause |
| resume | Back on! | puff | mint | pop, tilt 2 | resume |
| countdown | 3 2 1 | pop | sky | zoom, tilt 0 | countdown |
| time_up | Time is up! | zigzag | coral | shake, tilt 2 | time_up |
| dishoom | Dishoom! | burst | coral | zoom, tilt -5 | hit |
| big_one | Big one! | star | grape | zoom, tilt 4 | big |
| swift | Swift! | zigzag | sky | slidel, tilt -3 | quick |
| uh_oh | Uh-oh! | puff | pink | wobble, tilt 3 | mistake |
| not_again | Not again | drip | grape | drop, tilt -2 | bad_repeat |
| yay | Yay! | pop | lime | bounce, tilt -3 | good |
| amazing | Amazing! | burst | sun | pop, tilt 3 | surprise |
| phew | Phew! | puff | sky | drop, tilt 2 | relief |
| ouch | Ouch! | burst | coral | shake, tilt -4 | pain |
| whoosh | Whoosh! | zigzag | sky | slider, tilt -2 | move |
| ta_da | Ta-da! | star | pink | flip, tilt 3 | reveal |
| bingo | Bingo! | star | sun | pop, tilt -3 | bingo |
| housie | Housie! | star | sun | pop, tilt 3 | housie |
| draw | Draw! | burst | grape | spin, tilt -3 | draw |
| claim | Claim! | wobble | sun | bounce, tilt 2 | claim |
| your_turn | Your turn! | ribbon | lime | slidel, tilt -1 | your_turn |
| ready | Ready? | puff | night | flip, tilt 2 | ready |
| go | Go! | pop | mint | zoom, tilt -3 | go |
| good_luck | Good luck! | puff | lime | wobble, tilt 2 | good_luck |
| jackpot | Jackpot! | star | sun | spin, tilt -4 | jackpot |
| nice | Nice one! | wobble | mint | pop, tilt 3 | nice |
| winners_drawn | Winners drawn! | ribbon | grape | flip, tilt -1 | draw_done |
| next_round | Next round! | ribbon | sky | slider, tilt 1 | next_round |
| last_one | Last one! | zigzag | coral | zoom, tilt -2 | last |
| great | Great! | pop | lime | bounce, tilt 3 | great |
| full_house | Full house! | burst | sun | pop, tilt -2 | full |
