import { useCallback, useEffect, useRef, useState } from 'react'
import type { IPlayerApp, IVideo, Player as PlayerClass, PlayerVideoOptions } from 'textalive-app-api'

const SONGLE_DEV_PROXY_PREFIX = '/__songle_proxy'
const DEBUG_LYRICS_QUERY = 'debugLyrics'

let songleProxyInstalled = false

function rewriteSongleUrlForDev(url: string) {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return url
  }

  try {
    const resolved = new URL(url, window.location.origin)
    if (!resolved.hostname.endsWith('songle.jp')) {
      return url
    }

    return `${SONGLE_DEV_PROXY_PREFIX}/${resolved.hostname}${resolved.pathname}${resolved.search}`
  } catch {
    return url
  }
}

function installSongleDevProxy() {
  if (!import.meta.env.DEV || songleProxyInstalled || typeof window === 'undefined') {
    return
  }

  const originalOpen = XMLHttpRequest.prototype.open

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    const nextUrl =
      typeof url === 'string'
        ? rewriteSongleUrlForDev(url)
        : rewriteSongleUrlForDev(url.toString())

    return originalOpen.call(this, method, nextUrl, async ?? true, username ?? undefined, password ?? undefined)
  }

  songleProxyInstalled = true
}

function shouldDebugLyrics() {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).has(DEBUG_LYRICS_QUERY)
}

function setDebugPlayerHandle(player: PlayerClass | null, enabled: boolean) {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return
  }

  const debugWindow = window as typeof window & {
    __textAliveDebug?: {
      player: PlayerClass | null
      getSnapshot: () => {
        timerPosition: number
        mediaPosition: number
        videoPosition: number
        audioCurrentTime: number | null
        audioDuration: number | null
        isPlaying: boolean
      } | null
    }
  }

  if (!enabled || !player) {
    delete debugWindow.__textAliveDebug
    return
  }

  debugWindow.__textAliveDebug = {
    player,
    getSnapshot: () => {
      const activePlayer = debugWindow.__textAliveDebug?.player ?? null
      if (!activePlayer) {
        return null
      }

      const mediaElement = (activePlayer as any).mediaSourceElement as HTMLElement | null
      const audioElement = mediaElement?.querySelector?.('audio') as HTMLAudioElement | null

      return {
        timerPosition: Math.round(((activePlayer as any).timer?.position ?? 0) as number),
        mediaPosition: Math.round(((activePlayer as any).mediaPosition ?? 0) as number),
        videoPosition: Math.round(((activePlayer as any).videoPosition ?? 0) as number),
        audioCurrentTime: audioElement ? Math.round(audioElement.currentTime * 1000) : null,
        audioDuration:
          audioElement && Number.isFinite(audioElement.duration)
            ? Math.round(audioElement.duration * 1000)
            : null,
        isPlaying: Boolean((activePlayer as any).isPlaying),
      }
    },
  }
}

export interface TextAliveState {
  isLoaded: boolean
  isPlaying: boolean
  currentPhrase: string
  currentWord: string
  progress: number
  duration: number
  songTitle: string
  bpm: number
  error: string | null
}

type PhraseChangeCb = (newPhrase: string, prevPhrase: string) => void
type WordChangeCb = (newWord: string, prevWord: string, position: number) => void
type PositionUpdateCb = (position: number, duration: number) => void

const LYRIC_EARLY_TOLERANCE_MS = 24
const LYRIC_LATE_TOLERANCE_MS = 48
const LYRIC_HOLD_MS = 80
const STARTUP_LYRIC_SYNC_WINDOW_MS = 320

function isActiveTimedUnit(unit: any, position: number) {
  if (!unit || typeof unit.startTime !== 'number' || typeof unit.endTime !== 'number') {
    return false
  }

  return (
    position >= unit.startTime - LYRIC_EARLY_TOLERANCE_MS &&
    position <= unit.endTime + LYRIC_LATE_TOLERANCE_MS
  )
}

function findActiveTimedUnit(
  findUnit: ((position: number) => any) | undefined,
  position: number,
) {
  if (!findUnit) {
    return null
  }

  const currentUnit = findUnit(position) ?? null
  if (isActiveTimedUnit(currentUnit, position)) {
    return currentUnit
  }

  const nextUnit = findUnit(position + LYRIC_EARLY_TOLERANCE_MS) ?? null
  return isActiveTimedUnit(nextUnit, position) ? nextUnit : null
}

export function useTextAlive(
  mediaRef: React.RefObject<HTMLElement>,
  token: string,
  songUrl: string,
  songOptions?: PlayerVideoOptions,
  onPhraseChange?: PhraseChangeCb,
  onWordChange?: WordChangeCb,
  onPositionUpdate?: PositionUpdateCb,
) {
  const playerRef = useRef<PlayerClass | null>(null)
  const onPhraseChangeRef = useRef<PhraseChangeCb | undefined>(onPhraseChange)
  const onWordChangeRef = useRef<WordChangeCb | undefined>(onWordChange)
  const onPositionUpdateRef = useRef<PositionUpdateCb | undefined>(onPositionUpdate)
  const prevPhraseRef = useRef('')
  const prevWordRef = useRef('')
  const lastActiveLyricRef = useRef({ phrase: '', word: '', endTime: -Infinity })
  const lyricOffsetRef = useRef(0)
  const lyricRateRef = useRef(1)
  const debugLyricsRef = useRef(false)
  const startupSyncFrameRef = useRef<number | null>(null)
  const firstTimeUpdateLoggedRef = useRef(false)

  const [state, setState] = useState<TextAliveState>({
    isLoaded: false,
    isPlaying: false,
    currentPhrase: '',
    currentWord: '',
    progress: 0,
    duration: 0,
    songTitle: '',
    bpm: 0,
    error: null,
  })

  onPhraseChangeRef.current = onPhraseChange
  onWordChangeRef.current = onWordChange
  onPositionUpdateRef.current = onPositionUpdate

  useEffect(() => {
    if (!token || !songUrl) return
    const mediaElement = mediaRef.current
    if (!mediaElement) return

    installSongleDevProxy()

    let disposed = false
    debugLyricsRef.current = shouldDebugLyrics()
    prevPhraseRef.current = ''
    prevWordRef.current = ''
    lastActiveLyricRef.current = { phrase: '', word: '', endTime: -Infinity }
    firstTimeUpdateLoggedRef.current = false
    setState(current => ({
      ...current,
      isLoaded: false,
      isPlaying: false,
      currentPhrase: '',
      currentWord: '',
      progress: 0,
      error: null,
    }))

    ;(async () => {
      try {
        const { Player } = await import('textalive-app-api')
        if (disposed) return

        const player = new Player({
          app: { token },
          mediaElement,
        })
        playerRef.current = player
        setDebugPlayerHandle(player, debugLyricsRef.current)

        const stopStartupLyricSync = () => {
          if (startupSyncFrameRef.current !== null) {
            window.cancelAnimationFrame(startupSyncFrameRef.current)
            startupSyncFrameRef.current = null
          }
        }

        const syncLyrics = (audioPosition: number) => {
          const video = (player as any).video
          const duration: number = video?.duration ?? 1
          const lyricPosition = Math.max(
            0,
            audioPosition * lyricRateRef.current + lyricOffsetRef.current,
          )
          onPositionUpdateRef.current?.(audioPosition, duration)

          const phrase = findActiveTimedUnit(video?.findPhrase?.bind(video), lyricPosition)
          const word = findActiveTimedUnit(video?.findWord?.bind(video), lyricPosition)
          const activePhraseText: string = phrase?.text ?? word?.parent?.text ?? ''
          const activeWordText: string = word?.text ?? ''
          const activeLyricEndTime: number = phrase?.endTime ?? word?.parent?.endTime ?? word?.endTime ?? -Infinity

          if (activePhraseText) {
            lastActiveLyricRef.current = {
              phrase: activePhraseText,
              word: activeWordText,
              endTime: activeLyricEndTime,
            }
          }

          const shouldHoldPreviousLyric =
            !activePhraseText &&
            lastActiveLyricRef.current.phrase &&
            lyricPosition <= lastActiveLyricRef.current.endTime + LYRIC_HOLD_MS
          const text = shouldHoldPreviousLyric
              ? lastActiveLyricRef.current.phrase
              : activePhraseText
          const wordText = shouldHoldPreviousLyric ? '' : activeWordText
          const phraseChanged = text !== prevPhraseRef.current
          const prevPhrase = prevPhraseRef.current
          if (phraseChanged) {
            prevPhraseRef.current = text
          }

          const wordChanged = wordText !== prevWordRef.current
          const prevWord = prevWordRef.current
          if (wordChanged) {
            prevWordRef.current = wordText
          }

          if (debugLyricsRef.current && (phraseChanged || wordChanged)) {
            console.debug('[lyrics-transition]', {
              audioPosition: Math.round(audioPosition),
              lyricPosition: Math.round(lyricPosition),
              lyricOffset: lyricOffsetRef.current,
              lyricRate: Number(lyricRateRef.current.toFixed(4)),
              phrase: text,
              word: wordText,
              phraseStart: phrase ? Math.round(phrase.startTime) : null,
              phraseEnd: phrase ? Math.round(phrase.endTime) : null,
              wordStart: word ? Math.round(word.startTime) : null,
              wordEnd: word ? Math.round(word.endTime) : null,
              hold: shouldHoldPreviousLyric,
            })
          }

          if (phraseChanged || wordChanged) {
            setState(current => ({
              ...current,
              currentPhrase: phraseChanged ? text : current.currentPhrase,
              currentWord: wordChanged ? wordText : current.currentWord,
            }))
          }

          if (phraseChanged) {
            onPhraseChangeRef.current?.(text, prevPhrase)
          }

          if (wordChanged) {
            onWordChangeRef.current?.(wordText, prevWord, audioPosition)
          }
        }

        const startStartupLyricSync = () => {
          stopStartupLyricSync()

          const deadline = performance.now() + STARTUP_LYRIC_SYNC_WINDOW_MS

          const tick = () => {
            if (disposed) {
              stopStartupLyricSync()
              return
            }

            const audioPosition: number = (player as any).timer?.position ?? 0
            syncLyrics(audioPosition)

            if (prevPhraseRef.current || performance.now() >= deadline) {
              startupSyncFrameRef.current = null
              return
            }

            startupSyncFrameRef.current = window.requestAnimationFrame(tick)
          }

          tick()
        }

        player.addListener({
          onAppReady(app: IPlayerApp) {
            if (!app.songUrl) {
              void player.createFromSongUrl(songUrl, songOptions).catch(() => {
                if (!disposed) {
                  setState(current => ({
                    ...current,
                    error: 'Songle から楽曲データを取得できませんでした。開発中は Vite を再起動してください。',
                  }))
                }
              })
            }
          },
          onVideoReady(video: IVideo) {
            setState(current => ({
              ...current,
              songTitle: (video as any).song?.title ?? '',
              duration: (video as any).duration ?? 0,
              error: null,
            }))
          },
          onTimerReady() {
            const video = (player as any).video
            const firstBeat = video?.firstBeat ?? video?.findBeat?.(0)
            const bpm = firstBeat?.duration ? Math.round(60000 / firstBeat.duration) : 0
            if (debugLyricsRef.current) {
              const firstPhrase = video?.firstPhrase ?? null
              const firstWord = video?.firstWord ?? null
              const firstChar = video?.firstChar ?? null

              console.debug('[lyrics-metadata]', {
                videoStart: Math.round(video?.startTime ?? 0),
                firstPhraseStart: Math.round(firstPhrase?.startTime ?? -1),
                firstWordStart: Math.round(firstWord?.startTime ?? -1),
                firstCharStart: Math.round(firstChar?.startTime ?? -1),
                firstPhrase: firstPhrase?.text ?? '',
                firstWord: firstWord?.text ?? '',
                firstChar: firstChar?.text ?? '',
              })
            }
            setState(current => ({ ...current, isLoaded: true, bpm }))
          },
          onPlay() {
            setState(current => ({ ...current, isPlaying: true }))
            if (!prevPhraseRef.current && !prevWordRef.current) {
              startStartupLyricSync()
            }
          },
          onPause() {
            stopStartupLyricSync()
            setState(current => ({ ...current, isPlaying: false }))
          },
          onStop() {
            stopStartupLyricSync()
            setState(current => ({
              ...current,
              isPlaying: false,
              currentPhrase: '',
              currentWord: '',
              progress: 0,
            }))
            prevPhraseRef.current = ''
            prevWordRef.current = ''
            lastActiveLyricRef.current = { phrase: '', word: '', endTime: -Infinity }
          },
          onTimeUpdate(pos: number) {
            if (debugLyricsRef.current && !firstTimeUpdateLoggedRef.current) {
              firstTimeUpdateLoggedRef.current = true
              console.debug('[lyrics-first-timeupdate]', {
                audioPosition: Math.round(pos),
              })
            }
            syncLyrics(pos)
          },
          onThrottledTimeUpdate(pos: number) {
            const video = (player as any).video
            const duration: number = video?.duration ?? 1
            const position: number = pos

            setState(current => ({
              ...current,
              progress: Math.min(1, Math.max(0, position / duration)),
              duration,
            }))
          },
        })
      } catch {
        if (!disposed) {
          setState(current => ({
            ...current,
            error: 'TextAlive の初期化に失敗しました。トークンと曲URLを確認してください。',
          }))
        }
      }
    })()

    return () => {
      disposed = true
      setDebugPlayerHandle(null, debugLyricsRef.current)
      if (typeof window !== 'undefined' && startupSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(startupSyncFrameRef.current)
        startupSyncFrameRef.current = null
      }
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [mediaRef, songOptions, songUrl, token])

  const play = useCallback(() => playerRef.current?.requestPlay(), [])
  const pause = useCallback(() => playerRef.current?.requestPause(), [])
  const stop = useCallback(() => playerRef.current?.requestStop?.(), [])

  const seekStart = useCallback(() => {
    playerRef.current?.startVideoSeek?.()
  }, [])

  const seekEnd = useCallback((ratio: number) => {
    const player = playerRef.current
    if (!player) return
    const duration: number = (player as any).video?.duration ?? 0
    if (!duration) return
    player.requestMediaSeek(ratio * duration)
    player.endVideoSeek?.()
  }, [])

  const seek = useCallback((ratio: number) => {
    const player = playerRef.current
    if (!player) return
    const duration: number = (player as any).video?.duration ?? 0
    if (!duration) return
    player.requestMediaSeek(ratio * duration)
  }, [])

  return { ...state, play, pause, stop, seek, seekStart, seekEnd }
}
