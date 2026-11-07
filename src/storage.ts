// localStorage can throw (private mode, blocked site data, sandboxed iframes),
// so settings are best-effort and the app works without them.

export function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Settings simply won't persist.
  }
}
