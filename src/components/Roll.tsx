import { useEffect, useRef } from 'react'
import { isBlackKey, noteFromMidi } from '../audio/notes'
import { accuracy, centsOff, midiToY, yToMidi, type Range, type Sample } from '../roll'

const GUTTER = 48
const HEAD_PAD = 18
/** Samples further apart than this are drawn as separate phrases. */
const MAX_GAP = 0.12

const COLORS = {
  bg: '#0e131a',
  laneBlack: '#0a0e13',
  line: '#1d2631',
  lineC: '#33414f',
  gutter: '#131a22',
  label: '#c9d4e0',
  labelMuted: '#5d6b7a',
  target: 'rgba(255, 159, 67, 0.18)',
  targetLine: '#ff9f43',
  good: '#3ddc84',
  ok: '#ffc857',
  off: '#ff6b6b',
  grid: 'rgba(255,255,255,0.04)',
}

type Props = {
  samples: React.RefObject<Sample[]>
  /** Current time on the samples' clock; frozen while paused. */
  now: () => number
  range: Range
  windowSeconds: number
  target: number | null
  a4: number
  onPick: (midi: number) => void
}

/** Canvas piano roll: note lanes up the side, your pitch drawn right to left. */
export function Roll({ samples, now, range, windowSeconds, target, a4, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const props = useRef({ now, range, windowSeconds, target, a4 })
  props.current = { now, range, windowSeconds, target, a4 }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    let shown = { ...props.current.range }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const { now, range, windowSeconds, target } = props.current
      // Ease the visible window so range changes glide instead of jump.
      shown = { low: shown.low + (range.low - shown.low) * 0.12, high: shown.high + (range.high - shown.high) * 0.12 }
      if (Math.abs(shown.low - range.low) < 0.01) shown = { ...range }
      const lanes = shown.high - shown.low + 1
      const laneH = h / lanes
      const t = now()
      const plotW = w - GUTTER - HEAD_PAD
      const xOf = (time: number) => GUTTER + plotW - ((t - time) / windowSeconds) * plotW

      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, w, h)

      // Lanes
      for (let m = Math.floor(shown.low) - 1; m <= Math.ceil(shown.high) + 1; m++) {
        const y = midiToY(m, shown, h)
        if (isBlackKey(m)) {
          ctx.fillStyle = COLORS.laneBlack
          ctx.fillRect(GUTTER, y - laneH / 2, w - GUTTER, laneH)
        }
        if (m === target) {
          ctx.fillStyle = COLORS.target
          ctx.fillRect(GUTTER, y - laneH / 2, w - GUTTER, laneH)
        }
        const pc = ((m % 12) + 12) % 12
        ctx.strokeStyle = pc === 0 ? COLORS.lineC : COLORS.line
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(GUTTER, Math.round(y + laneH / 2) + 0.5)
        ctx.lineTo(w, Math.round(y + laneH / 2) + 0.5)
        ctx.stroke()
      }

      if (target !== null) {
        const y = midiToY(target, shown, h)
        ctx.strokeStyle = COLORS.targetLine
        ctx.setLineDash([6, 6])
        ctx.beginPath()
        ctx.moveTo(GUTTER, y)
        ctx.lineTo(w, y)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // One-second grid moving with time.
      ctx.strokeStyle = COLORS.grid
      for (let s = Math.ceil(t - windowSeconds); s <= t; s++) {
        const x = Math.round(xOf(s)) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      // Pitch trace, coloured per segment by how far it is from the note.
      const list = samples.current ?? []
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2.5, Math.min(5, laneH * 0.25))
      let prev: Sample | null = null
      for (const s of list) {
        if (s.t < t - windowSeconds - 1) continue
        if (s.midi !== null && prev?.midi != null && s.t - prev.t < MAX_GAP) {
          ctx.strokeStyle = COLORS[accuracy(centsOff(s.midi, target))]
          ctx.beginPath()
          ctx.moveTo(xOf(prev.t), midiToY(prev.midi, shown, h))
          ctx.lineTo(xOf(s.t), midiToY(s.midi, shown, h))
          ctx.stroke()
        }
        prev = s
      }

      // Playhead dot on the latest pitch.
      const last = list[list.length - 1]
      if (last?.midi != null && t - last.t < 0.2) {
        const x = xOf(last.t)
        const y = midiToY(last.midi, shown, h)
        ctx.fillStyle = COLORS[accuracy(centsOff(last.midi, target))]
        ctx.beginPath()
        ctx.arc(x, y, ctx.lineWidth * 1.4, 0, Math.PI * 2)
        ctx.fill()
      }

      // Note gutter on top so the trace slides under it.
      ctx.fillStyle = COLORS.gutter
      ctx.fillRect(0, 0, GUTTER, h)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const fontSize = Math.max(9, Math.min(13, laneH * 0.62))
      for (let m = Math.floor(shown.low) - 1; m <= Math.ceil(shown.high) + 1; m++) {
        const y = midiToY(m, shown, h)
        if (y < -laneH || y > h + laneH) continue
        const note = noteFromMidi(m)
        const black = isBlackKey(m)
        if (black && laneH < 12) continue
        ctx.font = `${m === target || note.name === 'C' ? 700 : 500} ${black ? fontSize - 1 : fontSize}px system-ui, sans-serif`
        ctx.fillStyle = m === target ? COLORS.targetLine : black ? COLORS.labelMuted : COLORS.label
        ctx.fillText(note.label, GUTTER - 8, y)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [samples])

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const midi = Math.round(yToMidi(e.clientY - rect.top, props.current.range, rect.height))
    onPick(Math.max(0, Math.min(127, midi)))
  }

  const label = `Pitch roll from ${noteFromMidi(range.low, a4).label} to ${noteFromMidi(range.high, a4).label}. Tap a note lane to hear it and set it as your target.`
  return <canvas ref={canvasRef} className="roll" onPointerDown={pick} role="img" aria-label={label} />
}
