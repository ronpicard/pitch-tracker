import { describe, expect, it } from 'vitest'
import { micErrorStatus } from './useMicPitch'

describe('micErrorStatus', () => {
  it('maps getUserMedia failures to user-facing states', () => {
    expect(micErrorStatus(new DOMException('no', 'NotAllowedError'))).toBe('denied')
    expect(micErrorStatus(new DOMException('no', 'SecurityError'))).toBe('denied')
    expect(micErrorStatus(new DOMException('no', 'NotFoundError'))).toBe('unsupported')
    expect(micErrorStatus(new TypeError('no'))).toBe('unsupported')
    expect(micErrorStatus(new DOMException('busy', 'NotReadableError'))).toBe('error')
    expect(micErrorStatus('weird')).toBe('error')
  })
})
