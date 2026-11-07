# Pitch Tracker

Pitch Tracker draws your voice or instrument as a live line on a piano roll. Sing, hum, or play, and watch your pitch scroll across lanes labelled with every note, coloured green when you are within 10 cents of a note, yellow within 25, and red beyond. The header shows the note, its exact frequency, and how many cents off you are. Tap any lane to hear that note and aim for it. Try the [live app](https://ronpicard.github.io/pitch-tracker/); it works on phones and desktops.

## How to use it

- Tap **Start singing** and allow the microphone. Sing or play one note at a time.
- Time runs right to left: the dot at the right edge is now, and the last 5, 10, or 20 seconds trail behind it (**Time shown**).
- **Follow my voice** keeps the roll centred on where you are singing. Or pick a fixed range: bass, baritone, tenor, alto, soprano, or a wide C2–C6 view.
- **Tap a lane** to hear that note and make it your target. The lane is highlighted, and colours and cents are then measured against the target instead of the nearest note. Tap it again to clear it, or use the **−** and **+** buttons to move the target by a semitone.
- **Play target** repeats the reference note. **Drone** holds it continuously while you sing; use headphones so the microphone hears only you.
- **On pitch** is the share of the last 10 seconds you spent within 10 cents of the target (or of the nearest note), and **avg cents** your average distance from it.
- **Pause** freezes the roll so you can study a phrase; **Clear** wipes it.
- The reference pitch for A4 can be set to 415, 432, 440, or 442 Hz. Range, time shown, and reference pitch are remembered.

## How it works

- Pitch detection uses the McLeod Pitch Method over a 2048-sample window for low latency, which still reaches down to about 55 Hz.
- Each animation frame records one sample (time and fractional MIDI note). A three-reading median filter removes single-frame octave slips, and silence breaks the line so phrases stay separate.
- The roll is drawn on a canvas at the screen's pixel density. Range changes glide rather than jump.
- The microphone is opened with echo cancellation, noise suppression, and auto gain turned off. Audio is analysed on your device and never sent anywhere.

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

`npm test` runs 41 Vitest unit tests covering note math, pitch detection on synthetic signals, roll geometry, range following, scoring, and microphone error handling. Pushing to `main` runs the tests, builds, and deploys to GitHub Pages through `.github/workflows/deploy.yml`.

When embedded on another site whose iframe blocks the microphone, the app offers a link to open itself in its own tab.

Built with React 19, TypeScript, Vite, and the Web Audio API, with no other runtime dependencies. Contributor and AI agent rules are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
