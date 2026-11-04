// Modos de juego: ataque a tierra (CAS) e interceptación aérea.
import * as THREE from 'three';
import { mulberry32 } from './util.js?v=33';

export const MODES = [
  { id: 'free', name: 'Vuelo libre', icon: '☁', desc: 'Exploración sin límites sobre un mundo infinito, con ciclo de día y noche en tiempo real. Elige un destino y aterriza, o practica con los blancos de entrenamiento: vehículos y drones que no disparan.' },
  { id: 'cas', name: 'Ataque a tierra', icon: '⌖', desc: 'Apoyo aéreo cercano: destruye tanques, antiaéreos y búnkeres con cañón y cohetes no guiados. Vuela bajo y vigila la flak.' },
  { id: 'dogfight', name: 'Interceptación', icon: '✈', desc: 'Dogfight contra oleadas de cazas enemigos con maniobras evasivas. Cada oleada es mayor y más precisa.' },
];
export const isCombat = (m) => m === 'cas' || m === 'dogfight';

const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`;

// Busca un punto llano y seco cerca de una posición
function findFlat(world, x, z, rnd, spread = 1200) {
  let best = null, bestS = Infinity;
  for (let i = 0; i < 26; i++) {
    const px = x + (rnd() - 0.5) * spread, pz = z + (rnd() - 0.5) * spread;
    const h = world.height(px, pz);
    if (h < 4) continue;
    const s = Math.abs(world.height(px + 90, pz) - h) + Math.abs(world.height(px, pz + 90) - h) + h * 0.03 + (world.nearAirport(px, pz, 300) ? 500 : 0);
    if (s < bestS) { bestS = s; best = { x: px, z: pz }; }
  }
  return best || { x, z };
}

class Base {
  constructor(ctx) { this.ctx = ctx; this.done = false; this.level = 1; this.t = 0; }
  get combat() { return this.ctx.combat; }
  get startInAir() { return false; }
  start() { }
  update() { }
  nav() { return null; }
  panel() { return ''; }
  onCrash() { }
  onTouchdown() { }
  dispose() { }
  markers() { return []; }
  failed(reason) {
    if (this.done) return;
    this.done = true;
    const c = this.ctx;
    setTimeout(() => {
      if (c.mission !== this) return; // ya se ha reiniciado o se ha vuelto al menú
      c.showResult({
        title: 'Misión fallida', big: 'K.I.A.', cls: 'bad', html: `${reason}<br>Puntuación: <b>${this.combat ? this.combat.score : 0}</b>`,
        primary: ['Reintentar', () => c.restart()], secondary: ['Menú', () => c.toMenu()],
      });
    }, 1800);
  }
}

// ==================== ATAQUE A TIERRA ====================
class CAS extends Base {
  get startInAir() { return true; }
  setup() {
    const c = this.ctx, w = c.world, rnd = mulberry32(c.seed + this.level * 991);
    const o = c.origin;
    const brg = rnd() * Math.PI * 2, dist = 6500 + rnd() * 1500;
    const site = findFlat(w, o.x + Math.sin(brg) * dist, o.z - Math.cos(brg) * dist, rnd, 3500);
    this.site = { x: site.x, z: site.z, icao: 'OBJ', name: 'Zona de ataque' };
    const L = this.level, nTanks = 2 + L, nAAA = 1 + Math.ceil(L / 2), nBunk = 1 + Math.floor(L / 2), nTruck = 2;
    const place = (kind, n, r) => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 12; k++) {
          const a = rnd() * 6.28, d = r * (0.25 + rnd() * 0.75);
          const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d, h = w.groundHeight(x, z);
          if (h < 2 || w.nearAirport(x, z, 80)) continue;
          this.combat.spawnGround(kind, x, h - 0.1, z, rnd() * 6.28, L);
          break;
        }
      }
    };
    place('tank', nTanks, 520); place('aaa', nAAA, 620); place('bunker', nBunk, 340); place('truck', nTruck, 460);
    w.focus = { x: site.x, z: site.z, r: 1600 };
    this.total = this.combat.alive.length;
  }
  start() {
    this.combat.reset();
    this.combat.armPlayer(this.ctx.fm, this.ctx.spec, this.ctx.model);
    this.setup();
    this.ctx.toast(`Misión ${this.level}: destruye ${this.total} objetivos en la zona de ataque`, 'good', 6000);
  }
  nav() { return this.site; }
  markers() { return this.combat.alive.map(e => ({ pos: e.pos, label: e.kind, air: false })); }
  panel() { return `<b>MISIÓN ${this.level}</b> Objetivos ${this.combat.alive.length}/${this.total}`; }
  update(dt) {
    this.t += dt;
    if (!this.done && this.combat.alive.length === 0) {
      this.done = true;
      const c = this.ctx, s = this.combat.score, p = this.combat.player;
      const bonus = Math.max(0, Math.round(1200 - this.t * 4 + p.hp / p.maxHp * 600));
      this.combat.score += bonus;
      c.audio.chime();
      c.showResult({
        title: `Misión ${this.level} cumplida`, big: `${this.combat.score} pts`,
        html: `Objetivos destruidos: <b>${this.total}</b><br>Tiempo: <b>${fmtT(this.t)}</b><br>Bonificación: <b>${bonus}</b> (puntos base ${s})<br>Blindaje restante: <b>${Math.round(p.hp / p.maxHp * 100)} %</b>`,
        primary: ['Siguiente misión', () => this.next()], secondary: ['Menú', () => c.toMenu()],
      });
    }
  }
  next() {
    const score = this.combat.score;
    this.level++; this.done = false; this.t = 0;
    this.ctx.hideResult();
    this.ctx.origin = { x: this.ctx.fm.pos.x, z: this.ctx.fm.pos.z };
    const hp = this.combat.player.hp;
    this.start();
    this.combat.score = score;
    this.combat.player.hp = Math.min(this.combat.player.maxHp, hp + this.combat.player.maxHp * 0.3);
  }
  onCrash(reason) { this.failed(reason); }
}

// ==================== INTERCEPTACIÓN ====================
const WAVES = 5;
class Dogfight extends Base {
  get startInAir() { return true; }
  start() {
    this.combat.reset();
    this.combat.armPlayer(this.ctx.fm, this.ctx.spec, this.ctx.model);
    this.wave = 0; this.wait = 2.5;
    this.ctx.toast('Interceptación: cazas hostiles entrando en tu sector', 'good', 5000);
  }
  spawnWave() {
    this.wave++;
    const c = this.ctx, fm = c.fm, n = Math.min(this.wave + 1, 6);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(fm.quat); fwd.y = 0; fwd.normalize();
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * 0.35;
      const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const x = fm.pos.x + dir.x * 3200, z = fm.pos.z + dir.z * 3200;
      const y = Math.max(fm.pos.y + (i % 2 ? 90 : -50), Math.max(c.world.height(x, z), 0) + 420);
      this.combat.spawnFighter(x, y, z, dir.clone().negate(), this.wave);
    }
    c.toast(`Oleada ${this.wave}/${WAVES}: ${n} cazas`, 'bad', 4000);
    c.audio.hit();
  }
  nav() {
    const a = this.combat.alive, fm = this.ctx.fm;
    if (!a.length) return { x: fm.pos.x, z: fm.pos.z, icao: '---', name: 'Sector despejado' };
    let best = a[0], bd = Infinity;
    for (const e of a) { const d = e.pos.distanceToSquared(fm.pos); if (d < bd) { bd = d; best = e; } }
    return { x: best.pos.x, z: best.pos.z, icao: 'BOGEY', name: 'Caza más próximo' };
  }
  markers() { return this.combat.alive.map(e => ({ pos: e.pos, vel: e.vel, label: 'CAZA', air: true })); }
  panel() { return `<b>OLEADA ${Math.max(this.wave, 1)}/${WAVES}</b> Cazas ${this.combat.alive.length}`; }
  update(dt) {
    this.t += dt;
    if (this.done) return;
    if (this.combat.alive.length === 0) {
      if (this.wave >= WAVES) {
        this.done = true;
        const c = this.ctx, p = this.combat.player;
        c.audio.chime();
        c.showResult({
          title: 'Espacio aéreo despejado', big: `${this.combat.score} pts`,
          html: `Oleadas superadas: <b>${WAVES}</b><br>Tiempo: <b>${fmtT(this.t)}</b><br>Blindaje restante: <b>${Math.round(p.hp / p.maxHp * 100)} %</b>`,
          primary: ['Otra partida', () => c.restart()], secondary: ['Menú', () => c.toMenu()],
        });
      } else {
        this.wait -= dt;
        if (this.wait <= 0) { this.spawnWave(); this.wait = 6; }
      }
    }
  }
  onCrash(reason) { this.failed(reason); }
}

// ==================== ENTRENAMIENTO (vuelo libre) ====================
// En vuelo libre siempre hay blancos alrededor: grupos de vehículos en tierra y
// drones en círculo. No disparan. Los que quedan muy atrás se retiran y van
// apareciendo nuevos por delante; las armas se recargan solas al agotarse.
const T_GROUND = 6, T_DRONES = 3;
export class Training {
  constructor(ctx) { this.ctx = ctx; this.check = 0; this.cool = 0; this.reload = 0; this.rnd = mulberry32(ctx.seed + 77); }
  get combat() { return this.ctx.combat; }
  start() {
    this.combat.armPlayer(this.ctx.fm, this.ctx.spec, this.ctx.model);
    this.fill(true);
  }
  // punto por delante del jugador, a 2,5–5 km y hasta 55° a cada lado del rumbo
  ahead(min = 2500, max = 5000) {
    const fm = this.ctx.fm, rnd = this.rnd;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(fm.quat);
    const hdg = Math.atan2(f.x, -f.z) + (rnd() - 0.5) * 1.9, d = min + rnd() * (max - min);
    return { x: fm.pos.x + Math.sin(hdg) * d, z: fm.pos.z - Math.cos(hdg) * d };
  }
  fill(all = false) {
    const c = this.combat, w = this.ctx.world, rnd = this.rnd;
    const ground = c.enemies.filter(e => e.training && !e.air && !e.dead).length;
    const drones = c.enemies.filter(e => e.kind === 'drone' && !e.dead).length;
    if (ground < T_GROUND && (all || ground <= 2)) {
      const p = this.ahead(), site = findFlat(w, p.x, p.z, rnd, 1500);
      const kinds = ['tank', 'truck', 'tank', 'aaa', 'truck', 'bunker'];
      for (let i = 0; i < T_GROUND - ground; i++) {
        for (let k = 0; k < 10; k++) {
          const a = rnd() * 6.28, d = 60 + rnd() * 320;
          const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d, h = w.groundHeight(x, z);
          if (h < 2 || w.nearAirport(x, z, 150)) continue;
          c.spawnGround(kinds[i % kinds.length], x, h - 0.1, z, rnd() * 6.28, 1).training = true;
          break;
        }
      }
    }
    for (let i = drones; i < T_DRONES; i++) {
      const p = this.ahead(3000, 6000);
      c.spawnDrone(p.x, p.z, w);
    }
  }
  update(dt) {
    const c = this.combat, fm = this.ctx.fm, p = c.player;
    if (!p) return;
    this.check -= dt; this.cool -= dt;
    if (this.check <= 0) {
      this.check = 1;
      for (const e of [...c.enemies]) {
        const far = e.air ? Math.hypot(e.cx - fm.pos.x, e.cz - fm.pos.z) : e.pos.distanceTo(fm.pos);
        if (e.training && !e.dead && far > 14000) c.discard(e);
      }
      if (this.cool <= 0) { this.fill(); this.cool = 8; }
    }
    // recarga automática al agotarse cualquiera de las armas
    const a = this.ctx.spec.arms;
    if (a && (p.ammo <= 0 || p.rockets <= 0 || (a.ag && p.ag <= 0) || (a.aa && p.aa <= 0))) {
      if (this.reload <= 0) { this.reload = 4; this.ctx.toast('Recargando armamento…', '', 3500); }
      this.reload -= dt;
      if (this.reload <= 0) { this.combat.rearm(); this.reload = 0; this.ctx.toast('Armamento recargado', 'good'); }
    }
  }
  panel() { return `<b>ENTRENAMIENTO</b> Blancos destruidos ${this.combat.kills}`; }
}

export function createMission(mode, ctx) {
  if (mode === 'cas') return new CAS(ctx);
  if (mode === 'dogfight') return new Dogfight(ctx);
  return null;
}
