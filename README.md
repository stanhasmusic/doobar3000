# Doobar 3000

A native Windows music player: **iTunes-simple to use, foobar2000-powerful under the hood.**
Fixed, polished layout out of the box — no user-assembled panels.

## What it does today (end of Phase 2)

- **Real-time visualizers** in the top bar: log-frequency spectrum analyzer and stereo
  VU meter with peak hold, fed by `AnalyserNode` taps on the playback graph.
- **LUFS auto-leveling** (EBU R128 / ReplayGain 2.0, target −18 LUFS): every track is
  analyzed in the background via ffmpeg's `ebur128` filter (2 workers, results stream in
  and persist). Toggle Off / Track / Album in the ⚙ menu — Album mode applies one
  energy-weighted gain per album so its internal dynamics survive; positive gains are
  capped by true peak to avoid clipping.
- **Decoder pack**: ⚙ menu offers a one-click ~80 MB ffmpeg download (gyan.dev essentials
  → extracted with Windows' built-in tar → `%APPDATA%\doobar3000\bin`). With it installed,
  Chromium-unplayable formats (ALAC, APE, WMA, …) transparently transcode to cached FLAC
  (`%APPDATA%\doobar3000\transcode/`) and play; without it they skip with a notice.
- **Album art panel** (bottom of sidebar) showing the current track's embedded art.
  Click it to open a full-window enlarged view (click again or Esc to close).
- **Level column**: while auto-leveling is on, the track list grows a right-hand
  column showing the gain being applied to each track (e.g. −6.4 dB; "…" = not yet
  analyzed). In Album mode, tracks that show a different gain than their album-mates
  have a mismatched album-artist tag and got grouped separately.
- **Drag-and-drop from Explorer**: drop files/folders onto the track list to import, or
  onto a playlist to import-and-add.
- Scanner now records bitrate / sample rate / codec / file type (for Phase 3 columns)
  and LUFS analysis fields. Rescan a folder to backfill old entries.

## Phase 1 features

- **Import a folder** of music (mp3, flac, m4a, aac, ogg, opus, wav). Tags are read with
  `music-metadata`; the library persists between launches.
- **Center pane**: virtualized, sortable track list (#, Title, Artist, Album, Genre, Time).
  Artist/Album sorts cascade iTunes-style (artist → album → track number). Double-click to play.
- **Left sidebar**: playlists — create (+), rename (double-click), delete (× on hover).
  Saved to disk, persist between launches. Playlist views keep manual order (not sortable).
- **Playback**: play/pause/next/prev, Space toggles play, volume slider, right-click →
  Play / Add to Playlist / Remove from Playlist.
- **Bottom waveform seek bar**: per-track waveform (computed on first play, cached),
  click anywhere to jump. Normalized to the track's own peak.
- **Top bar**: transport, current track info + time, volume. Empty box = Phase 2 spectrum/VU slot.

## How to run

```
npm install
npm run dev
```

Optional: `npm run make-test-audio` generates tagged test WAVs in `./test-music/`.

Dev-harness env vars (used for automated testing, safe to ignore):
`SCAN_DIR=<folder>` merge-scans a folder on launch · `DEV_AUTOPLAY=1` plays the first
track · `DEV_SEEK=<sec>` seeks shortly after autoplay · `SCREENSHOT_PATH=<file.png>`
captures the window and exits (`SCREENSHOT_DELAY=<ms>`, default 5000) ·
`DEV_FFMPEG_DOWNLOAD=1` exercises the decoder-pack download · `DEBUG_LOG=1` prints
media-protocol requests and renderer console to the terminal.

## Tech stack

- **Electron 35 + electron-vite + React 18 + TypeScript**, state in **zustand**.
- **Web Audio API** for playback: `<audio>` element → `MediaElementSource` → `GainNode` →
  destination. Decoding is Chromium's own (lossless to 32-bit float). The gain node is where
  Phase 2's analysers and ReplayGain will attach.
- **music-metadata** for tag reading (bundled into the main process — it's ESM-only, see
  `electron.vite.config.ts`).
- **Persistence**: plain JSON in the user-data dir (`%APPDATA%\doobar3000`): `library.json`,
  `playlists.json`, `settings.json`, and `peaks/<sha1-of-path>.json` waveform caches.
  (Chose JSON over SQLite to avoid native-module rebuild pain on Windows; fine for 10k+ tracks.)

## Architecture notes / gotchas

- Local audio files are served to the renderer via a custom **`media://` protocol**
  (`src/main/index.ts`) that streams from disk with **byte-range support** — mandatory, because
  m4a/mp4 files keep their index (moov atom) at the end and Chromium won't play them without
  seeking. It also adds an `Access-Control-Allow-Origin` header — **without that header Web
  Audio outputs silence** (cross-origin media elements are "tainted"). The `<audio>` element
  uses `crossOrigin='anonymous'`.
- **ALAC (Apple Lossless) m4a files don't decode in Chromium**
  (`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`); AAC m4a is fine. With the decoder pack
  installed, the `<audio>` error handler transcodes once to cached FLAC and retries;
  the waveform decodes from the transcode (`playbackPath`) but caches peaks under the
  original path.
- **ebur128 stderr parsing**: the filter logs a progress line per frame whose `I:` value
  starts at −70 LUFS — always take the LAST `I:`/`Peak:` match (the summary), not the first.
- **React StrictMode double-mounts in dev** — store init/autoplay is guarded by a module
  flag (`App.tsx`), otherwise listeners register twice and tracks double-load.
- Stray Electron instances from interrupted dev runs hold the userData dir and Vite port
  ("Unable to move the cache: Access is denied"); `Stop-Process -Name electron` clears them.
- Streamed sources can report `duration = Infinity`; UI code falls back to the scanned
  metadata duration (see `WaveformBar.tsx`).
- Volume is applied via the GainNode with a squared (perceptual) curve, not `el.volume`.
- The window uses `titleBarStyle: 'hidden'` + `titleBarOverlay`; the top bar is the drag
  region and has 150px right padding to clear the Windows caption buttons.
- `userData` path is pinned explicitly so dev and packaged builds share one data folder.

## Roadmap

- **Phase 1 — MVP: DONE.** User-tested 2026-06-12, working.
- **Phase 2 — Audio polish: DONE.** User-tested 2026-06-12, working. Verified via
  the dev harness: ALAC transcode playback, LUFS values sane (−9 to −13 LUFS on real
  masters), visualizers live, download flow exercised end-to-end. Post-test additions
  per user feedback: Level column + album-art lightbox.
- **Phase 3 — Library UX + smart library**: re-arrangeable and add/remove track-list
  columns (bitrate, file type, year, …); AcoustID/MusicBrainz auto-tagging (needs free
  API key); auto-fetch missing album art (Cover Art Archive, via the same MusicBrainz IDs);
  duplicate detection; Spotify/Apple Music search links in the context menu.
- **Phase 4 — Stretch**: auto-playlists by genre/vibe; possibly a chat assistant panel.
- **Final polish**: revisit color scheme/theming (palette lives in CSS variables at the
  top of `styles.css`).

## Where we left off

Phase 2 user-tested and approved; two follow-up requests (album-art lightbox, Level
column) implemented. Next: Phase 3 (column customization, AcoustID/MusicBrainz
auto-tagging + cover-art fetch, duplicate detection, Spotify/Apple Music links) —
awaiting go-ahead.
