// Lead-vocal pitch from a full mix (predominant melody extraction).
//
// detectPitch() in pitch.ts expects one voice at a time; in a song the bass,
// chords, and drums swamp it. This follows the approach of Salamon & Gómez
// ("Melodia"): find the spectral peaks, weight them like the ear does (which
// pushes the bass down), and score every candidate pitch by how much
// harmonic energy lines up above it. The singer is usually the strongest,
// most harmonic line in the vocal range, so the best-scoring candidate,
// followed over time by MelodyTracker, is the sung note.
//
// For stereo sources the analysis keeps only what is panned to the centre,
// where lead vocals are mixed, and drops hard-panned guitars and keys.

export type MelodyOptions = {
  /** Lowest and highest sung pitch considered, in Hz. */
  minFrequency?: number
  maxFrequency?: number
  /** Harmonics summed per candidate. */
  harmonics?: number
  /** Weight of each successive harmonic (alpha^(h-1)). */
  harmonicDecay?: number
  /** Peaks more than this many dB below the loudest are ignored. */
  dynamicRange?: number
  /** Mono mix RMS below this is silence. */
  minRms?: number
}

export type Candidate = {
  frequency: number
  /** Harmonic-sum score; only meaningful relative to other frames. */
  salience: number
}

export type MelodyFrame = {
  /** Best candidates first. */
  candidates: Candidate[]
  rms: number
}

const DEFAULTS: Required<MelodyOptions> = {
  minFrequency: 75,
  maxFrequency: 1100,
  harmonics: 16,
  harmonicDecay: 0.8,
  dynamicRange: 40,
  minRms: 0.002,
}

/** Salience grid resolution, in cents. */
const BIN_CENTS = 10
const MAX_PEAK_FREQUENCY = 5000
const MAX_CANDIDATES = 6

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n & (n - 1)) throw new Error(`FFT size must be a power of two, got ${n}`)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** A-weighting gain (linear): an equal-loudness stand-in that tames the bass. */
export function aWeight(f: number): number {
  const f2 = f * f
  const num = 12194 ** 2 * f2 * f2
  const den = (f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)
  return (num / den) * 1.2589 // +2 dB so 1 kHz is ~unity
}

type Peak = { frequency: number; magnitude: number }

export class MelodyAnalyzer {
  readonly size: number
  readonly sampleRate: number
  private readonly opts: Required<MelodyOptions>
  private readonly window: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly re2: Float64Array
  private readonly im2: Float64Array
  private readonly mag: Float64Array
  private readonly salience: Float64Array

  constructor(size: number, sampleRate: number, options: MelodyOptions = {}) {
    if (size & (size - 1) || size < 256) throw new Error(`Analysis size must be a power of two ≥ 256, got ${size}`)
    if (!(sampleRate > 0)) throw new Error(`Invalid sample rate ${sampleRate}`)
    this.size = size
    this.sampleRate = sampleRate
    this.opts = { ...DEFAULTS, ...options }
    this.window = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)))
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
    this.re2 = new Float64Array(size)
    this.im2 = new Float64Array(size)
    this.mag = new Float64Array(size / 2)
    const bins = Math.ceil((1200 * Math.log2(this.opts.maxFrequency / this.opts.minFrequency)) / BIN_CENTS) + 1
    this.salience = new Float64Array(bins)
  }

  /**
   * Analyse the newest `size` samples. Pass `right` for a stereo source to
   * keep only centre-panned sound; omit it for a mono source such as a mic.
   */
  analyze(left: Float32Array, right?: Float32Array): MelodyFrame {
    const { size, re, im, re2, im2, mag, window } = this
    const offL = left.length - size
    const offR = right ? right.length - size : 0
    if (offL < 0 || offR < 0) throw new Error(`Need ${size} samples per channel`)

    let energy = 0
    for (let i = 0; i < size; i++) {
      const l = left[offL + i]!
      const r = right ? right[offR + i]! : l
      const m = (l + r) / 2
      energy += m * m
      re[i] = l * window[i]!
      im[i] = 0
      re2[i] = r * window[i]!
      im2[i] = 0
    }
    const level = Math.sqrt(energy / size)
    if (level < this.opts.minRms) return { candidates: [], rms: level }

    fft(re, im)
    if (right) fft(re2, im2)
    for (let k = 0; k < size / 2; k++) {
      if (!right) {
        mag[k] = Math.hypot(re[k]!, im[k]!)
        continue
      }
      const lMag = Math.hypot(re[k]!, im[k]!)
      const rMag = Math.hypot(re2[k]!, im2[k]!)
      const mid = Math.hypot(re[k]! + re2[k]!, im[k]! + im2[k]!) / 2
      const side = Math.hypot(re[k]! - re2[k]!, im[k]! - im2[k]!)
      // 1 when L and R match (centre), 0 when one side is silent or they cancel.
      const centre = Math.max(0, 1 - side / (lMag + rMag + 1e-12))
      mag[k] = mid * centre * centre
    }

    const peaks = this.peaks()
    const candidates = this.score(peaks)
    return { candidates, rms: level }
  }

  private peaks(): Peak[] {
    const { mag, size, sampleRate } = this
    const binHz = sampleRate / size
    const last = Math.min(size / 2 - 2, Math.floor(MAX_PEAK_FREQUENCY / binHz))
    const first = Math.max(1, Math.floor((this.opts.minFrequency * 0.9) / binHz))
    const found: Peak[] = []
    let loudest = 0
    for (let k = first; k <= last; k++) {
      const v = mag[k]!
      if (v <= mag[k - 1]! || v < mag[k + 1]! || v <= 0) continue
      // Parabolic interpolation on log magnitude for the true peak position.
      const a = Math.log(mag[k - 1]! + 1e-12)
      const b = Math.log(v)
      const c = Math.log(mag[k + 1]! + 1e-12)
      const denom = a - 2 * b + c
      const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0
      const frequency = (k + shift) * binHz
      const magnitude = Math.exp(b - 0.25 * (a - c) * shift) * aWeight(frequency)
      loudest = Math.max(loudest, magnitude)
      found.push({ frequency, magnitude })
    }
    const floor = loudest * 10 ** (-this.opts.dynamicRange / 20)
    return found.filter((p) => p.magnitude >= floor)
  }

  private score(peaks: Peak[]): Candidate[] {
    const { salience } = this
    const { minFrequency, maxFrequency, harmonics, harmonicDecay } = this.opts
    salience.fill(0)
    const binsPerSemitone = 100 / BIN_CENTS
    for (const p of peaks) {
      let weight = p.magnitude
      for (let h = 1; h <= harmonics; h++, weight *= harmonicDecay) {
        const f0 = p.frequency / h
        if (f0 < minFrequency * 0.97) break
        if (f0 > maxFrequency * 1.03) continue
        const centre = (1200 * Math.log2(f0 / minFrequency)) / BIN_CENTS
        // cos² kernel one semitone wide each side, as in Melodia.
        const lo = Math.max(0, Math.ceil(centre - binsPerSemitone))
        const hi = Math.min(salience.length - 1, Math.floor(centre + binsPerSemitone))
        for (let b = lo; b <= hi; b++) {
          const d = (b - centre) / binsPerSemitone
          salience[b]! += weight * Math.cos((d * Math.PI) / 2) ** 2
        }
      }
    }

    const raw: Candidate[] = []
    for (let b = 1; b < salience.length - 1; b++) {
      const v = salience[b]!
      if (v <= 0 || v < salience[b - 1]! || v <= salience[b + 1]!) continue
      const denom = salience[b - 1]! - 2 * v + salience[b + 1]!
      const shift = denom < 0 ? (0.5 * (salience[b - 1]! - salience[b + 1]!)) / denom : 0
      raw.push({ frequency: minFrequency * 2 ** (((b + shift) * BIN_CENTS) / 1200), salience: v })
    }
    raw.sort((a, b) => b.salience - a.salience)
    return raw.slice(0, MAX_CANDIDATES).map((c) => ({ ...c, frequency: refine(c.frequency, peaks, harmonicDecay) }))
  }
}

/** Sharpen a 10-cent grid estimate from the harmonics that actually sit on it. */
function refine(f0: number, peaks: Peak[], decay: number): number {
  let sum = 0
  let weights = 0
  for (const p of peaks) {
    const h = Math.round(p.frequency / f0)
    if (h < 1 || h > 8) continue
    const cents = 1200 * Math.log2(p.frequency / (h * f0))
    if (Math.abs(cents) > 35) continue
    const w = p.magnitude * decay ** (h - 1)
    sum += w * Math.log2(p.frequency / h)
    weights += w
  }
  return weights > 0 ? 2 ** (sum / weights) : f0
}

export type TrackerOptions = {
  /** A frame is sung when its best salience is at least this share of the running average. */
  voicing?: number
  /** How far (semitones) the line prefers to move between frames. */
  continuity?: number
  /** Frames a far-away, stronger candidate must win before the line jumps to it. */
  jumpFrames?: number
  /** Readings in the median filter. */
  smoothing?: number
}

/**
 * Follows one melodic line through the per-frame candidates: it prefers
 * candidates close to where the line already is, so a loud chord or bass
 * note for a frame or two doesn't yank it away from the singer.
 */
export class MelodyTracker {
  private readonly opts: Required<TrackerOptions>
  private current: number | null = null
  private average = 0
  private pending: { frequency: number; count: number } | null = null
  private silent = 0
  private recent: number[] = []

  constructor(options: TrackerOptions = {}) {
    this.opts = { voicing: 0.3, continuity: 2.5, jumpFrames: 3, smoothing: 3, ...options }
  }

  reset(): void {
    this.current = null
    this.pending = null
    this.recent = []
    this.silent = 0
  }

  /** Next frame's candidates in, smoothed lead frequency (Hz) or null out. */
  step(frame: MelodyFrame): number | null {
    const top = frame.candidates[0]
    if (top) this.average = this.average ? this.average * 0.98 + top.salience * 0.02 : top.salience
    if (!top || top.salience < this.opts.voicing * this.average) {
      if (++this.silent > 4) this.reset()
      return null
    }
    this.silent = 0

    let chosen = top
    if (this.current !== null) {
      const near = (c: Candidate) => c.salience * Math.exp(-(semitones(c.frequency, this.current!) ** 2) / (2 * this.opts.continuity ** 2))
      chosen = frame.candidates.reduce((best, c) => (near(c) > near(best) ? c : best))
      const far = Math.abs(semitones(top.frequency, this.current)) > 2 * this.opts.continuity
      if (chosen !== top && far && top.salience > 1.4 * chosen.salience) {
        const same = this.pending && Math.abs(semitones(top.frequency, this.pending.frequency)) < 1
        this.pending = { frequency: top.frequency, count: same ? this.pending!.count + 1 : 1 }
        if (this.pending.count >= this.opts.jumpFrames || chosen.salience < 0.2 * top.salience) chosen = top
      } else {
        this.pending = null
      }
    }
    if (this.current !== null && Math.abs(semitones(chosen.frequency, this.current)) > 7) this.recent = []
    this.current = chosen.frequency
    this.recent.push(chosen.frequency)
    if (this.recent.length > this.opts.smoothing) this.recent.shift()
    const sorted = [...this.recent].sort((a, b) => a - b)
    return sorted[sorted.length >> 1]!
  }
}

function semitones(a: number, b: number): number {
  return 12 * Math.log2(a / b)
}
