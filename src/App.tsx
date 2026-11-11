import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clampA4, frequencyToMidi, midiToFrequency, noteFromMidi, readNote } from './audio/notes'
import { ToneVoice } from './audio/tone'
import { isEmbedded, useMicPitch, type MicStatus, type PitchFrame } from './audio/useMicPitch'
import { canCaptureTabAudio, useSongPitch, type SongSource, type SongStatus } from './audio/useSongPitch'
import { Roll } from './components/Roll'
import { SuiteNav } from './components/SuiteNav'
import { accuracy, AUTO_SPAN, centsOff, findPreset, followRange, RANGE_PRESETS, scoreWindow, trim, type Range, type Sample } from './roll'
import { centsFromSinger, MelodyTrack, octaveShift, parseYouTubeId, scoreAgainst, singAlongAccuracy } from './song'
import { load, save } from './storage'
import { useYouTube } from './youtube'

const WINDOWS = [5, 10, 20]
const KEEP_SECONDS = 60
const SCORE_SECONDS = 10
/** Seconds of the singer's upcoming notes shown ahead of now when a video is loaded. */
const LEAD_SECONDS = 3

type Mode = 'voice' | 'song'

const songKey = (id: string) => `pt.song.${id}`

export function App() {
  const [presetId, setPresetId] = useState(() => findPreset(load('pt.range')).id)
  const [windowSeconds, setWindowSeconds] = useState(() => (WINDOWS.includes(Number(load('pt.window'))) ? Number(load('pt.window')) : 10))
  const [a4, setA4] = useState(() => clampA4(Number(load('pt.a4') ?? 440)))
  const [target, setTarget] = useState<number | null>(null)
  const [drone, setDrone] = useState(false)
  const [paused, setPaused] = useState(false)
  const [autoRange, setAutoRange] = useState<Range>({ low: 52, high: 52 + AUTO_SPAN })
  const [mode, setMode] = useState<Mode>(() => (load('pt.mode') === 'song' ? 'song' : 'voice'))
  const [videoId, setVideoId] = useState<string | null>(() => parseYouTubeId(load('pt.video') ?? ''))
  const [link, setLink] = useState(() => (videoId ? `https://youtu.be/${videoId}` : ''))
  const [linkError, setLinkError] = useState<string | null>(null)
  const [anyOctave, setAnyOctave] = useState(() => load('pt.octave') !== '0')
  const [learned, setLearned] = useState(0)

  const samples = useRef<Sample[]>([])
  // The singer's line: per video (saved), or a rolling live line with no video.
  const track = useRef(new MelodyTrack())
  const playerHost = useRef<HTMLDivElement>(null)
  const video = useYouTube(playerHost, mode === 'song' ? videoId : null)
  const onVideo = mode === 'song' && video.status === 'ready'
  const onVideoRef = useRef(onVideo)
  onVideoRef.current = onVideo
  const modeRef = useRef(mode)
  modeRef.current = mode
  // A video is chosen but its player isn't ready: there is no timeline to record on yet.
  const waitingForVideoRef = useRef(false)
  waitingForVideoRef.current = mode === 'song' && videoId !== null && !onVideo
  const clock = useRef({ origin: performance.now(), pausedAt: null as number | null })
  const voice = useMemo(() => new ToneVoice(), [])
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const a4Ref = useRef(a4)
  a4Ref.current = a4
  const anyOctaveRef = useRef(anyOctave)
  anyOctaveRef.current = anyOctave
  /** Octaves your line is shifted by to sit on the singer's (song mode, any octave). */
  const shift = useRef(0)

  const videoClock = video.clock
  /** Timeline position for a performance.now() reading: video time with a video, else the session clock. */
  const timeAt = useCallback(
    (wallMs: number) => {
      if (onVideoRef.current) return videoClock.current.time(wallMs)
      const c = clock.current
      return ((c.pausedAt ?? wallMs) - c.origin) / 1000
    },
    [videoClock],
  )
  const now = useCallback(() => timeAt(performance.now()), [timeAt])

  const follow = useCallback((midi: number | null) => {
    setAutoRange((r) => {
      const next = followRange(r, midi)
      return next.low === r.low ? r : next
    })
  }, [])

  const onFrame = useCallback(
    (frame: PitchFrame) => {
      if (pausedRef.current) return
      if (onVideoRef.current && !videoClock.current.isPlaying) return
      const t = timeAt(frame.time)
      const list = samples.current
      // Seeking back in the video restarts your line.
      if (list.length && t < list[list.length - 1]!.t - 0.05) list.length = 0
      let midi = frame.frequency ? frequencyToMidi(frame.frequency, a4Ref.current) : null
      if (midi !== null && modeRef.current === 'song' && anyOctaveRef.current) {
        // Draw your line in the singer's octave so a part sung an octave away stays on screen.
        shift.current = octaveShift(midi, track.current.at(t), shift.current)
        midi += 12 * shift.current
      } else {
        shift.current = 0
      }
      list.push({ t, midi })
      trim(list, t, KEEP_SECONDS)
      if (modeRef.current === 'voice' || !onVideoRef.current) follow(midi)
    },
    [timeAt, follow, videoClock],
  )

  const mic = useMicPitch({ fftSize: 2048, minFrequency: 55, maxFrequency: 1600, smoothing: 3, onFrame })

  const lastSave = useRef(0)
  const onSongFrame = useCallback(
    (frame: PitchFrame) => {
      if (pausedRef.current || waitingForVideoRef.current) return
      const midi = frame.frequency ? frequencyToMidi(frame.frequency, a4Ref.current) : null
      if (onVideoRef.current) {
        if (!videoClock.current.isPlaying) return
        track.current.set(timeAt(frame.time), midi)
      } else {
        const t = timeAt(frame.time)
        track.current.set(t, midi)
        track.current.trimBefore(t - KEEP_SECONDS)
        follow(midi)
      }
      if (frame.time - lastSave.current > 2000) {
        lastSave.current = frame.time
        setLearned(track.current.covered)
      }
    },
    [timeAt, follow, videoClock],
  )
  const song = useSongPitch({ onFrame: onSongFrame })

  useEffect(() => save('pt.range', presetId), [presetId])
  useEffect(() => save('pt.window', String(windowSeconds)), [windowSeconds])
  useEffect(() => save('pt.a4', String(a4)), [a4])
  useEffect(() => save('pt.mode', mode), [mode])
  useEffect(() => save('pt.octave', anyOctave ? '1' : '0'), [anyOctave])

  // A new mode or video starts a fresh timeline: unpause and drop your old line.
  // Each video keeps its own learned melody; with no video the singer's line is live only.
  useEffect(() => {
    const c = clock.current
    if (c.pausedAt !== null) c.origin += performance.now() - c.pausedAt
    c.pausedAt = null
    setPaused(false)
    samples.current.length = 0
    if (mode !== 'song') return
    track.current = videoId ? MelodyTrack.parse(load(songKey(videoId))) : new MelodyTrack()
    setLearned(track.current.covered)
  }, [mode, videoId])

  // Save what has been learned as it grows, and when leaving the video.
  useEffect(() => {
    if (!videoId || mode !== 'song') return
    const current = track.current
    const store = () => {
      if (current.size) save(songKey(videoId), current.serialize())
    }
    const timer = window.setInterval(store, 5000)
    return () => {
      window.clearInterval(timer)
      store()
    }
  }, [videoId, mode])

  // Keep the roll on the singer's coming notes while a video plays.
  useEffect(() => {
    if (!onVideo) return
    const timer = window.setInterval(() => {
      const t = now()
      let midi: number | null = null
      // Look a little back too, so the roll follows a song while it is being learned.
      for (let dt = -0.3; dt <= 1 && midi === null; dt += 0.1) midi = track.current.at(t + dt)
      follow(midi)
    }, 100)
    return () => window.clearInterval(timer)
  }, [onVideo, now, follow])

  // Leaving song mode stops listening to the song.
  useEffect(() => {
    if (mode === 'voice') song.stop()
  }, [mode, song.stop])
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
    if (mode === 'song') {
      voice.setVolume(0.5)
      void voice.pluck(midiToFrequency(midi, a4), 1.2)
      return
    }
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
    if (mode === 'song' && !videoId) track.current.clear()
  }

  const loadLink = (e: React.FormEvent) => {
    e.preventDefault()
    if (!link.trim()) {
      setVideoId(null)
      save('pt.video', '')
      setLinkError(null)
      return
    }
    const id = parseYouTubeId(link)
    if (!id) {
      setLinkError('That doesn’t look like a YouTube link. Paste the address of a video, e.g. https://youtu.be/…')
      return
    }
    song.stop()
    setLinkError(null)
    setVideoId(id)
    save('pt.video', id)
  }

  const removeVideo = () => {
    song.stop()
    setVideoId(null)
    setLink('')
    save('pt.video', '')
  }

  const forgetMelody = () => {
    if (!videoId) return
    track.current.clear()
    save(songKey(videoId), '')
    setLearned(0)
  }

  const singerAt = useCallback((t: number) => track.current.at(t), [])
  const reference = useCallback((from: number, to: number) => track.current.between(from, to), [])
  const gradeVsSinger = useCallback(
    (s: Sample & { midi: number }) => {
      const singer = track.current.at(s.t)
      return singer === null ? 'ok' : singAlongAccuracy(centsFromSinger(s.midi, singer, anyOctave))
    },
    [anyOctave],
  )

  const frame = mic.frame
  const reading = frame.frequency ? readNote(frame.frequency, a4) : null
  const singerNow = mode === 'song' ? track.current.at(now()) : null
  const userMidi = reading ? frequencyToMidi(reading.measured, a4) : null
  const cents =
    userMidi === null ? null : mode === 'song' ? (singerNow === null ? null : centsFromSinger(userMidi, singerNow, anyOctave)) : centsOff(userMidi, target)
  const grade = cents === null ? null : mode === 'song' ? singAlongAccuracy(cents) : accuracy(cents)
  const stats = mode === 'song' ? scoreAgainst(samples.current, now() - SCORE_SECONDS, singerAt, anyOctave) : scoreWindow(samples.current, now() - SCORE_SECONDS, target)
  const listening = mic.status === 'listening'
  const songListening = song.status === 'listening'
  const targetNote = target !== null ? noteFromMidi(target, a4) : null
  const singerNote = singerNow !== null ? noteFromMidi(Math.round(singerNow), a4) : null
  const songFrame = song.frame
  const singerLive = songFrame.frequency ? readNote(songFrame.frequency, a4) : null
  const micBusyWithSong = songListening && song.source === 'mic'
  const showGate = mode === 'voice' ? !listening : !listening && !songListening && !onVideo

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          <span className="brand__mark" aria-hidden="true">〽</span> Pitch Tracker
        </h1>
        <SuiteNav current="pitch-tracker" />
        <div className={`readout ${grade ? `readout--${grade}` : ''}`}>
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
              {mode === 'song' ? (singerNote ? ` vs singer ${singerNote.label}` : '') : targetNote ? ` vs ${targetNote.label}` : ''}
            </span>
          </span>
        </div>
      </header>

      <div className="modes" role="tablist" aria-label="Mode">
        <button type="button" role="tab" aria-selected={mode === 'voice'} className={`modes__item ${mode === 'voice' ? 'modes__item--on' : ''}`} onClick={() => setMode('voice')}>
          🎤 My voice
        </button>
        <button type="button" role="tab" aria-selected={mode === 'song'} className={`modes__item ${mode === 'song' ? 'modes__item--on' : ''}`} onClick={() => setMode('song')}>
          🎵 Sing along
        </button>
      </div>

      <main className={`layout ${mode === 'song' ? 'layout--song' : ''}`}>
        {mode === 'song' ? (
          <section className="video" aria-label="Song">
            <form className="video__form" onSubmit={loadLink}>
              <label className="visually-hidden" htmlFor="yt-link">
                YouTube link
              </label>
              <input id="yt-link" type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="Paste a YouTube link" value={link} onChange={(e) => setLink(e.target.value)} />
              <button type="submit" className="btn">
                Load
              </button>
            </form>
            {linkError ? <p className="video__note video__note--error">{linkError}</p> : null}
            <div className={`video__frame ${videoId ? '' : 'video__frame--empty'}`}>
              <div ref={playerHost} className="video__player" />
              {!videoId ? <p>No video. Paste a link above, or listen to a song playing anywhere with the buttons below.</p> : null}
            </div>
            {video.error ? <p className="video__note video__note--error">{video.error}</p> : null}
            {videoId ? (
              <p className="video__note">
                {learned > 0 ? `Singer’s notes learned for ${formatTime(learned)} of this video.` : 'The singer’s notes haven’t been learned yet. Listen to the song once to learn them.'}{' '}
                {learned > 0 ? (
                  <button type="button" className="linkish" onClick={forgetMelody}>
                    Forget
                  </button>
                ) : null}
                <button type="button" className="linkish" onClick={removeVideo}>
                  Remove video
                </button>
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="stage">
          <Roll
            samples={samples}
            now={now}
            range={range}
            windowSeconds={windowSeconds}
            target={mode === 'song' ? null : target}
            a4={a4}
            onPick={pick}
            reference={mode === 'song' ? reference : undefined}
            lead={onVideo ? LEAD_SECONDS : 0}
            grade={mode === 'song' ? gradeVsSinger : undefined}
          />
          {showGate ? (
            <div className="stage__overlay">
              {mode === 'voice' ? (
                <MicGate status={mic.status} onStart={() => void mic.start()} />
              ) : (
                <div className="gate">
                  <p>Load a YouTube video, or listen to a song playing anywhere, to see the singer’s notes. Then sing along and compare.</p>
                </div>
              )}
            </div>
          ) : null}
          {mode === 'song' && !showGate ? (
            <div className="legend" aria-hidden="true">
              <span className="legend__singer">Singer</span>
              <span className="legend__you">You</span>
            </div>
          ) : null}
          {paused ? <div className="stage__badge">Paused</div> : null}
        </div>

        <aside className="side">
        <div className="bar">
          <div className={`score ${stats.onPitch === null ? '' : `score--${stats.onPitch >= 0.6 ? 'good' : stats.onPitch >= 0.3 ? 'ok' : 'off'}`}`} title={
              mode === 'song'
                ? `Share of the last ${SCORE_SECONDS} seconds of the singer singing that you were within a half step of their note`
                : `Share of the last ${SCORE_SECONDS} seconds within 10 cents of ${targetNote ? targetNote.label : 'the nearest note'}`
            }>
            <strong>{stats.onPitch === null ? '—' : `${Math.round(stats.onPitch * 100)}%`}</strong>
            <span>on pitch</span>
          </div>
          <div className="score">
            <strong>{stats.meanCents === null ? '—' : `±${Math.round(stats.meanCents)}`}</strong>
            <span>avg cents</span>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={togglePause} disabled={(!listening && !songListening) || onVideo} aria-pressed={paused}>
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

        {mode === 'song' ? (
          <SongControls
            hasVideo={onVideo}
            playing={video.playing}
            song={song}
            singerLive={singerLive ? `${singerLive.label}` : null}
            listening={listening}
            micStatus={mic.status}
            micBusyWithSong={micBusyWithSong}
            anyOctave={anyOctave}
            onAnyOctave={(on) => {
              // Your line was drawn for the old setting; start it fresh.
              samples.current.length = 0
              setAnyOctave(on)
            }}
            onListen={(source) => {
              if (source === 'mic' && listening) mic.stop()
              // Start the video once its audio is being heard, so the first notes aren't missed.
              void song.start(source).then((ok) => {
                if (ok && onVideo && source !== 'screen') video.play()
              })
            }}
            onSing={() => void mic.start()}
            onRestart={video.restart}
          />
        ) : null}

        <section className="panel" aria-label="Settings">
          {mode === 'voice' ? (
          <>
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
          </>
          ) : null}
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
        </aside>
      </main>

      <footer className="footer">
        {mode === 'song'
          ? 'The blue band is the singer; your line is green within 25 cents of them, yellow within a half step. Audio stays on your device.'
          : 'Tap any lane in the roll to hear that note and aim for it. Green is within 10 cents, yellow within 25. Audio stays on your device.'}{' '}
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

function formatTime(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type SongControlsProps = {
  hasVideo: boolean
  playing: boolean
  song: { status: SongStatus; source: SongSource | null; stop: () => void }
  singerLive: string | null
  listening: boolean
  micStatus: MicStatus
  micBusyWithSong: boolean
  anyOctave: boolean
  onAnyOctave: (on: boolean) => void
  onListen: (source: SongSource) => void
  onSing: () => void
  onRestart: () => void
}

function SongControls({ hasVideo, playing, song, singerLive, listening, micStatus, micBusyWithSong, anyOctave, onAnyOctave, onListen, onSing, onRestart }: SongControlsProps) {
  const tabAudio = canCaptureTabAudio()
  const songOn = song.status === 'listening'
  const blocked = (song.status === 'denied' || micStatus === 'denied') && isEmbedded()
  return (
    <section className="panel songpanel" aria-label="Sing along">
      <div className="field">
        <span>1 · Hear the singer</span>
        {songOn ? (
          <div className="row">
            <span className="live">
              <span className="live__dot" aria-hidden="true" />
              {song.source === 'mic' ? 'Listening through the mic' : song.source === 'this-tab' ? 'Listening to the video' : 'Listening to shared audio'}
              {singerLive ? ` · ${singerLive}` : ''}
            </span>
            <button type="button" className="chip" onClick={song.stop}>
              Stop
            </button>
          </div>
        ) : (
          <div className="row">
            {hasVideo && tabAudio ? (
              <button type="button" className="chip chip--on" onClick={() => onListen('this-tab')} title="Share this tab with its audio so the app can hear the video">
                🎧 Listen to the video
              </button>
            ) : null}
            {!hasVideo && tabAudio ? (
              <button type="button" className="chip" onClick={() => onListen('screen')} title="Share another tab or your screen with its audio, e.g. Spotify or a music app">
                🖥️ Listen to a tab or app
              </button>
            ) : null}
            <button type="button" className="chip" onClick={() => onListen('mic')}>
              🎙️ Listen with the mic
            </button>
          </div>
        )}
        <p className="hint">
          {song.status === 'no-audio'
            ? 'Nothing to hear: tick “Share tab audio” (or “Share system audio”) in the sharing window and try again.'
            : song.status === 'denied' && !isEmbedded()
              ? 'Sharing was cancelled or blocked.'
              : song.status === 'unsupported' || song.status === 'error'
                ? 'The song’s audio couldn’t be opened in this browser. Try “Listen with the mic”.'
                : songOn
                  ? null
                  : hasVideo
                  ? tabAudio
                    ? 'Choose this tab and keep “Share tab audio” on. The video plays and its singer’s notes are learned and saved as they play, so next time you see them coming.'
                    : 'Play the video out loud; the mic learns the singer’s notes and saves them, so next time you see them coming.'
                  : tabAudio
                    ? 'Pick the tab playing the song (or your entire screen with system audio) and its singer’s line appears live. Keep Pitch Tracker visible beside it.'
                    : 'Play a song out loud near your phone and its singer’s line appears live.'}
        </p>
      </div>

      <div className="field">
        <span>2 · Sing along</span>
        <div className="row">
          {listening ? (
            <span className="live">
              <span className="live__dot" aria-hidden="true" />
              Your mic is on
            </span>
          ) : (
            <button type="button" className="chip chip--on" onClick={onSing} disabled={micBusyWithSong || micStatus === 'starting'}>
              🎤 Sing along
            </button>
          )}
          {hasVideo ? (
            <button type="button" className="chip" onClick={onRestart}>
              ⏮ {playing ? 'Restart song' : 'Play from the start'}
            </button>
          ) : null}
        </div>
        <p className="hint">
          {micBusyWithSong
            ? 'The mic is listening to the song. Once its notes are learned, stop it, put on headphones, and sing.'
            : 'Use headphones so the mic hears only you.'}
        </p>
        <label className="toggle">
          <input type="checkbox" checked={anyOctave} onChange={(e) => onAnyOctave(e.target.checked)} />
          <span>Count any octave (sing a high part low, or a low part high)</span>
        </label>
      </div>
      {blocked ? (
        <a className="primary" href={window.location.href} target="_blank" rel="noopener noreferrer">
          Open Pitch Tracker in its own tab
        </a>
      ) : null}
    </section>
  )
}
