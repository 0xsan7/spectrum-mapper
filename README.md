<!--
No demo GIF yet: none has been recorded, and a placeholder image would imply a
recording exists. See docs/README-hero.md for how to record one.
-->
<h1 align="center">Spectrum Mapper</h1>

<p align="center">
  Interactive 2.4 GHz RF coverage simulator, with position estimation from RSSI.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-it-does">Features</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#docs">Docs</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <a href="https://spectrum-mapper-demo.onrender.com"><strong>Live demo</strong></a>
</p>

<p align="center">
  Free hosting sleeps when idle, so the first load can take a while. Everyone
  shares one simulated room.
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Spectrum Mapper dashboard" width="100%">
</p>

<p align="center">
  <a href="https://github.com/0xsan7/spectrum-mapper/actions/workflows/ci.yml">
    <img src="https://github.com/0xsan7/spectrum-mapper/actions/workflows/ci.yml/badge.svg" alt="CI: lint, format, test, dependency audit" height="20">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT licensed" height="20">
  </a>
  <a href="https://nodejs.org/en/download">
    <img src="https://img.shields.io/badge/node-%3E%3D22-5FA04E" alt="Requires Node 22 or newer" height="20">
  </a>
  <a href="package.json">
    <img src="https://img.shields.io/badge/runtime%20deps-express%2C%20ws-5FA04E" alt="Two runtime dependencies: express and ws" height="20">
  </a>
</p>

---

## What it does

A browser map of a 20 × 15 m room showing where 2.4 GHz signal actually lands,
driven by a real log-distance path loss model rather than a decorative
gradient. Move the transmitters, draw walls, turn the propagation knobs, and
watch four receivers try to work out where the mobile device is.

- **Coverage heatmap** over a 1 m grid, with a dBm legend and a hover readout
- **Drag and drop** for transmitters and receivers; double-click a transmitter
  to release it back into motion
- **Live model controls** — path loss exponent, carrier frequency, fading
- **Wall obstacles** with per-wall dB attenuation, casting real shadows on the
  grid
- **Trilateration** of the mobile transmitter, with the estimate drawn against
  the true position and the error in metres
- **Localises the mobile transmitter to about 1.8 m near the centre and 5.5 m at
  the edges** (simulated, 3 dB fading)
- **Measured mode** — push real RSSI with `POST /api/readings` or import a survey
  CSV, and the map interpolates between your readings with M. Cells more than 3 m
  from every sample are hatched, never extrapolated
- **A bundled sample survey** so measured mode does something before you have
  any data of your own. It is model output with small offsets added, not field
  measurements — see [Real data](docs/real-data.md)
- **Model-vs-measured error** (RMSE in dB) at the sample points, so you can see
  how far the simulator is from the room it claims to model
- **RSSI and error time series**, plus movement trails
- **Export** the map as PNG, or the data as CSV/JSON over HTTP

## Quick start

Requires Node 22 or newer (tested on 22 and 24).

```sh
git clone https://github.com/0xsan7/spectrum-mapper.git
cd spectrum-mapper
npm install
npm start
```

Open <http://localhost:3000>.

```sh
npm run dev     # restart on file changes
npm test        # runs the suite once, no watch mode
npm run lint    # eslint
npm run format  # prettier --write
```

Or in Docker:

```sh
docker build -t spectrum-mapper .
docker run --rm -p 3000:3000 spectrum-mapper
```

### Controls

| Action                         | How                             |
| ------------------------------ | ------------------------------- |
| Move a transmitter or receiver | Drag it                         |
| Release a pinned transmitter   | Double-click it                 |
| Draw a wall                    | Press `W`, then drag on the map |
| Remove all walls               | `Clear walls` in the sidebar    |
| Pause / resume                 | `Space` or the Pause button     |
| Reset everything               | `R`                             |
| Cycle map mode                 | `M`                             |

### Configuration

Every value has a default, so the app runs with no `.env` at all. Copy
`.env.example` to `.env` to change any of them:

| Variable                     | Default        | Meaning                                           |
| ---------------------------- | -------------- | ------------------------------------------------- |
| `PORT`                       | `3000`         | HTTP port                                         |
| `HOST`                       | `127.0.0.1`    | Bind address                                      |
| `ROOM_WIDTH` / `ROOM_HEIGHT` | `20` / `15`    | Room size in metres                               |
| `GRID_RESOLUTION`            | `1`            | Metres per heatmap cell                           |
| `UPDATE_RATE`                | `500`          | Milliseconds between frames                       |
| `HISTORY_CAPACITY`           | `240`          | Samples kept in the time-series buffer            |
| `MIN_RSSI` / `MAX_RSSI`      | `-100` / `-20` | Display range in dBm                              |
| `HOTSPOT_THRESHOLD`          | `-40`          | RSSI above which a cell counts as a hotspot (dBm) |
| `READINGS_TOKEN`             | unset          | Bearer token for ingest; unset means open         |

Real process environment variables take precedence over `.env`.

### Public demo mode

`DEMO_MODE=1` turns this into a copy anyone can open. The room is shared, so
what one visitor can affect is bounded:

| Variable             | Default  | Meaning                                             |
| -------------------- | -------- | --------------------------------------------------- |
| `DEMO_MODE`          | `0`      | `1` enables everything in this table                |
| `DEMO_RATE_LIMIT`    | `20`     | Commands per second, per client                     |
| `DEMO_MAX_CLIENTS`   | `50`     | Concurrent WebSocket clients; over this answers 503 |
| `DEMO_IDLE_RESET_MS` | `600000` | Reset the room after this long with no commands     |
| `ALLOWED_ORIGINS`    | unset    | Comma-separated Origin allowlist for the socket     |

Ingest is refused with `403` in demo mode, a banner says the room is shared,
and `GET /healthz` answers independently of the simulation loop so a platform's
health check is not measuring the thing it is checking. Every variable above is
ignored unless `DEMO_MODE=1`, so a local install is unaffected.

[`render.yaml`](render.yaml) deploys a copy to Render from a blueprint;
[docs/deploy.md](docs/deploy.md) has the steps and what free-tier sleeping means
for visitors.

## The model

```
RSSI = Tx - PL(d0) - 10·n·log10(d/d0) - walls - fading
```

Transmit power, minus free-space loss at the reference distance, minus the
distance-dependent growth, minus whatever the walls and fading take away.

## Architecture

<p align="center">
  <img src="docs/architecture.svg" alt="Spectrum Mapper architecture" width="100%">
</p>

The server owns the simulation; the browser sends intent and renders what comes
back, so two browsers open at once cannot disagree. Module responsibilities and
the HTTP API are in
[docs/architecture.md](docs/architecture.md), which also carries a Mermaid
version of this diagram.

## Project structure

<p align="center">
  <img src="docs/structure-banner.svg" alt="Spectrum Mapper file system" width="100%">
</p>

Every tracked file, one line and a comment each —
[docs/tree.md](docs/tree.md). Regenerate with `npm run tree`.

## Docs

| Document                             | What is in it                                                      |
| ------------------------------------ | ------------------------------------------------------------------ |
| [Model](docs/model.md)               | The path-loss law, wall attenuation and fading, derived            |
| [Architecture](docs/architecture.md) | Module responsibilities, the HTTP API, Mermaid diagram             |
| [Performance](docs/performance.md)   | Measured cost and accuracy on the author's machine                 |
| [Testing](docs/testing.md)           | How the suite is structured and what each check protects           |
| [Real data](docs/real-data.md)       | Feeding measured RSSI in over HTTP or CSV, and reading it back out |
| [Deploy](docs/deploy.md)             | Running a public demo, and what free-tier sleeping means           |
| [File tree](docs/tree.md)            | Every tracked file, generated                                      |
| [Changelog](CHANGELOG.md)            | Release notes and the bugs fixed in each                           |

## Known limitations

- **The heatmap is a simulation, not a measurement.** It models one log-distance
  path; real rooms have reflections, shadowing, and material variation. Treat it
  as an educational model, not a site survey tool.
- **"Error in metres" is only meaningful against a simulated truth.** The server
  knows where the transmitter actually is because it is the one moving it. A real
  deployment has no such ground truth and would need a different metric.
- **Two receivers cannot disambiguate a mirrored position.** The tool shows both
  candidates rather than pretending to know which is right.
- **The grid is recomputed from scratch every frame.** Fine at 300 cells
  (0.5 ms), but it is O(cells × sources) and is the first thing that would need a
  spatial index at a much finer resolution.
- **No persistence.** Reloading loses walls, positions, and history.
- **No authentication.** Any client that can reach it can move everything. Set
  `READINGS_TOKEN` and the ingest routes need it; nothing else is guarded. It
  binds `127.0.0.1` by default so that is only your own machine; set
  `HOST=0.0.0.0` to expose it, and only on a network you control.

## Roadmap

Roughly in the order I expect to do them.

- [ ] **Persistence** — save and load room layouts, walls, and positions
- [ ] **Add and remove receivers**, since the estimator's behaviour is so
      sensitive to their geometry
- [ ] **Spatially coherent fading** — the current fading is per measurement, so it
      does not produce the smooth structure a real multipath field has
- [ ] **Obstacle library** — prebuilt wall types with realistic dB values
      (brick, concrete, drywall, glass) instead of a bare attenuation number
- [ ] **Fingerprinting mode** — walk a known path, record the RSSI curve, and
      compare a later walk against it
- [ ] **Faster grid** — spatial partitioning so resolution can go well past 1 m
      without the frame budget moving
- [ ] **Dead-zone detector** — find the areas coverage cannot reach, and suggest
      where to move or add a router to close them
- [ ] **Recorded demo GIF** — an actual capture of the app, none exists yet
- [ ] **A real accuracy metric** for when there is no simulated truth

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes to the physics model need a test
that fails before the change and passes after — the note there explains why.

## License

MIT — see [LICENSE](LICENSE).
