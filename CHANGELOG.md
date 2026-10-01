# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0]

The first release after the repository was brought up to standard. Most of it
is correctness: the physics was wrong, the front end was malformed, and the
README made claims that had never been measured.

### Added

- **Real log-distance path loss.** Configurable exponent, frequency and fading,
  with distance clamped so `log10` is never evaluated at or below zero. Units
  tested against the textbook free-space figures.
- **Linear-power combination.** Multiple transmitters now combine in linear
  power rather than by averaging dBm, which is arithmetically meaningless.
- **Wall obstacles.** Line segments with thickness; a path picks up a wall's
  attenuation only when it genuinely crosses it, and crossed walls sum.
- **Interactive editing.** Drag transmitters and receivers, live sliders for
  exponent, frequency and noise, hover tooltip showing RSSI, and a legend.
- **Mobile trilateration.** RSSI is inverted to a range and fitted by weighted
  least squares, with the estimate drawn against ground truth and the error
  reported in metres. Two receivers report genuine ambiguity instead of a
  confident wrong answer.
- **Time series and trails.** RSSI chart, movement trails, and PNG/CSV/JSON
  export.
- **Obstacle-aware heatmap.** Finite-thickness attenuation folded into the
  grid rather than being a display-only effect.

### Fixed

Bugs found while doing the above, each with a test that fails without the fix.

- **Path loss could report impossible values.** The old model produced a cell
  reading above its own transmitter's power.
- **Room conversion returned `NaN`.** `HeatmapRenderer.toRoomCoords()` read
  room dimensions that only ever existed on `Dashboard`, so every converted
  coordinate was `NaN` — which broke transmitter dragging, tooltips and wall
  drawing together.
- **Threat detection was permanently HIGH.** It compared a number to a string,
  so `Math.abs(20 - "-65.3")` was `NaN` and every source tripped the threshold.
- **The HTML document ended before the app.** Major sections of
  `public/index.html` sat after `</html>`.
- **Two `Dashboard` instances and two sockets.** Duplicate `load` listeners
  meant every frame rendered twice.
- **The trilateration normal equations had a sign error.**
- **History deltas froze after two minutes.** The cursor was an array index
  into a 240-sample ring buffer; once full, `slice(240)` returned nothing. Fixed
  with monotonic sequence IDs. The test that caught it asserts one sample per
  frame at capacity rather than trusting a read of the code.
- **CSV headers disagreed with row order.** All source x headers preceded all
  source y headers while rows interleaved each source's x/y pair, so every
  heatmap cell was paired with the wrong transmitter's coordinates.
- **Live frames carried the entire history and trail set every tick** — about
  103 KB/s. Now one snapshot on connect and deltas thereafter, roughly 33.8
  KB/s.
- **Non-finite coordinates were clamped to the corner.** `Math.min`/`Math.max`
  with `NaN` returned `NaN`, and the old branching path turned that into
  `(0, 0)`. Now rejected outright.
- **A model slider rendered the paused flag** as a fake `0 dB` control.

### Changed

- **Express 4 → 5.2.1**, which removes the vulnerable `qs` behaviour from the
  dependency tree. Production audit is clean.
- **Server modules moved under `src/`.**
- **CI runs on Node 22 and 24** on `ubuntu-24.04`. Node 20 reached end of life
  and cannot run the suite: `node --test` only expands its own glob patterns
  from Node 22, so on 20 the pattern was treated as a literal path and no test
  ran at all.
- **WebSocket parameters are validated against an explicit allowlist** rather
  than an object-membership check, which accepted `__proto__`.
- **History uses monotonic sequence IDs** instead of array indices.

### Removed

Claims and code that could not be supported:

- **Fabricated performance claims.** A binary-search heatmap, a memory pool,
  sub-millisecond rendering and a `requestAnimationFrame` loop were all
  documented but did not exist. Replaced with measured numbers from
  `scripts/benchmark.js`.
- **A placeholder "demo" image.** The README showed a grey block where a
  recording would go. It implied a demo existed. There is now no image and a
  comment saying so.
- **A dead performance predictor** and its prototype files.
- **A frame-cost badge**, which invited readers to compare a figure measured
  on one machine against their own.

### Fixed in the tooling

The verifiers had bugs of their own, each caught only after being shown to fail:

- `verify-readme` reported a missing `architecture.svg` as success, skipping
  roughly twenty checks.
- The check that a diagram's XML was well formed shelled out to `xmllint`,
  which is absent from GitHub's runner image, and its fallback was unreachable
  code. Validation now runs in Node with no external binary.
- Timing comparisons failed on GitHub because the runner was faster than the
  authoring machine. They are now local-only behind `--timings`; the
  deterministic accuracy figures stay in CI.
- The diagram's path-loss formula omitted the reference loss and the wall term,
  and the check that guarded it only matched its first three terms.

### Documentation

- README rewritten around measured numbers, with the architecture diagram and
  the model, performance and testing detail split into `docs/`.
- `CONTRIBUTING.md`, this changelog, and CI covering lint, format, tests,
  diagrams and a production dependency audit.
