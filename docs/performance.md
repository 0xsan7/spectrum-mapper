# Performance

> Part of the [Spectrum Mapper](../README.md) documentation.
> Moved out of the README to keep the front page short.

**The timings below were measured on the author's machine — Node v26.7.0,
darwin/arm64, default configuration — and are not machine-independent.** A
faster or slower host moves every figure, so CI does not compare them; it only
checks that this section still describes what the code actually does. Re-run
`node scripts/benchmark.js` for numbers from your own hardware.

```
Room 20x15 m at 1 m = 300 cells, 4 sources, 4 receivers

Per-operation cost
  calculateRSSI (per call)              0.24us mean     0.22us median     0.33us p95
  pathLoss (per call)                   0.12us mean     0.11us median     0.18us p95
  generateHeatmap (per frame)         501.46us mean   474.50us median   636.71us p95
  calculateStats (per frame)           15.85us mean    13.67us median    22.38us p95
  leastSquares (per call)               0.47us mean     0.45us median     0.82us p95

Frame budget
  full frame (heatmap + stats + trilateration): 0.518ms
  configured update interval:                500ms
  headroom:                                   966x
  at 1.67us/cell, 500ms allows ~299,125 cells
```

Heatmap generation is essentially the whole frame's cost, and it scales
linearly at about 1.7 µs per cell. The grid size is the limit, not the model.

**Position error**, shipped receiver layout, 3 dB fading, 5000 positions
sampled across the room: mean 4.71 m, median 4.91 m, p95 7.26 m, max 8.07 m.

That average is dominated by positions far from the receivers, so the
breakdown matters more than the headline:

| Distance from room centre | Samples | Mean error |
| ------------------------- | ------- | ---------- |
| 0–2 m                     | 152     | 1.80 m     |
| 2–4 m                     | 448     | 2.47 m     |
| 4–6 m                     | 1033    | 3.64 m     |
| 6+ m                      | 3367    | 5.46 m     |

This is the expected shape: a fixed dB of fading is a _proportional_ range
error, so a target 20 m from a receiver localises worse than one 8 m away. Near
the middle of the default room the estimate is good to about 2 m.

The error is entirely fading, not solver error. With fading disabled the fit is
an exact algebraic inverse and the error is `0.0e+0 m` — which is exactly why
fading is left **on** in the estimator. An earlier version set it to zero and
reported a beautifully precise 0.00 m that measured nothing.

Startup: `require('../src/server')` ≈ 77 ms. Two runtime dependencies, `express`
and `ws`. The 300-cell heatmap serialises to about 8.3 KB; a live frame is
~17 KB, sent at 2 Hz.
