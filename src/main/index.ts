import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { scanFolder } from './scanner'
import * as store from './store'
import type { Playlist, Settings, Track } from '../shared/types'

// 'media' serves local audio files to the renderer with Range support (needed for seeking)
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { supportFetchAPI: true, stream: true, bypassCSP: true } }
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
    titleBarOverlay: { color: '#141417', symbolColor: '#b8b8c0', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.setMenuBarVisibility(false)

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
        const image = await win!.webContents.capturePage()
        await fs.writeFile(process.env.SCREENSHOT_PATH!, image.toPNG())
        app.quit()
      }, 5000)
    })
  }
}

function registerIpc(): void {
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('scan-folder', async (_e, dir: string) => {
    const found = await scanFolder(dir, (p) => win?.webContents.send('scan-progress', p))
    // merge into existing library, new scan wins on duplicate paths
    const library = await store.getLibrary()
    const byPath = new Map(library.map((t) => [t.path, t]))
    for (const t of found) {
      const existing = byPath.get(t.path)
      byPath.set(t.path, existing ? { ...t, addedAt: existing.addedAt } : t)
    }
    const merged = [...byPath.values()]
    await store.saveLibrary(merged)
    return merged
  })

  ipcMain.handle('get-library', () => store.getLibrary())
  ipcMain.handle('get-playlists', () => store.getPlaylists())
  ipcMain.handle('save-playlists', (_e, p: Playlist[]) => store.savePlaylists(p))
  ipcMain.handle('get-settings', () => store.getSettings())
  ipcMain.handle('save-settings', (_e, s: Settings) => store.saveSettings(s))
  ipcMain.handle('get-peaks', (_e, trackPath: string) => store.getPeaks(trackPath))
  ipcMain.handle('save-peaks', (_e, trackPath: string, peaks: number[]) =>
    store.savePeaks(trackPath, peaks)
  )
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

  registerIpc()

  // Dev harness: SCAN_DIR seeds the library on launch so automated runs have content
  if (process.env.SCAN_DIR) {
    const tracks: Track[] = await scanFolder(process.env.SCAN_DIR, () => {})
    await store.saveLibrary(tracks)
  }

  createWindow()
})

app.on('window-all-closed', () => app.quit())
