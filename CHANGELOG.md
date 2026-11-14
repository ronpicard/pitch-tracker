# Changelog

All notable changes to Pitch Tracker are documented in this file, following the [Keep a Changelog](https://keepachangelog.com/) format.

## [Unreleased]

### Added

- **Sing along** mode. Paste a YouTube link and the app learns the singer's notes as the video plays, by listening to the tab's audio (desktop Chrome and Edge) or through the microphone. The notes are saved for that video, and on the next play they scroll in three seconds ahead as a blue band, with your own line drawn over it and scored against the singer.
- Live singer pitch from any song: share another tab or your computer's sound, or let the microphone hear a song playing in the room, and the lead singer's line is drawn as it plays.
- **Count any octave** scores a part sung an octave away from the singer as on pitch and draws it in the singer's octave.
- **Octaves shown** (1.5, 2, 3, or 4) and **Line** (thin, medium, or thick) settings for the roll.

### Changed

- The roll shows 3 octaves when following your voice, up from 1.5, and draws your pitch line thinner by default.
- **Time shown** offers 20, 40, or 60 seconds of history, with 40 as the default (was 5, 10, or 20).
- In **Sing along**, the singer and you are drawn as two separate lines in fixed colours, cyan for the singer and orange for you, with the singer's current note marked too. How close you are shows in the readout and the on-pitch score.

### Fixed

- Pressing play on a pasted YouTube video showed no singer line, because the app can only hear the video while the tab's audio is shared. A new **Play & sing along** button shares the audio, turns on your mic, and starts the video in one tap, and a notice now explains when a video is playing unheard.

## [1.2.0] - 2026-11-07

### Changed

- A brighter, higher-contrast look: a near-black background with orange and pink glows, brighter lane labels and grid in the roll, a glowing pitch line and playhead, and gradient buttons and switcher.
- The on-pitch score turns green, amber, or red depending on how well you are doing.

## [1.1.0] - 2026-11-07

### Added

- A switcher at the top links Tuner, Tones (Frequency Player), and Pitch (Pitch Tracker), so you can move between the three music tools.

### Changed

- On desktops the piano roll fills the height of the window with the score, controls, and settings in a column beside it. On phones the roll fills most of the screen, and held sideways it takes nearly all of it.

## [1.0.1] - 2026-11-07

### Fixed

- Quiet notes are now detected. With the microphone's automatic gain turned off, an instrument heard from a normal distance often arrives too quietly for the old silence threshold, so nothing was detected on many phones and laptops.

## [1.0.0] - 2026-11-07

### Added

- First release: a live piano-roll pitch tracker that draws your voice note by note with accuracy colours, target notes you set by tapping a lane, a reference drone, voice-range presets, and an on-pitch score. Works with mouse, keyboard, and touch on desktops and phones.
