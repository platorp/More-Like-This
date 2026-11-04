# Episode ratings in AIOMetadata text

The user chose a small metadata wrapper on the existing Azure More Like This app instead of self-hosting AIOMetadata. It adds each episode's own score to its title (`Pilot · 🏆 9.1`) and above its synopsis (`🏆 IMDb episode: 9.1/10`). IMDb is primary and TMDB is the fallback, with the actual source always labelled in the description. Rotten Tomatoes is outside this change after the user's correction. Missing, unaired or ambiguously mapped episode scores leave the original text unchanged.

Keep the user's AIOMetadata addon installed for catalogs. The additional metadata-only addon is placed before AIOMetadata in Stremio's addon order. It forwards series metadata to the user's existing AIOMetadata configuration, preserves all episode IDs, numbering, artwork, streams and other fields, and changes only rated episodes' text. It does not change recommendation behavior, AIOStreams configuration, or poster services.

The wrapper uses the existing Node/Express runtime, AES-GCM configuration encryption and Azure deployment. No new dependency, account, paid resource, database or scheduled IMDb download is needed. Per-show IMDb scores come from ya0903/imdb-episode-dataset, a daily-built subset of IMDb's non-commercial datasets. Missing IMDb scores fall back to TMDB season responses using the existing TMDB key. Exact IMDb/TMDB episode identities must match the requested series and season/episode; unidentified anime or other numbering schemes pass through without guessing.

Keep request timeouts finite, bound response sizes and caches, coalesce concurrent rating requests, and return original metadata when ratings are temporarily unavailable. Restrict upstream metadata to the configured AIOMetadata host, reject redirects and invalid encrypted configurations, and never log private links or keys. Configuration is minted locally using the existing encryption key and delivered as a private install link; no general-purpose proxy/configuration endpoint is added.

Alternatives considered: self-hosting patched AIOMetadata adds a full service to maintain; a thumbnail service changes artwork and was explicitly declined. MDBList was tested but the user's key omits the detailed episode API breakdown. The user chose the free IMDb dataset with TMDB fallback instead.

Verification: test title/description enrichment, fallback, mismatched identity, missing/zero scores, season zero, unaired episodes, upstream/rating failures, cache reuse, invalid/tampered tokens, blocked upstream origins/redirects, response size limits and deadline cancellation. Verify existing regressions, live Grand Hotel/Breaking Bad responses, artwork and episode ID equality, and confirm installation/ordering where the Stremio client is accessible.

## Cinematic icons (user-selected update)

Use 🏆 at 9.0–10, 🔥 at 8.0–8.9, ⭐ at 7.0–7.9, 👍 at 6.0–6.9 and 👎 below 6.0 in both episode titles and descriptions. Choose the band after rounding to the displayed one-decimal score, for IMDb and TMDB alike. Keep IMDb omitted from titles, TMDB labelled and the description source explicit. Unrated episodes stay unchanged. The user chose cinematic over colour-coded, expressive and Unicode-only alternatives. This is a text-only update in the existing decorator, with no new options, requests or dependencies.
