import { describe, expect, it } from 'vitest'
import { aWeight, fft, MelodyAnalyzer, MelodyTracker } from './melody'

const RATE = 48000
const SIZE = 4096
const HOP = 960 // 20 ms

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

/** Sum of harmonics with per-harmonic amplitudes, frequency may vary per sample. */
function tone(out: Float32Array, freqAt: (t: number) => number, amps: number[], gain: number, phase0 = 0) {
  let phase = phase0
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * freqAt(i / RATE)) / RATE
    let v = 0
    for (let h = 0; h < amps.length; h++) v += amps[h]! * Math.sin((h + 1) * phase)
    out[i]! += gain * v
  }
}

// A sung vowel: strong low harmonics with a formant bump around 2-3 kHz.
const VOICE = [1, 0.8, 0.6, 0.5, 0.35, 0.25, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06]
// Bass guitar: loud fundamental and second harmonic.
const BASS = [1, 0.7, 0.35, 0.2, 0.1]
// Electric piano / pad.
const KEYS = [1, 0.4, 0.2, 0.1]

/** A short melody with vibrato: one note per 400 ms. */
const MELODY = [57, 60, 62, 64, 62, 60, 67, 65, 64, 60] // A3..G4
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const sungAt = (t: number) => hz(MELODY[Math.min(MELODY.length - 1, Math.floor(t / 0.4))]!) * 2 ** ((0.3 * Math.sin(2 * Math.PI * 5.5 * t)) / 12)

function track(left: Float32Array, right: Float32Array | undefined, expected: (t: number) => number | null) {
  const analyzer = new MelodyAnalyzer(SIZE, RATE)
  const tracker = new MelodyTracker()
  let hits = 0
  let frames = 0
  for (let end = SIZE; end <= left.length; end += HOP) {
    const frame = analyzer.analyze(left.subarray(end - SIZE, end), right?.subarray(end - SIZE, end))
    const found = tracker.step(frame)
    const t = (end - SIZE / 2) / RATE
    const want = expected(t)
    if (want === null || t < 0.2) continue
    frames++
    // Within half a semitone of what was sung at the window centre counts.
    if (found !== null && Math.abs(cents(found, want)) < 50) hits++
  }
  return hits / frames
}

describe('fft', () => {
  it('puts a sine in the right bin', () => {
    const re = new Float64Array(1024).map((_, i) => Math.sin((2 * Math.PI * 37 * i) / 1024))
    const im = new Float64Array(1024)
    fft(re, im)
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]!)).slice(0, 512)
    expect(mags.indexOf(Math.max(...mags))).toBe(37)
    expect(mags[37]).toBeCloseTo(512, 6)
  })

  it('rejects sizes that are not powers of two', () => {
    expect(() => fft(new Float64Array(100), new Float64Array(100))).toThrow()
    expect(() => new MelodyAnalyzer(1000, RATE)).toThrow()
  })
})

describe('aWeight', () => {
  it('is about unity at 1 kHz and cuts the bass', () => {
    expect(20 * Math.log10(aWeight(1000))).toBeCloseTo(0, 0)
    expect(20 * Math.log10(aWeight(100))).toBeLessThan(-18)
  })
})

describe('MelodyAnalyzer + MelodyTracker', () => {
  it('follows a solo voice within a few cents', () => {
    const left = new Float32Array(RATE * 0.6)
    tone(left, () => 220, VOICE, 0.1)
    const analyzer = new MelodyAnalyzer(SIZE, RATE)
    const best = analyzer.analyze(left.subarray(left.length - SIZE)).candidates[0]!
    expect(Math.abs(cents(best.frequency, 220))).toBeLessThan(5)
  })

  it('finds the singer over bass and chords', () => {
    const seconds = MELODY.length * 0.4
    const mix = new Float32Array(RATE * seconds)
    tone(mix, sungAt, VOICE, 0.08)
    // Bass alternates A1 / F1 and is louder than the voice.
    tone(mix, (t) => hz(Math.floor(t / 0.8) % 2 ? 29 : 33), BASS, 0.14)
    // Sustained chord: C4 E4 G4 under the melody.
    for (const m of [48, 52, 55]) tone(mix, () => hz(m), KEYS, 0.03, m)
    expect(track(mix, undefined, sungAt)).toBeGreaterThan(0.85)
  })

  it('uses the stereo centre to ignore a hard-panned instrument', () => {
    const seconds = MELODY.length * 0.4
    const left = new Float32Array(RATE * seconds)
    const right = new Float32Array(RATE * seconds)
    tone(left, sungAt, VOICE, 0.06)
    tone(right, sungAt, VOICE, 0.06)
    // A lead guitar line on the left only, louder than the singer.
    const guitarAt = (t: number) => hz([69, 71, 72, 74][Math.floor(t / 0.6) % 4]!)
    tone(left, guitarAt, VOICE, 0.12, 1)
    expect(track(left, right, sungAt)).toBeGreaterThan(0.85)
  })

  it('reports silence between phrases', () => {
    const left = new Float32Array(RATE * 1)
    const analyzer = new MelodyAnalyzer(SIZE, RATE)
    const tracker = new MelodyTracker()
    const frame = analyzer.analyze(left.subarray(0, SIZE))
    expect(frame.candidates).toEqual([])
    expect(tracker.step(frame)).toBeNull()
  })
})
