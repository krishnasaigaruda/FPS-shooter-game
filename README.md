# City Hunt — 3D FPS

A browser-based first-person shooter built with [Three.js](https://threejs.org/). You spawn in a textured city map, fight through 10 waves of enemies, pick up ammo crates, and upgrade between rounds.

## Requirements

- A modern browser (Chrome, Edge, Firefox, Safari)
- Python 3 (for the local web server — any static server works)

Why a server? The game loads ES modules and assets via `fetch`, which browsers block when opened as `file://`. You **must** serve the folder over HTTP.

## Run it

Open a terminal and run:

```bash
cd "/Users/krishna/Documents/Code/Hunting game"
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in your browser and click **START**.

If port 8000 is busy, pick another: `python3 -m http.server 8080`.

### Alternatives

- `npx serve .` (if you have Node)
- `php -S localhost:8000` (if you have PHP)
- Any static file server will do

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look / Aim |
| `Shift` | Sprint |
| `Space` | Jump |
| Left Mouse | Shoot |
| `R` | Reload (auto-reloads when empty) |
| `Esc` | Unlock mouse / pause |
| Click canvas | Re-lock mouse after Esc |

## Gameplay

- Clear 10 rounds to win. Each round spawns more, tougher enemies.
- Headshots deal 2.2× damage.
- Ammo crates (yellow glowing boxes) are scattered around the map — walk into one for +60 reserve ammo.
- After each round you pick one of three random upgrades (damage, fire rate, mag size, HP, armor, speed, etc).

## Project layout

```
index.html               # page shell + HUD
style.css                # HUD / overlays
js/
  main.js                # boot: loads assets, builds scene, lighting, postprocessing
  game.js                # Game manager: rounds, spawning, upgrades, win/lose
  player.js              # FPS controller: movement, weapon, shooting
  enemy.js               # Enemy AI: patrol/chase/attack, LOS, outline
  ui.js                  # HUD + circular radar minimap
  audio.js               # Procedural SFX (WebAudio — no external files)
  texture_list.txt       # Manifest of map texture filenames (for fuzzy matching)
player.glb               # Player model
enemy.glb                # Enemy model
gun.glb                  # Gun model
map/source/extracted/    # City map FBX + PNG textures
```

## Credits

City map: [Burnout Revenge — Motor City (Short)](https://sketchfab.com/3d-models/burnout-revenge-motor-city-short-64123aec04c94bffa584ef083c857e72) on Sketchfab.
