# Gyro Tunnel audio credits

Sound effects and music in this game come from clearly free libraries.
Every file used here is licensed **CC0 1.0** (public-domain dedication):
https://creativecommons.org/publicdomain/zero/1.0/

Attribution is not required under CC0. The list below is recorded as a courtesy
so the original packs, file names, authors, and source URLs stay with the game.

Samples were trimmed, loudness-normalized, and recompressed for the web
(Opus + AAC for effects; 96 kbps AAC for music). The soundtrack loops at full
length. A low-pass filter keeps the mix muffled on the start and game-over
screens, opens at each 1000 m milestone during a run, and eases back to muffled
over three seconds after a crash.

## Sound effects
## Sound effects

| Event | Pack | Original file | Author | License | URL |
| --- | --- | --- | --- | --- | --- |
| Engine / wind bed (loop, rises with speed and boost) | Kenney Sci-Fi Sounds | `Audio/spaceEngineLow_000.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds (also https://opengameart.org/content/sci-fi-sounds) |
| Close call whoosh (pitch rises with combo) | Kenney Sci-Fi Sounds | `Audio/laserLarge_002.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds (also https://opengameart.org/content/sci-fi-sounds) |
| Shield pickup | Kenney Interface Sounds | `Audio/glass_003.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds (also https://opengameart.org/content/interface-sounds) |
| Slow-mo pickup | Kenney Interface Sounds | `Audio/pluck_001.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds (also https://opengameart.org/content/interface-sounds) |
| 2× Score pickup | Kenney Interface Sounds | `Audio/confirmation_001.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds (also https://opengameart.org/content/interface-sounds) |
| Shield absorb | Kenney Sci-Fi Sounds | `Audio/forceField_001.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds (also https://opengameart.org/content/sci-fi-sounds) |
| Slow-mo end | Kenney Interface Sounds | `Audio/minimize_002.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds (also https://opengameart.org/content/interface-sounds) |
| 2× Score end | Kenney Interface Sounds | `Audio/back_002.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds (also https://opengameart.org/content/interface-sounds) |
| Crash | Kenney Sci-Fi Sounds | `Audio/lowFrequency_explosion_000.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds (also https://opengameart.org/content/sci-fi-sounds) |
| Palette milestone chime | Kenney Interface Sounds | `Audio/confirmation_003.ogg` | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds (also https://opengameart.org/content/interface-sounds) |

## Soundtrack

**Neon Sign Circuit** by MintoDog (CC0 1.0) loops continuously: it starts on
the first tap and keeps playing across the start screen, every flight, and the
game-over screen, without restarting. On the start and stats screens the highs
are filtered down (around 500 Hz). During a run the low-pass cutoff steps up
every 1000 m (the same marks that change the tunnel palette) and the mix opens.
After a crash the filter eases back to the muffled setting over about three
seconds.

| File in game | Title | Author | BPM (est.) | License | URL |
| --- | --- | --- | --- | --- | --- |
| `audio/music/neon-sign-circuit.m4a` | Neon Sign Circuit | MintoDog | 144 | CC0 1.0 | https://opengameart.org/content/neon-sign-circuit |
