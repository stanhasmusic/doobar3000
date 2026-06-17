import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { parseFile } from 'music-metadata'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { applyAlbumTags, applyTags, downloadFpcalc, findFpcalc, identify } from './acoustid'
import type { AlbumFields } from './acoustid'
import { clearArt, fetchArt, getCachedArt, setArt } from './art'
import { downloadFfmpeg, findFfmpeg, measureLoudness, measureVibe, transcode } from './ffmpeg'
import { scanFolder, scanPaths } from './scanner'
import * as store from './store'
import type { Playlist, Settings, TagCandidate, Track } from '../shared/types'

// 'media' serves local audio files to the renderer with Range support (needed for seeking).
// 'radio' proxies arbitrary internet-radio streams and re-serves them same-origin with an
// ACAO header (Phase D), so the renderer's crossOrigin <audio> loads them without tainting →
// the Web Audio graph (VU/spectrum/scopes) keeps working on radio.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { supportFetchAPI: true, stream: true, bypassCSP: true } },
  { scheme: 'radio', privileges: { supportFetchAPI: true, stream: true, bypassCSP: true } }
])

// keep one predictable data folder in dev and production (dev otherwise uses "Electron")
app.setPath('userData', path.join(app.getPath('appData'), 'doobar3000'))

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#141417',
    titleBarStyle: 'hidden',
    // initial colors match the dark theme's top bar; the renderer re-tints this to
    // the active theme on load via the 'set-titlebar-overlay' IPC (see applyTheme)
    titleBarOverlay: { color: '#1a1a1f', symbolColor: '#9a9aa5', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.setMenuBarVisibility(false)

  // Security hardening: this app is a single fixed page. Deny any attempt to
  // open a new window or navigate away from it — all real outbound links go
  // through the allow-listed 'open-external' IPC. (Same-origin navigations are
  // permitted so the dev server's hot-reload still works.)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    const ownOrigin = process.env.ELECTRON_RENDERER_URL ?? 'file://'
    if (!url.startsWith(ownOrigin)) e.preventDefault()
  })

  if (process.env.DEBUG_LOG) {
    win.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg))
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Dev harness: SCREENSHOT_PATH=<file> captures the window and exits (used for visual checks)
  if (process.env.SCREENSHOT_PATH) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        // DEV_EVAL runs arbitrary renderer JS before capture (e.g. open a dialog)
        if (process.env.DEV_EVAL) {
          try {
            await win!.webContents.executeJavaScript(process.env.DEV_EVAL)
            await new Promise((r) => setTimeout(r, 1200))
          } catch (err) {
            console.error('[dev-eval]', err)
          }
        }
        const image = await win!.webContents.capturePage()
        await fs.writeFile(process.env.SCREENSHOT_PATH!, image.toPNG())
        app.quit()
      }, Number(process.env.SCREENSHOT_DELAY ?? 5000))
    })
  }
}

// ── Visualizer pop-out windows (Phase C) ────────────────────────────────────
// Frameless, always-on-top floating windows, each rendering one scope. They have
// no audio of their own — the main window ships analyser frames over IPC, which we
// broadcast here. The frame feed only runs while ≥1 pop-out is open.
const popouts = new Set<BrowserWindow>()

function createPopout(scope: string): void {
  const pop = new BrowserWindow({
    width: 480,
    height: 320,
    minWidth: 220,
    minHeight: 150,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0b0b0e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  pop.setMenuBarVisibility(false)
  pop.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  pop.webContents.on('will-navigate', (e, url) => {
    const ownOrigin = process.env.ELECTRON_RENDERER_URL ?? 'file://'
    if (!url.startsWith(ownOrigin)) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    pop.loadURL(`${process.env.ELECTRON_RENDERER_URL}#popout=${scope}`)
  } else {
    pop.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: `popout=${scope}` })
  }

  popouts.add(pop)
  if (popouts.size === 1) win?.webContents.send('viz-feed', true) // first pop-out → start feed
  pop.on('closed', () => {
    popouts.delete(pop)
    if (popouts.size === 0) win?.webContents.send('viz-feed', false) // last closed → stop feed
  })
}

function registerIpc(): void {
  ipcMain.handle('viz-popout-open', (_e, scope: string) => createPopout(scope))
  // Main window pushes a frame → fan out to every open pop-out.
  ipcMain.on('viz-frame', (_e, frame) => {
    for (const pop of popouts) pop.webContents.send('viz-frame', frame)
  })

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  // merge into existing library; new scan wins on duplicate paths but keeps
  // fields that are expensive to recreate (addedAt, loudness analysis)
  async function mergeIntoLibrary(found: Track[]): Promise<{ library: Track[]; added: string[] }> {
    const library = await store.getLibrary()
    const byPath = new Map(library.map((t) => [t.path, t]))
    for (const t of found) {
      const old = byPath.get(t.path)
      byPath.set(
        t.path,
        old
          ? {
              ...t,
              addedAt: old.addedAt,
              lufs: old.lufs ?? null,
              peakDb: old.peakDb ?? null,
              brightness: old.brightness ?? null,
              bpm: old.bpm ?? null
            }
          : t
      )
    }
    const merged = [...byPath.values()]
    await store.saveLibrary(merged)
    return { library: merged, added: found.map((t) => t.path) }
  }

  ipcMain.handle('scan-folder', async (_e, dir: string) => {
    const found = await scanFolder(dir, (p) => win?.webContents.send('scan-progress', p))
    return (await mergeIntoLibrary(found)).library
  })

  ipcMain.handle('import-paths', async (_e, paths: string[]) => {
    const found = await scanPaths(paths, (p) => win?.webContents.send('scan-progress', p))
    return mergeIntoLibrary(found)
  })

  ipcMain.handle('ffmpeg-status', () => findFfmpeg())
  ipcMain.handle('ffmpeg-download', () =>
    downloadFfmpeg((pct) => win?.webContents.send('ffmpeg-progress', pct))
  )
  ipcMain.handle('transcode', (_e, trackPath: string) => transcode(trackPath))

  // embedded art first (authoritative), then the on-disk fetch cache
  ipcMain.handle('get-art', async (_e, trackPath: string, albumKey: string) => {
    try {
      const meta = await parseFile(trackPath, { skipPostHeaders: true })
      const pic = meta.common.picture?.[0]
      if (pic) return `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`
    } catch {
      /* fall through to cache */
    }
    return getCachedArt(albumKey)
  })

  ipcMain.handle('fetch-art', (_e, albumArtist: string, album: string) =>
    fetchArt(albumArtist, album)
  )

  // manual override: let the user pick an image to use as an album's cover
  ipcMain.handle('set-art', async (_e, albumKey: string) => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose album art',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return setArt(albumKey, await fs.readFile(res.filePaths[0]))
  })

  ipcMain.handle('clear-art', (_e, albumKey: string) => clearArt(albumKey))

  ipcMain.handle('fpcalc-status', async () => (await findFpcalc()) !== null)
  ipcMain.handle('fpcalc-download', () => downloadFpcalc())
  ipcMain.handle('identify-track', (_e, trackPath: string, apiKey: string) =>
    identify(trackPath, apiKey)
  )

  // write tags to the file, then rescan it so the library reflects reality
  ipcMain.handle('apply-tags', async (_e, trackPath: string, tags: TagCandidate) => {
    if (!(await applyTags(trackPath, tags))) return null
    const found = await scanPaths([trackPath], () => {})
    return found.length ? (await mergeIntoLibrary(found)).library : null
  })

  // push album-level tags to several files at once, then rescan the ones written
  ipcMain.handle('apply-album-tags', async (_e, paths: string[], fields: AlbumFields) => {
    const written = await applyAlbumTags(paths, fields)
    if (!written.length) return null
    const found = await scanPaths(written, () => {})
    return found.length ? (await mergeIntoLibrary(found)).library : null
  })

  ipcMain.handle('remove-tracks', async (_e, paths: string[]) => {
    const gone = new Set(paths)
    const library = (await store.getLibrary()).filter((t) => !gone.has(t.path))
    await store.saveLibrary(library)
    return library
  })

  const LINK_ALLOWED = /^https:\/\/(open\.spotify\.com|music\.apple\.com|acoustid\.org)\//
  ipcMain.handle('open-external', (_e, url: string) => {
    if (LINK_ALLOWED.test(url)) void shell.openExternal(url)
  })

  // Open the OS file manager with the track selected/highlighted.
  ipcMain.handle('reveal-in-explorer', (_e, trackPath: string) => {
    shell.showItemInFolder(path.normalize(trackPath))
  })

  // File-system facts not stored in the library (size, existence) for the Get Info dialog.
  ipcMain.handle('file-stat', async (_e, trackPath: string) => {
    try {
      const st = await fs.stat(trackPath)
      return { exists: true, size: st.size, modified: st.mtimeMs }
    } catch {
      return { exists: false, size: 0, modified: 0 }
    }
  })

  // Background loudness analysis: walks every track missing LUFS, two at a time,
  // streaming results to the renderer and persisting periodically.
  let analyzing = false
  ipcMain.handle('analyze-loudness', async () => {
    if (analyzing || !(await findFfmpeg()).found) return
    analyzing = true
    try {
      const library = await store.getLibrary()
      const todo = library.filter((t) => t.lufs === null)
      let done = 0
      const queue = [...todo]
      const worker = async (): Promise<void> => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          const result = await measureLoudness(t.path)
          if (result) {
            t.lufs = result.lufs
            t.peakDb = result.peakDb
            win?.webContents.send('lufs-update', { path: t.path, ...result })
          }
          done++
          win?.webContents.send('lufs-progress', { done, total: todo.length })
          if (done % 10 === 0) await store.saveLibrary(library)
        }
      }
      await Promise.all([worker(), worker()])
      await store.saveLibrary(library)
    } finally {
      analyzing = false
    }
  })

  // Background vibe analysis (Phase 4.5): brightness (spectral centroid) + BPM
  // for every track still missing either, two at a time — same shape as the
  // loudness pass above. The energy axis reuses each track's existing LUFS.
  let vibing = false
  ipcMain.handle('analyze-vibe', async () => {
    if (vibing || !(await findFfmpeg()).found) return
    vibing = true
    try {
      const library = await store.getLibrary()
      const todo = library.filter((t) => t.brightness === null || t.bpm === null)
      let done = 0
      const queue = [...todo]
      const worker = async (): Promise<void> => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          const result = await measureVibe(t.path)
          if (result.brightness !== null) t.brightness = result.brightness
          if (result.bpm !== null) t.bpm = result.bpm
          if (result.brightness !== null || result.bpm !== null)
            win?.webContents.send('vibe-update', { path: t.path, ...result })
          done++
          win?.webContents.send('vibe-progress', { done, total: todo.length })
          if (done % 10 === 0) await store.saveLibrary(library)
        }
      }
      await Promise.all([worker(), worker()])
      await store.saveLibrary(library)
    } finally {
      vibing = false
    }
  })

  ipcMain.handle('get-library', () => store.getLibrary())
  ipcMain.handle('save-library', (_e, library: Track[]) => store.saveLibrary(library))
  ipcMain.handle('get-playlists', () => store.getPlaylists())
  ipcMain.handle('save-playlists', (_e, p: Playlist[]) => store.savePlaylists(p))
  ipcMain.handle('get-app-version', () => app.getVersion())
  ipcMain.handle('get-settings', () => store.getSettings())
  ipcMain.handle('save-settings', (_e, s: Settings) => store.saveSettings(s))
  ipcMain.handle('set-titlebar-overlay', (_e, o: { color: string; symbolColor: string }) => {
    win?.setTitleBarOverlay({ ...o, height: 40 })
  })
  ipcMain.handle('get-peaks', (_e, trackPath: string) => store.getPeaks(trackPath))
  ipcMain.handle('save-peaks', (_e, trackPath: string, peaks: number[]) =>
    store.savePeaks(trackPath, peaks)
  )
}

// ── Internet-radio stream proxy (Phase D) ───────────────────────────────────
// Opens an upstream radio URL with node's (lenient) http/https rather than fetch:
// some Shoutcast servers answer "ICY 200 OK" instead of "HTTP/1.1 200 OK", which
// undici/net.request reject. Follows a few redirects. We ask for ICY metadata
// (Icy-MetaData: 1) so we can surface the current song (Phase D2); the response's
// `icy-metaint` header drives the byte de-interleave below.
// NOTE: node's http parser still rejects the bare "ICY 200 OK" status line that
// some Shoutcast v1 servers use (no HTTP version). Those stations won't open —
// a documented limitation; the raw-socket shim (rewrite the status line) can be
// added later if real stations need it.
function openRadioStream(url: string, depth = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (depth > 4) return reject(new Error('too many redirects'))
    const mod = url.startsWith('https:') ? https : http
    const headers = { 'User-Agent': 'Doobar3000/1.0 (music player)', 'Icy-MetaData': '1' }
    const req = mod.get(url, { headers }, (res) => {
      const status = res.statusCode ?? 0
      const loc = res.headers.location
      if (status >= 300 && status < 400 && loc) {
        res.resume() // drain the redirect body
        openRadioStream(new URL(loc, url).toString(), depth + 1).then(resolve, reject)
      } else if (status >= 400) {
        res.resume()
        reject(new Error(`upstream ${status}`))
      } else {
        resolve(res)
      }
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('radio connect timeout')))
  })
}

// De-interleave an ICY stream: when a server honors `Icy-MetaData: 1`, it inserts
// a metadata block after every `metaint` bytes of audio — one length byte L, then
// L*16 bytes of (null-padded) metadata like `StreamTitle='Artist - Song';`.
// Chromium can't digest those bytes, so we strip them back out and forward only
// the audio, parsing StreamTitle and reporting it via `onTitle`. Stateful across
// chunks because a block can straddle a chunk boundary.
function icyDeinterleave(metaint: number, onTitle: (title: string) => void): Transform {
  let audioLeft = metaint // audio bytes until the next metadata block
  let metaLeft = 0 // metadata bytes still to read (0 = not currently in a block)
  let needLen = false // next byte is the metadata length indicator
  let metaParts: Buffer[] = []
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const audioOut: Buffer[] = []
      let i = 0
      while (i < chunk.length) {
        if (needLen) {
          metaLeft = chunk[i] * 16
          needLen = false
          i++
          if (metaLeft === 0) audioLeft = metaint // no metadata this round
          else metaParts = []
        } else if (metaLeft > 0) {
          const take = Math.min(metaLeft, chunk.length - i)
          metaParts.push(chunk.subarray(i, i + take))
          metaLeft -= take
          i += take
          if (metaLeft === 0) {
            const meta = Buffer.concat(metaParts).toString('utf8')
            const m = /StreamTitle='(.*?)';/.exec(meta)
            if (m) onTitle(m[1].trim())
            audioLeft = metaint
          }
        } else {
          const take = Math.min(audioLeft, chunk.length - i)
          audioOut.push(chunk.subarray(i, i + take))
          audioLeft -= take
          i += take
          if (audioLeft === 0) needLen = true
        }
      }
      cb(null, audioOut.length ? Buffer.concat(audioOut) : undefined)
    }
  })
}

app.whenReady().then(async () => {
  const MIME: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav'
  }

  // Serves local audio with byte-range support. Ranges are mandatory: m4a/mp4
  // files keep their index (moov atom) at the end, and Chromium will not play
  // them without seeking. ACAO is required too: without it, Web Audio taps on a
  // cross-origin media element output silence.
  protocol.handle('media', async (request) => {
    const filePath = decodeURIComponent(request.url.slice('media://'.length))
    if (process.env.DEBUG_LOG) {
      console.log('[media]', request.method, request.url.slice(0, 120), 'range:', request.headers.get('range'))
    }
    // Defense in depth: only ever serve recognised audio files. The renderer is
    // trusted, but this keeps the protocol from being a general arbitrary-file
    // read primitive if untrusted content ever ran in the renderer.
    if (!(path.extname(filePath).toLowerCase() in MIME)) {
      return new Response('unsupported media type', { status: 415 })
    }
    let size: number
    try {
      size = (await fs.stat(filePath)).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '')
    if (range) {
      const start = Number(range[1])
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size) return new Response(null, { status: 416 })
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      headers['Content-Length'] = String(end - start + 1)
      const stream = Readable.toWeb(createReadStream(filePath, { start, end }))
      return new Response(stream as ReadableStream, { status: 206, headers })
    }
    headers['Content-Length'] = String(size)
    const stream = Readable.toWeb(createReadStream(filePath))
    return new Response(stream as ReadableStream, { status: 200, headers })
  })

  // Proxy an internet-radio stream and re-serve it same-origin with ACAO so the
  // renderer's crossOrigin <audio> can feed it into the Web Audio graph (Phase D).
  // The upstream URL is the percent-encoded tail of the radio:// URL. When the
  // server interleaves ICY metadata, strip it out and push StreamTitle to the
  // renderer (Phase D2). Only the most-recent connection's titles matter, so the
  // renderer clears its title on each new station / pause.
  protocol.handle('radio', async (request) => {
    const upstream = decodeURIComponent(request.url.slice('radio://'.length))
    if (!/^https?:\/\//.test(upstream)) return new Response('bad radio url', { status: 400 })
    if (process.env.DEBUG_LOG) console.log('[radio]', upstream.slice(0, 120))
    try {
      const res = await openRadioStream(upstream)
      const metaint = Number(res.headers['icy-metaint'])
      let body: Readable = res
      if (Number.isFinite(metaint) && metaint > 0) {
        let last = ''
        const de = icyDeinterleave(metaint, (title) => {
          if (title === last) return // servers re-send the same block; only emit changes
          last = title
          win?.webContents.send('radio-title', title)
        })
        res.on('error', (e) => de.destroy(e)) // upstream drop → tear the transform down too
        body = res.pipe(de)
      }
      // If the consumer (Chromium) cancels — el.src changed, window closed — tear
      // down the upstream socket so we don't leak a connection per station switch.
      body.on('close', () => res.destroy())
      return new Response(Readable.toWeb(body) as ReadableStream, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': res.headers['content-type'] ?? 'audio/mpeg',
          'Cache-Control': 'no-store'
        }
      })
    } catch (e) {
      if (process.env.DEBUG_LOG) console.error('[radio] error', e)
      return new Response('radio stream error', { status: 502 })
    }
  })

  registerIpc()

  // Dev harness: exercises the decoder-pack download path without UI clicks
  if (process.env.DEV_FFMPEG_DOWNLOAD) {
    let last = -10
    const ok = await downloadFfmpeg((pct) => {
      if (pct >= last + 10) {
        last = pct
        console.log(`[ffmpeg-download] ${pct}%`)
      }
    })
    console.log('[ffmpeg-download] result:', ok)
  }

  // Dev harness: exercises the fingerprinter (fpcalc) download
  if (process.env.DEV_FPCALC_DOWNLOAD) {
    console.log('[fpcalc-download] result:', await downloadFpcalc())
    console.log('[fpcalc-status]', await findFpcalc())
  }

  // Dev harness: SCAN_DIR seeds the library on launch so automated runs have
  // content. Merges (keeps existing entries) so it never clobbers a real library.
  if (process.env.SCAN_DIR) {
    const tracks: Track[] = await scanFolder(process.env.SCAN_DIR, () => {})
    const library = await store.getLibrary()
    const byPath = new Map(library.map((t) => [t.path, t]))
    for (const t of tracks) if (!byPath.has(t.path)) byPath.set(t.path, t)
    await store.saveLibrary([...byPath.values()])
  }

  createWindow()
})

app.on('window-all-closed', () => app.quit())
