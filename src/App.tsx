import { useState } from 'react'
import PlayerView from './components/PlayerView'
import ResultView from './components/ResultView'
import TokenSetup from './components/TokenSetup'
import type { CaptureItem, Phase, SetupConfig } from './types'

const TEXTALIVE_TOKEN = import.meta.env.VITE_TEXTALIVE_TOKEN?.trim() ?? ''

export default function App() {
  const [phase, setPhase] = useState<Phase>('setup')
  const [config, setConfig] = useState<SetupConfig | null>(null)
  const [captures, setCaptures] = useState<CaptureItem[]>([])

  const handleStart = (nextConfig: SetupConfig) => {
    setConfig(nextConfig)
    setCaptures([])
    setPhase('playing')
  }

  const handleFinish = (nextCaptures: CaptureItem[]) => {
    setCaptures(nextCaptures)
    setPhase('result')
  }

  const handleRestart = () => {
    setConfig(null)
    setCaptures([])
    setPhase('setup')
  }

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <main className="min-h-dvh">
        {phase === 'setup' && <TokenSetup onStart={handleStart} />}

        {phase === 'playing' && config && (
          <PlayerView
            token={TEXTALIVE_TOKEN}
            songUrl={config.songUrl}
            songOptions={config.songOptions}
            cameraDeviceId={config.cameraDeviceId}
            onFinish={handleFinish}
          />
        )}

        {phase === 'result' && (
          <ResultView captures={captures} onRestart={handleRestart} />
        )}
      </main>
    </div>
  )
}
