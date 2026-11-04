# Episode Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add episode-specific IMDb scores to AIOMetadata titles and descriptions, with labelled TMDB fallback.

**Architecture:** Mount a metadata-only Express router in the existing Azure app. Read an encrypted configuration, fetch existing AIOMetadata metadata and decorate only exactly matched episode text using bounded, cached provider lookups.

**Tech Stack:** Existing Node 24, Express, AES-GCM utilities, native fetch/AbortSignal, node:test.

**Spec:** docs/superpowers/specs/2026-11-04-episode-ratings-design.md

## Global Constraints
- No thumbnail, episode-ID, numbering, recommendation or AIOStreams changes.
- IMDb first, TMDB fallback; source names are explicit; no Rotten Tomatoes work.
- No new dependencies or paid infrastructure. Keep private configuration out of source and logs.
- Unsupported identities and unavailable ratings retain original metadata.

## Review Focus
- Upstream URLs must not become a redirect or private-network proxy.
- A show's overall rating must never be applied to an episode.
- Non-IMDb numbering schemes must not inherit another season's episode scores.
- Failed providers must preserve useful metadata and release network resources.
- Encrypted configuration must not appear in logs, public samples or committed artifacts.

### Task 1: Metadata wrapper and rating integration

**Files:** Create `src/episodeRatings.js`, `test/episodeRatings.test.js`; modify `server.js`; document in `docs/episode-ratings.md`.

**Interfaces:** `createEpisodeRatingsRouter({fetchImpl, ratingTimeoutMs, upstreamTimeoutMs})` returns an Express router mounted at `/episode-ratings`. Router exposes `/:token/manifest.json` and `/:token/meta/:type/:id.json`. Config token is base64url JSON of existing `encryptData({upstream,tmdbApiKey})` output. Only exact canonical IMDb/TMDB episode IDs are enriched.

- [ ] Write failing integration tests with a real HTTP Express server, real configuration encryption and stubbed external HTTP responses.
- [ ] Run `node --test test/episodeRatings.test.js`; expect missing implementation failure, then test meaningful cases as they are added.
- [ ] Implement the router and bounded/cache-coalesced IMDb/TMDB lookups. Default rating deadline 2500ms, upstream timeout 10000ms, JSON limit 2MiB, cached provider data 12h with at most 128 entries.
- [ ] Add malformed/tampered config, invalid upstream/redirect, missing/zero/unrated/unaired/mismatched IDs, season-zero, rating-error, coalescing, bounded-response and abort tests. Rated title is `Title · ⭐ 8.7` for IMDb; TMDB fallback retains its label; description prefix is `⭐ IMDb episode: 8.7/10` or equivalent labelled TMDB fallback.
- [ ] Mount router before existing routes; run `node --test` and `git diff --check`, expect all passing.
- [ ] Commit the tested implementation and obtain one independent final review. Address material findings with a failing regression followed by a passing full suite.

### Task 2: Deploy and validate the user's installation

**Files:** Private runtime config/verification artifacts in the task-owned work folder; public documentation only in the repo.

**Interfaces:** Use Task 1's encrypted install token and routes. Keep existing GitHub Actions Azure deployment and current environment encryption key.

- [ ] Generate private local token, test local Grand Hotel and Breaking Bad metadata against upstream, confirm episode IDs/art unchanged and correct source/season text.
- [ ] Publish the reviewed commit through the already-authorized GitHub/Azure deployment; expect workflow success and existing live manifest unchanged.
- [ ] Verify deployed wrapper metadata and preserve the actual private install link in a user-facing private artifact.
- [ ] Install/order through available Stremio UI, or provide the exact concrete remaining client step if the client cannot be controlled.
- [ ] Update owned planning files, inspect completion checker and report actual results and any client-verification gap.

## Cinematic icons update

User selected the cinematic thresholds in the design amendment. Implement directly in the existing isolated worktree.

- [x] Add HTTP integration coverage for every threshold, rounding across thresholds, IMDb/TMDB labels and title/name/overview/description consistency; observe failure.
- [x] Select the icon from the displayed score in `src/episodeRatings.js`; reuse it in both text fields and update user documentation.
- [x] Run `node --test` and `git diff --check`, and review the small diff (48 tests pass).

Release through the existing Azure pipeline and verify live metadata; record the release result in the task progress file.
