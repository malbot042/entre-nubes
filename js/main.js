// Entre Nubes — bucle principal, cámaras, entrada, HUD y menús.
import * as THREE from 'three';
import { AIRCRAFT, AIRCRAFT_BY_ID, CATEGORIES } from './aircraft.js?v=21';
import { buildModel } from './models.js?v=21';
import { Cockpit } from './cockpit.js?v=21';
import { FlightModel } from './physics.js?v=21';
import { World, CHUNK } from './world.js?v=21';
import { Environment, WEATHER } from './environment.js?v=21';
import { AudioEngine } from './audio.js?v=21';
import { mulberry32, clamp, lerp, smoothstep, DEG, RAD } from './util.js?v=21';
import { PostFX, CRT_CURVE } from './postfx.js?v=21';
import { Particles } from './effects.js?v=21';
import { Combat } from './combat.js?v=21';
import { MODES, createMission, isCombat } from './missions.js?v=21';
import { TacticalHUD } from './hud.js?v=21';
import { NavMap } from './navmap.js?v=21';
import { createEnvMap, setEnvIntensity, setEdgesVisible, forgetEdges } from './livery.js?v=21';

// ---------------- Ajustes persistentes ----------------
const DEFAULTS = { aircraft: 'f16', time: '13', weather: 'clear', dist: 'medium', quality: 'medium', shadows: true, volume: 0.7, units: 'aviation', invert: false, fuel: true, mouse: 1, fov: 72, mode: 'free', mouseFly: false, timeflow: true, assist: true, edges: true, crt: true, best: {} };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('entrenubes2') || '{}')); } catch (_) { }
// ajustes guardados de versiones anteriores (aeronaves o modos retirados)
if (!AIRCRAFT_BY_ID[settings.aircraft]) settings.aircraft = DEFAULTS.aircraft;
if (!MODES.some(m => m.id === settings.mode)) settings.mode = 'free';
delete settings.hud; // el HUD exterior ya no existe
const save = () => { try { localStorage.setItem('entrenubes2', JSON.stringify(settings)); } catch (_) { } };

// ---------------- Render ----------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const applyPixelRatio = () => renderer.setPixelRatio({ low: 0.75, medium: Math.min(devicePixelRatio, 1.25), high: Math.min(devicePixelRatio, 2) }[settings.quality] || 1);
applyPixelRatio();

const fx = new PostFX(renderer);
fx.setQuality(settings.quality);
fx.crt = settings.crt;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.5, 45000);
scene.add(camera);
const env = new Environment(scene, renderer);
createEnvMap(renderer);
const audio = new AudioEngine();
audio.setVolume(settings.volume);
env.onThunder = () => audio.thunder();
// la cabina se dibuja en una segunda pasada (capa 1) con su propio plano cercano
for (const l of [env.sun, env.hemi, env.ambient]) l.layers.enable(1);
env.sun.shadow.camera.layers.enableAll();
const particles = new Particles(scene);
const combat = new Combat(scene, particles, audio);
const tacHud = new TacticalHUD(document.getElementById('hud-canvas'));
tacHud.curve = settings.crt ? CRT_CURVE : null;

// Escena del hangar (menú)
const menuScene = new THREE.Scene();
const menuCam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2000);
{
  // cúpula de cielo: el horizonte coincide con el color de la niebla del suelo
  menuScene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = max(normalize(vP).y, 0.0);
        vec3 c = mix(vec3(1.0,0.46,0.3), vec3(0.2,0.42,0.95), smoothstep(0.0,0.22,h));
        c = mix(c, vec3(0.02,0.08,0.42), smoothstep(0.18,0.7,h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })));
  menuScene.add(new THREE.HemisphereLight(0xa8f0f0, 0x7a4488, 2.2));
  const d = new THREE.DirectionalLight(0xfff0dc, 3.4); d.position.set(-35, 45, 30); d.castShadow = true; d.shadow.normalBias = 0.06; d.shadow.bias = -0.0006;
  d.shadow.camera.left = d.shadow.camera.bottom = -25; d.shadow.camera.right = d.shadow.camera.top = 25; d.shadow.mapSize.set(2048, 2048);
  menuScene.add(d);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f8f62, roughness: 0.95, flatShading: true }));
  ground.receiveShadow = true; menuScene.add(ground);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(28, 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4c5e, roughness: 0.8, flatShading: true }));
  pad.position.y = 0.02; pad.receiveShadow = true; menuScene.add(pad);
  menuScene.fog = new THREE.FogExp2(new THREE.Color(1.0, 0.46, 0.3), 0.0075);
}
let menuModel = null;

// ---------------- Estado ----------------
const state = {
  mode: 'menu', // menu | flying
  paused: false,
  cam: 'cockpit',
  world: null, fm: null, model: null, cockpit: null, spec: null,
  origin: null, dest: null,
  headYaw: 0, headPitch: 0, headYawT: 0, headPitchT: 0, lean: 0, leanS: 0,
  orbitYaw: 0, orbitPitch: 0.18, orbitDist: 1, chaseYaw: 0,
  flybyPos: new THREE.Vector3(), flybyT: 0,
  lights: false, arrived: false, flightTime: 0, distFlown: 0, lastTouch: null,
  seed: 1, input: { pitch: 0, roll: 0, yaw: 0, brake: false, speedbrake: false },
  gearWarned: false, mission: null,
};
const eyePivot = new THREE.Group();
// versión del juego: es el número de caché ?v=N con el que index.html carga este módulo
const VERSION = 'v' + (new URL(import.meta.url).searchParams.get('v') || 'dev');
for (const el of document.querySelectorAll('[data-version]')) el.textContent = `Entre Nubes ${VERSION}`;
console.info(`Entre Nubes ${VERSION}`);
window.__entreNubes = { state, scene, camera, env, combat, particles, fx, version: VERSION };
const keys = new Set();
const defPitch = () => (state.spec?.type === 'heli' ? -8 : -6) * DEG;

// ---------------- Utilidades UI ----------------
const $ = (id) => document.getElementById(id);
function toast(text, cls = '', ms = 2600) {
  const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text;
  $('messages').appendChild(d);
  setTimeout(() => d.remove(), ms);
}
function openWin(id) {
  document.querySelectorAll('.window').forEach(w => { if (w.id !== id && w.id !== 'result') w.classList.add('hidden'); });
  $(id).classList.toggle('hidden');
}
document.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); openWin(b.dataset.win); }));
document.querySelectorAll('.window .close').forEach(b => b.addEventListener('click', () => b.closest('.window').classList.add('hidden')));
// ventanas arrastrables
document.querySelectorAll('.window .win-head').forEach(h => {
  h.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const w = h.closest('.window'); const r = w.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const mv = (ev) => { w.style.left = (ev.clientX - ox + r.width / 2) + 'px'; w.style.top = (ev.clientY - oy + r.height / 2) + 'px'; };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
});

// ---------------- Menú ----------------
let currentCat = AIRCRAFT_BY_ID[settings.aircraft]?.cat || 'plane';
const unarmedFor = (a, mode) => isCombat(mode) && !a.arms;
const MODE_SUB = { free: 'Explora y aterriza', cas: 'Tanques y antiaéreos', dogfight: 'Oleadas de cazas' };
function buildModes() {
  const box = $('mode-tabs'); box.innerHTML = '';
  for (const m of MODES) {
    const b = document.createElement('button');
    b.className = 'mode' + (m.id === settings.mode ? ' active' : '');
    b.innerHTML = `<i>${m.icon}</i>${m.name}<small>${MODE_SUB[m.id] || ''}</small>`;
    b.title = m.desc;
    b.onclick = () => {
      settings.mode = m.id;
      // los modos de combate exigen una aeronave armada
      if (unarmedFor(AIRCRAFT_BY_ID[settings.aircraft], m.id)) {
        settings.aircraft = m.id === 'cas' ? 'a10' : 'f14';
        currentCat = AIRCRAFT_BY_ID[settings.aircraft].cat;
        showPreview();
      }
      save(); buildMenu();
    };
    box.appendChild(b);
  }
  $('opt-dist-wrap').style.visibility = settings.mode === 'free' ? '' : 'hidden';
  $('btn-fly').textContent = settings.mode === 'free' ? 'DESPEGAR ✈' : 'A COMBATE ✈';
}
function buildMenu() {
  buildModes();
  const tabs = $('cat-tabs'); tabs.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button'); b.textContent = c.name; b.className = c.id === currentCat ? 'active' : '';
    b.onclick = () => { currentCat = c.id; buildMenu(); };
    tabs.appendChild(b);
  }
  const list = $('aircraft-list'); list.innerHTML = '';
  for (const a of AIRCRAFT.filter(a => a.cat === currentCat)) {
    const locked = unarmedFor(a, settings.mode);
    const d = document.createElement('div'); d.className = 'card' + (a.id === settings.aircraft ? ' active' : '') + (locked ? ' locked' : '');
    d.innerHTML = `<div class="n">${a.name}</div><div class="s">${locked ? 'Sin armamento' : a.role}</div><div class="tag">${Math.round(a.vmax * 3.6)} km/h</div>`;
    d.onclick = () => { if (locked) return; settings.aircraft = a.id; save(); buildMenu(); showPreview(); };
    list.appendChild(d);
  }
  fillSpecCard(AIRCRAFT_BY_ID[settings.aircraft]);
  $('opt-assist').checked = settings.assist;
  const ws = $('opt-weather');
  if (!ws.options.length) for (const [k, w] of Object.entries(WEATHER)) ws.add(new Option(w.name, k));
  ws.value = settings.weather; $('opt-time').value = settings.time; $('opt-dist').value = settings.dist;
}
for (const id of ['opt-weather', 'opt-time', 'opt-dist']) {
  $(id).addEventListener('change', () => {
    settings.weather = $('opt-weather').value; settings.time = $('opt-time').value;
    settings.dist = $('opt-dist').value; save();
  });
}
function fillSpecCard(a) {
  if (!a) return;
  $('spec-role').textContent = a.role;
  $('spec-name').textContent = a.name;
  $('spec-livery').textContent = a.livery;
  $('spec-desc').textContent = a.desc;
  const pips = (n) => Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  const r = a.rating;
  $('spec-bars').innerHTML = [['VELOCIDAD', r.speed], ['AGILIDAD', r.agility], ['BLINDAJE', r.armor], ['FUEGO', r.fire]]
    .map(([l, v]) => `<span>${l}</span><div class="pips">${pips(v)}</div>`).join('');
  const arms = a.arms;
  $('spec-data').innerHTML = `<span>Vmáx <b>${Math.round(a.vmax * 3.6)} km/h</b></span><span>Masa <b>${(a.mass / 1000).toFixed(1)} t</b></span>` +
    (arms ? `<span>Cañón <b>${arms.gun.ammo}</b></span><span>Cohetes <b>${arms.rockets}</b></span>` : '');
}
$('opt-assist').addEventListener('change', () => { settings.assist = $('opt-assist').checked; $('set-assist').checked = settings.assist; save(); });
function showPreview() {
  if (menuModel) { menuScene.remove(menuModel.group); forgetEdges(menuModel.group); }
  menuModel = buildModel(settings.aircraft);
  const g = menuModel.group;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3()).length();
  g.position.y = menuModel.gearHeight;
  menuScene.add(g);
  menuModel.size = size;
  for (const d of menuModel.parts.discs) d.material.opacity = 0;
  setEdgesVisible(settings.edges);
}
$('btn-fly').addEventListener('click', () => { audio.init(); startFlight(); });

// ---------------- Ajustes UI ----------------
function bindSettings() {
  const q = $('set-quality'); q.value = settings.quality;
  q.onchange = () => { settings.quality = q.value; save(); applyPixelRatio(); fx.setQuality(q.value); fx.resize(innerWidth, innerHeight); env.viewLimit = viewLimit(); if (state.world) state.world.setQuality(q.value); };
  const sh = $('set-shadows'); sh.checked = settings.shadows;
  sh.onchange = () => { settings.shadows = sh.checked; save(); renderer.shadowMap.enabled = sh.checked; env.sun.castShadow = sh.checked; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); };
  const v = $('set-volume'); v.value = settings.volume; v.oninput = () => { settings.volume = +v.value; save(); audio.setVolume(settings.volume); };
  const u = $('set-units'); u.value = settings.units; u.onchange = () => { settings.units = u.value; save(); };
  const inv = $('set-invert'); inv.checked = settings.invert; inv.onchange = () => { settings.invert = inv.checked; save(); };
  const ed = $('set-edges'); ed.checked = settings.edges; ed.onchange = () => { settings.edges = ed.checked; save(); setEdgesVisible(settings.edges); };
  const crt = $('set-crt'); crt.checked = settings.crt; crt.onchange = () => { settings.crt = crt.checked; save(); fx.crt = crt.checked; tacHud.curve = crt.checked ? CRT_CURVE : null; };
  const as = $('set-assist'); as.checked = settings.assist; as.onchange = () => { settings.assist = as.checked; $('opt-assist').checked = as.checked; save(); toast(settings.assist ? 'Pilotaje asistido activado' : 'Pilotaje asistido desactivado'); };
  const fu = $('set-fuel'); fu.checked = settings.fuel; fu.onchange = () => { settings.fuel = fu.checked; save(); if (state.fm) state.fm.infiniteFuel = fu.checked; };
  const ms = $('set-mouse'); ms.value = settings.mouse; ms.oninput = () => { settings.mouse = +ms.value; save(); };
  const mf = $('set-mousefly'); mf.checked = settings.mouseFly; mf.onchange = () => { settings.mouseFly = mf.checked; save(); };
  const tf = $('set-timeflow'); tf.checked = settings.timeflow; tf.onchange = () => { settings.timeflow = tf.checked; save(); };
  const fov = $('set-fov'); fov.value = settings.fov; $('fov-val').textContent = settings.fov + '°';
  fov.oninput = () => { settings.fov = +fov.value; $('fov-val').textContent = settings.fov + '°'; save(); };
  // clima
  const wb = $('weather-buttons'); wb.innerHTML = '';
  for (const [k, w] of Object.entries(WEATHER)) {
    const b = document.createElement('button'); b.textContent = w.name; b.dataset.k = k;
    b.onclick = () => { env.setWeather(k); settings.weather = k; save(); refreshWeatherButtons(); toast(`Clima: ${w.name}`); };
    wb.appendChild(b);
  }
  const t = $('set-time');
  t.oninput = () => { env.setTime(+t.value); updateTimeLabel(); };
  refreshWeatherButtons();
}
const viewLimit = () => ({ low: 5, medium: 8, high: 11 }[settings.quality] || 8) * 1150;
env.viewLimit = viewLimit();
function refreshWeatherButtons() { document.querySelectorAll('#weather-buttons button').forEach(b => b.classList.toggle('active', b.dataset.k === env.weatherKey)); }
function updateTimeLabel() {
  const h = env.hour; $('set-time').value = h.toFixed(1);
  $('time-label').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}

// ---------------- Vuelo ----------------
const DIST = { short: [8000, 15000], medium: [20000, 40000], long: [60000, 120000] };

function setLoading(on, text) { $('loading').classList.toggle('hidden', !on); if (text) $('loading-text').textContent = text; }

async function startFlight(keepWorld = false) {
  document.activeElement?.blur(); // Espacio dispara: no debe pulsar un botón con el foco
  setLoading(true, 'Generando terreno…');
  await new Promise(r => setTimeout(r, 30));
  $('menu').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('result').classList.add('hidden');
  state.paused = false;
  if (!keepWorld || !state.world) {
    if (state.world) state.world.dispose();
    state.seed = (Math.random() * 1e9) | 0;
    const rnd = mulberry32(state.seed);
    const world = new World(state.seed, scene, settings.quality);
    state.world = world;
    state.navMap = new NavMap(world);
    state.origin = world.addAirport(0, 0, rnd, false);
    makeDestination(state.origin.x, state.origin.z, rnd() * Math.PI * 2, rnd);
  }
  env.setTime(parseFloat(settings.time));
  env.setWeather(settings.weather, true);
  refreshWeatherButtons(); updateTimeLabel();
  const mission = beginMission();
  if (mission) state.cam = 'chase';
  spawnAircraft(settings.aircraft, mission?.startInAir ? 'air' : 'runway');
  mission?.start();
  setLoading(true, 'Cargando escenario…');
  await new Promise(r => setTimeout(r, 20));
  state.world.update(state.fm.pos, 0, 0, true);
  state.navMap.update(state.fm.pos.x, state.fm.pos.z, Infinity);
  // precompila los shaders con la pantalla de carga visible: evita tirones al empezar a volar
  setLoading(true, 'Preparando shaders…');
  await new Promise(r => setTimeout(r, 20));
  updateCamera(0);
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera);
  setLoading(false);
  state.mode = 'flying';
  $('hud').classList.remove('hidden');
  toast(`${state.origin.icao} ${state.origin.name}  →  ${state.dest.icao} ${state.dest.name}`, '', 5000);
  if (mission?.startInAir) toast('Espacio: cañón · Z: cohetes · Shift / Ctrl: potencia', '', 6000);
  else toast(state.spec.type === 'heli' ? 'Colectivo con Shift/Ctrl o R/F: al 50 % se mantiene en el aire' : 'Gases con Shift o R, suelta frenos con P', '', 5000);
}

// Contexto compartido con los modos de juego
function beginMission() {
  state.mission?.dispose();
  combat.reset();
  state.world.focus = null;
  const ctx = {
    get fm() { return state.fm; }, get spec() { return state.spec; }, get model() { return state.model; },
    get mission() { return state.mission; },
    get world() { return state.world; }, get dest() { return state.dest; }, get seed() { return state.seed; },
    get origin() { return state.missionOrigin || state.origin; }, set origin(v) { state.missionOrigin = v; },
    scene, combat: isCombat(settings.mode) ? combat : null, fx: particles, audio, toast,
    showResult, hideResult: () => $('result').classList.add('hidden'), restart, toMenu, saveBest,
  };
  state.missionOrigin = null;
  state.mission = createMission(settings.mode, ctx);
  const on = !!state.mission;
  $('hud-mission').classList.toggle('hidden', !on);
  $('btn-newdest').style.display = on ? 'none' : '';
  return state.mission;
}

function saveBest(key, score) {
  settings.best = settings.best || {};
  settings.best[key] = Math.max(settings.best[key] || 0, score);
  save();
  return settings.best[key];
}

function showResult({ title, big, html, cls = '', primary, secondary }) {
  $('result-title').textContent = title;
  $('result-body').innerHTML = `<div class="big ${cls}">${big}</div>${html}`;
  const [pl, pf] = primary, [sl, sf] = secondary;
  $('btn-continue').textContent = pl; $('btn-continue').onclick = pf;
  $('btn-result-new').style.display = 'none';
  $('btn-result-menu').textContent = sl; $('btn-result-menu').onclick = sf;
  $('result').classList.remove('hidden');
}

function makeDestination(fromX, fromZ, bearing, rnd, range = DIST[settings.dist]) {
  const [a, b] = range;
  const d = a + rnd() * (b - a);
  const x = fromX + Math.sin(bearing) * d, z = fromZ - Math.cos(bearing) * d;
  if (state.dest) {
    state.dest.isDestination = false;
    if (state.dest.beam) { state.dest.group.remove(state.dest.beam); state.dest.beam = null; }
  }
  state.dest = state.world.addAirport(x, z, rnd, true);
  state.arrived = false;
}

function newDestinationHere() {
  if (!state.fm || state.mission) return;
  const rnd = mulberry32((Math.random() * 1e9) | 0);
  const hdg = -state.fm.euler.y;
  makeDestination(state.fm.pos.x, state.fm.pos.z, hdg + (rnd() - 0.5) * 1.6, rnd);
  toast(`Nuevo destino: ${state.dest.icao} ${state.dest.name}`, 'good', 4000);
  $('result').classList.add('hidden');
}

const navGlowTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();

function spawnAircraft(id, start) {
  if (state.model) { scene.remove(state.model.group); forgetEdges(state.model.group); }
  particles.clear();
  const spec = AIRCRAFT_BY_ID[id];
  state.spec = spec;
  const model = buildModel(id);
  state.model = model;
  scene.add(model.group);
  model.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // cabina
  const ck = new Cockpit(spec, state.navMap);
  ck.group.traverse(o => o.layers.set(1));
  state.cockpit = ck;
  eyePivot.position.copy(model.parts.eye);
  eyePivot.clear();
  eyePivot.add(ck.group);
  model.group.add(eyePivot);
  // luces de navegación con halo
  state.navSprites = [];
  for (const nl of model.parts.navLights) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: navGlowTex, color: nl.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.position.copy(nl.pos); sp.scale.setScalar(1.6);
    model.group.add(sp); state.navSprites.push(sp);
  }
  state.strobes = model.parts.strobes.map(p => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: navGlowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    sp.position.copy(p); sp.scale.setScalar(4); model.group.add(sp); return sp;
  });
  // faro de aterrizaje
  const ll = new THREE.SpotLight(0xfff4e0, 0, 900, 0.32, 0.5, 1.2);
  const lp = model.parts.landingLight || new THREE.Vector3(0, 0, -2);
  ll.position.copy(lp);
  ll.target.position.set(lp.x, lp.y - 0.25 * 10, lp.z - 10);
  ll.layers.enable(1);
  model.group.add(ll); model.group.add(ll.target);
  state.landingLight = ll;
  const llGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: navGlowTex, color: 0xfff4e0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  llGlow.position.copy(lp); llGlow.scale.setScalar(3); model.group.add(llGlow);
  state.llGlow = llGlow;

  // física
  const fm = new FlightModel(spec);
  fm.infiniteFuel = settings.fuel;
  state.fm = fm;
  const ap = state.origin;
  const w = state.world;
  if (start === 'air') {
    const dx = state.dest.x - ap.x, dz = state.dest.z - ap.z;
    const brg = Math.atan2(dx, -dz);
    const p = { x: ap.x + Math.sin(brg) * 2500, z: ap.z - Math.cos(brg) * 2500 };
    // salida por encima del relieve de los próximos kilómetros
    let gh = 0;
    for (let d = -500; d <= 4000; d += 500) gh = Math.max(gh, w.height(p.x + Math.sin(brg) * d, p.z - Math.cos(brg) * d));
    const alt = spec.type === 'heli' ? 180 : Math.max(450, 200 + spec.vs * 5);
    fm.pos.set(p.x, gh + alt, p.z);
    fm.quat.setFromEuler(new THREE.Euler(0, -brg, 0, 'YXZ'));
    const sp = spec.type === 'heli' ? 35 : Math.min(spec.vmax * 0.65, spec.vs * 2.4);
    fm.vel.set(Math.sin(brg) * sp, 0, -Math.cos(brg) * sp);
    fm.throttle = spec.type === 'heli' ? 0.5 : 0.8;
    fm.rpm = spec.type === 'heli' ? 1 : 0.75;
    fm.gearDown = !!(spec.gearFixed || (spec.type === 'heli' && !spec.gearRetract));
    fm.gear = fm.gearDown ? 1 : 0;
    fm.brakes = false;
    fm.onGround = false;
  } else {
    const p = w.localToWorld(ap, 0, -ap.len / 2 + 70);
    fm.pos.set(p.x, ap.elev + spec.gearH + 0.3, p.z);
    fm.quat.setFromEuler(new THREE.Euler((spec.taildragger || 0) * DEG, -ap.hdg, 0, 'YXZ'));
  }
  // cámara
  state.headYaw = state.headYawT = 0; state.headPitch = state.headPitchT = defPitch();
  state.lean = state.leanS = 0;
  const box = new THREE.Box3().setFromObject(model.group);
  state.modelSize = box.getSize(new THREE.Vector3()).length();
  model.size = state.modelSize;
  state.orbitDist = 1; state.orbitYaw = 0; state.orbitPitch = 0.15;
  state.chaseYaw = fm.euler.y;
  state.arrived = false; state.flightTime = 0; state.distFlown = 0; state.lastTouch = null;
  state.lights = env.night > 0.4;
  setCamera(state.cam === 'flyby' ? 'chase' : state.cam);
  setEdgesVisible(settings.edges);
  audio.setAircraft(spec);
}

function setCamera(mode) {
  state.cam = mode;
  const cockpit = mode === 'cockpit';
  for (const o of state.model.parts.hide) o.visible = !cockpit;
  state.cockpit.group.visible = cockpit;
  if (cockpit) {
    eyePivot.add(camera);
    camera.position.set(0, 0, 0);
    camera.near = 0.3;
  } else {
    scene.add(camera);
    camera.near = 0.8;
    if (mode === 'flyby') placeFlyby();
  }
  camera.updateProjectionMatrix();
  $('hud').classList.toggle('cockpit', cockpit);
}

function placeFlyby() {
  const fm = state.fm;
  const v = fm.vel.clone(); v.y = 0;
  if (v.lengthSq() < 4) v.set(Math.sin(-fm.euler.y) * -1, 0, -Math.cos(fm.euler.y));
  v.normalize();
  const side = new THREE.Vector3(-v.z, 0, v.x);
  const ahead = clamp(fm.vel.length() * 4, 60, 700);
  state.flybyPos.copy(fm.pos).addScaledVector(v, ahead).addScaledVector(side, 25 + state.modelSize);
  const gh = Math.max(0, state.world.height(state.flybyPos.x, state.flybyPos.z));
  state.flybyPos.y = Math.max(fm.pos.y - 5, gh + 3);
  state.flybyT = 0;
}

function restart() {
  $('result').classList.add('hidden');
  const m = beginMission();
  spawnAircraft(state.spec.id, m?.startInAir ? 'air' : 'runway');
  m?.start();
  toast('Vuelo reiniciado');
}

function toMenu() {
  state.mission?.dispose(); state.mission = null;
  combat.reset();
  tacHud.clear();
  state.mode = 'menu';
  $('hud').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('result').classList.add('hidden');
  $('menu').classList.remove('hidden');
  audio.stopEngine();
  buildMenu(); showPreview();
}

function togglePause(p = !state.paused) {
  if (state.mode !== 'flying') return;
  state.paused = p;
  $('pause').classList.toggle('hidden', !p);
}
$('btn-resume').onclick = () => togglePause(false);
$('btn-restart').onclick = () => { togglePause(false); restart(); };
$('btn-mainmenu').onclick = () => toMenu();
$('btn-settings2').addEventListener('click', () => togglePause(false));
$('btn-newdest').onclick = () => { togglePause(false); newDestinationHere(); };
$('btn-menu').onclick = () => togglePause();
$('btn-cam').onclick = () => dispatchKey('KeyC');
$('btn-sound').onclick = () => { audio.setMuted(!audio.muted); $('btn-sound').textContent = audio.muted ? '🔇' : '🔊'; };

// ---------------- Entrada ----------------
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.code;
  // Ctrl es «reducir potencia»: evita los atajos del navegador (Ctrl+S, Ctrl+D…) mientras se vuela
  if (state.mode === 'flying' && e.ctrlKey) e.preventDefault();
  if (state.mode !== 'flying') { if (k === 'Enter') { audio.init(); startFlight(); } return; }
  if (['Space', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Tab'].includes(k)) e.preventDefault();
  if (e.repeat) { keys.add(k); return; }
  keys.add(k);
  const fm = state.fm, spec = state.spec;
  switch (k) {
    case 'Escape': togglePause(); break;
    case 'KeyG':
      if (!spec.gearFixed && !(spec.type === 'heli' && !spec.gearRetract)) {
        if (fm.onGround && fm.gearDown) { toast('No puedes subir el tren en tierra', 'bad'); break; }
        fm.gearDown = !fm.gearDown; audio.gearMotor(); toast(fm.gearDown ? 'Tren abajo' : 'Tren arriba');
      }
      break;
    case 'KeyX':
      if (spec.flaps) { fm.flaps = fm.flaps >= 1 ? 0 : fm.flaps + 0.5; audio.click(); toast(`Flaps ${Math.round(fm.flaps * 100)}%`); }
      break;
    case 'KeyP': fm.brakes = !fm.brakes; audio.click(); toast(fm.brakes ? 'Freno de estacionamiento puesto' : 'Freno de estacionamiento quitado'); break;
    case 'KeyL': state.lights = !state.lights; audio.click(); toast(state.lights ? 'Luces encendidas' : 'Luces apagadas'); break;
    case 'KeyC': setCamera({ cockpit: 'chase', chase: 'flyby', flyby: 'cockpit' }[state.cam]); break;
    case 'KeyV': state.headYawT = 0; state.headPitchT = defPitch(); state.lean = 0; state.orbitYaw = 0; state.orbitPitch = 0.15; break;
    case 'KeyT': openWin('win-weather'); break;
    case 'KeyO': openWin('win-settings'); break;
    case 'KeyH': openWin('win-help'); break;
    case 'KeyM': $('btn-sound').click(); break;
    case 'KeyN': newDestinationHere(); break;
    case 'Enter': if (fm.crashed) restart(); break;
    case 'Numpad4': state.headYawT = 90 * DEG; state.headPitchT = 0; break;
    case 'Numpad6': state.headYawT = -90 * DEG; state.headPitchT = 0; break;
    case 'Numpad8': state.headPitchT = 40 * DEG; break;
    case 'Numpad2': state.headYawT = (state.headYawT >= 0 ? 1 : -1) * spec.head.yaw * DEG; break;
    case 'Numpad5': state.headYawT = 0; state.headPitchT = defPitch(); break;
    case 'Numpad7': state.headYawT = 45 * DEG; state.headPitchT = -20 * DEG; break;
    case 'Numpad9': state.headYawT = -45 * DEG; state.headPitchT = -20 * DEG; break;
    case 'Numpad1': state.headYawT = 60 * DEG; state.headPitchT = -45 * DEG; break;
    case 'Numpad3': state.headYawT = -60 * DEG; state.headPitchT = -45 * DEG; break;
  }
  const digits = { Digit1: 0.1, Digit2: 0.2, Digit3: 0.3, Digit4: 0.4, Digit5: 0.5, Digit6: 0.6, Digit7: 0.7, Digit8: 0.8, Digit9: 0.9, Digit0: 1 };
  if (k in digits) fm.throttle = digits[k];
});
addEventListener('keyup', (e) => keys.delete(e.code));
// Ctrl+W no se puede interceptar: con la tecla W de cabeceo cerraría la pestaña en pleno vuelo
addEventListener('beforeunload', (e) => { if (state.mode === 'flying') { e.preventDefault(); e.returnValue = ''; } });
addEventListener('blur', () => keys.clear());

let drag = null;
const mouse = { x: 0, y: 0, l: false, r: false };
addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('pointerup', () => { mouse.l = mouse.r = false; });
canvas.addEventListener('pointerdown', (e) => {
  if (settings.mouseFly && state.mode === 'flying') { if (e.button === 0) mouse.l = true; if (e.button === 2) mouse.r = true; return; }
  drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || state.mode !== 'flying') return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  const s = 0.005 * settings.mouse;
  if (state.cam === 'cockpit') {
    state.headYawT -= dx * s; state.headPitchT -= dy * s;
    state.headYaw = state.headYawT; state.headPitch = state.headPitchT;
  } else {
    state.orbitYaw -= dx * s; state.orbitPitch = clamp(state.orbitPitch + dy * s, -1.2, 1.4);
  }
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('dblclick', () => { state.headYawT = 0; state.headPitchT = defPitch(); state.orbitYaw = 0; state.orbitPitch = 0.15; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // en cabina la rueda acerca la cabeza a los instrumentos: el exterior no se estrecha
  if (state.cam === 'cockpit') state.lean = clamp(state.lean + (e.deltaY > 0 ? -0.2 : 0.2), 0, 1);
  else state.orbitDist = clamp(state.orbitDist * (e.deltaY > 0 ? 1.1 : 0.9), 0.4, 6);
}, { passive: false });

function readInput(dt) {
  const inp = state.input, fm = state.fm, spec = state.spec;
  const k = (...c) => c.some(x => keys.has(x)) ? 1 : 0;
  let tp = k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
  if (settings.invert) tp = -tp;
  const tr = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  const ty = k('KeyE') - k('KeyQ');
  // el helicóptero responde casi al instante; el avión conserva algo de rampa
  const heli = spec.type === 'heli';
  const ease = (cur, t) => {
    const rate = t === 0 ? (heli ? 9 : 5) : (Math.sign(t) !== Math.sign(cur) && cur !== 0 ? (heli ? 12 : 7) : (heli ? 8 : 2.8));
    return cur + clamp(t - cur, -rate * dt, rate * dt);
  };
  inp.pitch = ease(inp.pitch, tp); inp.roll = ease(inp.roll, tr); inp.yaw = ease(inp.yaw, ty);
  if (settings.mouseFly && !tp && !tr) {
    // el cursor hace de palanca: zona muerta central y respuesta progresiva
    const curve = (v) => { const a = Math.max(0, Math.abs(v) - 0.05) / 0.95; return Math.sign(v) * a * a; };
    inp.pitch = curve(mouse.y) * 1.4 * (settings.invert ? -1 : 1); inp.roll = curve(mouse.x) * 1.4;
    inp.pitch = clamp(inp.pitch, -1, 1); inp.roll = clamp(inp.roll, -1, 1);
  }
  inp.gun = !!k('Space') || mouse.l; inp.rocket = !!k('KeyZ') || mouse.r;
  inp.brake = !!k('KeyB'); inp.speedbrake = inp.brake;
  inp.assist = settings.assist;
  const thrUp = k('KeyR', 'PageUp', 'ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd');
  const thrDn = k('KeyF', 'PageDown', 'ControlLeft', 'ControlRight', 'Minus', 'NumpadSubtract');
  const tRate = spec.type === 'heli' ? 0.7 : 0.5;
  fm.throttle = clamp(fm.throttle + (thrUp - thrDn) * tRate * dt, 0, 1);
  // mando
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const dz = (v) => Math.abs(v) < 0.12 ? 0 : v;
    const ax = gp.axes;
    if (Math.abs(dz(ax[0])) || Math.abs(dz(ax[1]))) { inp.roll = dz(ax[0]); inp.pitch = (settings.invert ? -1 : 1) * dz(ax[1]); }
    if (Math.abs(dz(ax[2] || 0))) inp.yaw = dz(ax[2]);
    const lt = gp.buttons[6]?.value || 0, rt = gp.buttons[7]?.value || 0;
    fm.throttle = clamp(fm.throttle + (rt - lt) * tRate * dt * 1.5, 0, 1);
    state.padPrev = state.padPrev || {};
    const edge = (i, fn) => { const p = !!gp.buttons[i]?.pressed; if (p && !state.padPrev[i]) fn(); state.padPrev[i] = p; };
    edge(0, () => dispatchKey('KeyG')); edge(3, () => dispatchKey('KeyC')); edge(2, () => dispatchKey('KeyX')); edge(9, () => dispatchKey('Escape'));
    if (gp.buttons[1]?.pressed) inp.brake = inp.speedbrake = true;
    if (gp.buttons[5]?.pressed) inp.gun = true;
    if (gp.buttons[4]?.pressed) inp.rocket = true;
  }
}
function dispatchKey(code) { dispatchEvent(new KeyboardEvent('keydown', { code })); setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code })), 50); }

// ---------------- Efectos de vuelo ----------------
const _ev = new THREE.Vector3(), _eb = new THREE.Vector3();
let exhaustAcc = 0;
function updateEffects(dt) {
  const fm = state.fm, spec = state.spec;
  if (!fm) { particles.update(dt); return; }
  if (!fm.crashed) {
    // chorro de postcombustión y de los reactores: partículas brillantes que alimentan el bloom
    const ex = state.model.parts.exhaust;
    if (ex.length && fm.rpm > 0.35) {
      const ab = fm.ab ? (fm.rpm - 0.85) / 0.15 : 0;
      exhaustAcc += dt * (ab > 0 ? 170 : spec.engine === 'jet' ? 40 * fm.rpm : 0);
      _eb.set(0, 0, 1).applyQuaternion(fm.quat);
      while (exhaustAcc >= 1) {
        exhaustAcc -= 1;
        const p = ex[Math.floor(Math.random() * ex.length)];
        // reparto a lo largo del recorrido del fotograma: estela continua aunque bajen los FPS
        _ev.copy(p).applyQuaternion(fm.quat).add(fm.pos).addScaledVector(fm.vel, -Math.random() * dt);
        const sp = 30 + Math.random() * 45;
        if (ab > 0) particles.glow(_ev.x, _ev.y, _ev.z, fm.vel.x + _eb.x * sp, fm.vel.y + _eb.y * sp, fm.vel.z + _eb.z * sp, 7, 3.1, 1.3, 1.5 + ab * 1.6, 0.2 + Math.random() * 0.22, 1);
        else particles.glow(_ev.x, _ev.y, _ev.z, fm.vel.x + _eb.x * sp, fm.vel.y + _eb.y * sp, fm.vel.z + _eb.z * sp, 1.1, 0.7, 0.45, 0.7, 0.12, 1);
      }
    }
    // humo de avería
    const pl = state.mission?.combat?.player;
    if (pl && pl.hp < pl.maxHp * 0.4 && Math.random() < dt * 22) particles.puff(fm.pos.x, fm.pos.y, fm.pos.z, fm.vel.x * 0.2, fm.vel.y * 0.2 + 1, fm.vel.z * 0.2, 0.9 + Math.random(), 2.2, 0.12);
  } else if (Math.random() < dt * 7) {
    particles.puff(fm.pos.x + (Math.random() - 0.5) * 3, fm.pos.y + 1, fm.pos.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 7 + Math.random() * 3, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, 5, 0.1);
  }
  particles.update(dt);
}

// ---------------- Instrumentos: estado común ----------------
const inst = {};
const navTarget = () => state.mission?.nav() || state.dest;
function computeInstState() {
  const fm = state.fm, spec = state.spec, e = fm.euler;
  const kt = 1.94384, ft = 3.28084;
  const hdg = ((-e.y * RAD) % 360 + 360) % 360;
  const nav = navTarget();
  const dx = nav.x - fm.pos.x, dz = nav.z - fm.pos.z;
  inst.ias = fm.ias * kt;
  inst.alt = fm.pos.y * ft;
  inst.vs = fm.vel.y * ft * 60;
  inst.hdg = hdg; inst.pitch = e.x * RAD; inst.roll = -e.z * RAD;
  inst.rpm = fm.rpm; inst.throttle = fm.throttle; inst.gear = fm.gear; inst.gearDown = fm.gear > 0.99; inst.flaps = fm.flaps;
  inst.fuel = fm.fuel; inst.fuelFrac = fm.infiniteFuel ? 0.8 : fm.fuel / spec.fuelL; inst.lowFuel = !fm.infiniteFuel && inst.fuelFrac < 0.1;
  inst.g = fm.g; inst.slip = -fm.beta * 3; inst.turnRate = -fm.omega.y * RAD;
  inst.destBrg = ((Math.atan2(dx, -dz) * RAD) + 360) % 360;
  inst.destDist = Math.hypot(dx, dz) / 1000;
  inst.destName = nav.icao;
  inst.gs = Math.hypot(fm.vel.x, fm.vel.z) * kt;
  inst.windDir = ((Math.atan2(-env.wind.x, env.wind.z) * RAD) + 360) % 360;
  inst.windKt = Math.hypot(env.wind.x, env.wind.z) * kt;
  inst.aoa = fm.aoa * RAD; inst.beta = fm.beta * RAD; inst.mach = fm.vel.length() / 340;
  inst.onGround = fm.onGround; inst.stall = fm.stall; inst.ab = fm.ab; inst.brakes = fm.brakes;
  inst.vsKt = (spec.vs || 20) * kt; inst.vmaxKt = spec.vmax * kt;
  const pl = state.mission?.combat ? combat.player : null;
  inst.armed = !!pl && !!spec.arms;
  inst.ammo = pl?.ammo ?? 0; inst.rockets = pl?.rockets ?? 0; inst.hp = pl ? pl.hp / pl.maxHp : 1;
  inst.heli = spec.type === 'heli';
  inst.agl = Math.max(0, fm.pos.y - spec.gearH - Math.max(0, state.world.groundHeight(fm.pos.x, fm.pos.z))) * ft;
  const sy = Math.sin(e.y), cy = Math.cos(e.y);
  inst.velF = (-fm.vel.x * sy - fm.vel.z * cy) * kt;
  inst.velR = (fm.vel.x * cy - fm.vel.z * sy) * kt;
  inst.warn = state.warn;
  inst.pos = fm.pos;
  return inst;
}

// ---------------- Avisos y misión ----------------
// No hay HUD exterior: los datos de vuelo están en el HUD y las pantallas de
// la cabina. Aquí solo quedan los avisos y la ficha de misión.
const warnEl = $('warn');
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.05;
  const fm = state.fm, spec = state.spec;
  const agl = inst.agl / 3.28084;
  let warn = '';
  if (fm.crashed) warn = '';
  else if (fm.stall) warn = 'PÉRDIDA';
  else if (!fm.onGround && agl < 150 && fm.vel.y < -8 && spec.type !== 'heli') warn = 'PULL UP';
  else if (!fm.onGround && !spec.gearFixed && spec.type !== 'heli' && fm.gear < 0.99 && agl < 120 && fm.throttle < 0.4) warn = 'TREN';
  else if (inst.lowFuel) warn = 'COMBUSTIBLE';
  warnEl.textContent = warn;
  state.warn = warn;
  if (state.mission) {
    let html = state.mission.panel();
    const pl = combat.player;
    if (state.mission.combat && pl) html += ` · Blindaje ${Math.round(pl.hp / pl.maxHp * 100)} % · Cañón ${pl.ammo} · Cohetes ${pl.rockets} · ${combat.score} pts`;
    $('hud-mission').innerHTML = html;
  }
  const nm = state.navMap;
  const nav = navTarget();
  nm.dest = nav ? { x: nav.x, z: nav.z, icao: nav.icao } : null;
  nm.contacts = state.mission?.combat ? () => combat.alive.map(e => ({ x: e.pos.x, z: e.pos.z, air: e.air })) : () => [];
}

// ---------------- Cámara ----------------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion();
function updateCamera(dt) {
  const fm = state.fm, spec = state.spec, model = state.model.group;
  if (state.cam === 'cockpit') {
    const lim = spec.head;
    state.headYawT = clamp(state.headYawT, -lim.yaw * DEG, lim.yaw * DEG);
    state.headPitchT = clamp(state.headPitchT, -lim.down * DEG, lim.up * DEG);
    state.headYaw = lerp(state.headYaw, state.headYawT, 1 - Math.exp(-dt * 10));
    state.headPitch = lerp(state.headPitch, state.headPitchT, 1 - Math.exp(-dt * 10));
    camera.rotation.set(state.headPitch, state.headYaw, 0, 'YXZ');
    // desplazamiento de cabeza al mirar atrás (asomarse) + efecto G + vibración
    const lean = Math.abs(state.headYaw) / Math.PI;
    const t = performance.now() / 1000;
    const vib = (fm.onGround ? Math.min(1, Math.hypot(fm.vel.x, fm.vel.z) / 40) * 0.006 : 0) + fm.rpm * (spec.type === 'heli' ? 0.0025 : 0.0008) + (env.w.turb || 0) * 0.002;
    camera.position.set(
      Math.sign(state.headYaw) * lean * 0.12 + Math.sin(t * 37) * vib,
      clamp(-(fm.g - 1) * 0.012, -0.06, 0.03) + Math.sin(t * 41) * vib,
      lean * 0.08,
    );
    // inclinarse hacia donde se mira (zoom de cabina): agranda HUD y pantallas
    // sin cambiar el campo de visión, así el exterior sigue viéndose entero
    state.leanS = lerp(state.leanS, state.lean, 1 - Math.exp(-dt * 8));
    const cp = Math.cos(state.headPitch), fz = -Math.cos(state.headYaw) * cp;
    const L = state.leanS * (spec.type === 'heli' ? 0.3 : 0.36) * (fz < 0 ? 1 : 0.3);
    camera.position.x += -Math.sin(state.headYaw) * cp * L;
    camera.position.y += Math.sin(state.headPitch) * L;
    camera.position.z += fz * L;
    camera.fov = settings.fov;
  } else if (state.cam === 'chase') {
    const yaw = fm.euler.y;
    let d = yaw - state.chaseYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    state.chaseYaw += d * (1 - Math.exp(-dt * 2.5));
    const dist = (state.modelSize * 1.15 + 6) * state.orbitDist;
    const a = state.chaseYaw + state.orbitYaw;
    const p = state.orbitPitch;
    _v1.set(Math.sin(a) * Math.cos(p) * dist, Math.sin(p) * dist + state.modelSize * 0.08, Math.cos(a) * Math.cos(p) * dist);
    camera.position.copy(model.position).add(_v1);
    const gh = Math.max(0, state.world.groundHeight(camera.position.x, camera.position.z)) + 1.2;
    if (camera.position.y < gh) camera.position.y = gh;
    camera.up.set(0, 1, 0);
    camera.lookAt(_v2.copy(model.position).add(_v1.set(0, state.modelSize * 0.06, 0)));
    camera.fov = settings.fov;
  } else {
    state.flybyT += dt;
    camera.position.copy(state.flybyPos);
    camera.lookAt(model.position);
    const d = camera.position.distanceTo(model.position);
    camera.fov = clamp(2 * Math.atan(state.modelSize * 2.5 / Math.max(d, 1)) * RAD, 8, settings.fov);
    if ((d > 900 && state.flybyT > 3) || state.flybyT > 25) placeFlyby();
  }
  camera.updateProjectionMatrix();
}

// ---------------- Animación del modelo ----------------
const _sw = new THREE.Euler(), _sq = new THREE.Quaternion();
function animateModel(dt) {
  const fm = state.fm, p = state.model.parts, inp = state.input;
  const g = state.model.group;
  g.position.copy(fm.pos);
  g.quaternion.copy(fm.quat);
  if (state.spec.type === 'heli' && !fm.crashed && !fm.onGround) {
    // balanceo dinámico: el fuselaje oscila bajo el rotor en estacionario y se retrasa al mandar cíclico
    const t = performance.now() / 1000, hov = 1 - clamp(fm.vel.length() / 25, 0, 1);
    _sw.set(Math.sin(t * 1.3) * 0.012 * hov - inp.pitch * 0.035, 0, Math.sin(t * 1.7 + 1) * 0.016 * hov + inp.roll * 0.04);
    g.quaternion.multiply(_sq.setFromEuler(_sw));
  }
  const rpm = fm.crashed ? 0 : fm.rpm;
  for (const pr of p.props) pr.rotation.z += (5 + rpm * 70) * dt * (rpm > 0.01 ? 1 : 0);
  for (const r of p.rotors) r.rotation.y += (rpm * 20) * dt;
  for (const r of p.tailRotors) r.rotation.y += rpm * 60 * dt;
  for (const d of p.discs) d.material.opacity = rpm > 0.3 ? 0.12 + rpm * 0.08 : 0;
  // en cabina, con el rotor a régimen, las palas se ven como disco difuminado y no tapan la vista
  const blur = state.cam === 'cockpit' && rpm > 0.5;
  for (const r of p.rotors) r.traverse(o => { if (o.userData.blade) o.visible = !blur; });
  for (const ge of p.gear) ge.obj.rotation[ge.axis] = ge.up * (1 - fm.gear);
  const ab = fm.ab ? (fm.rpm - 0.85) / 0.15 : 0;
  for (let i = 0; i < p.ab.length; i++) {
    const f = p.ab[i];
    const core = i % 2 === 1;
    const len = ab > 0 ? (core ? 2 : 4.5) * (0.6 + ab * 0.6) * (0.9 + Math.random() * 0.2) : rpm * 0.6;
    f.scale.set(1, 1, Math.max(0.01, len));
    f.material.opacity = ab > 0 ? (core ? 0.9 : 0.7) : rpm * 0.15;
  }
  for (const s of p.surfaces) {
    let v = 0;
    if (s.input === 'pitch') v = -inp.pitch * s.max - (s.rollMix || 0) * inp.roll * 2;
    else if (s.input === 'rollR') v = -inp.roll * s.max;
    else if (s.input === 'rollL') v = inp.roll * s.max;
    else if (s.input === 'yaw') v = inp.yaw * s.max;
    s.obj.rotation[s.axis] = lerp(s.obj.rotation[s.axis], v, 1 - Math.exp(-dt * 12));
  }
  for (const sw of p.sweep) sw.obj.rotation.y = -sw.side * fm.sweep * 48 * DEG;
  // luces
  const night = env.night;
  const lightsOn = state.lights;
  for (const sp of state.navSprites) { sp.visible = lightsOn || night > 0.3; sp.material.opacity = 0.4 + night * 0.6; }
  const strobe = (performance.now() % 1200) < 70 && (lightsOn || night > 0.3);
  for (const sp of state.strobes) sp.material.opacity = strobe ? 1 : 0;
  state.landingLight.intensity = lightsOn ? 400 : 0;
  state.llGlow.material.opacity = lightsOn ? 0.9 : 0;
}

// ---------------- Bucle principal ----------------
let last = performance.now(), acc = 0, fpsT = 0, frames = 0;
const STEP = 1 / 120;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.mode === 'menu') {
    if (menuModel) {
      menuModel.group.rotation.y += dt * 0.25;
      for (const pr of menuModel.parts.props) pr.rotation.z += dt * 2;
      for (const r of menuModel.parts.rotors) r.rotation.y += dt * 0.6;
      const d = menuModel.size * 1.05 + 4;
      menuCam.position.set(-d * 0.62, d * 0.22 + 1, d * 0.62);
      menuCam.lookAt(-menuModel.size * 0.2, menuModel.gearHeight * 0.7 + 0.5, 0);
    }
    setEnvIntensity(1);
    fx.render(menuScene, menuCam);
    return;
  }
  const fm = state.fm;
  if (!state.paused) {
    readInput(dt);
    if (settings.timeflow) { env.setTime(env.hour + dt * 60 / 3600); if (Math.random() < 0.02) updateTimeLabel(); }
    acc += dt;
    const p0 = fm.pos.clone();
    while (acc >= STEP) {
      fm.step(STEP, state.input, env, state.world);
      acc -= STEP;
    }
    const mc = state.mission?.combat;
    if (mc) { mc.fire(state.input, dt); mc.update(dt, state.world); }
    state.mission?.update(dt);
    state.distFlown += fm.pos.distanceTo(p0);
    if (!fm.crashed) state.flightTime += dt;
    for (const ev of fm.events) {
      if (ev.type === 'crash') {
        particles.explosion(fm.pos, 2);
        state.mission?.onCrash(ev.reason);
        audio.explosion();
        toast(ev.reason, 'bad', 7000);
        toast('Pulsa Enter para reiniciar', 'bad', 7000);
        if (state.cam === 'cockpit') setCamera('chase');
        state.orbitDist = 2.5;
      } else if (ev.type === 'touchdown') {
        audio.touchdown(clamp(ev.impact / 3, 0.3, 1.2));
        state.mission?.onTouchdown(ev);
        state.lastTouch = ev.impact;
        const fpm = Math.round(ev.impact * 196.85);
        if (state.spec.type !== 'heli' || ev.impact > 1) toast(`Toma de contacto: ${fpm} ft/min ${fpm < 200 ? '· ¡Suave!' : fpm < 400 ? '· Correcta' : '· Dura'}`, fpm < 400 ? 'good' : '');
      }
    }
    fm.events.length = 0;
    checkArrival();
    // ayuda: baja el tren automáticamente en aproximación
    const sp = state.spec;
    const retract = sp.type === 'plane' ? !sp.gearFixed : !!sp.gearRetract;
    if (!fm.gearDown && !fm.crashed && !fm.onGround && retract && fm.vel.y < -0.5 && fm.ias < (sp.type === 'heli' ? 20 : sp.vs * 1.7)) {
      const agl = fm.pos.y - sp.gearH - Math.max(0, state.world.groundHeight(fm.pos.x, fm.pos.z));
      if (agl < (sp.type === 'heli' ? 25 : 90)) { fm.gearDown = true; audio.gearMotor(); toast('Tren bajado automáticamente'); }
    }
    if (fm.crashed) {
      const e = fm.euler;
      fm.quat.setFromEuler(new THREE.Euler(lerp(e.x, -0.1, dt), e.y, lerp(e.z, 0.5, dt), 'YXZ'));
    }
  }
  setEnvIntensity(0.25 + 0.75 * (1 - env.night));
  animateModel(dt);
  updateCamera(dt);
  const camWorld = camera.getWorldPosition(_v1);
  state.world.update(camWorld, state.paused ? 0 : dt, 6);
  state.world.updateLights(env.night, camWorld);
  state.navMap.update(fm.pos.x, fm.pos.z, 1.5);
  for (const ap of state.world.airports) if (ap.windsock) ap.windsock.rotation.y = Math.atan2(-env.wind.z, env.wind.x) + ap.hdg;
  env.update(state.paused ? 0 : dt, { position: camWorld }, fm.pos);
  computeInstState();
  if (state.cam === 'cockpit') { state.cockpit.update(dt, inst, state.input, camera.position); state.cockpit.setNight(env.night); }
  updateHUD(dt);
  updateEffects(state.paused ? 0 : dt);
  audio.update({
    rpm: fm.rpm, throttle: fm.throttle, ab: fm.ab, cockpit: state.cam === 'cockpit', camDist: camera.getWorldPosition(_v2).distanceTo(fm.pos),
    airspeed: fm.ias, rain: env.w.rain, windStrength: env.w.wind, onGround: fm.onGround, groundSpeed: Math.hypot(fm.vel.x, fm.vel.z),
    warn: !!state.warn && !state.paused, warnType: fm.stall ? 'stall' : 'gear', crashed: fm.crashed,
  });
  fx.render(scene, camera, state.cam === 'cockpit');
  const m = state.mission;
  if (m) {
    const pl = m.combat ? combat.player : null;
    // en cabina la retícula la pone el HUD del avión: aquí solo marcadores
    tacHud.draw(camera, { fm, markers: m.markers(), armed: !!pl && !!state.spec.arms && state.cam !== 'cockpit', hitFlash: pl?.hitFlash || 0, ammoEmpty: !!pl && pl.ammo <= 0 });
  } else tacHud.clear();
  // fuera de la cabina se ven el HUD del avión y el mapa móvil superpuestos
  if (state.cam !== 'cockpit' && !fm.crashed) {
    tacHud.flightHUD(dt, inst, camera);
    tacHud.mapOverlay(dt, inst, state.navMap);
  }
}

function checkArrival() {
  const fm = state.fm, d = state.dest;
  if (state.mission || state.arrived || fm.crashed || !fm.onGround) return;
  const gs = Math.hypot(fm.vel.x, fm.vel.z);
  if (gs > 3) return;
  const l = state.world.airportLocal(d, fm.pos.x, fm.pos.z);
  if (Math.abs(l.u) < d.len / 2 + 100 && l.v > -80 && l.v < 400) {
    state.arrived = true;
    audio.chime();
    const t = state.flightTime;
    const fpm = state.lastTouch != null ? Math.round(state.lastTouch * 196.85) : 0;
    const rating = fpm < 150 ? '★★★ Mantequilla' : fpm < 300 ? '★★ Muy buena' : fpm < 500 ? '★ Aceptable' : 'Dura, pero de una pieza';
    showResult({
      title: `¡Bienvenido a ${d.name}!`, big: d.icao, html: `Tiempo de vuelo: <b>${Math.floor(t / 60)} min ${Math.floor(t % 60)} s</b><br>
      Distancia recorrida: <b>${(state.distFlown / 1000).toFixed(1)} km</b><br>
      Última toma: <b>${fpm} ft/min</b> — ${rating}<br><br>
      Puedes seguir volando libremente o fijar un nuevo destino.`,
      primary: ['Seguir volando', () => $('result').classList.add('hidden')], secondary: ['Menú', () => toMenu()],
    });
    $('btn-result-new').style.display = ''; $('btn-result-new').onclick = () => newDestinationHere();
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  fx.resize(innerWidth, innerHeight);
  tacHud.resize();
  particles.setViewport(innerHeight * renderer.getPixelRatio(), camera.fov);
  camera.aspect = menuCam.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); menuCam.updateProjectionMatrix();
});

particles.setViewport(innerHeight * renderer.getPixelRatio(), camera.fov);
buildMenu();
bindSettings();
showPreview();
loop();
