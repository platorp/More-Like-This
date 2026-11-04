# Episode ratings for AIOMetadata

The `/episode-ratings` metadata-only addon adds each episode's own IMDb score beside its title and above its synopsis. Missing IMDb scores fall back to TMDB and are labelled accordingly. Episodes without a usable rating remain unchanged.

The title and description use cinematic icons based on the displayed score: 🏆 9.0–10, 🔥 8.0–8.9, ⭐ 7.0–7.9, 👍 6.0–6.9, 👎 below 6.0. For example, `Pilot · 🏆 9.1`. IMDb stays omitted from titles; TMDB fallback scores keep their source label.

Keep AIOMetadata installed for its catalogs, artwork and settings. Install this additional addon and place it before AIOMetadata in Stremio's addon order. Keep AIOStreams installed for streams. No movie metadata, thumbnails, video IDs or numbering are changed. Only canonical IMDb/TMDB episode IDs are enriched; other ID schemes are passed through without guessing.

## Personal configuration

The install route is `/episode-ratings/<token>/manifest.json`. A token is base64url JSON of the existing AES-GCM `encryptData` result for:

```json
{"upstream":"https://aiometadata.viren070.me/stremio/YOUR_CONFIGURATION_ID","tmdbApiKey":"YOUR_TMDB_API_KEY"}
```

Generate it locally with the same `ENCRYPTION_KEY` as the server, using `utils/encryption.js`. Keep the resulting install link private. The upstream is restricted to the configured AIOMetadata host; arbitrary URLs, redirects and invalid encrypted tokens are rejected. The module does not log keys or upstream errors.

## Data and performance

IMDb ratings come from the daily-built [IMDb episode dataset](https://github.com/ya0903/imdb-episode-dataset), which covers the top 10,000 series and episodes with at least 10 IMDb votes. It is a community mirror built from [IMDb's non-commercial datasets](https://data.imdb.com/non-commercial-datasets/), not an IMDb-operated API. Use is personal/non-commercial.

TMDB season details supply the fallback. IMDb-numbered episodes require a matching release day before a TMDB fallback score is applied. TMDB-numbered episodes use their direct TMDB scores, since IMDb season numbering is not assumed equivalent. The wrapper does not substitute the show's overall score. Provider JSON requests have a 2 MiB limit, rating enrichment has a 2.5-second deadline, and provider lookups share a bounded 128-entry, 12-hour cache. AIOMetadata fetches have a 10-second timeout. Unavailable rating providers preserve the original metadata.

The existing Azure F1 instance remains subject to its normal cold starts and shared limits. No paid resource or new database is needed. Native Stremio display of episode descriptions varies by client.
