# Direct Recommendation Streams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show up to ten enriched TMDB/Trakt recommendations directly in the stream list, each linking to its title page.

**Architecture:** Keep the current streamHandler interface and reuse getCombinedRecs plus generateFullMeta and their caches. Retain name/year in provider recommendation rows to allow basic entries when enrichment fails; restrict this stream flow to configured TMDB/Trakt keys. Remove obsolete stream-button controls while preserving encrypted install compatibility.

**Tech Stack:** Existing Node 24 CommonJS, Express, node-fetch, node:test, vanilla HTML/JavaScript. No new dependency or service.

**Spec:** docs/superpowers/specs/2026-11-03-direct-recommendation-streams-design.md

## Global Constraints
- Show at most ten entries.
- The direct stream recommendations use TMDB and Trakt only.
- Selecting an entry opens that recommended title's normal detail page in Stremio.
- Omit unavailable fields rather than inventing values.
- Preserve existing credentials and encrypted install links.
- No video or image proxying, additional server, or paid hosting tier is needed.

## Review Focus
- Episode requests must recommend the parent series, then open the recommended series without an episode suffix.
- Unsupported IDs must return an empty list without fetching unrelated media.
- Missing/failed metadata must not discard a usable provider title.
- One unavailable provider must not hide results from the other.
- Legacy button preferences must not suppress new recommendations or break config reload/save.

### Task 1: Direct recommendation flow
**Files:** Modify src/streamHandler.js and src/recManager.js; create test/streamHandler.test.js.
**Interfaces:** Existing streamHandler(origin,type,metaId,userConfig,metadataSource) returns {streams,cacheMaxAge}; consume getCombinedRecs and generateFullMeta. Keep existing consumers compatible.
- [ ] Add behavioral tests using controlled external provider/metadata boundaries: direct rich entries and title links; TMDB/Trakt merge rank, self removal/dedup/ten-title cap; metadata failure and omitted fields; disabled other providers; episode and legacy prefix IDs; non-IMDb conversion and unsupported IDs; cached repeated enrichment.
- [ ] Run node --test test/streamHandler.test.js and observe expected failures before code changes.
- [ ] Retain provider title/year in recommendation rows. Replace buttons with bounded metadata enrichment and emoji description formatting, preserving existing rank and supported ID conversion. Return standard title links for web/native clients and a short cache age for nonempty results. Use existing finite provider timeouts and a finite metadata deadline.
- [ ] Run node --test and git diff --check; expected all tests pass. Commit the tested runtime change.

### Task 2: Configuration and delivery
**Files:** Modify server.js, public/configure.html, public/catalogOrder.js, public/loadUserConfig.js, README.md.
**Interfaces:** Existing saveConfig form and loadUserConfig encrypted data; remove unused streamOrder/enabledStreamButtons fields without affecting provider keys or catalog preferences.
- [ ] Replace the obsolete stream-button section with clear text explaining direct TMDB/Trakt recommendations and title selection. Remove its dead form-handling code and server parsing. Update README usage.
- [ ] Run node --test and git diff --check; use local HTTP and isolated Playwright to verify save/load, legacy install compatibility and configuration page without script errors. Verify real provider metadata with privately entered credentials if available; otherwise record the gap without requesting keys in chat.
- [ ] Commit verified UI/documentation changes, request a whole-branch review, and address concrete important findings with failing regression tests first.
- [ ] Push tested source to the user's fork main through the already-authorized workflow. Observe GitHub tests/deployment and live endpoint checks. Keep F1 and existing secrets intact.
