# Doobar 3000

A native Windows music player: **iTunes-simple to use, foobar2000-powerful under the hood.**
Fixed, polished layout out of the box — no user-assembled panels.

## What it does today (Phase 4)

- **Smart playlists**: a "SMART" sidebar section, auto-generated from your tags and
  kept up to date as the library changes (import / remove / retag — no "regenerate"
  button). It lists **Recently Added** (50 newest by import time), one playlist **per
  Genre** (busiest first), and one **per decade** (e.g. 1990s). Genre/decade lists sort
  like the main library; Recently Added stays newest-first. (Audio-"vibe" playlists from
  the actual sound are a planned later pass.)

## What it did as of Phase 3

- **Customizable columns**: right-click the track-list header for a column picker
  (add/remove #, Title, Artist, Album Artist, Album, Genre, Year, Time, Bitrate,
  Sample Rate, Codec, Type, Level). Drag a column header onto another to reorder. The
  chosen set and order persist in settings. Level shows the auto-leveler's gain per track
  (`—` when leveling is off).
- **Auto-tagging (AcoustID + MusicBrainz)**: right-click a track → *Identify (auto-tag)*.
  Fingerprints the file with `fpcalc`, looks it up on AcoustID, and offers ranked tag
  candidates; *Apply* rewrites the file's tags (ffmpeg remux, audio untouched) and rescans
  it. Needs a free AcoustID application key (paste it in ⚙) and the one-click fingerprinter
  download (~1.5 MB, in ⚙).
- **Automatic cover art**: when a track has no embedded art, the art panel fetches it from
  the Cover Art Archive (via a MusicBrainz release-group match) and caches it on disk.
- **Duplicate detection**: the "Duplicates" sidebar entry groups tracks with the same
  title+artist and near-identical length, showing each copy's path / format / bitrate with
  per-row Play and Remove.
- **Context menu**: Play · Identify · Add to Playlist · Search on Spotify · Search on
  Apple Music · Remove from Playlist (in playlists) · Remove from library.
- **Playback modes**: shuffle and repeat (off → all → one) toggles in the transport,
  persisted. Shuffle keeps the current track playing and randomizes the rest; repeat-one
  replays the current track on end; repeat-all wraps the queue (reshuffling for variety).

## What it did as of Phase 2

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
`DEV_EVAL=<js>` runs renderer JS before the screenshot (e.g. open a dialog; `useStore`
is exposed on `window` in dev) · `DEV_FFMPEG_DOWNLOAD=1` exercises the decoder-pack
download · `DEV_FPCALC_DOWNLOAD=1` exercises the fingerprinter download · `DEBUG_LOG=1`
prints media-protocol requests and renderer console to the terminal.

## Tech stack

- **Electron 35 + electron-vite + React 18 + TypeScript**, state in **zustand**.
- **Web Audio API** for playback: `<audio>` element → `MediaElementSource` → `GainNode` →
  destination. Decoding is Chromium's own (lossless to 32-bit float). The gain node is where
  Phase 2's analysers and ReplayGain will attach.
- **music-metadata** for tag reading (bundled into the main process — it's ESM-only, see
  `electron.vite.config.ts`).
- **Persistence**: plain JSON in the user-data dir (`%APPDATA%\doobar3000`): `library.json`,
  `playlists.json`, `settings.json`, `peaks/<sha1-of-path>.json` waveform caches,
  `transcode/<sha1>.flac` decode-fallback cache, `art/<sha1>.img` fetched cover art, and
  `bin/` for the downloaded `ffmpeg.exe` / `fpcalc.exe`.
  (Chose JSON over SQLite to avoid native-module rebuild pain on Windows; fine for 10k+ tracks.)
- **Auto-tagging** (`src/main/acoustid.ts`): `fpcalc -json` fingerprint → AcoustID lookup →
  ranked candidates; *Apply* writes tags via ffmpeg `-c copy` remux (keeps a `.bak` until the
  swap succeeds). **Cover art** (`src/main/art.ts`): MusicBrainz release-group search →
  Cover Art Archive, throttled to 1 req/s, disk-cached. External links (`shell.openExternal`)
  are allow-listed to Spotify/Apple Music/AcoustID HTTPS hosts.

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
- **AcoustID needs `fpcalc`, not ffmpeg**: the gyan.dev "essentials" ffmpeg build is not
  compiled with the chromaprint muxer, so fingerprinting uses the separate `fpcalc.exe`
  (chromaprint releases, ~1.5 MB), installed alongside ffmpeg in `bin/`.
- **MusicBrainz etiquette**: hard 1 req/sec limit and a descriptive `User-Agent` are
  required or it returns 503; Cover Art Archive 404s (no art for that release) are normal
  and negative-cached for the session.
- **Track-list grid is inline**: column widths come from `src/renderer/src/columns.tsx`
  and are written as an inline `grid-template-columns` on the header and every row, since
  the visible column set is user-configurable.

## Roadmap

- **Phase 1 — MVP: DONE.** User-tested 2026-06-12, working.
- **Phase 2 — Audio polish: DONE.** User-tested 2026-06-12, working. Verified via
  the dev harness: ALAC transcode playback, LUFS values sane (−9 to −13 LUFS on real
  masters), visualizers live, download flow exercised end-to-end. Post-test additions
  per user feedback: Level column + album-art lightbox.
- **Phase 3 — Library UX + smart library: DONE.** Self-verified via the dev harness:
  data-driven columns render + the column picker / drag-reorder work; the Duplicates view
  found 18 groups in the real library; the Identify dialog mounts and shows the no-key
  prompt; the AcoustID/fpcalc settings render and the fpcalc download installed
  end-to-end. **Awaiting user testing** — needs a real AcoustID key to exercise actual
  tag identification, and a track lacking embedded art to exercise online art fetch.
- **Playback modes (shuffle / repeat-all / repeat-one): DONE** 2026-06-13. Queue now
  traverses a `order: number[]` / `orderPos` play-order layer (identity when not shuffled);
  logic verified headless (shuffle keeps current at front, repeat-all wraps, cycle order).
- **Phase 4 — Auto-playlists (tag-based): DONE** 2026-06-13. Smart playlists derived live
  from tags (Recently Added + per-genre + per-decade), auto-updating, in a SMART sidebar
  section (`src/renderer/src/smartPlaylists.ts`). Self-verified via the harness against the
  real library: SMART section populates (genres by count, decades), the genre view filters
  correctly (e.g. "12 tracks — Trip-Hop") and stays sortable. (Chat-assistant panel dropped
  per user, 2026-06-13.)
- **Phase 4.5 — Audio "vibe" playlists**: cluster tracks by analyzed sound
  (energy / tempo / brightness). Not started — needs a per-track DSP analysis pass.
- **Final polish**: revisit color scheme/theming (palette lives in CSS variables at the
  top of `styles.css`); space the top-right controls off the Windows caption buttons;
  possibly resizable spectrum/VU meters.

## Where we left off

Phase 3 complete and self-verified via the dev harness (column picker, drag-reorder,
Duplicates view, Identify dialog, AcoustID/fpcalc settings, fpcalc download). Awaiting
user testing. Two paths still need a real-world try because the harness can't supply the
inputs: **auto-tag identification** (paste a free AcoustID key in ⚙, then right-click a
track → Identify) and **online cover-art fetch** (play a track with no embedded art but
clean album/artist tags — watch the art panel fill in).

Playback modes (shuffle/repeat) shipped 2026-06-13. Phase 4 tag-based smart playlists
shipped 2026-06-13 (also fixed a virtualization bug where the track list didn't fill the
viewport — the ResizeObserver was attached in a mount effect that ran before the list
existed; now a callback ref attaches it when the scroll element mounts).

Remaining (awaiting Stan's go on order): **Phase 4.5** audio-"vibe" playlists (cluster by
analyzed sound — needs a per-track DSP pass, not yet started); and the **final-polish**
pass — color scheme (CSS vars top of `styles.css`), spacing the top-right controls away
from the Windows caption buttons, and possibly resizable spectrum/VU meters (recommended a
splitter handle between the two meters, or S/M/L size presets, over per-meter edge-drag).

New Phase-3 source files: `src/renderer/src/columns.tsx` (column registry + cell
rendering), `src/renderer/src/components/IdentifyDialog.tsx`,
`src/renderer/src/components/DuplicatesView.tsx`, `src/main/acoustid.ts`, `src/main/art.ts`.
New Phase-4 source file: `src/renderer/src/smartPlaylists.ts` (derives + resolves smart
playlists; pure function of `library`, which is what makes them auto-update).
