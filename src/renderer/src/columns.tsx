import type { ReactNode } from 'react'
import type { ColumnKey, LevelMode, Track } from '../../shared/types'
import { formatDb, formatTime } from './store'

export interface ColumnDef {
  label: string
  /** CSS grid track size */
  width: string
  /** extra class on header + cell (alignment / colour) */
  className: string
  sortable: boolean
}

// Registry of every column the track list can show, in the order they appear
// in the "add column" picker. `columns` in settings is a subset/reordering of these.
export const COLUMN_DEFS: Record<ColumnKey, ColumnDef> = {
  trackNo: { label: '#', width: '44px', className: 'col-no', sortable: true },
  title: { label: 'Title', width: 'minmax(160px, 2fr)', className: 'col-title', sortable: true },
  artist: { label: 'Artist', width: 'minmax(110px, 1.3fr)', className: '', sortable: true },
  albumArtist: {
    label: 'Album Artist',
    width: 'minmax(110px, 1.3fr)',
    className: '',
    sortable: true
  },
  album: { label: 'Album', width: 'minmax(110px, 1.3fr)', className: '', sortable: true },
  genre: { label: 'Genre', width: 'minmax(70px, 0.8fr)', className: '', sortable: true },
  year: { label: 'Year', width: '52px', className: 'col-num', sortable: true },
  duration: { label: 'Time', width: '60px', className: 'col-num', sortable: true },
  bitrate: { label: 'Bitrate', width: '78px', className: 'col-num', sortable: true },
  sampleRate: { label: 'Sample Rate', width: '92px', className: 'col-num', sortable: true },
  codec: { label: 'Codec', width: '70px', className: '', sortable: true },
  fileType: { label: 'Type', width: '54px', className: '', sortable: true },
  level: { label: 'Level', width: '74px', className: 'col-num', sortable: false }
}

export const ALL_COLUMNS = Object.keys(COLUMN_DEFS) as ColumnKey[]

export function cellValue(
  key: ColumnKey,
  t: Track,
  isCurrent: boolean,
  levelMode: LevelMode,
  levelDb: number | undefined
): ReactNode {
  switch (key) {
    case 'trackNo':
      return isCurrent ? '♪' : (t.trackNo ?? '')
    case 'duration':
      return formatTime(t.duration)
    case 'year':
      return t.year ?? ''
    case 'bitrate':
      return t.bitrate ? `${t.bitrate} kbps` : ''
    case 'sampleRate':
      return t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)} kHz` : ''
    case 'codec':
      return t.codec ?? ''
    case 'fileType':
      return t.fileType ? t.fileType.toUpperCase() : ''
    case 'level':
      if (levelMode === 'off') return '—'
      return levelDb === undefined ? '…' : formatDb(levelDb)
    default:
      return t[key] as string
  }
}
