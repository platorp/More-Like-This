const express = require('express');
const crypto = require('node:crypto');
const { decryptData } = require('../utils/encryption');
const { version } = require('../package.json');

const HEADERS = { Accept: 'application/json', 'User-Agent': `More-Like-This/${version} (+https://github.com/platorp/More-Like-This)` };
const JSON_LIMIT = 2 * 1024 * 1024;
const CACHE_TTL = 12 * 60 * 60 * 1000;
const IMDB_ID = /^tt\d+$/;
const SERIES_ID = /^(?:tt\d+|tmdb:\d+)$/;

async function readConfig(token) {
 if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error('Invalid configuration');
 const config = await decryptData(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
 const url = new URL(config?.upstream);
 if (url.protocol !== 'https:' || url.hostname !== 'aiometadata.viren070.me' || url.port || url.username || url.password || url.search || url.hash || !/^\/stremio\/[a-f0-9-]{36}(?:\/[A-Za-z0-9_.~%-]+)?$/i.test(url.pathname)) throw Error('Invalid upstream');
 if (typeof config.tmdbApiKey !== 'string' || config.tmdbApiKey.length > 512) throw Error('Invalid TMDB key');
 return { upstream: url.href.replace(/\/$/, ''), tmdbApiKey: config.tmdbApiKey };
}

function validScore(value, votes) {
 return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10 && Number(votes) > 0;
}

function createEpisodeRatingsRouter({ fetchImpl = globalThis.fetch, ratingTimeoutMs = 2500, upstreamTimeoutMs = 10000 } = {}) {
 const router = express.Router();
 const cache = new Map();

 async function cached(key, load) {
  const prior = cache.get(key);
  if (prior && prior.expires > Date.now()) return prior.promise;
  const entry = { expires: Date.now() + CACHE_TTL, promise: Promise.resolve().then(load) };
  cache.delete(key); cache.set(key, entry);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  try { return await entry.promise; }
  catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
 }

 async function json(url, signal, missingAllowed = false) {
  const response = await fetchImpl(url, { headers: HEADERS, signal, redirect: 'error' });
  if (missingAllowed && response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok || response.status < 200 || response.status >= 300) { await response.body?.cancel(); throw Error('Upstream unavailable'); }
  let length = 0; const chunks = [];
  try {
   for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > JSON_LIMIT) throw Error('Response too large');
    chunks.push(Buffer.from(chunk));
   }
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw Error('Invalid upstream response'); }
 }

 async function decorate(meta, requestedId, config) {
  if (!meta || !Array.isArray(meta.videos)) return meta;
  const imdbId = IMDB_ID.test(meta.imdb_id) ? meta.imdb_id : IMDB_ID.test(meta.id) ? meta.id : IMDB_ID.test(requestedId) ? requestedId : null;
  const directTmdb = /^tmdb:(\d+)$/.exec(meta.id || requestedId)?.[1];
  const eligible = meta.videos.flatMap((video, index) => {
   const match = /^(tt\d+|tmdb:\d+):(\d+):(\d+)$/.exec(video?.id || '');
   if (!match || Number(match[3]) < 1) return [];
   if (match[1] !== imdbId && match[1] !== `tmdb:${directTmdb}`) return [];
   const season = Number(match[2]), episode = Number(match[3]);
   if ((video.season != null && video.season !== season) || (video.episode != null && video.episode !== episode)) return [];
   if (video.released && Date.parse(video.released) > Date.now()) return [];
   return [{ index, season, episode, identity: match[1] }];
  });
  if (!eligible.length) return meta;
  const deadline = AbortSignal.timeout(ratingTimeoutMs);
  const imdbSignal = AbortSignal.any([deadline, AbortSignal.timeout(Math.max(1, Math.min(1200, ratingTimeoutMs / 2)))]);
  let imdb = null;
  if (imdbId && eligible.some(entry => entry.identity === imdbId)) {
   try { imdb = await cached(`imdb:${imdbId}`, () => json(`https://raw.githubusercontent.com/ya0903/imdb-episode-dataset/main/data/shows/${imdbId}.json`, imdbSignal, true)); }
   catch { /* Scores are optional; retain useful metadata when a provider fails. */ }
   if (imdb?.id !== imdbId) imdb = null;
  }
  const scores = new Map();
  for (const entry of eligible) {
   if (entry.identity !== imdbId) continue;
   const score = imdb?.seasons?.[entry.season]?.[entry.episode];
   if (validScore(score?.r, score?.v)) scores.set(entry.index, { source: 'IMDb', value: score.r });
  }
  const missing = eligible.filter(entry => !scores.has(entry.index));
  if (missing.length && config.tmdbApiKey && !deadline.aborted) {
   const keyId = crypto.createHash('sha256').update(config.tmdbApiKey).digest('hex');
   try {
    let tmdbId = directTmdb;
    if (!tmdbId && imdbId) {
     const found = await cached(`find:${keyId}:${imdbId}`, () => json(`https://api.themoviedb.org/3/find/${imdbId}?${new URLSearchParams({ external_source: 'imdb_id', api_key: config.tmdbApiKey })}`, deadline));
     tmdbId = found?.tv_results?.[0]?.id;
    }
    if (tmdbId && /^\d+$/.test(String(tmdbId))) {
     const seasons = [...new Set(missing.map(entry => entry.season))];
     for (let offset = 0; offset < seasons.length && !deadline.aborted; offset += 4) {
      await Promise.all(seasons.slice(offset, offset + 4).map(async season => {
       try {
        const details = await cached(`season:${keyId}:${tmdbId}:${season}`, () => json(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?${new URLSearchParams({ api_key: config.tmdbApiKey })}`, deadline));
        if (details?.season_number !== season || !Array.isArray(details.episodes)) return;
        for (const entry of missing.filter(entry => entry.season === season)) {
         const episode = details.episodes.find(row => row.season_number === season && row.episode_number === entry.episode);
         // IMDb and TMDB can number episodes differently; require a matching release day across providers.
         if (entry.identity === imdbId) {
          const released = Date.parse(meta.videos[entry.index].released);
          const aired = Date.parse(episode?.air_date);
          if (!Number.isFinite(released) || !Number.isFinite(aired) || new Date(released).toISOString().slice(0, 10) !== new Date(aired).toISOString().slice(0, 10)) continue;
         }
         if (validScore(episode?.vote_average, episode?.vote_count)) scores.set(entry.index, { source: 'TMDB', value: episode.vote_average });
        }
       } catch { /* A missing season must not remove metadata for other seasons. */ }
      }));
     }
    }
   } catch { /* Leave unmatched episodes unchanged. */ }
  }
  if (!scores.size) return meta;
  const videos = meta.videos.map((video, index) => {
   const score = scores.get(index);
   if (!score) return video;
   const value = score.value.toFixed(1);
   const baseTitle = video.title || video.name || `Episode ${video.episode}`;
   const title = `${baseTitle} · ⭐ ${score.source} ${value}`;
   const synopsis = video.overview || video.description || '';
   const overview = `⭐ ${score.source} episode: ${value}/10${synopsis ? `\n\n${synopsis}` : ''}`;
   return { ...video, title, ...(video.name != null ? { name: title } : {}), overview, ...(video.description != null ? { description: overview } : {}) };
  });
  return { ...meta, videos };
 }

 router.use('/:token', async (req, res, next) => {
  try { res.locals.episodeConfig = await readConfig(req.params.token); next(); }
  catch { res.status(400).json({ error: 'Invalid episode-ratings configuration' }); }
 });
 router.get('/:token/manifest.json', (req, res) => res.json({
  id: 'community.aiometadata.episode-ratings', version, name: 'AIOMetadata Episode Ratings',
  description: 'Episode-specific IMDb ratings with TMDB fallback. Keep AIOMetadata installed and place this addon before it.',
  resources: [{ name: 'meta', types: ['series'], idPrefixes: ['tt', 'tmdb:'] }], types: ['series'], catalogs: [],
 }));
 router.get('/:token/meta/:type/:id.json', async (req, res) => {
  if (req.params.type !== 'series' || !SERIES_ID.test(req.params.id)) return res.status(404).json({ meta: null });
  const config = res.locals.episodeConfig;
  try {
   const payload = await json(`${config.upstream}/meta/series/${encodeURIComponent(req.params.id)}.json`, AbortSignal.timeout(upstreamTimeoutMs));
   const meta = await decorate(payload.meta, req.params.id, config);
   res.set('Cache-Control', 'private, max-age=60').json({ ...payload, meta });
  } catch { res.status(502).json({ meta: null }); }
 });
 return router;
}

module.exports = { createEpisodeRatingsRouter };
