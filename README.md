# Pitch Tracker

Pitch Tracker draws your voice or instrument as a live line on a piano roll. Sing, hum, or play, and watch your pitch scroll across lanes labelled with every note, coloured green when you are within 10 cents of a note, yellow within 25, and red beyond. The header shows the note, its exact frequency, and how many cents off you are. Tap any lane to hear that note and aim for it. Or switch to **Sing along**: paste a YouTube link (or play any song), and the singer's notes are drawn as a band for you to follow while your own line shows how close you are. Try the [live app](https://ronpicard.github.io/pitch-tracker/); it works on phones and desktops.

## How to use it

- Tap **Start singing** and allow the microphone. Sing or play one note at a time.
- Time runs right to left: the dot at the right edge is now, and the last 20, 40 (the default), or 60 seconds trail behind it (**Time shown**).
- **Follow my voice** keeps the roll centred on where you are singing, showing 3 octaves by default; **Octaves shown** changes that to 1.5, 2, 3, or 4. Or pick a fixed range: bass, baritone, tenor, alto, soprano, or a wide C2–C6 view.
- **Line** sets how thick your pitch line is drawn: thin (the default), medium, or thick.
- **Tap a lane** to hear that note and make it your target. The lane is highlighted, and colours and cents are then measured against the target instead of the nearest note. Tap it again to clear it, or use the **−** and **+** buttons to move the target by a semitone.
- **Play target** repeats the reference note. **Drone** holds it continuously while you sing; use headphones so the microphone hears only you.
- **On pitch** is the share of the last 10 seconds you spent within 10 cents of the target (or of the nearest note), and **avg cents** your average distance from it.
- **Pause** freezes the roll so you can study a phrase; **Clear** wipes it.
- The reference pitch for A4 can be set to 415, 432, 440, or 442 Hz. Range, octaves shown, line thickness, time shown, and reference pitch are remembered.
- **App switcher:** the links at the top open the sibling tools, Instrument Tuner (Tuner) and Frequency Player (Tones).
- **Layout:** on desktops the roll fills the window height with the score and settings beside it; on phones it fills most of the screen, and nearly all of it when the phone is held sideways.

## Sing along with a song

Switch to **Sing along** at the top.

- **With a YouTube video:** paste its link and tap **Load**. The video plays inside the app.
  - **▶ Play & sing along** (desktop Chrome or Edge): choose this tab in the sharing window and keep **Share tab audio** on, and wear headphones. The app turns on your mic and starts the video, and two lines draw at once: the singer in cyan and you in orange. The singer's notes are saved for that video, so on later plays their next three seconds scroll in from the right before they sing them. **On pitch** is the share of the last 10 seconds the singer was singing that you were on their note (within a half step); the readout shows how many cents you are from them.
  - The app can only hear the video while this tab's audio is shared, because the video plays in YouTube's own player. If you press play in the video itself without sharing, a notice says so, with a button to share.
  - **Listen only** learns the singer's notes without your mic. On phones and other browsers, which can't share tab audio, **▶ Play & learn the notes** has the mic listen to the video playing out loud; then put on headphones, tap **Sing along**, and **Restart song**.
  - **Forget** wipes the learned notes for a video; **Remove video** unloads it.
- **Live, with any song:** without a video, **Listen to a tab or app** shares another browser tab (Spotify, SoundCloud, anything) or, on Windows and ChromeOS, your whole screen with its system audio; **Listen with the mic** hears a song playing in the room. The singer's line appears live. With tab or system audio you can sing along at the same time through the mic (wear headphones).
- **Count any octave** (on by default) scores a part sung an octave or two away from the singer as on pitch, and draws your line in the singer's octave so it stays on screen.
- Learning works in real time, as the song plays: nothing is downloaded from YouTube, the video just plays in YouTube's own embedded player. Some videos' owners don't allow playback on other sites; try another upload, such as a lyric video.
- Pitch detection follows the strongest melodic line, which in most songs is the lead singer. Expect gaps or detours during instrumental solos, very busy mixes, and stacked harmonies.

## How it works

- Pitch detection uses the McLeod Pitch Method over a 2048-sample window for low latency, which still reaches down to about 55 Hz.
- Each animation frame records one sample (time and fractional MIDI note). A three-reading median filter removes single-frame octave slips, and silence breaks the line so phrases stay separate.
- The roll is drawn on a canvas at the screen's pixel density. Range changes glide rather than jump.
- The microphone is opened with echo cancellation, noise suppression, and auto gain turned off. Audio is analysed on your device and never sent anywhere.
- The singer's pitch in a full mix is found by predominant-melody extraction, after Salamon and Gómez's Melodia: spectral peaks of a 4096-sample window are weighted by an A-weighting curve (which pushes the bass down), every candidate pitch from 75 to 1100 Hz is scored by summing the harmonics that line up above it, and a tracker follows one line through the candidates, preferring small moves so a loud chord or bass note doesn't pull it away. With stereo tab or system audio, only sound panned to the centre (where lead vocals sit) is analysed, which removes hard-panned guitars and keys.
- With a video, every pitch is stamped with the video's playback time, read from the YouTube IFrame Player API and interpolated between its coarse position reports, and stored per video in 20 ms steps in your browser's local storage.

## Development

Requires Node.js 22 (see `.nvmrc`).

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm test` runs 77 Vitest unit tests covering note math, pitch detection on synthetic signals, singer detection in synthetic mixes (a melody over bass and chords, and over a louder hard-panned instrument), learned-melody storage, the video clock, YouTube link parsing, roll geometry, range following, scoring, and microphone error handling. Pushing to `main` runs the tests, builds, and deploys to GitHub Pages through `.github/workflows/deploy.yml`.

When embedded on another site whose iframe blocks the microphone or screen sharing, the app offers a link to open itself in its own tab.

Built with React 19, TypeScript, Vite, and the Web Audio API, with no other runtime dependencies; the YouTube IFrame Player API script is loaded from youtube.com only when a video link is added. Contributor and AI agent rules are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
