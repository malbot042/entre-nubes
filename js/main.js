// Entre Nubes — bucle principal, cámaras, entrada, HUD y menús.
import * as THREE from 'three';
import { AIRCRAFT, AIRCRAFT_BY_ID, CATEGORIES } from './aircraft.js';
import { buildModel } from './models.js';
import { Cockpit } from './cockpit.js';
import { FlightModel } from './physics.js';
import { World, CHUNK } from './world.js';
import { Environment, WEATHER } from './environment.js';
import { AudioEngine } from './audio.js';
import { mulberry32, clamp, lerp, smoothstep, DEG, RAD } from './util.js';

// ---------------- Ajustes persistentes ----------------
const DEFAULTS = { aircraft: 'c172', time: '13', weather: 'clear', dist: 'medium', start: 'runway', quality: 'medium', shadows: true, volume: 0.7, units: 'aviation', invert: false, hud: true, hudCockpit: false, fuel: true, mouse: 1, fov: 72 };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('entrenubes2') || '{}')); } catch (_) { }
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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.5, 45000);
scene.add(camera);
const env = new Environment(scene, renderer);
const audio = new AudioEngine();
audio.setVolume(settings.volume);
env.onThunder = () => audio.thunder();
// la cabina se dibuja en una segunda pasada (capa 1) con su propio plano cercano
for (const l of [env.sun, env.hemi, env.ambient]) l.layers.enable(1);
env.sun.shadow.camera.layers.enableAll();

// Escena del hangar (menú)
const menuScene = new THREE.Scene();
const menuCam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2000);
{
  const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#3a6fa8'); gr.addColorStop(0.55, '#a9c9e4'); gr.addColorStop(0.62, '#e8d9b8'); gr.addColorStop(1, '#5d6b45');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  menuScene.background = t;
  menuScene.add(new THREE.HemisphereLight(0xcfe4ff, 0x56603e, 1.4));
  const d = new THREE.DirectionalLight(0xfff2e0, 2.6); d.position.set(30, 50, 20); d.castShadow = true;
  d.shadow.camera.left = d.shadow.camera.bottom = -25; d.shadow.camera.right = d.shadow.camera.top = 25; d.shadow.mapSize.set(2048, 2048);
  menuScene.add(d);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6f7d55 }));
  ground.receiveShadow = true; menuScene.add(ground);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(28, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8f8f88 }));
  pad.position.y = 0.02; pad.receiveShadow = true; menuScene.add(pad);
  menuScene.fog = new THREE.Fog(0xa9c9e4, 120, 420);
}
let menuModel = null;

// ---------------- Estado ----------------
const state = {
  mode: 'menu', // menu | flying
  paused: false,
  cam: 'cockpit',
  world: null, fm: null, model: null, cockpit: null, spec: null,
  origin: null, dest: null,
  headYaw: 0, headPitch: 0, headYawT: 0, headPitchT: 0, zoom: 1,
  orbitYaw: 0, orbitPitch: 0.18, orbitDist: 1, chaseYaw: 0,
  flybyPos: new THREE.Vector3(), flybyT: 0,
  lights: false, arrived: false, flightTime: 0, distFlown: 0, lastTouch: null,
  seed: 1, input: { pitch: 0, roll: 0, yaw: 0, brake: false, speedbrake: false },
  gearWarned: false,
};
const eyePivot = new THREE.Group();
window.__entreNubes = { state, scene, camera, env };
const keys = new Set();
const defPitch = () => (state.spec?.type === 'heli' ? -14 : state.spec?.cat === 'fighter' ? -6 : -10) * DEG;

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
let currentCat = AIRCRAFT_BY_ID[settings.aircraft]?.cat || 'light';
function buildMenu() {
  const tabs = $('cat-tabs'); tabs.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button'); b.textContent = c.name; b.className = c.id === currentCat ? 'active' : '';
    b.onclick = () => { currentCat = c.id; buildMenu(); };
    tabs.appendChild(b);
  }
  const list = $('aircraft-list'); list.innerHTML = '';
  for (const a of AIRCRAFT.filter(a => a.cat === currentCat)) {
    const d = document.createElement('div'); d.className = 'card' + (a.id === settings.aircraft ? ' active' : '');
    const kmh = Math.round(a.vmax * 3.6);
    d.innerHTML = `<div class="n">${a.name}</div><div class="s">${kmh} km/h · ${(a.mass / 1000).toFixed(1)} t</div>`;
    d.onclick = () => { settings.aircraft = a.id; save(); buildMenu(); showPreview(); };
    list.appendChild(d);
  }
  const sp = AIRCRAFT_BY_ID[settings.aircraft];
  $('aircraft-desc').textContent = sp ? sp.desc : '';
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
function showPreview() {
  if (menuModel) menuScene.remove(menuModel.group);
  menuModel = buildModel(settings.aircraft);
  const g = menuModel.group;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3()).length();
  g.position.y = menuModel.gearHeight;
  menuScene.add(g);
  menuModel.size = size;
  for (const d of menuModel.parts.discs) d.material.opacity = 0;
}
$('btn-fly').addEventListener('click', () => { audio.init(); startFlight(); });

// ---------------- Ajustes UI ----------------
function bindSettings() {
  const q = $('set-quality'); q.value = settings.quality;
  q.onchange = () => { settings.quality = q.value; save(); applyPixelRatio(); if (state.world) state.world.setQuality(q.value); };
  const sh = $('set-shadows'); sh.checked = settings.shadows;
  sh.onchange = () => { settings.shadows = sh.checked; save(); renderer.shadowMap.enabled = sh.checked; env.sun.castShadow = sh.checked; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); };
  const v = $('set-volume'); v.value = settings.volume; v.oninput = () => { settings.volume = +v.value; save(); audio.setVolume(settings.volume); };
  const u = $('set-units'); u.value = settings.units; u.onchange = () => { settings.units = u.value; save(); };
  const inv = $('set-invert'); inv.checked = settings.invert; inv.onchange = () => { settings.invert = inv.checked; save(); };
  const hud = $('set-hud'); hud.checked = settings.hud; hud.onchange = () => { settings.hud = hud.checked; save(); };
  const hc = $('set-hud-cockpit'); hc.checked = settings.hudCockpit; hc.onchange = () => { settings.hudCockpit = hc.checked; save(); };
  const fu = $('set-fuel'); fu.checked = settings.fuel; fu.onchange = () => { settings.fuel = fu.checked; save(); if (state.fm) state.fm.infiniteFuel = fu.checked; };
  const ms = $('set-mouse'); ms.value = settings.mouse; ms.oninput = () => { settings.mouse = +ms.value; save(); };
  const fov = $('set-fov'); fov.value = settings.fov; fov.oninput = () => { settings.fov = +fov.value; save(); };
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
function refreshWeatherButtons() { document.querySelectorAll('#weather-buttons button').forEach(b => b.classList.toggle('active', b.dataset.k === env.weatherKey)); }
function updateTimeLabel() {
  const h = env.hour; $('set-time').value = h.toFixed(1);
  $('time-label').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}

// ---------------- Vuelo ----------------
const DIST = { short: [8000, 15000], medium: [20000, 40000], long: [60000, 120000] };

function setLoading(on, text) { $('loading').classList.toggle('hidden', !on); if (text) $('loading-text').textContent = text; }

async function startFlight(keepWorld = false) {
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
    state.origin = world.addAirport(0, 0, rnd, false);
    makeDestination(state.origin.x, state.origin.z, rnd() * Math.PI * 2, rnd);
  }
  env.setTime(parseFloat(settings.time));
  env.setWeather(settings.weather, true);
  refreshWeatherButtons(); updateTimeLabel();
  spawnAircraft(settings.aircraft, 'runway');
  setLoading(true, 'Cargando escenario…');
  await new Promise(r => setTimeout(r, 20));
  state.world.update(state.fm.pos, 0, 0, true);
  setLoading(false);
  state.mode = 'flying';
  $('hud').classList.remove('hidden');
  toast(`${state.origin.icao} ${state.origin.name}  →  ${state.dest.icao} ${state.dest.name}`, '', 5000);
  toast(state.spec.type === 'heli' ? 'Colectivo con R/F: al 50 % se mantiene en el aire' : 'Gases con R, suelta frenos con P', '', 5000);
}

function makeDestination(fromX, fromZ, bearing, rnd) {
  const [a, b] = DIST[settings.dist];
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
  if (!state.fm) return;
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
  if (state.model) { scene.remove(state.model.group); }
  if (state.effects) state.effects.forEach(e => scene.remove(e.obj));
  state.effects = [];
  const spec = AIRCRAFT_BY_ID[id];
  state.spec = spec;
  const model = buildModel(id);
  state.model = model;
  scene.add(model.group);
  model.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // cabina
  const ck = new Cockpit(spec, $('minimap'));
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
    const gh = Math.max(0, w.height(p.x, p.z));
    const alt = spec.type === 'heli' ? 180 : Math.max(700, 400 + spec.vs * 6);
    fm.pos.set(p.x, gh + alt, p.z);
    fm.quat.setFromEuler(new THREE.Euler(0, -brg, 0, 'YXZ'));
    const sp = spec.type === 'heli' ? 35 : Math.min(spec.vmax * 0.65, spec.vs * 2.4);
    fm.vel.set(Math.sin(brg) * sp, 0, -Math.cos(brg) * sp);
    fm.throttle = spec.type === 'heli' ? 1 / spec.lift + 0.04 : 0.75;
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
  state.zoom = 1;
  const box = new THREE.Box3().setFromObject(model.group);
  state.modelSize = box.getSize(new THREE.Vector3()).length();
  state.orbitDist = 1; state.orbitYaw = 0; state.orbitPitch = 0.15;
  state.chaseYaw = fm.euler.y;
  state.arrived = false; state.flightTime = 0; state.distFlown = 0; state.lastTouch = null;
  state.lights = env.night > 0.4;
  setCamera(state.cam === 'flyby' ? 'chase' : state.cam);
  audio.setAircraft(spec);
  $('lbl-thr').textContent = spec.type === 'heli' ? 'COLECT.' : 'GASES';
  $('i-gear').style.display = spec.gearFixed || (spec.type === 'heli' && !spec.gearRetract) ? 'none' : '';
  $('i-flaps').style.display = spec.flaps ? '' : 'none';
  $('i-ab').style.display = spec.ab ? '' : 'none';
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
  $('h-cam').textContent = { cockpit: 'CABINA', chase: 'EXTERIOR', flyby: 'PASADA' }[mode];
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
  spawnAircraft(state.spec.id, 'runway');
  toast('Vuelo reiniciado');
}

function toMenu() {
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
$('btn-newdest').onclick = () => { togglePause(false); newDestinationHere(); };
$('btn-menu').onclick = () => togglePause();
$('btn-continue').onclick = () => $('result').classList.add('hidden');
$('btn-result-new').onclick = () => newDestinationHere();
$('btn-result-menu').onclick = () => toMenu();
$('btn-sound').onclick = () => { audio.setMuted(!audio.muted); $('btn-sound').textContent = audio.muted ? '🔇' : '🔊'; };

// ---------------- Entrada ----------------
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.code;
  if (state.mode !== 'flying') { if (k === 'Enter') { audio.init(); startFlight(); } return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Tab'].includes(k)) e.preventDefault();
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
    case 'KeyV': state.headYawT = 0; state.headPitchT = defPitch(); state.zoom = 1; state.orbitYaw = 0; state.orbitPitch = 0.15; break;
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
addEventListener('blur', () => keys.clear());

let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || state.mode !== 'flying') return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  const s = 0.005 * settings.mouse / state.zoom;
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
  if (state.cam === 'cockpit') state.zoom = clamp(state.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 1, 3.5);
  else state.orbitDist = clamp(state.orbitDist * (e.deltaY > 0 ? 1.1 : 0.9), 0.4, 6);
}, { passive: false });

function readInput(dt) {
  const inp = state.input, fm = state.fm, spec = state.spec;
  const k = (...c) => c.some(x => keys.has(x)) ? 1 : 0;
  let tp = k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
  if (settings.invert) tp = -tp;
  const tr = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  const ty = k('KeyE') - k('KeyQ');
  const ease = (cur, t) => {
    const rate = t === 0 ? 5 : (Math.sign(t) !== Math.sign(cur) && cur !== 0 ? 7 : 2.8);
    return cur + clamp(t - cur, -rate * dt, rate * dt);
  };
  inp.pitch = ease(inp.pitch, tp); inp.roll = ease(inp.roll, tr); inp.yaw = ease(inp.yaw, ty);
  inp.brake = !!k('KeyB'); inp.speedbrake = inp.brake;
  const thrUp = k('KeyR', 'PageUp', 'ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd');
  const thrDn = k('KeyF', 'PageDown', 'Minus', 'NumpadSubtract');
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
  }
}
function dispatchKey(code) { dispatchEvent(new KeyboardEvent('keydown', { code })); setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code })), 50); }

// ---------------- Efectos (explosión, humo) ----------------
const smokeTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
function spawnExplosion(pos) {
  for (let i = 0; i < 40; i++) {
    const fire = i < 16;
    const m = new THREE.SpriteMaterial({ map: smokeTex, color: fire ? 0xffa040 : 0x333333, transparent: true, depthWrite: false, blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(m);
    s.position.copy(pos);
    scene.add(s);
    state.effects.push({
      obj: s, life: fire ? 1.5 + Math.random() : 6 + Math.random() * 6, age: 0, fire,
      vel: new THREE.Vector3((Math.random() - 0.5) * (fire ? 20 : 6), Math.random() * (fire ? 18 : 8) + 2, (Math.random() - 0.5) * (fire ? 20 : 6)),
      size: fire ? 6 + Math.random() * 6 : 6 + Math.random() * 8,
    });
  }
}
function updateEffects(dt) {
  if (!state.effects) return;
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];
    e.age += dt;
    e.obj.position.addScaledVector(e.vel, dt);
    e.vel.multiplyScalar(Math.exp(-dt * (e.fire ? 1.5 : 0.3)));
    if (!e.fire) e.vel.y += dt * 1.5;
    const t = e.age / e.life;
    e.obj.scale.setScalar(e.size * (1 + t * (e.fire ? 1.5 : 4)));
    e.obj.material.opacity = (1 - t) * (e.fire ? 1 : 0.7);
    if (t >= 1) { scene.remove(e.obj); e.obj.material.dispose(); state.effects.splice(i, 1); }
  }
  // humo continuo tras accidente
  if (state.fm && state.fm.crashed && Math.random() < dt * 6 && state.effects.length < 120) {
    const m = new THREE.SpriteMaterial({ map: smokeTex, color: 0x2a2a2a, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m); s.position.copy(state.fm.pos); scene.add(s);
    state.effects.push({ obj: s, life: 10, age: 0, fire: false, vel: new THREE.Vector3((Math.random() - 0.5) * 2, 6 + Math.random() * 3, (Math.random() - 0.5) * 2), size: 5 });
  }
}

// ---------------- Instrumentos: estado común ----------------
const inst = {};
function computeInstState() {
  const fm = state.fm, spec = state.spec, e = fm.euler;
  const kt = 1.94384, ft = 3.28084;
  const hdg = ((-e.y * RAD) % 360 + 360) % 360;
  const dx = state.dest.x - fm.pos.x, dz = state.dest.z - fm.pos.z;
  inst.ias = fm.ias * kt;
  inst.alt = fm.pos.y * ft;
  inst.vs = fm.vel.y * ft * 60;
  inst.hdg = hdg; inst.pitch = e.x * RAD; inst.roll = -e.z * RAD;
  inst.rpm = fm.rpm; inst.throttle = fm.throttle; inst.gear = fm.gear; inst.gearDown = fm.gear > 0.99; inst.flaps = fm.flaps;
  inst.fuel = fm.fuel; inst.fuelFrac = fm.infiniteFuel ? 0.8 : fm.fuel / spec.fuelL; inst.lowFuel = !fm.infiniteFuel && inst.fuelFrac < 0.1;
  inst.g = fm.g; inst.slip = -fm.beta * 3; inst.turnRate = -fm.omega.y * RAD;
  inst.destBrg = ((Math.atan2(dx, -dz) * RAD) + 360) % 360;
  inst.destDist = Math.hypot(dx, dz) / 1000;
  inst.destName = state.dest.icao;
  inst.gs = Math.hypot(fm.vel.x, fm.vel.z) * kt;
  inst.windDir = ((Math.atan2(-env.wind.x, env.wind.z) * RAD) + 360) % 360;
  inst.windKt = Math.hypot(env.wind.x, env.wind.z) * kt;
  inst.aoa = fm.aoa * RAD; inst.beta = fm.beta * RAD; inst.mach = fm.vel.length() / 340;
  inst.onGround = fm.onGround; inst.stall = fm.stall; inst.ab = fm.ab; inst.brakes = fm.brakes;
  inst.vsKt = (spec.vs || 20) * kt; inst.vmaxKt = spec.vmax * kt;
  return inst;
}

// ---------------- HUD ----------------
const hud = {
  spd: $('h-spd'), alt: $('h-alt'), vs: $('h-vs'), agl: $('h-agl'), g: $('h-g'), dest: $('h-dest'), dist: $('h-dist'), brg: $('h-brg'), eta: $('h-eta'),
  thr: $('h-thr'), rpm: $('h-rpm'), thrv: $('h-thr-v'), flaps: $('h-flaps'), arrow: $('h-arrow'), warn: $('warn'),
  compass: $('compass-canvas').getContext('2d'), mini: $('minimap').getContext('2d'),
};
let hudT = 0, miniT = 0;
function updateHUD(dt) {
  hudT -= dt; miniT -= dt;
  const show = settings.hud && !(settings.hudCockpit && state.cam === 'cockpit');
  $('hud-left').style.display = $('hud-right').style.display = $('compass').style.display = show ? '' : 'none';
  if (hudT > 0) return;
  hudT = 0.05;
  const s = inst, fm = state.fm, met = settings.units === 'metric';
  hud.spd.textContent = Math.round(met ? fm.ias * 3.6 : s.ias);
  hud.alt.textContent = Math.round(met ? fm.pos.y : s.alt);
  hud.vs.textContent = Math.round(met ? fm.vel.y : s.vs / 10) * (met ? 1 : 10);
  const agl = fm.pos.y - state.spec.gearH - Math.max(0, state.world.groundHeight(fm.pos.x, fm.pos.z));
  hud.agl.textContent = Math.max(0, Math.round(met ? agl : agl * 3.28084));
  hud.g.textContent = s.g.toFixed(1);
  $('u-spd').textContent = met ? 'km/h' : 'kt'; $('u-alt').textContent = met ? 'm' : 'ft'; $('u-vs').textContent = met ? 'm/s' : 'fpm'; $('u-agl').textContent = met ? 'm' : 'ft';
  hud.dest.textContent = `${state.dest.icao} · ${state.dest.name}`;
  hud.dist.textContent = s.destDist.toFixed(1);
  hud.brg.textContent = String(Math.round(s.destBrg)).padStart(3, '0');
  const gsms = Math.hypot(fm.vel.x, fm.vel.z);
  if (gsms > 5) { const t = s.destDist * 1000 / gsms; hud.eta.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; } else hud.eta.textContent = '--:--';
  hud.arrow.style.transform = `rotate(${s.destBrg - s.hdg - 90}deg)`;
  hud.thr.style.width = `${fm.throttle * 100}%`;
  hud.rpm.style.left = `${fm.rpm * 100}%`;
  hud.thrv.textContent = `${Math.round(fm.throttle * 100)}%`;
  hud.flaps.textContent = `${Math.round(fm.flaps * 100)}%`;
  const setInd = (id, on, cls = 'on') => { const el = $(id); el.classList.remove('on', 'transit', 'hot'); if (on) el.classList.add(cls); };
  setInd('i-gear', fm.gear > 0.01, fm.gear > 0.99 ? 'on' : 'transit');
  setInd('i-flaps', fm.flaps > 0, 'transit');
  setInd('i-brake', fm.brakes || state.input.brake, 'transit');
  setInd('i-ab', fm.ab, 'hot');
  setInd('i-lights', state.lights);
  // avisos
  let warn = '';
  const spec = state.spec;
  if (fm.crashed) warn = '';
  else if (fm.stall) warn = 'PÉRDIDA';
  else if (!fm.onGround && agl < 150 && fm.vel.y < -8 && spec.type !== 'heli') warn = 'PULL UP';
  else if (!fm.onGround && !spec.gearFixed && spec.type !== 'heli' && fm.gear < 0.99 && agl < 120 && fm.throttle < 0.4) warn = 'TREN';
  else if (inst.lowFuel) warn = 'COMBUSTIBLE';
  hud.warn.textContent = warn;
  state.warn = warn;
  drawCompass(s.hdg, s.destBrg);
  if (miniT <= 0) { miniT = 0.5; drawMinimap(); }
}

function drawCompass(hdg, dest) {
  const g = hud.compass, W = 520, H = 44;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(12,18,26,0.55)'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(230,240,248,0.85)'; g.fillStyle = '#e6f0f8'; g.textAlign = 'center'; g.font = '600 15px Rajdhani, sans-serif';
  const ppd = W / 90;
  for (let a = Math.floor(hdg - 50); a <= hdg + 50; a++) {
    if (a % 5) continue;
    const x = W / 2 + (a - hdg) * ppd;
    const n = ((a % 360) + 360) % 360;
    g.lineWidth = n % 10 === 0 ? 2 : 1;
    g.beginPath(); g.moveTo(x, H); g.lineTo(x, H - (n % 10 === 0 ? 12 : 6)); g.stroke();
    if (n % 30 === 0) g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'O' }[n] ?? String(n / 10), x, 18);
  }
  const rel = ((dest - hdg + 540) % 360) - 180;
  const dx = W / 2 + clamp(rel, -44, 44) * ppd;
  g.fillStyle = '#ffb648'; g.beginPath(); g.moveTo(dx, H - 14); g.lineTo(dx - 6, H - 24); g.lineTo(dx + 6, H - 24); g.fill();
  g.fillStyle = '#5fd3ff'; g.fillRect(W / 2 - 1, 22, 2, 22);
  g.font = '600 13px "Share Tech Mono", monospace'; g.fillStyle = '#5fd3ff';
  g.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), W / 2, 36 - 22 + 22 - 2 > 0 ? 34 : 34);
}

function drawMinimap() {
  const g = hud.mini, W = 200, R = 10000;
  const fm = state.fm, w = state.world;
  const N = 40, cs = W / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = fm.pos.x + ((i + 0.5) / N - 0.5) * 2 * R;
    const z = fm.pos.z + ((j + 0.5) / N - 0.5) * 2 * R;
    const c = w.surfaceInfo(x, z);
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    g.fillRect(i * cs, j * cs, cs + 1, cs + 1);
  }
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 0, W, W);
  const toMap = (x, z) => [W / 2 + (x - fm.pos.x) / R * W / 2, W / 2 + (z - fm.pos.z) / R * W / 2];
  for (const ap of w.airports) {
    const [mx, my] = toMap(ap.x, ap.z);
    const inside = mx > 0 && mx < W && my > 0 && my < W;
    g.strokeStyle = ap === state.dest ? '#ffb648' : '#ffffff'; g.lineWidth = 3;
    if (inside) {
      g.beginPath(); g.moveTo(mx - ap.dir.x * 10, my - ap.dir.z * 10); g.lineTo(mx + ap.dir.x * 10, my + ap.dir.z * 10); g.stroke();
    }
    if (ap === state.dest) {
      const ang = Math.atan2(my - W / 2, mx - W / 2);
      const r = Math.min(Math.hypot(mx - W / 2, my - W / 2), W / 2 - 8);
      g.fillStyle = '#ffb648';
      g.beginPath(); g.arc(W / 2 + Math.cos(ang) * r, W / 2 + Math.sin(ang) * r, 5, 0, Math.PI * 2); g.fill();
      g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,182,72,0.7)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(W / 2 + Math.cos(ang) * r, W / 2 + Math.sin(ang) * r); g.stroke(); g.setLineDash([]);
    }
  }
  const h = -fm.euler.y;
  g.save(); g.translate(W / 2, W / 2); g.rotate(h);
  g.fillStyle = '#5fd3ff'; g.strokeStyle = '#000'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.fillStyle = '#fff'; g.font = 'bold 12px Rajdhani, sans-serif'; g.textAlign = 'center'; g.fillText('N', W / 2, 14);
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
    camera.fov = settings.fov / state.zoom;
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
function animateModel(dt) {
  const fm = state.fm, p = state.model.parts, inp = state.input;
  const g = state.model.group;
  g.position.copy(fm.pos);
  g.quaternion.copy(fm.quat);
  const rpm = fm.crashed ? 0 : fm.rpm;
  for (const pr of p.props) pr.rotation.z += (5 + rpm * 70) * dt * (rpm > 0.01 ? 1 : 0);
  for (const r of p.rotors) r.rotation.y += (rpm * 20) * dt;
  for (const r of p.tailRotors) r.rotation.y += rpm * 60 * dt;
  for (const d of p.discs) d.material.opacity = rpm > 0.3 ? 0.12 + rpm * 0.08 : 0;
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
    renderer.render(menuScene, menuCam);
    return;
  }
  const fm = state.fm;
  if (!state.paused) {
    readInput(dt);
    if (document.getElementById('set-timeflow').checked) { env.setTime(env.hour + dt * 60 / 3600); if (Math.random() < 0.02) updateTimeLabel(); }
    acc += dt;
    const p0 = fm.pos.clone();
    while (acc >= STEP) {
      fm.step(STEP, state.input, env, state.world);
      acc -= STEP;
    }
    state.distFlown += fm.pos.distanceTo(p0);
    if (!fm.crashed) state.flightTime += dt;
    for (const ev of fm.events) {
      if (ev.type === 'crash') {
        spawnExplosion(fm.pos.clone());
        audio.explosion();
        toast(ev.reason, 'bad', 7000);
        toast('Pulsa Enter para reiniciar', 'bad', 7000);
        if (state.cam === 'cockpit') setCamera('chase');
        state.orbitDist = 2.5;
      } else if (ev.type === 'touchdown') {
        audio.touchdown(clamp(ev.impact / 3, 0.3, 1.2));
        state.lastTouch = ev.impact;
        const fpm = Math.round(ev.impact * 196.85);
        if (state.spec.type !== 'heli' || ev.impact > 1) toast(`Toma de contacto: ${fpm} ft/min ${fpm < 200 ? '· ¡Suave!' : fpm < 400 ? '· Correcta' : '· Dura'}`, fpm < 400 ? 'good' : '');
      }
    }
    fm.events.length = 0;
    checkArrival();
    // ayuda: baja el tren automáticamente en aproximación
    const sp = state.spec;
    if (!fm.gearDown && !fm.crashed && !fm.onGround && sp.type === 'plane' && !sp.gearFixed && fm.vel.y < -0.5 && fm.ias < sp.vs * 1.7) {
      const agl = fm.pos.y - sp.gearH - Math.max(0, state.world.groundHeight(fm.pos.x, fm.pos.z));
      if (agl < 90) { fm.gearDown = true; audio.gearMotor(); toast('Tren bajado automáticamente'); }
    }
    if (fm.crashed) {
      const e = fm.euler;
      fm.quat.setFromEuler(new THREE.Euler(lerp(e.x, -0.1, dt), e.y, lerp(e.z, 0.5, dt), 'YXZ'));
    }
  }
  animateModel(dt);
  updateCamera(dt);
  const camWorld = camera.getWorldPosition(_v1);
  state.world.update(camWorld, state.paused ? 0 : dt, 6);
  state.world.updateLights(env.night, camWorld);
  for (const ap of state.world.airports) if (ap.windsock) ap.windsock.rotation.y = Math.atan2(-env.wind.z, env.wind.x) + ap.hdg;
  env.update(state.paused ? 0 : dt, { position: camWorld }, fm.pos);
  computeInstState();
  if (state.cam === 'cockpit') { state.cockpit.update(dt, inst, state.input); state.cockpit.setNight(env.night); }
  updateHUD(dt);
  updateEffects(state.paused ? 0 : dt);
  audio.update({
    rpm: fm.rpm, throttle: fm.throttle, ab: fm.ab, cockpit: state.cam === 'cockpit', camDist: camera.getWorldPosition(_v2).distanceTo(fm.pos),
    airspeed: fm.ias, rain: env.w.rain, windStrength: env.w.wind, onGround: fm.onGround, groundSpeed: Math.hypot(fm.vel.x, fm.vel.z),
    warn: !!state.warn && !state.paused, warnType: fm.stall ? 'stall' : 'gear', crashed: fm.crashed,
  });
  if (state.cam === 'cockpit') {
    // pasada 1: mundo
    camera.layers.set(0);
    renderer.render(scene, camera);
    // pasada 2: interior de cabina sobre el mundo
    renderer.autoClear = false;
    renderer.clearDepth();
    const n = camera.near, f = camera.far;
    camera.near = 0.02; camera.far = 60; camera.updateProjectionMatrix();
    camera.layers.set(1);
    renderer.render(scene, camera);
    camera.near = n; camera.far = f; camera.updateProjectionMatrix();
    camera.layers.set(0);
    renderer.autoClear = true;
  } else {
    renderer.render(scene, camera);
  }
}

function checkArrival() {
  const fm = state.fm, d = state.dest;
  if (state.arrived || fm.crashed || !fm.onGround) return;
  const gs = Math.hypot(fm.vel.x, fm.vel.z);
  if (gs > 3) return;
  const l = state.world.airportLocal(d, fm.pos.x, fm.pos.z);
  if (Math.abs(l.u) < d.len / 2 + 100 && l.v > -80 && l.v < 400) {
    state.arrived = true;
    audio.chime();
    const t = state.flightTime;
    const fpm = state.lastTouch != null ? Math.round(state.lastTouch * 196.85) : 0;
    const rating = fpm < 150 ? '★★★ Mantequilla' : fpm < 300 ? '★★ Muy buena' : fpm < 500 ? '★ Aceptable' : 'Dura, pero de una pieza';
    $('result-title').textContent = `¡Bienvenido a ${d.name}!`;
    $('result-body').innerHTML = `<div class="big">${d.icao}</div>
      Tiempo de vuelo: <b>${Math.floor(t / 60)} min ${Math.floor(t % 60)} s</b><br>
      Distancia recorrida: <b>${(state.distFlown / 1000).toFixed(1)} km</b><br>
      Última toma: <b>${fpm} ft/min</b> — ${rating}<br><br>
      Puedes seguir volando libremente o fijar un nuevo destino.`;
    $('result').classList.remove('hidden');
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = menuCam.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); menuCam.updateProjectionMatrix();
});

buildMenu();
bindSettings();
showPreview();
loop();
