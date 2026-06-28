# Lyric Lens Visual System

This document describes the current song presets, TextAlive data usage, and visual mapping in this app.
It is intended for future development and for AI agents editing the project.

## Product Concept

Lyric Lens is a TextAlive + camera viewfinder app.
The main experience is to play a song, show the current lyric phrase over a live camera or fallback visual scene, and capture moments as lyric photos.

The visual direction is camera/film/viewfinder themed:

- Camera preview or illustrated fallback background
- Focus brackets, grid lines, shutter curtain, flash, and frame counter
- Lyrics overlaid as the main subject
- Music-driven color grading and signal overlays
- Auto shutter triggers from lyric keywords

## Preset Songs

Preset songs are defined in `src/components/TokenSetup.tsx`.

| Label | URL | Notes |
| --- | --- | --- |
| シャッターチャンス / 夜未アガリ | `https://piapro.jp/t/PNpQ/20251209170719` | Default song. Has explicit TextAlive IDs for beat/chord/repetitive segment/lyric/lyric diff. |
| こたえて / imie | `https://piapro.jp/t/6W2N` | Uses TextAlive auto-resolved song data. Has a cool blue fallback personality. |
| アフター・ザ・カーテン / Rulmry | `https://piapro.jp/t/zoqO` | Uses TextAlive auto-resolved song data. Has a deep blue fallback personality. |
| 世界最後の音楽隊 / 夏山よつぎ×ど～ぱみん | `https://piapro.jp/t/B3yJ` | Uses TextAlive auto-resolved song data. Has an amber fallback personality. |
| トリツクロジー / 鶴三 | `https://piapro.jp/t/QBdL` | Uses TextAlive auto-resolved song data. Has a teal fallback personality. |
| TAKEOVER / Twinfield | `https://piapro.jp/t/E2i3` | Uses TextAlive auto-resolved song data. Has a cool blue fallback personality. |
| カスタム URL | user input | Any TextAlive-supported song URL. No hard-coded fallback personality unless added. |

Default song options for シャッターチャンス:

```ts
{
  video: {
    beatId: 4827295,
    chordId: 2963756,
    repetitiveSegmentId: 3086263,
    lyricId: 126542,
    lyricDiffId: 28628,
  },
}
```

## TextAlive Lifecycle

The TextAlive integration lives in `src/hooks/useTextAlive.ts`.

1. `Player` is lazy-imported from `textalive-app-api`.
2. A player is created with:
   - `app.token`
   - hidden `mediaElement`
   - `valenceArousalEnabled: true`
   - `vocalAmplitudeEnabled: true`
3. If the host app has not already provided a song URL, the app calls `player.createFromSongUrl(songUrl, songOptions)`.
4. Song metadata is read when `onVideoReady` fires.
5. Beat/BPM and median mood are initialized when `onTimerReady` fires.
6. Lyric, chord, chorus, vocal amplitude, and mood are updated from `onTimeUpdate`.
7. Progress is updated from `onThrottledTimeUpdate`.

Development-only Songle requests are proxied through Vite by rewriting `songle.jp` XHR URLs to `/__songle_proxy/...`.

## TextAlive Data Mapping

| TextAlive data | Source in code | App state | Visual usage |
| --- | --- | --- | --- |
| Song title | `video.song.title` | `songTitle` | Viewfinder bottom-left label, capture HUD title. Falls back to `Lyric Lens`. |
| Duration | `video.duration` | `duration` | Progress ratio and seek calculations. |
| Playback position | `onTimeUpdate(pos)` | `songPositionRef`, `progress` | Capture timestamp, lyric lookup, chord/chorus/vocal/mood lookup. |
| Phrase | `video.findPhrase(lyricPosition)` | `currentPhrase` | Large lyric overlay, capture text, auto-focus pulse on phrase change. |
| Word | `video.findWord(lyricPosition)` | `currentWord` | Highlighted active word, auto-shutter keyword triggers, color keyword detection. |
| Beat/BPM | `video.firstBeat` or `video.findBeat(0)` | `bpm` | Viewfinder shutter speed label and auto-shutter countdown timing. |
| Chord | `player.findChord(audioPosition)` | `currentChordName` | Chord HUD text, chord-colored signal bar, fallback tint hue. |
| Chorus/repetitive segment | `player.findChorus(audioPosition)` | `isChorus`, `chorusProgress` | CHORUS/VERSE HUD, yellow chorus frame, progress bar, stronger color overlay. |
| Vocal amplitude | `player.getVocalAmplitude(audioPosition)` and `getMaxVocalAmplitude()` | `vocalIntensity` | VOX meter, color overlay opacity/saturation boost. |
| Valence/arousal | `player.getValenceArousal(audioPosition)` | `currentValenceArousal` | Main mood filter: hue rotation, saturation, contrast, brightness, tint hue/opacity. |
| Median valence/arousal | `player.getMedianValenceArousal()` | `songMedianValenceArousal` | Fallback mood when per-time valence/arousal is missing. |

Lyric lookup uses small timing tolerances:

- Early tolerance: `24ms`
- Late tolerance: `48ms`
- Hold previous lyric after phrase end: `80ms`
- Startup sync window: `320ms`

These exist to avoid visible lyric flicker around TextAlive timing boundaries.

## Current Visual Layers

In `src/components/PlayerView.tsx`, the player view is layered roughly like this:

1. `CameraBackdrop`
   - Live camera video when camera is enabled.
   - Illustrated fallback background when camera is unavailable or off.
   - Camera-off mode defaults to `SHUTTER MV`, a bright Shutter Chance-inspired studio built from pastel cyan/yellow fields, white frame lines, sticker-like typography, hand-drawn marks, stacked photo/social cards, and small confetti dots.
2. Radial vignette
3. `MoodColorOverlay`
   - Enabled by the `FILM` control.
   - Uses valence/arousal, chord, chorus, vocal intensity, lyric color keywords, and song fallback personality.
4. `MusicSignalOverlay`
   - Chord color bar
   - Chorus border/progress
   - Vocal amplitude meter
5. `ViewfinderOverlay`
   - Shutter speed, ISO/f-stop labels
   - Song title
   - Frame count
   - CHORUS/VERSE, chord, VOX display
   - Focus grid and AF point
6. `LyricDisplay`
   - Current phrase with active word highlighted.
7. `CountdownOverlay`
   - Beat-synced countdown for auto shutter.
8. `EffectOverlay`
   - Keyword-triggered one-shot visual effects.
9. `ShutterCurtain`
   - Closing/opening curtain and flash at capture time.

## Mood And Color Rules

Mood settings are produced by `getMoodVisualSettings()` in `src/components/PlayerView.tsx`.

Priority for tint hue:

1. Active lyric color keyword
2. Current chord root hue
3. Song personality hue, if the preset has one
4. Valence/arousal derived mood hue

Color lyric keywords:

| Keywords | Hue |
| --- | --- |
| 赤, 紅, 朱 | 0-10 |
| 橙, オレンジ | 25-28 |
| 黄色, 黄 | 55 |
| 緑, 翠 | 120-130 |
| 水色 | 190 |
| 青, 蒼, 藍 | 215-240 |
| 紫 | 280 |
| 桃, ピンク | 340-345 |

The lyric color override lasts `2200ms`.

Chord root hue mapping is hard-coded:

| Root | Hue |
| --- | --- |
| C | 48 |
| C#/Db | 70 |
| D | 92 |
| D#/Eb | 128 |
| E | 155 |
| F | 185 |
| F#/Gb | 205 |
| G | 224 |
| G#/Ab | 252 |
| A | 286 |
| A#/Bb | 322 |
| B | 352 |

Preset fallback song personalities:

| Song ID | Song | Hue | Strength |
| --- | --- | ---: | ---: |
| `E2i3` | TAKEOVER | 215 | 0.24 |
| `6W2N` | こたえて | 200 | 0.14 |
| `zoqO` | アフター・ザ・カーテン | 228 | 0.13 |
| `B3yJ` | 世界最後の音楽隊 | 32 | 0.20 |
| `QBdL` | トリツクロジー | 188 | 0.16 |

`シャッターチャンス` currently has no fallback personality because it has richer explicit TextAlive data.

## Auto Shutter And Keyword Effects

Auto mode is enabled by default.
On every active word change, the app checks `LYRIC_TRIGGERS`.
If a word matches and playback is active, the app may run a countdown/effect and then capture a frame.

Debounce rules:

- Same trigger text is ignored for `1600ms`.
- Any auto trigger is ignored if another fired within `900ms`.
- Manual shutter cancels any pending countdown.

### Trigger Table

| Keywords | Behavior |
| --- | --- |
| シャッター, しゃったー, チャンス, 瞬間, 切り取り, 切り取, 保存, 残せる | Beat-synced countdown `3, 2, 1`, then capture. Countdown timing uses BPM with `bpmMultiplier: 2`. |
| ファインダー | `finder` effect, then capture. |
| フォーカス, 焦点 | `focus-zoom` effect, then capture. |
| ピント, 凍り, 溶け | `blur-to-clear` effect, then capture. |
| ストロボ | `strobe` effect, then capture. |
| スナップ | `snap` effect, then capture. |
| フレーム | `frame` effect, then capture. |
| レリーズ | Default capture with no special overlay effect. |
| 光, ヒカリ, 灯り, 輝, 色, イロ, 青, 影, 闇, 残像, ヘイロー, 照ら, 水面, 映る, 形, カケラ, 綺麗, 丸 | `light-leak` effect, then capture. |
| 声, コエ, 言葉, 音, オンガク, 音楽, メロディ, 残響, シグナル, 周波数, テンポ, clap, beat, 拍手 | `sound-wave` effect, then capture. |
| ノイズ, noise, ホワイトノイズ | `noise` effect, then capture. |
| 幕, ステージ, カーテン, 終わり, はじまり | `stage-curtain` effect, then capture. |
| 加速, 速度, アクセル, speed, full speed, テイクオーバー, takeover | `speed-lines` effect, then capture. |
| 世界, セカイ, 未来, ミライ | `glitch` effect, then capture. |
| 問い, 答え, 探, 目, 手を伸ば, 迷, 見せ, 魅せ, 見つけ, 見捨て, 見れる, ウソ, 本物, ロジック, 取り繕, ハリボテ | `answer-scan` effect, then capture. |

### Effect Durations

| Effect | Duration |
| --- | ---: |
| `finder` | 650ms |
| `focus-zoom` | 520ms |
| `blur-to-clear` | 650ms |
| `strobe` | 370ms |
| `snap` | 370ms |
| `frame` | 420ms |
| `light-leak` | 520ms |
| `sound-wave` | 560ms |
| `stage-curtain` | 620ms |
| `speed-lines` | 460ms |
| `answer-scan` | 560ms |
| `glitch` | 580ms |
| `noise` | 340ms |

Effect animations are defined in `src/index.css`.

## Camera-Off SHUTTER MV

Camera-off mode is treated as a first-class performance path instead of a generic fallback.
The default camera-off visual mode is `mv`.

The MV scene has three internal states:

| Scene | Trigger | Visual behavior |
| --- | --- | --- |
| `verse` | Default camera-off playback | Calm pastel cyan/yellow split, white viewfinder frame, hand-drawn marks, card stack depth. |
| `build` | Shutter-related word, high vocal intensity, or late chorus progress | Larger white shutter gate, stronger frame pulse, more active typography. |
| `chorus` | TextAlive chorus segment | Strongest frame punch, wider gate, `SHUTTER CHANCE` label, higher scene drive. |

This scene selection is computed in `getCameraOffStudioScene()` in `src/components/PlayerView.tsx`.
The same scene value is passed into `captureFrame()` so exported camera-off captures keep the same visual language as the on-screen MV.

`シャッターチャンス` keeps a fixed pastel cyan/yellow palette to stay close to the song MV language.
Other songs derive their camera-off MV palette from lyric color keywords, current chord hue, preset song personality, BPM, and vocal intensity.
High-energy songs such as `TAKEOVER` spread the hue range and saturation more aggressively, while calmer songs stay softer and closer in hue.

Large MV typography avoids ellipsis.
On-screen text uses weighted character length to reduce the front/back type size and allows natural wrapping.
Exported captures use a matching two-line sticker-text fitter so long lyric words or phrases are resized instead of being clipped.

## Capture Output

Capturing is implemented in `src/utils/capture.ts`.

## Film Loader

The playback bar uses a `FILM` loader instead of a generic filter toggle.
Choosing a film also enables the film look, so the action feels like loading a cartridge before taking a shot.

| Film | Intent |
| --- | --- |
| `MV FILM` | Default Shutter Chance cyan/yellow color identity with light grain. |
| `SEPIA 400` | Warm analog print, stronger grain, and a small burn edge. |
| `MONO 800` | High-contrast monochrome with heavier grain and vignette. |
| `CINE GOLD` | Warm stage/cinema stock with visible light leak. |
| `SIGNAL CHROME` | Saturated cyan/pink signal look for energetic songs. |

When `FILM` is on, the selected film affects the live preview, filtered capture image, result toggles, and story source frames.
Raw captures remain available in the result view.

## Camera-Off Touch Interactions

Camera-off touch gestures are designed as camera/film operations instead of generic pointer effects.

| Gesture | On-screen behavior | Capture behavior |
| --- | --- | --- |
| Tap | Shutter ring / burn frame with a small local focus blur at the tap point. | Captured frame keeps a subtle local exposure blur at the shutter point. |
| Hold | Exposure/development tank fills while the press is armed or charged, with a brief blur and overexposure wash. | Captured frame draws the partially or fully filled development tank, exposure meter, and a soft exposed haze. |
| Drag | Film advance strip follows the drag path with perforations, a pulled light leak, and a soft smeared blur. | Captured frame draws film perforations, a wipe band, and the drag path as a blurred light/development streak. |

## Performance Notes

The shutter path renders only the selected output and does not generate an alternate raw/FILM image during playback.
Camera-off capture uses a shorter long side than live-camera capture to reduce canvas and JPEG encode time.
Camera-off background motion is intentionally mostly static; gesture and shutter moments carry the motion instead of many always-running CSS animations.
Touch interaction blur avoids `backdrop-filter` during gestures; mobile/coarse-pointer CSS also removes heavy shadows and reduces drag-strip size.

The exported image:

- Is rendered to canvas.
- Uses a long side of `1920px`.
- Preserves the on-screen frame aspect ratio.
- Exports JPEG at quality `0.9`.
- Stores both raw and filtered versions when a mood filter exists.
- Downloads as `lyric-lens-001.jpg`, `lyric-lens-002.jpg`, etc.

Capture drawing order:

1. Camera frame or fallback background
2. Optional canvas filter
3. Optional tint overlay
4. Viewfinder grid and corners
5. Lyric phrase box with active word highlighted
6. HUD labels and frame number

The capture uses the current phrase, active word, song title, frame number, and current filter snapshot at shutter time.

## Controls

Playback controls live in `src/components/PlaybackBar.tsx`.

| Control | Behavior |
| --- | --- |
| Play/pause | Calls TextAlive `requestPlay()` / `requestPause()`. |
| Seek slider | Uses `startVideoSeek()`, `requestMediaSeek()`, and `endVideoSeek()`. |
| AUTO | Enables/disables lyric keyword auto shutter. |
| FILM | Enables/disables the loaded film look and determines whether the developed capture is selected by default. |
| Shutter button | Manual capture. Cancels any auto countdown first. |
| 現像 | Moves to result view. |

At song end, the app automatically finishes when progress reaches `0.995`.

## Debugging

In development, add `?debugLyrics` to the URL to enable lyric timing logs and expose `window.__textAliveDebug`.

Useful debug output:

- `[lyrics-metadata]`
- `[lyrics-first-timeupdate]`
- `[lyrics-transition]`

`window.__textAliveDebug.getSnapshot()` returns timer/media/video/audio positions and play state.

## Development Notes For AI Agents

- Treat `useTextAlive.ts` as the TextAlive adapter. Keep raw API calls there unless a UI feature needs a narrow callback.
- Treat `PlayerView.tsx` as the visual orchestration layer. Avoid moving TextAlive lifecycle code into it.
- Add new auto-shutter keywords in `LYRIC_TRIGGERS`.
- Add new overlay names to `ShutterEffect` in `src/types.ts`, render them in `EffectOverlay`, and define keyframes in `src/index.css`.
- If adding a preset song, update `PRESET_SONGS`. If TextAlive mood data is sparse, also add a `SONG_PERSONALITIES` fallback entry.
- Preserve the camera/film/viewfinder design language. Avoid generic gradient/glass/card-heavy UI changes.
- Keep capture rendering in sync with live visuals when changing lyric display, HUD labels, or filter behavior.
- Do not commit `.env.local` or TextAlive tokens.
