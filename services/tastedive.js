const fetch = require("node-fetch");
const { version } = require("../package.json");
const TASTEDIVE_API_BASE_URL = "https://tastedive.com/api/similar?";
const TASTEDIVE_HEADERS = {
	Accept: "application/json",
	"User-Agent": `More-Like-This/${version} (+https://github.com/rama1997/More-Like-This)`,
};

async function requestSimilar(parameters) {
	const url = TASTEDIVE_API_BASE_URL + new URLSearchParams(parameters);
	let response;
	try {
		response = await fetch(url, { timeout: 10000, headers: TASTEDIVE_HEADERS });
	} catch {
		// Fetch errors can contain the request URL and API key.
		throw new Error("Could not reach TasteDive. Your key could not be verified.");
	}

	if (!response.ok) {
		if (response.status === 403) {
			const body = await response.text().catch(() => "");
			if (/<html[\s>]/i.test(body) && /cloudflare/i.test(body)) {
				throw new Error("TasteDive blocked this server through Cloudflare (HTTP 403). Your key could not be verified.");
			}
		}
		throw new Error(`TasteDive returned HTTP ${response.status}. Your key could not be verified.`);
	}

	let json;
	try {
		json = await response.json();
	} catch {
		throw new Error("TasteDive returned a non-JSON response. Your key could not be verified.");
	}

	const similar = json?.similar ?? json?.Similar;
	const info = similar?.info ?? similar?.Info;
	const results = similar?.results ?? similar?.Results;
	if (!Array.isArray(info) || !Array.isArray(results)) {
		throw new Error("TasteDive returned an unexpected response. Your key could not be verified.");
	}
	return {
		info: info.map(item => normalizeItem(item)),
		results: results.map(item => normalizeItem(item, parameters.type)),
	};
}

function normalizeItem(item, fallbackType) {
	const name = item?.name ?? item?.Name;
	const type = item?.type ?? item?.Type ?? fallbackType;
	if (typeof name !== "string" || typeof type !== "string") {
		throw new Error("TasteDive returned an unexpected response. Your key could not be verified.");
	}
	return { name, type };
}

async function validateAPIKey(apiKey) {
	if (!apiKey || apiKey === "") {
		return false;
	}
	await requestSimilar({ q: "hi", type: "movie", limit: "1", k: apiKey });
	return true;
}

async function getAPIEndpoint(mediaType) {
	// Tastedive API endpoint uses "movie" and "show"
	return mediaType === "movie" ? "movie" : "show";
}

async function fetchRecs(title, year, mediaType, apiKey) {
	try {
		const type = await getAPIEndpoint(mediaType);
		const cleanedTitle = title.replace(/[^\p{L}\p{N} ]/gu, "");

		return await requestSimilar({ q: `${type}:${cleanedTitle}`, type, slimit: "2", k: apiKey });
	} catch (error) {
		return [];
	}
}

module.exports = {
	validateAPIKey,
	fetchRecs,
};
