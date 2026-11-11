// The YouTube IFrame Player, loaded on demand when a link is added. The video
// plays in YouTube's own embedded player (nothing is downloaded); the app
// only reads the playback position so the singer's line stays in sync.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { VideoClock } from './song'

type YTPlayer = {
  getCurrentTime(): number
  getPlayerState(): number
  getPlaybackRate(): number
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getDuration(): number
  destroy(): void
}

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      width?: string | number
      height?: string | number
      playerVars?: Record<string, string | number>
      events?: { onReady?: () => void; onError?: (event: { data: number }) => void; onStateChange?: (event: { data: number }) => void }
    },
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const PLAYING = 1
const BUFFERING = 3

let api: Promise<YTNamespace> | null = null

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      api = null
      script.remove()
      reject(new Error('The YouTube player could not load. Check your connection, or allow youtube.com if an ad or content blocker is on.'))
    }
    document.head.append(script)
  })
  return api
}

/** What YouTube's numeric player errors mean for the person using the app. */
export function playerErrorMessage(code: number): string {
  if (code === 101 || code === 150 || code === 153) return 'This video’s owner doesn’t allow it to play on other sites. Try another upload of the song, such as a lyric or audio video.'
  if (code === 100) return 'That video was not found. It may be private or removed.'
  if (code === 2) return 'That link doesn’t point to a playable video.'
  return 'The video can’t be played here.'
}

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useYouTube(host: RefObject<HTMLDivElement | null>, videoId: string | null) {
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const player = useRef<YTPlayer | null>(null)
  const clock = useRef(new VideoClock())

  useEffect(() => {
    const element = host.current
    if (!videoId || !element) {
      setStatus('idle')
      return
    }
    let cancelled = false
    let poll = 0
    // YouTube replaces the element it is given, so hand it a child React doesn't own.
    const mount = document.createElement('div')
    element.replaceChildren(mount)
    setStatus('loading')
    setError(null)
    clock.current = new VideoClock()

    const sync = () => {
      const p = player.current
      if (!p) return
      const state = p.getPlayerState()
      const isPlaying = state === PLAYING
      clock.current.report(p.getCurrentTime(), isPlaying, performance.now(), p.getPlaybackRate())
      setPlaying(isPlaying || state === BUFFERING)
    }

    loadApi()
      .then((YT) => {
        if (cancelled) return
        player.current = new YT.Player(mount, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: () => {
              if (cancelled) return
              setStatus('ready')
              poll = window.setInterval(sync, 100)
            },
            onStateChange: sync,
            onError: (event) => {
              if (cancelled) return
              setStatus('error')
              setError(playerErrorMessage(event.data))
            },
          },
        })
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setStatus('error')
        setError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      cancelled = true
      window.clearInterval(poll)
      player.current?.destroy()
      player.current = null
      element.replaceChildren()
      setPlaying(false)
    }
  }, [host, videoId])

  return {
    status,
    error,
    playing,
    clock,
    play: () => player.current?.playVideo(),
    pause: () => player.current?.pauseVideo(),
    restart: () => {
      player.current?.seekTo(0, true)
      player.current?.playVideo()
    },
  }
}
