/* Run with: node --test scripts/test_frontend.cjs */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const appPath = join(__dirname, '..', 'assets', 'app.js');
const initialTime = Date.parse('2026-10-27T08:00:00Z');

// Only enough HTML behavior to exercise text normalization. Browser layout,
// keyboard navigation, and HTML parser security still need browser checks.
function htmlText(html) {
  return String(html).replace(/<[^>]*>/g, '').replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (_, entity) => {
      if (/^#x/i.test(entity)) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[entity.toLowerCase()];
    }
  );
}

function textElement(tagName = 'div') {
  let html = '';
  let text = '';
  const content = {
    get textContent() { return htmlText(html); },
    querySelectorAll(selector) {
      const tags = selector.split(',').map(value => value.trim()).filter(value => /^[a-z]+$/i.test(value));
      if (!tags.length) return [];
      const pattern = new RegExp(`<(${tags.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
      return Array.from(html.matchAll(pattern), match => ({
        remove() { html = html.replace(match[0], ''); }
      }));
    }
  };
  return {
    tagName: tagName.toUpperCase(),
    content,
    get innerHTML() { return html; },
    set innerHTML(value) { html = String(value); text = htmlText(html); },
    get textContent() { return text; },
    set textContent(value) { text = String(value); html = ''; },
    get value() { return text; },
    set value(value) { text = String(value); },
    querySelectorAll: content.querySelectorAll,
    addEventListener() {},
    append() {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {} }
  };
}

function loadApp({ stored = {}, rejectStorage = false } = {}) {
  const values = new Map(Object.entries(stored));
  const clock = { now: initialTime };
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const localStorage = {
    getItem(key) {
      if (rejectStorage) throw new Error('Storage access denied');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (rejectStorage) throw new Error('Storage quota exceeded');
      values.set(key, String(value));
    },
    removeItem(key) {
      if (rejectStorage) throw new Error('Storage access denied');
      values.delete(key);
    }
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    URL, URLSearchParams, Map, Set, Date: TestDate,
    setTimeout, clearTimeout,
    localStorage,
    location: { href: 'https://xzcheneit.github.io/' },
    history: { replaceState() {} },
    navigator: {},
    window: { addEventListener() {} },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: textElement,
      createTextNode: value => ({ textContent: String(value) }),
      addEventListener() {}
    }
  });
  // Do not fetch data or run browser startup when loading the app in Node.
  const source = readFileSync(appPath, 'utf8').replace(/\/\*\s*-+\s*Boot\s*-+\s*\*\/[\s\S]*$/, '');
  vm.runInContext(source + `
    globalThis.app = {
      normalizeItem, withinDays, filterByQuery, toBibAPS,
      buildWeeklyDigestMarkdown, FavStore, UserStore, PrefStore, VisitStore,
      bestLink,
      itemUID: typeof itemUID === 'function' ? itemUID : undefined,
      canonicalUid: typeof canonicalUid === 'function' ? canonicalUid : undefined,
      feedText: typeof feedText === 'function' ? feedText : undefined,
      setFeed(items) {
        ALL_ITEMS = items;
        ITEM_BY_UID = new Map(items.map(item => [item.uid, item]));
      },
      setSeen(value) { SEEN_BEFORE = value; }
    };
  `, context, { filename: appPath });
  return { app: context.app, clock, values, run: code => vm.runInContext(code, context) };
}

function article(patch = {}) {
  return {
    journalKey: 'PRL', journal: 'Phys. Rev. Lett.', journalShort: 'PRL',
    title: 'Topological phases',
    authors: ['Ada Lovelace', 'Emmy Noether'],
    date: '2026-10-26T10:00:00Z', type: 'published',
    doi: '10.1103/example', link: 'https://doi.org/10.1103/example',
    summary: 'A study of quantum materials.',
    ...patch
  };
}

test('article identity survives accepted-to-published date changes', () => {
  const { app } = loadApp();
  const accepted = app.normalizeItem(article({ type: 'accepted' }));
  const published = app.normalizeItem(article({ date: '2026-10-27T07:00:00Z' }));
  assert.equal(accepted.uid, published.uid);
});

test('legacy favorite and reading keys migrate without losing saved notes', () => {
  const saved = article();
  const legacyUid = `${saved.journalKey}|${saved.doi}|${saved.date}`;
  const { app } = loadApp({ stored: {
    pj_favs_v2: JSON.stringify([{ ...saved, uid: legacyUid }]),
    pj_user_v1: JSON.stringify({ items: {
      [legacyUid]: { status: 'reading', note: 'Saved before the upgrade.', updatedAt: initialTime }
    } })
  } });
  const current = app.normalizeItem(article({ date: '2026-10-27T07:00:00Z' }));
  assert.equal(app.FavStore.has(current.uid), true);
  assert.equal(app.FavStore.load().length, 1);
  assert.equal(app.UserStore.get(current.uid).status, 'reading');
  assert.equal(app.UserStore.get(current.uid).note, 'Saved before the upgrade.');
});

test('migration combines duplicate legacy favorites into one article', () => {
  const first = article({ date: '2026-10-20T10:00:00Z', type: 'accepted' });
  const second = article({ date: '2026-10-26T10:00:00Z' });
  const legacy = [first, second].map(item => ({
    ...item, uid: `${item.journalKey}|${item.doi}|${item.date}`
  }));
  const { app } = loadApp({ stored: { pj_favs_v2: JSON.stringify(legacy) } });
  const current = app.normalizeItem(second);
  assert.equal(app.FavStore.load().length, 1);
  assert.equal(app.FavStore.has(current.uid), true);
});

test('migration keeps older notes when newer article versions only change status', () => {
  const firstUid = 'PRL|10.1103/example|2026-10-20T10:00:00Z';
  const secondUid = 'PRL|10.1103/example|2026-10-26T10:00:00Z';
  for (const newerNote of ['', 'Check the experimental control.']) {
    const { app } = loadApp({ stored: {
      pj_user_v1: JSON.stringify({ items: {
        [firstUid]: { status: 'reading', note: 'Important saved derivation.', updatedAt: initialTime - 1000 },
        [secondUid]: { status: 'done', note: newerNote, updatedAt: initialTime }
      } })
    } });
    const saved = app.UserStore.get(app.normalizeItem(article()).uid);
    assert.equal(saved.status, 'done');
    assert.equal(saved.updatedAt, initialTime);
    assert.match(saved.note, /Important saved derivation\./);
    if (newerNote) assert.match(saved.note, /Check the experimental control\./);
  }
});

test('feed markup becomes readable text while mathematical source is preserved', () => {
  const { app } = loadApp();
  assert.equal(app.feedText('<span>Spin &amp; charge</span> in Bi${}_{2}$Se${}_{3}$'), 'Spin & charge in Bi${}_{2}$Se${}_{3}$');
  assert.equal(app.feedText('<span>Safe</span><script>unsafe()</script><style>body{display:none}</style>'), 'Safe');
});

test('author search supports structured names and plain strings', () => {
  const { app } = loadApp();
  const item = article({ authors: [{ given: 'Ada', family: 'Lovelace' }, { name: 'Emmy Noether' }, 'Albert Einstein'] });
  for (const query of ['lovelace', 'EMMY', 'einstein']) {
    assert.equal(app.filterByQuery([item], query).length, 1, query);
  }
  assert.equal(app.filterByQuery([item], 'nonexistent-author').length, 0);
});

test('date windows exclude malformed dates and respect the selected range', () => {
  const { app } = loadApp();
  assert.equal(app.withinDays('not-a-date', '3'), false);
  assert.equal(app.withinDays('', '3'), false);
  assert.equal(app.withinDays('2026-10-26T08:00:00Z', '3'), true);
  assert.equal(app.withinDays('2026-10-20T08:00:00Z', '3'), false);
  assert.equal(app.withinDays('2026-10-20T08:00:00Z', 'all'), true);
});

test('BibTeX uses clean titles and individual structured author names', () => {
  const { app } = loadApp();
  const item = app.normalizeItem(article({
    title: '<span>Spin &amp; charge</span>',
    authors: [{ given: 'Ada', family: 'Lovelace' }, { name: 'Emmy Noether' }]
  }));
  const bib = app.toBibAPS(item, { keywords: [] }, new Set());
  assert.doesNotMatch(bib, /<\/?span>|\[object Object\]/);
  assert.match(bib, /author = \{Ada Lovelace and Emmy Noether\}/);
  assert.match(bib, /Spin \\& charge/);
});

test('BibTeX escapes note punctuation without dropping the note', () => {
  const { app } = loadApp();
  const item = app.normalizeItem(article());
  app.UserStore.set(item.uid, { note: 'Efficiency 50% & sample_1 #2' }, item);
  const bib = app.toBibAPS(item, { keywords: [] }, null);
  assert.match(bib, /50\\% \\& sample\\_1 \\#2/);
});

test('BibTeX exports arXiv identifiers as preprints', () => {
  const { app } = loadApp();
  const item = app.normalizeItem(article({
    type: 'preprint', journalKey: 'arXivCM', journal: 'arXiv: cond-mat',
    doi: '', arxiv: 'https://arxiv.org/abs/2610.12345v2',
    link: 'https://arxiv.org/abs/2610.12345v2'
  }));
  const bib = app.toBibAPS(item, { keywords: [] }, null);
  assert.match(bib, /^@(?:misc|unpublished)\{/);
  assert.match(bib, /eprint = \{2610\.12345v2\}/);
  assert.match(bib, /archivePrefix = \{arXiv\}/);
});

test('BibTeX batches assign distinct keys when DOI suffixes collide', () => {
  const { app } = loadApp();
  const seen = new Set();
  const one = app.toBibAPS(app.normalizeItem(article({ doi: '10.1111/same' })), { keywords: [] }, seen);
  const two = app.toBibAPS(app.normalizeItem(article({ doi: '10.2222/same' })), { keywords: [] }, seen);
  assert.notEqual(one.match(/^@\w+\{([^,]+)/)[1], two.match(/^@\w+\{([^,]+)/)[1]);
});

test('saving an unchanged or untouched note does not mark it as a new update', () => {
  const { app, clock } = loadApp();
  const item = app.normalizeItem(article());
  app.UserStore.set(item.uid, { note: '' }, item);
  assert.equal(app.UserStore.get(item.uid).updatedAt || 0, 0);
  app.UserStore.set(item.uid, { note: 'Read the appendix.' }, item);
  const firstUpdate = app.UserStore.get(item.uid).updatedAt;
  assert.equal(firstUpdate, initialTime);
  clock.now += 60_000;
  app.UserStore.set(item.uid, { note: 'Read the appendix.' }, item);
  assert.equal(app.UserStore.get(item.uid).updatedAt, firstUpdate);
});

test('weekly digest retains a noted article after it leaves the feed window', () => {
  const { app } = loadApp();
  const item = app.normalizeItem(article({ date: '2026-10-13T10:00:00Z' }));
  app.setFeed([item]);
  app.UserStore.set(item.uid, { status: 'reading', note: 'Check the derivation.' }, item);
  assert.equal(app.buildWeeklyDigestMarkdown().items.length, 1);
  app.setFeed([]);
  const digest = app.buildWeeklyDigestMarkdown();
  assert.equal(digest.items.length, 1);
  assert.match(digest.markdown, /Topological phases/);
  assert.match(digest.markdown, /Check the derivation/);
});

test('new labels follow unseen identities while refreshes keep the visit baseline', () => {
  const { app } = loadApp();
  const known = app.normalizeItem(article());
  app.setSeen(new Set([known.uid]));
  assert.equal(app.normalizeItem(article({ date: '2026-10-27T07:00:00Z' }))._isNew, false);
  const lateArrival = article({ doi: '10.1103/newly-discovered', date: '2026-10-20T10:00:00Z' });
  assert.equal(app.normalizeItem(lateArrival)._isNew, true);
  assert.equal(app.normalizeItem(lateArrival)._isNew, true);
});

test('first visits do not label the entire existing feed as new', () => {
  const { app } = loadApp();
  app.setSeen(null);
  assert.equal(app.normalizeItem(article())._isNew, false);
});

test('blocked storage does not crash loading preferences or saving reading data', () => {
  const { app } = loadApp({ rejectStorage: true });
  const item = app.normalizeItem(article());
  assert.doesNotThrow(() => app.FavStore.load());
  assert.doesNotThrow(() => app.PrefStore.load());
  assert.doesNotThrow(() => app.UserStore.get(item.uid));
  assert.doesNotThrow(() => app.VisitStore.get());
  assert.doesNotThrow(() => app.FavStore.add(item));
  assert.doesNotThrow(() => app.UserStore.set(item.uid, { status: 'reading' }, item));
  assert.doesNotThrow(() => app.PrefStore.save({ keywords: ['spin'], highlight: true }));
  assert.doesNotThrow(() => app.VisitStore.set(initialTime));
});

test('invalid stored preferences recover to a usable keywords array', () => {
  const { app } = loadApp({ stored: { pj_prefs_v1: JSON.stringify({ keywords: 'not-an-array' }) } });
  assert.equal(Array.isArray(app.PrefStore.load().keywords), true);
});

test('article links refuse executable URL schemes', () => {
  const { app } = loadApp();
  const link = app.bestLink(article({ doi: '', arxiv: 'javascript:alert(1)', link: 'data:text/html,unsafe' }));
  assert.doesNotMatch(link, /^(?:javascript|data):/i);
});
