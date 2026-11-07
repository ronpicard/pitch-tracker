import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clampA4, frequencyToMidi, midiToFrequency, noteFromMidi, readNote } from './audio/notes'
import { ToneVoice } from './audio/tone'
import { isEmbedded, useMicPitch, type MicStatus, type PitchFrame } from './audio/useMicPitch'
import { Roll } from './components/Roll'
import { accuracy, AUTO_SPAN, centsOff, findPreset, followRange, RANGE_PRESETS, scoreWindow, trim, type Range, type Sample } from './roll'
import { load, save } from './storage'

const WINDOWS = [5, 10, 20]
const KEEP_SECONDS = 60
const SCORE_SECONDS = 10

export function App() {
  const [presetId, setPresetId] = useState(() => findPreset(load('pt.range')).id)
  const [windowSeconds, setWindowSeconds] = useState(() => (WINDOWS.includes(Number(load('pt.window'))) ? Number(load('pt.window')) : 10))
  const [a4, setA4] = useState(() => clampA4(Number(load('pt.a4') ?? 440)))
  const [target, setTarget] = useState<number | null>(null)
  const [drone, setDrone] = useState(false)
  const [paused, setPaused] = useState(false)
  const [autoRange, setAutoRange] = useState<Range>({ low: 52, high: 52 + AUTO_SPAN })

  const samples = useRef<Sample[]>([])
  const clock = useRef({ origin: performance.now(), pausedAt: null as number | null })
  const voice = useMemo(() => new ToneVoice(), [])
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const a4Ref = useRef(a4)
  a4Ref.current = a4

  const now = useCallback(() => {
    const c = clock.current
    return ((c.pausedAt ?? performance.now()) - c.origin) / 1000
  }, [])

  const onFrame = useCallback(
    (frame: PitchFrame) => {
      if (pausedRef.current) return
      const t = (frame.time - clock.current.origin) / 1000
      const midi = frame.frequency ? frequencyToMidi(frame.frequency, a4Ref.current) : null
      samples.current.push({ t, midi })
      trim(samples.current, t, KEEP_SECONDS)
      setAutoRange((r) => {
        const next = followRange(r, midi)
        return next.low === r.low ? r : next
      })
    },
    [],
  )

  const mic = useMicPitch({ fftSize: 2048, minFrequency: 55, maxFrequency: 1600, smoothing: 3, onFrame })

  useEffect(() => save('pt.range', presetId), [presetId])
  useEffect(() => save('pt.window', String(windowSeconds)), [windowSeconds])
  useEffect(() => save('pt.a4', String(a4)), [a4])
  useEffect(() => () => voice.stop(), [voice])

  // The drone holds the target note while it is on.
  useEffect(() => {
    if (drone && target !== null) {
      voice.setVolume(0.35)
      void voice.start(midiToFrequency(target, a4))
    } else {
      voice.stop()
    }
  }, [drone, target, a4, voice])

  const preset = findPreset(presetId)
  const range = preset.range ?? autoRange

  const pick = (midi: number) => {
    if (midi === target) {
      setTarget(null)
      return
    }
    setTarget(midi)
    if (!drone) {
      voice.setVolume(0.5)
      void voice.pluck(midiToFrequency(midi, a4), 1.2)
    }
  }

  const togglePause = () => {
    const c = clock.current
    if (paused) {
      // Shift the origin so the roll resumes where it stopped, with a gap.
      if (c.pausedAt !== null) c.origin += performance.now() - c.pausedAt
      c.pausedAt = null
    } else {
      c.pausedAt = performance.now()
    }
    setPaused(!paused)
  }

  const clear = () => {
    samples.current.length = 0
  }

  const frame = mic.frame
  const reading = frame.frequency ? readNote(frame.frequency, a4) : null
  const cents = reading ? centsOff(frequencyToMidi(reading.measured, a4), target) : null
  const stats = scoreWindow(samples.current, now() - SCORE_SECONDS, target)
  const listening = mic.status === 'listening'
  const targetNote = target !== null ? noteFromMidi(target, a4) : null

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          <span className="brand__mark" aria-hidden="true">〽</span> Pitch Tracker
        </h1>
        <div className={`readout ${cents !== null ? `readout--${accuracy(cents)}` : ''}`}>
          <span className="readout__note">
            {reading ? (
              <>
                {reading.name}
                <sub>{reading.octave}</sub>
              </>
            ) : (
              '–'
            )}
          </span>
          <span className="readout__detail">
            <span>{reading ? `${reading.measured.toFixed(1)} Hz` : '— Hz'}</span>
            <span>
              {cents !== null ? `${cents > 0 ? '+' : ''}${Math.round(cents)} ¢` : '—'}
              {targetNote ? ` vs ${targetNote.label}` : ''}
            </span>
          </span>
        </div>
      </header>

      <main>
        <div className="stage">
          <Roll samples={samples} now={now} range={range} windowSeconds={windowSeconds} target={target} a4={a4} onPick={pick} />
          {!listening ? (
            <div className="stage__overlay">
              <MicGate status={mic.status} onStart={() => void mic.start()} />
            </div>
          ) : null}
          {paused ? <div className="stage__badge">Paused</div> : null}
        </div>

        <div className="bar">
          <div className="score" title={`Share of the last ${SCORE_SECONDS} seconds within 10 cents of ${targetNote ? targetNote.label : 'the nearest note'}`}>
            <strong>{stats.onPitch === null ? '—' : `${Math.round(stats.onPitch * 100)}%`}</strong>
            <span>on pitch</span>
          </div>
          <div className="score">
            <strong>{stats.meanCents === null ? '—' : `±${Math.round(stats.meanCents)}`}</strong>
            <span>avg cents</span>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={togglePause} disabled={!listening} aria-pressed={paused}>
              {paused ? '▶ Resume' : '❚❚ Pause'}
            </button>
            <button type="button" className="btn" onClick={clear}>
              Clear
            </button>
            {listening ? (
              <button type="button" className="btn btn--quiet" onClick={mic.stop}>
                Stop mic
              </button>
            ) : null}
          </div>
        </div>

        <section className="panel" aria-label="Settings">
          <div className="field">
            <span>Target note</span>
            <div className="target">
              <button type="button" className="round" onClick={() => setTarget((t) => (t === null ? 57 : Math.max(24, t - 1)))} aria-label="Target down a semitone">
                −
              </button>
              <output>{targetNote ? `${targetNote.label} · ${targetNote.frequency.toFixed(1)} Hz` : 'None (nearest note)'}</output>
              <button type="button" className="round" onClick={() => setTarget((t) => (t === null ? 57 : Math.min(96, t + 1)))} aria-label="Target up a semitone">
                +
              </button>
              {target !== null ? (
                <button type="button" className="chip" onClick={() => setTarget(null)}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <div className="field">
            <span>Reference</span>
            <div className="row">
              <button type="button" className="chip" disabled={target === null} onClick={() => target !== null && voice.pluck(midiToFrequency(target, a4), 1.2)}>
                ▶ Play target
              </button>
              <label className="toggle">
                <input type="checkbox" checked={drone} onChange={(e) => setDrone(e.target.checked)} disabled={target === null} />
                <span>Drone (hold the note; use headphones)</span>
              </label>
            </div>
          </div>
          <label className="field">
            <span>Range</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {RANGE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Time shown</span>
            <div className="row" role="radiogroup" aria-label="Time shown">
              {WINDOWS.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={windowSeconds === s} className={`chip ${windowSeconds === s ? 'chip--on' : ''}`} onClick={() => setWindowSeconds(s)}>
                  {s}s
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Reference pitch</span>
            <select value={a4} onChange={(e) => setA4(clampA4(Number(e.target.value)))}>
              {[415, 432, 440, 442].map((v) => (
                <option key={v} value={v}>
                  A4 = {v} Hz
                </option>
              ))}
            </select>
          </label>
        </section>
      </main>

      <footer className="footer">
        Tap any lane in the roll to hear that note and aim for it. Green is within 10 cents, yellow within 25. Audio stays on your device.{' '}
        <a href="https://github.com/ronpicard/pitch-tracker" target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </footer>
    </div>
  )
}

function MicGate({ status, onStart }: { status: MicStatus; onStart: () => void }) {
  if (status === 'denied' && isEmbedded()) {
    return (
      <div className="gate">
        <p>The microphone is blocked inside this embedded preview.</p>
        <a className="primary" href={window.location.href} target="_blank" rel="noopener noreferrer">
          Open Pitch Tracker in its own tab
        </a>
      </div>
    )
  }
  return (
    <div className="gate">
      <button type="button" className="primary" onClick={onStart} disabled={status === 'starting'}>
        {status === 'starting' ? 'Starting…' : '🎤 Start singing'}
      </button>
      {status === 'denied' ? <p>Microphone access was denied. Allow it in your browser’s site settings and try again.</p> : null}
      {status === 'unsupported' ? <p>No microphone was found, or this browser can’t record audio.</p> : null}
      {status === 'error' ? <p>The microphone couldn’t start. Try again.</p> : null}
      {status === 'idle' ? <p>Sing, hum, or play one note at a time.</p> : null}
    </div>
  )
}
