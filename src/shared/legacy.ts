// Pullshelf was called Perch (and Ledge before that); carry a setting saved under the old browser-storage key over once.
export function adoptLegacyKey(legacyKey: string, key: string): void {
  try {
    if (localStorage.getItem(key) !== null) return
    const old = localStorage.getItem(legacyKey)
    if (old !== null) localStorage.setItem(key, old)
  } catch {
    // storage unavailable; nothing to carry over
  }
}
