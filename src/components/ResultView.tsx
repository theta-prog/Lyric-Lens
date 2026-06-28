import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerVideoOptions } from 'textalive-app-api'
import { useTextAlive } from '../hooks/useTextAlive'
import type { CaptureItem, ShutterEffect } from '../types'
import {
  createStoryVideo,
  selectStoryFrames,
  type StoryFrame,
  type StoryLayoutMode,
  type StoryPacingMode,
  type StoryVideoResult,
} from '../utils/storyVideo'

interface ResultViewProps {
  captures: CaptureItem[]
  token: string
  songUrl: string
  songOptions?: PlayerVideoOptions
  onRestart: () => void
}

function formatSongTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function getSessionDuration(captures: CaptureItem[]) {
  return Math.max(
    1,
    ...captures.map(capture => capture.songDuration ?? 0),
    ...captures.map(capture => capture.songPosition),
  )
}

function getCaptureProgress(capture: CaptureItem, duration: number) {
  return Math.min(1, Math.max(0, capture.songPosition / Math.max(1, duration)))
}

function getCapturePlaybackDuration(capture: CaptureItem, pacingMode: StoryPacingMode, frameCount: number) {
  const beatMs = capture.bpm && capture.bpm > 0 ? 60_000 / capture.bpm : 560
  const effectivePacing = pacingMode === 'auto'
    ? frameCount <= 6 ? 'bar' : 'half'
    : pacingMode
  const beats = effectivePacing === 'bar' ? 4 : 2
  const vocalBoost = Math.min(1, Math.max(0, capture.vocalIntensity ?? 0)) * 180

  return effectivePacing === 'bar'
    ? Math.min(2400, Math.max(1300, Math.round(beatMs * beats + vocalBoost)))
    : Math.min(1450, Math.max(760, Math.round(beatMs * beats + vocalBoost)))
}

function getReviewEditDuration(captures: CaptureItem[], pacingMode: StoryPacingMode) {
  const total = captures.reduce(
    (sum, capture) => sum + getCapturePlaybackDuration(capture, pacingMode, captures.length),
    0,
  )

  return Math.min(15_000, Math.max(4_500, total))
}

function getReviewRange(captures: CaptureItem[], duration: number, pacingMode: StoryPacingMode) {
  if (captures.length === 0) {
    return { start: 0, end: Math.min(duration, 12_000) }
  }

  const positions = captures.map(capture => capture.songPosition)
  const firstCaptureAt = Math.min(...positions)
  const start = Math.max(0, firstCaptureAt - 1_000)
  const editDuration = getReviewEditDuration(captures, pacingMode)
  const end = Math.min(Math.max(duration, start + 1_500), start + editDuration)

  return {
    start,
    end: Math.max(start + 1_500, end),
  }
}

function getRangeProgress(position: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (position - start) / Math.max(1, end - start)))
}

function getActiveCaptureIndex(
  captures: CaptureItem[],
  position: number,
  reviewStart: number,
  pacingMode: StoryPacingMode,
) {
  if (captures.length === 0 || position < reviewStart) return -1

  const elapsed = Math.max(0, position - reviewStart)
  let cursor = 0

  for (const [index, capture] of captures.entries()) {
    cursor += getCapturePlaybackDuration(capture, pacingMode, captures.length)
    if (elapsed <= cursor) {
      return index
    }
  }

  return captures.length - 1
}

function getEffectLabel(effect?: ShutterEffect) {
  switch (effect) {
    case 'finder': return 'FINDER'
    case 'focus-zoom': return 'FOCUS'
    case 'blur-to-clear': return 'FOCUS CLEAR'
    case 'strobe': return 'STROBE'
    case 'snap': return 'SNAP'
    case 'frame': return 'FRAME'
    case 'light-leak': return 'LIGHT'
    case 'sound-wave': return 'SOUND'
    case 'stage-curtain': return 'STAGE'
    case 'speed-lines': return 'SPEED'
    case 'answer-scan': return 'SCAN'
    case 'glitch': return 'GLITCH'
    case 'noise': return 'NOISE'
    default: return 'SHUTTER'
  }
}

function getCaptureSourceLabel(capture: CaptureItem) {
  if (capture.captureSource === 'auto') {
    return capture.triggerText ? `AUTO / ${capture.triggerText}` : 'AUTO SHUTTER'
  }

  return 'MANUAL SHUTTER'
}

function getCaptureReason(capture: CaptureItem) {
  const reasons = [getCaptureSourceLabel(capture)]

  if (capture.isChorus) {
    reasons.push('CHORUS')
  }
  if (capture.shutterEffect && capture.shutterEffect !== 'default') {
    reasons.push(getEffectLabel(capture.shutterEffect))
  }
  if ((capture.vocalIntensity ?? 0) >= 0.58) {
    reasons.push(`VOX ${Math.round((capture.vocalIntensity ?? 0) * 100)}`)
  }
  if (capture.chordName) {
    reasons.push(capture.chordName)
  }

  return reasons.slice(0, 4).join(' / ')
}

function getCaptureDataUrl(capture: CaptureItem, filterEnabled: boolean) {
  return filterEnabled
    ? capture.filteredDataUrl ?? capture.dataUrl
    : capture.rawDataUrl ?? capture.dataUrl
}

function getCaptureFilename(index: number, filterEnabled: boolean) {
  const suffix = filterEnabled ? 'film' : 'raw'
  return `lyric-lens-${String(index + 1).padStart(3, '0')}-${suffix}.jpg`
}

function downloadCapture(capture: CaptureItem, index: number, filterEnabled: boolean) {
  const link = document.createElement('a')
  link.href = getCaptureDataUrl(capture, filterEnabled)
  link.download = getCaptureFilename(index, filterEnabled)
  link.click()
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function FilmPerforation() {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden bg-ink px-2" aria-hidden="true">
      {Array.from({ length: 42 }).map((_, index) => (
        <span key={index} className="h-4 w-6 shrink-0 rounded-[2px] bg-paper/90" />
      ))}
    </div>
  )
}

function CaptureLogMeta({ capture, duration, compact = false }: {
  capture: CaptureItem
  duration: number
  compact?: boolean
}) {
  const progress = Math.round(getCaptureProgress(capture, duration) * 100)
  const vox = Math.round((capture.vocalIntensity ?? 0) * 100)
  const items = [
    formatSongTime(capture.songPosition),
    `${progress}%`,
    capture.isChorus ? 'CHORUS' : 'VERSE',
    capture.chordName || '--',
    `VOX ${vox}`,
  ]

  return (
    <div className={`grid gap-1 ${compact ? 'text-[0.62rem]' : 'text-xs'}`}>
      <div className="flex flex-wrap gap-1">
        {items.map(item => (
          <span
            key={item}
            className="rounded-[3px] border border-ink/28 bg-white/72 px-1.5 py-0.5 font-display font-black tracking-[0.08em] text-ink-light"
          >
            {item}
          </span>
        ))}
      </div>
      <p className="font-display font-black tracking-[0.08em] text-cyan">
        {getCaptureReason(capture)}
      </p>
    </div>
  )
}

function MusicLogPreview({
  captures,
  layoutMode,
  activeIndex,
  currentPhrase,
  currentWord,
  currentChordName,
  currentIsChorus,
  currentVocalIntensity,
  reviewPosition,
  reviewStart,
  reviewEnd,
  reviewProgress,
  duration,
  getDataUrl,
}: {
  captures: CaptureItem[]
  layoutMode: StoryLayoutMode
  activeIndex: number
  currentPhrase: string
  currentWord: string
  currentChordName: string
  currentIsChorus: boolean
  currentVocalIntensity: number
  reviewPosition: number
  reviewStart: number
  reviewEnd: number
  reviewProgress: number
  duration: number
  getDataUrl: (capture: CaptureItem) => string
}) {
  const timelineEntries = captures
    .map((capture, index) => ({ capture, index }))
    .sort((a, b) => a.capture.songPosition - b.capture.songPosition || a.index - b.index)
  const activeEntry = activeIndex >= 0
    ? { capture: captures[activeIndex], index: activeIndex }
    : timelineEntries[0]
  const activeCapture = activeEntry?.capture
  const activeNumber = activeEntry ? activeEntry.index + 1 : 1
  const activeTimelineIndex = Math.max(
    0,
    timelineEntries.findIndex(entry => entry.index === activeEntry?.index),
  )
  const stripStart = Math.max(0, Math.min(activeTimelineIndex - 2, timelineEntries.length - 5))
  const stripEntries = timelineEntries.slice(stripStart, stripStart + 5)

  if (!activeCapture) {
    return (
      <div className="grid h-full place-items-center bg-ink text-white">
        <p className="font-display text-2xl font-black tracking-[0.14em]">NO CUTS</p>
      </div>
    )
  }

  if (layoutMode === 'stage') {
    return (
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden bg-ink p-5 text-white">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-white/10 pb-3">
          <div className="min-w-0">
            <p className="font-display text-sm font-black tracking-[0.14em] text-yellow">NOW LYRIC</p>
            <p className="line-clamp-2 text-2xl font-black leading-tight text-white">
              {currentPhrase || activeCapture.phrase || 'Lyric Lens'}
            </p>
          </div>
          <div className="grid gap-2 text-right font-display text-xs font-black tracking-[0.1em] text-white">
            <span>{currentIsChorus ? 'CHORUS' : 'VERSE'}</span>
            <span>{currentChordName || activeCapture.chordName || '--'}</span>
            <span>VOX {Math.round(currentVocalIntensity * 100)}</span>
          </div>
        </div>

        <div className="relative min-h-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCapture.id}
              className="absolute inset-0 grid place-items-center"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <img
                src={getDataUrl(activeCapture)}
                alt={`music log cut ${activeNumber}`}
                className="max-h-full max-w-full rounded-[3px] border-2 border-white bg-paper object-contain shadow-[7px_7px_0_rgba(255,255,255,0.16)]"
              />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="grid gap-3 border-t border-white/14 pt-4">
          <div className="grid grid-cols-4 gap-3 font-display font-black tracking-[0.06em]">
            <div>
              <p className="text-xs text-white">SHOT</p>
              <p className="mt-1 text-2xl text-cyan">{formatSongTime(activeCapture.songPosition)}</p>
            </div>
            <div>
              <p className="text-xs text-white">MUSIC</p>
              <p className="mt-1 text-2xl text-cyan">{formatSongTime(reviewPosition || reviewStart)}</p>
            </div>
            <div>
              <p className="text-xs text-white">CUT</p>
              <p className="mt-1 line-clamp-1 text-lg text-white">
                {currentWord || activeCapture.triggerText || getEffectLabel(activeCapture.shutterEffect)}
              </p>
            </div>
            <div>
              <p className="text-xs text-white">REASON</p>
              <p className="mt-1 line-clamp-2 text-sm text-white">{getCaptureReason(activeCapture)}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-paper text-ink">
      <div className="border-b-2 border-ink bg-white px-4 py-3">
        <div className="h-2 overflow-hidden rounded-[3px] border-2 border-ink bg-paper">
          <div
            className="h-full bg-yellow transition-[width]"
            style={{ width: `${Math.round(reviewProgress * 100)}%` }}
          />
        </div>

        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xs font-black tracking-[0.14em] text-cyan">MUSIC LOG</p>
            <p className="font-display text-2xl font-black leading-none text-ink">
              #{String(activeNumber).padStart(3, '0')}
            </p>
          </div>
          <div className="text-right font-display font-black">
            <p className="text-2xl leading-none text-yellow">{formatSongTime(activeCapture.songPosition)}</p>
            <p className="mt-1 text-xs tracking-[0.1em] text-ink-light">
              {formatSongTime(reviewPosition || reviewStart)} / {formatSongTime(reviewEnd)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2 bg-ink p-3 text-white">
        <div className="grid gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <div className="min-w-0">
              <p className="font-display text-[0.64rem] font-black tracking-[0.14em] text-cyan">NOW LYRIC</p>
              <p className="line-clamp-2 text-sm font-black leading-snug text-white">
                {currentPhrase || activeCapture.phrase || 'Lyric Lens'}
              </p>
            </div>
            <div className="grid gap-1 text-right font-display text-[0.62rem] font-black tracking-[0.1em] text-white/78">
              <span>{currentIsChorus ? 'CHORUS' : 'VERSE'}</span>
              <span>{currentChordName || activeCapture.chordName || '--'}</span>
              <span>VOX {Math.round(currentVocalIntensity * 100)}</span>
            </div>
          </div>
        </div>

        <div className="relative min-h-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCapture.id}
              className="absolute inset-0 grid place-items-center"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <img
                src={getDataUrl(activeCapture)}
                alt={`music log cut ${activeNumber}`}
                className="max-h-full max-w-full rounded-[3px] border-2 border-white bg-paper object-contain shadow-[7px_7px_0_rgba(255,255,255,0.16)]"
              />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="grid gap-1 border-t border-white/18 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2 font-display text-[0.66rem] font-black tracking-[0.1em] text-white/82">
            <span>SHOT {formatSongTime(activeCapture.songPosition)}</span>
            <span>MUSIC {formatSongTime(reviewPosition || reviewStart)}</span>
            <span>{currentWord || activeCapture.triggerText || getEffectLabel(activeCapture.shutterEffect)}</span>
          </div>
          <p className="line-clamp-1 text-xs font-black leading-snug text-cyan">
            {getCaptureReason(activeCapture)}
          </p>
        </div>
      </div>

      <div className="border-t-2 border-ink bg-white px-4 py-3">
        <p className="line-clamp-2 text-xl font-black leading-tight text-ink">
          {activeCapture.phrase || 'Lyric Lens'}
        </p>
        <p className="mt-1 line-clamp-1 font-display text-xs font-black tracking-[0.12em] text-cyan">
          {getCaptureReason(activeCapture)}
        </p>

        <div className="mt-2 flex flex-wrap gap-1 text-[0.62rem]">
          {[
            `${Math.round(getCaptureProgress(activeCapture, duration) * 100)}%`,
            activeCapture.isChorus ? 'CHORUS' : 'VERSE',
            activeCapture.chordName || '--',
            `VOX ${Math.round((activeCapture.vocalIntensity ?? 0) * 100)}`,
          ].map(item => (
            <span
              key={item}
              className="rounded-[3px] border border-ink/28 bg-paper px-1.5 py-0.5 font-display font-black tracking-[0.08em] text-ink-light"
            >
              {item}
            </span>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {stripEntries.map(({ capture, index }) => (
            <div
              key={capture.id}
              className={`relative overflow-hidden rounded-[3px] border-2 bg-ink ${
                index === activeIndex ? 'border-yellow ring-2 ring-yellow' : 'border-ink/48'
              }`}
            >
              <img
                src={getDataUrl(capture)}
                alt=""
                className="aspect-[9/16] w-full object-contain"
              />
              <span className="absolute left-0 top-0 bg-ink/82 px-1 font-display text-[0.58rem] font-black text-white">
                {index + 1}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SyncLogTimeline({
  captures,
  duration,
  reviewStart,
  reviewEnd,
  reviewPosition,
  reviewProgress,
  activeIndex,
  isReviewLoaded,
  isReviewPlaying,
  reviewError,
  onToggleReview,
  onOpen,
}: {
  captures: CaptureItem[]
  duration: number
  reviewStart: number
  reviewEnd: number
  reviewPosition: number
  reviewProgress: number
  activeIndex: number
  isReviewLoaded: boolean
  isReviewPlaying: boolean
  reviewError: string | null
  onToggleReview: () => void
  onOpen: (index: number) => void
}) {
  const timelineEntries = captures
    .map((capture, index) => ({ capture, index }))
    .sort((a, b) => a.capture.songPosition - b.capture.songPosition || a.index - b.index)
  const activeCapture = activeIndex >= 0 ? captures[activeIndex] : null
  const timelineCursorProgress = Math.min(1, Math.max(0, reviewPosition / Math.max(1, duration)))

  return (
    <div className="border-y-2 border-ink bg-white px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-display text-sm font-black tracking-[0.14em] text-cyan">SYNC LOG</p>
          <h2 className="font-display text-3xl font-black leading-none text-ink">曲内撮影ログ</h2>
        </div>
        <p className="font-display text-sm font-black tracking-[0.12em] text-ink-light">
          0:00 - {formatSongTime(duration)}
        </p>
      </div>

      <div className="mt-3 grid gap-2 rounded-md border-2 border-ink bg-paper p-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <button
          type="button"
          onClick={onToggleReview}
          disabled={!isReviewLoaded}
          className={`h-11 rounded-md border-2 border-ink px-4 text-sm font-black tracking-[0.12em] shadow-shutter transition active:translate-y-1 active:shadow-none disabled:opacity-50 ${
            isReviewPlaying ? 'bg-ink text-white' : 'bg-cyan text-ink hover:bg-cyan/80'
          }`}
        >
          {isReviewPlaying ? 'PAUSE LOG' : 'PLAY LOG'}
        </button>
        <div className="min-w-0">
          <div className="h-3 overflow-hidden rounded-[3px] border-2 border-ink bg-white">
            <div
              className="h-full bg-cyan transition-[width]"
              style={{ width: `${Math.round(reviewProgress * 100)}%` }}
            />
          </div>
          <p className="mt-1 line-clamp-1 text-xs font-black text-ink-light">
            {activeCapture
              ? `${formatSongTime(reviewPosition)} / #${String(activeIndex + 1).padStart(3, '0')} ${activeCapture.phrase}`
              : `${formatSongTime(reviewStart)} - ${formatSongTime(reviewEnd)} だけ再生`}
          </p>
        </div>
        <p className="font-display text-sm font-black tracking-[0.1em] text-ink-light">
          {formatSongTime(reviewPosition || reviewStart)} / {formatSongTime(reviewEnd)}
        </p>
        {reviewError && (
          <p className="sm:col-span-3 rounded-md border-2 border-red-500 bg-white px-3 py-2 text-xs font-bold text-red-700">
            {reviewError}
          </p>
        )}
      </div>

      <div className="relative mt-4 h-14 border-y-2 border-ink bg-paper">
        <div className="absolute left-3 right-3 top-1/2 h-1 -translate-y-1/2 bg-ink/18" />
        <div className="absolute left-3 top-1/2 h-1 -translate-y-1/2 bg-yellow" style={{ width: 'calc(100% - 1.5rem)' }} />
        <div
          className="absolute top-0 h-full w-1 -translate-x-1/2 bg-ink"
          style={{ left: `${timelineCursorProgress * 100}%` }}
          aria-hidden="true"
        />
        {timelineEntries.map(({ capture, index }) => (
          <button
            key={capture.id}
            type="button"
            onClick={() => onOpen(index)}
            className={`absolute top-1/2 h-8 w-5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 border-ink text-[0.58rem] font-black text-ink shadow-[2px_2px_0_rgba(26,26,31,0.16)] transition hover:-translate-y-[55%] ${
              activeIndex === index
                ? 'bg-ink text-white ring-4 ring-yellow'
                : capture.isChorus ? 'bg-yellow' : capture.captureSource === 'auto' ? 'bg-cyan' : 'bg-white'
            }`}
            style={{ left: `${getCaptureProgress(capture, duration) * 100}%` }}
            aria-label={`${formatSongTime(capture.songPosition)} の撮影ログを開く`}
          >
            {index + 1}
          </button>
        ))}
      </div>

      <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1">
        {timelineEntries.map(({ capture, index }) => (
          <button
            key={capture.id}
            type="button"
            onClick={() => onOpen(index)}
            className={`grid gap-2 rounded-md border-2 border-ink px-3 py-2 text-left transition hover:bg-white sm:grid-cols-[5.5rem_1fr] ${
              activeIndex === index ? 'bg-yellow shadow-[4px_4px_0_rgba(26,26,31,0.18)]' : 'bg-paper'
            }`}
          >
            <div className="font-display text-xl font-black leading-none text-ink">
              #{String(index + 1).padStart(3, '0')}
              <span className="mt-1 block text-sm text-cyan">{formatSongTime(capture.songPosition)}</span>
            </div>
            <div className="min-w-0">
              <p className="line-clamp-1 text-sm font-black text-ink">{capture.phrase || 'Lyric Lens'}</p>
              <CaptureLogMeta capture={capture} duration={duration} compact />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ResultView({ captures, token, songUrl, songOptions, onRestart }: ResultViewProps) {
  const [viewMode, setViewMode] = useState<'frames' | 'story'>('story')
  const [storyLayoutMode, setStoryLayoutMode] = useState<StoryLayoutMode>('stage')
  const [storyPacingMode, setStoryPacingMode] = useState<StoryPacingMode>('auto')
  const [filterByCaptureId, setFilterByCaptureId] = useState<Record<string, boolean>>({})
  const [storyResult, setStoryResult] = useState<StoryVideoResult | null>(null)
  const [storyProgress, setStoryProgress] = useState(0)
  const [storyStatus, setStoryStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle')
  const [storyError, setStoryError] = useState('')
  const [storyDirty, setStoryDirty] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const abortStoryRef = useRef<AbortController | null>(null)
  const autoStoryStartedRef = useRef(false)
  const reviewMediaRef = useRef<HTMLDivElement>(null)
  const playMusicLogButtonRef = useRef<HTMLButtonElement>(null)
  const reviewStartGuardUntilRef = useRef(0)
  const capturedSongDuration = useMemo(() => getSessionDuration(captures), [captures])
  const {
    isLoaded: isReviewLoaded,
    isPlaying: isReviewPlaying,
    currentPhrase: reviewCurrentPhrase,
    currentWord: reviewCurrentWord,
    progress: reviewPlaybackProgress,
    duration: reviewLoadedDuration,
    error: reviewError,
    currentChordName: reviewCurrentChordName,
    isChorus: reviewIsChorus,
    vocalIntensity: reviewVocalIntensity,
    play: playReview,
    pause: pauseReview,
    seekStart: seekReviewStart,
    seekEnd: seekReviewEnd,
  } = useTextAlive(
    reviewMediaRef,
    token,
    songUrl,
    songOptions,
  )
  const isFilterEnabled = (capture: CaptureItem) =>
    filterByCaptureId[capture.id] ?? capture.filterEnabledAtCapture ?? true
  const allFiltersEnabled = captures.every(capture => isFilterEnabled(capture))
  const previewCapture = previewIndex !== null ? captures[previewIndex] : null
  const previewFilterEnabled = previewCapture ? isFilterEnabled(previewCapture) : true
  const songDuration = Math.max(capturedSongDuration, reviewLoadedDuration)
  const reviewRange = useMemo(
    () => getReviewRange(captures, songDuration, storyPacingMode),
    [captures, songDuration, storyPacingMode],
  )
  const reviewPosition = reviewLoadedDuration > 0
    ? reviewPlaybackProgress * reviewLoadedDuration
    : reviewRange.start
  const reviewProgress = getRangeProgress(reviewPosition, reviewRange.start, reviewRange.end)
  const activeReviewIndex = isReviewPlaying || reviewPosition >= reviewRange.start
    ? getActiveCaptureIndex(captures, reviewPosition, reviewRange.start, storyPacingMode)
    : -1
  const storyCaptures = useMemo(() => selectStoryFrames(captures), [captures])
  const storyFrames = useMemo<StoryFrame[]>(
    () =>
      storyCaptures.map(capture => ({
        capture,
        dataUrl: getCaptureDataUrl(capture, isFilterEnabled(capture)),
        index: captures.findIndex(item => item.id === capture.id),
      })),
    [captures, filterByCaptureId, storyCaptures],
  )
  const selectedStoryLabel = storyLayoutMode === 'stage' ? 'BLACK' : 'LOG'
  const selectedPacingLabel = storyPacingMode === 'auto'
    ? 'AUTO BPM'
    : storyPacingMode === 'bar' ? '1 BAR' : '2 BEAT'

  useEffect(() => {
    return () => {
      abortStoryRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    abortStoryRef.current?.abort()
    autoStoryStartedRef.current = false
    setStoryResult(null)
    setStoryStatus('idle')
    setStoryProgress(0)
    setStoryError('')
    setStoryDirty(false)
    setFilterByCaptureId({})
    setPreviewIndex(null)
  }, [captures])

  const toggleCaptureFilter = (captureId: string) => {
    const capture = captures.find(item => item.id === captureId)
    setFilterByCaptureId(current => ({
      ...current,
      [captureId]: !(current[captureId] ?? capture?.filterEnabledAtCapture ?? true),
    }))
    if (storyResult || storyStatus === 'ready' || storyStatus === 'error') {
      setStoryDirty(true)
    }
  }
  const setAllFilters = (enabled: boolean) => {
    setFilterByCaptureId(Object.fromEntries(captures.map(capture => [capture.id, enabled])))
    if (storyResult || storyStatus === 'ready' || storyStatus === 'error') {
      setStoryDirty(true)
    }
  }
  const updateStoryLayoutMode = (mode: StoryLayoutMode) => {
    setStoryLayoutMode(mode)
    if (storyResult || storyStatus === 'ready' || storyStatus === 'error') {
      setStoryDirty(true)
    }
  }
  const updateStoryPacingMode = (mode: StoryPacingMode) => {
    setStoryPacingMode(mode)
    if (storyResult || storyStatus === 'ready' || storyStatus === 'error') {
      setStoryDirty(true)
    }
  }
  const toggleReviewPlayback = () => {
    if (isReviewPlaying) {
      pauseReview()
      return
    }

    if (!isReviewLoaded || songDuration <= 0) return

    reviewStartGuardUntilRef.current = performance.now() + 900
    seekReviewStart()
    seekReviewEnd(reviewRange.start / songDuration)
    queueMicrotask(() => {
      playReview()
    })
  }
  const openPreview = (index: number) => {
    setPreviewIndex(index)
  }
  const closePreview = () => {
    setPreviewIndex(null)
  }
  const movePreview = (direction: -1 | 1) => {
    setPreviewIndex(current => {
      if (current === null || captures.length === 0) return current
      return (current + direction + captures.length) % captures.length
    })
  }
  const scrollPlayMusicLogIntoView = () => {
    if (!window.matchMedia('(max-width: 639px)').matches) return

    window.requestAnimationFrame(() => {
      playMusicLogButtonRef.current?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      })
    })
  }
  const renderStory = async ({ scrollToPlayback = false }: { scrollToPlayback?: boolean } = {}) => {
    if (storyStatus === 'rendering') return

    abortStoryRef.current?.abort()
    const controller = new AbortController()
    abortStoryRef.current = controller
    setStoryStatus('rendering')
    setStoryProgress(0)
    setStoryError('')
    setStoryResult(null)

    try {
      if (isReviewPlaying) pauseReview()
      const result = await createStoryVideo(storyFrames, {
        signal: controller.signal,
        onProgress: setStoryProgress,
        layoutMode: storyLayoutMode,
        pacingMode: storyPacingMode,
      })
      setStoryResult(result)
      setStoryStatus('ready')
      setStoryDirty(false)
      if (scrollToPlayback) {
        scrollPlayMusicLogIntoView()
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setStoryError(error instanceof Error ? error.message : '動画生成に失敗しました')
      setStoryStatus('error')
    }
  }

  useEffect(() => {
    if (autoStoryStartedRef.current) return
    if (viewMode !== 'story' || storyStatus !== 'idle' || storyFrames.length === 0) return

    autoStoryStartedRef.current = true
    window.setTimeout(() => {
      void renderStory()
    }, 180)
  }, [storyFrames.length, storyStatus, viewMode])

  useEffect(() => {
    if (previewIndex === null) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePreview()
      } else if (event.key === 'ArrowLeft') {
        movePreview(-1)
      } else if (event.key === 'ArrowRight') {
        movePreview(1)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [previewIndex, captures.length])

  useEffect(() => {
    if (!isReviewPlaying) return
    if (performance.now() < reviewStartGuardUntilRef.current) return
    if (reviewPosition < reviewRange.end) return

    pauseReview()
    seekReviewStart()
    seekReviewEnd(reviewRange.end / Math.max(1, songDuration))
  }, [
    isReviewPlaying,
    pauseReview,
    reviewPosition,
    reviewRange.end,
    seekReviewEnd,
    seekReviewStart,
    songDuration,
  ])

  useEffect(() => {
    if (viewMode === 'story') return
    if (isReviewPlaying) pauseReview()
  }, [isReviewPlaying, pauseReview, viewMode])

  return (
    <section className="grid h-dvh min-h-dvh w-full min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-paper">
      <div
        ref={reviewMediaRef}
        className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"
      />

      <header className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink bg-white px-3 py-3 sm:gap-3 sm:px-5">
        <div>
          <p className="font-display text-xs font-black tracking-[0.16em] text-cyan sm:text-base">
            {viewMode === 'story' ? 'TEXTALIVE STORY' : 'DEVELOPED FRAMES'}
          </p>
          <h1 className="font-display text-[2.15rem] font-black leading-none text-ink sm:text-5xl">
            {viewMode === 'story' ? '自動編集' : '現像完了'}
          </h1>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2 sm:gap-3">
          <div className="grid h-10 grid-cols-2 rounded-md border-2 border-ink bg-paper p-1 sm:h-11">
            <button
              type="button"
              onClick={() => setViewMode('frames')}
              className={`rounded-[3px] px-2 text-[0.68rem] font-black tracking-[0.12em] transition touch-manipulation sm:px-3 sm:text-xs ${
                viewMode === 'frames' ? 'bg-ink text-white' : 'text-ink-light hover:bg-white'
              }`}
              aria-pressed={viewMode === 'frames'}
            >
              FRAMES
            </button>
            <button
              type="button"
              onClick={() => setViewMode('story')}
              className={`rounded-[3px] px-2 text-[0.68rem] font-black tracking-[0.12em] transition touch-manipulation sm:px-3 sm:text-xs ${
                viewMode === 'story' ? 'bg-ink text-white' : 'text-ink-light hover:bg-white'
              }`}
              aria-pressed={viewMode === 'story'}
            >
              STORY
            </button>
          </div>
          <button
            type="button"
            onClick={() => setAllFilters(!allFiltersEnabled)}
            className={`h-10 rounded-md border-2 border-ink px-3 text-xs font-black tracking-[0.14em] transition touch-manipulation sm:h-11 ${
              allFiltersEnabled ? 'bg-yellow text-ink' : 'bg-paper text-ink-light'
            }`}
            aria-pressed={allFiltersEnabled}
            aria-label="すべてのフィルム効果"
          >
            FILM
          </button>
          <div className="font-display text-4xl font-black leading-none text-yellow sm:text-5xl">
            {String(captures.length).padStart(3, '0')}
          </div>
        </div>
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {captures.length === 0 ? (
          <div className="mx-4 my-5 grid h-full min-h-[360px] place-items-center rounded-lg border-2 border-dashed border-ink/40 bg-white/52">
            <div className="text-center">
              <p className="font-display text-4xl font-black text-ink-light">NO FRAMES</p>
              <p className="mt-2 text-sm font-bold text-ink-light">シャッターを切るとここに現像されます</p>
            </div>
          </div>
        ) : viewMode === 'story' ? (
          <div className="grid min-h-full gap-4 px-3 py-4 lg:grid-cols-[minmax(280px,420px)_1fr] lg:px-6">
            <div className="mx-auto w-full max-w-[390px]">
              <div className="overflow-hidden rounded-md border-2 border-ink bg-ink shadow-sketch">
                <div className="relative aspect-[9/16] bg-ink">
                  <MusicLogPreview
                    captures={captures}
                    layoutMode={storyLayoutMode}
                    activeIndex={activeReviewIndex}
                    currentPhrase={reviewCurrentPhrase}
                    currentWord={reviewCurrentWord}
                    currentChordName={reviewCurrentChordName}
                    currentIsChorus={reviewIsChorus}
                    currentVocalIntensity={reviewVocalIntensity}
                    reviewPosition={reviewPosition}
                    reviewStart={reviewRange.start}
                    reviewEnd={reviewRange.end}
                    reviewProgress={reviewProgress}
                    duration={songDuration}
                    getDataUrl={capture => getCaptureDataUrl(capture, isFilterEnabled(capture))}
                  />
                </div>
              </div>
              <button
                ref={playMusicLogButtonRef}
                type="button"
                onClick={toggleReviewPlayback}
                disabled={!isReviewLoaded || storyDirty || storyStatus === 'rendering'}
                className={`mt-3 h-12 w-full rounded-md border-2 border-ink px-4 font-display text-sm font-black tracking-[0.14em] shadow-shutter transition active:translate-y-1 active:shadow-none disabled:opacity-50 ${
                  isReviewPlaying ? 'bg-ink text-white' : 'bg-yellow text-ink hover:bg-white'
                }`}
              >
                {storyStatus === 'rendering'
                  ? 'GENERATING LOG'
                  : storyDirty ? 'REGENERATE FIRST' : isReviewPlaying ? 'PAUSE MUSIC LOG' : 'PLAY MUSIC LOG'}
              </button>
              <p className="mt-2 text-center text-xs font-black leading-relaxed text-ink-light">
                ブラウザ内だけ曲付きで見返せます
              </p>
            </div>

            <div className="grid content-start gap-4">
              <div className="border-y-2 border-ink bg-white px-3 py-4 sm:px-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="font-display text-sm font-black tracking-[0.14em] text-cyan">AUTO PICKS</p>
                    <p className="font-display text-4xl font-black text-ink">{storyFrames.length}</p>
                  </div>
                  <div>
                    <p className="font-display text-sm font-black tracking-[0.14em] text-cyan">CHORUS</p>
                    <p className="font-display text-4xl font-black text-ink">
                      {storyFrames.filter(frame => frame.capture.isChorus).length}
                    </p>
                  </div>
                  <div>
                    <p className="font-display text-sm font-black tracking-[0.14em] text-cyan">FORMAT</p>
                    <p className="font-display text-4xl font-black text-ink">{selectedStoryLabel}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm font-bold leading-relaxed text-ink-light">
                  歌詞タイミング、BPM、コード、VOX強度を使って、撮影ログを短い音楽ログに編集します。
                </p>
              </div>

              <div className="grid gap-2 border-y-2 border-ink bg-white px-3 py-3 sm:grid-cols-3 sm:px-4">
                <div>
                  <p className="font-display text-xs font-black tracking-[0.14em] text-cyan">LOOK</p>
                  <div className="mt-1 grid grid-cols-2 rounded-md border-2 border-ink bg-paper p-1">
                    {[
                      ['stage', 'BLACK'],
                      ['log', 'LOG'],
                    ].map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => updateStoryLayoutMode(mode as StoryLayoutMode)}
                        className={`h-8 rounded-[3px] text-xs font-black tracking-[0.12em] ${
                          storyLayoutMode === mode ? 'bg-ink text-white' : 'text-ink-light hover:bg-white'
                        }`}
                        aria-pressed={storyLayoutMode === mode}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-display text-xs font-black tracking-[0.14em] text-cyan">CUT SPEED</p>
                  <div className="mt-1 grid grid-cols-3 rounded-md border-2 border-ink bg-paper p-1">
                    {[
                      ['auto', 'AUTO'],
                      ['bar', '1 BAR'],
                      ['half', '2 BEAT'],
                    ].map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => updateStoryPacingMode(mode as StoryPacingMode)}
                        className={`h-8 rounded-[3px] text-[0.66rem] font-black tracking-[0.08em] ${
                          storyPacingMode === mode ? 'bg-ink text-white' : 'text-ink-light hover:bg-white'
                        }`}
                        aria-pressed={storyPacingMode === mode}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-display text-xs font-black tracking-[0.14em] text-cyan">DOWNLOAD</p>
                  <div className="mt-1 rounded-md border-2 border-ink bg-paper px-3 py-2">
                    <p className="font-display text-xs font-black tracking-[0.08em] text-ink">
                      VIDEO ONLY
                    </p>
                    <p className="mt-1 text-[0.68rem] font-bold leading-snug text-ink-light">
                      曲付き再生はブラウザ内のPLAY LOGだけ
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <div className="h-3 overflow-hidden rounded-[3px] border-2 border-ink bg-white">
                  <div
                    className="h-full bg-yellow transition-[width]"
                    style={{ width: `${Math.round(storyProgress * 100)}%` }}
                  />
                </div>
                {storyStatus === 'error' && (
                  <p className="rounded-md border-2 border-red-500 bg-white px-3 py-2 text-sm font-bold text-red-700">
                    {storyError}
                  </p>
                )}
                {storyDirty && storyResult && (
                  <p className="rounded-md border-2 border-ink bg-yellow px-3 py-2 text-sm font-black text-ink">
                    {selectedStoryLabel} / {selectedPacingLabel} を反映するには再生成してね
                  </p>
                )}
                {storyStatus === 'ready' && storyResult && (
                  <p className="text-sm font-bold text-ink-light">
                    {Math.round(storyResult.durationMs / 100) / 10}秒 / {storyResult.frameCount}カット / video only / {storyResult.mimeType}
                  </p>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void renderStory({ scrollToPlayback: true })}
                  disabled={storyFrames.length === 0 || storyStatus === 'rendering'}
                  className="h-12 rounded-md border-2 border-ink bg-cyan px-4 text-sm font-black tracking-[0.12em] text-ink shadow-shutter transition hover:bg-cyan/80 active:translate-y-1 active:shadow-none disabled:opacity-50 touch-manipulation"
                >
                  {storyStatus === 'rendering' ? '生成中' : storyDirty ? '再生成' : storyResult ? '再生成' : '動画生成'}
                </button>
                <button
                  type="button"
                  onClick={() => storyResult && downloadBlob(storyResult.blob, storyResult.filename)}
                  disabled={!storyResult}
                  className="h-12 rounded-md border-2 border-ink bg-yellow px-4 text-sm font-black tracking-[0.12em] text-ink shadow-shutter transition hover:bg-white active:translate-y-1 active:shadow-none disabled:opacity-50 touch-manipulation"
                >
                  保存
                </button>
              </div>

              <p className="rounded-md border-2 border-ink bg-white px-3 py-2 text-xs font-black leading-relaxed text-ink-light">
                保存される動画は映像のみです。曲付きの見返しは左のPLAY MUSIC LOGでブラウザ内再生できます。
              </p>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3 border-b-2 border-ink pb-2">
                  <p className="font-display text-sm font-black tracking-[0.14em] text-ink">素材トレイ</p>
                    <p className="text-xs font-black tracking-[0.12em] text-ink-light">CUTS / FILM</p>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {storyFrames.map(frame => (
                  <div
                    key={frame.capture.id}
                    className={`relative overflow-hidden rounded-md border-2 ${
                      frame.capture.isChorus ? 'border-yellow' : 'border-ink'
                    } bg-paper`}
                  >
                    <button
                      type="button"
                      onClick={() => openPreview(frame.index)}
                      className="block w-full text-left"
                      aria-label={`素材 ${frame.index + 1} を原寸プレビュー`}
                    >
                      <img
                        src={frame.dataUrl}
                        alt={`story cut ${frame.index + 1}`}
                        className="aspect-[9/16] w-full object-cover"
                      />
                    </button>
                    <span className="absolute left-1 top-1 rounded-[3px] bg-ink px-1.5 py-0.5 font-display text-xs font-black text-white">
                      {String(frame.index + 1).padStart(2, '0')}
                    </span>
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation()
                        toggleCaptureFilter(frame.capture.id)
                      }}
                      className={`absolute bottom-1 left-1 right-1 h-7 rounded-[3px] border border-ink text-[0.62rem] font-black tracking-[0.08em] ${
                        isFilterEnabled(frame.capture) ? 'bg-yellow text-ink' : 'bg-white text-ink-light'
                      }`}
                      aria-pressed={isFilterEnabled(frame.capture)}
                    >
                      FILM {isFilterEnabled(frame.capture) ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <FilmPerforation />
            {/* Camera-roll grid: 2-col mobile → 3-col tablet → 4-col desktop */}
            <div
              className={`grid gap-3 px-3 py-4 sm:px-4 ${
                captures.length === 1
                  ? 'mx-auto max-w-md grid-cols-1'
                  : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
              }`}
            >
              {captures.map((capture, index) => {
                const captureFilterEnabled = isFilterEnabled(capture)

                return (
                  <motion.article
                    key={capture.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.045, duration: 0.28 }}
                    className="overflow-hidden rounded-md border-2 border-ink bg-paper shadow-sketch"
                  >
                    <button
                      type="button"
                      onClick={() => openPreview(index)}
                      className="block w-full text-left"
                      aria-label={`capture ${index + 1} を原寸プレビュー`}
                    >
                      <img
                        src={getCaptureDataUrl(capture, captureFilterEnabled)}
                        alt={`capture ${index + 1}`}
                        className="w-full object-cover"
                        style={{ aspectRatio: `${capture.width}/${capture.height}` }}
                      />
                    </button>
                    <div className="grid gap-2 p-2">
                      <div className="flex items-center justify-between gap-2 font-display text-xs font-black text-ink sm:text-sm">
                        <span>#{String(index + 1).padStart(3, '0')}</span>
                        <span className="text-cyan">{formatSongTime(capture.songPosition)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCaptureFilter(capture.id)}
                        className={`h-8 rounded-md border-2 border-ink px-2 text-[0.68rem] font-black tracking-[0.12em] transition touch-manipulation sm:text-xs ${
                          captureFilterEnabled ? 'bg-yellow text-ink' : 'bg-white text-ink-light'
                        }`}
                        aria-pressed={captureFilterEnabled}
                        aria-label={`capture ${index + 1} のフィルム効果`}
                      >
                        FILM {captureFilterEnabled ? 'ON' : 'OFF'}
                      </button>
                      {capture.filmPresetLabel && captureFilterEnabled && (
                        <p className="font-display text-[0.68rem] font-black tracking-[0.12em] text-cyan">
                          {capture.filmPresetLabel}
                        </p>
                      )}
                      <p className="line-clamp-2 min-h-[2rem] text-xs font-bold leading-relaxed text-ink">
                        {capture.phrase}
                      </p>
                      <CaptureLogMeta capture={capture} duration={songDuration} compact />
                      <div className="grid gap-1">
                        <button
                          type="button"
                          onClick={() => downloadCapture(capture, index, captureFilterEnabled)}
                          className="h-9 rounded-md border-2 border-ink bg-yellow text-xs font-black tracking-[0.1em] text-ink transition hover:bg-white touch-manipulation"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  </motion.article>
                )
              })}
            </div>
          </>
        )}
      </div>

      {previewCapture && previewIndex !== null && (
        <div
          className="fixed inset-0 z-[80] grid bg-ink/82 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={`capture ${previewIndex + 1} の原寸プレビュー`}
          onClick={closePreview}
        >
          <div
            className="grid max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-6xl self-center justify-self-center overflow-y-auto rounded-md border-2 border-white bg-paper shadow-[10px_10px_0_rgba(255,255,255,0.16)] md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden"
            onClick={event => event.stopPropagation()}
          >
            <div className="grid min-h-0 place-items-center bg-ink p-2 sm:p-4">
              <img
                src={getCaptureDataUrl(previewCapture, previewFilterEnabled)}
                alt={`capture ${previewIndex + 1} preview`}
                className="max-h-[50dvh] max-w-full object-contain md:max-h-[84dvh]"
              />
            </div>

            <aside className="grid content-start gap-3 border-t-2 border-ink bg-white p-3 md:border-l-2 md:border-t-0 md:p-4">
              <div className="flex items-start justify-between gap-3 border-b-2 border-ink pb-3">
                <div>
                  <p className="font-display text-sm font-black tracking-[0.14em] text-cyan">
                    ORIGINAL PREVIEW
                  </p>
                  <h2 className="font-display text-4xl font-black leading-none text-ink">
                    #{String(previewIndex + 1).padStart(3, '0')}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closePreview}
                  className="h-10 w-10 rounded-md border-2 border-ink bg-paper text-lg font-black text-ink transition hover:bg-yellow touch-manipulation"
                  aria-label="プレビューを閉じる"
                >
                  X
                </button>
              </div>

              <p className="text-sm font-black leading-relaxed text-ink">
                {previewCapture.phrase || 'Lyric Lens'}
              </p>

              <div className="grid grid-cols-2 gap-2 text-xs font-black tracking-[0.08em] text-ink-light">
                <span className="border-b border-ink/20 pb-1">TIME {formatSongTime(previewCapture.songPosition)}</span>
                <span className="border-b border-ink/20 pb-1">SONG {Math.round(getCaptureProgress(previewCapture, songDuration) * 100)}%</span>
                <span className="border-b border-ink/20 pb-1">SIZE {previewCapture.width}x{previewCapture.height}</span>
                <span className="border-b border-ink/20 pb-1">CHORD {previewCapture.chordName || '--'}</span>
                <span className="border-b border-ink/20 pb-1">VOX {Math.round((previewCapture.vocalIntensity ?? 0) * 100)}</span>
                <span className="border-b border-ink/20 pb-1">FILM {previewCapture.filmPresetLabel ?? 'RAW'}</span>
              </div>

              <div className="rounded-md border-2 border-ink bg-paper px-3 py-2">
                <p className="font-display text-xs font-black tracking-[0.14em] text-cyan">SYNC REASON</p>
                <p className="mt-1 text-sm font-black leading-relaxed text-ink">
                  {getCaptureReason(previewCapture)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => toggleCaptureFilter(previewCapture.id)}
                className={`h-11 rounded-md border-2 border-ink px-3 text-xs font-black tracking-[0.14em] transition touch-manipulation ${
                  previewFilterEnabled ? 'bg-yellow text-ink' : 'bg-paper text-ink-light'
                }`}
                aria-pressed={previewFilterEnabled}
              >
                FILM {previewFilterEnabled ? 'ON' : 'OFF'}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => movePreview(-1)}
                  className="h-11 rounded-md border-2 border-ink bg-paper text-sm font-black tracking-[0.12em] text-ink transition hover:bg-white touch-manipulation"
                >
                  PREV
                </button>
                <button
                  type="button"
                  onClick={() => movePreview(1)}
                  className="h-11 rounded-md border-2 border-ink bg-paper text-sm font-black tracking-[0.12em] text-ink transition hover:bg-white touch-manipulation"
                >
                  NEXT
                </button>
              </div>

              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => downloadCapture(previewCapture, previewIndex, previewFilterEnabled)}
                  className="h-11 rounded-md border-2 border-ink bg-yellow text-sm font-black tracking-[0.12em] text-ink transition hover:bg-white touch-manipulation"
                >
                  保存
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}

      <footer className="border-t-2 border-ink bg-white px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={onRestart}
          className="h-12 rounded-md border-2 border-ink bg-paper px-5 text-sm font-black tracking-[0.14em] text-ink shadow-shutter transition hover:bg-white active:translate-y-1 active:shadow-none touch-manipulation"
        >
          撮り直す
        </button>
      </footer>
    </section>
  )
}
