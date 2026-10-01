# The model

> Part of the [Spectrum Mapper](../README.md) documentation.
> Moved out of the README to keep the front page short.

Path loss is a standard log-distance model:

```
PL(d) = PL(d0) + 10 · n · log10(d / d0)
```

Combined into the received power at a receiver:

```
RSSI = Tx − PL(d₀) − 10n·log₁₀(d/d₀) − walls − fading
```

where `walls` is the attenuation accumulated crossing each wall segment and
`fading` is the random term.

with `PL(d0) = 20 · log10(4π · d0 · f / c)` — the free-space loss at the
reference distance `d0 = 1 m`. The exponent `n`, the frequency `f`, and the
fading magnitude are all adjustable at runtime. Distance is clamped to a
minimum so `log10` is never evaluated at or below zero, and `n = 2` free space
reproduces the textbook `31.5 dB` at 900 MHz and `40.0 dB` at 2.4 GHz.

Sources combine in **linear power**, not by averaging dBm, which is
arithmetically meaningless. See [CHANGELOG.md](../CHANGELOG.md) for what
that changed.

Walls are line segments with a thickness. A path only picks up a wall's
attenuation when it genuinely crosses it, and crossed walls sum.

### Position estimation

Each receiver's RSSI is inverted back to a range, then those ranges are fitted
for position. Rather than intersecting circles, the reference receiver's
equation is subtracted from the others to cancel the quadratic terms, leaving
a 2 × 2 linear system solved in closed form. Circle intersection is avoided
because with fading and walls the circles generally do not meet at a single
point, so "pick the best pair" would be arbitrary.

It degrades honestly rather than guessing:

| Receivers            | Behaviour                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3 or more            | Least-squares fit, unique                                                                                                                                                                                                |
| Exactly 2            | The normal equations are rank-1, so the geometry is solved directly instead. Two circles meet in up to two mirrored points; both are returned, the fit is flagged ambiguous, and the UI draws the other candidate hollow |
| 1, or all coincident | No solution, reported as such                                                                                                                                                                                            |
| Collinear            | Flagged degenerate instead of dividing by ~0                                                                                                                                                                             |

Readings at or below the noise floor become `NaN` and are dropped from the fit
rather than treated as zero range. Estimates are clamped to the room, since the
target is known to be inside and an estimate outside it is definitely wrong.

The error in metres is computed **server-side**, because it needs the true
position, which only the server has. The browser is shown the result and never
the truth it was compared against.
