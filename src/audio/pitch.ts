// Monophonic pitch detection with the McLeod Pitch Method (normalized square
// difference function + peak picking + parabolic interpolation). It is robust
// on voices and plucked strings and avoids most octave errors of plain
// autocorrelation.

export type PitchOptions = {
  minFrequency?: number
  maxFrequency?: number
  /** Signal RMS below this is treated as silence. */
  minRms?: number
  /** First NSDF peak at or above `cutoff * highestPeak` wins. */
  cutoff?: number
  /** Readings whose clarity is below this are dropped. */
  minClarity?: number
}

export type PitchResult = {
  frequency: number
  /** 0..1, how periodic the signal is. */
  clarity: number
  rms: number
}

const DEFAULTS: Required<PitchOptions> = {
  minFrequency: 27,
  maxFrequency: 4200,
  // Low on purpose: the mic runs without auto gain, so real instruments are
  // often this quiet. NSDF is scale-free, and the clarity check rejects noise.
  minRms: 0.001,
  cutoff: 0.9,
  minClarity: 0.8,
}

export function rms(buffer: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < buffer.length; i++) sum += buffer[i]! * buffer[i]!
  return buffer.length ? Math.sqrt(sum / buffer.length) : 0
}

export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  options: PitchOptions = {},
): PitchResult | null {
  const opts = { ...DEFAULTS, ...options }
  const level = rms(buffer)
  if (level < opts.minRms || !(sampleRate > 0)) return null

  const n = buffer.length
  const minLag = Math.max(2, Math.floor(sampleRate / opts.maxFrequency))
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / opts.minFrequency))
  if (maxLag <= minLag) return null

  // NSDF over lags [0, maxLag]: 2 * r(tau) / m(tau).
  // m(tau) shrinks by two squared samples per lag, so it is updated in O(1).
  const nsdf = new Float32Array(maxLag + 1)
  let energy = 0
  for (let i = 0; i < n; i++) energy += 2 * buffer[i]! * buffer[i]!
  for (let tau = 0; tau <= maxLag; tau++) {
    if (tau > 0) energy -= buffer[tau - 1]! ** 2 + buffer[n - tau]! ** 2
    let acf = 0
    for (let i = 0; i < n - tau; i++) acf += buffer[i]! * buffer[i + tau]!
    nsdf[tau] = energy > 1e-12 ? (2 * acf) / energy : 0
  }

  // Key maxima: the highest point between each positive-going and
  // negative-going zero crossing, skipping the lobe around lag 0.
  const peaks: number[] = []
  let tau = 1
  while (tau < maxLag && nsdf[tau]! > 0) tau++
  let best = -1
  for (; tau < maxLag; tau++) {
    const v = nsdf[tau]!
    if (v > 0) {
      if (tau >= minLag && (best < 0 || v > nsdf[best]!)) best = tau
    } else if (best >= 0) {
      peaks.push(best)
      best = -1
    }
  }
  if (best >= 0) peaks.push(best)
  if (peaks.length === 0) return null

  let highest = 0
  for (const p of peaks) highest = Math.max(highest, nsdf[p]!)
  const threshold = opts.cutoff * highest
  const chosen = peaks.find((p) => nsdf[p]! >= threshold)!

  // Parabolic interpolation around the chosen lag for sub-sample precision.
  const y0 = nsdf[chosen - 1]!
  const y1 = nsdf[chosen]!
  const y2 = nsdf[chosen + 1] ?? y1
  const denom = y0 - 2 * y1 + y2
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0
  const period = chosen + Math.max(-0.5, Math.min(0.5, shift))
  const clarity = Math.min(1, y1 - 0.25 * (y0 - y2) * shift)

  if (clarity < opts.minClarity) return null
  const frequency = sampleRate / period
  if (frequency < opts.minFrequency || frequency > opts.maxFrequency) return null
  return { frequency, clarity, rms: level }
}

/** Median of the last readings; rejects single-frame octave jumps. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
