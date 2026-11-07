// Pure geometry and scoring for the piano-roll view, kept free of the DOM so
// it can be unit tested.

export type Sample = {
  /** Seconds since tracking started. */
  t: number
  /** Fractional MIDI note, or null for silence. */
  midi: number | null
}

export type Range = { low: number; high: number }

export type RangePreset = { id: string; name: string; range: Range | null }

export const RANGE_PRESETS: readonly RangePreset[] = [
  { id: 'auto', name: 'Follow my voice', range: null },
  { id: 'bass', name: 'Bass · E2–E4', range: { low: 40, high: 64 } },
  { id: 'baritone', name: 'Baritone · G2–G4', range: { low: 43, high: 67 } },
  { id: 'tenor', name: 'Tenor · C3–C5', range: { low: 48, high: 72 } },
  { id: 'alto', name: 'Alto · F3–F5', range: { low: 53, high: 77 } },
  { id: 'soprano', name: 'Soprano · C4–C6', range: { low: 60, high: 84 } },
  { id: 'wide', name: 'Wide · C2–C6', range: { low: 36, high: 84 } },
]

/** Semitones visible when following the voice. */
export const AUTO_SPAN = 18

export function findPreset(id: string | null): RangePreset {
  return RANGE_PRESETS.find((p) => p.id === id) ?? RANGE_PRESETS[0]!
}

/** Lane centres sit on whole MIDI numbers; half a lane of padding at each edge. */
export function midiToY(midi: number, range: Range, height: number): number {
  const lanes = range.high - range.low + 1
  return height - ((midi - range.low + 0.5) / lanes) * height
}

export function yToMidi(y: number, range: Range, height: number): number {
  const lanes = range.high - range.low + 1
  return range.low - 0.5 + ((height - y) / height) * lanes
}

/**
 * Ease the auto-follow window toward the recent pitch so the roll recentres
 * when you leave it, but doesn't jitter while you hold a note.
 */
export function followRange(current: Range, midi: number | null, span = AUTO_SPAN): Range {
  if (midi === null) return current
  const margin = 3
  let low = current.low
  if (midi < current.low + margin) low = Math.floor(midi - margin)
  else if (midi > current.high - margin) low = Math.ceil(midi + margin) - span
  low = Math.max(12, Math.min(108 - span, low))
  return { low, high: low + span }
}

export type Accuracy = 'good' | 'ok' | 'off'

export function accuracy(cents: number): Accuracy {
  const off = Math.abs(cents)
  return off <= 10 ? 'good' : off <= 25 ? 'ok' : 'off'
}

/** Cents from the nearest semitone, or from `target` when one is set. */
export function centsOff(midi: number, target: number | null): number {
  return (midi - (target ?? Math.round(midi))) * 100
}

export type Stats = {
  /** Share of voiced time within ±10 cents, 0..1, or null with no voice. */
  onPitch: number | null
  /** Average absolute cents off over voiced samples. */
  meanCents: number | null
}

export function scoreWindow(samples: readonly Sample[], from: number, target: number | null): Stats {
  let voiced = 0
  let good = 0
  let total = 0
  for (const s of samples) {
    if (s.t < from || s.midi === null) continue
    const off = Math.abs(centsOff(s.midi, target))
    voiced++
    total += off
    if (off <= 10) good++
  }
  return voiced ? { onPitch: good / voiced, meanCents: total / voiced } : { onPitch: null, meanCents: null }
}

/** Drop samples older than `keepSeconds` before `now`, in place. */
export function trim(samples: Sample[], now: number, keepSeconds: number): void {
  let cut = 0
  while (cut < samples.length && samples[cut]!.t < now - keepSeconds) cut++
  if (cut) samples.splice(0, cut)
}
