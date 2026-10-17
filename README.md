# My Playlist Player

A static web music player preloaded with my playlist. Add your own audio files; they're stored in the browser (IndexedDB) so they stay between visits.

## Features

- **Shuffle**: shuffles the rest of the playlist, keeping the current song playing.
- **Repeat**: off → all → one.
- **Queue**: "Play next" / "Add to queue" from a song's ••• menu; reorder, remove, or clear in the Queue panel.
- Lock-screen / headphone controls via the Media Session API.

## Adding songs

Tap **+ Add music files** and pick audio files you own. Files whose names contain a song title (e.g. `Stuntman - Connor Price.mp3`) attach to that song automatically; others are added as new songs. Use ••• → **Replace file** to attach a file to a specific song.

## Run

Any static server works:

```sh
npx serve .
```

Or deploy the folder to any static host (Vercel, Netlify, GitHub Pages).
