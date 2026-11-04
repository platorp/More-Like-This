const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
const { encryptData } = require('../utils/encryption');
const { createEpisodeRatingsRouter } = require('../src/episodeRatings');

const config = { upstream: 'https://aiometadata.viren070.me/stremio/00000000-0000-4000-8000-000000000000', tmdbApiKey: 'private-test-key' };
const episode = (season, number, fields = {}) => ({ id: `tt1000000:${season}:${number}`, title: `Episode ${number}`, season, episode: number, overview: 'Original synopsis', thumbnail: 'https://art.example/episode.jpg', released: '2020-01-01T00:00:00.000Z', ...fields });
const makeMeta = videos => ({ meta: { id: 'tt1000000', name: 'Example', poster: 'https://art.example/poster.jpg', videos } });
const imdb = { id: 'tt1000000', seasons: { 1: { 1: { r: 8.7, v: 100 } }, 2: { 1: { r: 6.1, v: 20 } } } };

async function harness(t, { payload = makeMeta([episode(1, 1)]), imdbData = imdb, tmdbEpisodes = [], fetchOverride, ratingTimeoutMs = 2500 } = {}) {
 const calls = [];
 const fetchImpl = async (url, options) => {
  calls.push(String(url));
  if (fetchOverride) { const r = await fetchOverride(String(url), options); if (r) return r; }
  let value;
  if (String(url).startsWith(config.upstream)) value = structuredClone(payload);
  else if (String(url).includes('imdb-episode-dataset')) value = imdbData;
  else if (String(url).includes('/find/')) value = { tv_results: [{ id: 321 }] };
  else if (String(url).includes('/season/')) value = { id: 999, season_number: Number(new URL(url).pathname.split('/').at(-1)), episodes: tmdbEpisodes };
  else throw Error('Unexpected network request');
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
 };
 const app = express(); app.use('/episode-ratings', createEpisodeRatingsRouter({ fetchImpl, ratingTimeoutMs }));
 const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
 t.after(() => { server.closeAllConnections(); server.close(); });
 const tokenFor = async value => Buffer.from(JSON.stringify(await encryptData(value))).toString('base64url');
 const token = await tokenFor(config);
 const request = (path = 'meta/series/tt1000000.json', tok = token) => fetch(`http://127.0.0.1:${server.address().port}/episode-ratings/${tok}/${path}`);
 return { calls, request, tokenFor };
}

test('adds exact episode IMDb ratings to titles and synopsis without changing artwork or IDs', async t => {
 const payload = makeMeta([episode(1, 1), episode(2, 1)]); const before = structuredClone(payload);
 const app = await harness(t, { payload }); const result = await (await app.request()).json();
 assert.equal(result.meta.videos[0].title, 'Episode 1 · ⭐ 8.7');
 assert.equal(result.meta.videos[1].title, 'Episode 1 · ⭐ 6.1');
 assert.equal(result.meta.videos[0].overview, '⭐ IMDb episode: 8.7/10\n\nOriginal synopsis');
 for (let i=0;i<2;i++) { const {title,overview,description,...unchanged}=result.meta.videos[i]; const {title:a,overview:b,...original}=before.meta.videos[i];assert.deepEqual(unchanged,original); }
 assert.equal(result.meta.poster, before.meta.poster); assert.deepEqual(payload,before);
});

test('falls back only missing IMDb episodes to correctly labelled TMDB episode scores', async t => {
 const app = await harness(t,{payload:makeMeta([episode(1,1),episode(1,2)]),tmdbEpisodes:[{season_number:1,episode_number:2,vote_average:7.25,vote_count:14,air_date:'2020-01-01'}]});
 const data=await(await app.request()).json();assert.match(data.meta.videos[0].title,/⭐ 8.7/);assert.match(data.meta.videos[1].title,/TMDB 7.3/);assert.equal(data.meta.videos[1].overview,'⭐ TMDB episode: 7.3/10\n\nOriginal synopsis');
});

test('leaves unknown, future, mismatched and unrated episodes unchanged instead of using show scores', async t => {
 const videos=[episode(1,2),episode(1,1,{id:'tt2000000:1:1'}),episode(1,1,{id:'kitsu:99:1'}),episode(1,1,{season:3}),episode(1,1,{released:'2999-01-01T00:00:00Z'})];
 const app=await harness(t,{payload:makeMeta(videos),tmdbEpisodes:[{season_number:1,episode_number:2,vote_average:0,vote_count:0}]});
 assert.deepEqual((await(await app.request()).json()).meta.videos,videos);
});

test('season-zero specials and name/description-only metadata retain their text and source', async t => {
 const app=await harness(t,{payload:makeMeta([episode(0,1,{title:undefined,overview:undefined,name:'Special',description:'Special synopsis'})]),imdbData:{id:'tt1000000',seasons:{0:{1:{r:9,v:10}}}}});
 const v=(await(await app.request()).json()).meta.videos[0];assert.equal(v.title,'Special · ⭐ 9.0');assert.equal(v.name,'Special · ⭐ 9.0');assert.equal(v.description,'⭐ IMDb episode: 9.0/10\n\nSpecial synopsis');
});

test('returns original metadata on rating-provider failure without exposing fetch errors', async t => {
 const payload=makeMeta([episode(1,1)]);const app=await harness(t,{payload,fetchOverride:async url=>{if(!url.startsWith(config.upstream))throw Error('key=private-test-key');}});
 assert.deepEqual(await(await app.request()).json(),payload);
});

test('coalesces concurrent provider requests and reuses cached scores', async t => {
 const app=await harness(t);await Promise.all([app.request(),app.request()]);await app.request();assert.equal(app.calls.filter(u=>u.includes('imdb-episode-dataset')).length,1);
});

test('metadata-only manifest keeps original catalog/stream addons responsible for their resources', async t => {
 const app=await harness(t);const r=await(await app.request('manifest.json')).json();assert.deepEqual(r.catalogs,[]);assert.deepEqual(r.resources,[{name:'meta',types:['series'],idPrefixes:['tt','tmdb:']}]);assert.equal(app.calls.length,0);
});

test('invalid encrypted tokens and forbidden upstream URLs never make upstream requests', async t => {
 const app=await harness(t);for(const token of ['bad',await app.tokenFor({...config,upstream:'http://127.0.0.1:8080'}),await app.tokenFor({...config,upstream:'https://aiometadata.viren070.me@evil.example/stremio/x'}),await app.tokenFor({...config,upstream:config.upstream+'/../../admin'})])assert.equal((await app.request('manifest.json',token)).status,400);
 assert.equal(app.calls.length,0);
});

test('upstream redirects and failures return a sanitized metadata error', async t => {
 const app=await harness(t,{fetchOverride:async url=>url.startsWith(config.upstream)?new Response('private-test-key',{status:302,headers:{location:'http://127.0.0.1'}}):null});
 const response=await app.request();assert.equal(response.status,502);assert.deepEqual(await response.json(),{meta:null});
});

test('oversized metadata bodies are rejected', async t => {
 const app=await harness(t,{fetchOverride:async url=>url.startsWith(config.upstream)?new Response(JSON.stringify({text:'x'.repeat(2*1024*1024)})):null});assert.equal((await app.request()).status,502);
});

test('rating deadlines abort slow providers and preserve original metadata', async t => {
 let aborted=false;const payload=makeMeta([episode(1,1)]);
 const app=await harness(t,{payload,ratingTimeoutMs:40,fetchOverride:async(url,options)=>{if(url.startsWith(config.upstream))return;return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true});});}});
 const result=await(await app.request()).json();assert.deepEqual(result,payload);assert.equal(aborted,true);
});

test('rejects a different series dataset and wrong-season TMDB responses', async t => {
 const payload=makeMeta([episode(1,1)]);const app=await harness(t,{payload,imdbData:{...imdb,id:'tt9999999'},fetchOverride:async url=>url.includes('/season/')?new Response(JSON.stringify({season_number:2,episodes:[{season_number:2,episode_number:1,vote_average:9,vote_count:100}]})):null});
 assert.deepEqual(await(await app.request()).json(),payload);
});

test('unsupported request IDs and types do not cause unrelated metadata requests', async t => {
 const app=await harness(t);for(const path of ['meta/movie/tt1000000.json','meta/series/kitsu:99.json','meta/series/..%2Fadmin.json'])assert.equal((await app.request(path)).status,404);assert.equal(app.calls.length,0);
});

test('IMDb-to-TMDB fallback rejects conflicting or missing episode release dates', async t => {
 for(const [released,air_date]of [['2020-01-01T00:00:00Z','2021-06-01'],[undefined,'2020-01-01'],['2020-01-01T00:00:00Z',undefined],['invalid','2020-01-01']]){
  const payload=makeMeta([episode(1,1,{released})]);const app=await harness(t,{payload,imdbData:null,tmdbEpisodes:[{season_number:1,episode_number:1,vote_average:9.9,vote_count:100,air_date}]});
  const expected=JSON.parse(JSON.stringify(payload));assert.deepEqual(await(await app.request()).json(),expected);
 }
});

test('TMDB episode IDs use direct TMDB scores without assuming IMDb numbering equivalence', async t => {
 const payload={meta:{id:'tmdb:321',imdb_id:'tt1000000',videos:[episode(1,1,{id:'tmdb:321:1:1'})]}};
 const app=await harness(t,{payload,tmdbEpisodes:[{season_number:1,episode_number:1,vote_average:7.3,vote_count:100}]});
 const result=await(await app.request('meta/series/tmdb:321.json')).json();assert.match(result.meta.videos[0].title,/TMDB 7.3/);assert.equal(app.calls.filter(u=>u.includes('imdb-episode-dataset')).length,0);
});
