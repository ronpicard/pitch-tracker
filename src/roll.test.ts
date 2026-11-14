import { describe, expect, it } from 'vitest'
import {
  accuracy,
  AUTO_SPAN,
  centsOff,
  findPreset,
  followRange,
  midiToY,
  parseLineWidth,
  parseOctaves,
  RANGE_PRESETS,
  resizeRange,
  scoreWindow,
  trim,
  yToMidi,
  type Sample,
} from './roll'

describe('roll geometry', () => {
  const range = { low: 60, high: 71 }

  it('maps lanes top to bottom and back', () => {
    expect(midiToY(60, range, 240)).toBeCloseTo(230)
    expect(midiToY(71, range, 240)).toBeCloseTo(10)
    for (const m of [59.5, 60, 65.3, 71.5]) expect(yToMidi(midiToY(m, range, 240), range, 240)).toBeCloseTo(m)
  })

  it('has valid presets and a default', () => {
    expect(findPreset('tenor').range).toEqual({ low: 48, high: 72 })
    expect(findPreset('nope').id).toBe('auto')
    for (const p of RANGE_PRESETS) if (p.range) expect(p.range.high).toBeGreaterThan(p.range.low)
  })
})

describe('view settings', () => {
  it('shows three octaves by default', () => {
    expect(AUTO_SPAN).toBe(36)
    expect(parseOctaves(null)).toBe(3)
    expect(parseOctaves('4')).toBe(4)
    expect(parseOctaves('1.5')).toBe(1.5)
    expect(parseOctaves('7')).toBe(3)
  })

  it('defaults to a thin line and ignores unknown widths', () => {
    expect(parseLineWidth(null)).toBe('thin')
    expect(parseLineWidth('thick')).toBe('thick')
    expect(parseLineWidth('toString')).toBe('thin')
  })

  it('resizes a range around its middle without leaving the piano', () => {
    expect(resizeRange({ low: 54, high: 72 }, 36)).toEqual({ low: 45, high: 81 })
    expect(resizeRange({ low: 45, high: 81 }, 18)).toEqual({ low: 54, high: 72 })
    expect(resizeRange({ low: 12, high: 30 }, 48)).toEqual({ low: 12, high: 60 })
    expect(resizeRange({ low: 90, high: 108 }, 48)).toEqual({ low: 60, high: 108 })
  })
})

describe('followRange', () => {
  const start = { low: 50, high: 50 + AUTO_SPAN }

  it('holds still while the pitch stays inside', () => {
    expect(followRange(start, 58)).toEqual(start)
    expect(followRange(start, null)).toEqual(start)
  })

  it('moves when the pitch nears an edge', () => {
    expect(followRange(start, 51).low).toBeLessThan(50)
    expect(followRange(start, 70).high).toBeGreaterThan(68)
    const r = followRange(start, 80)
    expect(r.high - r.low).toBe(AUTO_SPAN)
    expect(80).toBeLessThanOrEqual(r.high - 3)
  })

  it('stays inside the MIDI range', () => {
    expect(followRange(start, 5).low).toBe(12)
    expect(followRange(start, 127).high).toBe(108)
  })
})

describe('scoring', () => {
  it('grades cents', () => {
    expect(accuracy(4)).toBe('good')
    expect(accuracy(-20)).toBe('ok')
    expect(accuracy(40)).toBe('off')
  })

  it('measures cents from the nearest note or a target', () => {
    expect(centsOff(60.2, null)).toBeCloseTo(20)
    expect(centsOff(59.9, null)).toBeCloseTo(-10)
    expect(centsOff(61, 60)).toBeCloseTo(100)
  })

  it('scores only voiced samples in the window', () => {
    const samples: Sample[] = [
      { t: 0, midi: 70 },
      { t: 1, midi: 60.05 },
      { t: 2, midi: null },
      { t: 3, midi: 60.3 },
      { t: 4, midi: 59.98 },
    ]
    const stats = scoreWindow(samples, 1, null)
    expect(stats.onPitch).toBeCloseTo(2 / 3)
    expect(stats.meanCents).toBeCloseTo((5 + 30 + 2) / 3)
    expect(scoreWindow(samples, 10, null)).toEqual({ onPitch: null, meanCents: null })
    expect(scoreWindow(samples, 0, 70).onPitch).toBeCloseTo(1 / 4)
  })

  it('trims old samples', () => {
    const samples: Sample[] = [0, 1, 2, 3].map((t) => ({ t, midi: 60 }))
    trim(samples, 3, 1.5)
    expect(samples.map((s) => s.t)).toEqual([2, 3])
  })
})
