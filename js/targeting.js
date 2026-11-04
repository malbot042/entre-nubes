// Sistema de localización, identificación y fijación de blancos.
// Localiza las unidades al alcance, elige solo la más centrada respecto al morro
// (Tab pasa a la siguiente), la identifica en medio segundo y la fija cuando se
// mantiene dentro del cono de fijación. Con el blanco fijado el cañón apunta
// solo (dentro de su cono) y los cohetes salen guiados: no hace falta poner el
// morro exactamente sobre el blanco. Un blanco elegido en el mapa táctico se
// mantiene aunque esté fuera de alcance: el HUD guía hasta él y se fija al llegar.
import * as THREE from 'three';
import { KINDS } from './combat.js?v=41';
import { clamp, DEG } from './util.js?v=41';

const _d = new THREE.Vector3(), _q = new THREE.Quaternion();

// conos en grados y alcances en metros; los helicópteros, más permisivos
const PARAMS = {
  heli: { search: 70, lock: 50, hold: 75, gun: 40, gunRange: 2200, ground: 6000, air: 8000, lockTime: 0.6 },
  plane: { search: 45, lock: 30, hold: 50, gun: 15, gunRange: 2500, ground: 9000, air: 12000, lockTime: 0.8 },
};
const ID_TIME = 0.5;

export class Targeting {
  constructor(combat) {
    this.combat = combat;
    this.reset();
  }

  reset() {
    this.target = null; this.cur = null; this.list = []; this.manual = false;
    this.lockT = 0; this.idT = 0; this.locked = false; this.justLocked = false; this.gunAuto = false;
    this.P = PARAMS.plane;
  }

  // posición del blanco respecto al morro: distancia, acimut y elevación en
  // ejes del avión (grados) y ángulo total fuera del eje
  rel(e, fm) {
    _d.copy(e.pos); if (!e.air) _d.y += 1.5;
    _d.sub(fm.pos);
    const range = _d.length();
    _d.applyQuaternion(_q.copy(fm.quat).invert());
    return {
      e, range,
      az: Math.atan2(_d.x, -_d.z) / DEG,
      el: Math.atan2(_d.y, Math.hypot(_d.x, _d.z)) / DEG,
      off: Math.acos(clamp(-_d.z / (range || 1), -1, 1)) / DEG,
    };
  }

  update(dt, fm, spec) {
    const P = this.P = spec.type === 'heli' ? PARAMS.heli : PARAMS.plane;
    this.justLocked = false;
    const list = [];
    if (this.combat.player && !fm.crashed) {
      for (const e of this.combat.enemies) {
        if (e.dead) continue;
        const r = this.rel(e, fm);
        if (r.range <= (e.air ? P.air : P.ground)) list.push(r);
      }
    }
    list.sort((a, b) => a.off - b.off);
    this.list = list;
    let cur = this.target ? list.find(c => c.e === this.target) : null;
    if (!cur && this.manual && this.target && !this.target.dead && this.combat.player && !fm.crashed) {
      cur = this.rel(this.target, fm); cur.far = true;
    }
    if (!cur) {
      // blanco perdido o destruido: selección automática del más centrado
      this.target = null; this.lockT = 0; this.locked = false; this.manual = false;
      const best = list.find(c => c.off < P.search);
      if (best) { this.select(best.e); cur = best; }
    }
    this.cur = cur || null;
    if (!cur) { this.gunAuto = false; return; }
    this.idT += dt;
    // histéresis: fijar exige estar dentro del cono de fijación; para perder la
    // fijación hay que salirse del cono de mantenimiento, más amplio
    const inCone = !cur.far && cur.off < (this.locked ? P.hold : P.lock);
    this.lockT = inCone ? Math.min(1, this.lockT + dt / P.lockTime) : Math.max(0, this.lockT - dt * 2);
    const was = this.locked;
    this.locked = this.lockT >= 1;
    this.justLocked = this.locked && !was;
    this.gunAuto = this.locked && cur.off < P.gun && cur.range < P.gunRange;
  }

  // manual: elegido por el jugador (Tab o mapa); no se sustituye aunque salga de alcance
  select(e, manual = false) {
    this.target = e; this.lockT = 0; this.idT = 0; this.locked = false; this.manual = manual;
  }

  // Tab: siguiente blanco por orden de cercanía al morro
  next() {
    if (!this.list.length) return false;
    const i = this.list.findIndex(c => c.e === this.target);
    this.select(this.list[(i + 1) % this.list.length].e, true);
    return true;
  }

  get identified() { return this.idT >= ID_TIME; }

  // texto de identificación del blanco actual
  idText() {
    const c = this.cur;
    if (!c) return '';
    if (!this.identified) return 'IDENTIFICANDO';
    return `${KINDS[c.e.kind]?.label || c.e.kind.toUpperCase()} · ${c.e.training ? 'BLANCO' : 'HOSTIL'}`;
  }
}
