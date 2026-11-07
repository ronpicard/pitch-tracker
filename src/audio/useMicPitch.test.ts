import { describe, expect, it } from 'vitest'
import { micBlockedByPolicy, micErrorStatus } from './useMicPitch'

describe('micErrorStatus', () => {
  it('maps getUserMedia failures to user-facing states', () => {
    expect(micErrorStatus(new DOMException('no', 'NotAllowedError'))).toBe('denied')
    expect(micErrorStatus(new DOMException('no', 'SecurityError'))).toBe('denied')
    expect(micErrorStatus(new DOMException('no', 'NotFoundError'))).toBe('unsupported')
    expect(micErrorStatus(new TypeError('no'))).toBe('unsupported')
    expect(micErrorStatus(new DOMException('busy', 'NotReadableError'))).toBe('error')
    expect(micErrorStatus('weird')).toBe('error')
  })

  it('treats an embedded NotSupportedError as a blocked microphone', () => {
    expect(micErrorStatus(new DOMException('Not supported', 'NotSupportedError'), true)).toBe('denied')
  })
})

describe('micBlockedByPolicy', () => {
  it('reads the permissions policy when the browser exposes one', () => {
    const policy = (allowed: boolean) => ({ allowsFeature: (f: string) => f !== 'microphone' || allowed })
    expect(micBlockedByPolicy({ permissionsPolicy: policy(false) })).toBe(true)
    expect(micBlockedByPolicy({ permissionsPolicy: policy(true) })).toBe(false)
    expect(micBlockedByPolicy({ featurePolicy: policy(false) })).toBe(true)
    expect(micBlockedByPolicy({})).toBe(false)
    expect(micBlockedByPolicy({ permissionsPolicy: { allowsFeature: () => { throw new Error('x') } } })).toBe(false)
  })
})
