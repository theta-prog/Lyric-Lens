import type { PlayerVideoOptions } from 'textalive-app-api'
import { AnimatePresence, motion } from 'framer-motion'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { useTextAlive } from '../hooks/useTextAlive'
import type {
  CameraOffInteractionSnapshot,
  CameraOffStudioScene,
  CameraOffVisualMode,
  CaptureItem,
  CurtainPhase,
  FilmPresetId,
  ShutterEffect,
} from '../types'
import { captureFrameAsync, type CaptureFilter } from '../utils/capture'
import PlaybackBar from './PlaybackBar'

interface LyricTrigger {
  words: readonly string[]
  effect?: ShutterEffect
  countdown?: {
    steps: readonly number[]
    beatsPerStep?: number
    bpmMultiplier?: number
  }
}

const LYRIC_TRIGGERS: readonly LyricTrigger[] = [
  {
    words: ['シャッター', 'しゃったー', 'チャンス', '瞬間', '切り取り', '切り取', '保存', '残せる'],
    countdown: {
      steps: [3, 2, 1],
      beatsPerStep: 1,
      bpmMultiplier: 2,
    },
  },
  { words: ['ファインダー'],        effect: 'finder' },
  { words: ['フォーカス', '焦点'], effect: 'focus-zoom' },
  { words: ['ピント', '凍り', '溶け'], effect: 'blur-to-clear' },
  { words: ['ストロボ'],           effect: 'strobe' },
  { words: ['スナップ'],           effect: 'snap' },
  { words: ['フレーム'],           effect: 'frame' },
  { words: ['レリーズ'],           effect: 'default' },
  {
    words: ['光', 'ヒカリ', '灯り', '輝', '色', 'イロ', '青', '影', '闇', '残像', 'ヘイロー', '照ら', '水面', '映る', '形', 'カケラ', '綺麗', '丸'],
    effect: 'light-leak',
  },
  {
    words: ['声', 'コエ', '言葉', '音', 'オンガク', '音楽', 'メロディ', '残響', 'シグナル', '周波数', 'テンポ', 'clap', 'beat', '拍手'],
    effect: 'sound-wave',
  },
  {
    words: ['ノイズ', 'noise', 'ホワイトノイズ'],
    effect: 'noise',
  },
  {
    words: ['幕', 'ステージ', 'カーテン', '終わり', 'はじまり'],
    effect: 'stage-curtain',
  },
  {
    words: ['加速', '速度', 'アクセル', 'speed', 'full speed', 'テイクオーバー', 'takeover'],
    effect: 'speed-lines',
  },
  {
    words: ['世界', 'セカイ', '未来', 'ミライ'],
    effect: 'glitch',
  },
  {
    words: ['問い', '答え', '探', '目', '手を伸ば', '迷', '見せ', '魅せ', '見つけ', '見捨て', '見れる', 'ウソ', '本物', 'ロジック', '取り繕', 'ハリボテ'],
    effect: 'answer-scan',
  },
]

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))
const waitUntil = (deadline: number) =>
  new Promise<void>(resolve => {
    const tick = () => {
      const remaining = deadline - performance.now()

      if (remaining <= 0) {
        resolve()
        return
      }

      window.setTimeout(tick, Math.min(remaining, 16))
    }

    tick()
  })

interface PlayerViewProps {
  token: string
  songUrl: string
  songOptions?: PlayerVideoOptions
  cameraDeviceId?: string
  onFinish: (captures: CaptureItem[]) => void
}

function normalizeText(text: string) {
  return text.trim().toLowerCase()
}

function isMobileLikeDevice() {
  if (typeof window === 'undefined') return false

  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  return mobileUserAgent || (coarsePointer && navigator.maxTouchPoints > 1)
}

// Order matters: longer/more-specific words first to avoid partial matches
const COLOR_LYRICS_MAP: readonly [string, number][] = [
  ['黄色', 55], ['水色', 190],
  ['赤', 0], ['紅', 5], ['朱', 10],
  ['橙', 28], ['オレンジ', 25],
  ['黄', 55],
  ['緑', 130], ['翠', 120],
  ['青', 220], ['蒼', 215], ['藍', 240],
  ['紫', 280],
  ['桃', 345], ['ピンク', 340],
]

function findColorKeyword(text: string): number | null {
  const normalized = normalizeText(text)
  for (const [word, hue] of COLOR_LYRICS_MAP) {
    if (normalized.includes(normalizeText(word))) return hue
  }
  return null
}

const CHORD_ROOT_HUES: Record<string, number> = {
  C: 48,
  'C#': 70,
  Db: 70,
  D: 92,
  'D#': 128,
  Eb: 128,
  E: 155,
  F: 185,
  'F#': 205,
  Gb: 205,
  G: 224,
  'G#': 252,
  Ab: 252,
  A: 286,
  'A#': 322,
  Bb: 322,
  B: 352,
}

function getChordHue(chordName: string) {
  const match = chordName.match(/^[A-G](?:#|b)?/)
  if (!match) return null
  return CHORD_ROOT_HUES[match[0]] ?? null
}

interface MoodVisualSettings {
  canvasFilter: string
  tintHue: number
  tintSaturation: number
  tintLightness: number
  tintOpacity: number
}

export interface FilmPreset {
  id: FilmPresetId
  label: string
  shortLabel: string
  cssFilter: string
  tintHue: number
  tintSaturation: number
  tintLightness: number
  tintOpacity: number
  grainOpacity: number
  vignetteOpacity: number
  leakHue: number
  leakOpacity: number
  swatch: string
}

const FILM_PRESETS: readonly FilmPreset[] = [
  {
    id: 'mv-film',
    label: 'MV FILM',
    shortLabel: 'MV',
    cssFilter: 'saturate(118%) contrast(104%) brightness(101%)',
    tintHue: 190,
    tintSaturation: 62,
    tintLightness: 60,
    tintOpacity: 0.08,
    grainOpacity: 0.06,
    vignetteOpacity: 0.16,
    leakHue: 48,
    leakOpacity: 0.10,
    swatch: 'linear-gradient(135deg, #3dd6e8 0 48%, #fffdf8 48% 54%, #f5c842 54% 100%)',
  },
  {
    id: 'sepia-400',
    label: 'SEPIA 400',
    shortLabel: '400',
    cssFilter: 'sepia(46%) saturate(86%) contrast(108%) brightness(96%)',
    tintHue: 34,
    tintSaturation: 42,
    tintLightness: 52,
    tintOpacity: 0.24,
    grainOpacity: 0.12,
    vignetteOpacity: 0.24,
    leakHue: 24,
    leakOpacity: 0.14,
    swatch: 'linear-gradient(135deg, #7b5736 0 50%, #d9b06f 50% 100%)',
  },
  {
    id: 'mono-800',
    label: 'MONO 800',
    shortLabel: '800',
    cssFilter: 'grayscale(100%) contrast(122%) brightness(94%)',
    tintHue: 210,
    tintSaturation: 8,
    tintLightness: 42,
    tintOpacity: 0.18,
    grainOpacity: 0.18,
    vignetteOpacity: 0.32,
    leakHue: 210,
    leakOpacity: 0.04,
    swatch: 'linear-gradient(135deg, #151515 0 50%, #d8d5cd 50% 100%)',
  },
  {
    id: 'cine-gold',
    label: 'CINE GOLD',
    shortLabel: 'CINE',
    cssFilter: 'saturate(112%) contrast(112%) brightness(98%) hue-rotate(-8deg)',
    tintHue: 43,
    tintSaturation: 70,
    tintLightness: 56,
    tintOpacity: 0.16,
    grainOpacity: 0.10,
    vignetteOpacity: 0.22,
    leakHue: 36,
    leakOpacity: 0.18,
    swatch: 'linear-gradient(135deg, #1a1a1f 0 34%, #d69c28 34% 68%, #f8ead0 68% 100%)',
  },
  {
    id: 'signal-chrome',
    label: 'SIGNAL CHROME',
    shortLabel: 'SIG',
    cssFilter: 'saturate(150%) contrast(110%) brightness(101%) hue-rotate(12deg)',
    tintHue: 188,
    tintSaturation: 82,
    tintLightness: 50,
    tintOpacity: 0.13,
    grainOpacity: 0.08,
    vignetteOpacity: 0.18,
    leakHue: 320,
    leakOpacity: 0.12,
    swatch: 'linear-gradient(135deg, #00b8d4 0 45%, #f5f2ed 45% 55%, #ff4f8b 55% 100%)',
  },
]

function getFilmPreset(id: FilmPresetId) {
  return FILM_PRESETS.find(preset => preset.id === id) ?? FILM_PRESETS[0]
}

function combineFilters(...filters: Array<string | undefined>) {
  const activeFilters = filters.filter((filter): filter is string => Boolean(filter && filter !== 'none'))
  return activeFilters.length ? activeFilters.join(' ') : 'none'
}

function getMoodVisualSettings({
  valenceArousal,
  songMedianValenceArousal,
  songPersonality,
  bpm,
  lyricColorHue,
  currentChordName,
  isChorus,
  vocalIntensity,
}: {
  valenceArousal: { v: number; a: number } | null
  songMedianValenceArousal: { v: number; a: number } | null
  songPersonality: { hue: number; strength: number } | null
  bpm: number
  lyricColorHue: number | null
  currentChordName: string
  isChorus: boolean
  vocalIntensity: number
}): MoodVisualSettings {
  const effectiveVA = valenceArousal ?? songMedianValenceArousal
  const arousal = effectiveVA?.a ?? 0
  const valence = effectiveVA?.v ?? 0
  const chordHue = getChordHue(currentChordName)
  const chorusBoost = isChorus ? 0.08 : 0
  const vocalBoost = Math.min(0.12, vocalIntensity * 0.12)
  const bpmFactor = bpm > 0 ? Math.min(1, Math.max(0, (bpm - 45) / 95)) : 0
  const energyLevel = effectiveVA
    ? Math.max(0, arousal)
    : (songPersonality?.strength ?? 0.20) * 1.0

  if (songPersonality) {
    const { hue: pHue, strength: pStr } = songPersonality
    const isWarm = pHue < 100 || pHue > 300
    const tintHue = lyricColorHue !== null ? lyricColorHue : (chordHue ?? pHue)
    const tintSaturation = Math.round(68 + vocalIntensity * 14)
    const tintBase = Math.min(0.30, pStr + bpmFactor * 0.04 + energyLevel * 0.03)
    const tintOpacity = lyricColorHue !== null
      ? Math.max(tintBase + chorusBoost + vocalBoost, 0.22)
      : Math.min(0.42, tintBase + chorusBoost + vocalBoost)
    const hueRotate = isWarm
      ? Math.round(-pStr * 35 - energyLevel * 12)
      : Math.round(pStr * 35 + energyLevel * 8)
    const saturate = Math.min(190, Math.round(85 + energyLevel * 70 + bpmFactor * 40 + vocalIntensity * 28))
    const contrast = Math.round(100 + bpmFactor * 12 + energyLevel * 5 + vocalIntensity * 8)
    const brightness = Math.round(98 + valence * 4)

    return {
      canvasFilter: `hue-rotate(${hueRotate}deg) saturate(${saturate}%) contrast(${contrast}%) brightness(${brightness}%)`,
      tintHue,
      tintSaturation,
      tintLightness: 52,
      tintOpacity,
    }
  }

  const hasData = Boolean(effectiveVA) || bpm > 0
  const energyFactor = Math.min(1, bpmFactor + Math.max(0, arousal) * 0.7)
  const hueRotate = Math.round((-25 + (1 - (valence + 1) / 2) * 65) - energyFactor * 40)
  const saturate = Math.min(260, Math.round(55 + ((arousal + 1) / 2) * 130 + energyFactor * 80))
  const contrast = Math.round(100 + energyFactor * 20)
  const brightness = Math.round(96 + ((valence + 1) / 2) * 9 - Math.max(0, -arousal) * 6)
  const baseHue = 45 + (1 - (valence + 1) / 2) * 175
  const redPull = Math.min(0.9, energyFactor * 0.75 + Math.max(0, arousal) * 0.2)
  const moodHue = Math.round(baseHue * (1 - redPull) + 5 * redPull)
  const satTint = Math.min(92, Math.round(18 + ((arousal + 1) / 2) * 52 + energyFactor * 30))
  const baseOpacity = effectiveVA
    ? Math.max(0.05, 0.04 + Math.abs(valence) * 0.12 + Math.abs(arousal) * 0.10)
    : bpmFactor * 0.10
  const moodOpacity = Math.min(0.42, baseOpacity + energyFactor * 0.16)
  const tintHue = lyricColorHue !== null ? lyricColorHue : (chordHue ?? moodHue)
  const tintSaturation = lyricColorHue !== null ? 80 : satTint
  const tintOpacity = lyricColorHue !== null
    ? Math.max(Math.min(0.48, moodOpacity + chorusBoost + vocalBoost), 0.30)
    : Math.min(0.48, moodOpacity + chorusBoost + vocalBoost)

  return {
    canvasFilter: hasData
      ? `hue-rotate(${hueRotate}deg) saturate(${saturate}%) contrast(${contrast}%) brightness(${brightness}%)`
      : 'none',
    tintHue,
    tintSaturation,
    tintLightness: 54,
    tintOpacity,
  }
}

// Each preset song has a distinct color identity.
// hue = tint hue (0-360°), strength = base opacity (0-1)
// This is the reliable fallback when TextAlive VA API returns null.
const SONG_PERSONALITIES: Record<string, { hue: number; strength: number }> = {
  'E2i3': { hue: 215, strength: 0.24 }, // TAKEOVER: cool blue
  '6W2N': { hue: 200, strength: 0.14 }, // こたえて: cool blue
  'zoqO': { hue: 228, strength: 0.13 }, // アフター・ザ・カーテン: deep blue
  'B3yJ': { hue: 32,  strength: 0.20 }, // 世界最後の音楽隊: amber
  'QBdL': { hue: 188, strength: 0.16 }, // トリツクロジー: teal
}

const PRESET_SONG_TITLES: Record<string, string> = {
  PNpQ: 'シャッターチャンス',
  E2i3: 'TAKEOVER',
  '6W2N': 'こたえて',
  zoqO: 'アフター・ザ・カーテン',
  B3yJ: '世界最後の音楽隊',
  QBdL: 'トリツクロジー',
}

const CAMERA_OFF_STYLE_PRESETS: readonly { id: CameraOffVisualMode; label: string }[] = [
  { id: 'shutter-mv', label: 'SHUTTER MV' },
  { id: 'film-studio', label: 'FILM STUDIO' },
  { id: 'signal-pop', label: 'SIGNAL POP' },
]
const APERTURE_BLADE_INDICES = Array.from({ length: 7 }, (_, index) => index)
const MV_TIMELINE_INDICES = Array.from({ length: 12 }, (_, index) => index)
const VOCAL_METER_INDICES = Array.from({ length: 5 }, (_, index) => index)

const INTERACTION_LABELS: Record<CameraOffVisualMode, { tap: string; press: string; drag: string }> = {
  classic: { tap: 'TAP', press: 'HOLD', drag: 'DRAG' },
  'shutter-mv': { tap: 'SHUTTER RING', press: 'EXPOSE HOLD', drag: 'FILM ADVANCE' },
  'film-studio': { tap: 'BURN FRAME', press: 'DEVELOP TANK', drag: 'WIPE DEVELOP' },
  'signal-pop': { tap: 'WAVE BURST', press: 'EXPOSURE METER', drag: 'LIGHT LEAK' },
}

interface CameraOffInteractionView extends CameraOffInteractionSnapshot {
  id: number
}

interface CameraOffInteractionSegment {
  x: number
  y: number
  angle: number
  length: number
}

function getSongPersonality(url: string) {
  for (const [id, p] of Object.entries(SONG_PERSONALITIES)) {
    if (url.includes(id)) return p
  }
  return null
}

function getPresetSongTitle(url: string) {
  for (const [id, title] of Object.entries(PRESET_SONG_TITLES)) {
    if (url.includes(id)) return title
  }
  return ''
}

function findShutterTrigger(text: string) {
  const normalizedText = normalizeText(text)

  return LYRIC_TRIGGERS.find(trigger =>
    trigger.words.some(word => normalizedText.includes(normalizeText(word))),
  )
}

function getEffectDuration(effect: ShutterEffect): number {
  switch (effect) {
    case 'finder':       return 650
    case 'focus-zoom':   return 520
    case 'blur-to-clear': return 650
    case 'strobe':       return 370
    case 'snap':         return 370
    case 'frame':        return 420
    case 'light-leak':   return 520
    case 'sound-wave':   return 560
    case 'stage-curtain': return 620
    case 'speed-lines':  return 460
    case 'answer-scan':  return 560
    case 'glitch':       return 580
    case 'noise':        return 340
    default:             return 0
  }
}

function getBeatDurationMs(bpm: number, multiplier = 1) {
  return bpm > 0 ? 60000 / (bpm * multiplier) : 1000 / multiplier
}

function getCameraOffStudioScene({
  isChorus,
  chorusProgress,
  vocalIntensity,
  word,
}: {
  isChorus: boolean
  chorusProgress: number
  vocalIntensity: number
  word: string
}): CameraOffStudioScene {
  if (isChorus) return 'chorus'

  const normalizedWord = normalizeText(word)
  const hasShutterWord = ['シャッター', 'しゃったー', 'チャンス', '瞬間', '切り取り', '切り取'].some(keyword =>
    normalizedWord.includes(normalizeText(keyword)),
  )

  if (hasShutterWord || chorusProgress > 0.72 || vocalIntensity > 0.58) return 'build'

  return 'verse'
}

function getWeightedTextLength(text: string) {
  return Array.from(text).reduce((length, char) => length + (char.charCodeAt(0) > 255 ? 1 : 0.56), 0)
}

function getMvTypeSize(text: string, layer: 'front' | 'back') {
  const weightedLength = Math.max(1, getWeightedTextLength(text))
  const baseVw = layer === 'front' ? 10.2 : 13
  const baseMax = layer === 'front' ? 7.4 : 9
  const targetLength = layer === 'front' ? 7 : 11
  const scale = Math.min(1, Math.max(0.42, targetLength / weightedLength))

  return `clamp(${layer === 'front' ? 1.35 : 1.8}rem, ${(baseVw * scale).toFixed(2)}vw, ${(baseMax * scale).toFixed(2)}rem)`
}

function isShutterChanceSong(songUrl: string, songTitle: string) {
  return songUrl.includes('PNpQ') || songTitle.includes('シャッターチャンス')
}

function getCameraOffStudioPalette({
  songUrl,
  songTitle,
  lyricColorHue,
  currentChordName,
  songPersonality,
  bpm,
  vocalIntensity,
}: {
  songUrl: string
  songTitle: string
  lyricColorHue: number | null
  currentChordName: string
  songPersonality: { hue: number; strength: number } | null
  bpm: number
  vocalIntensity: number
}) {
  if (isShutterChanceSong(songUrl, songTitle)) {
    return {
      leftHue: 190,
      rightHue: 48,
      accentHue: 190,
      textPrimaryHue: 48,
      textSecondaryHue: 190,
      saturation: 78,
      leftLightness: 81,
      rightLightness: 66,
    }
  }

  const baseHue = lyricColorHue ?? getChordHue(currentChordName) ?? songPersonality?.hue ?? 205
  const bpmDrive = bpm > 0 ? Math.min(1, Math.max(0, (bpm - 82) / 78)) : (songPersonality?.strength ?? 0.18) * 2
  const energy = Math.min(1, Math.max(bpmDrive, vocalIntensity))
  const hueSpread = 22 + energy * 54
  const saturation = Math.round(46 + energy * 38)
  const leftLightness = Math.round(82 - energy * 12)
  const rightLightness = Math.round(74 - energy * 8)

  return {
    leftHue: Math.round((baseHue + 360 - hueSpread * 0.32) % 360),
    rightHue: Math.round((baseHue + hueSpread) % 360),
    accentHue: Math.round((baseHue + (energy > 0.62 ? 118 : 36)) % 360),
    textPrimaryHue: Math.round((baseHue + (energy > 0.62 ? 118 : 24)) % 360),
    textSecondaryHue: Math.round(baseHue),
    saturation,
    leftLightness,
    rightLightness,
  }
}

function formatSpeed(bpm: number) {
  const speed = bpm > 0 ? Math.max(60, Math.round(bpm * 2)) : 125
  return `1/${speed}`
}

function splitPhraseByWord(phrase: string, word: string) {
  if (!phrase) {
    return { before: '', active: '', after: '' }
  }

  if (!word) {
    return { before: '', active: '', after: phrase }
  }

  const index = phrase.indexOf(word)
  if (index < 0) {
    return { before: '', active: phrase, after: '' }
  }

  return {
    before: phrase.slice(0, index),
    active: phrase.slice(index, index + word.length),
    after: phrase.slice(index + word.length),
  }
}

function getInteractionSegments(points?: { x: number; y: number }[]): CameraOffInteractionSegment[] {
  if (!points || points.length < 2) return []

  return points.slice(1).map((point, index) => {
    const previous = points[index]
    const dx = point.x - previous.x
    const dy = point.y - previous.y

    return {
      x: (previous.x + point.x) / 2,
      y: (previous.y + point.y) / 2,
      angle: Math.atan2(dy, dx) * 180 / Math.PI,
      length: Math.hypot(dx, dy),
    }
  })
}

function getDragPoints(start: { x: number; y: number }, end: { x: number; y: number }) {
  const steps = 9

  return Array.from({ length: steps }, (_, index) => {
    const t = index / (steps - 1)
    const wave = Math.sin(t * Math.PI) * 0.012
    const dx = end.x - start.x
    const dy = end.y - start.y
    const distance = Math.hypot(dx, dy) || 1

    return {
      x: start.x + dx * t - (dy / distance) * wave,
      y: start.y + dy * t + (dx / distance) * wave,
    }
  })
}

const CameraBackdrop = memo(function CameraBackdrop({
  enabled,
  facingMode,
  videoRef,
  bpm,
  songTitle,
  phrase,
  word,
  visualMode,
  currentChordName,
  isChorus,
  chorusProgress,
  vocalIntensity,
  lyricColorHue,
  studioScene,
  songUrl,
  songPersonality,
  interaction,
}: {
  enabled: boolean
  facingMode: 'user' | 'environment'
  videoRef: React.RefObject<HTMLVideoElement>
  bpm: number
  songTitle: string
  phrase: string
  word: string
  visualMode: CameraOffVisualMode
  currentChordName: string
  isChorus: boolean
  chorusProgress: number
  vocalIntensity: number
  lyricColorHue: number | null
  studioScene: CameraOffStudioScene
  songUrl: string
  songPersonality: { hue: number; strength: number } | null
  interaction: CameraOffInteractionView | null
}) {
  if (enabled) {
    return (
      <video
        ref={videoRef}
        muted
        playsInline
        className={`absolute inset-0 h-full w-full object-cover ${
          facingMode === 'user' ? 'scale-x-[-1]' : ''
        }`}
      />
    )
  }

  if (visualMode === 'classic') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,#edfdf2_0%,#b8efff_48%,#fff0a0_100%)]">
        <div className="absolute left-[12%] top-[32%] h-[14%] max-h-18 min-h-12 w-[21%] max-w-18 rotate-[-10deg] border-[6px] border-cyan/55 bg-cyan/10 opacity-70 shadow-sketch sm:left-[10%] sm:top-[25%] sm:h-[18%] sm:max-h-24 sm:w-[24%] sm:max-w-24 sm:border-[8px]" />
        <div className="absolute right-[5%] top-[31%] h-[11%] max-h-14 min-h-11 w-[36%] max-w-30 rotate-[8deg] border-[6px] border-yellow/65 bg-yellow/14 opacity-75 shadow-sketch sm:top-[26%] sm:h-[13%] sm:max-h-18 sm:max-w-36 sm:border-[7px]" />
        <div className="absolute bottom-[13%] left-[8%] h-[21%] max-h-24 min-h-18 w-[47%] max-w-40 rotate-[3deg] border-[6px] border-ink/10 bg-white/14 opacity-65 shadow-sketch sm:bottom-[12%] sm:h-[23%] sm:max-h-28 sm:max-w-44 sm:border-[7px]" />
        <div className="absolute bottom-[15%] right-[10%] h-[15%] max-h-18 min-h-12 w-[20%] max-w-18 rotate-[-8deg] rounded-full border-[8px] border-cyan/35 bg-yellow/28 opacity-75 sm:bottom-[14%] sm:h-[16%] sm:max-h-20 sm:max-w-20 sm:border-[9px]" />
        <div className="sketch-lines" aria-hidden="true" />
      </div>
    )
  }

  const chordHue = lyricColorHue ?? getChordHue(currentChordName) ?? 190
  const interactionSegments = interaction?.kind === 'drag-trail'
    ? getInteractionSegments(interaction.points)
    : []
  const beatMs = Math.round(getBeatDurationMs(bpm))
  const phraseText = phrase || songTitle || 'Lyric Lens'
  const activeText = word || phraseText
  const energyBoost = visualMode === 'signal-pop' ? 0.22 : visualMode === 'film-studio' ? -0.04 : 0
  const energy = Math.max(0.12, Math.min(1, vocalIntensity + energyBoost))
  const apertureRotation = studioScene === 'chorus' ? 18 : studioScene === 'build' ? 9 : 0
  const palette = getCameraOffStudioPalette({
    songUrl,
    songTitle,
    lyricColorHue,
    currentChordName,
    songPersonality,
    bpm,
    vocalIntensity,
  })

  return (
    <div
      className={`camera-off-studio camera-off-studio-${visualMode} camera-off-studio-${studioScene} absolute inset-0 overflow-hidden`}
      style={{
        ['--mv-hue' as string]: chordHue,
        ['--mv-energy' as string]: energy,
        ['--beat-ms' as string]: `${beatMs}ms`,
        ['--chorus-progress' as string]: chorusProgress,
        ['--aperture-rotation' as string]: `${apertureRotation}deg`,
        ['--mv-left-hue' as string]: palette.leftHue,
        ['--mv-right-hue' as string]: palette.rightHue,
        ['--mv-accent-hue' as string]: palette.accentHue,
        ['--mv-text-primary-hue' as string]: palette.textPrimaryHue,
        ['--mv-text-secondary-hue' as string]: palette.textSecondaryHue,
        ['--mv-saturation' as string]: `${palette.saturation}%`,
        ['--mv-left-lightness' as string]: `${palette.leftLightness}%`,
        ['--mv-right-lightness' as string]: `${palette.rightLightness}%`,
        ['--mv-front-size' as string]: getMvTypeSize(activeText, 'front'),
        ['--mv-back-size' as string]: getMvTypeSize(phraseText, 'back'),
      }}
    >
      <div className="mv-contact-sheet" aria-hidden="true" />
      <div className="mv-card-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="mv-doodle mv-doodle-left" aria-hidden="true">↝</div>
      <div className="mv-doodle mv-doodle-right" aria-hidden="true">↜</div>
      <div className="mv-stage-frame" />
      <div className="mv-aperture" aria-hidden="true">
        {APERTURE_BLADE_INDICES.map(index => (
          <span key={index} style={{ transform: `rotate(${index * 51.43}deg)` }} />
        ))}
      </div>
      <div className="mv-shutter-gate" aria-hidden="true" />
      <div className="mv-film-strip mv-film-strip-left" aria-hidden="true" />
      <div className="mv-film-strip mv-film-strip-right" aria-hidden="true" />
      <div className="mv-light-sweep" aria-hidden="true" />
      <div className="mv-typography mv-typography-back" aria-hidden="true">{phraseText}</div>
      <div className="mv-typography mv-typography-front" aria-hidden="true">{activeText}</div>
      <div className="mv-timeline" aria-hidden="true">
        {MV_TIMELINE_INDICES.map(index => (
          <span
            key={index}
            style={{
              height: `${22 + ((index * 17) % 48) + energy * 28}%`,
              animationDelay: `${index * 42}ms`,
            }}
          />
        ))}
      </div>
      {isChorus && (
        <>
          <div className="mv-chorus-matte" aria-hidden="true" />
          <div className="mv-chorus-label" aria-hidden="true">SHUTTER CHANCE</div>
        </>
      )}
      {interaction && (
        <div
          key={interaction.id}
          className={`mv-touch mv-touch-${visualMode} mv-touch-${interaction.kind}`}
          style={{
            ['--touch-x' as string]: `${interaction.x * 100}%`,
            ['--touch-y' as string]: `${interaction.y * 100}%`,
            ['--touch-hue' as string]: interaction.hue ?? chordHue,
            ['--touch-intensity' as string]: interaction.intensity,
          }}
          aria-hidden="true"
        >
          {(interaction.kind === 'tap-burst' || interaction.kind === 'press-arming' || interaction.kind === 'press-charge' || interaction.kind === 'drag-trail') && (
            <span className="mv-touch-exposure" />
          )}
          {interaction.kind === 'drag-trail' && interactionSegments.map((segment, index) => (
            <span
              key={`${interaction.id}-segment-${index}`}
              className="mv-touch-segment"
              style={{
                ['--touch-segment-x' as string]: `${segment.x * 100}%`,
                ['--touch-segment-y' as string]: `${segment.y * 100}%`,
                ['--touch-segment-angle' as string]: `${segment.angle}deg`,
                ['--touch-segment-length' as string]: segment.length,
                ['--touch-segment-index' as string]: index,
              }}
            />
          ))}
          {interaction.kind === 'drag-trail' && interaction.points?.map((point, index) => (
            <span
              key={`${interaction.id}-${index}`}
              className="mv-touch-point"
              style={{
                ['--touch-point-x' as string]: `${point.x * 100}%`,
                ['--touch-point-y' as string]: `${point.y * 100}%`,
                ['--touch-point-index' as string]: index,
              }}
            />
          ))}
        </div>
      )}
      <div className="sketch-lines" aria-hidden="true" />
    </div>
  )
})

const ViewfinderOverlay = memo(function ViewfinderOverlay({
  afPulse,
  bpm,
  songTitle,
  shotCount,
  currentChordName,
  isChorus,
  vocalIntensity,
}: {
  afPulse: number
  bpm: number
  songTitle: string
  shotCount: number
  currentChordName: string
  isChorus: boolean
  vocalIntensity: number
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute inset-x-5 top-4 flex items-center justify-between gap-3 font-display text-base font-black text-white/86 [text-shadow:0_2px_10px_rgba(0,0,0,0.52)] sm:inset-x-7 sm:text-xl">
        <span>SS {formatSpeed(bpm)}</span>
        <span>f/1.8&nbsp;&nbsp;ISO AUTO</span>
      </div>

      <div className="absolute inset-x-5 bottom-4 flex items-center justify-between gap-3 font-display text-base font-black text-white/86 [text-shadow:0_2px_10px_rgba(0,0,0,0.52)] sm:inset-x-7 sm:text-lg">
        <span className="max-w-[52%] truncate">{songTitle || 'Lyric Lens'}</span>
        <span className="text-yellow">● {String(shotCount).padStart(4, '0')}</span>
      </div>

      <div className="absolute right-5 top-14 grid min-w-24 gap-1 border border-ink/25 bg-white/58 px-2 py-1 font-display text-[0.72rem] font-black leading-tight text-ink/70 sm:right-7 sm:top-16 sm:text-sm">
        <span>{isChorus ? 'CHORUS' : 'VERSE'}</span>
        <span>{currentChordName || '--'}</span>
        <span>VOX {String(Math.round(vocalIntensity * 99)).padStart(2, '0')}</span>
      </div>

      <motion.div
        key={afPulse}
        className={`absolute inset-x-[9%] bottom-[15%] top-[22%] border-2 border-dashed sm:inset-x-[9%] sm:bottom-[12%] sm:top-[13%] ${
          isChorus ? 'border-yellow/70' : 'border-cyan/50'
        }`}
        animate={{ scale: [1, 0.985, 1] }}
        transition={{ duration: 0.34, ease: 'easeOut' }}
      >
        <div className="grid-lines" />
      </motion.div>

      <div className="corner corner-tl" />
      <div className="corner corner-tr" />
      <div className="corner corner-bl" />
      <div className="corner corner-br" />

      <div key={`af-${afPulse}`} className="af-point">
        <span />
      </div>
    </div>
  )
})

const LyricDisplay = memo(function LyricDisplay({ phrase, word }: { phrase: string; word: string }) {
  if (!phrase) {
    return null
  }

  const segments = splitPhraseByWord(phrase, word)

  return (
    <div className="pointer-events-none absolute inset-x-5 bottom-[22%] z-30 flex justify-center sm:bottom-[24%]">
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-[min(920px,92vw)] rounded-md border border-white/16 bg-[rgba(26,26,31,0.68)] px-5 py-3 text-center shadow-[0_18px_48px_rgba(0,0,0,0.2)] sm:px-8 sm:py-4"
      >
        <p className="text-balance text-2xl font-black leading-snug text-cyan sm:text-4xl lg:text-5xl">
          <span className="opacity-60">{segments.before}</span>
          <span className="text-white opacity-100">{segments.active}</span>
          <span className="opacity-60">{segments.after}</span>
        </p>
      </motion.div>
    </div>
  )
})

const ShutterCurtain = memo(function ShutterCurtain({ phase, flashKey }: { phase: CurtainPhase; flashKey: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      <div className={`curtain curtain-top ${phase}`} />
      <div className={`curtain curtain-bottom ${phase}`} />
      <div key={flashKey} className="absolute inset-0 animate-flashFade bg-white" />
    </div>
  )
})

const CountdownOverlay = memo(function CountdownOverlay({ value }: { value: number | null }) {
  return (
    <AnimatePresence>
      {value !== null && (
        <motion.div
          key={value}
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-[45] grid place-items-center"
          initial={{ opacity: 0, scale: 0.72 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.18 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="grid h-40 w-40 place-items-center rounded-full border-[6px] border-ink bg-white/84 font-display text-8xl font-black leading-none text-yellow shadow-sketch backdrop-blur sm:h-52 sm:w-52 sm:text-[9rem] md:h-60 md:w-60 md:text-[11rem]">
            {value}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

const EffectOverlay = memo(function EffectOverlay({
  effect,
  effectKey,
}: {
  effect: ShutterEffect | null
  effectKey: number
}) {
  if (!effect || effect === 'default') return null

  const base = 'pointer-events-none absolute inset-0 z-[46]'

  if (effect === 'finder') {
    return (
      <div key={effectKey} className={`${base} animate-[finderIn_0.55s_ease-out]`}>
        <div className="absolute inset-[3.5%] border border-cyan/50" />
        <div className="absolute inset-[3.5%]">
          <div className="grid-lines opacity-50" />
        </div>
        <div className="corner corner-tl" style={{ left: '11%', top: '9%' }} />
        <div className="corner corner-tr" style={{ right: '11%', top: '9%' }} />
        <div className="corner corner-bl" style={{ left: '11%', bottom: '9%' }} />
        <div className="corner corner-br" style={{ right: '11%', bottom: '9%' }} />
        <div className="absolute left-1/2 top-[44%] h-24 w-24 -translate-x-1/2 -translate-y-1/2 animate-[afLock_0.42s_ease-out] border-2 border-yellow">
          <div className="absolute bottom-3 left-1/2 top-3 w-px -translate-x-1/2 bg-yellow" />
          <div className="absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-yellow" />
        </div>
      </div>
    )
  }

  if (effect === 'blur-to-clear') {
    return (
      <motion.div
        key={effectKey}
        className={base}
        initial={{ backdropFilter: 'blur(18px)', backgroundColor: 'rgba(255,255,255,0.06)' }}
        animate={{ backdropFilter: 'blur(0px)',  backgroundColor: 'rgba(255,255,255,0)' }}
        transition={{ duration: 0.65, ease: 'easeOut' }}
      />
    )
  }

  if (effect === 'strobe') {
    return <div key={effectKey} className={`${base} animate-[strobeFlash_0.37s_linear]`} />
  }

  if (effect === 'snap') {
    return <div key={effectKey} className={`${base} animate-[snapDevelop_0.37s_ease-out]`} />
  }

  if (effect === 'frame') {
    return <div key={effectKey} className={`${base} animate-[frameConstrict_0.42s_ease-out]`} />
  }

  if (effect === 'light-leak') {
    return (
      <div key={effectKey} className={`${base} overflow-hidden animate-[lightLeak_0.52s_ease-out]`}>
        <div className="absolute -left-[18%] top-[-8%] h-[62%] w-[48%] rotate-12 bg-cyan/28 blur-[18px]" />
        <div className="absolute right-[-10%] top-[8%] h-[76%] w-[42%] -rotate-6 bg-yellow/34 blur-[20px]" />
        <div className="absolute inset-x-0 top-[45%] h-1 bg-white/70" />
      </div>
    )
  }

  if (effect === 'sound-wave') {
    return (
      <div key={effectKey} className={`${base} overflow-hidden animate-[soundWave_0.56s_ease-out]`}>
        <div className="absolute inset-x-[6%] top-[28%] h-px bg-cyan/70" />
        <div className="absolute inset-x-[10%] top-[40%] h-1 bg-yellow/65" />
        <div className="absolute inset-x-[4%] top-[53%] h-px bg-white/70" />
        <div className="absolute inset-x-[16%] top-[66%] h-1 bg-cyan/55" />
        {Array.from({ length: 11 }).map((_, index) => (
          <span
            key={index}
            className="absolute bottom-[22%] w-1 rounded-full bg-ink/42"
            style={{
              left: `${12 + index * 7.5}%`,
              height: `${18 + (index % 4) * 18}%`,
              animation: `meterKick 0.42s ease-out ${index * 0.018}s both`,
            }}
          />
        ))}
      </div>
    )
  }

  if (effect === 'stage-curtain') {
    return (
      <div key={effectKey} className={`${base} overflow-hidden animate-[stageCurtain_0.62s_ease-out]`}>
        <div className="absolute inset-y-0 left-0 w-[36%] bg-ink/48" />
        <div className="absolute inset-y-0 right-0 w-[36%] bg-ink/48" />
        <div className="absolute inset-x-0 top-0 h-[12%] bg-yellow/28" />
        <div className="absolute inset-x-[12%] top-[14%] border-t-2 border-dashed border-cyan/60" />
      </div>
    )
  }

  if (effect === 'speed-lines') {
    return (
      <div key={effectKey} className={`${base} overflow-hidden animate-[speedLines_0.46s_ease-out]`}>
        {Array.from({ length: 9 }).map((_, index) => (
          <span
            key={index}
            className="absolute h-1 w-[46%] -rotate-12 bg-ink/28"
            style={{
              left: `${-10 + index * 9}%`,
              top: `${16 + (index % 5) * 15}%`,
            }}
          />
        ))}
        <div className="absolute inset-[9%] border-4 border-yellow/60" />
      </div>
    )
  }

  if (effect === 'answer-scan') {
    return (
      <div key={effectKey} className={`${base} overflow-hidden animate-[answerScan_0.56s_ease-out]`}>
        <div className="absolute inset-x-[8%] top-[22%] h-px bg-cyan/75" />
        <div className="absolute inset-x-[8%] top-[50%] h-1 bg-white/80" />
        <div className="absolute inset-x-[8%] top-[72%] h-px bg-cyan/75" />
        <div className="absolute left-[18%] top-[29%] h-[42%] w-[64%] border-2 border-dashed border-yellow/70" />
        <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 border-2 border-cyan/90">
          <div className="absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-cyan/80" />
          <div className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-cyan/80" />
        </div>
      </div>
    )
  }

  if (effect === 'noise') {
    return (
      <div key={effectKey} className={`${base} overflow-hidden`}
        style={{ animation: 'noiseFlicker 0.34s linear both' }}>
        {/* Fine static texture */}
        <div className="absolute inset-0" style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 1px, transparent 1px, transparent 3px),' +
            'repeating-linear-gradient(90deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px, transparent 1px, transparent 3px)',
          backgroundSize: '3px 3px',
        }} />
        {/* Desaturation + contrast backdrop */}
        <div className="absolute inset-0" style={{
          backdropFilter: 'contrast(160%) saturate(15%) brightness(112%)',
          WebkitBackdropFilter: 'contrast(160%) saturate(15%) brightness(112%)',
          opacity: 0.55,
        }} />
        {/* Horizontal scan bars */}
        {[8, 24, 43, 59, 74, 88].map((pct, i) => (
          <div key={i} className="absolute inset-x-0" style={{
            top: `${pct}%`,
            height: `${1 + (i % 3)}px`,
            backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.72)' : 'rgba(160,200,255,0.55)',
            animation: `noiseScan 0.34s linear ${i * 0.016}s both`,
          }} />
        ))}
      </div>
    )
  }

  if (effect === 'glitch') {
    return (
      <div key={effectKey} className={`${base} overflow-hidden`}
        style={{ animation: 'glitchFrame 0.58s ease-out both' }}>
        {/* Scanlines */}
        <div className="absolute inset-0" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)',
        }} />
        {/* RGB split: red channel right */}
        <div className="absolute inset-0" style={{
          backgroundColor: 'rgba(255,0,80,0.22)',
          mixBlendMode: 'screen',
          animation: 'glitchR 0.58s ease-out both',
        }} />
        {/* RGB split: blue channel left */}
        <div className="absolute inset-0" style={{
          backgroundColor: 'rgba(0,200,255,0.22)',
          mixBlendMode: 'screen',
          animation: 'glitchB 0.58s ease-out both',
        }} />
        {/* Noise bars */}
        {[14, 38, 56, 73, 88].map((pct, i) => (
          <div key={i} className="absolute inset-x-0" style={{
            top: `${pct}%`,
            height: `${2 + (i % 3) * 2}px`,
            backgroundColor: i % 2 === 0 ? 'rgba(0,220,255,0.55)' : 'rgba(255,255,255,0.45)',
            animation: `glitchBar 0.58s ease-out ${i * 0.04}s both`,
          }} />
        ))}
        {/* Digital frame corners */}
        <div className="absolute left-[8%] top-[8%] h-10 w-10 border-l-2 border-t-2 border-cyan/80" />
        <div className="absolute right-[8%] top-[8%] h-10 w-10 border-r-2 border-t-2 border-cyan/80" />
        <div className="absolute bottom-[8%] left-[8%] h-10 w-10 border-b-2 border-l-2 border-cyan/80" />
        <div className="absolute bottom-[8%] right-[8%] h-10 w-10 border-b-2 border-r-2 border-cyan/80" />
      </div>
    )
  }

  return null
})

const MoodColorOverlay = memo(function MoodColorOverlay({
  tintHue,
  tintSaturation,
  tintLightness,
  tintOpacity,
}: {
  tintHue: number
  tintSaturation: number
  tintLightness: number
  tintOpacity: number
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      style={{
        backgroundColor: `hsl(${tintHue}deg ${tintSaturation}% ${tintLightness}%)`,
        opacity: tintOpacity,
        transition: 'background-color 0.4s ease-in-out, opacity 0.4s ease-in-out',
      }}
      aria-hidden
    />
  )
})

const FilmLookOverlay = memo(function FilmLookOverlay({ film }: { film: FilmPreset }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[11] overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0 transition-opacity"
        style={{
          backgroundColor: `hsl(${film.tintHue}deg ${film.tintSaturation}% ${film.tintLightness}%)`,
          mixBlendMode: film.id === 'mono-800' ? 'saturation' : 'multiply',
          opacity: film.tintOpacity,
        }}
      />
      <div
        className="film-leak"
        style={{
          ['--film-leak-hue' as string]: film.leakHue,
          ['--film-leak-opacity' as string]: film.leakOpacity,
        }}
      />
      <div
        className="film-grain"
        style={{ ['--film-grain-opacity' as string]: film.grainOpacity }}
      />
      <div
        className="film-vignette"
        style={{ ['--film-vignette-opacity' as string]: film.vignetteOpacity }}
      />
    </div>
  )
})

const MusicSignalOverlay = memo(function MusicSignalOverlay({
  currentChordName,
  isChorus,
  chorusProgress,
  vocalIntensity,
}: {
  currentChordName: string
  isChorus: boolean
  chorusProgress: number
  vocalIntensity: number
}) {
  const chordHue = getChordHue(currentChordName) ?? 190
  const meter = Math.max(0.06, vocalIntensity)

  return (
    <div className="pointer-events-none absolute inset-0 z-[19]" aria-hidden="true">
      {isChorus && (
        <>
          <div className="absolute inset-[4%] border-[6px] border-yellow/28" />
          <div
            className="absolute left-[4%] right-[4%] top-[4%] h-1 bg-yellow/80"
            style={{ transform: `scaleX(${Math.max(0.08, chorusProgress)})`, transformOrigin: 'left' }}
          />
        </>
      )}

      {currentChordName && (
        <div
          className="absolute bottom-[11%] left-[8%] h-1.5 w-[28%] max-w-56"
          style={{ backgroundColor: `hsl(${chordHue}deg 82% 54% / 0.72)` }}
        />
      )}

      <div className="absolute bottom-[16%] right-[7%] flex h-20 items-end gap-1">
        {VOCAL_METER_INDICES.map(index => {
          const threshold = (index + 1) / 5
          const opacity = meter >= threshold ? 0.82 : 0.22
          return (
            <span
              key={index}
              className="w-1.5 bg-white"
              style={{
                height: `${18 + index * 13}%`,
                opacity,
                boxShadow: meter >= threshold ? '0 0 12px rgba(245, 200, 66, 0.56)' : 'none',
              }}
            />
          )
        })}
      </div>
    </div>
  )
})

export default function PlayerView({ token, songUrl, songOptions, cameraDeviceId, onFinish }: PlayerViewProps) {
  const mediaRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const capturesRef = useRef<CaptureItem[]>([])
  const phraseRef = useRef('')
  const wordRef = useRef('')
  const songPositionRef = useRef(0)
  const songTitleRef = useRef('')
  const bpmRef = useRef(0)
  const chordNameRef = useRef('')
  const isChorusRef = useRef(false)
  const vocalIntensityRef = useRef(0)
  const isPlayingRef = useRef(false)
  const autoModeRef = useRef(true)
  const filterEnabledRef = useRef(true)
  const captureFilterRef = useRef<CaptureFilter | null>(null)
  const activeEffectRef = useRef<ShutterEffect | null>(null)
  const lastInteractionRef = useRef<CameraOffInteractionSnapshot | null>(null)
  const interactionStartRef = useRef<{
    pointerId: number
    x: number
    y: number
    lastX: number
    lastY: number
    lastPublishedAt: number
    startedAt: number
    longPressTimer?: number
    dragging: boolean
  } | null>(null)
  const lastAutoRef = useRef({ text: '', time: 0 })
  const shutterBusyRef = useRef(false)
  const countdownBusyRef = useRef(false)
  const countdownRunRef = useRef(0)
  const finishedRef = useRef(false)

  const [captures, setCaptures] = useState<CaptureItem[]>([])
  const [autoMode, setAutoMode] = useState(true)
  const [afPulse, setAfPulse] = useState(0)
  const [flashKey, setFlashKey] = useState(0)
  const [curtainPhase, setCurtainPhase] = useState<CurtainPhase>('idle')
  const [countdownValue, setCountdownValue] = useState<number | null>(null)
  const [activeEffect, setActiveEffect] = useState<ShutterEffect | null>(null)
  const [effectKey, setEffectKey] = useState(0)
  const [lyricColorHue, setLyricColorHue] = useState<number | null>(null)
  const [filterEnabled, setFilterEnabled] = useState(true)
  const [selectedFilmPresetId, setSelectedFilmPresetId] = useState<FilmPresetId>('mv-film')
  const [cameraOffVisualMode, setCameraOffVisualMode] = useState<CameraOffVisualMode>('shutter-mv')
  const [cameraOffInteraction, setCameraOffInteraction] = useState<CameraOffInteractionView | null>(null)
  const [canSwitchFacingCamera, setCanSwitchFacingCamera] = useState(false)
  const colorHueTimerRef = useRef<number | undefined>(undefined)
  const interactionClearTimerRef = useRef<number | undefined>(undefined)

  const camera = useCamera(cameraDeviceId)

  const songPersonality = useMemo(() => getSongPersonality(songUrl), [songUrl])
  const fallbackSongTitle = useMemo(() => getPresetSongTitle(songUrl), [songUrl])

  const onPhraseChange = useCallback((nextPhrase: string) => {
    if (nextPhrase) {
      setAfPulse(value => value + 1)
    }
  }, [])

  const appendCapture = useCallback((capture: CaptureItem) => {
    const nextCaptures = [...capturesRef.current, capture]
    capturesRef.current = nextCaptures
    setCaptures(nextCaptures)
    return nextCaptures
  }, [])

  const publishCameraOffInteraction = useCallback(
    (
      snapshot: Omit<CameraOffInteractionSnapshot, 'preset' | 'hue'> & {
        hue?: number
        points?: { x: number; y: number }[]
      },
    ) => {
      const nextSnapshot: CameraOffInteractionSnapshot = {
        kind: snapshot.kind,
        x: snapshot.x,
        y: snapshot.y,
        intensity: snapshot.intensity,
        preset: cameraOffVisualMode,
        hue: snapshot.hue ?? captureFilterRef.current?.tintHue ?? getChordHue(chordNameRef.current) ?? 190,
        points: snapshot.points,
      }

      lastInteractionRef.current = nextSnapshot
      window.clearTimeout(interactionClearTimerRef.current)
      setCameraOffInteraction({
        ...nextSnapshot,
        id: Date.now(),
      })
      interactionClearTimerRef.current = window.setTimeout(() => {
        setCameraOffInteraction(null)
      }, snapshot.kind === 'press-charge' ? 1900 : snapshot.kind === 'press-arming' ? 720 : snapshot.kind === 'drag-trail' ? 1350 : 1100)
    },
    [cameraOffVisualMode],
  )

  const handleShutter = useCallback(async (shutterEffect: ShutterEffect = activeEffectRef.current ?? 'default') => {
    if (shutterBusyRef.current) return

    shutterBusyRef.current = true
    const phraseSnapshot = phraseRef.current || wordRef.current || songTitleRef.current || 'Lyric Lens'
    const wordSnapshot = wordRef.current
    const songPositionSnapshot = songPositionRef.current
    const filterSnapshot = captureFilterRef.current
    const shouldUseFilteredFrame = Boolean(filterEnabledRef.current && filterSnapshot)
    const interactionSnapshot = camera.enabled ? null : lastInteractionRef.current
    const captureFilterSnapshot = filterSnapshot
      ? {
          ...filterSnapshot,
          cameraOffInteraction: interactionSnapshot ?? undefined,
          exportLongSide: camera.enabled ? 1600 : 1280,
        }
      : null
    const cameraOffBackdropFilter = !camera.enabled && captureFilterSnapshot
      ? {
          ...captureFilterSnapshot,
          canvasFilter: 'none',
          filmPresetId: undefined,
          filmPresetLabel: undefined,
          tintOpacity: 0,
          filmTintOpacity: 0,
          filmGrainOpacity: 0,
          filmVignetteOpacity: 0,
          filmLeakOpacity: 0,
        }
      : null
    navigator.vibrate?.(30)
    setAfPulse(value => value + 1)
    setCurtainPhase('closing')
    setFlashKey(value => value + 1)
    await wait(95)
    setCurtainPhase('opening')
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
    if (!camera.enabled) {
      await wait(110)
    }

    const frameNumber = capturesRef.current.length + 1
    const frameRect = frameRef.current?.getBoundingClientRect()
    const captureSize = frameRect ? { width: frameRect.width, height: frameRect.height } : undefined
    const videoElement = camera.enabled && videoRef.current ? videoRef.current : null
    const selectedFilter = shouldUseFilteredFrame ? captureFilterSnapshot : cameraOffBackdropFilter
    const selectedFrame = await captureFrameAsync(
      videoElement,
      phraseSnapshot,
      wordSnapshot,
      songTitleRef.current,
      frameNumber,
      captureSize,
      selectedFilter,
      camera.facingMode === 'user',
    )
    const captureId = `${Date.now()}-${frameNumber}`

    appendCapture({
      id: captureId,
      dataUrl: selectedFrame.dataUrl,
      rawDataUrl: shouldUseFilteredFrame ? undefined : selectedFrame.dataUrl,
      filteredDataUrl: shouldUseFilteredFrame ? selectedFrame.dataUrl : undefined,
      width: selectedFrame.width,
      height: selectedFrame.height,
      phrase: phraseSnapshot,
      timestamp: Date.now(),
      songPosition: songPositionSnapshot,
      songTitle: songTitleRef.current,
      bpm: bpmRef.current,
      chordName: chordNameRef.current,
      isChorus: isChorusRef.current,
      vocalIntensity: vocalIntensityRef.current,
      tintHue: captureFilterSnapshot?.tintHue,
      filmPresetId: shouldUseFilteredFrame ? captureFilterSnapshot?.filmPresetId : undefined,
      filmPresetLabel: shouldUseFilteredFrame ? captureFilterSnapshot?.filmPresetLabel : undefined,
      cameraOffVisualMode: camera.enabled ? undefined : cameraOffVisualMode,
      cameraOffInteraction: interactionSnapshot ?? undefined,
      shutterEffect,
      filterEnabledAtCapture: Boolean(shouldUseFilteredFrame),
    })

    await wait(130)
    setCurtainPhase('idle')
    shutterBusyRef.current = false
  }, [appendCapture, camera.enabled, camera.facingMode, cameraOffVisualMode])

  const cancelCountdown = useCallback(() => {
    countdownRunRef.current += 1
    countdownBusyRef.current = false
    setCountdownValue(null)
  }, [])

  const handleManualShutter = useCallback(() => {
    cancelCountdown()
    void handleShutter('default')
  }, [cancelCountdown, handleShutter])

  const handleTriggerShutter = useCallback(
    async (trigger: LyricTrigger, triggerText: string, triggerTime: number) => {
      if (shutterBusyRef.current || countdownBusyRef.current) return

      lastAutoRef.current = { text: triggerText, time: triggerTime }
      const runId = countdownRunRef.current + 1
      countdownRunRef.current = runId
      countdownBusyRef.current = true

      try {
        if (trigger.countdown?.steps.length) {
          const beatMs =
            getBeatDurationMs(bpmRef.current, trigger.countdown.bpmMultiplier) *
            (trigger.countdown.beatsPerStep ?? 1)
          const countdownStart = performance.now()

          for (const [index, step] of trigger.countdown.steps.entries()) {
            if (countdownRunRef.current !== runId) return
            setCountdownValue(step)
            setAfPulse(value => value + 1)
            await waitUntil(countdownStart + beatMs * (index + 1))
          }
        }

        if (countdownRunRef.current !== runId) return
        setCountdownValue(null)

        const effect = trigger.effect ?? 'default'
        if (effect && effect !== 'default') {
          setEffectKey(k => k + 1)
          setActiveEffect(effect)
          activeEffectRef.current = effect
          await wait(getEffectDuration(effect))
          if (countdownRunRef.current !== runId) return
        }

        await handleShutter(effect)
      } finally {
        if (countdownRunRef.current === runId) {
          setCountdownValue(null)
          setActiveEffect(null)
          activeEffectRef.current = null
          countdownBusyRef.current = false
        }
      }
    },
    [handleShutter],
  )

  const handleWordChange = useCallback(
    (nextWord: string, _prevWord: string, position: number) => {
      wordRef.current = nextWord
      songPositionRef.current = position

      // Color keyword detection: runs regardless of auto-mode so the tint always reacts
      if (nextWord) {
        const colorHue = findColorKeyword(nextWord)
        if (colorHue !== null) {
          window.clearTimeout(colorHueTimerRef.current)
          setLyricColorHue(colorHue)
          colorHueTimerRef.current = window.setTimeout(() => setLyricColorHue(null), 2200)
        }
      }

      if (!autoModeRef.current || !isPlayingRef.current || !nextWord) return

      const text = normalizeText(nextWord)
      const trigger = findShutterTrigger(text)
      if (!trigger) return

      const now = performance.now()
      if (lastAutoRef.current.text === text && now - lastAutoRef.current.time < 1600) return
      if (now - lastAutoRef.current.time < 900) return

      void handleTriggerShutter(trigger, text, now)
    },
    [handleTriggerShutter],
  )

  const {
    isLoaded,
    isPlaying,
    currentPhrase,
    currentWord,
    progress,
    songTitle,
    bpm,
    error,
    currentValenceArousal,
    songMedianValenceArousal,
    currentChordName,
    isChorus,
    chorusProgress,
    vocalIntensity,
    play,
    pause,
    seek,
    seekStart,
    seekEnd,
  } = useTextAlive(
    mediaRef,
    token,
    songUrl,
    songOptions,
    onPhraseChange,
    handleWordChange,
    position => {
      songPositionRef.current = position
    },
  )

  phraseRef.current = currentPhrase
  wordRef.current = currentWord
  const displaySongTitle = songTitle || fallbackSongTitle
  const cameraOffStudioScene = getCameraOffStudioScene({
    isChorus,
    chorusProgress,
    vocalIntensity,
    word: currentWord,
  })
  const cameraOffStudioPalette = useMemo(() => getCameraOffStudioPalette({
    songUrl,
    songTitle: displaySongTitle,
    lyricColorHue,
    currentChordName,
    songPersonality,
    bpm,
    vocalIntensity,
  }), [
    bpm,
    currentChordName,
    displaySongTitle,
    lyricColorHue,
    songPersonality,
    songUrl,
    vocalIntensity,
  ])

  songTitleRef.current = displaySongTitle
  bpmRef.current = bpm
  chordNameRef.current = currentChordName
  isChorusRef.current = isChorus
  vocalIntensityRef.current = vocalIntensity
  isPlayingRef.current = isPlaying
  autoModeRef.current = autoMode
  filterEnabledRef.current = filterEnabled
  activeEffectRef.current = activeEffect

  const selectedFilmPreset = useMemo(
    () => getFilmPreset(selectedFilmPresetId),
    [selectedFilmPresetId],
  )
  const captureFilter = useMemo<CaptureFilter>(() => {
    const visualSettings = getMoodVisualSettings({
      valenceArousal: currentValenceArousal,
      songMedianValenceArousal,
      songPersonality,
      bpm,
      lyricColorHue,
      currentChordName,
      isChorus,
      vocalIntensity,
    })

    return {
      canvasFilter: combineFilters(visualSettings.canvasFilter, selectedFilmPreset.cssFilter),
      filmPresetId: selectedFilmPreset.id,
      filmPresetLabel: selectedFilmPreset.label,
      filmCssFilter: selectedFilmPreset.cssFilter,
      filmTintHue: selectedFilmPreset.tintHue,
      filmTintSaturation: selectedFilmPreset.tintSaturation,
      filmTintLightness: selectedFilmPreset.tintLightness,
      filmTintOpacity: selectedFilmPreset.tintOpacity,
      filmGrainOpacity: selectedFilmPreset.grainOpacity,
      filmVignetteOpacity: selectedFilmPreset.vignetteOpacity,
      filmLeakHue: selectedFilmPreset.leakHue,
      filmLeakOpacity: selectedFilmPreset.leakOpacity,
      tintHue: visualSettings.tintHue,
      tintSaturation: visualSettings.tintSaturation,
      tintLightness: visualSettings.tintLightness,
      tintOpacity: visualSettings.tintOpacity,
      bpm,
      chordName: currentChordName,
      isChorus,
      chorusProgress,
      vocalIntensity,
      cameraOffMode: cameraOffVisualMode,
      cameraOffStudioScene,
      studioLeftHue: cameraOffStudioPalette.leftHue,
      studioRightHue: cameraOffStudioPalette.rightHue,
      studioAccentHue: cameraOffStudioPalette.accentHue,
      studioTextPrimaryHue: cameraOffStudioPalette.textPrimaryHue,
      studioTextSecondaryHue: cameraOffStudioPalette.textSecondaryHue,
      studioSaturation: cameraOffStudioPalette.saturation,
      studioLeftLightness: cameraOffStudioPalette.leftLightness,
      studioRightLightness: cameraOffStudioPalette.rightLightness,
    }
  }, [
    bpm,
    cameraOffVisualMode,
    cameraOffStudioScene,
    cameraOffStudioPalette,
    chorusProgress,
    currentChordName,
    currentValenceArousal,
    isChorus,
    lyricColorHue,
    selectedFilmPreset,
    songMedianValenceArousal,
    songPersonality,
    vocalIntensity,
  ])
  captureFilterRef.current = captureFilter

  const shouldIgnoreFramePointer = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !target.closest('[data-mv-interaction-pad="true"]') &&
    Boolean(target.closest('button, input, select, video, [data-no-mv-interaction="true"]'))

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || camera.enabled) return

    const getNativePoint = (event: PointerEvent) => {
      const rect = frame.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null

      return {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      }
    }

    const isInsideFrame = (event: Event) =>
      event.target instanceof Node && frame.contains(event.target)

    const onPointerDown = (event: PointerEvent) => {
      if (!isInsideFrame(event) || shouldIgnoreFramePointer(event.target)) return
      const point = getNativePoint(event)
      if (!point) return

      if (event.target instanceof HTMLElement) {
        try {
          event.target.setPointerCapture?.(event.pointerId)
        } catch {
          // Some automated browsers synthesize pointer events without an active pointer capture slot.
        }
      }

      window.clearTimeout(interactionStartRef.current?.longPressTimer)
      const startedAt = performance.now()
      publishCameraOffInteraction({
        kind: 'press-arming',
        x: point.x,
        y: point.y,
        intensity: 0.38,
      })
      const longPressTimer = window.setTimeout(() => {
        publishCameraOffInteraction({
          kind: 'press-charge',
          x: point.x,
          y: point.y,
          intensity: 1,
        })
      }, 420)

      interactionStartRef.current = {
        pointerId: event.pointerId,
        x: point.x,
        y: point.y,
        lastX: point.x,
        lastY: point.y,
        lastPublishedAt: startedAt,
        startedAt,
        longPressTimer,
        dragging: false,
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const start = interactionStartRef.current
      if (!start || start.pointerId !== event.pointerId) return
      const point = getNativePoint(event)
      if (!point) return

      const distance = Math.hypot(point.x - start.x, point.y - start.y)
      if (distance < 0.032) return
      const moveDistance = Math.hypot(point.x - start.lastX, point.y - start.lastY)
      const now = performance.now()
      if (moveDistance < 0.018 && now - start.lastPublishedAt < 48) return

      start.dragging = true
      start.lastX = point.x
      start.lastY = point.y
      start.lastPublishedAt = now
      window.clearTimeout(start.longPressTimer)
      publishCameraOffInteraction({
        kind: 'drag-trail',
        x: point.x,
        y: point.y,
        intensity: Math.min(1, 0.50 + distance * 2.2),
        points: getDragPoints(start, point),
      })
    }

    const onPointerUp = (event: PointerEvent) => {
      const start = interactionStartRef.current
      if (!start || start.pointerId !== event.pointerId) return
      window.clearTimeout(start.longPressTimer)
      const point = getNativePoint(event) ?? { x: start.x, y: start.y }
      const elapsed = performance.now() - start.startedAt
      const distance = Math.hypot(point.x - start.x, point.y - start.y)

      if (!start.dragging && elapsed < 420 && distance < 0.032) {
        publishCameraOffInteraction({
          kind: 'tap-burst',
          x: point.x,
          y: point.y,
          intensity: 0.78,
        })
      }

      interactionStartRef.current = null
    }

    const onPointerCancel = (event: PointerEvent) => {
      const start = interactionStartRef.current
      if (start?.pointerId === event.pointerId) {
        window.clearTimeout(start.longPressTimer)
        interactionStartRef.current = null
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
    }
  }, [camera.enabled, publishCameraOffInteraction])

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    onFinish(capturesRef.current)
  }, [onFinish])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (camera.stream) {
      video.srcObject = camera.stream
      void video.play().catch(() => {})
    } else {
      video.srcObject = null
    }
  }, [camera.stream])

  useEffect(() => {
    if (!autoMode || !isPlaying) {
      cancelCountdown()
    }
  }, [autoMode, cancelCountdown, isPlaying])

  useEffect(() => {
    return () => {
      window.clearTimeout(colorHueTimerRef.current)
      window.clearTimeout(interactionClearTimerRef.current)
      window.clearTimeout(interactionStartRef.current?.longPressTimer)
    }
  }, [])

  useEffect(() => {
    setCanSwitchFacingCamera(!cameraDeviceId && isMobileLikeDevice())
  }, [cameraDeviceId])

  useEffect(() => {
    if (finishedRef.current || !isLoaded || progress < 0.995) return
    finish()
  }, [finish, isLoaded, progress])

  return (
    <section className="grid min-h-dvh grid-rows-[1fr_auto] overflow-hidden bg-paper">
      <div
        ref={mediaRef}
        className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"
      />

      <div className="relative min-h-0 overflow-hidden p-3 md:p-5">
        <div
          ref={frameRef}
          className="relative h-full min-h-[360px] overflow-hidden rounded-lg border-2 border-ink bg-white shadow-sketch select-none touch-manipulation sm:min-h-[460px]"
        >
          <motion.div
            className="absolute inset-0"
            style={{
              filter: filterEnabled && captureFilter.canvasFilter !== 'none'
                ? captureFilter.canvasFilter
                : undefined,
            }}
            animate={
              activeEffect === 'focus-zoom'
                ? { scale: 1.12, rotate: -1.8 }
                : activeEffect === 'speed-lines'
                  ? { scale: 1.08, rotate: 1.2 }
                : activeEffect === 'glitch'
                  ? { scale: 1.03, rotate: 0.5 }
                : { scale: 1, rotate: 0 }
            }
            transition={{ type: 'spring', stiffness: 130, damping: 14 }}
          >
            <CameraBackdrop
              enabled={camera.enabled}
              facingMode={camera.facingMode}
              videoRef={videoRef}
              bpm={bpm}
              songTitle={displaySongTitle}
              phrase={currentPhrase}
              word={currentWord}
              visualMode={cameraOffVisualMode}
              currentChordName={currentChordName}
              isChorus={isChorus}
              chorusProgress={chorusProgress}
              vocalIntensity={vocalIntensity}
              lyricColorHue={lyricColorHue}
              studioScene={cameraOffStudioScene}
              songUrl={songUrl}
              songPersonality={songPersonality}
              interaction={cameraOffInteraction}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,transparent_0%,transparent_57%,rgba(26,26,31,0.18)_100%)]" />
          </motion.div>

          {filterEnabled && (
            <>
              <MoodColorOverlay
                tintHue={captureFilter.tintHue}
                tintSaturation={captureFilter.tintSaturation}
                tintLightness={captureFilter.tintLightness}
                tintOpacity={captureFilter.tintOpacity}
              />
              <FilmLookOverlay film={selectedFilmPreset} />
            </>
          )}

          {!camera.enabled && (
            <button
              type="button"
              data-mv-interaction-pad="true"
              className="absolute inset-0 z-[18] cursor-crosshair bg-transparent text-[0px] touch-none"
              aria-label="MV STYLE interaction pad"
            />
          )}

          <MusicSignalOverlay
            currentChordName={currentChordName}
            isChorus={isChorus}
            chorusProgress={chorusProgress}
            vocalIntensity={vocalIntensity}
          />

          <ViewfinderOverlay
            afPulse={afPulse}
            bpm={bpm}
            songTitle={displaySongTitle}
            shotCount={captures.length}
            currentChordName={currentChordName}
            isChorus={isChorus}
            vocalIntensity={vocalIntensity}
          />
          <LyricDisplay phrase={currentPhrase} word={currentWord} />
          <CountdownOverlay value={countdownValue} />
          <EffectOverlay effect={activeEffect} effectKey={effectKey} />
          <ShutterCurtain phase={curtainPhase} flashKey={flashKey} />

          <div className="absolute left-4 top-14 z-40 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { void camera.toggle() }}
              className="camera-chip"
              aria-pressed={camera.enabled}
              aria-label="カメラのオンオフ"
            >
              CAMERA
            </button>
            {camera.enabled && canSwitchFacingCamera && (
              <button
                type="button"
                onClick={() => { void camera.switchCamera() }}
                className="camera-chip"
                aria-label={camera.facingMode === 'user' ? '外カメに切り替え' : '内カメに切り替え'}
              >
                {camera.facingMode === 'user' ? '⇄ 外カメ' : '⇄ 内カメ'}
              </button>
            )}
            {!camera.enabled && (
              <div className="mv-style-picker" aria-label="MV STYLE">
                <span>MV STYLE</span>
                {CAMERA_OFF_STYLE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setCameraOffVisualMode(preset.id)}
                    className="camera-chip"
                    aria-pressed={cameraOffVisualMode === preset.id}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <div className="rounded-md border border-red-500 bg-white/90 px-3 py-2 text-xs font-bold text-red-700">
                {error}
              </div>
            )}
            {camera.error && (
              <div className="rounded-md border border-red-500 bg-white/90 px-3 py-2 text-xs font-bold text-red-700">
                {camera.error}
              </div>
            )}
          </div>

          {filterEnabled && (
            <div
              className="pointer-events-none absolute right-4 top-14 z-40 border-2 border-ink bg-paper/88 px-3 py-2 shadow-[4px_4px_0_rgba(26,26,31,0.16)]"
              aria-hidden="true"
            >
              <p className="font-display text-[0.68rem] font-black tracking-[0.16em] text-ink-light">FILM LOADED</p>
              <p className="font-display text-sm font-black tracking-[0.12em] text-ink">{selectedFilmPreset.label}</p>
            </div>
          )}

          {!camera.enabled && (
            <div
              className="pointer-events-none absolute bottom-[30%] left-4 z-40 max-w-[min(88vw,520px)] border-2 border-white/62 bg-ink/54 px-3 py-2 text-white shadow-[5px_5px_0_rgba(0,0,0,0.20)] backdrop-blur-[4px] sm:bottom-[26%] sm:left-6"
              aria-hidden="true"
            >
              <p className="font-display text-[0.72rem] font-black tracking-[0.16em] text-yellow">
                {CAMERA_OFF_STYLE_PRESETS.find(preset => preset.id === cameraOffVisualMode)?.label}
              </p>
              <p className="mt-1 text-[0.68rem] font-black tracking-[0.08em] text-white/86 sm:text-xs">
                TAP {INTERACTION_LABELS[cameraOffVisualMode].tap} / HOLD {INTERACTION_LABELS[cameraOffVisualMode].press} / DRAG {INTERACTION_LABELS[cameraOffVisualMode].drag}
              </p>
            </div>
          )}

          {!isLoaded && !error && (
            <div className="absolute inset-0 z-40 grid place-items-center bg-white/42 backdrop-blur-[2px]">
              <div className="rounded-md border-2 border-ink bg-paper px-5 py-3 font-display text-2xl font-black tracking-[0.12em] shadow-sketch">
                LOADING
              </div>
            </div>
          )}
        </div>
      </div>

      <PlaybackBar
        isLoaded={isLoaded}
        isPlaying={isPlaying}
        progress={progress}
        shotCount={captures.length}
        autoMode={autoMode}
        filterEnabled={filterEnabled}
        filmPresets={FILM_PRESETS}
        selectedFilmPresetId={selectedFilmPresetId}
        onPlay={play}
        onPause={pause}
        onShutter={handleManualShutter}
        onToggleAutoMode={() => {
          setAutoMode(value => {
            const nextValue = !value
            autoModeRef.current = nextValue
            return nextValue
          })
        }}
        onToggleFilter={() => {
          setFilterEnabled(value => {
            const nextValue = !value
            filterEnabledRef.current = nextValue
            return nextValue
          })
        }}
        onSelectFilm={presetId => {
          setSelectedFilmPresetId(presetId)
          setFilterEnabled(true)
          filterEnabledRef.current = true
        }}
        onFinish={finish}
        onSeek={seek}
        onSeekStart={seekStart}
        onSeekEnd={seekEnd}
      />
    </section>
  )
}
