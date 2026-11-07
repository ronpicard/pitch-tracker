import { describe, expect, it } from 'vitest'
import { detectPitch, median, rms } from './pitch'

const RATE = 48000

function synth(frequency: number, size = 4096, shape: (phase: number) => number = Math.sin, amp = 0.5): Float32Array {
  const out = new Float32Array(size)
  for (let i = 0; i < size; i++) out[i] = amp * shape((2 * Math.PI * frequency * i) / RATE)
  return out
}

// A bright, guitar-like tone: strong harmonics, weaker fundamental.
const plucked = (phase: number) =>
  0.5 * Math.sin(phase) + 0.8 * Math.sin(2 * phase) + 0.4 * Math.sin(3 * phase) + 0.3 * Math.sin(4 * phase)

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

describe('detectPitch', () => {
  it.each([41.2, 82.41, 110, 196, 261.63, 440, 987.77, 1760])('finds a %f Hz sine within 1 cent', (f) => {
    const result = detectPitch(synth(f), RATE)!
    expect(result).not.toBeNull()
    expect(Math.abs(cents(result.frequency, f))).toBeLessThan(1)
    expect(result.clarity).toBeGreaterThan(0.95)
  })

  it.each([82.41, 146.83, 329.63])('finds the fundamental of a harmonic-rich %f Hz tone', (f) => {
    const result = detectPitch(synth(f, 4096, plucked), RATE)!
    expect(Math.abs(cents(result.frequency, f))).toBeLessThan(2)
  })

  it('handles sawtooth waves', () => {
    const saw = (phase: number) => ((phase / Math.PI) % 2) - 1
    const result = detectPitch(synth(220, 4096, saw), RATE)!
    expect(Math.abs(cents(result.frequency, 220))).toBeLessThan(3)
  })

  // With auto gain off, a guitar a metre from a laptop or phone mic often
  // arrives at only a few thousandths RMS; that is still a note.
  it.each([0.01, 0.005, 0.003])('hears a quiet %f-amplitude plucked tone', (amp) => {
    const result = detectPitch(synth(110, 4096, plucked, amp), RATE)!
    expect(result).not.toBeNull()
    expect(Math.abs(cents(result.frequency, 110))).toBeLessThan(2)
  })

  it('ignores silence and noise', () => {
    expect(detectPitch(new Float32Array(4096), RATE)).toBeNull()
    expect(detectPitch(synth(440, 4096, Math.sin, 0.0005), RATE)).toBeNull()
    let seed = 7
    const noise = (amp: number) =>
      new Float32Array(4096).map(() => {
        seed = (seed * 16807) % 2147483647
        return amp * (seed / 2147483647 - 0.5)
      })
    expect(detectPitch(noise(1), RATE)).toBeNull()
    expect(detectPitch(noise(0.02), RATE)).toBeNull()
  })

  it('respects the frequency range', () => {
    expect(detectPitch(synth(60), RATE, { minFrequency: 80 })).toBeNull()
    expect(detectPitch(synth(1500), RATE, { maxFrequency: 1000 })?.frequency ?? 0).toBeLessThanOrEqual(1000)
    expect(detectPitch(synth(440), 0)).toBeNull()
  })
})

describe('helpers', () => {
  it('computes RMS', () => {
    expect(rms([])).toBe(0)
    expect(rms([1, -1, 1, -1])).toBe(1)
  })

  it('takes medians', () => {
    expect(median([])).toBeNaN()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})
