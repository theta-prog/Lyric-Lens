import type { PlayerVideoOptions } from 'textalive-app-api'
import { AnimatePresence, motion } from 'framer-motion'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { useTextAlive } from '../hooks/useTextAlive'
import type { CaptureItem, CurtainPhase, ShutterEffect } from '../types'
import { captureFrame, type CaptureFilter } from '../utils/capture'
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
  onFinish: (captures: CaptureItem[]) => void
}

function normalizeText(text: string) {
  return text.trim().toLowerCase()
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

function getSongPersonality(url: string) {
  for (const [id, p] of Object.entries(SONG_PERSONALITIES)) {
    if (url.includes(id)) return p
  }
  return null
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

const CameraBackdrop = memo(function CameraBackdrop({
  enabled,
  facingMode,
  videoRef,
}: {
  enabled: boolean
  facingMode: 'user' | 'environment'
  videoRef: React.RefObject<HTMLVideoElement>
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

  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,#edfdf2_0%,#b8efff_48%,#fff0a0_100%)]">
      <div className="absolute left-[12%] top-[32%] h-[14%] max-h-18 min-h-12 w-[21%] max-w-18 rotate-[-10deg] border-[6px] border-cyan/55 bg-cyan/10 opacity-70 shadow-sketch sm:left-[10%] sm:top-[25%] sm:h-[18%] sm:max-h-24 sm:w-[24%] sm:max-w-24 sm:border-[8px]" />
      <div className="absolute right-[5%] top-[31%] h-[11%] max-h-14 min-h-11 w-[36%] max-w-30 rotate-[8deg] border-[6px] border-yellow/65 bg-yellow/14 opacity-75 shadow-sketch sm:top-[26%] sm:h-[13%] sm:max-h-18 sm:max-w-36 sm:border-[7px]" />
      <div className="absolute bottom-[13%] left-[8%] h-[21%] max-h-24 min-h-18 w-[47%] max-w-40 rotate-[3deg] border-[6px] border-ink/10 bg-white/14 opacity-65 shadow-sketch sm:bottom-[12%] sm:h-[23%] sm:max-h-28 sm:max-w-44 sm:border-[7px]" />
      <div className="absolute bottom-[15%] right-[10%] h-[15%] max-h-18 min-h-12 w-[20%] max-w-18 rotate-[-8deg] rounded-full border-[8px] border-cyan/35 bg-yellow/28 opacity-75 sm:bottom-[14%] sm:h-[16%] sm:max-h-20 sm:max-w-20 sm:border-[9px]" />
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
      <div className="absolute inset-x-5 top-4 flex items-center justify-between gap-3 font-display text-base font-black text-ink/70 sm:inset-x-7 sm:text-xl">
        <span>SS {formatSpeed(bpm)}</span>
        <span>f/1.8&nbsp;&nbsp;ISO AUTO</span>
      </div>

      <div className="absolute inset-x-5 bottom-4 flex items-center justify-between gap-3 font-display text-base font-black text-ink/70 sm:inset-x-7 sm:text-lg">
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
}) {
  const visualSettings = getMoodVisualSettings({
    valenceArousal,
    songMedianValenceArousal,
    songPersonality,
    bpm,
    lyricColorHue,
    currentChordName,
    isChorus,
    vocalIntensity,
  })

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          backdropFilter: visualSettings.canvasFilter,
          WebkitBackdropFilter: visualSettings.canvasFilter,
          transition: 'backdrop-filter 0.8s ease-in-out, -webkit-backdrop-filter 0.8s ease-in-out',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          backgroundColor: `hsl(${visualSettings.tintHue}deg ${visualSettings.tintSaturation}% ${visualSettings.tintLightness}%)`,
          opacity: visualSettings.tintOpacity,
          transition: 'background-color 0.4s ease-in-out, opacity 0.4s ease-in-out',
        }}
        aria-hidden
      />
    </>
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
        {Array.from({ length: 5 }).map((_, index) => {
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

export default function PlayerView({ token, songUrl, songOptions, onFinish }: PlayerViewProps) {
  const mediaRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const capturesRef = useRef<CaptureItem[]>([])
  const phraseRef = useRef('')
  const wordRef = useRef('')
  const songPositionRef = useRef(0)
  const songTitleRef = useRef('')
  const bpmRef = useRef(0)
  const isPlayingRef = useRef(false)
  const autoModeRef = useRef(true)
  const filterEnabledRef = useRef(true)
  const captureFilterRef = useRef<CaptureFilter | null>(null)
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
  const colorHueTimerRef = useRef<number | undefined>(undefined)

  const camera = useCamera()

  const songPersonality = useMemo(() => getSongPersonality(songUrl), [songUrl])

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

  const handleShutter = useCallback(async () => {
    if (shutterBusyRef.current) return

    shutterBusyRef.current = true
    const phraseSnapshot = phraseRef.current || wordRef.current || 'Lyric Lens'
    const wordSnapshot = wordRef.current
    const songPositionSnapshot = songPositionRef.current
    const filterSnapshot = captureFilterRef.current
    const shouldUseFilteredFrame = filterEnabledRef.current && filterSnapshot
    navigator.vibrate?.(30)
    setAfPulse(value => value + 1)
    await wait(50)
    setCurtainPhase('closing')
    await wait(90)

    const frameNumber = capturesRef.current.length + 1
    const frameRect = frameRef.current?.getBoundingClientRect()
    const rawFrame = captureFrame(
      camera.enabled && videoRef.current ? videoRef.current : null,
      phraseSnapshot,
      wordSnapshot,
      songTitleRef.current,
      frameNumber,
      frameRect ? { width: frameRect.width, height: frameRect.height } : undefined,
      null,
      camera.facingMode === 'user',
    )
    const filteredFrame = filterSnapshot
      ? captureFrame(
          camera.enabled && videoRef.current ? videoRef.current : null,
          phraseSnapshot,
          wordSnapshot,
          songTitleRef.current,
          frameNumber,
          frameRect ? { width: frameRect.width, height: frameRect.height } : undefined,
          filterSnapshot,
          camera.facingMode === 'user',
        )
      : rawFrame
    const selectedFrame = shouldUseFilteredFrame ? filteredFrame : rawFrame

    appendCapture({
      id: `${Date.now()}-${frameNumber}`,
      dataUrl: selectedFrame.dataUrl,
      rawDataUrl: rawFrame.dataUrl,
      filteredDataUrl: filteredFrame.dataUrl,
      width: selectedFrame.width,
      height: selectedFrame.height,
      phrase: phraseSnapshot,
      timestamp: Date.now(),
      songPosition: songPositionSnapshot,
    })

    setFlashKey(value => value + 1)
    setCurtainPhase('opening')
    await wait(130)
    setCurtainPhase('idle')
    shutterBusyRef.current = false
  }, [appendCapture, camera.enabled])

  const cancelCountdown = useCallback(() => {
    countdownRunRef.current += 1
    countdownBusyRef.current = false
    setCountdownValue(null)
  }, [])

  const handleManualShutter = useCallback(() => {
    cancelCountdown()
    void handleShutter()
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

        const effect = trigger.effect
        if (effect && effect !== 'default') {
          setEffectKey(k => k + 1)
          setActiveEffect(effect)
          await wait(getEffectDuration(effect))
          if (countdownRunRef.current !== runId) return
        }

        await handleShutter()
      } finally {
        if (countdownRunRef.current === runId) {
          setCountdownValue(null)
          setActiveEffect(null)
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
  songTitleRef.current = songTitle
  bpmRef.current = bpm
  isPlayingRef.current = isPlaying
  autoModeRef.current = autoMode
  filterEnabledRef.current = filterEnabled

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
      canvasFilter: visualSettings.canvasFilter,
      tintHue: visualSettings.tintHue,
      tintSaturation: visualSettings.tintSaturation,
      tintLightness: visualSettings.tintLightness,
      tintOpacity: visualSettings.tintOpacity,
    }
  }, [
    bpm,
    currentChordName,
    currentValenceArousal,
    isChorus,
    lyricColorHue,
    songMedianValenceArousal,
    songPersonality,
    vocalIntensity,
  ])
  captureFilterRef.current = captureFilter

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
            <CameraBackdrop enabled={camera.enabled} facingMode={camera.facingMode} videoRef={videoRef} />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,transparent_0%,transparent_57%,rgba(26,26,31,0.18)_100%)]" />
          </motion.div>

          {filterEnabled && (
            <MoodColorOverlay
              valenceArousal={currentValenceArousal}
              songMedianValenceArousal={songMedianValenceArousal}
              songPersonality={songPersonality}
              bpm={bpm}
              lyricColorHue={lyricColorHue}
              currentChordName={currentChordName}
              isChorus={isChorus}
              vocalIntensity={vocalIntensity}
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
            songTitle={songTitle}
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
            {camera.enabled && (
              <button
                type="button"
                onClick={() => { void camera.switchCamera() }}
                className="camera-chip"
                aria-label={camera.facingMode === 'user' ? '外カメに切り替え' : '内カメに切り替え'}
              >
                {camera.facingMode === 'user' ? '⇄ 外カメ' : '⇄ 内カメ'}
              </button>
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
        onFinish={finish}
        onSeek={seek}
        onSeekStart={seekStart}
        onSeekEnd={seekEnd}
      />
    </section>
  )
}
