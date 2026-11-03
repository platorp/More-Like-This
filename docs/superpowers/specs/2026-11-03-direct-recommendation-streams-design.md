# Direct recommendation entries

## Intent

Replace the generic More Like This navigation buttons in the stream list with actual recommended titles. The user chose formatting inside More Like This, inspired by Tamtaro's readable emoji layout, without an AIOStreams integration.

## Approaches

- Format recommendation entries inside this addon: uses standard Stremio stream descriptions and links, with no new service. The user selected this approach.
- Delegate formatting to an existing AIOStreams/Tamtaro setup: adds a dependency on another configured addon. The user selected internal formatting instead.

## Proposed behavior

Opening a movie or series stream list immediately requests recommendations from TMDB and Trakt using the user's configured keys. Merge the providers, remove duplicates and the original title, and prioritize titles recommended by both providers using the existing ranking. Show at most ten entries. A provider that is missing or unavailable does not prevent the other provider from returning results.

Each entry shows the recommended title, year, rating, runtime, genres, and a short synopsis when the metadata supplies them. Omit unavailable fields rather than inventing values. Use simple emoji labels rather than requiring Tamtaro's formatter runtime. Example layout, with illustrative content:

```text
🎬 Interstellar (2014)
⭐ 8.7  ·  ⏱ 169 min
🎭 Adventure · Drama · Sci-Fi
📖 A team travels beyond Earth in search of a future for humanity.
```

Selecting an entry opens that recommended title's normal detail page in Stremio. The user's existing playback addons provide streams on that page. These recommendation entries do not themselves resolve or play video. Series open their own episode selection.

## Efficiency and compatibility

Use existing provider and metadata caching, bound enrichment work, and keep descriptions short. Fetch text metadata directly rather than generating a poster catalog first. Return a useful partial list if one metadata request fails. No video or image proxying, additional server, or paid hosting tier is needed.

Update the existing configuration controls so they describe direct recommendations rather than offering the obsolete navigation buttons. Preserve existing credentials and encrypted install links. Other provider code is outside this change; the direct stream recommendations use TMDB and Trakt only.

## Verification

Test merged ranking and deduplication, the ten-title limit, movie and episode IDs, readable formatting with missing metadata, title navigation, single-provider failures, and reuse of cached metadata. Verify local HTTP responses before publishing through the existing GitHub/Azure workflow. Native Stremio rendering and link behavior depend on the client and need a user-visible check.

## Confirmed selection behavior

The user confirmed that selecting a recommendation opens its Stremio title page. Internal formatting and the proposed layout were selected in this conversation.
