# Noise Match

A browser-based tinnitus noise matching workstation built with React, TypeScript, Vite, and native Web Audio.

[Live demo](https://tonycassara.github.io/noise-match/)

![Noise Match workstation](public/screenshots/noise-match-workstation.png)

## Features

- In-browser tone, white noise, pink noise, and narrow-band noise generation
- Mixer-style source strips with gain faders, typed gain percentages, pan, mute, solo, duplicate, and delete confirmation
- Oscillator waveforms, filter/EQ controls, softening, and AudioWorklet-powered tremolo/chirp modulation
- Stereo field and spectrum visualizer
- Undo/redo buttons plus Cmd/Ctrl keyboard shortcuts
- IndexedDB persistence for current work, autosaves, and named templates

## Safety

Start low and adjust carefully. Browser audio output is not calibrated and can vary by headphones, speakers, device, browser, and system volume.

## Development

This project uses Yarn 4 via Corepack.

```bash
corepack yarn install
corepack yarn dev
```

## Checks

```bash
corepack yarn test
corepack yarn build
corepack yarn lint
```
