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
  (`src/main/index.ts`) that proxies `net.fetch(file://…)` and adds an
  `Access-Control-Allow-Origin` header — **without that header Web Audio outputs silence**
  (cross-origin media elements are "tainted"). The `<audio>` element uses `crossOrigin='anonymous'`.
- Streamed sources can report `duration = Infinity`; UI code falls back to the scanned
  metadata duration (see `WaveformBar.tsx`).
- Volume is applied via the GainNode with a squared (perceptual) curve, not `el.volume`.
- The window uses `titleBarStyle: 'hidden'` + `titleBarOverlay`; the top bar is the drag
  region and has 150px right padding to clear the Windows caption buttons.
- `userData` path is pinned explicitly so dev and packaged builds share one data folder.

## Roadmap

- **Phase 1 — MVP: DONE** (everything above).
- **Phase 2 — Audio polish**: real-time spectrum analyzer + VU meter in the top bar slot;
  LUFS auto-leveling (EBU R128 / ReplayGain 2.0) with track/album/off modes, album mode
  preserving relative loudness. ffmpeg arrives here (LUFS scanning) and doubles as the
  decoder fallback for exotic formats (ape, wma, …) via a one-click download.
- **Phase 3 — Smart library**: AcoustID/MusicBrainz auto-tagging (needs free API key),
  duplicate detection, Spotify/Apple Music search links in the context menu.
- **Phase 4 — Stretch**: auto-playlists by genre/vibe; possibly a chat assistant panel.

## Where we left off

Phase 1 complete and verified (scan → list → play → waveform → seek all tested via the
screenshot harness with generated WAVs). Awaiting user testing with a real music collection
before starting Phase 2.
