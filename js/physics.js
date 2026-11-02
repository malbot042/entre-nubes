// Modelo de vuelo simplificado pero creíble para aviones y helicópteros.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, DEG } from './util.js?v=5';

const G = 9.81;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _t = new THREE.Vector3();

export class FlightModel {
  constructor(spec) {
    this.spec = spec;
    this.isHeli = spec.type === 'heli';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();
    this.throttle = 0;
    this.rpm = this.isHeli ? 0.95 : 0.15;
    this.gear = 1; this.gearDown = true;
    this.flaps = 0;
    this.brakes = true;
    this.onGround = true;
    this.crashed = false;
    this.stall = false;
    this.g = 1;
    this.aoa = 0; this.beta = 0;
    this.ab = false;
    this.fuel = spec.fuelL * 0.8;
    this.ias = 0;
    this.sweep = 0;
    this.infiniteFuel = true;
    this.events = [];
    if (!this.isHeli) {
      const S = spec.S, m = spec.mass;
      this.aStall = 15 * DEG;
      this.clMax = (2 * m * G) / (1.225 * spec.vs * spec.vs * S);
      this.clA = this.clMax / this.aStall;
      this.k = spec.cat === 'fighter' ? 0.09 : 0.055;
      this.T0 = spec.tw * m * G;
      const qv = 0.5 * 1.225 * spec.vmax * spec.vmax;
      const clv = (m * G) / (qv * S);
      const tv = spec.engine === 'prop' ? this.T0 * 0.25 : this.T0;
      this.cd0 = Math.max(0.012, tv / (qv * S) - this.k * clv * clv);
    } else {
      const m = spec.mass;
      this.cz = (m * G * Math.tan(spec.maxPitch * DEG)) / (spec.vmax * spec.vmax);
      this.cx = this.cz * 3;
      this.cy = (0.85 * m * G) / 49;
    }
  }

  get euler() { return _e.setFromQuaternion(this.quat, 'YXZ'); }

  thrust(rho) {
    const s = this.spec;
    if (!this.infiniteFuel && this.fuel <= 0) return 0;
    if (s.engine === 'prop') {
      const v = Math.max(0, this.ias);
      return this.T0 * this.rpm * Math.max(0.12, 1 - 0.75 * (v / s.vmax) ** 2) * Math.pow(rho / 1.225, 0.6);
    }
    let t;
    if (s.ab) {
      const dry = 0.62;
      t = this.rpm <= 0.85 ? (0.04 + (this.rpm / 0.85) * (dry - 0.04)) : dry + ((this.rpm - 0.85) / 0.15) * (1 - dry);
    } else t = 0.04 + this.rpm * 0.96;
    return this.T0 * t * Math.pow(rho / 1.225, 0.75);
  }

  step(dt, input, env, world) {
    if (this.crashed) return;
    const s = this.spec;
    // motor
    const spool = s.engine === 'prop' ? 1.6 : s.engine === 'heli' ? 0.6 : (this.throttle > this.rpm ? 0.35 : 0.5);
    const target = this.isHeli ? 1 : Math.max(this.throttle, 0.04);
    this.rpm += clamp(target - this.rpm, -spool * dt, spool * dt);
    this.ab = !!s.ab && this.rpm > 0.86;
    if (!this.infiniteFuel) this.fuel = Math.max(0, this.fuel - s.burn * (0.2 + 0.8 * (this.isHeli ? this.throttle : this.rpm)) * (this.ab ? 3 : 1) * dt);
    // tren
    const gt = this.gearDown ? 1 : 0;
    this.gear += clamp(gt - this.gear, -dt / 4, dt / 4);
    if (s.gearFixed || (this.isHeli && !s.gearRetract)) this.gear = 1;

    const rho = 1.225 * Math.exp(-Math.max(0, this.pos.y) / 9000);
    const air = _v.copy(this.vel).sub(env.wind);
    _qi.copy(this.quat).invert();
    const vb = air.applyQuaternion(_qi);
    const V = vb.length();
    this.ias = V * Math.sqrt(rho / 1.225);
    const F = _f.set(0, 0, 0);
    const tgt = _t.set(0, 0, 0);
    const e = this.euler;
    let pitch = e.x, roll = e.z, yaw = e.y;

    if (!this.isHeli) {
      const u = -vb.z;
      this.aoa = V > 2 ? Math.atan2(-vb.y, Math.max(Math.abs(u), 0.5)) : 0;
      this.beta = V > 2 ? Math.atan2(vb.x, Math.max(Math.abs(u), 1)) : 0;
      const qd = 0.5 * rho * V * V;
      // ala variable F-14
      if (s.swing) this.sweep = lerp(this.sweep, clamp((V - 110) / 160, 0, 1), dt * 0.6);
      const aS = this.aStall * (1 + this.flaps * 0.12);
      const aEff = this.aoa + this.flaps * 4 * DEG;
      let cl = this.clA * (1 - this.sweep * 0.15) * aEff;
      this.stall = false;
      if (Math.abs(aEff) > aS) {
        cl = Math.sign(aEff) * this.clA * aS * Math.max(0.35, 1 - (Math.abs(aEff) - aS) / (18 * DEG));
        this.stall = V > 5 && !this.onGround;
      }
      const mach = V / 340;
      let cd = this.cd0 + this.k * cl * cl + this.gear * this.cd0 * (s.gearFixed ? 0 : 0.6) + this.flaps * 0.05 + (this.stall ? 0.08 : 0);
      if (input.speedbrake && !this.onGround) cd += 0.06;
      cd += (s.cat === 'fighter' ? 0.025 : 0.12) * smoothstep(0.85, 1.05, mach);
      if (V > 0.5) {
        const dx = vb.x / V, dy = vb.y / V, dz = vb.z / V;
        // sustentación perpendicular al viento relativo, en el plano de simetría
        let lx = -dx * dy, ly = 1 - dy * dy, lz = -dz * dy;
        const ll = Math.hypot(lx, ly, lz) || 1;
        const L = qd * s.S * cl;
        F.x += (lx / ll) * L; F.y += (ly / ll) * L; F.z += (lz / ll) * L;
        const D = qd * s.S * cd;
        F.x -= dx * D; F.y -= dy * D; F.z -= dz * D;
        F.x -= qd * s.S * 0.6 * this.beta;
        this.liftRatio = L / (s.mass * G);
      } else this.liftRatio = 0;
      F.z -= this.thrust(rho);
      this.g = F.y / (s.mass * G) + Math.cos(pitch) * Math.cos(roll) * (this.onGround ? 1 : 0);

      // rotación
      const eff = clamp(V / (s.vs * 1.15), 0, 1);
      const eff2 = eff * eff;
      // auto-compensación: el morro tiende al ángulo de ataque de vuelo nivelado
      const qS = qd * s.S * this.clA * (1 - this.sweep * 0.15);
      const aTrim = qS > 1 ? clamp((s.mass * G * Math.cos(pitch)) / qS - this.flaps * 4 * DEG, -0.05, aS * 0.8) : 0;
      tgt.x = input.pitch * s.pitch * DEG * eff2 - (this.aoa - aTrim) * 0.5 * eff;
      tgt.z = -input.roll * s.roll * DEG * eff2;
      // estabilidad lateral (efecto diedro), mayor en aviones civiles
      tgt.z -= roll * (s.cat === 'fighter' ? 0.02 : s.cat === 'warbird' ? 0.05 : 0.12) * eff * (1 - Math.abs(input.roll));
      tgt.y = -input.yaw * s.yaw * DEG * eff2 - this.beta * 1.6 * eff;
      if (this.stall) { tgt.x -= 0.35; tgt.z += Math.sin(performance.now() / 300) * 0.5; }
      if (this.onGround) {
        const gs = Math.hypot(this.vel.x, this.vel.z);
        const steer = (input.yaw + input.roll * 0.4) * 0.7 * clamp(gs / 4, 0.0, 1) * clamp(1.6 - gs / 40, 0.15, 1);
        tgt.y = -steer;
        tgt.z = 0;
      }
      // turbulencia
      if (env.w.turb > 0 && !this.onGround) {
        const t = performance.now() / 1000;
        tgt.x += Math.sin(t * 3.1) * env.w.turb * 0.04; tgt.z += Math.sin(t * 2.3 + 1) * env.w.turb * 0.08;
      }
      const resp = 1 - Math.exp(-dt / s.resp);
      this.omega.lerp(tgt, resp);
    } else {
      // ---------- helicóptero ----------
      const gh0 = Math.max(world.groundHeight(this.pos.x, this.pos.z), 0);
      const hag = this.pos.y - s.gearH - gh0;
      const ge = 1 + 0.22 * clamp(1 - hag / (s.rotorR * 1.4), 0, 1);
      const hspd = Math.hypot(vb.x, vb.z);
      const etl = 1 + 0.12 * smoothstep(7, 20, hspd);
      // control arcade: 50 % de colectivo = vuelo estacionario; la inclinación se compensa sola
      const tilt = Math.max(0.55, Math.cos(pitch) * Math.cos(roll));
      const L = s.mass * G * (1 + (this.throttle - 0.5) * 1.7) / tilt * (1 + (ge - 1) * 0.3 + (etl - 1) * 0.2) * this.rpm * this.rpm;
      F.y += L;
      // resistencia en ejes del suelo (avance/lateral según el rumbo, vertical aparte):
      // así inclinar el morro hace avanzar sin frenar hacia abajo
      const ax = this.vel.x - env.wind.x, ay = this.vel.y - env.wind.y, az = this.vel.z - env.wind.z;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const af = ax * fx + az * fz, ar = ax * rx + az * rz;
      const Ff = -this.cz * af * Math.abs(af), Fr = -this.cx * ar * Math.abs(ar);
      this.heliDrag = this.heliDrag || new THREE.Vector3();
      this.heliDrag.set(fx * Ff + rx * Fr, -this.cy * ay * Math.abs(ay) - s.mass * 0.6 * ay, fz * Ff + rz * Fr);
      this.liftRatio = L / (s.mass * G);
      this.g = F.y / (s.mass * G);
      this.aoa = 0; this.beta = V > 3 ? Math.atan2(vb.x, Math.max(-vb.z, 1)) : 0;
      this.stall = false;
      const tp = input.pitch * s.maxPitch * DEG;
      const tr = -input.roll * s.maxBank * DEG;
      tgt.x = clamp((tp - pitch) * 5, -2.2, 2.2);
      tgt.z = clamp((tr - roll) * 5.5, -2.8, 2.8);
      const fwd = -vb.z;
      tgt.y = -input.yaw * s.yaw * 1.5 * DEG - this.beta * 1.5 * smoothstep(10, 25, fwd);
      // viraje coordinado automático
      if (fwd > 8) tgt.y += Math.tan(roll) * G / Math.max(fwd, 8) * Math.cos(roll);
      if (this.onGround) { tgt.x = clamp(tgt.x, -0.3, 0.3); tgt.z = clamp(tgt.z, -0.3, 0.3); if (this.throttle < 0.45) tgt.y *= 0.3; }
      if (env.w.turb > 0) {
        const t = performance.now() / 1000;
        tgt.x += Math.sin(t * 2.7) * env.w.turb * 0.05; tgt.z += Math.sin(t * 3.3 + 2) * env.w.turb * 0.07;
      }
      this.omega.lerp(tgt, 1 - Math.exp(-dt / 0.1));
    }

    // fuerzas -> mundo
    F.applyQuaternion(this.quat);
    if (this.isHeli) F.add(this.heliDrag);
    F.y -= s.mass * G;
    this.vel.addScaledVector(F, dt / s.mass);
    // integración de la orientación
    const w = this.omega.length();
    if (w > 1e-6) {
      _q.setFromAxisAngle(_v.copy(this.omega).divideScalar(w), w * dt);
      this.quat.multiply(_q).normalize();
    }
    this.pos.addScaledVector(this.vel, dt);
    this.groundContact(dt, input, world);
  }

  groundContact(dt, input, world) {
    const s = this.spec;
    const gh = world.groundHeight(this.pos.x, this.pos.z);
    const water = gh < 0.3;
    const groundY = Math.max(gh, 0);
    const down = this.gear > 0.98;
    const hc = down ? s.gearH : s.gearH * 0.42;
    if (this.pos.y - hc > groundY) {
      this.onGround = false;
      return;
    }
    const e = this.euler;
    let pitch = e.x, roll = e.z, yaw = e.y;
    const impact = -this.vel.y;
    const gs = Math.hypot(this.vel.x, this.vel.z);
    const wasAir = !this.onGround;
    const crash = (reason) => {
      this.crashed = true;
      this.pos.y = groundY + hc * 0.5;
      this.events.push({ type: 'crash', reason });
    };
    if (water) return crash('¡Amerizaje forzoso! Has caído al agua.');
    if (!down) {
      if (gs > 8 || impact > 2) return crash('Aterrizaje de panza: el tren no estaba bajado.');
    }
    const maxVs = this.isHeli ? 7 : s.cat === 'fighter' || s.id === 'b737' ? 9 : 8;
    if (impact > maxVs) return crash(`Impacto demasiado fuerte (${(impact * 196.85).toFixed(0)} ft/min).`);
    if (Math.abs(roll) > (this.isHeli ? 40 : 35) * DEG) return crash('Ala contra el suelo: alabeo excesivo al contactar.');
    if (pitch < -20 * DEG) return crash('El morro ha golpeado el terreno.');
    if (this.isHeli && Math.abs(pitch) > 35 * DEG) return crash('El rotor ha golpeado el suelo.');
    if (wasAir && impact > 0.3) this.events.push({ type: 'touchdown', impact, gs });

    this.onGround = true;
    this.pos.y = groundY + hc;
    if (this.vel.y < 0) this.vel.y = 0;
    // orientación sobre ruedas
    const td = (s.taildragger || 0) * DEG;
    let minPitch = 0;
    if (td) minPitch = td * (1 - clamp((gs - s.vs * 0.35) / (s.vs * 0.4), 0, 1));
    const lr = clamp(this.liftRatio || 0, 0, 1);
    if (!this.isHeli) {
      pitch -= (pitch - minPitch) * dt * 2.5 * (1 - lr);
      if (pitch < minPitch) pitch = minPitch;
      pitch = Math.min(pitch, 16 * DEG);
    } else {
      pitch -= pitch * dt * 4 * (1 - lr);
    }
    roll -= roll * Math.min(1, dt * 8);
    _e.set(pitch, yaw, roll, 'YXZ');
    this.quat.setFromEuler(_e);
    if (pitch <= minPitch + 1e-4 && this.omega.x < 0) this.omega.x = 0;
    this.omega.z = 0;
    // fricción de neumáticos / patines
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vs = this.vel.x * rx + this.vel.z * rz;
    vs *= Math.exp(-dt * 10);
    const skids = this.isHeli && !s.gearRetract && s.id !== 'apache';
    let decel = 0.02 * 9.81 + (this.brakes || input.brake ? 0.5 * 9.81 : 0);
    if (skids) decel = 0.7 * 9.81 * (1 - lr);
    if (this.isHeli && !skids && this.throttle < 0.3) decel += 0.3 * 9.81;
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), decel * dt);
    this.vel.x = fx * vf + rx * vs;
    this.vel.z = fz * vf + rz * vs;
  }
}
