# Real data

The simulator invents its own RSSI. This is the other half of the tool: push in
what a phone actually measured at known coordinates, and the map interpolates
between those points instead of drawing a model.

Two things are deliberately not done here:

- **Nothing is extrapolated.** A cell further than 3 m from every sample is
  drawn hatched, not coloured. Colouring it with the value for `MIN_RSSI` would
  look like "we surveyed here and measured nothing", which is a claim nobody
  made.
- **A bad reading rejects the whole request.** A 400-row survey with three typos
  should not become a 397-row map that looks complete. The 400 names the index
  and the field.

## Posting readings

One reading, or an array. `{x, y, rssi}` in metres and dBm.

```sh
# One point.
curl -sS -X POST http://localhost:3000/api/readings \
  -H 'content-type: application/json' \
  -d '{"x":10,"y":7.5,"rssi":-58}'

# A batch from a script: x,y,rssi on stdin, one JSON array per line.
awk -F, 'NR>1 {printf "{\"x\":%s,\"y\":%s,\"rssi\":%s},\n", $1, $2, $3}' \
  docs/examples/sample-readings.csv \
  | sed 's/,$//' | tr -d '\n' | sed 's/^/[/;s/$/]/' \
  | curl -sS -X POST http://localhost:3000/api/readings \
      -H 'content-type: application/json' --data-binary @-
```

The response says what happened, including anything evicted:

```json
{
  "accepted": 42,
  "stored": 42,
  "evicted": 0,
  "total": 42,
  "droppedTotal": 0,
  "readings": 42
}
```

### Limits

| Limit                | Value     | Why                                        |
| -------------------- | --------- | ------------------------------------------ |
| Readings per request | 500       | Bounded work per request                   |
| Request body         | 100KB     | Transport-level, before the JSON is parsed |
| Stored readings      | 5000      | Oldest dropped past this                   |
| `x`                  | 0..20     | Inside the room (`ROOM_WIDTH`)             |
| `y`                  | 0..15     | Inside the room (`ROOM_HEIGHT`)            |
| `rssi`               | -100..-20 | Inside `MIN_RSSI`..`MAX_RSSI`              |

Numbers must be actual JSON numbers. `"10"` is rejected rather than coerced: a
survey file with a stray text column should be told, not half-understood.

### Authenticating

Set `READINGS_TOKEN` and both ingest routes require it:

```sh
curl -sS -X POST http://localhost:3000/api/readings \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $READINGS_TOKEN" \
  -d '{"x":10,"y":7.5,"rssi":-58}'
```

Unset means open, which is right for a local install. The comparison is
digest-then-compare, so a length mismatch does not short-circuit it. Exports are
not guarded: reading what is already stored mutates nothing.

## CSV import

`POST /api/import/readings.csv`, `content-type: text/csv`, header `x,y,rssi`.

```sh
curl -sS -X POST http://localhost:3000/api/import/readings.csv \
  -H 'content-type: text/csv' \
  --data-binary @docs/examples/sample-readings.csv
```

```
x,y,rssi
1.04,1.08,-50.8
4.25,1.23,-47.8
9.77,1.53,-49.6
```

Rules:

- The header must be exactly `x,y,rssi`, in that order. Surrounding spaces are
  fine.
- Blank lines are skipped. A row with fewer than three columns is refused with
  its line number.
- **An empty cell is an error, not a `0`.** `Number('')` is `0`, which would
  silently place a reading at the origin, so it becomes an invalid reading with
  a message that says `y must be a finite number`.
- The same validation and the same limits as the JSON path.

`docs/examples/sample-readings.csv` is 42 points on a jittered walk of the room,
generated from `PathLossModel` with fading off plus a small deterministic offset
— so it round-trips, and the error figure has something to be non-zero about.

The sidebar has a file picker that posts the file straight to this route, so
the browser never parses it and the picker cannot disagree with `curl`.

## Reading it back

```sh
curl -sS http://localhost:3000/api/export/measured.csv
```

Same format the import accepts, so a survey round-trips. This is deliberately
**not** `heatmap.csv`, which is the model's grid: merging the two would quietly
relabel synthetic values as measurements. With nothing ingested it returns a
header-only file rather than a 404 — asking for measurements when there are
none is a state, not a missing resource.

## Looking at it

Press **M** to cycle the map between the model and the measured layer. Sample
points are drawn as white dots. Measured mode falls back to the model grid when
nothing has been ingested, and says so.

The sidebar shows the reading count, the RMSE between the model and the
measurements at the sample points, and how many cells have data. The RMSE moves
when you move a slider, because it is the error of the model currently
configured.

## Interpolation

Inverse-distance weighting, power 2, nearest 8 samples, onto the same 1 m grid
cells the model uses so the two layers are directly comparable.

- A cell sitting **exactly** on a sample takes that sample's value. This is what
  lets the RMSE measure the model rather than the interpolator.
- Readings are stored at 2 decimal places; the grid publishes 1, the same
  precision as the model's own heatmap.
- No data within 3 m means no data, not a guess.

## An ESP32 posting readings

A survey device: an ESP32 with a Wi-Fi radio walks a known path, records RSSI at
fixed intervals, and posts each point with its own coordinates.

```cpp
// Survey sketch: post RSSI at a fixed coordinate as you walk.
//
// The coordinates are set by the walker - the point of a survey is that the
// device knows where it is. A phone reading RSSI with no position is not a
// survey and will not interpolate into anything useful.

#include <WiFi.h>
#include <HTTPClient.h>

const char* SSID     = "your-ssid";
const char* PASSWORD = "your-password";
const char* HOST     = "192.168.1.50";     // where the server runs
const char* PATH     = "/api/readings";
const char* TOKEN    = "";                  // set if READINGS_TOKEN is set

const float X = 10.0;   // metres, where this reading was taken
const float Y = 7.5;

// Post one reading. Returns the server's reply, or an empty string on failure.
String postReading(float x, float y, int rssi) {
  HTTPClient http;
  String url = String("http://") + HOST + PATH;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  if (strlen(TOKEN) > 0) {
    http.addHeader("Authorization", String("Bearer ") + TOKEN);
  }

  // Sent as one point rather than an array so a lost packet costs one
  // measurement, not a batch.
  char body[96];
  snprintf(body, sizeof(body), "{\"x\":%.2f,\"y\":%.2f,\"rssi\":%d}", x, y, rssi);

  int code = http.POST((uint8_t*)body);
  String reply = (code > 0) ? http.getString() : String("");
  http.end();
  if (code != 201) {
    // 400 means the reading was rejected and the message says why - log it.
    // Silently dropping bad readings is how a survey ends up with holes.
    Serial.printf("POST %d: %s\n", code, reply.c_str());
  }
  return reply;
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(SSID, PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  Serial.println(WiFi.localIP());

  // Synchronous WiFi on the main loop, which is fine for a survey device and
  // would starve an interactive one. A real survey walker would buffer and
  // batch instead, because WiFi drops out between access points.
  int32_t rssi = WiFi.RSSI();
  // WiFi.RSSI() returns dBm already, usually -40..-95 for a usable link.
  if (rssi >= -100 && rssi <= -20) {
    postReading(X, Y, rssi);
  } else {
    Serial.printf("implausible RSSI %d, not posting\n", rssi);
  }
}

void loop() {}
```

Two things that bite in practice:

- **Check the server's answer.** A 400 carries the reason. The server also rejects
  an RSSI outside -100..-20, which is what a spurious reading usually is.
- **Coordinates have to be real.** In a building that means a surveyed map or a
  tag system, not `WiFi.RSSI()` against a guessed position.

## In a public demo

Everything above works on a local install. In a demo deployment
(`DEMO_MODE=1`, see [deploy.md](deploy.md)) the picture is deliberately
different:

- **The routes answer `403`.** `POST /api/readings` and
  `POST /api/import/readings.csv` are closed, and a valid `READINGS_TOKEN` does
  not reopen them. There is nowhere for a visitor's readings to go.
- **The store starts full, not empty.** At boot the demo loads the bundled
  [`docs/examples/sample-readings.csv`](examples/sample-readings.csv) - 42
  points - so the Measured panel and the measured map mode work immediately. The
  panel is headed "Sample survey (demo data)" to say whose measurements these are
  not.
- **The import and clear controls are hidden.** An import button that can only
  return `403` is worse than no button, and clearing would leave a visitor with
  an empty panel and no way to refill it.
- **The idle reset restores that survey.** It does not empty the store, for the
  same reason: a visitor who waits ten minutes should come back to the room as
  they left it.

None of this changes a local install. With `DEMO_MODE` unset the routes are
open, the store starts empty, and the panel reads "Measured".

## See also

- [Architecture](architecture.md) — where the routes live
- [Testing](testing.md) — what the suite checks about this
