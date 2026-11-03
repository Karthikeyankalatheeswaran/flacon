import type { EngineBridge, FlaconBridge } from '@shared/ipc'

declare global {
  interface Window {
    flacon?: FlaconBridge
    flaconEngine?: EngineBridge
  }
}
export {}
