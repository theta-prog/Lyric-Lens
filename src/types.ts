import type { PlayerVideoOptions } from 'textalive-app-api'

export type Phase = 'setup' | 'playing' | 'result'
export type CurtainPhase = 'idle' | 'closing' | 'opening'
export type CameraOffVisualMode = 'classic' | 'shutter-mv' | 'film-studio' | 'signal-pop'
export type CameraOffStudioScene = 'verse' | 'build' | 'chorus'
export type CameraOffInteractionKind = 'tap-burst' | 'press-arming' | 'press-charge' | 'drag-trail'
export type FilmPresetId = 'mv-film' | 'sepia-400' | 'mono-800' | 'cine-gold' | 'signal-chrome'
export type ShutterEffect =
  | 'default'
  | 'finder'
  | 'focus-zoom'
  | 'blur-to-clear'
  | 'strobe'
  | 'snap'
  | 'frame'
  | 'light-leak'
  | 'sound-wave'
  | 'stage-curtain'
  | 'speed-lines'
  | 'answer-scan'
  | 'glitch'
  | 'noise'

export interface SetupConfig {
  songUrl: string
  songOptions?: PlayerVideoOptions
  cameraDeviceId?: string
}

export interface CameraOffInteractionSnapshot {
  kind: CameraOffInteractionKind
  x: number
  y: number
  intensity: number
  preset: CameraOffVisualMode
  hue?: number
  points?: { x: number; y: number }[]
}

export interface CaptureItem {
  id: string
  dataUrl: string
  rawDataUrl?: string
  filteredDataUrl?: string
  width: number
  height: number
  phrase: string
  timestamp: number
  songPosition: number
  songTitle?: string
  bpm?: number
  chordName?: string
  isChorus?: boolean
  vocalIntensity?: number
  tintHue?: number
  filmPresetId?: FilmPresetId
  filmPresetLabel?: string
  cameraOffVisualMode?: CameraOffVisualMode
  cameraOffInteraction?: CameraOffInteractionSnapshot
  shutterEffect?: ShutterEffect
  filterEnabledAtCapture?: boolean
}

export interface TextAliveControls {
  play: () => void
  pause: () => void
  stop: () => void
  seek: (ratio: number) => void
  seekStart: () => void
  seekEnd: (ratio: number) => void
}
