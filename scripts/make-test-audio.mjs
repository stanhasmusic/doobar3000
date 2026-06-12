// Generates small tagged WAV files in ./test-music for development testing.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const RATE = 44100

function infoChunk(tags) {
  const sub = []
  for (const [id, value] of Object.entries(tags)) {
    const v = Buffer.from(value + '\0', 'ascii')
    const padded = v.length % 2 ? Buffer.concat([v, Buffer.from([0])]) : v
    const head = Buffer.alloc(8)
    head.write(id, 0, 'ascii')
    head.writeUInt32LE(v.length, 4)
    sub.push(head, padded)
  }
  const body = Buffer.concat([Buffer.from('INFO', 'ascii'), ...sub])
  const head = Buffer.alloc(8)
  head.write('LIST', 0, 'ascii')
  head.writeUInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

function makeWav(file, seconds, freqs, tags) {
  const n = Math.floor(RATE * seconds)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    let s = 0
    for (const f of freqs) s += Math.sin(2 * Math.PI * f * t)
    // slow tremolo so the waveform display has visible shape
    const env = 0.25 + 0.55 * Math.abs(Math.sin((2 * Math.PI * t) / seconds))
    data.writeInt16LE(Math.round((s / freqs.length) * env * 32767 * 0.8), i * 2)
  }
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8) // PCM
  fmt.writeUInt16LE(1, 10) // mono
  fmt.writeUInt32LE(RATE, 12)
  fmt.writeUInt32LE(RATE * 2, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)
  const dataHead = Buffer.alloc(8)
  dataHead.write('data', 0, 'ascii')
  dataHead.writeUInt32LE(data.length, 4)
  const info = infoChunk(tags)
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), fmt, dataHead, data, info])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(body.length, 4)
  writeFileSync(file, Buffer.concat([riff, body]))
}

const dir = path.resolve('test-music')
mkdirSync(dir, { recursive: true })

const tracks = [
  ['Neon Sunrise', 'The Oscillators', 'Sine City', 'Synthwave', '1', 12, [220, 330]],
  ['Square One', 'The Oscillators', 'Sine City', 'Synthwave', '2', 9, [277, 415]],
  ['Phase Shift', 'The Oscillators', 'Sine City', 'Synthwave', '3', 14, [330, 494]],
  ['Low End Theory', 'Bass Cadets', 'Subsonic', 'Electronic', '1', 11, [110, 165]],
  ['Rumble Strip', 'Bass Cadets', 'Subsonic', 'Electronic', '2', 8, [138, 92]],
  ['Glass Bells', 'Aria Vox', 'Crystalline', 'Ambient', '1', 13, [523, 784, 1047]]
]

for (const [title, artist, album, genre, trk, secs, freqs] of tracks) {
  const file = path.join(dir, `${artist} - ${title}.wav`)
  makeWav(file, secs, freqs, { INAM: title, IART: artist, IPRD: album, IGNR: genre, ITRK: trk })
  console.log('wrote', file)
}
