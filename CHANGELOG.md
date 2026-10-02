# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0]

The release where the simulator stopped being only a simulator. You can now
feed it RSSI you measured yourself, compare that against what the model
predicted, and put the whole thing on the internet behind `DEMO_MODE` without
accidentally letting a stranger edit your transmitter positions.

Derived from `git log v1.1.0..HEAD` (15 commits).

### Added

**Real readings**

- **`POST /api/readings`** accepts one `{x, y, rssi}` object or an array of
  them. All-or-nothing: a 400-row survey with three typos is rejected whole,
  with a message naming the bad row, and none of it is stored.
- **Limits on ingest.** Finite numbers only; `x` and `y` inside the room;
  `rssi` inside `MIN_RSSI..MAX_RSSI`; 500 readings per request; 100 KB per body.
- **`READINGS_TOKEN`**, when set, requires `Authorization: Bearer …`. Unset, the
  endpoint is open, which is the documented behaviour for a local run.
- **A bounded store.** 5000 readings, oldest dropped first, so a device polling
  every second cannot exhaust memory.
- **`POST /api/import/readings.csv`** takes `text/csv` with the header
  `x,y,rssi`, under the same validation and limits.
- **`docs/examples/sample-readings.csv`**, a 42-point survey.

**Looking at real readings**

- **Inverse-distance interpolation** onto the existing grid: power 2, weighted
  over the 8 nearest samples. At a sample point the interpolation returns that
  sample's own value exactly.
- **No extrapolation.** Cells more than 3 m from every sample are no-data, drawn
  hatched. The model is not extended into territory nobody measured.
- **A measured mode** in the `M`-key map-mode cycle, with the sample points
  drawn as dots, and a CSV file picker in the sidebar.
- **Model-vs-measured RMSE**, in dB at the sample points, shown in the sidebar
  when readings exist — so you can see how wrong the model is where you know the
  answer.
- **`GET /api/export/measured.csv`**, the readings as CSV.

**Public demo mode**

- **`DEMO_MODE=1`** turns the app into a safe public copy: `POST /api/readings`
  and all of `/api/import/*` answer `403` (not even a valid `READINGS_TOKEN`
  gets through — the route is closed, not merely unauthorised), commands are
  limited to 20/s per client, 50 concurrent WebSocket clients are the cap, an
  optional `ALLOWED_ORIGINS` list is checked before the handshake, and the room
  returns to its defaults after ten minutes with no commands.
- **A banner in the UI**, because a shared room should not be a surprise:
  "Public demo: everyone shares the same simulated room."
- **`GET /healthz`**, answering independently of the simulation loop so a
  platform's health check cannot restart the app every 30 seconds.
- **`render.yaml`** for a free Docker web service, and **`docs/deploy.md`**
  walking through deploying your own copy and what free-tier sleeping means for
  visitors.

### Changed

- **Measured values are interpolated, not rendered per-reading**, so a handful
  of points produce a usable map instead of 42 dots.
- **`verify:readme` checks every registered route**, not just `GET`, and parses
  multiline route declarations. It missed `POST /api/readings` for a full commit.
- **The documentation checks were tightened three times over, each time because
  a mutation proved the check was vacuous**: a server check that matched the
  sample filename rather than the path that loads it; a `.dockerignore` check
  that ignored ordering, which Docker applies in order, so a negation written
  above the exclusion it undoes is dead; and a docs check that accepted any "42"
  on the page, satisfied by a JSON example's `"accepted": 42`.
- **The demo link checks became an exact-URL allowlist.** They used to forbid
  every host except Render and GitHub; now exactly one deployment URL is
  permitted, and a near-miss name, a subdomain of it, `http` rather than
  `https`, or `…onrender.com.evil.example` still fail.
- **The Dockerfile copies `docs/examples`.** It previously copied only `src`
  and `public`, so a demo image had no sample survey to load.

### Fixed

- **The WebSocket `Origin` check enforced nothing.** The upgrade guard was
  attached to an HTTP listener that never fires for a WebSocket upgrade, so
  every connection was accepted regardless of `ALLOWED_ORIGINS`. Fixed by
  moving to `WebSocket.Server({ noServer: true })` and checking at the upgrade.
- **A dragged transmitter survived the idle reset.** Clearing the pin set
  restored the _pin_ but not the _position_, so the next visitor inherited
  somebody's moved transmitter and their reading of the room.
- **Ingest validation accepted every coordinate.** `validateReading` referenced
  `config.roomWidth`/`roomHeight`, which do not exist; `x > undefined` is
  `false`, so every out-of-room point passed.
- **The bounded store never reached its cap.** `add` spliced before pushing, so
  the eviction ran against the wrong list.
- **The RMSE divisor could be wrong** without any test noticing, because every
  existing test used exactly two samples, where the correct divisor and a wrong
  fixed one agree.
- **Clearing readings in demo mode left the panel empty** with no way to refill
  it until the next idle reset. `clearReadings` is now refused in demo mode.
- **Three demo checks were satisfied by a function that was never called.**
  Deleting the call to the demo-chrome update left every static check green,
  and the browser harness found that hiding the wrapper left the Import button
  still laid out and clickable inside the flex container.

### A note on the sample data

`docs/examples/sample-readings.csv` is **model output with small offsets added,
not field measurements**. It exists so measured mode does something before you
have any readings of your own, and it ships in every demo. If you want to know
how good the model actually is, push your own survey and read the RMSE.

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
