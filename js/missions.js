// Modos de juego: ataque a tierra (CAS), interceptación aérea y circuito de anillos.
import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from './util.js?v=5';

export const MODES = [
  { id: 'free', name: 'Vuelo libre', icon: '☁', desc: 'Exploración sin límites sobre un mundo infinito, con ciclo de día y noche en tiempo real. Elige un destino y aterriza.' },
  { id: 'cas', name: 'Ataque a tierra', icon: '⌖', desc: 'Apoyo aéreo cercano: destruye tanques, antiaéreos y búnkeres con cañón y cohetes no guiados. Vuela bajo y vigila la flak.' },
  { id: 'dogfight', name: 'Interceptación', icon: '✈', desc: 'Dogfight contra oleadas de cazas enemigos con maniobras evasivas. Cada oleada es mayor y más precisa.' },
  { id: 'rings', name: 'Anillos y precisión', icon: '◎', desc: 'Circuito de anillos de neón contra el crono: cada anillo acelera. Termina con un aterrizaje de precisión en pista o helipuerto.' },
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

// ==================== ANILLOS Y ATERRIZAJE DE PRECISIÓN ====================
class Rings extends Base {
  get combat() { return null; }
  start() {
    const c = this.ctx, w = c.world, sp = c.spec, ap = c.dest, o = c.origin;
    this.clearRings();
    this.isHeli = sp.type === 'heli';
    this.index = 0; this.t = 0; this.running = false; this.phase = 'rings'; this.touch = null; this.missed = 0;
    this.radius = this.isHeli ? 32 : clamp(26 + sp.vs * 0.35, 34, 52);
    const start = w.localToWorld(o, 0, o.len / 2 + 900);
    // Final: eje de pista por el extremo más cercano, o directo al helipuerto
    let aim, finals;
    if (this.isHeli) {
      aim = ap.helipad;
      const dx = aim.x - start.x, dz = aim.z - start.z, l = Math.hypot(dx, dz);
      finals = [{ x: aim.x - dx / l * 420, z: aim.z - dz / l * 420, agl: 60, elev: ap.elev }];
    } else {
      const s = Math.hypot(start.x - ap.x - ap.dir.x * ap.len / 2, start.z - ap.z - ap.dir.z * ap.len / 2) <
        Math.hypot(start.x - ap.x + ap.dir.x * ap.len / 2, start.z - ap.z + ap.dir.z * ap.len / 2) ? 1 : -1;
      this.end = s;
      aim = w.localToWorld(ap, 0, s * (ap.len / 2 - 300));
      const gs = Math.tan(3.2 * Math.PI / 180);
      finals = [2400, 1300].map(d => {
        const p = w.localToWorld(ap, 0, s * (ap.len / 2 + d));
        return { x: p.x, z: p.z, agl: Math.max(36, (d + 300) * gs), elev: ap.elev };
      });
    }
    this.aim = aim;
    // Trazado sinuoso entre la salida y la final
    const pts = [], N = 12, f0 = finals[0];
    const dx = f0.x - start.x, dz = f0.z - start.z, L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;
    const rnd = mulberry32(c.seed + 17);
    const ph = rnd() * 6.28, amp = Math.min(520, L * 0.05);
    const baseAgl = this.isHeli ? 70 : 130;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const off = Math.sin(t * Math.PI * 2.4 + ph) * amp * Math.sin(t * Math.PI);
      const x = start.x + dx * t + nx * off, z = start.z + dz * t + nz * off;
      let gh = 0;
      for (const d of [-260, 0, 260]) gh = Math.max(gh, w.height(x + dx / L * d, z + dz / L * d));
      const blend = clamp((t - 0.72) / 0.28, 0, 1);
      const y = lerp(Math.max(gh, 0) + baseAgl + 45 * Math.sin(i * 1.7 + ph), Math.max(ap.elev + (finals[0].agl + 40), Math.max(gh, 0) + 60), blend);
      pts.push({ x, y, z });
    }
    // la final sigue la senda de planeo, pero nunca deja el anillo enterrado en una loma
    const margin = this.radius + 10;
    for (const f of finals) pts.push({ x: f.x, y: Math.max(f.elev + f.agl, Math.max(w.height(f.x, f.z), 0) + margin), z: f.z });
    // suavizado de altitud para que el circuito no exija bruscos cabeceos
    for (let k = 0; k < 2; k++) for (let i = 1; i < N - 1; i++) pts[i].y = Math.max((pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4, Math.max(w.height(pts[i].x, pts[i].z), 0) + margin + 12);
    this.rings = pts.map((p, i) => {
      const a = i > 0 ? pts[i - 1] : { x: start.x, y: p.y, z: start.z };
      const b = i < pts.length - 1 ? pts[i + 1] : { x: aim.x, y: ap.elev, z: aim.z };
      const n = new THREE.Vector3(b.x - a.x, (b.y - a.y) * 0.6, b.z - a.z).normalize();
      return { pos: new THREE.Vector3(p.x, p.y, p.z), n, side: 0, mesh: null, done: false };
    });
    const geo = new THREE.TorusGeometry(this.radius, 1.5, 6, 20);
    for (const r of this.rings) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x20ff88, toneMapped: false, fog: false }));
      m.position.copy(r.pos);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.n);
      c.scene.add(m);
      r.mesh = m;
    }
    this.geo = geo;
    this.colorRings();
    c.toast('Atraviesa los anillos en orden. El crono empieza en el primero.', 'good', 6000);
  }
  colorRings() {
    this.rings.forEach((r, i) => {
      const col = r.mesh.material.color;
      if (r.done) { r.mesh.visible = false; return; }
      r.mesh.visible = true;
      if (i === this.index) col.setRGB(0.25, 5.5, 2.6);
      else if (i === this.index + 1) col.setRGB(5, 1.1, 4.4);
      else col.setRGB(1.1, 0.5, 2.6);
    });
  }
  clearRings() {
    if (!this.rings) return;
    for (const r of this.rings) { this.ctx.scene.remove(r.mesh); r.mesh.material.dispose(); }
    this.geo?.dispose();
    this.rings = null;
  }
  dispose() { this.clearRings(); }
  nav() {
    const c = this.ctx;
    if (this.phase === 'rings' && this.rings[this.index]) {
      const r = this.rings[this.index];
      return { x: r.pos.x, z: r.pos.z, icao: `ANILLO ${this.index + 1}`, name: `de ${this.rings.length}` };
    }
    return { x: this.aim.x, z: this.aim.z, icao: c.dest.icao, name: this.isHeli ? 'Helipuerto' : 'Punto de toma' };
  }
  markers() {
    if (this.phase === 'rings' && this.rings[this.index]) return [{ pos: this.rings[this.index].pos, label: 'ring', ring: true }];
    return [{ pos: new THREE.Vector3(this.aim.x, this.ctx.dest.elev + 2, this.aim.z), label: 'toma', ring: true }];
  }
  panel() {
    if (!this.rings) return '';
    const n = this.rings.length;
    return `<b>${fmtT(this.t)}</b> ${this.phase === 'rings' ? `Anillo ${Math.min(this.index + 1, n)}/${n}` : (this.isHeli ? 'Posa en el helipuerto' : 'Aterriza en el punto de toma')}`;
  }
  pass(i) {
    const c = this.ctx, r = this.rings[i], fm = c.fm;
    r.done = true;
    this.index = i + 1;
    if (!this.running) { this.running = true; this.t = 0; }
    c.audio.ring(i);
    c.fx.spark(r.pos, 1, 7, 4, 26);
    // empuje del anillo: acelera en la dirección de vuelo sin pasar de la velocidad máxima
    const v = fm.vel.length();
    const vmax = c.spec.vmax;
    if (v > 5 && v < vmax) fm.vel.multiplyScalar(Math.min(1 + (this.isHeli ? 0.07 : 0.09), vmax / v));
    if (this.index >= this.rings.length) {
      this.phase = 'landing';
      c.toast(this.isHeli ? 'Circuito completado: posa en la H' : 'Circuito completado: aterriza en la zona de toma', 'good', 5000);
    }
    this.colorRings();
  }
  update(dt) {
    const c = this.ctx, fm = c.fm;
    if (!this.rings || this.done) return;
    if (this.running) this.t += dt;
    if (this.phase === 'rings') {
      // detección por cruce del plano del anillo
      for (let i = this.index; i < Math.min(this.index + 3, this.rings.length); i++) {
        const r = this.rings[i];
        const dv = fm.pos.clone().sub(r.pos);
        const s = dv.dot(r.n);
        const inside = dv.addScaledVector(r.n, -s).length() < this.radius;
        if (r.side < 0 && s >= 0 && inside) {
          if (i > this.index) { this.missed += i - this.index; for (let k = this.index; k < i; k++) this.rings[k].done = true; this.t += 5 * (i - this.index); c.toast(`Anillo perdido: +${5 * (i - this.index)} s`, 'bad'); }
          this.pass(i); break;
        }
        r.side = Math.sign(s) || r.side;
      }
      // un anillo sobrepasado y lejos se da por perdido
      const r = this.rings[this.index];
      if (r) {
        const dv = fm.pos.clone().sub(r.pos);
        if (dv.dot(r.n) > 350) {
          r.done = true; this.index++; this.missed++; this.t += 5;
          c.toast('Anillo perdido: +5 s', 'bad');
          if (this.index >= this.rings.length) this.phase = 'landing';
          this.colorRings();
        }
      }
    } else if (fm.onGround && Math.hypot(fm.vel.x, fm.vel.z) < 2.5) {
      const away = Math.hypot(fm.pos.x - this.aim.x, fm.pos.z - this.aim.z);
      if (this.isHeli ? away < 400 : this.touch) this.finish(away);
    }
  }
  onTouchdown(ev) {
    if (this.phase !== 'landing' || this.touch) return;
    const fm = this.ctx.fm;
    this.touch = { dist: Math.hypot(fm.pos.x - this.aim.x, fm.pos.z - this.aim.z), fpm: ev.impact * 196.85 };
  }
  finish(away) {
    this.done = true;
    const c = this.ctx;
    const ap = c.dest, local = c.world.airportLocal(ap, c.fm.pos.x, c.fm.pos.z);
    const offset = this.isHeli ? away : (this.touch?.dist ?? 9999);
    const fpm = this.touch?.fpm ?? 0;
    const onRunway = this.isHeli || (Math.abs(local.v) < ap.width && Math.abs(local.u) < ap.len / 2);
    const pOff = Math.max(0, (this.isHeli ? 1000 : 1000) - offset * (this.isHeli ? 25 : 2.2));
    const pFpm = Math.max(0, 1000 - fpm * 2);
    const pRings = (this.rings.length - this.missed) * 300;
    const pTime = Math.max(0, Math.round(2400 - this.t * 12));
    const score = onRunway ? Math.round(pOff + pFpm + pRings + pTime) : Math.round((pRings + pTime) * 0.5);
    const best = c.saveBest('rings:' + c.spec.id, score);
    c.audio.chime();
    c.showResult({
      title: onRunway ? 'Aterrizaje de precisión' : 'Fuera de pista', big: `${score} pts`,
      html: `Tiempo: <b>${fmtT(this.t)}</b> · Anillos: <b>${this.rings.length - this.missed}/${this.rings.length}</b><br>
        Desvío del punto de toma: <b>${Math.round(offset)} m</b><br>Velocidad vertical: <b>${Math.round(fpm)} ft/min</b><br>Récord con esta aeronave: <b>${best}</b>`,
      primary: ['Repetir', () => c.restart()], secondary: ['Menú', () => c.toMenu()],
    });
  }
  onCrash(reason) { this.failed(reason); }
}

export function createMission(mode, ctx) {
  if (mode === 'cas') return new CAS(ctx);
  if (mode === 'dogfight') return new Dogfight(ctx);
  if (mode === 'rings') return new Rings(ctx);
  return null;
}
