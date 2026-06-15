import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import type { ScanProgress, Track } from '../shared/types'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav'])

async function collectAudioFiles(dir: string, files: string[]): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectAudioFiles(full, files)
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full)
    }
  }
}

export async function scanFolder(
  dir: string,
  onProgress: (p: ScanProgress) => void
): Promise<Track[]> {
  return scanPaths([dir], onProgress)
}

// Accepts any mix of files and folders (e.g. an Explorer drag-drop payload)
export async function scanPaths(
  paths: string[],
  onProgress: (p: ScanProgress) => void
): Promise<Track[]> {
  const files: string[] = []
  for (const p of paths) {
    try {
      if ((await fs.stat(p)).isDirectory()) {
        await collectAudioFiles(p, files)
      } else if (AUDIO_EXTENSIONS.has(path.extname(p).toLowerCase())) {
        files.push(p)
      }
    } catch {
      // vanished or unreadable path: ignore
    }
  }
  const tracks: Track[] = []
  let done = 0
  for (const file of files) {
    try {
      const meta = await parseFile(file, { duration: true })
      const c = meta.common
      tracks.push({
        path: file,
        title: c.title || path.basename(file, path.extname(file)),
        artist: c.artist || c.albumartist || 'Unknown Artist',
        album: c.album || 'Unknown Album',
        albumArtist: c.albumartist || c.artist || 'Unknown Artist',
        genre: c.genre?.[0] || '',
        year: c.year ?? null,
        trackNo: c.track?.no ?? null,
        duration: meta.format.duration ?? 0,
        addedAt: Date.now(),
        bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null,
        sampleRate: meta.format.sampleRate ?? null,
        codec: meta.format.codec ?? null,
        fileType: path.extname(file).slice(1).toLowerCase() || null,
        lufs: null,
        peakDb: null,
        brightness: null,
        bpm: null
      })
    } catch {
      // unreadable/corrupt file: skip it rather than abort the whole scan
    }
    done++
    if (done % 5 === 0 || done === files.length) onProgress({ done, total: files.length })
  }
  return tracks
}
