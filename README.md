# Doobar 3000

A native Windows music player: **iTunes-simple to use, foobar2000-powerful under the hood.**
Fixed, polished layout out of the box — no user-assembled panels.

## What it does today (end of Phase 1)

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
`SCAN_DIR=<folder>` seeds the library on launch · `DEV_AUTOPLAY=1` plays the first track ·
`SCREENSHOT_PATH=<file.png>` captures the window after 5s and exits.

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
- **ALAC (Apple Lossless) m4a files don't decode** — Chromium has no ALAC codec
  (`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`). The player shows a notice and auto-skips them.
  The Phase 2 ffmpeg fallback will make these playable. AAC m4a files are fine.
- `DEBUG_LOG=1` prints media protocol requests and renderer console to the terminal.
- Streamed sources can report `duration = Infinity`; UI code falls back to the scanned
  metadata duration (see `WaveformBar.tsx`).
- Volume is applied via the GainNode with a squared (perceptual) curve, not `el.volume`.
- The window uses `titleBarStyle: 'hidden'` + `titleBarOverlay`; the top bar is the drag
  region and has 150px right padding to clear the Windows caption buttons.
- `userData` path is pinned explicitly so dev and packaged builds share one data folder.

## Roadmap

- **Phase 1 — MVP: DONE** (everything above). User-tested 2026-06-12, working.
- **Phase 2 — Audio polish**: real-time spectrum analyzer + VU meter in the top bar slot;
  LUFS auto-leveling (EBU R128 / ReplayGain 2.0) with track/album/off modes, album mode
  preserving relative loudness. ffmpeg arrives here (LUFS scanning) and doubles as the
  decoder fallback for exotic formats (ALAC, ape, wma, …) via a one-click download.
  Also: embedded album-art panel (bottom of sidebar), drag-and-drop files/folders from
  Explorer into library or playlists, and scanner captures bitrate / sample rate / codec /
  file type so the Phase 3 column picker has data (avoids forcing rescans later).
- **Phase 3 — Library UX + smart library**: re-arrangeable and add/remove track-list
  columns (bitrate, file type, year, …); AcoustID/MusicBrainz auto-tagging (needs free
  API key); auto-fetch missing album art (Cover Art Archive, via the same MusicBrainz IDs);
  duplicate detection; Spotify/Apple Music search links in the context menu.
- **Phase 4 — Stretch**: auto-playlists by genre/vibe; possibly a chat assistant panel.
- **Final polish**: revisit color scheme/theming (palette lives in CSS variables at the
  top of `styles.css`).

## Where we left off

Phase 1 complete, verified with real files, and user-tested ("everything functioning
well"). Next up: Phase 2 — first task is ffmpeg integration (LUFS scan + ALAC/exotic-format
decode fallback), then analyzers, auto-gain, album art panel, Explorer drag-and-drop, and
the scanner field additions.
