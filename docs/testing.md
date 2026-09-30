# Testing

> Part of the [Spectrum Mapper](../README.md) documentation.
> Moved out of the README to keep the front page short.

The suite runs on `node:test` with no test framework dependency.

```sh
npm test
```

They are written to fail when the behaviour is wrong, not merely to pass:

- **The physics is anchored to the model, not to constants copied out of it.** A
  known distance must round-trip through RSSI and back.
- **The trilateration inverse is checked against exact geometry.** Reverting the
  algebra to its earlier sign error made 15 of 28 tests fail.
- **Degenerate cases are explicit** — 1 receiver, coincident receivers,
  collinear receivers, readings below the noise floor.
- **The bandwidth invariant is measured.** A test fills the history buffer and
  asserts a live frame is at least 3× smaller than the same frame carrying
  everything. The bug that motivated it — an index-based delta cursor that
  silently froze the chart after two minutes — was caught by a test asserting
  one sample per frame at capacity, not by reading the code.
- **CSV header and row order are checked against each other**, after a real bug
  paired every heatmap cell with the wrong transmitter's coordinates.

Browser-side logic (the colour ramp, legend, chart scaling) is unit tested by
loading the real files into a VM context, so the tests exercise the shipped code
rather than a copy of it.
