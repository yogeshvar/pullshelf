/// <reference types="vite/client" />

import type { PullshelfApi } from '../electron/preload'

declare global {
  interface Window {
    pullshelf: PullshelfApi
  }
}

export {}
