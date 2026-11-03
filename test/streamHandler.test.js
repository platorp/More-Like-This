const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const credentials = Object.fromEntries(['tmdb', 'trakt', 'simkl', 'gemini', 'tastedive', 'watchmode', 'rpdb']
  .map(source => [source, { key: 'dummy-' + source, valid: true }]));
const config = { apiKeys: credentials, streamOrder: ['detail', 'recs'], enabledStreamButtons: { detail: true, recs: true } };
const metadataSource = { source: 'cinemeta', language: 'en', tmdbApiKey: credentials.tmdb, traktApiKey: credentials.trakt };

// Run the real handler, merge, normalization and caches; replace external service boundaries.
function harness({ tmdb = ['tt1000001'], trakt = ['tt1000002'], collection, metadata = {}, failTmdb = false, failMetadata = false } = {}) {
  const counts = { metadata: 0, tmdb: 0, trakt: 0, other: 0 };
  const modules = new Map();
  const stubs = {
    'config.js': { CACHE_TTL: 300000, MAX_CACHE_SIZE: 3000, ENABLE_LOGGING: false },
    'utils/idConverter.js': {
      imdbToTmdb: async id => Number(id.slice(2)),
      tmdbToImdb: async id => 'tt' + id,
      traktToImdbTitleYearType: async () => ({ imdbId: 'tt1000000' }),
      kitsuToImdbTitleYearType: async () => ({ imdbId: 'tt1000000' }),
      imdbToFullMeta: async (id, type) => {
        counts.metadata++;
        if (failMetadata) throw Error('Metadata service unavailable');
        return { id, type, name: 'Title ' + id, year: 2020, ...metadata };
      },
    },
    'services/tmdb.js': {
      fetchRecommendations: async () => {
        counts.tmdb++;
        if (failTmdb) throw Error('Provider unavailable');
        return tmdb.map(id => ({ id: Number(id.slice(2)), title: 'Title ' + id, release_date: '2020-01-01' }));
      },
    },
    'services/trakt.js': {
      fetchRecommendations: async () => {
        counts.trakt++;
        return trakt.map(id => ({ title: 'Title ' + id, year: 2020, ids: { imdb: id, tmdb: Number(id.slice(2)) } }));
      },
    },
  };
  for (const source of ['simkl', 'gemini', 'tastedive', 'watchmode']) {
    stubs['services/' + source + '.js'] = new Proxy({}, { get: () => async () => { counts.other++; throw Error('Unwanted provider request'); } });
  }
  function load(filename) {
    const relative = path.relative(root, filename);
    if (stubs[relative]) return stubs[relative];
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const nativeRequire = createRequire(filename);
    const requireFile = name => name.startsWith('.') ? load(nativeRequire.resolve(name)) : nativeRequire(name);
    new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(filename, 'utf8'))
      (requireFile, module, module.exports, filename, path.dirname(filename));
    return module.exports;
  }
  if (collection) {
    // Exercise the collection adapter itself; fixtures are raw TMDB HTTP payloads.
    const filename = path.join(root, 'services/tmdb.js');
    const module = { exports: {} };
    const collectionFetch = async url => ({ json: async () => url.includes('/collection/') ? { parts: collection } : { belongs_to_collection: { id: 1 } } });
    new Function('require', 'module', fs.readFileSync(filename, 'utf8'))(
      name => name === 'node-fetch' ? collectionFetch : load(createRequire(filename).resolve(name)), module);
    stubs['services/tmdb.js'].fetchCollectionRecs = module.exports.fetchCollectionRecs;
  }
  const { streamHandler } = load(path.join(root, 'src/streamHandler.js'));
  return { counts, run: (id = 'tt1000000', type = 'movie', origin = '', userConfig = config) => streamHandler(origin, type, id, userConfig, metadataSource) };
}

test('shows enriched recommendation titles immediately instead of generic buttons', async () => {
  const app = harness({ metadata: { name: 'Interstellar', year: 2014, imdbRating: '8.7', runtime: '169 min', genres: ['Adventure', 'Sci-Fi'], description: 'A journey beyond Earth.' } });
  const result = await app.run();
  assert.equal(result.streams.length, 2);
  const entry = result.streams[0];
  assert.match(entry.description, /Interstellar.*2014/);
  assert.match(entry.description, /⭐.*8\.7/);
  assert.match(entry.description, /⏱.*169 min/);
  assert.match(entry.description, /🎭.*Adventure.*Sci-Fi/);
  assert.match(entry.description, /📖.*A journey beyond Earth/);
  assert.equal(entry.externalUrl, 'stremio:///detail/movie/tt1000001');
  assert.equal(entry.url, undefined);
});

test('combines only Trakt and TMDB and ranks shared titles first', async () => {
  const app = harness({ tmdb: ['tt1000001', 'tt1000000', 'tt1000002'], trakt: ['tt1000003', 'tt1000002'] });
  const { streams } = await app.run();
  assert.deepEqual(streams.map(s => s.externalUrl.split('/').at(-1)), ['tt1000002', 'tt1000001', 'tt1000003']);
  assert.equal(app.counts.other, 0);
});

test('limits enrichment to ten unique recommendations and never includes the current title', async () => {
  const ids = Array.from({ length: 18 }, (_, i) => 'tt' + (1000000 + i));
  const app = harness({ tmdb: ids, trakt: ids });
  const { streams } = await app.run();
  assert.equal(streams.length, 10);
  assert.equal(new Set(streams.map(s => s.externalUrl)).size, 10);
  assert.ok(streams.every(s => !s.externalUrl.endsWith('/tt1000000')));
  assert.equal(app.counts.metadata, 10);
});

test('series episodes and legacy recommendation IDs link to the recommended series title', async () => {
  for (const id of ['tt1000000:2:3', 'mlt-rec-tt1000000:2:3', 'mlt-meta-tt1000000']) {
    const { streams } = await harness().run(id, 'series', 'https://web.stremio.com');
    assert.equal(streams[0]?.externalUrl, 'https://web.stremio.com/#/detail/series/tt1000001');
  }
});

test('metadata failures keep useful provider titles and omit unavailable details', async () => {
  const { streams } = await harness({ failMetadata: true }).run();
  assert.equal(streams.length, 2);
  assert.match(streams[0].description, /Title tt1000001/);
  assert.ok(!/undefined|null|⭐|⏱|📖/.test(streams[0].description));
});

test('one failed or missing provider does not hide the other provider results', async () => {
  const { streams } = await harness({ failTmdb: true }).run();
  assert.equal(streams.length, 1);
  assert.ok(streams[0].externalUrl.endsWith('/tt1000002'));
  const app = harness();
  const userConfig = { ...config, apiKeys: { trakt: credentials.trakt } };
  assert.equal((await app.run('tt1000000', 'movie', '', userConfig)).streams.length, 1);
});

test('repeated requests reuse provider and metadata caches', async () => {
  const app = harness();
  const first = await app.run();
  const second = await app.run();
  assert.deepEqual(second.streams, first.streams);
  assert.equal(app.counts.tmdb, 1);
  assert.equal(app.counts.trakt, 1);
  assert.equal(app.counts.metadata, 2);
  assert.ok(first.cacheMaxAge > 0);
});

test('non-IMDb identifiers are converted and unsupported input makes no requests', async () => {
  for (const id of ['tmdb:1000000', 'trakt:1000000', 'kitsu:1000000']) {
    assert.equal((await harness().run(id)).streams.length, 2);
  }
  const app = harness();
  for (const id of ['unknown:123', 'tt123<script>', '']) assert.equal((await app.run(id)).streams.length, 0);
  assert.equal(app.counts.tmdb + app.counts.trakt + app.counts.metadata, 0);
});

test('long and incomplete metadata stays compact without empty labels', async () => {
  const { streams } = await harness({ metadata: { name: '  A\n title  ', imdbRating: '', runtime: '', genres: [], description: 'x'.repeat(2000) } }).run();
  assert.match(streams[0].description, /^A title/);
  assert.ok(streams[0].description.length < 400);
  assert.ok(!/undefined|null|⭐|⏱|🎭/.test(streams[0].description));
});

test('collection titles survive failed enrichment even when also recommended by TMDB and Trakt', async () => {
  const app = harness({
    tmdb: ['tt1000001'], trakt: ['tt1000001'], failMetadata: true,
    collection: [{ id: 1000001, title: 'Collection title', release_date: '2020-01-01' }],
  });
  const { streams } = await app.run('tt1000000', 'movie', '', { ...config, includeTmdbCollection: true });
  assert.equal(streams.length, 1);
  assert.match(streams[0].description, /^Collection title \(2020\)/);
});
