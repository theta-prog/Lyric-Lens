# Lyric Lens Contest Review 2026

Created: 2026-05-31

This document summarizes the current contest-readiness review for Lyric Lens.
It is intended as a working memo for deciding what to polish before submitting to the Hatsune Miku "Magical Mirai 2026" Programming Contest.

## Contest Context

Official contest page:

- https://magicalmirai.com/2026/procon/
- https://developer.textalive.jp/events/magicalmirai2026/

Key points from the 2026 rules:

- The submitted work must be a web lyric app using TextAlive App API.
- The app should provide attractive lyric and visual effects synchronized with the winning Magical Mirai 2026 Music Contest songs.
- The target songs are the six official 2026 songs. Supporting all six songs and focusing on one song are both allowed.
- The submission format is source code for a static web application that works by being placed on an HTTP server.
- Dynamic server applications such as PHP, Ruby, or Node.js response servers are not allowed.
- Source code is part of the judging target, so the project structure should be understandable and not obfuscated.
- The judging criteria are:
  - Creativity: whether the visuals are attractive and synchronized with the music.
  - Innovation: whether the idea is unique and suggests a future creative culture.
  - Completeness: whether the app works in intended browsers and is technically well implemented.
- The submission period is 2026-03-27 12:00 JST to 2026-06-29 12:00 JST.

## Current Direction

Lyric Lens is currently a TextAlive plus camera-viewfinder lyric app.
The core experience is:

1. Play a contest song through TextAlive.
2. Show the current lyric phrase over a live camera view or fallback visual scene.
3. Trigger manual or lyric-driven automatic shutters.
4. Save/share the captured lyric photos.
5. Generate a short vertical story video from selected captures.

The strongest concept fit is with `シャッターチャンス / 夜未アガリ`.
The app's camera, focus, shutter, film, and development metaphors directly match the song title and several lyric-triggered motifs.

The current implementation already uses multiple TextAlive data layers:

- Phrase and word timing for lyric display and active word highlighting.
- BPM for shutter speed display and beat-timed countdowns.
- Chords for HUD and tint color mapping.
- Chorus/repetitive segment information for stronger frame and story selection.
- Vocal amplitude for VOX display and visual intensity.
- Valence/arousal for color grading and mood filters.

This is a strong technical foundation because the app is not only playing music with a static overlay.
It turns TextAlive timing and musical analysis into interaction, photography, and shareable artifacts.

## Award Potential

The direction is viable for an award if the final build clearly communicates the experience in the first 30 seconds.

Strengths:

- The app has a memorable interaction loop: listen, find a moment, capture it, develop it, share it.
- The concept is participatory rather than only visual. This helps with the contest's "future creative culture" criterion.
- The result view and story generation make the output easy to understand for general voters.
- The use of camera input makes each run personal and hard to reproduce exactly.
- The implementation already goes beyond basic lyric animation by using several TextAlive analysis APIs.

Weak points:

- The experience depends heavily on camera availability. If the camera is denied or unavailable, the fallback needs to feel intentional rather than secondary.
- The first-run path may still feel like a tool UI before it feels like a finished performance.
- Supporting six songs is useful, but the app's strongest identity is clearly `シャッターチャンス`. The default path should lean into that instead of spreading attention evenly.
- The app has many features. For judging, polish and clarity matter more than adding more controls.

Overall assessment:

- Creativity: promising, especially if lyric-triggered shutter moments are visually satisfying.
- Innovation: promising, because it turns a lyric app into a participatory photo/stage artifact.
- Completeness: currently the largest risk area.

## Major Risks

### Static Submission Compatibility

The official rules require a static web application.
The current project builds with Vite, which is fine, but the Songle proxy path needs careful handling.

Current risk:

- `vite.config.ts` defines a development-only Songle proxy.
- `src/hooks/useTextAlive.ts` rewrites Songle XHR URLs to `/__songle_proxy/...`.
- `functions/__songle_proxy/[[path]].js` exists as a serverless-style proxy.

If the production app depends on that proxy, it may conflict with the static-app submission requirement.
The production build should work as static files without server functions.

Recommended action:

- Ensure Songle URL rewriting is enabled only in development.
- Confirm the production build can load contest songs without `/__songle_proxy`.
- Do not rely on `functions/__songle_proxy` for the submitted app.

### Token Handling

The app currently requires `VITE_TEXTALIVE_TOKEN`.
If the judge builds from source without clear instructions, the app can stop at setup.

Recommended action:

- Document exactly how to set `VITE_TEXTALIVE_TOKEN`.
- Confirm whether the contest expects entrants to include a usable token, provide setup instructions, or rely on the review environment's token.
- Make the setup error message clear enough for source-code judging.

### Camera Availability

The app is strongest with camera access, but judging can happen on PC, tablet, or smartphone.
Camera permission may be denied or unavailable.

Recommended action:

- Treat the fallback as a real "virtual photo booth" mode.
- Make camera-off visuals reactive to lyrics, chorus, and vocal intensity.
- Ensure captures from fallback mode are good enough to represent the app in a demo video.

### First 30 Seconds

Past award-winning works tend to communicate a strong idea quickly:

- 2025 Grand Prize `StarryLogues`
- 2025 Runner-up `MIRAI express`
- 2025 Runner-up `リリックかるた`
- 2025 Runner-up `ぽつりランナー`

Those works are notable because they are not only synchronized lyric displays.
They frame a clear creative action, game, journey, or participation model.

Recommended action:

- Make the default flow start on `シャッターチャンス`.
- Let the app produce at least one strong auto-capture early in the song.
- Reduce any friction before playback and capture.
- Avoid requiring the user to understand every control before the core experience happens.

## Prioritized Improvements

### Priority 1: Submission Safety

- Make production behavior static-only.
- Disable Songle proxy rewriting outside development.
- Verify `npm run build` and static preview.
- Confirm all six preset songs can load in the production build.
- Clarify TextAlive token setup in README.

### Priority 2: Stronger Core Experience

- Treat `シャッターチャンス` as the main authored experience.
- Add or tune lyric triggers for that song so auto-shutter moments feel intentional.
- Make countdown, shutter, flash, and capture timing feel beat-locked.
- Ensure captured images look good even when the phrase is long.

### Priority 3: Camera-Off Quality

- Upgrade fallback visuals from "camera unavailable background" to "Lyric Lens studio".
- Use lyric, chorus, chord, and vocal intensity to animate the fallback.
- Ensure story generation from fallback captures still looks like a finished entry.

### Priority 4: Public Voting Appeal

- Make the output instantly shareable and understandable.
- Keep story video generation, but make its status and fallback behavior reliable.
- Consider a simple result caption showing why a frame was selected, such as chorus, strong vocal, or lyric keyword.

### Priority 5: Code Review Readiness

- Keep the TextAlive adapter boundaries clear.
- Add short architecture notes to README or keep `docs/visual-system.md` current.
- Avoid adding large unrelated abstractions before submission.
- Keep comments focused on non-obvious timing and browser behavior.

## What Not To Overdo

- Do not add many new modes unless they directly strengthen the first-run experience.
- Do not make all six songs equally custom if that weakens the main concept.
- Do not rely on AI-generated visual/audio/text assets in the app output.
- Do not make the app require a backend or cloud function to pass the core judging path.
- Do not hide the main experience behind a long setup or explanation screen.

## Suggested Acceptance Checklist

Before submission, the app should pass these checks:

- `npm run build` succeeds.
- The built app works as static files.
- The default song loads and plays without dev proxy support.
- Camera allowed path works on a real smartphone.
- Camera denied path still creates attractive captures.
- Manual shutter works.
- Auto shutter works during `シャッターチャンス`.
- Seeking does not break lyric sync or auto-capture state.
- Result view can save at least one frame.
- Story generation either works or fails with a clear, non-blocking message.
- README explains setup, build, intended environment, and the concept.
- No generated output asset violates the contest's AI-generated works rule.

## Current Recommendation

Keep the current direction.
The concept has enough originality to compete, especially because it creates personal lyric-photo artifacts instead of only showing synchronized text.

The next work should focus on reliability and clarity, not feature count.
If the app becomes static-safe, camera-off-safe, and immediately expressive on `シャッターチャンス`, it can present as a strong contest entry.
