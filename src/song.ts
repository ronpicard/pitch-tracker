// Song mode: the singer's pitch line, a clock that follows a YouTube video,
// and scoring your voice against the singer. DOM-free so it can be tested.

import type { Accuracy, Sample } from './roll'

/** Time resolution of a learned melody, in seconds. */
export const STEP = 0.02

/**
 * The singer's pitch line on a timeline (video seconds, or seconds since a
 * live session started). Each 20 ms slot is unknown (never heard), silent,
 * or a fractional MIDI note, so a song can be learned in any order, by
 * seeking, and over several plays.
 */
export class MelodyTrack {
  private slots = new Map<number, number>()

  get size(): number {
    return this.slots.size
  }

  /** Seconds of the timeline that have been heard. */
  get covered(): number {
    return this.slots.size * STEP
  }

  set(t: number, midi: number | null): void {
    if (!(t >= 0)) return
    this.slots.set(Math.round(t / STEP), midi === null || !Number.isFinite(midi) ? Number.NaN : midi)
  }

  /** MIDI at time t; null when silent or never heard. */
  at(t: number): number | null {
    const v = this.slots.get(Math.round(t / STEP))
    return v === undefined || Number.isNaN(v) ? null : v
  }

  has(t: number): boolean {
    return this.slots.has(Math.round(t / STEP))
  }

  between(from: number, to: number): Sample[] {
    const out: Sample[] = []
    for (let i = Math.ceil(Math.max(0, from) / STEP); i * STEP <= to; i++) {
      const v = this.slots.get(i)
      if (v !== undefined) out.push({ t: i * STEP, midi: Number.isNaN(v) ? null : v })
    }
    return out
  }

  trimBefore(t: number): void {
    const cut = Math.round(t / STEP)
    for (const key of this.slots.keys()) if (key < cut) this.slots.delete(key)
  }

  clear(): void {
    this.slots.clear()
  }

  /** Compact text form for localStorage: hundredths of a semitone, "" for silence. */
  serialize(): string {
    const keys = [...this.slots.keys()].sort((a, b) => a - b)
    const first = keys[0] ?? 0
    const last = keys[keys.length - 1] ?? -1
    const cells: string[] = []
    for (let i = first; i <= last; i++) {
      const v = this.slots.get(i)
      cells.push(v === undefined ? '-' : Number.isNaN(v) ? '' : String(Math.round(v * 100)))
    }
    return JSON.stringify({ v: 1, step: STEP, first, cells: cells.join(',') })
  }

  /** Inverse of serialize(); returns an empty track for anything malformed. */
  static parse(text: string | null): MelodyTrack {
    const track = new MelodyTrack()
    if (!text) return track
    try {
      const data: unknown = JSON.parse(text)
      if (!data || typeof data !== 'object') return track
      const { v, step, first, cells } = data as Record<string, unknown>
      if (v !== 1 || step !== STEP || !Number.isInteger(first) || typeof cells !== 'string') return track
      cells.split(',').forEach((cell, i) => {
        if (cell === '-') return
        const midi = cell === '' ? Number.NaN : Number(cell) / 100
        if (cell !== '' && !(midi > 0 && midi < 128)) return
        track.slots.set((first as number) + i, midi)
      })
    } catch {
      // Corrupt storage: start over rather than fail.
    }
    return track
  }
}

/**
 * Cents from the singer to you. With `anyOctave`, a man singing a woman's
 * line an octave down (or the reverse) counts as on pitch.
 */
export function centsFromSinger(you: number, singer: number, anyOctave: boolean): number {
  let diff = (you - singer) * 100
  if (anyOctave) diff = ((((diff + 600) % 1200) + 1200) % 1200) - 600
  return diff
}

/**
 * Octaves to shift your pitch by so it is drawn on the singer's line. Sticky:
 * the shift only changes when it would leave you more than a fifth from the
 * singer, so a note change you reach a moment late doesn't flip the octave.
 */
export function octaveShift(you: number, singer: number | null, current: number): number {
  if (singer === null || Math.abs(singer - you - 12 * current) <= 7) return current
  return Math.round((singer - you) / 12)
}

/** Karaoke grading: within 25 cents is green, within a half step (the right note) amber. */
export function singAlongAccuracy(cents: number): Accuracy {
  const off = Math.abs(cents)
  return off <= 25 ? 'good' : off <= 50 ? 'ok' : 'off'
}

export type SongStats = {
  /** Share of the time the singer was singing that you were on their note (±50 cents). */
  onPitch: number | null
  meanCents: number | null
}

export function scoreAgainst(samples: readonly Sample[], from: number, singerAt: (t: number) => number | null, anyOctave: boolean): SongStats {
  let voiced = 0
  let good = 0
  let total = 0
  for (const s of samples) {
    if (s.t < from || s.midi === null) continue
    const singer = singerAt(s.t)
    if (singer === null) continue
    const off = Math.abs(centsFromSinger(s.midi, singer, anyOctave))
    voiced++
    total += off
    if (off <= 50) good++
  }
  return voiced ? { onPitch: good / voiced, meanCents: total / voiced } : { onPitch: null, meanCents: null }
}

/**
 * Smooth playback time from a player that reports its position only every
 * few hundred milliseconds. Between reports the clock runs on its own; a
 * report far from the prediction (a seek) snaps it, a small drift is eased out.
 */
export class VideoClock {
  private base = 0
  private at = 0
  private rate = 1
  private playing = false

  /** Feed a reported position. `wallMs` is performance.now(). */
  report(position: number, playing: boolean, wallMs: number, rate = 1): void {
    if (!Number.isFinite(position)) return
    const predicted = this.time(wallMs)
    const drift = position - predicted
    this.rate = rate > 0 ? rate : 1
    if (!playing || !this.playing || Math.abs(drift) > 0.3) {
      this.base = position
    } else {
      this.base = predicted + drift * 0.25
    }
    this.at = wallMs
    this.playing = playing
  }

  time(wallMs: number): number {
    return this.playing ? this.base + ((wallMs - this.at) / 1000) * this.rate : this.base
  }

  get isPlaying(): boolean {
    return this.playing
  }
}

/**
 * The 11-character video id from anything a person is likely to paste:
 * watch, share, Shorts, embed, Music, or live links, or a bare id.
 */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim()
  const ID = /^[A-Za-z0-9_-]{11}$/
  if (ID.test(text)) return text
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = url.pathname.split('/')
    if (first === 'watch') id = url.searchParams.get('v')
    else if (first === 'shorts' || first === 'embed' || first === 'live' || first === 'v') id = second ?? null
  }
  return id && ID.test(id) ? id : null
}
