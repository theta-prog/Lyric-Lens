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
            DEVELOPED
          </p>
          <h1 className="font-display text-5xl font-black leading-none text-ink sm:text-7xl">
            現像完了
          </h1>
        </div>
        <div className="font-display text-5xl font-black text-yellow">
          {String(captures.length).padStart(3, '0')}
        </div>
      </header>

      <div className="min-h-0 overflow-auto px-4 py-5 sm:px-6">
        {captures.length === 0 ? (
          <div className="grid h-full min-h-[360px] place-items-center rounded-lg border-2 border-dashed border-ink/40 bg-white/52">
            <p className="font-display text-4xl font-black text-ink-light">NO FRAMES</p>
          </div>
        ) : (
          <div className="min-w-full overflow-x-auto pb-3">
            <div className="inline-flex min-w-max flex-col border-2 border-ink bg-ink shadow-sketch">
              <FilmPerforation />
              <div className="flex gap-4 bg-ink px-4 py-4">
                {captures.map((capture, index) => (
                  <motion.article
                    key={capture.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.045, duration: 0.28 }}
                    className="w-[280px] shrink-0 overflow-hidden rounded-md border-2 border-paper bg-paper sm:w-[360px]"
                  >
                    <img
                      src={capture.dataUrl}
                      alt={`capture ${index + 1}`}
                      className="aspect-video w-full object-cover"
                    />
                    <div className="grid gap-3 p-3">
                      <div className="flex items-center justify-between gap-3 font-display text-xl font-black text-ink">
                        <span>#{String(index + 1).padStart(3, '0')}</span>
                        <span className="text-cyan">{formatSongTime(capture.songPosition)}</span>
                      </div>
                      <p className="line-clamp-2 min-h-[3rem] text-sm font-bold leading-relaxed text-ink">
                        {capture.phrase}
                      </p>
                      <button
                        type="button"
                        onClick={() => downloadCapture(capture, index)}
                        className="h-10 rounded-md border-2 border-ink bg-yellow text-xs font-black tracking-[0.14em] text-ink transition hover:bg-white"
                      >
                        DOWNLOAD
                      </button>
                    </div>
                  </motion.article>
                ))}
              </div>
              <FilmPerforation />
            </div>
          </div>
        )}
      </div>

      <footer className="border-t-2 border-ink bg-white px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={onRestart}
          className="h-12 rounded-md border-2 border-ink bg-paper px-5 text-sm font-black tracking-[0.14em] text-ink shadow-shutter transition hover:bg-white active:translate-y-1 active:shadow-none"
        >
          RETAKE
        </button>
      </footer>
    </section>
  )
}
