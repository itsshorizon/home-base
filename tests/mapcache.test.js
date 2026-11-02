import test from 'node:test';
import assert from 'node:assert/strict';
import { isOutdated, statusFromCache } from '../js/mapcache.js';

// A pretend Cache: match(url) gives back a Response for the url we stored, else undefined.
function fakeCache(url, bytes, extraHeaders = {}) {
  return {
    async match(u) {
      if (u !== url) return undefined;
      return new Response(new Uint8Array(0), { headers: { 'Content-Length': String(bytes), ...extraHeaders } });
    },
  };
}
const URL_ = 'https://example.test/data/map/henrico.pmtiles';

test('isOutdated: a different size means a newer map; unknown sizes never do', () => {
  assert.equal(isOutdated(43555441, 49292020), true);
  assert.equal(isOutdated(49292020, 49292020), false);
  assert.equal(isOutdated(0, 49292020), false);
  assert.equal(isOutdated(43555441, 0), false);
  assert.equal(isOutdated(undefined, undefined), false);
});

test('statusFromCache: an old, smaller file is downloaded but outdated', async () => {
  const st = await statusFromCache(fakeCache(URL_, 1000, { 'x-hb-saved-at': '2026-11-01T00:00:00Z' }), URL_, {}, 49292020);
  assert.equal(st.downloaded, true);
  assert.equal(st.outdated, true);
  assert.equal(st.size, 1000);
  assert.equal(st.expected, 49292020);
  assert.equal(st.savedAt, '2026-11-01T00:00:00Z');
});

test('statusFromCache: the current file is not outdated; a missing file is not downloaded', async () => {
  const ok = await statusFromCache(fakeCache(URL_, 49292020), URL_, { size: 49292020, savedAt: '2026-11-02T00:00:00Z' }, 49292020);
  assert.equal(ok.downloaded, true);
  assert.equal(ok.outdated, false);
  assert.equal(ok.savedAt, '2026-11-02T00:00:00Z');
  const none = await statusFromCache(fakeCache('https://other.test/x', 5), URL_, {}, 49292020);
  assert.equal(none.downloaded, false);
  assert.equal(none.outdated, undefined);
});

test('statusFromCache: with no meta.json size it never claims an update', async () => {
  const st = await statusFromCache(fakeCache(URL_, 1000), URL_, {}, 0);
  assert.equal(st.outdated, false);
});
