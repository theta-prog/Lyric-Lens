import { useState } from 'react'
import type { SetupConfig } from '../types'

const HAS_TEXTALIVE_TOKEN = Boolean(import.meta.env.VITE_TEXTALIVE_TOKEN?.trim())

interface PresetSong extends SetupConfig {
  label: string
}

const PRESET_SONGS: readonly PresetSong[] = [
  {
    label: 'シャッターチャンス',
    songUrl: 'https://piapro.jp/t/PNpQ/20251209170719',
    songOptions: {
      video: {
        beatId: 4827295,
        chordId: 2963756,
        repetitiveSegmentId: 3086263,
        lyricId: 126542,
        lyricDiffId: 28628,
      },
    },
  },
  {
    label: 'カスタム URL',
    songUrl: '',
  },
]

interface TokenSetupProps {
  onStart: (config: SetupConfig) => void
}

export default function TokenSetup({ onStart }: TokenSetupProps) {
  const [songIndex, setSongIndex] = useState(0)
  const [customUrl, setCustomUrl] = useState('')

  const selectedSong = PRESET_SONGS[songIndex]
  const songUrl = selectedSong.songUrl || customUrl
  const canStart = HAS_TEXTALIVE_TOKEN && songUrl.trim() !== ''

  return (
    <section className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-8 sm:px-6">
      <div className="absolute inset-0 setup-paper" aria-hidden="true" />
      <div className="absolute inset-x-0 top-0 h-2 bg-[linear-gradient(90deg,#3dd6e8,#f5c842,#3dd6e8)]" />

      <div className="relative w-full max-w-xl">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 h-16 w-24 rotate-[-6deg] border-[6px] border-ink bg-white shadow-sketch">
            <div className="h-full w-full border-2 border-cyan" />
          </div>
          <h1 className="font-display text-[4rem] font-black leading-none text-ink sm:text-[5.6rem]">
            shutter
            <span className="block text-cyan drop-shadow-[3px_3px_0_#f5c842]">chance</span>
          </h1>
          <p className="mt-3 text-sm font-bold tracking-[0.28em] text-ink-light">
            LYRIC VIEWFINDER
          </p>
        </div>

        <form
          className="rounded-lg border-2 border-ink bg-white/86 p-5 shadow-sketch backdrop-blur sm:p-6"
          onSubmit={event => {
            event.preventDefault()
            if (!canStart) return
            onStart({
              songUrl: songUrl.trim(),
              songOptions: selectedSong.songOptions,
            })
          }}
        >
          <div className="mb-5 flex items-center justify-between border-b-2 border-ink pb-3 font-display text-lg font-black tracking-[0.08em] text-ink">
            <span>ROLL 001</span>
            <span className="text-cyan">TEXTALIVE</span>
          </div>

          <div className="grid gap-4">
            {!HAS_TEXTALIVE_TOKEN && (
              <div className="rounded-md border-2 border-red-500 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                .env に VITE_TEXTALIVE_TOKEN を設定して、開発サーバーを再起動してください。
              </div>
            )}

            <label className="grid gap-2 text-sm font-bold">
              <span>楽曲</span>
              <select
                value={songIndex}
                onChange={event => setSongIndex(Number(event.target.value))}
                className="min-h-12 rounded-md border-2 border-ink bg-paper px-3 text-base outline-none transition focus:border-cyan focus:ring-4 focus:ring-cyan/20"
              >
                {PRESET_SONGS.map((song, index) => (
                  <option key={song.label} value={index}>
                    {song.label}
                  </option>
                ))}
              </select>
            </label>

            {songIndex === 1 && (
              <label className="grid gap-2 text-sm font-bold">
                <span>カスタムURL</span>
                <input
                  type="url"
                  value={customUrl}
                  onChange={event => setCustomUrl(event.target.value)}
                  className="min-h-12 rounded-md border-2 border-ink bg-paper px-3 text-base outline-none transition focus:border-cyan focus:ring-4 focus:ring-cyan/20"
                  placeholder="https://piapro.jp/t/..."
                />
              </label>
            )}

            <button
              type="submit"
              disabled={!canStart}
              className="mx-auto mt-3 grid h-28 w-28 place-items-center rounded-full border-[10px] border-ink bg-yellow text-center text-sm font-black tracking-[0.08em] text-ink shadow-shutter transition enabled:hover:-translate-y-0.5 enabled:active:translate-y-1 enabled:active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              撮影
              <span className="block text-xs tracking-[0.12em]">START</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
