import { useCallback, useEffect, useRef, useState } from 'react'
import { MelodyAnalyzer, MelodyTracker } from './melody'
import { rms } from './pitch'
import { resumeAudio } from './tone'
import { isEmbedded, meterLevel, micBlockedByPolicy, micErrorStatus, type MicStatus, type PitchFrame } from './useMicPitch'

/**
 * Where the song comes from:
 * - `this-tab`: the YouTube video playing inside Pitch Tracker, captured as tab audio.
 * - `screen`: any other tab, or (on Windows and ChromeOS) the whole system's sound.
 * - `mic`: the song playing out loud in the room.
 */
export type SongSource = 'this-tab' | 'screen' | 'mic'

/** `no-audio`: a tab or screen was shared without its sound. */
export type SongStatus = MicStatus | 'no-audio'

const SIZE = 4096

/** Whether this browser can capture tab or system audio (desktop Chrome, Edge, Firefox partly). */
export function canCaptureTabAudio(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/** A shared tab or screen often comes back as two identical or one silent channel; only real stereo gets centre extraction. */
export function isStereo(left: Float32Array, right: Float32Array): boolean {
  const l = rms(left)
  const r = rms(right)
  return l > 0 && r > 0.05 * l && l > 0.05 * r
}

type Options = {
  onFrame?: (frame: PitchFrame) => void
}

/** Lead-vocal pitch from a song, live, from shared tab/system audio or the microphone. */
export function useSongPitch(options: Options = {}) {
  const [status, setStatus] = useState<SongStatus>('idle')
  const [source, setSource] = useState<SongSource | null>(null)
  const [frame, setFrame] = useState<PitchFrame>({ frequency: null, clarity: 0, level: 0, time: 0 })
  const optionsRef = useRef(options)
  optionsRef.current = options
  const cleanupRef = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setStatus('idle')
    setSource(null)
    setFrame({ frequency: null, clarity: 0, level: 0, time: performance.now() })
  }, [])

  const start = useCallback(
    /** Resolves true once the song is being heard. */
    async (kind: SongSource): Promise<boolean> => {
      if (cleanupRef.current) stop()
      const feature = kind === 'mic' ? 'microphone' : 'display-capture'
      if (micBlockedByPolicy(undefined, feature)) {
        setStatus('denied')
        return false
      }
      const devices = navigator.mediaDevices
      if (kind === 'mic' ? !devices?.getUserMedia : !devices?.getDisplayMedia) {
        setStatus(window.isSecureContext ? 'unsupported' : 'denied')
        return false
      }
      setSource(kind)
      setStatus('starting')
      const resumed = resumeAudio()
      resumed.catch(() => undefined)
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      let stream: MediaStream
      let ctx: AudioContext
      try {
        stream =
          kind === 'mic'
            ? await devices.getUserMedia({ audio })
            : await devices.getDisplayMedia({
                video: true, // required by browsers; dropped right away
                audio: { ...audio, suppressLocalAudioPlayback: false } as MediaTrackConstraints,
                // Chrome hints: offer this tab first for the embedded video, include system audio for the rest.
                ...(kind === 'this-tab' ? { preferCurrentTab: true, selfBrowserSurface: 'include' } : { selfBrowserSurface: 'exclude', systemAudio: 'include' }),
              } as DisplayMediaStreamOptions)
        ctx = await resumed
        if (ctx.state !== 'running') await ctx.resume()
      } catch (error) {
        console.warn('Song audio unavailable:', error)
        setStatus(micErrorStatus(error, isEmbedded()))
        setSource(null)
        return false
      }

      stream.getVideoTracks().forEach((track) => track.stop())
      const tracks = stream.getAudioTracks()
      if (tracks.length === 0) {
        setStatus('no-audio')
        setSource(null)
        return false
      }

      const input = ctx.createMediaStreamSource(stream)
      const splitter = ctx.createChannelSplitter(2)
      const left = ctx.createAnalyser()
      const right = ctx.createAnalyser()
      left.fftSize = SIZE
      right.fftSize = SIZE
      input.connect(splitter)
      splitter.connect(left, 0)
      splitter.connect(right, 1)
      const bufL = new Float32Array(SIZE)
      const bufR = new Float32Array(SIZE)
      const analyzer = new MelodyAnalyzer(SIZE, ctx.sampleRate)
      const tracker = new MelodyTracker()
      // The pitch belongs to the middle of the analysis window.
      const latencyMs = (SIZE / 2 / ctx.sampleRate) * 1000
      let raf = 0

      const tick = () => {
        raf = requestAnimationFrame(tick)
        left.getFloatTimeDomainData(bufL)
        right.getFloatTimeDomainData(bufR)
        const result = analyzer.analyze(bufL, kind !== 'mic' && isStereo(bufL, bufR) ? bufR : undefined)
        const frequency = tracker.step(result)
        let peak = 0
        for (let i = 0; i < SIZE; i++) peak = Math.max(peak, Math.abs(bufL[i]!))
        const next: PitchFrame = { frequency, clarity: result.candidates[0]?.salience ?? 0, level: meterLevel(peak), time: performance.now() - latencyMs }
        optionsRef.current.onFrame?.(next)
        setFrame(next)
      }
      raf = requestAnimationFrame(tick)
      setStatus('listening')

      // "Stop sharing" in the browser's own bar ends the track.
      const ended = () => stop()
      tracks.forEach((track) => track.addEventListener('ended', ended))

      cleanupRef.current = () => {
        cancelAnimationFrame(raf)
        tracks.forEach((track) => track.removeEventListener('ended', ended))
        input.disconnect()
        splitter.disconnect()
        stream.getTracks().forEach((track) => track.stop())
      }
      return true
    },
    [stop],
  )

  useEffect(() => () => cleanupRef.current?.(), [])

  return { status, source, frame, start, stop }
}
