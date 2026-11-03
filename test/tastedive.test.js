const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../services/tastedive.js'), 'utf8');

// Only replace the external HTTP boundary; execute the real validator.
function loadService(fetch) {
  const context = {
    module: { exports: {} },
    URLSearchParams,
    require: name => name === 'node-fetch' ? fetch : require(path.resolve(__dirname, '../services', name)),
  };
  vm.runInNewContext(source, context);
  return context.module.exports;
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

test('accepts the existing lowercase success format', async () => {
  const service = loadService(async () => response(200, '{"similar":{"info":[],"results":[]}}'));
  assert.equal(await service.validateAPIKey('dummy-key'), true);
});

test('empty keys do not make an upstream request', async () => {
  const service = loadService(async () => { assert.fail('Unexpected upstream request'); });
  assert.equal(await service.validateAPIKey(''), false);
});

test('HTTP blocking and quota failures report the status rather than invalid credentials', async () => {
  for (const status of [403, 429, 500]) {
    const service = loadService(async () => response(status, '<html>Cloudflare</html>'));
    await assert.rejects(service.validateAPIKey('dummy-key'), error => {
      assert.match(error.message, new RegExp(String(status)));
      assert.ok(!error.message.includes('dummy-key'));
      return true;
    });
  }
});

test('non-JSON success responses report an upstream response failure', async () => {
  const service = loadService(async () => response(200, '<html>Access denied</html>'));
  await assert.rejects(service.validateAPIKey('dummy-key'), /response/i);
});

test('identifies a Cloudflare block without exposing the upstream HTML', async () => {
  const service = loadService(async () => response(403, '<html>Cloudflare: private-dummy-key</html>'));
  await assert.rejects(service.validateAPIKey('private-dummy-key'), error => {
    assert.match(error.message, /Cloudflare.*403/);
    assert.ok(!error.message.includes('private-dummy-key'));
    assert.ok(!error.message.includes('<html>'));
    return true;
  });
});

test('does not label an API authorization error as a Cloudflare block', async () => {
  const service = loadService(async () => response(403, '{"error":"Forbidden"}'));
  await assert.rejects(service.validateAPIKey('dummy-key'), error => {
    assert.match(error.message, /403/);
    assert.ok(!error.message.includes('Cloudflare'));
    return true;
  });
});

test('unrecognized JSON is reported rather than silently rejecting the key', async () => {
  const service = loadService(async () => response(200, '{"unexpected":true}'));
  await assert.rejects(service.validateAPIKey('dummy-key'), /response/i);
});

test('network failures never expose a credential in the fetch error', async () => {
  const service = loadService(async () => { throw new Error('Failed URL https://tastedive.com/?k=private-dummy-key'); });
  await assert.rejects(service.validateAPIKey('private-dummy-key'), error => {
    assert.match(error.message, /reach|network|connection/i);
    assert.ok(!error.message.includes('private-dummy-key'));
    assert.ok(!error.message.includes('https://'));
    return true;
  });
});

test('upstream requests have a finite timeout', async () => {
  const service = loadService(async (_url, options) => {
    assert.ok(options?.timeout > 0 && options.timeout <= 15000);
    return response(200, '{"similar":{"info":[],"results":[]}}');
  });
  assert.equal(await service.validateAPIKey('dummy-key'), true);
});

test('validation identifies the addon instead of using the blocked default Node user agent', async () => {
  const service = loadService(async (_url, options) => {
    assert.match(options?.headers?.['User-Agent'] || '', /^More-Like-This\//);
    assert.equal(options.headers.Accept, 'application/json');
    return response(200, '{"similar":{"info":[],"results":[]}}');
  });
  assert.equal(await service.validateAPIKey('dummy-key'), true);
});

test('recommendation requests use the same working application identity', async () => {
  const service = loadService(async (_url, options) => {
    assert.match(options?.headers?.['User-Agent'] || '', /^More-Like-This\//);
    assert.equal(options.headers.Accept, 'application/json');
    return response(200, '{"similar":{"info":[{"name":"Inception","type":"movie"}],"results":[{"name":"Interstellar","type":"movie"}]}}');
  });
  const recs = await service.fetchRecs('Inception', 2010, 'movie', 'dummy-key');
  assert.equal(recs.results?.[0]?.name, 'Interstellar');
});

test('validates the capitalized successful response documented by TasteDive', async () => {
  const service = loadService(async () => response(200, '{"Similar":{"Info":[{"Name":"Inception","Type":"movie"}],"Results":[{"Name":"Interstellar","Type":"movie"}]}}'));
  assert.equal(await service.validateAPIKey('dummy-key'), true);
});

test('documented recommendations are normalized for the existing recommendation manager', async () => {
  const service = loadService(async () => response(200, '{"Similar":{"Info":[{"Name":"Inception","Type":"movie"}],"Results":[{"Name":"Interstellar","Type":"movie"}]}}'));
  const recs = await service.fetchRecs('Inception', 2010, 'movie', 'dummy-key');
  assert.equal(recs.info?.[0]?.name, 'Inception');
  assert.equal(recs.info?.[0]?.type, 'movie');
  assert.equal(recs.results?.[0]?.name, 'Interstellar');
  assert.equal(recs.results?.[0]?.type, 'movie');
});

test('keys with query-string characters stay inside the key parameter', async () => {
  let requestedUrl;
  const service = loadService(async url => {
    requestedUrl = new URL(url);
    return response(200, '{"similar":{"info":[],"results":[]}}');
  });
  assert.equal(await service.validateAPIKey('dummy&key=value+#'), true);
  assert.equal(requestedUrl.searchParams.get('k'), 'dummy&key=value+#');
  assert.equal(requestedUrl.searchParams.get('key'), null);
});

test('recommendation requests encode the key and map series to TasteDive show', async () => {
  let requestedUrl;
  const service = loadService(async url => {
    requestedUrl = new URL(url);
    return response(200, '{"similar":{"info":[],"results":[]}}');
  });
  await service.fetchRecs('Amélie', 2001, 'series', 'dummy&key=value+#');
  assert.equal(requestedUrl.searchParams.get('q'), 'show:Amélie');
  assert.equal(requestedUrl.searchParams.get('type'), 'show');
  assert.equal(requestedUrl.searchParams.get('k'), 'dummy&key=value+#');
});

test('recommendation failures keep the existing empty-result fallback', async () => {
  const service = loadService(async () => response(403, '<html>Cloudflare</html>'));
  const recs = await service.fetchRecs('Inception', 2010, 'movie', 'dummy-key');
  assert.equal(Array.isArray(recs), true);
  assert.equal(recs.length, 0);
});

test('a failed HTTP response cannot supply recommendations even with a success-looking body', async () => {
  const service = loadService(async () => response(500, '{"similar":{"info":[{"name":"Inception","type":"movie"}],"results":[{"name":"Interstellar","type":"movie"}]}}'));
  const recs = await service.fetchRecs('Inception', 2010, 'movie', 'dummy-key');
  assert.equal(Array.isArray(recs), true);
  assert.equal(recs.length, 0);
});

test('malformed successful items are not accepted as a verified response', async () => {
  const service = loadService(async () => response(200, '{"similar":{"info":[null],"results":[]}}'));
  await assert.rejects(service.validateAPIKey('dummy-key'), /response/i);
});

test('accepts real TasteDive responses whose recommendation items omit type', async () => {
  const service = loadService(async () => response(200, '{"similar":{"info":[{"name":"Inception","type":"movie"}],"results":[{"name":"Interstellar"}]}}'));
  assert.equal(await service.validateAPIKey('dummy-key'), true);
});

test('recommendations without type inherit the requested movie or show type', async () => {
  for (const [mediaType, expectedType] of [['movie', 'movie'], ['series', 'show']]) {
    const service = loadService(async () => response(200, '{"similar":{"info":[{"name":"Example","type":"movie"}],"results":[{"name":"Recommended title"}]}}'));
    const recs = await service.fetchRecs('Example', 2010, mediaType, 'dummy-key');
    assert.equal(recs.results?.[0]?.name, 'Recommended title');
    assert.equal(recs.results?.[0]?.type, expectedType);
  }
});
