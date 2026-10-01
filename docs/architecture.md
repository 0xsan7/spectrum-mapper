# Architecture

> Part of the [Spectrum Mapper](../README.md) documentation.

The diagram, module responsibilities and HTTP API in full. Moved out of the
README to keep the front page short.

## Text version (Mermaid)

Same diagram, for renderers and readers that do not display SVG.

```mermaid
flowchart LR
  subgraph TX["Transmitters — 20 × 15 m room"]
    direction TB
    T1["TX-1 Router A<br/>20 dBm"]
    T2["TX-2 Router B<br/>15 dBm"]
    T3["TX-3 Mobile<br/>10 dBm · localised"]
    T4["TX-4 BLE Beacon<br/>5 dBm"]
  end

  subgraph S["NODE.JS SERVER — :3000"]
    direction TB
    S1["Simulation<br/>4 sources · step 500 ms"]
    S2["Path Loss<br/>RSSI = Tx − PL(d₀) − 10n·log₁₀(d/d₀) − walls − fading<br/>n = 2.7 · f = 2437 MHz · d₀ = 1 m"]
    S3["Heatmap Grid<br/>20 × 15 m ÷ 1 m = 300 cells<br/>−100…−20 dBm · 501 µs"]
    S4["Trilateration<br/>4 receivers · least squares<br/>1.8 m centre → 5.5 m edge"]
    S5["History<br/>240 samples = last 2 min"]
    S1 --> S2 --> S3 --> S4
  end

  subgraph B["BROWSER — Canvas 2D"]
    direction TB
    B1["WS Client<br/>1 socket · 2 frames/s<br/>snapshot then deltas"]
    B2["Canvas Heatmap<br/>cells · walls · trails · markers<br/>crosshair = estimate"]
    B3["RSSI Chart + Trails<br/>error on its own 0…max scale"]
    B4["Controls<br/>n · f · fading · drag · walls"]
    B1 --> B2 --> B3 --> B4
  end

  TX -- "RF" --> S2
  S3 -- "JSON / 500ms · ~17 KB" --> B1
  B4 -- "commands: move · setParam · addWall" --> S1
  S4 --> S5
```

| Module                 | Responsibility                                          |
| ---------------------- | ------------------------------------------------------- |
| `src/server.js`        | HTTP + WebSocket, state ownership, command validation   |
| `src/pathLoss.js`      | Log-distance model, dBm ↔ linear power, grid evaluation |
| `src/heatmap.js`       | Grid generation and statistics                          |
| `src/simulation.js`    | Transmitter positions, velocity, pinning                |
| `src/obstacles.js`     | Wall geometry and per-crossing attenuation              |
| `src/receivers.js`     | Receiver node state                                     |
| `src/trilateration.js` | RSSI → range → position                                 |
| `src/history.js`       | Rolling time-series buffer                              |
| `src/csv.js`           | CSV formatting                                          |
| `public/*`             | Canvas renderer, controls, chart, export                |

The server owns the simulation. The browser sends intent — "move this", "set
this parameter" — and renders the frames that come back. It never computes
physics locally, so two browsers open at once cannot disagree.

### API

```
GET  /api/summary                 rolling aggregates over the buffer
GET  /api/export/timeseries.csv   one row per sample
GET  /api/export/heatmap.csv      one row per grid cell
GET  /api/export/readings.csv     per-receiver readings behind the estimate
GET  /api/export/measured.csv     the readings that were ingested, not the model
GET  /api/export/frame.json       the whole frame
POST /api/readings                ingest one reading or an array
POST /api/import/readings.csv     the same, from a survey file
```
