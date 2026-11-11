import { describe, expect, it } from 'vitest'
import { centsFromSinger, MelodyTrack, octaveShift, parseYouTubeId, scoreAgainst, singAlongAccuracy, STEP, VideoClock } from './song'

describe('MelodyTrack', () => {
  it('stores notes and silence per 20 ms slot', () => {
    const track = new MelodyTrack()
    track.set(1.0, 60.25)
    track.set(1.02, null)
    expect(track.at(1.001)).toBe(60.25)
    expect(track.at(1.02)).toBeNull()
    expect(track.has(1.02)).toBe(true)
    expect(track.has(1.04)).toBe(false)
    expect(track.covered).toBeCloseTo(2 * STEP)
    track.set(-1, 60)
    track.set(2, Number.NaN)
    expect(track.at(2)).toBeNull()
  })

  it('lists heard slots in a time range', () => {
    const track = new MelodyTrack()
    for (let t = 0; t < 1; t += STEP) track.set(t, t < 0.5 ? 62 : null)
    const list = track.between(0.2, 0.6)
    expect(list[0]!.t).toBeCloseTo(0.2)
    expect(list.at(-1)!.t).toBeCloseTo(0.6)
    expect(list.filter((s) => s.midi === 62).length).toBe(15)
    track.trimBefore(0.5)
    expect(track.at(0.4)).toBeNull()
    expect(track.has(0.4)).toBe(false)
  })

  it('round-trips through storage text and survives garbage', () => {
    const track = new MelodyTrack()
    track.set(3, 64.37)
    track.set(3.02, null)
    track.set(3.1, 57)
    const copy = MelodyTrack.parse(track.serialize())
    expect(copy.at(3)).toBeCloseTo(64.37, 2)
    expect(copy.has(3.02)).toBe(true)
    expect(copy.at(3.02)).toBeNull()
    expect(copy.has(3.04)).toBe(false)
    expect(copy.at(3.1)).toBe(57)
    expect(copy.size).toBe(3)
    for (const bad of [null, '', '{', '[]', '{"v":2}', '{"v":1,"step":0.02,"first":0,"cells":"abc,9999999"}']) {
      expect(MelodyTrack.parse(bad).size).toBe(0)
    }
  })
})

describe('singing against the singer', () => {
  it('measures cents, optionally ignoring the octave', () => {
    expect(centsFromSinger(60.2, 60, false)).toBeCloseTo(20)
    expect(centsFromSinger(48.1, 60, false)).toBeCloseTo(-1190)
    expect(centsFromSinger(48.1, 60, true)).toBeCloseTo(10)
    expect(centsFromSinger(71.9, 60, true)).toBeCloseTo(-10)
    expect(centsFromSinger(66, 60, true)).toBeCloseTo(-600)
  })

  it('moves your line into the singer’s octave, and keeps it there', () => {
    expect(octaveShift(48, 60, 0)).toBe(1)
    expect(octaveShift(50, 55, 1)).toBe(1) // still on the last note as the singer moves on: no flip
    expect(octaveShift(55, 60, 1)).toBe(1)
    expect(octaveShift(36, 60, 1)).toBe(2)
    expect(octaveShift(72, 60, 0)).toBe(-1)
    expect(octaveShift(60, null, 1)).toBe(1)
  })

  it('grades karaoke-style', () => {
    expect(singAlongAccuracy(20)).toBe('good')
    expect(singAlongAccuracy(-45)).toBe('ok')
    expect(singAlongAccuracy(80)).toBe('off')
  })

  it('scores only where the singer is singing', () => {
    const singer = (t: number) => (t < 1 ? 60 : null)
    const you = [
      { t: 0.1, midi: 60.1 },
      { t: 0.2, midi: 61 },
      { t: 0.3, midi: null },
      { t: 1.5, midi: 70 },
    ]
    const stats = scoreAgainst(you, 0, singer, false)
    expect(stats.onPitch).toBe(0.5)
    expect(stats.meanCents).toBeCloseTo(55)
    expect(scoreAgainst(you, 2, singer, false).onPitch).toBeNull()
  })
})

describe('VideoClock', () => {
  it('runs between coarse reports and snaps on seeks', () => {
    const clock = new VideoClock()
    clock.report(10, true, 0)
    expect(clock.time(500)).toBeCloseTo(10.5)
    clock.report(10.52, true, 500) // small drift is eased
    expect(clock.time(500)).toBeCloseTo(10.505)
    clock.report(42, true, 600) // seek
    expect(clock.time(600)).toBe(42)
    clock.report(42.4, false, 1000) // paused
    expect(clock.time(5000)).toBe(42.4)
    expect(clock.isPlaying).toBe(false)
  })

  it('honours the playback rate', () => {
    const clock = new VideoClock()
    clock.report(0, true, 0, 0.5)
    expect(clock.time(1000)).toBeCloseTo(0.5)
  })
})

describe('parseYouTubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=x', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', 'dQw4w9WgXcQ'],
    ['  dQw4w9WgXcQ ', 'dQw4w9WgXcQ'],
  ])('reads %s', (input, id) => {
    expect(parseYouTubeId(input)).toBe(id)
  })

  it.each(['', 'hello', 'https://vimeo.com/123456789', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://youtube.com/watch?v=short', 'https://youtube.com/channel/dQw4w9WgXcQ'])(
    'rejects %s',
    (input) => {
      expect(parseYouTubeId(input)).toBeNull()
    },
  )
})
