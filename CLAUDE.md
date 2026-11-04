# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Entre Nubes" — a browser 3D flight simulator (planes and helicopters) in plain JavaScript ES modules + Three.js r160 loaded from jsDelivr via the import map in `index.html`. It is deployed as static files on GitHub Pages (`.nojekyll` at the root). UI text, comments and commit messages are in Spanish.

**Constraint from the owner: no Node, npm, bundler or build step.** Everything must run by serving the folder statically.

## Running

```
python3 -m http.server 8000   # then open http://localhost:8000
```

There are no tests, linter or build. To verify changes, load the page in a browser and check the console. `window.__entreNubes` exposes `{ state, scene, camera, env, combat, targeting, … }` for debugging (for example `state.fm` is the flight model and `state.world` the terrain).

**Cache busting:** every local import carries `?v=N` (`from './world.js?v=39'`), and so do `js/main.js` and `css/style.css` in `index.html`. When changing JS, bump N everywhere in one go and keep it identical across all files. If two files import the same module with different query strings, the browser loads two separate instances, which breaks shared singletons such as `sharedUniforms` in `world.js`.

The game version shown to players (fixed `#version` label in the bottom-right corner on every screen, console, `window.__entreNubes.version`) is this same N, read from `import.meta.url` in `main.js`. Bumping the cache number therefore publishes a new version: bump it with every change that gets committed, and mention it in the commit message.

```
sed -i -E "s#(from '\./[a-z]+\.js)(\?v=[0-9]+)?'#\1?v=39'#g" js/*.js
sed -i -E "s#(js/main\.js|css/style\.css)(\?v=[0-9]+)?\"#\1?v=39\"#g" index.html
```

## Architecture

`js/main.js` is the orchestrator: settings (localStorage key `entrenubes2`), menu/showroom scene, input (keyboard, mouse head-look, gamepad), cameras, warnings/mission chip, the game loop and flight start/restart. Flights always start on the origin runway threshold, helicopters included.

**Simplified controls (owner's request):** `autoSystems()` in `main.js` handles the parking brake (released when throttle > 30 %), gear (up after takeoff, down on approach), flaps (half at low speed, up when fast) and night lights. Pressing G, X, P or L disables that automation for the flight (`state.manual`), except the safety gear-down on approach. The help window is a compact three-column grid; keep it short.

**Screens pause the game:** each frame computes `frozen` = pause, tactical map, or any visible `.window` (help, settings, weather, armory, result). Physics, combat and timers stop while frozen, and Esc closes the open screen before it pauses.

Main loop per frame: input → fixed-step physics (`STEP = 1/120`, accumulated) → combat/mission update → physics events (`crash`, `touchdown`) → model animation → camera → `world.update` (chunk streaming with a time budget) → `env.update` → cockpit instrument redraw → HUD → audio → `fx.render` (post-processing) → tactical marker overlay.

**HUD rule:** there is no separate exterior HUD design. In the cockpit, flight data lives in the aircraft's HUD (combiner canvas in `cockpit.js`, drawn by `instruments.fighterHUD` or `instruments.heliHUD`) and the instrument panels. In exterior views, `TacticalHUD.flightHUD` (`hud.js`) draws that same HUD into its own 512 px canvas and overlays it centred on screen. Its pitch ladder uses the camera's pixels-per-degree, and its gun reticle is suppressed because `draw()` already shows the lead reticle. `TacticalHUD.mapOverlay` adds the cockpit moving map (`NavMap.draw`, redrawn at 15 Hz into its own canvas) in the bottom-right corner. Exterior views also show warnings, messages, the mission chip (which carries ammo/armour in combat) and the toolbar.

**Helmet visor (K):** `state.visor` cycles off → green night vision (1) → thermal (2). It only acts in cockpit view; enabling it switches to that view.
- `postfx` `NightPass` (after `OutputPass`, before CRT) filters the image. Green mode uses auto gain from `env.night`; thermal mode darkens bluish (cold) pixels, and `combat.setThermal` gives the units white emissive so they saturate.
- `TacticalHUD.hmd` draws head-fixed symbology on screen: line-of-sight heading tape, speed and altitude boxes, conformal horizon and nose symbol, head-orientation box, weapons and target.
- The aircraft HUD is dimmed (`Cockpit.setHudDim`), so it becomes secondary. The owner chose symbols only: no head-slaved aiming.

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
- `navmap.js`: moving map for the cockpit MFDs. `ReliefCache` is a north-up shaded-relief canvas of any span and resolution. It is rebuilt row by row within a time budget into a back buffer and published when finished. `NavMap` keeps a 32 km cache around the aircraft (`update`, called every frame; primed synchronously in `startFlight`) and draws it heading-up with range rings, airports, route and combat contacts.
- `tacmap.js`: full-screen tactical map (J or the toolbar button). Mouse wheel zooms around the cursor and dragging pans; it follows the aircraft until panned. It shows airports, the route, the aircraft and every target, with a side list sorted by distance. Clicking a target on the map or in the list designates it (`targeting.select(e, true)`); a manual designation is kept even out of range (`cur.far`), and the HUD arrow guides the player to it.
  - The relief layers a 96 km cache around the aircraft (kept warm with a 0.4 ms budget while the map is closed), the NavMap cache, and a detail cache that follows the view and is rebuilt on zoom.
  - The list selects on `pointerdown`: it is regenerated several times a second, and a click spanning two regenerations would be lost.
- `physics.js`: `FlightModel`.
  - Planes use a lift/drag model with auto-trim toward level-flight angle of attack.
  - Helicopters are arcade-style: 50 % collective = hover, tilt is compensated, attitude-command cyclic, and drag is computed in ground axes so pitching forward accelerates instead of sinking.
  - `input.assist` (the "pilotaje asistido" setting, on by default) changes behaviour. Planes: roll keys move a held bank target (`bankHold`, 70°/s, ±75°) that stays when released (the owner wants the turn kept until the opposite key is pressed; a ±4° detent snaps to wings level), plus coordinated-turn feed-forward and stall protection. Helicopters (`arcadeHeli`) fly like the planes, which the owner asked for explicitly after rejecting several arcade schemes.
    - W/S move a held nose attitude (`hPitch`, −15°…+10°). A/D move a held bank (`hBank`, ±40°). Both stay when released. Pressing the opposite key stops exactly at level (the `*Stop` flags), so going past level needs a fresh press.
    - Everything derives from the smoothed attitude (`visPitch`/`visRoll`). The forward speed target is proportional to nose-down tilt (15° = `vmax`; level = hover; nose up = slow reverse). The bank gives a coordinated turn ×3, capped, and also turns at hover. Q/E are pedals.
    - The velocity is re-projected onto the new heading, and lateral grip removes drift.
  - Assisted planes skip the bank-angle logic above 60° pitch, because Euler roll flips during loops.
  - Ground contact handles crash rules and tire/skid friction.
- `environment.js`: sky shader, sun and moon, stars, fog, instanced low-poly clouds plus an overcast layer, rain and snow, lightning, and wind. Weather presets are in `WEATHER`; transitions are interpolated.
- `audio.js`: WebAudio-synthesized sounds only (no audio files). Initialized on the first user gesture.
- Weapons are always available (owner's request). `combat.armPlayer` runs in every mode.
  - `missions.js` has modes `free`, `cas` and `dogfight`; `free` has no mission object. Instead it runs `Training` (`state.training`): non-firing training targets (`e.training`), which are vehicle groups plus circling drones (`combat.spawnDrone`). It keeps 6 ground targets and 3 drones ahead of the player, discards those left more than 14 km behind, and reloads the weapons when they run out.
  - `targeting.js` (`Targeting`) is the cockpit target system. It locates units in range, auto-selects the one closest to the nose (Tab or gamepad D-pad right cycles), identifies it after 0.5 s, and locks it while it stays inside the lock cone. A wider hold cone gives hysteresis, and helicopters get wider cones than planes.
  - Once locked, `combat.fire` aims the gun at the lead point (`leadPoint`: relative motion plus bullet drop) if the target is inside the gun cone, and rockets home on it with a proximity fuse. Rockets explode at the closest point of their step to the target, because at low FPS they move tens of metres per frame.
  - The target data reaches the instruments as `inst.tgt` / `inst.contacts`. It drives the TGT MFD page (`instruments.targetPage`): the F-16/F-18/A-10 right MFD, the Apache/LHX left MFD, and the F-14 TID while the target is within 30° of the nose. It also drives the HUD target line and cue (`hudTarget`) and the designation box in `hud.js`.
- Weapon selection: each aircraft's `ARMS` entry (`aircraft.js`) has a gun, rockets, and optional `ag` (air-to-ground) and `aa` (air-to-air) missiles. Space always fires the gun; Z fires the weapon in `combat.prefs.sel` (Y cycles it). `combat.prefs` also holds the gun mode (`burst`: 0.4 s per press), automatic gun aim (`aim`) and the rocket salvo (`salvo`, 0 = continuous); `main.js` saves it in `settings.weapons`.
  - Missiles need a locked target of the right kind (`aa` air, `ag` ground). They are homing projectiles in `combat.rockets` with their own thrust, turn rate, life and a direct-hit `dmg`. Refusals are reported through `combat.notify`.
  - `armory.js` is the weapons screen (I or the toolbar button). It shows a top-view diagram of the stores, a card per weapon with its firing options and readiness against the current target, and the target status. Like the map's target list, its buttons act on `pointerdown`.
- `combat.js` (ballistics, rockets, missiles, ground units, AI fighters and drones), `hud.js` (screen-space target markers and the designated-target box; the gun reticle is suppressed in cockpit view), `postfx.js` (bloom + SSAO, disabled at low quality; optional final CRT monitor pass, setting `crt`, on by default, which keeps the composer alive at low quality without bloom/SSAO. It is flat on purpose: the owner rejected the barrel curvature), `effects.js` (particles).

Saved settings are migrated on load in `main.js`: unknown aircraft or mode ids fall back to defaults, and a `schema` number forces one-off resets.

## Git

The remote uses the SSH host alias `github.com-malbot042` defined in `~/.ssh/config`. The repository belongs to the `malbot042` account; the default SSH key on this machine authenticates as a different GitHub user.
