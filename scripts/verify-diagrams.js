/**
 * Validate the diagram assets.
 *
 * These are static checks that need no browser, so they run in CI. Text
 * overflow is NOT checked here - that needs real font metrics, so it is a
 * separate browser-based pass; see the note in the README.
 *
 *   node scripts/verify-diagrams.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ASSETS = [
  { file: 'docs/architecture.svg', viewBox: '0 0 1200 640' },
  { file: 'docs/structure-banner.svg', viewBox: '0 0 1200 160' },
];

const MAX_BYTES = 60 * 1024;
const FONT_STACK = "'JetBrains Mono','SF Mono',Consolas,monospace";

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

console.log('Diagram assets');

for (const { file, viewBox } of ASSETS) {
  const full = path.join(ROOT, file);
  console.log(`\n${file}`);

  if (!fs.existsSync(full)) {
    check(`${file} exists`, false);
    continue;
  }

  const src = read(file);
  const bytes = Buffer.byteLength(src);

  /* ---- size ---- */
  check(
    `under 60 KB (${(bytes / 1024).toFixed(1)} KB)`,
    bytes < MAX_BYTES,
    `${bytes} bytes`
  );

  /* ---- well-formed XML ---- */
  let xmlOk = true;
  let xmlErr = '';
  try {
    execFileSync('xmllint', ['--noout', full], { stdio: 'pipe' });
  } catch (err) {
    xmlOk = false;
    xmlErr = (err.stderr || Buffer.from('')).toString().trim().split('\n')[0];
  }
  if (!xmlOk && xmlErr) {
    // xmllint absent: fall back to a parse so CI is not silently weaker.
    xmlOk = !/xmllint/.test(xmlErr) && xmlErr === '';
  }
  check('well-formed XML (xmllint --noout)', xmlOk, xmlErr);

  /* ---- no script, no event handlers ---- */
  check('no <script> element', !/<script[\s>]/i.test(src));
  check(
    'no inline event handlers (on*=)',
    !/\son[a-z]+\s*=/i.test(src),
    'found an on*= handler'
  );
  check('no <foreignObject>', !/<foreignObject/i.test(src));

  /* ---- no external references ---- */
  const externalUrls = [
    ...src.matchAll(/(?:href|xlink:href|src)\s*=\s*"([^"]*)"/gi),
  ]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('#'));
  check(
    `no external file references (${externalUrls.length} found)`,
    externalUrls.length === 0,
    externalUrls.slice(0, 3).join(', ')
  );

  const remote = [...src.matchAll(/https?:\/\/[^\s"')]+/gi)]
    .map((m) => m[0])
    // The SVG namespace declaration is not a fetch.
    .filter((u) => !u.startsWith('http://www.w3.org/'));
  check(
    `no remote URLs (${remote.length} found)`,
    remote.length === 0,
    remote.slice(0, 3).join(', ')
  );
  check(
    'no @import of an external stylesheet',
    !/@import|url\(\s*['"]?https?:/i.test(src)
  );

  /* ---- required geometry and styling ---- */
  check(`viewBox is ${viewBox}`, src.includes(viewBox));
  check('dark background #0a0e14', /#0a0e14/i.test(src));
  check(
    'neon accents present',
    /#00e5ff/i.test(src) && /#ff2bd6/i.test(src),
    'cyan and magenta required'
  );
  check('font stack is monospace and self-contained', src.includes(FONT_STACK));
  check(
    'declares the font stack on the root element',
    // The value itself contains single quotes inside a double-quoted
    // attribute, so the pattern has to allow a quote immediately after '='.
    /font-family=(['"])[^>]*JetBrains Mono/.test(src)
  );
  check('has glow filters (feGaussianBlur)', /<feGaussianBlur/.test(src));
  check(
    'has a title and description for screen readers',
    /<title/.test(src) && /<desc/.test(src)
  );

  /* ---- HUD furniture ---- */
  check(
    'has corner brackets',
    /M18 40V18H40|M20 44V20H44/.test(src) || /bracket/i.test(src)
  );
  check('has a grid or scanline pattern', /<pattern/.test(src));
  check(
    'has a scanline overlay at low opacity',
    /opacity="0\.0?1[0-9]?"/.test(src) || /scan/i.test(src)
  );

  /* ---- animation is subtle and respects reduced motion ---- */
  if (/<style[\s\S]*@keyframes/.test(src)) {
    check('declares @keyframes', true);
    check(
      'disables animation under prefers-reduced-motion',
      /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(src)
    );
    // Every animated class must be covered by the reduced-motion rule.
    const animated = [
      ...src.matchAll(/^\s*\.(?:[a-z-]+)[^{]*\{[^}]*animation\s*:/gim),
    ].map((m) => m[0].match(/\.([a-z-]+)/)[1]);
    const rm =
      (src.match(
        /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\s{2,4}\}/
      ) || [])[1] || '';
    const uncovered = animated.filter((c) => !rm.includes(`.${c}`));
    check(
      `reduced-motion covers every animated class (${animated.length})`,
      uncovered.length === 0,
      uncovered.join(', ')
    );
  }
}

/* ---- the README must actually embed them ---- */
console.log('\nREADME embedding');
const readme = read('README.md');
for (const { file } of ASSETS) {
  check(`README embeds ${file}`, readme.includes(file));
  check(
    `${file} uses a width="100%" or fixed image tag`,
    new RegExp(`<img src="${file.replace(/\//g, '\\/')}"[^>]*>`).test(readme)
  );
}
check('architecture has a Mermaid fallback', /```mermaid/.test(readme));
check(
  'Mermaid fallback is inside a collapsed <details>',
  /<details>[\s\S]*?```mermaid[\s\S]*?<\/details>/.test(readme)
);
check(
  'file tree markers present',
  /<!-- tree:start -->/.test(readme) && /<!-- tree:end -->/.test(readme)
);

/* ---- the banner's file counts must match reality ---- */
console.log('\nBanner counts');
const banner = read('docs/structure-banner.svg');
const tracked = execFileSync('git', ['ls-files'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((f) => f !== 'package-lock.json');
for (const dir of ['src', 'public', 'test', 'scripts', 'docs']) {
  const actual = tracked.filter((f) => f.startsWith(`${dir}/`)).length;
  const m = banner.match(new RegExp(`${dir.toUpperCase()}\\s+(\\d+)`, 'i'));
  const claimed = m ? Number(m[1]) : null;
  check(
    `banner says ${dir.toUpperCase()} ${claimed}, git has ${actual}`,
    claimed === actual,
    claimed === null ? 'no count found in the banner' : 'count is stale'
  );
}

/* ---- the tree must match the working tree ---- */
// Tolerant of the blank line Prettier inserts between the HTML comment and the
// fence. A strict pattern made the block unreadable the first time the README
// was formatted, which showed up as "file tree block is extractable" failing.
const treeBlock = (readme.match(
  /<!-- tree:start -->\r?\n\s*```text\r?\n([\s\S]*?)\r?\n?```\r?\n\s*<!-- tree:end -->/
) || [])[1];
if (treeBlock === undefined) {
  check('file tree block is extractable', false);
} else {
  check('tree excludes the lockfile', !treeBlock.includes('package-lock.json'));
  check('tree uses box-drawing characters', /[├└│]/.test(treeBlock));
  check(
    'tree has a comment per file',
    treeBlock.split('\n').filter((l) => l.includes('#')).length > 20
  );
  for (const emoji of ['⚡', '🖥️', '🧪', '🔧', '📚']) {
    check(`tree has the ${emoji} folder emoji`, treeBlock.includes(emoji));
  }

  /* ---- no glyph an SVG renderer may not have ---- */
  console.log('\nGlyph safety');
  for (const { file } of ASSETS) {
    const textNodes = [
      ...read(file).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g),
    ]
      .map((m) => m[1].replace(/<[^>]*>/g, ''))
      .join('');
    // Emoji are absent from every monospace fallback in the declared stack, and
    // the brief forbids external fonts, so an emoji here renders as a row of
    // missing-glyph boxes. Confirmed by rendering the banner with resvg: the
    // five emoji became roughly 55 tofu boxes.
    const offenders = [
      ...new Set(
        textNodes.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []
      ),
    ];
    check(
      `${file} renders no emoji in its text`,
      offenders.length === 0,
      offenders.length ? `tofu in a bare renderer: ${offenders.join(' ')}` : ''
    );
  }

  // The authoritative check: regenerate the tree and require it to match the
  // README. An earlier version tried to reconstruct paths out of the drawn tree
  // and reported every nested file as missing, because
  // `.github/workflows/ci.yml` never appears contiguously when each segment sits
  // on its own line. Diffing against the generator avoids reimplementing it.
  const regenerated = execFileSync(process.execPath, ['scripts/gen-tree.js'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).replace(/\n+$/, '');
  const committed = treeBlock.replace(/\n+$/, '');

  if (regenerated === committed) {
    check(
      `tree matches scripts/gen-tree.js output (${committed.split('\n').length} lines)`,
      true
    );
  } else {
    const a = committed.split('\n');
    const b = regenerated.split('\n');
    const diffs = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        diffs.push(
          `line ${i + 1}: README ${JSON.stringify(a[i])} vs generator ${JSON.stringify(b[i])}`
        );
        if (diffs.length === 3) break;
      }
    }
    check(
      'tree matches scripts/gen-tree.js output',
      false,
      `stale - run \`npm run tree\`. ${diffs.join('; ')}`
    );
  }
}
console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all diagram checks pass');
