import { useCallback, useEffect, useRef, useState } from 'react'

type FacingMode = 'user' | 'environment'

export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<FacingMode>('user')
  const facingModeRef = useRef<FacingMode>('user')
  const streamRef = useRef<MediaStream | null>(null)
  const requestIdRef = useRef(0)

  const stopStream = useCallback((target: MediaStream | null) => {
    target?.getTracks().forEach(track => track.stop())
  }, [])

  const getErrorMessage = useCallback((unknownError: unknown, facing: FacingMode) => {
    if (unknownError instanceof DOMException) {
      if (unknownError.name === 'NotAllowedError' || unknownError.name === 'SecurityError') {
        return 'ブラウザまたは端末でカメラ利用が許可されていません'
      }

      if (unknownError.name === 'NotFoundError' || unknownError.name === 'OverconstrainedError') {
        return facing === 'environment'
          ? 'この端末で外カメラが見つかりません'
          : 'この端末で内カメラが見つかりません'
      }

      if (unknownError.name === 'NotReadableError' || unknownError.name === 'AbortError') {
        return 'カメラを開けません。別のアプリやタブで使用中かもしれません'
      }
    }

    return 'カメラを開始できませんでした'
  }, [])

  const requestStream = useCallback(async (facing: FacingMode, exact: boolean) => (
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: exact ? { exact: facing } : { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })
  ), [])

  const startStream = useCallback(async (facing: FacingMode) => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('スマホでローカルIPから使う場合はHTTPSで開いてください')
      setEnabled(false)
      return { ok: false, error: 'スマホでローカルIPから使う場合はHTTPSで開いてください' }
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const previousStream = streamRef.current

    stopStream(previousStream)
    streamRef.current = null
    setStream(null)

    try {
      let nextStream: MediaStream
      try {
        nextStream = await requestStream(facing, true)
      } catch (unknownError) {
        if (
          unknownError instanceof DOMException &&
          (unknownError.name === 'NotFoundError' || unknownError.name === 'OverconstrainedError')
        ) {
          nextStream = await requestStream(facing, false)
        } else {
          throw unknownError
        }
      }

      if (requestIdRef.current !== requestId) {
        stopStream(nextStream)
        return { ok: false }
      }

      streamRef.current = nextStream
      setStream(nextStream)
      setEnabled(true)
      setError(null)
      setFacingMode(facing)
      facingModeRef.current = facing
      return { ok: true }
    } catch (unknownError) {
      if (requestIdRef.current !== requestId) return { ok: false }

      const message = getErrorMessage(unknownError, facing)
      setError(message)
      setEnabled(false)
      return { ok: false, error: message }
    }
  }, [getErrorMessage, requestStream, stopStream])

  const enable = useCallback(async () => {
    await startStream(facingModeRef.current)
  }, [startStream])

  const disable = useCallback(() => {
    requestIdRef.current += 1
    stopStream(streamRef.current)
    streamRef.current = null
    setStream(null)
    setEnabled(false)
    setError(null)
  }, [stopStream])

  const toggle = useCallback(async () => {
    if (enabled) {
      disable()
      return
    }

    await enable()
  }, [disable, enable, enabled])

  const switchCamera = useCallback(async () => {
    const previous = facingModeRef.current
    const next: FacingMode = facingModeRef.current === 'user' ? 'environment' : 'user'
    if (enabled) {
      const switched = await startStream(next)
      if (!switched.ok) {
        const switchError = switched.error
        const restored = await startStream(previous)
        facingModeRef.current = previous
        setFacingMode(previous)
        if (restored.ok && switchError) {
          setError(switchError)
        }
      }
      return
    }

    facingModeRef.current = next
    setFacingMode(next)
  }, [enabled, startStream])

  useEffect(() => {
    facingModeRef.current = facingMode
  }, [facingMode])

  useEffect(() => {
    return () => {
      stopStream(streamRef.current)
    }
  }, [stopStream])

  return { stream, enabled, error, facingMode, toggle, switchCamera }
}
