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
- **The trilateration inverse is checked against exact geometry.**
- **Degenerate cases are explicit** — 1 receiver, coincident receivers,
  collinear receivers, readings below the noise floor.
- **The bandwidth invariant is measured.** A test fills the history buffer and
  asserts a live frame is at least 3× smaller than the same frame carrying
  everything.
- **CSV header and row order are checked against each other.**

Browser-side logic (the colour ramp, legend, chart scaling) is unit tested by
loading the real files into a VM context, so the tests exercise the shipped code
rather than a copy of it.

Each check above was added in response to something getting through
unnoticed; [CHANGELOG.md](../CHANGELOG.md) lists which.
