// A single click-free oscillator voice on a shared AudioContext. Starting,
// stopping, and retuning all ramp so the speaker never sees a step.

export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth'

const RAMP = 0.02

let sharedContext: AudioContext | null = null

/** One AudioContext per page; browsers cap how many may exist. */
export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) throw new Error('This browser does not support the Web Audio API.')
    sharedContext = new Ctor()
  }
  return sharedContext
}

/** Resume after a user gesture; iOS and Chrome start contexts suspended. */
export async function resumeAudio(): Promise<AudioContext> {
  const ctx = getAudioContext()
  if (ctx.state !== 'running') await ctx.resume()
  return ctx
}

export class ToneVoice {
  private osc: OscillatorNode | null = null
  private gain: GainNode | null = null
  private stopTimer: number | null = null
  private frequency = 440
  private volume = 0.3
  private waveform: Waveform = 'sine'

  get playing(): boolean {
    return this.osc !== null
  }

  async start(frequency = this.frequency): Promise<void> {
    const ctx = await resumeAudio()
    this.frequency = frequency
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (this.osc && this.gain) {
      this.setFrequency(frequency)
      this.gain.gain.cancelScheduledValues(ctx.currentTime)
      this.gain.gain.setTargetAtTime(this.scaledVolume(), ctx.currentTime, RAMP)
      return
    }
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = this.waveform
    osc.frequency.value = frequency
    gain.gain.value = 0
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    gain.gain.setTargetAtTime(this.scaledVolume(), ctx.currentTime, RAMP)
    this.osc = osc
    this.gain = gain
  }

  stop(): void {
    const { osc, gain } = this
    if (!osc || !gain) return
    const ctx = getAudioContext()
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setTargetAtTime(0, ctx.currentTime, RAMP)
    this.osc = null
    this.gain = null
    this.stopTimer = window.setTimeout(() => {
      osc.stop()
      osc.disconnect()
      gain.disconnect()
      this.stopTimer = null
    }, RAMP * 8 * 1000)
  }

  /** Play for a fixed time, e.g. a reference note. */
  async pluck(frequency: number, seconds = 1.5): Promise<void> {
    await this.start(frequency)
    const osc = this.osc
    window.setTimeout(() => {
      if (this.osc === osc) this.stop()
    }, seconds * 1000)
  }

  setFrequency(frequency: number): void {
    this.frequency = frequency
    if (this.osc) this.osc.frequency.setTargetAtTime(frequency, getAudioContext().currentTime, 0.005)
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    if (this.gain) this.gain.gain.setTargetAtTime(this.scaledVolume(), getAudioContext().currentTime, RAMP)
  }

  setWaveform(waveform: Waveform): void {
    this.waveform = waveform
    if (this.osc) this.osc.type = waveform
    this.setVolume(this.volume)
  }

  /** Square and sawtooth are much louder than sine at the same gain. */
  private scaledVolume(): number {
    const trim = this.waveform === 'square' ? 0.35 : this.waveform === 'sawtooth' ? 0.45 : this.waveform === 'triangle' ? 0.8 : 1
    return this.volume ** 2 * trim
  }
}
