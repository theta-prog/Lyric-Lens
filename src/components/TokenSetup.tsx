import { useEffect, useState } from 'react'
import type { SetupConfig } from '../types'

const HAS_TEXTALIVE_TOKEN = Boolean(import.meta.env.VITE_TEXTALIVE_TOKEN?.trim())

interface PresetSong extends SetupConfig {
  label: string
}

const PRESET_SONGS: readonly PresetSong[] = [
  {
    label: 'シャッターチャンス / 夜未アガリ',
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
    label: 'こたえて / imie',
    songUrl: 'https://piapro.jp/t/6W2N',
  },
  {
    label: 'アフター・ザ・カーテン / Rulmry',
    songUrl: 'https://piapro.jp/t/zoqO',
  },
  {
    label: '世界最後の音楽隊 / 夏山よつぎ×ど～ぱみん',
    songUrl: 'https://piapro.jp/t/B3yJ',
  },
  {
    label: 'トリツクロジー / 鶴三',
    songUrl: 'https://piapro.jp/t/QBdL',
  },
  {
    label: 'TAKEOVER / Twinfield',
    songUrl: 'https://piapro.jp/t/E2i3',
  },
  {
    label: 'カスタム URL',
    songUrl: '',
  },
]

const BEFORE_SHOOTING_NOTES = [
  'カメラ映像と撮影画像はブラウザ内で処理され、サーバーには送信されません。',
  '保存を選んだ場合のみ、端末に画像や動画が書き出されます。',
  '周囲の迷惑にならないよう、個人情報や他の人の写り込みに気をつけて使ってください。',
] as const

function isMobileLikeDevice() {
  if (typeof window === 'undefined') return false

  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  return mobileUserAgent || (coarsePointer && navigator.maxTouchPoints > 1)
}

interface TokenSetupProps {
  onStart: (config: SetupConfig) => void
}

export default function TokenSetup({ onStart }: TokenSetupProps) {
  const [songIndex, setSongIndex] = useState(0)
  const [customUrl, setCustomUrl] = useState('')
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'checking' | 'ready' | 'error'>('idle')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isDesktopCameraSetup, setIsDesktopCameraSetup] = useState(false)

  const selectedSong = PRESET_SONGS[songIndex]
  const isCustomSong = selectedSong.songUrl === ''
  const songUrl = selectedSong.songUrl || customUrl
  const canStart = HAS_TEXTALIVE_TOKEN && songUrl.trim() !== ''

  useEffect(() => {
    setIsDesktopCameraSetup(!isMobileLikeDevice())
  }, [])

  const refreshCameraDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return []

    const devices = await navigator.mediaDevices.enumerateDevices()
    const videoInputs = devices.filter(device => device.kind === 'videoinput')
    setCameraDevices(videoInputs)
    setSelectedCameraId(current => {
      if (current && videoInputs.some(device => device.deviceId === current)) return current
      return videoInputs[0]?.deviceId ?? ''
    })
    return videoInputs
  }

  const handleCameraCheck = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error')
      setCameraError('このブラウザではカメラ選択を使えません')
      return
    }

    setCameraStatus('checking')
    setCameraError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      stream.getTracks().forEach(track => track.stop())
      await refreshCameraDevices()
      setCameraStatus('ready')
    } catch (unknownError) {
      if (
        unknownError instanceof DOMException &&
        (unknownError.name === 'NotAllowedError' || unknownError.name === 'SecurityError')
      ) {
        setCameraError('ブラウザでカメラ利用が許可されていません')
      } else {
        setCameraError('カメラ一覧を取得できませんでした')
      }
      setCameraStatus('error')
    }
  }

  return (
    <section className="setup-screen relative grid min-h-dvh place-items-center overflow-hidden px-4 py-8 sm:px-6">
      <div className="absolute inset-0 setup-paper" aria-hidden="true" />
      <div className="absolute inset-x-0 top-0 h-2 bg-[linear-gradient(90deg,#3dd6e8,#f5c842,#3dd6e8)]" />

      <div className="relative w-full max-w-xl min-w-0">
        <div className="setup-brand mb-7 text-center">
          <div className="setup-logo mx-auto mb-4 h-16 w-24 rotate-[-6deg] border-[6px] border-ink bg-white shadow-sketch">
            <div className="h-full w-full border-2 border-cyan" />
          </div>
          <h1 className="setup-title font-display text-[4rem] font-black leading-none text-ink sm:text-[5.6rem]">
            Lyric
            <span className="block text-cyan drop-shadow-[3px_3px_0_#f5c842]">Lens</span>
          </h1>
          <p className="setup-tagline mt-3 text-sm font-bold tracking-[0.28em] text-ink-light">
            CAPTURE THE VERSE
          </p>
        </div>

        <form
          className="setup-form min-w-0 rounded-lg border-2 border-ink bg-white/86 p-5 shadow-sketch backdrop-blur sm:p-6"
          onSubmit={event => {
            event.preventDefault()
            if (!canStart) return
            onStart({
              songUrl: songUrl.trim(),
              songOptions: selectedSong.songOptions,
              cameraDeviceId: isDesktopCameraSetup ? selectedCameraId || undefined : undefined,
            })
          }}
        >
          <div className="setup-roll mb-5 flex min-w-0 items-center justify-between gap-4 border-b-2 border-ink pb-3 font-display text-lg font-black tracking-[0.08em] text-ink">
            <span>ROLL 001</span>
            <span className="text-cyan">TEXTALIVE</span>
          </div>

          <div className="setup-fields grid gap-4">
            {!HAS_TEXTALIVE_TOKEN && (
              <div className="rounded-md border-2 border-red-500 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                .env に VITE_TEXTALIVE_TOKEN を設定して、開発サーバーを再起動してください。
              </div>
            )}

            <label className="grid min-w-0 gap-2 text-sm font-bold">
              <span>楽曲</span>
              <select
                value={songIndex}
                onChange={event => setSongIndex(Number(event.target.value))}
                className="min-h-12 w-full min-w-0 rounded-md border-2 border-ink bg-paper px-3 text-base outline-none transition focus:border-cyan focus:ring-4 focus:ring-cyan/20"
              >
                {PRESET_SONGS.map((song, index) => (
                  <option key={song.label} value={index}>
                    {song.label}
                  </option>
                ))}
              </select>
            </label>

            {isCustomSong && (
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

            {isDesktopCameraSetup && (
              <section
                className="grid gap-3 rounded-md border-2 border-ink bg-paper px-3 py-3 text-sm font-bold text-ink"
                aria-labelledby="camera-setup"
              >
                <div className="flex items-center justify-between gap-3 border-b border-ink/20 pb-2">
                  <h2 id="camera-setup" className="font-display text-sm font-black tracking-[0.1em]">
                    カメラ
                  </h2>
                  <button
                    type="button"
                    onClick={() => { void handleCameraCheck() }}
                    disabled={cameraStatus === 'checking'}
                    className="h-9 rounded-md border-2 border-ink bg-white px-3 text-xs font-black tracking-[0.1em] transition enabled:hover:bg-yellow disabled:cursor-wait disabled:opacity-60"
                  >
                    {cameraStatus === 'checking' ? '確認中' : 'カメラ確認'}
                  </button>
                </div>

                {cameraDevices.length > 1 ? (
                  <label className="grid gap-2">
                    <span className="text-xs text-ink-light">使うカメラ</span>
                    <select
                      value={selectedCameraId}
                      onChange={event => setSelectedCameraId(event.target.value)}
                      className="min-h-11 rounded-md border-2 border-ink bg-white px-3 text-sm outline-none transition focus:border-cyan focus:ring-4 focus:ring-cyan/20"
                    >
                      {cameraDevices.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `カメラ ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-xs leading-relaxed text-ink-light">
                    {cameraDevices.length === 1
                      ? `使用カメラ: ${cameraDevices[0].label || 'カメラ 1'}`
                      : 'PCで複数カメラを使う場合は、先にカメラ確認を押して選んでください。'}
                  </p>
                )}

                {cameraError && (
                  <p className="rounded-md border border-red-500 bg-white px-3 py-2 text-xs font-bold text-red-700">
                    {cameraError}
                  </p>
                )}
              </section>
            )}

            <section
              className="setup-note grid gap-2 rounded-md border-2 border-ink bg-paper px-3 py-3 text-xs font-bold leading-relaxed text-ink"
              aria-labelledby="before-shooting"
            >
              <div className="setup-note-head flex items-center justify-between gap-3 border-b border-ink/20 pb-2 font-display text-sm font-black tracking-[0.1em]">
                <h2 id="before-shooting">撮影前メモ</h2>
                <span className="shrink-0 text-cyan">LOCAL ONLY</span>
              </div>
              <ul className="setup-note-list grid gap-1.5">
                {BEFORE_SHOOTING_NOTES.map(note => (
                  <li key={note} className="grid grid-cols-[0.9rem_1fr] gap-2">
                    <span className="pt-[0.08rem] text-cyan" aria-hidden="true">●</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </section>

            <button
              type="submit"
              disabled={!canStart}
              className="setup-start mx-auto mt-1 grid h-28 w-28 place-items-center rounded-full border-[10px] border-ink bg-yellow text-center text-sm font-black tracking-[0.08em] text-ink shadow-shutter transition enabled:hover:-translate-y-0.5 enabled:active:translate-y-1 enabled:active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
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
