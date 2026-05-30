import type { PlayerVideoOptions } from 'textalive-app-api'

export type Phase = 'setup' | 'playing' | 'result'
export type CurtainPhase = 'idle' | 'closing' | 'opening'
export type ShutterEffect = 'default' | 'finder' | 'focus-zoom' | 'blur-to-clear' | 'strobe' | 'snap' | 'frame'

export interface SetupConfig {
  songUrl: string
  songOptions?: PlayerVideoOptions
}

export interface CaptureItem {
  id: string
  dataUrl: string
  width: number
  height: number
  phrase: string
  timestamp: number
  songPosition: number
}

export interface TextAliveControls {
  play: () => void
  pause: () => void
  stop: () => void
  seek: (ratio: number) => void
  seekStart: () => void
  seekEnd: (ratio: number) => void
}
