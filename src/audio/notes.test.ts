import { describe, expect, it } from 'vitest'
import { centsBetween, clampA4, frequencyToMidi, isBlackKey, midiToFrequency, noteFromMidi, parseNote, readNote } from './notes'

describe('note math', () => {
  it('maps A4 and its neighbours to the standard frequencies', () => {
    expect(midiToFrequency(69)).toBe(440)
    expect(midiToFrequency(60)).toBeCloseTo(261.626, 3)
    expect(midiToFrequency(40)).toBeCloseTo(82.407, 3)
    expect(midiToFrequency(69, 432)).toBe(432)
  })

  it('round-trips frequency and MIDI', () => {
    for (const midi of [21, 40, 60, 69, 108]) expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 9)
    expect(frequencyToMidi(0)).toBeNaN()
    expect(frequencyToMidi(-5)).toBeNaN()
  })

  it('labels notes with octave numbers', () => {
    expect(noteFromMidi(60).label).toBe('C4')
    expect(noteFromMidi(61).label).toBe('C♯4')
    expect(noteFromMidi(59).label).toBe('B3')
    expect(noteFromMidi(21).label).toBe('A0')
  })

  it('reads the nearest note and cents offset', () => {
    const sharp = readNote(445)!
    expect(sharp.label).toBe('A4')
    expect(sharp.cents).toBeCloseTo(19.56, 1)
    const flat = readNote(midiToFrequency(64) * 2 ** (-30 / 1200))!
    expect(flat.label).toBe('E4')
    expect(flat.cents).toBeCloseTo(-30, 6)
    expect(readNote(0)).toBeNull()
  })

  it('honours a custom A4', () => {
    expect(readNote(432, 432)!.cents).toBeCloseTo(0, 9)
    expect(readNote(432)!.cents).toBeCloseTo(-31.77, 1)
  })

  it('measures cents between frequencies', () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 9)
    expect(centsBetween(440, 440)).toBe(0)
  })

  it('clamps the reference pitch', () => {
    expect(clampA4(500)).toBe(480)
    expect(clampA4(300)).toBe(400)
    expect(clampA4(Number.NaN)).toBe(440)
  })

  it('parses note names', () => {
    expect(parseNote('A4')).toBe(69)
    expect(parseNote('c#3')).toBe(49)
    expect(parseNote('B♭2')).toBe(46)
    expect(parseNote('Eb5')).toBe(75)
    expect(parseNote('H2')).toBeNull()
    expect(parseNote('G#9')).toBeNull()
  })

  it('knows the black keys', () => {
    expect([60, 61, 62, 63, 64, 65, 66].map(isBlackKey)).toEqual([false, true, false, true, false, false, true])
  })
})
