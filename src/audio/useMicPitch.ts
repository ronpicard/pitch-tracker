import { useCallback, useEffect, useRef, useState } from 'react'
import { detectPitch, median, type PitchOptions } from './pitch'
import { resumeAudio } from './tone'

export type MicStatus = 'idle' | 'starting' | 'listening' | 'denied' | 'unsupported' | 'error'

export type PitchFrame = {
  /** Smoothed frequency in Hz, or null during silence. */
  frequency: number | null
  clarity: number
  /** Input level 0..1 for a meter. */
  level: number
  time: number
}

type Options = PitchOptions & {
  /** Analyser window; larger catches lower notes at more latency. */
  fftSize?: number
  /** How many readings the median filter spans. */
  smoothing?: number
  onFrame?: (frame: PitchFrame) => void
}

/**
 * Map a getUserMedia failure to what the user should see. Inside an iframe,
 * browsers report a Permissions-Policy block as NotSupportedError (Chrome) or
 * other names, so there "unsupported" really means "blocked by the embedder".
 */
export function micErrorStatus(error: unknown, embedded = false): MicStatus {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'NotSupportedError' || name === 'TypeError') return embedded ? 'denied' : 'unsupported'
  return 'error'
}

/**
 * Peak sample to a 0..1 meter on a -60..0 dBFS scale, so the quiet input of
 * a mic without auto gain still visibly moves it. Exact digital silence is 0.
 */
export function meterLevel(peak: number): number {
  if (!(peak > 0)) return 0
  return Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak)) / 60))
}

/** Whether the page runs inside another page's iframe (e.g. a portfolio embed). */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

type PolicyDocument = { permissionsPolicy?: { allowsFeature(feature: string): boolean }; featurePolicy?: { allowsFeature(feature: string): boolean } }

/** True when the page's Permissions-Policy (e.g. an iframe without allow="microphone") forbids the mic (or another capture feature). */
export function micBlockedByPolicy(doc: PolicyDocument = document as PolicyDocument, feature = 'microphone'): boolean {
  const policy = doc.permissionsPolicy ?? doc.featurePolicy
  try {
    return policy ? !policy.allowsFeature(feature) : false
  } catch {
    return false
  }
}

export function useMicPitch(options: Options = {}) {
  const [status, setStatus] = useState<MicStatus>('idle')
  const [frame, setFrame] = useState<PitchFrame>({ frequency: null, clarity: 0, level: 0, time: 0 })
  const optionsRef = useRef(options)
  optionsRef.current = options
  const cleanupRef = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setStatus('idle')
    setFrame({ frequency: null, clarity: 0, level: 0, time: performance.now() })
  }, [])

  const start = useCallback(async () => {
    if (cleanupRef.current) return
    if (micBlockedByPolicy()) {
      setStatus('denied')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(window.isSecureContext ? 'unsupported' : 'denied')
      return
    }
    setStatus('starting')
    let stream: MediaStream
    let ctx: AudioContext
    // Resume audio while still inside the tap; iOS refuses once the mic prompt has intervened.
    const resumed = resumeAudio()
    resumed.catch(() => undefined) // reported below if the mic step succeeds
    try {
      // Voice processing smears pitch and fights sustained notes; turn it off.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      ctx = await resumed
      // iOS can suspend the context while it switches to recording; wake it again.
      if (ctx.state !== 'running') await ctx.resume()
    } catch (error) {
      console.warn('Microphone unavailable:', error)
      setStatus(micErrorStatus(error, isEmbedded()))
      return
    }

    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = optionsRef.current.fftSize ?? 4096
    source.connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)
    const recent: number[] = []
    let raf = 0
    let silentFrames = 0

    const tick = () => {
      raf = requestAnimationFrame(tick)
      analyser.getFloatTimeDomainData(buffer)
      const { onFrame, smoothing = 5, fftSize: _f, ...pitchOptions } = optionsRef.current
      const result = detectPitch(buffer, ctx.sampleRate, pitchOptions)
      let frequency: number | null = null
      if (result) {
        silentFrames = 0
        // A jump of more than a fifth starts a fresh note instead of blending.
        const last = recent[recent.length - 1]
        if (last && Math.abs(Math.log2(result.frequency / last)) > 7 / 12) recent.length = 0
        recent.push(result.frequency)
        if (recent.length > smoothing) recent.shift()
        frequency = median(recent)
      } else if (++silentFrames > 6) {
        recent.length = 0
      } else if (recent.length) {
        frequency = median(recent)
      }
      let peak = 0
      for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]!))
      const next: PitchFrame = { frequency, clarity: result?.clarity ?? 0, level: meterLevel(peak), time: performance.now() }
      onFrame?.(next)
      setFrame(next)
    }
    raf = requestAnimationFrame(tick)
    setStatus('listening')

    cleanupRef.current = () => {
      cancelAnimationFrame(raf)
      source.disconnect()
      stream.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => () => cleanupRef.current?.(), [])

  return { status, frame, start, stop }
}
