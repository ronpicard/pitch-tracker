// Equal-temperament note math. MIDI 69 is A4; the reference pitch for A4 is
// adjustable (432, 440, 442 Hz and so on), so every function takes it.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const

export const DEFAULT_A4 = 440
export const MIN_A4 = 400
export const MAX_A4 = 480

export type Note = {
  midi: number
  /** Pitch class name with sharps, e.g. "C♯". */
  name: string
  octave: number
  /** Name plus octave, e.g. "C♯4". */
  label: string
  frequency: number
}

export type NoteReading = Note & {
  /** Distance from `frequency` to the measured pitch, -50..+50. */
  cents: number
  measured: number
}

export function clampA4(a4: number): number {
  if (!Number.isFinite(a4)) return DEFAULT_A4
  return Math.min(MAX_A4, Math.max(MIN_A4, a4))
}

export function midiToFrequency(midi: number, a4 = DEFAULT_A4): number {
  return a4 * 2 ** ((midi - 69) / 12)
}

/** Fractional MIDI number for a frequency; NaN for non-positive input. */
export function frequencyToMidi(frequency: number, a4 = DEFAULT_A4): number {
  if (!(frequency > 0)) return Number.NaN
  return 69 + 12 * Math.log2(frequency / a4)
}

export function noteFromMidi(midi: number, a4 = DEFAULT_A4): Note {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  const name = NOTE_NAMES[pc]!
  return { midi, name, octave, label: `${name}${octave}`, frequency: midiToFrequency(midi, a4) }
}

/** Nearest equal-tempered note to a measured frequency, with the cents offset. */
export function readNote(frequency: number, a4 = DEFAULT_A4): NoteReading | null {
  const exact = frequencyToMidi(frequency, a4)
  if (!Number.isFinite(exact)) return null
  const midi = Math.round(exact)
  return { ...noteFromMidi(midi, a4), cents: (exact - midi) * 100, measured: frequency }
}

/** Cents from `reference` to `frequency` (positive when sharp). */
export function centsBetween(frequency: number, reference: number): number {
  return 1200 * Math.log2(frequency / reference)
}

/** Parse "A4", "C#3", "Bb2", "e♭5" into a MIDI number, or null. */
export function parseNote(text: string): number | null {
  const match = /^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(-?\d)\s*$/.exec(text)
  if (!match) return null
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]!.toUpperCase() as 'C']
  const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === 'b' || match[2] === '♭' ? -1 : 0
  const midi = (Number(match[3]) + 1) * 12 + base + accidental
  return midi >= 0 && midi <= 127 ? midi : null
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)
}
