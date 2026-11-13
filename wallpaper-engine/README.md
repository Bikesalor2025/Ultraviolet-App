# Lumen — Wallpaper Engine

A live wallpaper engine that runs in the browser. No build step, no dependencies.

## Run

Open `index.html` in a browser, or serve the folder:

```sh
npx serve wallpaper-engine
```

## Features

- 10 animated wallpapers (WebGL shaders and Canvas 2D), each with its own colors and sliders
- Import your own images and videos (button or drag and drop); they are stored locally in the browser
- Favorites, search, categories, presets, randomize
- Display controls: speed, brightness, contrast, saturation, hue, blur, vignette, quality, frame rate
- Clock widget, microphone-reactive mode, auto-changing playlist
- Save the current frame as a PNG, fullscreen, hide-controls mode
- Settings persist in `localStorage`

## Shortcuts

`Space` play/pause · `←` `→` previous/next · `H` hide controls · `F` fullscreen · `S` save image · `L` favorite · `/` search

## Adding a wallpaper

Add an entry to `WE.WALLPAPERS` in `js/wallpapers.js` with `id`, `name`, `category`, `params` and a `create(canvas)` function returning `{ frame(t, dt, env), destroy() }`.
