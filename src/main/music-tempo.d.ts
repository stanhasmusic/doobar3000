declare module 'music-tempo' {
  /** Beat-tracking / tempo estimation over an array of PCM samples. */
  export default class MusicTempo {
    constructor(audioData: number[], params?: Record<string, number>)
    /** Estimated tempo in beats per minute. */
    tempo: number
    /** Detected beat times, in seconds. */
    beats: number[]
  }
}
