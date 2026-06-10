import { motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptureItem } from '../types'
import { createStoryVideo, selectStoryFrames, type StoryFrame, type StoryVideoResult } from '../utils/storyVideo'

interface ResultViewProps {
  captures: CaptureItem[]
  onRestart: () => void
}

function formatSongTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
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

async function shareCapture(capture: CaptureItem, index: number, filterEnabled: boolean) {
  const filename = getCaptureFilename(index, filterEnabled)

  if (!('share' in navigator)) {
    downloadCapture(capture, index, filterEnabled)
    return
  }

  try {
    const res = await fetch(getCaptureDataUrl(capture, filterEnabled))
    const blob = await res.blob()
    const file = new File([blob], filename, { type: 'image/jpeg' })
    const shareData = { files: [file], title: 'Lyric Lens', text: capture.phrase }

    if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
      await navigator.share(shareData)
    } else {
      downloadCapture(capture, index, filterEnabled)
    }
  } catch {
    // User cancelled — don't fall back to download
  }
}

async function shareStory(result: StoryVideoResult) {
  const file = new File([result.blob], result.filename, { type: result.mimeType })
  const shareData = {
    files: [file],
    title: 'Lyric Lens',
    text: 'TextAlive auto edit story',
  }

  if (
    'share' in navigator &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare(shareData)
  ) {
    await navigator.share(shareData)
    return
  }

  downloadBlob(result.blob, result.filename)
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

export default function ResultView({ captures, onRestart }: ResultViewProps) {
  const [viewMode, setViewMode] = useState<'frames' | 'story'>('story')
  const [filterByCaptureId, setFilterByCaptureId] = useState<Record<string, boolean>>({})
  const [storyResult, setStoryResult] = useState<StoryVideoResult | null>(null)
  const [storyUrl, setStoryUrl] = useState('')
  const [storyProgress, setStoryProgress] = useState(0)
  const [storyStatus, setStoryStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle')
  const [storyError, setStoryError] = useState('')
  const [storyDirty, setStoryDirty] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const abortStoryRef = useRef<AbortController | null>(null)
  const autoStoryStartedRef = useRef(false)
  const isFilterEnabled = (capture: CaptureItem) =>
    filterByCaptureId[capture.id] ?? capture.filterEnabledAtCapture ?? true
  const allFiltersEnabled = captures.every(capture => isFilterEnabled(capture))
  const previewCapture = previewIndex !== null ? captures[previewIndex] : null
  const previewFilterEnabled = previewCapture ? isFilterEnabled(previewCapture) : true
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

  useEffect(() => {
    if (!storyResult) {
      setStoryUrl(current => {
        if (current) URL.revokeObjectURL(current)
        return ''
      })
      return
    }

    const url = URL.createObjectURL(storyResult.blob)
    setStoryUrl(current => {
      if (current) URL.revokeObjectURL(current)
      return url
    })

    return () => URL.revokeObjectURL(url)
  }, [storyResult])

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
  const renderStory = async () => {
    if (storyStatus === 'rendering') return

    abortStoryRef.current?.abort()
    const controller = new AbortController()
    abortStoryRef.current = controller
    setStoryStatus('rendering')
    setStoryProgress(0)
    setStoryError('')
    setStoryResult(null)

    try {
      const result = await createStoryVideo(storyFrames, {
        signal: controller.signal,
        onProgress: setStoryProgress,
      })
      setStoryResult(result)
      setStoryStatus('ready')
      setStoryDirty(false)
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

  return (
    <section className="grid min-h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-paper">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink bg-white px-4 py-4 sm:px-6">
        <div>
          <p className="font-display text-lg font-black tracking-[0.16em] text-cyan">
            {viewMode === 'story' ? 'TEXTALIVE STORY' : 'DEVELOPED FRAMES'}
          </p>
          <h1 className="font-display text-5xl font-black leading-none text-ink sm:text-7xl">
            {viewMode === 'story' ? '自動編集' : '現像完了'}
          </h1>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-3">
          <div className="grid h-11 grid-cols-2 rounded-md border-2 border-ink bg-paper p-1">
            <button
              type="button"
              onClick={() => setViewMode('frames')}
              className={`rounded-[3px] px-3 text-xs font-black tracking-[0.12em] transition touch-manipulation ${
                viewMode === 'frames' ? 'bg-ink text-white' : 'text-ink-light hover:bg-white'
              }`}
              aria-pressed={viewMode === 'frames'}
            >
              FRAMES
            </button>
            <button
              type="button"
              onClick={() => setViewMode('story')}
              className={`rounded-[3px] px-3 text-xs font-black tracking-[0.12em] transition touch-manipulation ${
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
            className={`h-11 rounded-md border-2 border-ink px-3 text-xs font-black tracking-[0.14em] transition touch-manipulation ${
              allFiltersEnabled ? 'bg-yellow text-ink' : 'bg-paper text-ink-light'
            }`}
            aria-pressed={allFiltersEnabled}
            aria-label="すべてのフィルム効果"
          >
            FILM
          </button>
          <div className="font-display text-5xl font-black text-yellow">
            {String(captures.length).padStart(3, '0')}
          </div>
        </div>
      </header>

      <div className="min-h-0 overflow-auto">
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
                  {storyUrl ? (
                    <video
                      src={storyUrl}
                      controls
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="relative h-full overflow-hidden bg-ink">
                      <img
                        src={storyFrames[0]?.dataUrl}
                        alt="story preview"
                        className="h-full w-full object-cover opacity-90"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
                      <div className="absolute bottom-6 left-5 right-5">
                        <p className="font-display text-2xl font-black tracking-[0.14em] text-yellow">
                          TEXTALIVE AUTO EDIT
                        </p>
                        <p className="mt-2 text-2xl font-black leading-tight text-white">
                          {storyFrames[0]?.capture.phrase ?? 'Lyric Lens'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
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
                    <p className="font-display text-4xl font-black text-ink">9:16</p>
                  </div>
                </div>
                <p className="mt-3 text-sm font-bold leading-relaxed text-ink-light">
                  歌詞タイミング、サビ判定、コード、VOX強度を使って、投稿しやすい縦動画に自動編集します。
                </p>
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
                    FILM変更を反映するには再生成してね
                  </p>
                )}
                {storyStatus === 'ready' && storyResult && (
                  <p className="text-sm font-bold text-ink-light">
                    {Math.round(storyResult.durationMs / 100) / 10}秒 / {storyResult.frameCount}カット / {storyResult.mimeType}
                  </p>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => void renderStory()}
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
                <button
                  type="button"
                  onClick={() => storyResult && void shareStory(storyResult)}
                  disabled={!storyResult}
                  className="h-12 rounded-md border-2 border-ink bg-paper px-4 text-sm font-black tracking-[0.12em] text-ink shadow-shutter transition hover:bg-white active:translate-y-1 active:shadow-none disabled:opacity-50 touch-manipulation"
                >
                  共有
                </button>
              </div>

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
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => void shareCapture(capture, index, captureFilterEnabled)}
                          className="h-9 rounded-md border-2 border-ink bg-cyan text-xs font-black tracking-[0.1em] text-ink transition hover:bg-cyan/80 touch-manipulation"
                        >
                          共有
                        </button>
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
                <span className="border-b border-ink/20 pb-1">SIZE {previewCapture.width}x{previewCapture.height}</span>
                <span className="border-b border-ink/20 pb-1">CHORD {previewCapture.chordName || '--'}</span>
                <span className="border-b border-ink/20 pb-1">VOX {Math.round((previewCapture.vocalIntensity ?? 0) * 100)}</span>
                <span className="border-b border-ink/20 pb-1">FILM {previewCapture.filmPresetLabel ?? 'RAW'}</span>
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

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void shareCapture(previewCapture, previewIndex, previewFilterEnabled)}
                  className="h-11 rounded-md border-2 border-ink bg-cyan text-sm font-black tracking-[0.12em] text-ink transition hover:bg-cyan/80 touch-manipulation"
                >
                  共有
                </button>
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
