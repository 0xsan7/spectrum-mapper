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
- **A CI matrix on Node 22 and 24** on `ubuntu-24.04`, covering lint, format,
  tests, diagram validation and a production dependency audit.
- **A Docker image, built and health-checked in CI.** The job builds the image,
  runs it detached on port 3000, polls `/api/summary` for up to 30 seconds and
  prints the container logs if it never answers, always stopping it afterwards.
  Building the image is not the same as proving it runs.
- **A dashboard screenshot** at `docs/screenshot.png`, captured from a running
  server rather than drawn to look like one.
- **`CHANGELOG.md`, `CONTRIBUTING.md` and the `docs/` pages**: model,
  architecture, performance, testing, the generated file tree, and the
  self-contained architecture diagram and structure banner.

### Fixed

Bugs found while doing the above, each with a test that fails without the fix.

- **The dBm legend fell below the fold.** `#heatmapCanvas` was `width: 100%`
  with no height limit, so the 4:3 canvas grew off the column width and pushed
  the legend out of view — 158px below a 1440x800 viewport and 134px below
  1366x768. The README had been claiming a legend the whole time.
- **The canvas now fits the viewport and keeps 4:3.** The cap needs a definite
  height on `.container` to resolve against or it silently does nothing, and
  the canvas uses `max-width`/`max-height` with both axes `auto` so it scales
  by the same factor on each. Pinning one axis and clamping only the other
  squashed the 20x15 m room to 2.04:1.
- **README claims are checked against the code.** The verifier reads each
  figure from the file that now owns it, and fails loudly when that file is
  missing instead of matching nothing. Timing comparisons are local-only behind
  `--timings`, since the runner is not the authoring machine; the
  deterministic accuracy figures stay in CI.

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
- **`engines.node` now requires `>=22`.** Node 20 reached end of life and
  cannot run the suite: `node --test` only expands its own glob patterns from
  Node 22, so on 20 the pattern was treated as a literal path and no test ran at
  all — silently, with a passing command.
- **The server binds `127.0.0.1` by default.** It previously bound every
  interface, putting an unauthenticated control surface on the local network.
  The Docker image sets `HOST=0.0.0.0`, because a published port cannot reach a
  loopback-bound process; set `HOST=0.0.0.0` yourself to expose it locally.
- **The README was restructured.** The model, performance and testing detail
  moved into `docs/` behind one Docs table, taking the front page from 446 lines
  to under 200.
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
  recording would go, implying a demo existed. Replaced by a real screenshot of
  the running app; the README still states plainly that no demo has been
  recorded, because a screenshot is not a recording.
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
- The diagram's path-loss formula omitted the reference loss and the wall term,
  and the check that guarded it only matched its first three terms.

### Documentation

- README rewritten around measured numbers, with the architecture diagram and
  the model, performance and testing detail split into `docs/`.
- `CONTRIBUTING.md`, this changelog, and CI covering lint, format, tests,
  diagrams and a production dependency audit.
