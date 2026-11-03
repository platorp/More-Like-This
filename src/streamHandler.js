const { getCombinedRecs } = require("./recManager");
const { generateFullMeta } = require("./metadata");
const idConverter = require("../utils/idConverter");
const { withTimeout } = require("../utils/timeout");

function text(value, limit = 140) {
	if (typeof value !== "string" && typeof value !== "number") return "";
	const clean = String(value).replace(/\s+/g, " ").trim();
	const characters = Array.from(clean);
	return characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : clean;
}

function describe(meta) {
	const year = text(meta.year || meta.releaseInfo, 12);
	const lines = [text(meta.name) + (year ? ` (${year})` : "")];
	const facts = [];
	if (Number(meta.imdbRating) > 0) facts.push(`⭐ ${text(meta.imdbRating, 12)}`);
	const runtime = text(meta.runtime, 40);
	if (runtime) facts.push(`⏱ ${runtime}${/^\d+$/.test(runtime) ? " min" : ""}`);
	if (facts.length) lines.push(facts.join(" · "));
	const genres = Array.isArray(meta.genres) ? meta.genres.slice(0, 3).map(genre => text(genre, 40)).filter(Boolean).join(" · ") : text(meta.genres, 100);
	if (genres) lines.push(`🎭 ${genres}`);
	const synopsis = text(meta.description, 240);
	if (synopsis) lines.push(`📖 ${synopsis}`);
	return lines.join("\n");
}

async function streamHandler(origin, type, metaId, userConfig, metadataSource) {
	if (!["movie", "series"].includes(type) || typeof metaId !== "string") return { streams: [], cacheMaxAge: 0 };
	const keys = Object.fromEntries(["tmdb", "trakt", "simkl", "gemini", "tastedive", "watchmode"].map(source => [
		source, ["tmdb", "trakt"].includes(source) ? userConfig.apiKeys?.[source] || { key: "", valid: false } : { key: "", valid: false },
	]));
	if (!keys.tmdb.valid && !keys.trakt.valid) return { streams: [], cacheMaxAge: 0 };

	try {
		const rawId = metaId.replace(/^mlt-(?:meta|rec)-/, "");
		let imdbId;
		if (/^tt\d+(?::\d+:\d+)?$/.test(rawId)) imdbId = rawId.split(":")[0];
		else if (/^tmdb:\d+(?::\d+:\d+)?$/.test(rawId) && keys.tmdb.valid) imdbId = await idConverter.tmdbToImdb(rawId.split(":")[1], type, keys.tmdb.key);
		else if (/^trakt:\d+(?::\d+:\d+)?$/.test(rawId) && keys.trakt.valid) imdbId = (await idConverter.traktToImdbTitleYearType(rawId.split(":")[1], type, keys.trakt.key, metadataSource))?.imdbId;
		else if (/^kitsu:\d+(?::\d+:\d+)?$/.test(rawId)) imdbId = (await idConverter.kitsuToImdbTitleYearType(rawId.split(":").slice(0, 2).join(":"), metadataSource))?.imdbId;
		if (!/^tt\d+$/.test(imdbId || "")) return { streams: [], cacheMaxAge: 0 };

		const recs = await getCombinedRecs(null, null, type, imdbId, keys, userConfig.includeTmdbCollection, metadataSource, "stream-tmdb-trakt");
		const seen = new Set([imdbId]);
		const selected = recs.filter(rec => {
			if (!/^tt\d+$/.test(rec?.imdbId || "") || seen.has(rec.imdbId)) return false;
			seen.add(rec.imdbId);
			return true;
		}).slice(0, 10);
		const base = origin === "https://web.stremio.com" ? "https://web.stremio.com/#" : "stremio://";
		const streams = await Promise.all(selected.map(async rec => {
			const meta = await withTimeout(generateFullMeta(rec.imdbId, type, metadataSource), 3500, "Recommendation metadata timed out").catch(() => null);
			const name = text(meta?.name || rec.name);
			if (!name) return null;
			return {
				name: `${type === "movie" ? "🎬" : "📺"} More Like This`,
				description: describe({ ...meta, name, year: meta?.year || rec.year }),
				externalUrl: `${base}/detail/${type}/${rec.imdbId}`,
			};
		}));
		const entries = streams.filter(Boolean);
		return { streams: entries, cacheMaxAge: entries.length ? 300 : 0 };
	} catch {
		return { streams: [], cacheMaxAge: 0 };
	}
}

module.exports = { streamHandler };
