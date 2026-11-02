import { afterEach, beforeEach, vi } from 'vitest'
import { resetElectron } from '../mocks/electron'

// electron/log.ts wraps console.error/warn; put the real ones back so wrappers never pile up across tests.
const realConsole = { error: console.error, warn: console.warn }

beforeEach(() => {
  resetElectron()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  console.error = realConsole.error
  console.warn = realConsole.warn
})
