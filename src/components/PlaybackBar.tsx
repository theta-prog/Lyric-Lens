import { useState } from 'react'

interface PlaybackBarProps {
  isLoaded: boolean
  isPlaying: boolean
  progress: number
  shotCount: number
  autoMode: boolean
  onPlay: () => void
  onPause: () => void
  onShutter: () => void
  onToggleAutoMode: () => void
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
  onPlay,
  onPause,
  onShutter,
  onToggleAutoMode,
  onFinish,
  onSeek,
  onSeekStart,
  onSeekEnd,
}: PlaybackBarProps) {
  const [dragValue, setDragValue] = useState<number | null>(null)
  const value = dragValue ?? Math.round(progress * 1000)

  return (
    <div className="border-t-2 border-ink bg-white/72 px-3 py-3 backdrop-blur md:px-5">
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

      <div className="mt-3 flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={!isLoaded}
          className="control-button h-11 w-11 text-base"
          aria-label={isPlaying ? '一時停止' : '再生'}
        >
          {isPlaying ? 'II' : '▶'}
        </button>

        <button
          type="button"
          onClick={onToggleAutoMode}
          className={`h-11 rounded-md border-2 border-ink px-3 text-xs font-black tracking-[0.14em] transition ${
            autoMode ? 'bg-cyan text-ink' : 'bg-paper text-ink-light'
          }`}
          aria-pressed={autoMode}
        >
          AUTO
        </button>

        <div className="min-w-16 font-display text-2xl font-black tabular-nums text-ink">
          {String(shotCount).padStart(3, '0')}
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onFinish}
          className="h-11 rounded-md border-2 border-ink bg-paper px-3 text-xs font-black tracking-[0.12em] text-ink transition hover:bg-white"
        >
          DONE
        </button>

        <button
          type="button"
          onClick={onShutter}
          disabled={!isLoaded}
          className="grid h-16 w-16 place-items-center rounded-full border-[6px] border-ink bg-white shadow-shutter transition enabled:active:translate-y-1 enabled:active:shadow-none disabled:opacity-40"
          aria-label="シャッター"
        >
          <span className="block h-9 w-9 rounded-full bg-yellow ring-4 ring-cyan/40" />
        </button>
      </div>
    </div>
  )
}
