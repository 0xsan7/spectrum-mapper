#!/usr/bin/env node
/**
 * Mutation audit for the phase 2 verifier checks.
 *
 * Every check added or changed for the heatmap work is broken in turn, and the
 * check is required to go red. A check that survives its own mutation is a
 * check that does not test what it claims to test.
 *
 * Run: node scripts/mutation-phase2.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const R = (f) => path.join(ROOT, f);
const read = (f) => fs.readFileSync(R(f), 'utf8');
const write = (f, s) => fs.writeFileSync(R(f), s);

/**
 * Run a command and report whether it failed.
 *
 * A mutation is routed to the layer that can actually see it. Most of the new
 * checks are static greps in verify-readme, but a behaviour change is better
 * caught by a behavioural test - and sometimes it is *only* catchable there.
 * The Oklab conversion is the example: stubbing `oklabToSrgb` leaves the real
 * body as dead code, so every token a grep could look for is still present and
 * verify:readme stays green. `npm test` goes red, because a ramp that no
 * longer spans dark to light fails the actual maths.
 */
function runFails(cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: ROOT, stdio: 'pipe' });
    return { red: false, out: '' };
  } catch (e) {
    return { red: true, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const verifyFails = () => runFails('npm', ['run', '--silent', 'verify:readme']);

/** The names of checks that failed in a given verify run. */
function failedNames(out) {
  return [...out.matchAll(/FAIL\s+(.+)/g)].map((m) => m[1].trim());
}

const mutations = [
  {
    name: 'shortcut K removed from shortcuts.js',
    expect: 'K is implemented',
    file: 'public/shortcuts.js',
    find: `        case 'k':\n          // The colour ramp, not R: R is already reset, and a shortcut that\n          // does something destructive is a bad neighbour to one that only\n          // changes how the map looks.\n          dashboard.cycleRamp();\n          break;\n`,
    replace: '',
  },
  {
    name: 'shortcut K calls the wrong thing',
    expect: 'K is implemented',
    file: 'public/shortcuts.js',
    find: '          dashboard.cycleRamp();',
    replace: '          dashboard.cycleMapMode();',
  },
  {
    name: 'K commented out (comment-stripping must catch it)',
    expect: 'K is implemented',
    file: 'public/shortcuts.js',
    find: `        case 'k':\n          // The colour ramp, not R: R is already reset, and a shortcut that\n          // does something destructive is a bad neighbour to one that only\n          // changes how the map looks.\n          dashboard.cycleRamp();\n          break;\n`,
    replace: `        case 'k':\n          // The colour ramp, not R: R is already reset, and a shortcut that\n          // does something destructive is a bad neighbour to one that only\n          // changes how the map looks.\n          // dashboard.cycleRamp();\n          break;\n`,
  },
  {
    name: 'shortcut M calls the wrong thing',
    expect: 'M is implemented',
    file: 'public/shortcuts.js',
    find: '          dashboard.cycleMapMode();',
    replace: '          dashboard.cycleRamp();',
  },
  {
    name: 'shortcut R calls the wrong thing',
    expect: 'R is implemented',
    file: 'public/shortcuts.js',
    find: "case 'r':\n          document.getElementById('resetBtn').click();",
    replace: "case 'r':\n          dashboard.cycleRamp();",
  },
  {
    name: 'K removed from the README controls table',
    expect: 'K is documented in the controls table',
    file: 'README.md',
    // The WHOLE row, key cell included. Replacing only the action cell left the
    // "`K" behind, so the table still documented the shortcut and the check
    // correctly stayed green - a bad mutation, not a weak check.
    find: /\| Cycle colour ramp\s*\|\s*`K`\s*\|\n/,
    replace: '| Cycle palette | `X` |\n',
  },
  {
    name: 'default ramp put back to the classic blue-red one',
    expect: 'a perceptual ramp is the default',
    file: 'public/colors.js',
    find: "static DEFAULT_RAMP = 'inferno';",
    replace: "static DEFAULT_RAMP = 'classic';",
  },
  {
    name: 'the colour-blind-safe ramp removed',
    expect: 'a colour-blind-safe ramp is offered',
    file: 'public/colors.js',
    find: 'cividis',
    replace: 'blueish',
    all: true,
  },
  {
    name: 'Oklab conversion swapped for a plain sRGB lerp',
    expect: null, // caught by the behaviour tests, not by a grep
    layer: 'tests',
    file: 'public/colors.js',
    find: 'static oklabToSrgb(L, a, bb) {',
    replace:
      'static oklabToSrgb(L, a, bb) {\n    return [Math.round(L * 255), Math.round(a * 255), Math.round(bb * 255)];',
  },
  {
    name: 'Oklab -> sRGB deleted',
    expect: null, // caught by the behaviour tests, not by a grep
    layer: 'tests',
    file: 'public/colors.js',
    find: 'static oklabToSrgb(L, a, bb) {',
    replace: 'static oklabToSrgbRemoved(L, a, bb) {',
  },
  {
    name: 'colour licence note removed',
    expect: 'colour data carries its licence',
    file: 'public/colors.js',
    find: "matplotlib's colormaps are released under a permissive notice allowing\n * redistribution with attribution; the provenance is recorded here rather than\n * in a separate file so it cannot drift from the numbers.",
    replace: 'The tables are copied from somewhere.',
  },
  {
    name: 'renderer hard-codes the ramp instead of reading it',
    expect: 'renderer reads its ramp at paint time',
    file: 'public/heatmap.js',
    find: 'this.ramp',
    replace: "'inferno'",
    all: true,
  },
  {
    name: 'legend gradient hand-written instead of generated',
    expect: 'legend is generated from the ramp',
    file: 'public/legend.js',
    find: /this\.bar\.style\.background = ColorMapper\.toGradient\([\s\S]{0,80}?\);/,
    replace:
      "this.bar.style.background = 'linear-gradient(to right, blue, red)';",
  },
  {
    name: 'README stops naming the ramps',
    expect: 'README names the ramp default',
    file: 'README.md',
    find: 'inferno',
    replace: 'the default ramp',
    all: true,
  },
  {
    name: 'contour levels changed to -60/-80',
    expect: 'contour levels are declared once',
    file: 'public/heatmap.js',
    find: 'const CONTOUR_LEVELS = [-50, -70, -85];',
    replace: 'const CONTOUR_LEVELS = [-60, -80, -95];',
  },
  {
    name: 'contour levels moved out of the single declaration',
    expect: 'contour levels are declared once',
    file: 'public/heatmap.js',
    find: 'const CONTOUR_LEVELS = [-50, -70, -85];',
    replace: '',
  },
  {
    name: 'README/docs stop stating the contour levels',
    expect: 'documented contour levels are the drawn ones',
    file: 'README.md',
    find: '**-50, -70 and -85 dBm**',
    replace: '**several levels**',
  },
  {
    name: 'marching-squares saddle cases dropped',
    expect: 'contours are traced by marching squares',
    file: 'public/heatmap.js',
    find: '        case 5:\n          segments.push([left, top], [bottom, right]);\n          break;\n        case 10:\n          segments.push([top, right], [left, bottom]);\n          break;\n',
    replace: '',
  },
  {
    name: 'contour tracer deleted',
    expect: 'contours are traced by marching squares',
    file: 'public/heatmap.js',
    find: 'function contourSegments(grid, cols, rows, level) {',
    replace: 'function contourSegmentsRemoved(grid, cols, rows, level) {',
  },
  {
    name: 'tracer treats a null sample as zero dBm',
    expect: 'null sample is skipped by the contour tracer',
    file: 'public/heatmap.js',
    find: 'if (!point || point.rssi === null || point.rssi === undefined) return null;',
    replace: 'if (!point) return 0;',
  },
  {
    name: 'painter fills null samples instead of leaving them transparent',
    expect: 'null sample is left transparent by the painter',
    file: 'public/heatmap.js',
    find: `        const isGap =
          !point ||
          point.rssi === null ||
          point.rssi === undefined ||
          (maskGaps && point.hasData === false);`,
    replace: `        const isGap =
          !point || (maskGaps && point.hasData === false);`,
  },
  {
    name: 'the dark contour casing removed (line invisible over bright field)',
    expect: 'dark casing under a light core',
    file: 'public/heatmap.js',
    find: /this\.ctx\.strokeStyle = `rgba\(8, 11, 16,[^`]*\)`;\n\s{6}this\.ctx\.lineWidth = style\.width \+ 1\.6;\n\s{6}this\.ctx\.stroke\(\);\n/,
    replace: '',
  },
  {
    name: 'casing made narrower than the core',
    expect: 'casing is wider than the core',
    file: 'public/heatmap.js',
    find: 'this.ctx.lineWidth = style.width + 1.6;',
    replace: 'this.ctx.lineWidth = style.width - 1;',
  },
  {
    name: 'the whole ramp pushed into the light half (no dark bracket left)',
    expect: 'spans both light and dark',
    file: 'public/colors.js',
    find: /cividis:\s*\{[\s\S]{0,80}?points:\s*\[[\s\S]*?\],/,
    replace:
      'cividis: { label: 1, points: [[250,250,250],[252,252,250],[254,252,254]], },',
  },
  {
    name: 'the whole ramp pushed into the dark half',
    expect: 'spans both light and dark',
    file: 'public/colors.js',
    find: /classic:\s*\{[\s\S]{0,80}?points:\s*\[[\s\S]*?\],/,
    replace: 'classic: { label: 1, points: [[4,4,4],[6,6,6],[8,8,8]], },',
  },
  {
    name: 'both contour tones painted the same colour',
    expect: 'tones are far enough apart',
    file: 'public/heatmap.js',
    find: /this\.ctx\.strokeStyle = `rgba\(8, 11, 16,[^`]*\)`;/,
    replace: 'this.ctx.strokeStyle = `rgba(255, 255, 255, 0.92)`;',
  },
  {
    name: 'casing moved after the core, so the core is buried',
    expect: 'casing is stroked before the light core',
    file: 'public/heatmap.js',
    // Swap the two strokes, not just recolour one: recolouring leaves the
    // order intact and the order check correctly stays green.
    find: /(this\.ctx\.strokeStyle = `rgba\(8, 11, 16,[^`]*\)`;\n(?:[^\n]*\n){0,2}?\s*this\.ctx\.stroke\(\);\n)(\n\s*this\.ctx\.strokeStyle = `rgba\(255, 255, 255,[^`]*\)`;\n(?:[^\n]*\n){0,2}?\s*this\.ctx\.stroke\(\);)/,
    replace: '$2\n$1',
  },
  {
    name: 'ramp control points deleted, leaving nothing to reason about',
    expect: 'has ramp colours to reason about',
    file: 'public/colors.js',
    find: /cividis:\s*\{[\s\S]{0,80}?points:\s*\[[\s\S]*?\],/,
    replace: 'cividis: { label: 1, points: [], },',
  },
];

const files = [
  'public/colors.js',
  'public/heatmap.js',
  'public/legend.js',
  'public/shortcuts.js',
  'README.md',
  'scripts/verify-readme.js',
];
const backup = {};
for (const f of files) backup[f] = read(f);

console.log(`Phase 2 mutation audit - ${mutations.length} mutations\n`);

// The clean tree must pass, or nothing below means anything.
const clean = verifyFails();
if (clean.red) {
  console.error('FAIL  the clean tree is already failing. Fix that first:');
  console.error(
    failedNames(clean.out)
      .map((n) => `        ${n}`)
      .join('\n')
  );
  process.exit(1);
}
console.log('  ok    clean tree passes verify:readme\n');

let killed = 0;
const survivors = [];
const unrestorable = [];

for (const m of mutations) {
  const src = backup[m.file];
  const patternPresent =
    m.find instanceof RegExp ? m.find.test(src) : src.includes(m.find);
  if (!patternPresent) {
    unrestorable.push(`${m.name} (pattern not found in ${m.file})`);
    console.log(`  SKIP  ${m.name} - pattern not found in ${m.file}`);
    continue;
  }

  let mutated;
  if (m.find instanceof RegExp) {
    mutated = src.replace(m.find, m.replace);
  } else if (m.all) {
    mutated = src.split(m.find).join(m.replace);
  } else {
    mutated = src.replace(m.find, m.replace);
  }
  if (mutated === src) {
    unrestorable.push(`${m.name} (no change produced)`);
    console.log(`  SKIP  ${m.name} - mutation produced no change`);
    continue;
  }
  write(m.file, mutated);

  const result =
    m.layer === 'tests'
      ? runFails('node', ['--test', 'test/colormap.test.js'])
      : verifyFails();
  const names = failedNames(result.out);
  const label = m.expect || 'the colormap behaviour tests';
  // Substring, not prefix. The check is named "the contour levels are declared
  // once, in heatmap.js" while the mutation table calls it "contour levels are
  // declared once"; an exact or prefix match reported killed mutations as
  // survivors, which is the worst direction for an audit to be wrong in.
  const want = label.toLowerCase();
  const hit = names.find((n) => n.toLowerCase().includes(want));
  const caught = result.red && (!m.expect || Boolean(hit));

  if (caught) {
    killed++;
    console.log(`  red   ${m.name}  [${label}]`);
  } else {
    survivors.push(`${m.name}  [expected: ${label}]`);
    console.log(`  SURVIVED  ${m.name}`);
    if (result.red)
      console.log(`           other checks went red: ${names.join(', ')}`);
  }

  write(m.file, src);
}

console.log(`\n${killed} killed, ${survivors.length} survived`);
if (survivors.length) {
  console.log('\nSurvivors - the check is too weak:');
  for (const s of survivors) console.log(`  ${s}`);
}
if (unrestorable.length) {
  console.log('\nNot runnable - pattern drift:');
  for (const s of unrestorable) console.log(`  ${s}`);
}

// The tree must be byte-identical to how it started.
for (const f of files) {
  if (read(f) !== backup[f]) {
    console.error(`\nWARNING  ${f} was not restored. Run git status.`);
    process.exitCode = 1;
  }
}

process.exitCode = survivors.length || unrestorable.length ? 1 : 0;
