import { motion } from 'framer-motion'
import type { CaptureItem } from '../types'

interface ResultViewProps {
  captures: CaptureItem[]
  onRestart: () => void
}

function formatSongTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function downloadCapture(capture: CaptureItem, index: number) {
  const link = document.createElement('a')
  link.href = capture.dataUrl
  link.download = `shutter-chance-${String(index + 1).padStart(3, '0')}.jpg`
  link.click()
}

async function shareCapture(capture: CaptureItem, index: number) {
  const filename = `shutter-chance-${String(index + 1).padStart(3, '0')}.jpg`

  if (!('share' in navigator)) {
    downloadCapture(capture, index)
    return
  }

  try {
    const res = await fetch(capture.dataUrl)
    const blob = await res.blob()
    const file = new File([blob], filename, { type: 'image/jpeg' })
    const shareData = { files: [file], title: 'shutter chance', text: capture.phrase }

    if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
      await navigator.share(shareData)
    } else {
      downloadCapture(capture, index)
    }
  } catch {
    // User cancelled — don't fall back to download
  }
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
  return (
    <section className="grid min-h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-paper">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink bg-white px-4 py-4 sm:px-6">
        <div>
          <p className="font-display text-lg font-black tracking-[0.16em] text-cyan">
            DEVELOPED FRAMES
          </p>
          <h1 className="font-display text-5xl font-black leading-none text-ink sm:text-7xl">
            現像完了
          </h1>
        </div>
        <div className="font-display text-5xl font-black text-yellow">
          {String(captures.length).padStart(3, '0')}
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
              {captures.map((capture, index) => (
                <motion.article
                  key={capture.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.045, duration: 0.28 }}
                  className="overflow-hidden rounded-md border-2 border-ink bg-paper shadow-sketch"
                >
                  <img
                    src={capture.dataUrl}
                    alt={`capture ${index + 1}`}
                    className="w-full object-cover"
                    style={{ aspectRatio: `${capture.width}/${capture.height}` }}
                  />
                  <div className="grid gap-2 p-2">
                    <div className="flex items-center justify-between font-display text-xs font-black text-ink sm:text-sm">
                      <span>#{String(index + 1).padStart(3, '0')}</span>
                      <span className="text-cyan">{formatSongTime(capture.songPosition)}</span>
                    </div>
                    <p className="line-clamp-2 min-h-[2rem] text-xs font-bold leading-relaxed text-ink">
                      {capture.phrase}
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => void shareCapture(capture, index)}
                        className="h-9 rounded-md border-2 border-ink bg-cyan text-xs font-black tracking-[0.1em] text-ink transition hover:bg-cyan/80 touch-manipulation"
                      >
                        共有
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadCapture(capture, index)}
                        className="h-9 rounded-md border-2 border-ink bg-yellow text-xs font-black tracking-[0.1em] text-ink transition hover:bg-white touch-manipulation"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                </motion.article>
              ))}
            </div>
          </>
        )}
      </div>

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
