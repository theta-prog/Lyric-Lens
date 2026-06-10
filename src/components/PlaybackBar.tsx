import { useState } from 'react'
import type { FilmPresetId } from '../types'

interface FilmControlPreset {
  id: FilmPresetId
  label: string
  shortLabel: string
  swatch: string
}

interface PlaybackBarProps {
  isLoaded: boolean
  isPlaying: boolean
  progress: number
  shotCount: number
  autoMode: boolean
  filterEnabled: boolean
  filmPresets: readonly FilmControlPreset[]
  selectedFilmPresetId: FilmPresetId
  onPlay: () => void
  onPause: () => void
  onShutter: () => void
  onToggleAutoMode: () => void
  onToggleFilter: () => void
  onSelectFilm: (presetId: FilmPresetId) => void
  onFinish: () => void
  onSeek: (ratio: number) => void
  onSeekStart: () => void
  onSeekEnd: (ratio: number) => void
}

export default function PlaybackBar({
  isLoaded,
  isPlaying,
  progress,
  shotCount,
  autoMode,
  filterEnabled,
  filmPresets,
  selectedFilmPresetId,
  onPlay,
  onPause,
  onShutter,
  onToggleAutoMode,
  onToggleFilter,
  onSelectFilm,
  onFinish,
  onSeek,
  onSeekStart,
  onSeekEnd,
}: PlaybackBarProps) {
  const [dragValue, setDragValue] = useState<number | null>(null)
  const value = dragValue ?? Math.round(progress * 1000)

  return (
    <div className="border-t-2 border-ink bg-white/72 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur md:px-5">
      <input
        type="range"
        min={0}
        max={1000}
        value={value}
        disabled={!isLoaded}
        aria-label="再生位置"
        onPointerDown={() => {
          setDragValue(Math.round(progress * 1000))
          onSeekStart()
        }}
        onChange={event => {
          const nextValue = Number(event.target.value)
          setDragValue(nextValue)
          onSeek(nextValue / 1000)
        }}
        onPointerUp={event => {
          const nextValue = Number((event.target as HTMLInputElement).value)
          onSeekEnd(nextValue / 1000)
          setDragValue(null)
        }}
        className="w-full accent-yellow disabled:opacity-40"
      />

      {/*
        Two-row on mobile: controls top, shutter centered below.
        Single row on sm+: all inline (shutter wrapper collapses to auto width).
      */}
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={!isLoaded}
          className="control-button h-11 w-11 shrink-0 text-base touch-manipulation"
          aria-label={isPlaying ? '一時停止' : '再生'}
        >
          {isPlaying ? 'II' : '▶'}
        </button>

        <button
          type="button"
          onClick={onToggleAutoMode}
          className={`h-11 shrink-0 rounded-md border-2 border-ink px-3 text-xs font-black tracking-[0.14em] transition touch-manipulation ${
            autoMode ? 'bg-cyan text-ink' : 'bg-paper text-ink-light'
          }`}
          aria-pressed={autoMode}
          aria-label="自動シャッター"
        >
          AUTO
        </button>

        <div className="film-loader flex min-w-0 flex-1 items-center gap-1 rounded-md border-2 border-ink bg-paper p-1 sm:flex-none">
          <button
            type="button"
            onClick={onToggleFilter}
            className={`h-9 shrink-0 rounded-[3px] px-2 text-[0.68rem] font-black tracking-[0.12em] transition touch-manipulation sm:px-3 sm:text-xs ${
              filterEnabled ? 'bg-yellow text-ink' : 'bg-white text-ink-light'
            }`}
            aria-pressed={filterEnabled}
            aria-label="フィルム効果"
          >
            FILM
          </button>
          <div className="flex min-w-0 gap-1 overflow-x-auto">
            {filmPresets.map(preset => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectFilm(preset.id)}
                className={`film-loader-option h-9 shrink-0 rounded-[3px] border px-2 text-[0.66rem] font-black tracking-[0.08em] transition touch-manipulation sm:text-[0.72rem] ${
                  selectedFilmPresetId === preset.id && filterEnabled
                    ? 'border-ink bg-white text-ink'
                    : 'border-ink/32 bg-white/62 text-ink-light'
                }`}
                aria-pressed={selectedFilmPresetId === preset.id && filterEnabled}
                aria-label={`${preset.label} を装填`}
              >
                <span className="film-loader-swatch" style={{ background: preset.swatch }} aria-hidden="true" />
                <span>{preset.shortLabel}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-10 shrink-0 font-display text-xl font-black tabular-nums text-ink sm:min-w-16 sm:text-2xl">
          {String(shotCount).padStart(3, '0')}
        </div>

        {/* Spacer: only active on sm+ to push DONE+shutter right */}
        <div className="hidden flex-1 sm:block" />

        <button
          type="button"
          onClick={onFinish}
          className="ml-auto h-11 shrink-0 rounded-md border-2 border-ink bg-paper px-4 text-sm font-black tracking-[0.1em] text-ink transition hover:bg-white touch-manipulation sm:ml-0"
        >
          現像
        </button>

        {/* Shutter: wraps to its own centered row on mobile, inline on sm+ */}
        <div className="order-last flex w-full justify-center pt-1 sm:order-none sm:w-auto sm:pt-0">
          <button
            type="button"
            onClick={onShutter}
            disabled={!isLoaded}
            className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full border-[6px] border-ink bg-white shadow-shutter transition touch-manipulation enabled:active:translate-y-1 enabled:active:shadow-none disabled:opacity-40 sm:h-16 sm:w-16"
            aria-label="シャッター"
          >
            <span className="block h-10 w-10 rounded-full bg-yellow ring-4 ring-cyan/40 sm:h-9 sm:w-9" />
          </button>
        </div>
      </div>
    </div>
  )
}
