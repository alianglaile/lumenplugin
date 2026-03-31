# Lumen Player Plugin Repository

This directory contains video source plugins for Lumen Player. Each plugin is a standalone subdirectory that defines its page structure and API mappings via `config.json`, paired with JavaScript scripts to parse third-party website content.

---

## 📁 Plugin Overview

| Plugin | Directory | Purpose | Search | Playback |
|--------|-----------|---------|--------|----------|
| Douban Picks | `douban/` | Movie database & curated recommendations | ❌ | ❌ |
| Olevod | `olevod/` | General-purpose streaming platform | ✅ | ✅ |
| Jable.TV | `jable/` | Adult content (18+) | ✅ | ✅ |

---

## 🎬 Plugin Details

### `douban/` — Douban Picks

A theme-based plugin for the Douban movie database, offering curated recommendations and chart browsing. **Does not provide playback functionality.** Best used as a theme source alongside other video sources — after finding an interesting title on Douban, Lumen will automatically search for playback links from other video sources.

**Supported Pages:**

| Category | Description |
|----------|-------------|
| Home | Aggregates trending movies, popular series, and popular variety shows |
| Trending / Latest Movies | Sorted by recency and popularity |
| Douban Top Rated / Hidden Gems | Filtered by rating |
| New Releases / Weekly Buzz / US Box Office | Various charts |
| Douban Top 250 | Classic masterpiece rankings |
| Annual Lists (2021–2025) | Yearly curated selections |

**File Structure:**
- `config.json` — Page definitions and API endpoints
- `main.min.js` — Data parsing logic (minified)

---

### `olevod/` — Olevod

A comprehensive streaming plugin covering movies, TV series, short dramas, variety shows, anime, and more. Supports full browsing, search, and playback functionality.

> ⚠️ **Blocks Mainland China IPs** — intended for overseas users.

**Supported Pages:**

| Category | Description |
|----------|-------------|
| Home | Latest additions |
| Movies | Theatrical and classic films |
| TV Series | Chinese, American, Korean dramas, etc. |
| Short Dramas | Short-form series |
| Variety Shows | Various entertainment programs |
| Anime | Animation and manga adaptations |

**Technical Highlights:**
- Uses `crypto-js` for API signature authentication
- Supports Home page Hero Banner carousel
- Supports keyword search

**File Structure:**
- `config.json` — Page definitions and API endpoints
- `main.js` — Main data parsing and signature logic
- `crypto-js.min.js` — Cryptography library
- `t.js` — Helper utility script

---

### `jable/` — Jable.TV (18+)

An adult video streaming plugin providing HD 1080P content. Supports category browsing, search, and direct playback.

**Supported Pages:**

| Category | Description |
|----------|-------------|
| Home | Aggregates recent updates, weekly trending, etc. |
| Recent Updates / Weekly Trending | Sorted by recency and popularity |
| Chinese Subtitles / Uncensored | Filtered by subtitle or type |
| Other Categories | Cosplay, roleplay, and more |

**File Structure:**
- `config.json` — Page definitions and search URL templates
- `main.js` — HTML page parsing logic (unminified, human-readable)

---

## 🔧 Plugin Directory Structure

Each plugin follows a unified file structure:

```
<plugin-name>/
├── config.json       # Plugin config (URL & JS function mappings for pages, search, playback, episodes)
├── main.js           # Main JavaScript logic
└── *.js              # Optional helper files (e.g., crypto-js.min.js)
```

### `config.json` Core Fields

| Field | Description |
|-------|-------------|
| `name` / `description` | Plugin name and description |
| `host` | Target website domain |
| `files` | List of JS files to load (loaded in order) |
| `pages` | Page definition array — each page specifies `key`, `title`, `url`, `javascript` function name |
| `search` | Search configuration (URL template + JS function) |
| `episodes` | Episode list retrieval configuration |
| `player` | Playback URL parsing configuration |
| `heroBanner` | Home page carousel banner configuration (optional) |

---

## 🚀 How to Use with Lumen Player

1. Plugins are hosted on GitHub and accessed via Raw URLs
2. In the video source configuration (`sources.json`), set the `api` field to:
   ```
   lumen://https://raw.githubusercontent.com/alianglaile/lumenplugin/main/<plugin-name>/config.json
   ```
3. Lumen Player will automatically download the `config.json` and its referenced JS files, then load and execute them
