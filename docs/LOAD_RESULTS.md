# Load harness results (in-process, no network)

Run: `bun tools/load.ts [1000 10000 100000]`. Machine: Windows 11 laptop, Bun 1.3.14, one thread, 31 Oct 2026. Reducers only: no network, storage, PDF or e-mail. Heap is the growth since the phase group started, after a forced GC.

```
--- 1000 participants
luckydraw register (x1000) n=   1000        9 ms     116883/s heap +0.0 MB entries=1000
luckydraw register (one)   n=   1000       46 ms      21890/s heap +0.0 MB entries=1000
luckydraw draw             n=   1000      152 ms       6600/s heap +0.0 MB winners=10
bingo make cards           n=   1000       44 ms      22907/s heap +0.0 MB 
bingo init (grouping)      n=   1000      223 ms       4479/s heap +1.4 MB 
bingo 75 calls             n=   1000       53 ms      18870/s heap +1.4 MB wins=4 over=true
bingo settleFromLog        n=   1000      200 ms       5010/s heap +1.7 MB lines=4
--- 10000 participants
luckydraw register (x1000) n=  10000       41 ms     246018/s heap +0.0 MB entries=10000
luckydraw register (one)   n=  10000     3853 ms       2595/s heap +3.3 MB entries=10000
luckydraw draw             n=  10000      748 ms      13377/s heap +3.3 MB winners=10
bingo make cards           n=  10000      349 ms      28683/s heap +4.5 MB 
bingo init (grouping)      n=  10000     1325 ms       7550/s heap +5.3 MB 
bingo 75 calls             n=  10000       21 ms     479653/s heap +5.3 MB wins=4 over=true
bingo settleFromLog        n=  10000     1237 ms       8086/s heap +5.4 MB lines=4
--- 100000 participants
luckydraw register (x1000) n= 100000     1501 ms      66620/s heap +15.0 MB entries=100000
luckydraw draw             n= 100000     2508 ms      39880/s heap +31.5 MB winners=10
bingo make cards           n= 100000     1818 ms      55006/s heap +20.3 MB 
bingo init (grouping)      n= 100000    17814 ms       5614/s heap +39.8 MB 
bingo 75 calls             n= 100000      101 ms     993599/s heap +39.8 MB wins=4 over=true
bingo settleFromLog skipped past 10k (init does the same work once)
```

## Reading the numbers
- Lucky Draw: one register event at a time copies the entry list, so it grows with n squared (3.9 s at 10k, about 6 minutes at 100k by the same curve). The host must register in batches (event registerMany, 100k in 1.5 s) or rely on its store's unique key. The draw needs one SHA-256 per entry: 2.5 s at 100k.
- Bingo: the one-time start (work out, for every seat, when it completes each house) is 17.8 s at 100k seats and 40 MB; after that all 75 calls settle in 0.1 s. Do it before the game starts, not at the first call.
- Not measured: network fan-out, database, e-mail to winners, PDF. This says the rules code is not the bottleneck at 100,000; it does not say the whole system is.
