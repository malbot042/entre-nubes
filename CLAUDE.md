# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Entre Nubes" — a browser 3D flight simulator (planes and helicopters) in plain JavaScript ES modules + Three.js r160 loaded from jsDelivr via the import map in `index.html`. It is deployed as static files on GitHub Pages (`.nojekyll` at the root). UI text, comments and commit messages are in Spanish.

**Constraint from the owner: no Node, npm, bundler or build step.** Everything must run by serving the folder statically.

## Running

```
python3 -m http.server 8000   # then open http://localhost:8000
```

There are no tests, linter or build. To verify changes, load the page in a browser and check the console. `window.__entreNubes` exposes `{ state, scene, camera, env }` for debugging (for example `state.fm` is the flight model and `state.world` the terrain).

**Cache busting:** every local import carries `?v=N` (`from './world.js?v=18'`), and so do `js/main.js` and `css/style.css` in `index.html`. When changing JS, bump N everywhere in one go and keep it identical across all files. If two files import the same module with different query strings, the browser loads two separate instances, which breaks shared singletons such as `sharedUniforms` in `world.js`.

```
sed -i -E "s#(from '\./[a-z]+\.js)(\?v=[0-9]+)?'#\1?v=18'#g" js/*.js
sed -i -E "s#(js/main\.js|css/style\.css)(\?v=[0-9]+)?\"#\1?v=18\"#g" index.html
```

## Architecture

`js/main.js` is the orchestrator: settings (localStorage key `entrenubes2`), menu/showroom scene, input (keyboard, mouse head-look, gamepad), cameras, warnings/mission chip, the game loop and flight start/restart. Flights always start on the origin runway threshold, helicopters included.

Main loop per frame: input → fixed-step physics (`STEP = 1/120`, accumulated) → combat/mission update → physics events (`crash`, `touchdown`) → model animation → camera → `world.update` (chunk streaming with a time budget) → `env.update` → cockpit instrument redraw → HUD → audio → `fx.render` (post-processing) → tactical marker overlay.

**HUD rule:** there is no separate exterior HUD design. In the cockpit, flight data lives in the aircraft's HUD (combiner canvas in `cockpit.js`, drawn by `instruments.fighterHUD` or `instruments.heliHUD`) and the instrument panels. In exterior views, `TacticalHUD.flightHUD` (`hud.js`) draws that same HUD into its own 512 px canvas and overlays it centred on screen. Its pitch ladder uses the camera's pixels-per-degree, and its gun reticle is suppressed because `draw()` already shows the lead reticle. `TacticalHUD.mapOverlay` adds the cockpit moving map (`NavMap.draw`, redrawn at 15 Hz into its own canvas) in the bottom-right corner. Exterior views also show warnings, messages, the mission chip (which carries ammo/armour in combat) and the toolbar.

**Cockpit zoom:** the mouse wheel in cockpit view does not change the FOV. It leans the eye toward where the pilot looks (`state.lean`, applied in `updateCamera`), so the HUD and screens grow while the outside view stays wide. The fighter HUD is conformal: `Cockpit.hudGeo(eye)` recomputes pixels-per-degree and the boresight point from the current eye position every redraw, so it stays aligned while leaning.

**Shader warm-up:** `startFlight` calls `renderer.compileAsync` behind the loading screen. Without it, the 100+ material variants compile during the first seconds of flight and the frame rate collapses on integrated GPUs.

**Coordinate conventions (used everywhere):** aircraft nose points to −Z, up is +Y, right is +X. North = −Z, east = +X. Heading in degrees = `-euler.y` with Euler order `'YXZ'`. For a runway heading `hdg`, the direction is `(sin hdg, 0, -cos hdg)`. Airport-local coordinates are `u` (along the runway) and `v` (to the right of it), via `world.airportLocal` / `world.localToWorld`.

**Two-pass rendering in cockpit view:** cockpit meshes live on layer 1. The world renders first (layer 0, near plane 0.3), then the depth buffer is cleared and the cockpit renders with near 0.02. Lights and the sun's shadow camera have layer 1 enabled. A logarithmic depth buffer was tried and dropped for performance, so do not reintroduce it. Exterior parts listed in `model.parts.hide` are hidden in cockpit view.

### Modules

- `world.js`: terrain and scenery.
  - Height comes from analytic noise (`baseHeight`), then city flattening, then airport flattening.
  - `groundHeight()` interpolates on the same triangle grid as the nearest LOD mesh (`PHYS_RES` must match the finest `lodFor` resolution). Physics and object placement use it so things sit on the faceted mesh.
  - Terrain is streamed in 1000 m chunks with LOD and skirts. Objects (trees, buildings, villages, farms, wind turbines) are per-chunk `InstancedMesh`es built within a smaller radius.
  - Fields, roads and city streets are drawn in the terrain shader (`onBeforeCompile`), not as geometry. City buildings must avoid the 100 m street grid that the shader paints. Building windows and night lights are also shader-driven via `sharedUniforms.uNight`.
  - `addAirport` builds the runway, lights, PAPI and terminal, adds a city next to it, and invalidates nearby chunks.
- `aircraft.js`: data catalog of six aircraft (F-14, F-16, F/A-18, A-10, AH-64, LHX); `rating` and `role`/`livery` only feed the menu's spec card; `ARMS` holds armament for combat modes. Physics coefficients are derived in `FlightModel` from real-ish numbers (`mass`, `S`, `vs` stall speed, `vmax`, `tw`), so tune these rather than hard-coding coefficients. Each entry also sets `eye` (pilot eye position in model coordinates), `cockpit` style, `panel` layout and `head` limits.
- `models.js`: procedural low-poly models, using `flatShading` + `DoubleSide` everywhere so mirrored geometry needs no winding fixes.
  - Fuselages are lathe profiles split into rear/mid/front so the cockpit section can be hidden.
  - Builders return `parts` (gear, props, rotors, surfaces, afterburner, sweep, nav lights, hide list) that `main.js` animates generically.
  - `buildModel` ends with `applyLivery` from `livery.js`.
- `livery.js`: visual identity of each aircraft.
  - `LIVERIES[id].skins` maps a material colour (hex) to a procedural skin texture (camouflage, panel lines, rivets, grime). Any `MeshStandardMaterial` whose colour matches is replaced, and the mesh gets box-projected UVs in model space so the pattern is continuous across parts. To skin a part, give it a colour listed there.
  - Decals are canvas textures (`DECALS.*`) placed with `addDecal` (`'side'` faces +X, `mirror` adds the −X copy; `flipText:false` mirrors the art instead of keeping text readable).
  - It also adds edge outlines (`EdgesGeometry`, toggled by `setEdgesVisible`; call `forgetEdges` when discarding a model) and registers materials for the PMREM sky reflection whose intensity `main.js` scales with daylight.
- `cockpit.js`: interior builders keyed by `spec.cockpit`, with coordinates relative to the eye. Panels are declared in `PANELS` as items in canvas pixels (`mfd`, `gauge`, `box`, plus static `deco`) and built in three layers: a static lit faceplate canvas (with bump), a transparent self-lit live canvas redrawn at about 15 Hz by `instruments.js`, and real geometry (bezels, instanced push-buttons, gauge rings, glass). The HUD redraws at 30 Hz.
- `navmap.js`: moving map for the cockpit MFDs. A north-up shaded-relief cache (32 km) is rebuilt row by row within a time budget (`update`, called every frame; primed synchronously in `startFlight`), then drawn heading-up with range rings, airports, route and combat contacts.
- `physics.js`: `FlightModel`.
  - Planes use a lift/drag model with auto-trim toward level-flight angle of attack.
  - Helicopters are arcade-style: 50 % collective = hover, tilt is compensated, attitude-command cyclic, and drag is computed in ground axes so pitching forward accelerates instead of sinking.
  - `input.assist` (the "pilotaje asistido" setting, on by default) changes behaviour. Planes: roll keys move a held bank target (`bankHold`, 70°/s, ±75°) that stays when released (the owner wants the turn kept until the opposite key is pressed; a ±4° detent snaps to wings level), plus coordinated-turn feed-forward and stall protection. Helicopters (`arcadeHeli`): A/D move a held bank target too (`heliBank`, 45°/s, ±35°, ±3° detent, reset on the ground), as the owner wants the same feel as planes. W/S likewise set a held forward-speed target (`heliSpd`, 14 m/s per second, ±2 m/s detent). Braking stops at hover (`spdStop`), so going backwards needs a fresh press. The held bank slides the helicopter sideways below about 12 m/s forward and turns it above (coordinated turn ×3, no crab). In reverse it only slides. Q/E always yaw, and lateral velocity is damped so the path follows the nose. Assisted planes skip the bank-angle logic above 60° pitch, because Euler roll flips during loops.
  - Ground contact handles crash rules and tire/skid friction.
- `environment.js`: sky shader, sun and moon, stars, fog, instanced low-poly clouds plus an overcast layer, rain and snow, lightning, and wind. Weather presets are in `WEATHER`; transitions are interpolated.
- `audio.js`: WebAudio-synthesized sounds only (no audio files). Initialized on the first user gesture.
- `missions.js` (modes `free`, `cas`, `dogfight`; `free` has no mission object), `combat.js` (ballistics, rockets, ground units and AI fighters), `hud.js` (screen-space target markers; the gun reticle is suppressed in cockpit view), `postfx.js` (bloom + SSAO, disabled at low quality; optional final CRT monitor pass, setting `crt`, on by default, which keeps the composer alive at low quality without bloom/SSAO. Its barrel curvature `CRT_CURVE` is inverted in `hud.js` `toScreen` so tactical markers stay on their targets), `effects.js` (particles).

Saved settings are migrated on load in `main.js`: unknown aircraft or mode ids fall back to defaults, and a `schema` number forces one-off resets.

## Git

The remote uses the SSH host alias `github.com-malbot042` defined in `~/.ssh/config`. The repository belongs to the `malbot042` account; the default SSH key on this machine authenticates as a different GitHub user.
