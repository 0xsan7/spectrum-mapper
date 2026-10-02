/**
 * The sidebar's five tabs.
 *
 * The sidebar used to be eleven panels in one scroll, which at 1440x800 put the
 * export buttons below the fold. Grouped into tabs it fits a laptop viewport
 * without scrolling.
 *
 * These check the WAI-ARIA tabs contract rather than the styling, because that
 * is the part a regression actually breaks:
 *   - every tab controls a panel, and every panel is labelled by its tab
 *   - exactly one tab is selected, and exactly one panel is visible
 *   - a roving tabindex, so Tab leaves the tablist instead of walking it
 *   - ArrowLeft/Right wrap, Home/End jump, and those keys are consumed
 *   - no panel is duplicated between tabs, and none is dropped
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/* ---- a DOM stub, just enough for SidebarTabs -------------------------------- */

function makeEl(tag = 'div') {
  const el = {
    tagName: tag,
    children: [],
    attrs: {},
    dataset: {},
    style: {},
    _text: '',
    focused: false,
    listeners: {},
    get id() {
      return this.attrs.id;
    },
    set id(v) {
      this.attrs.id = v;
    },
    get className() {
      return this.attrs.class || '';
    },
    setAttribute(k, v) {
      if (v === null) delete this.attrs[k];
      else this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return k in this.attrs ? this.attrs[k] : null;
    },
    hasAttribute(k) {
      return k in this.attrs;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    focus() {
      el.focused = true;
    },
    click() {
      (this.listeners.click || []).forEach((fn) => fn({ type: 'click' }));
    },
    keydown(key) {
      let prevented = false;
      const event = {
        type: 'keydown',
        key,
        preventDefault() {
          prevented = true;
        },
      };
      (this.listeners.keydown || []).forEach((fn) => fn(event));
      return prevented;
    },
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = String(v);
    },
    get innerHTML() {
      return '';
    },
    set innerHTML(v) {
      /* ignored */
    },
    querySelectorAll() {
      return [];
    },
  };
  return el;
}

/** Build the tablist from the real index.html markup, wired to stub elements. */
function buildFromMarkup() {
  const ids = [...html.matchAll(/id="tab-([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'index.html must contain tabs');
  const registry = { panels: {} };

  const tabs = ids.map((tid) => {
    const tab = makeEl('button');
    tab.attrs.id = `tab-${tid}`;
    tab.attrs.role = 'tab';
    tab.attrs['aria-controls'] = `panel-${tid}`;
    tab.setAttribute('aria-selected', tid === ids[0] ? 'true' : 'false');
    tab.setAttribute('tabindex', tid === ids[0] ? '0' : '-1');
    tab._text = tid;
    return { tid, tab };
  });

  const panels = {};
  for (const { tid } of tabs) {
    const panel = makeEl('div');
    panel.attrs.id = `panel-${tid}`;
    panel.attrs.role = 'tabpanel';
    panel.setAttribute('aria-labelledby', `tab-${tid}`);
    panel.setAttribute('tabindex', '0');
    if (tid !== ids[0]) panel.setAttribute('hidden', '');
    panels[`panel-${tid}`] = panel;
  }
  registry.panels = panels;

  const list = makeEl('div');
  list.attrs.role = 'tablist';
  tabs.forEach(({ tab }) => list.appendChild(tab));
  // The real code queries the tablist for its tabs.
  list.querySelectorAll = () => tabs.map((t) => t.tab);

  const src = fs.readFileSync(path.join(ROOT, 'public', 'tabs.js'), 'utf8');
  const sandbox = vm.createContext({
    Math,
    Number,
    JSON,
    Object,
    Array,
    String,
    Boolean,
    console,
    document: { getElementById: (id) => registry.panels[id] || null },
  });
  vm.runInContext(src, sandbox);
  const SidebarTabs = vm.runInContext('SidebarTabs', sandbox);
  return { SidebarTabs, list, tabs, panels, ids };
}

/* ---- the markup ---------------------------------------------------------- */

test('index.html has exactly the five sidebar tabs', () => {
  const labels = [
    ...html.matchAll(/role="tab"[\s\S]{0,220}?>\s*([A-Za-z]+)\s*</g),
  ].map((m) => m[1]);
  assert.deepStrictEqual(
    labels,
    ['Model', 'Devices', 'Walls', 'Measured', 'Export'],
    'the tab strip is Model, Devices, Walls, Measured, Export'
  );
});

test('every tab has a panel and every panel is labelled by its tab', () => {
  const tabFor = [
    ...html.matchAll(
      /id="(tab-[a-z]+)"[\s\S]{0,200}?aria-controls="(panel-[a-z]+)"/g
    ),
  ];
  assert.strictEqual(tabFor.length, 5, 'five tabs, each with aria-controls');
  for (const [, tabId, panelId] of tabFor) {
    assert.ok(
      html.includes(`id="${panelId}"`),
      `${tabId} controls ${panelId}, which does not exist`
    );
    assert.ok(
      new RegExp(
        `id="${panelId}"[\\s\\S]{0,240}?aria-labelledby="${tabId}"`
      ).test(html),
      `${panelId} must be labelled by ${tabId}`
    );
  }
});

test('exactly one tab starts selected and one panel starts visible', () => {
  const selected = [...html.matchAll(/aria-selected="(true|false)"/g)].map(
    (m) => m[1]
  );
  assert.strictEqual(selected.filter((s) => s === 'true').length, 1);
  const panels = [
    ...html.matchAll(/class="tabpanel"[\s\S]{0,240}?(hidden)?\s*>/g),
  ];
  assert.strictEqual(panels.length, 5);
  assert.strictEqual(
    panels.filter((p) => !p[1]).length,
    1,
    'exactly one panel may start unhidden, so the page is not double-rendered before JS runs'
  );
});

test('no panel is duplicated between tabs, and none is dropped', () => {
  // Every panel heading in the old sidebar must still exist exactly once.
  const headings = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    .filter((t) => t && !t.startsWith('\n'));
  const panels = html.match(/<section class="panel">/g) || [];
  assert.strictEqual(
    panels.length,
    11,
    'all eleven original panels are still present'
  );

  // Controls (the pause/reset buttons) and the chart must not have been lost.
  for (const id of [
    'sliders',
    'sourcesList',
    'receiversList',
    'wallsList',
    'measuredPanel',
    'rssiChart',
    'trackingPanel',
    'statsPanel',
    'spectrumPanel',
    'pauseBtn',
    'resetBtn',
    'exportPng',
    'exportFrame',
  ]) {
    assert.strictEqual(
      (html.match(new RegExp(`id="${id}"`, 'g')) || []).length,
      1,
      `exactly one element with id="${id}"`
    );
  }
  void headings;
});

/* ---- behaviour ----------------------------------------------------------- */

test('selecting a tab shows its panel and hides every other', () => {
  const { SidebarTabs, list, tabs, panels } = buildFromMarkup();
  const inst = new SidebarTabs(list);

  for (let i = 0; i < tabs.length; i++) {
    inst.select(i, { focus: false });
    const visible = tabs.filter(
      (t) => t.tab.getAttribute('aria-selected') === 'true'
    );
    assert.strictEqual(visible.length, 1, 'exactly one tab selected');
    assert.strictEqual(
      visible[0],
      tabs[i],
      'the selected tab is the one asked for'
    );
    tabs.forEach(({ tid }, n) => {
      const panel = panels[`panel-${tid}`];
      if (n === i)
        assert.ok(!panel.hasAttribute('hidden'), `${tid} must be visible`);
      else assert.ok(panel.hasAttribute('hidden'), `${tid} must be hidden`);
    });
  }
});

test('the tablist uses a roving tabindex, so Tab leaves it', () => {
  const { SidebarTabs, list, tabs } = buildFromMarkup();
  const inst = new SidebarTabs(list);
  tabs.forEach(({ tid }, i) => {
    inst.select(i, { focus: false });
    const tabbable = tabs.filter((t) => t.tab.getAttribute('tabindex') === '0');
    assert.strictEqual(
      tabbable.length,
      1,
      `only one tab may be tabbable (at ${tid})`
    );
    assert.strictEqual(
      tabbable[0],
      tabs[i],
      'the tabbable tab is the selected one'
    );
  });
});

test('ArrowRight and ArrowLeft move and wrap, and consume the key', () => {
  const { SidebarTabs, list, tabs } = buildFromMarkup();
  const inst = new SidebarTabs(list);

  inst.select(0, { focus: false });
  assert.ok(
    tabs[0].tab.keydown('ArrowRight'),
    'ArrowRight must be preventDefault-ed'
  );
  assert.strictEqual(inst.activeIndex, 1);

  assert.ok(tabs[1].tab.keydown('ArrowRight'));
  assert.strictEqual(inst.activeIndex, 2);

  assert.ok(tabs[2].tab.keydown('ArrowRight'));
  assert.strictEqual(inst.activeIndex, 3);

  assert.ok(tabs[3].tab.keydown('ArrowRight'));
  assert.strictEqual(inst.activeIndex, 4);

  assert.ok(tabs[4].tab.keydown('ArrowRight'), 'wraps past the end');
  assert.strictEqual(inst.activeIndex, 0, 'ArrowRight wraps to the first tab');

  assert.ok(tabs[0].tab.keydown('ArrowLeft'), 'wraps before the start');
  assert.strictEqual(inst.activeIndex, 4, 'ArrowLeft wraps to the last tab');
});

test('Home and End jump to the ends', () => {
  const { SidebarTabs, list, tabs } = buildFromMarkup();
  const inst = new SidebarTabs(list);
  inst.select(2, { focus: false });
  assert.ok(tabs[2].tab.keydown('Home'));
  assert.strictEqual(inst.activeIndex, 0);
  assert.ok(tabs[0].tab.keydown('End'));
  assert.strictEqual(inst.activeIndex, 4);
});

test('keys the tablist does not own are left alone', () => {
  const { SidebarTabs, list, tabs } = buildFromMarkup();
  const inst = new SidebarTabs(list);
  inst.select(1, { focus: false });
  for (const key of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a']) {
    assert.strictEqual(
      tabs[1].tab.keydown(key),
      false,
      `${key} must not be consumed by the tablist`
    );
    assert.strictEqual(
      inst.activeIndex,
      1,
      `${key} must not change the selection`
    );
  }
});

test('moving with the keyboard moves focus, so a screen reader follows', () => {
  const { SidebarTabs, list, tabs } = buildFromMarkup();
  const inst = new SidebarTabs(list);
  inst.select(0, { focus: false });
  tabs[0].tab.keydown('ArrowRight');
  assert.ok(tabs[1].tab.focused, 'the newly selected tab must take focus');
});

test('clicking a tab selects it without stealing focus twice', () => {
  const { SidebarTabs, list, tabs } = buildFromMarkup();
  const inst = new SidebarTabs(list);
  tabs[3].tab.click();
  assert.strictEqual(inst.activeIndex, 3);
  assert.strictEqual(
    tabs[3].tab.focused,
    false,
    'a click already focuses; do not also call focus()'
  );
});

test('showing a tab notifies the listener, so the chart can re-measure', () => {
  const { SidebarTabs, list } = buildFromMarkup();
  const shown = [];
  const inst = new SidebarTabs(list, { onShow: (i) => shown.push(i) });
  assert.deepStrictEqual(
    shown,
    [],
    'constructing must not fire onShow; nothing changed yet'
  );
  inst.select(3, { focus: false });
  assert.deepStrictEqual(shown, [3], 'onShow fires when a tab is shown');
  inst.select(3, { focus: false });
  assert.deepStrictEqual(
    shown,
    [3, 3],
    're-selecting the same tab is still a render, and the chart still needs it'
  );
});

test('the markup and the script agree on which tab starts selected', () => {
  const { SidebarTabs, list, ids } = buildFromMarkup();
  const inst = new SidebarTabs(list);
  assert.strictEqual(
    ids[inst.activeIndex],
    'model',
    'the first tab in the markup must be the one the script selects'
  );
});

test('tabs.js is loaded by the page', () => {
  assert.ok(html.includes('src="tabs.js"'), 'index.html must load tabs.js');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(
    (m) => m[1]
  );
  assert.ok(
    scripts.indexOf('tabs.js') < scripts.indexOf('dashboard.js'),
    'tabs.js defines SidebarTabs, which dashboard.js constructs, so it must load first'
  );
});
