# Music

Default sound design: no narration, no sound effects — a silent-legible video plus one licensed music track muxed after the final render. The video must communicate fully with the sound off.

## Sourcing

- Pixabay Music works: the Pixabay Content License allows free commercial use without attribution. It forbids redistributing tracks as standalone files — **never commit a track to a repo or bundle it in a skill**; download it fresh into the scratch project.
- Match energy to the piece (a calm hook wants chill, mid-tempo). Let the user hear the muxed result and veto.

## Muxing

With final video duration `D` (from `ffprobe -v error -show_entries format=duration -of csv=p=0 video.mp4`):

```bash
ffmpeg -y -v error -i output/main.mp4 -i track.mp3 \
  -filter_complex "[1:a]atrim=0:D,afade=t=in:st=0:d=0.8,afade=t=out:st=D-2:d=2.0,volume=0.55[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -shortest output/main-music.mp4
```

Compute `D` and `D-2` as literal numbers (no shell math needed — read them off ffprobe). Proven defaults: 0.8 s fade-in, 2.0 s fade-out, volume 0.55. Video stream copies untouched (`-c:v copy`), so muxing is instant and lossless.

If impacts were placed on a timing grid (see animation-craft.md), the track's pulse will feel loosely synced without any beat detection.
