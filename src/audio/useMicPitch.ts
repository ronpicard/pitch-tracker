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

export function micErrorStatus(error: unknown): MicStatus {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'NotSupportedError' || name === 'TypeError') return 'unsupported'
  return 'error'
}

/** Whether the page runs inside another page's iframe (e.g. a portfolio embed). */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
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
    } catch (error) {
      console.warn('Microphone unavailable:', error)
      setStatus(micErrorStatus(error))
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
      const next: PitchFrame = { frequency, clarity: result?.clarity ?? 0, level: Math.min(1, peak), time: performance.now() }
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
