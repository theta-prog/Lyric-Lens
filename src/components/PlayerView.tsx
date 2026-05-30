import type { PlayerVideoOptions } from 'textalive-app-api'
import { AnimatePresence, motion } from 'framer-motion'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { useTextAlive } from '../hooks/useTextAlive'
import type { CaptureItem, CurtainPhase, ShutterEffect } from '../types'
import { captureFrame } from '../utils/capture'
import PlaybackBar from './PlaybackBar'

interface ShutterTrigger {
  words: readonly string[]
  effect?: ShutterEffect
  countdown?: {
    steps: readonly number[]
    beatsPerStep?: number
    bpmMultiplier?: number
  }
}

const SHUTTER_TRIGGERS: readonly ShutterTrigger[] = [
  {
    words: ['シャッター', 'しゃったー', 'チャンス', '瞬間', '今', '切り取り'],
    countdown: {
      steps: [3, 2, 1],
      beatsPerStep: 1,
      bpmMultiplier: 2,
    },
  },
  { words: ['ファインダー'],        effect: 'finder' },
  { words: ['フォーカス', '焦点'], effect: 'focus-zoom' },
  { words: ['ピント'],             effect: 'blur-to-clear' },
  { words: ['ストロボ'],           effect: 'strobe' },
  { words: ['スナップ'],           effect: 'snap' },
  { words: ['フレーム'],           effect: 'frame' },
  { words: ['レリーズ'],           effect: 'default' },
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

function findShutterTrigger(text: string) {
  const normalizedText = normalizeText(text)

  return SHUTTER_TRIGGERS.find(trigger =>
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
  videoRef,
}: {
  enabled: boolean
  videoRef: React.RefObject<HTMLVideoElement>
}) {
  if (enabled) {
    return (
      <video
        ref={videoRef}
        muted
        playsInline
        className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
      />
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,#fffefa_0%,#e8fbff_48%,#fff0b8_100%)]">
      <div className="absolute left-[12%] top-[32%] h-[14%] max-h-18 min-h-12 w-[21%] max-w-18 rotate-[-10deg] border-[6px] border-cyan/32 bg-white/18 opacity-70 shadow-sketch sm:left-[10%] sm:top-[25%] sm:h-[18%] sm:max-h-24 sm:w-[24%] sm:max-w-24 sm:border-[8px]" />
      <div className="absolute right-[5%] top-[31%] h-[11%] max-h-14 min-h-11 w-[36%] max-w-30 rotate-[8deg] border-[6px] border-yellow/45 bg-white/18 opacity-75 shadow-sketch sm:top-[26%] sm:h-[13%] sm:max-h-18 sm:max-w-36 sm:border-[7px]" />
      <div className="absolute bottom-[13%] left-[8%] h-[21%] max-h-24 min-h-18 w-[47%] max-w-40 rotate-[3deg] border-[6px] border-ink/8 bg-white/14 opacity-65 shadow-sketch sm:bottom-[12%] sm:h-[23%] sm:max-h-28 sm:max-w-44 sm:border-[7px]" />
      <div className="absolute bottom-[15%] right-[10%] h-[15%] max-h-18 min-h-12 w-[20%] max-w-18 rotate-[-8deg] rounded-full border-[8px] border-cyan/18 bg-yellow/18 opacity-75 sm:bottom-[14%] sm:h-[16%] sm:max-h-20 sm:max-w-20 sm:border-[9px]" />
      <div className="sketch-lines" aria-hidden="true" />
    </div>
  )
})

const ViewfinderOverlay = memo(function ViewfinderOverlay({
  afPulse,
  bpm,
  songTitle,
  shotCount,
}: {
  afPulse: number
  bpm: number
  songTitle: string
  shotCount: number
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute inset-x-5 top-4 flex items-center justify-between gap-3 font-display text-base font-black text-ink/70 sm:inset-x-7 sm:text-xl">
        <span>SS {formatSpeed(bpm)}</span>
        <span>f/1.8&nbsp;&nbsp;ISO AUTO</span>
      </div>

      <div className="absolute inset-x-5 bottom-4 flex items-center justify-between gap-3 font-display text-base font-black text-ink/70 sm:inset-x-7 sm:text-lg">
        <span className="max-w-[52%] truncate">{songTitle || 'shutter chance'}</span>
        <span className="text-yellow">● {String(shotCount).padStart(4, '0')}</span>
      </div>

      <motion.div
        key={afPulse}
        className="absolute inset-x-[9%] bottom-[15%] top-[22%] border-2 border-dashed border-cyan/50 sm:inset-x-[9%] sm:bottom-[12%] sm:top-[13%]"
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
        className="max-w-[min(920px,92vw)] rounded-md border border-white/16 bg-ink/68 px-5 py-3 text-center shadow-[0_18px_48px_rgba(0,0,0,0.2)] backdrop-blur sm:px-8 sm:py-4"
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

  return null
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

  const camera = useCamera()

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
    navigator.vibrate?.(30)
    setAfPulse(value => value + 1)
    await wait(50)
    setCurtainPhase('closing')
    await wait(90)

    const phrase = phraseRef.current || wordRef.current || 'shutter chance'
    const frameNumber = capturesRef.current.length + 1
    const frameRect = frameRef.current?.getBoundingClientRect()
    const capturedFrame = captureFrame(
      camera.enabled && videoRef.current ? videoRef.current : null,
      phrase,
      songTitleRef.current,
      frameNumber,
      frameRect ? { width: frameRect.width, height: frameRect.height } : undefined,
    )

    appendCapture({
      id: `${Date.now()}-${frameNumber}`,
      dataUrl: capturedFrame.dataUrl,
      width: capturedFrame.width,
      height: capturedFrame.height,
      phrase,
      timestamp: Date.now(),
      songPosition: songPositionRef.current,
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
    async (trigger: ShutterTrigger, triggerText: string, triggerTime: number) => {
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
                : { scale: 1, rotate: 0 }
            }
            transition={{ type: 'spring', stiffness: 130, damping: 14 }}
          >
            <CameraBackdrop enabled={camera.enabled} videoRef={videoRef} />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,transparent_0%,transparent_57%,rgba(26,26,31,0.18)_100%)]" />
          </motion.div>

          <ViewfinderOverlay
            afPulse={afPulse}
            bpm={bpm}
            songTitle={songTitle}
            shotCount={captures.length}
          />
          <LyricDisplay phrase={currentPhrase} word={currentWord} />
          <CountdownOverlay value={countdownValue} />
          <EffectOverlay effect={activeEffect} effectKey={effectKey} />
          <ShutterCurtain phase={curtainPhase} flashKey={flashKey} />

          <div className="absolute left-4 top-14 z-40 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { void camera.toggle() }}
              className="rounded-md border-2 border-ink bg-white/72 px-3 py-2 text-xs font-black tracking-[0.1em] backdrop-blur transition hover:bg-white"
              aria-pressed={camera.enabled}
              aria-label="カメラのオンオフ"
            >
              CAMERA
            </button>
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
        onFinish={finish}
        onSeek={seek}
        onSeekStart={seekStart}
        onSeekEnd={seekEnd}
      />
    </section>
  )
}
