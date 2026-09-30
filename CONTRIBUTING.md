# Contributing

Thanks for your interest in Spectrum Mapper!

## Setup

```bash
git clone https://github.com/0xsan7/spectrum-mapper.git
cd spectrum-mapper
npm ci
npm start
```

## Before opening a PR

```bash
npm run lint
npm test
npm run verify
```

## Guidelines

- Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- Add tests for any change to the path-loss model, heatmap, or trilateration.
- Keep README numbers honest. `npm run verify:readme` checks them.

## Ideas welcome

Dead-zone detection, router placement optimizer, record and replay, theme
toggle.
