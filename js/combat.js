// Combate: proyectiles vectoriales, cohetes no guiados, unidades enemigas e IA.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp } from './util.js?v=9';

const G = 9.81;
const BULLET_V = 1050, MAX_BULLETS = 500;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3();

// ---------- Geometría low-poly: una sola malla por unidad, una sola llamada de dibujo ----------
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (w, h, d, x, y, z, col) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
const merged = (...p) => mergeGeometries(p);

function wedge(w, z0, z1, x0, col, y = 0) {
  // ala triangular: planta (x0,z0)-(x0,z1)-(w,z1)
  const s = new THREE.Shape([new THREE.Vector2(x0, z0), new THREE.Vector2(w, z1), new THREE.Vector2(x0, z1)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, y, 0);
  return paint(g, col);
}

function buildGeometries() {
  const OL = 0x56603a, OD = 0x3c4530, BK = 0x24262a, RD = 0xc83a2a, TN = 0x8a7a55;
  const G_ = {};
  G_.tankHull = merged(
    box(3.6, 1.0, 7, 0, 0.95, 0, OL),
    box(3.9, 0.9, 7.4, 0, 0.45, 0, BK),
    paint(new THREE.CylinderGeometry(0.9, 1.5, 0.5, 4).rotateY(Math.PI / 4).scale(2.2, 1, 1.6).translate(0, 1.35, 3), OD),
  );
  G_.tankTurret = merged(
    paint(new THREE.CylinderGeometry(1.25, 1.75, 0.9, 6).translate(0, 0.45, 0), OD),
    paint(new THREE.CylinderGeometry(0.1, 0.13, 4.6, 5).rotateX(Math.PI / 2).translate(0, 0.5, -3.4), BK),
    box(0.5, 0.25, 0.5, 0.6, 1.0, 0.3, RD),
  );
  G_.aaaBase = merged(
    paint(new THREE.CylinderGeometry(2.3, 2.9, 1.0, 6).translate(0, 0.5, 0), TN),
    box(5.5, 0.35, 0.8, 0, 0.2, 0, OD), box(0.8, 0.35, 5.5, 0, 0.2, 0, OD),
  );
  G_.aaaTurret = merged(
    box(2.2, 1.3, 2.4, 0, 0.65, 0, OL),
    paint(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 5).rotateX(Math.PI / 2).translate(0.45, 0.8, -2.6), BK),
    paint(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 5).rotateX(Math.PI / 2).translate(-0.45, 0.8, -2.6), BK),
    box(0.5, 0.4, 0.3, 0, 1.45, 0.6, RD),
  );
  G_.bunker = merged(
    paint(new THREE.CylinderGeometry(7.5, 10, 3.6, 6).translate(0, 1.8, 0), 0x77786a),
    paint(new THREE.CylinderGeometry(4.5, 7.5, 1.6, 6).translate(0, 4.4, 0), 0x63655a),
    box(4.8, 0.7, 0.4, 0, 2.5, -8, BK),
    box(0.6, 3, 0.6, 2.4, 6.2, 0, RD),
  );
  G_.truck = merged(box(2.3, 1.7, 2.1, 0, 1.45, -2.6, OD), box(2.5, 2.2, 4.6, 0, 1.75, 0.8, OL), box(2.6, 0.6, 7.2, 0, 0.45, 0, BK));
  const HB = 0x7a2028, HD = 0x341a22;
  G_.fighter = merged(
    paint(new THREE.CylinderGeometry(0.3, 0.75, 4.8, 6).rotateX(-Math.PI / 2).translate(0, 0.1, -3.9), HB),
    paint(new THREE.CylinderGeometry(0.75, 0.85, 3.2, 6).rotateX(-Math.PI / 2).translate(0, 0.1, 0), HB),
    paint(new THREE.CylinderGeometry(0.85, 0.5, 3.8, 6).rotateX(-Math.PI / 2).translate(0, 0.1, 3.4), HD),
    paint(new THREE.ConeGeometry(0.3, 1.4, 5).rotateX(-Math.PI / 2).translate(0, 0.1, -7), BK),
    paint(new THREE.SphereGeometry(0.55, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.9, 0.85, 2).translate(0, 0.72, -3.3), 0x88e0ff),
    wedge(6.5, -2.2, 3.2, 0.5, HB), wedge(-6.5, -2.2, 3.2, -0.5, HB),
    wedge(2.6, 3.4, 5.4, 0.3, HD), wedge(-2.6, 3.4, 5.4, -0.3, HD),
    paint(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(2.8, 0.5), new THREE.Vector2(5.2, 3.2), new THREE.Vector2(5.9, 3.2), new THREE.Vector2(5.4, 0.5)]), { depth: 0.14, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.07, 0, 0), HD),
  );
  for (const k in G_) G_[k].computeVertexNormals();
  return G_;
}

function matFor() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.2 });
}

const KINDS = {
  tank: { hp: 120, r: 5.5, score: 150, label: 'TANQUE' },
  aaa: { hp: 70, r: 5, score: 200, label: 'ANTIAÉREO' },
  bunker: { hp: 240, r: 11, score: 250, label: 'BÚNKER' },
  truck: { hp: 40, r: 5, score: 75, label: 'CAMIÓN' },
  fighter: { hp: 80, r: 10, score: 300, label: 'CAZA' },
};

export class Combat {
  constructor(scene, particles, audio) {
    this.scene = scene; this.fx = particles; this.audio = audio;
    this.geo = buildGeometries();
    this.mat = matFor();
    this.wreckMat = new THREE.MeshStandardMaterial({ color: 0x17161a, flatShading: true, roughness: 1 });
    this.enemies = [];
    this.bullets = [];
    this.rockets = [];
    this.score = 0; this.frame = 0; this.gunT = 0; this.rocketT = 0; this.rocketSide = 1; this.gunIdx = 0;
    this.player = null;
    this.tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }), MAX_BULLETS);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.frustumCulled = false; this.tracers.count = 0;
    this.tracers.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.tracers);
    this.rocketGeo = merged(
      paint(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 5).rotateX(Math.PI / 2), 0xd8d8cc),
      paint(new THREE.ConeGeometry(0.07, 0.3, 5).rotateX(-Math.PI / 2).translate(0, 0, -0.9), 0xc83a2a),
    );
    this.rocketMat = matFor();
    this.color = new THREE.Color();
  }

  // ---- ciclo de vida ----
  reset() {
    for (const e of this.enemies) this.remove(e);
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.enemies.length = 0; this.bullets.length = 0; this.rockets.length = 0;
    this.tracers.count = 0; this.score = 0;
  }
  remove(e) { this.scene.remove(e.obj); }

  armPlayer(fm, spec, model) {
    const a = spec.arms;
    this.player = { fm, spec, model, hp: a ? a.hp : 100, maxHp: a ? a.hp : 100, ammo: a ? a.gun.ammo : 0, rockets: a ? a.rockets : 0, radius: Math.max(7, (model?.size || 20) * 0.28), hitFlash: 0 };
    this.bullets.length = 0;
  }

  spawnGround(kind, x, y, z, heading = 0, level = 1) {
    const obj = new THREE.Group();
    const part = (g) => { const m = new THREE.Mesh(g, this.mat); m.castShadow = true; m.receiveShadow = true; obj.add(m); return m; };
    let turret = null;
    if (kind === 'tank') { part(this.geo.tankHull); turret = part(this.geo.tankTurret); turret.position.y = 1.45; }
    else if (kind === 'aaa') { part(this.geo.aaaBase); turret = part(this.geo.aaaTurret); turret.position.y = 1; }
    else if (kind === 'bunker') part(this.geo.bunker);
    else part(this.geo.truck);
    obj.position.set(x, y, z); obj.rotation.y = heading;
    this.scene.add(obj);
    const K = KINDS[kind];
    const e = { kind, obj, turret, pos: obj.position, hp: K.hp, r: K.r, air: false, dead: false, cool: 1 + Math.random() * 3, burst: 0, heading, speed: kind === 'tank' ? 4 : kind === 'truck' ? 7 : 0, level, t: Math.random() * 10, deadT: 0 };
    this.enemies.push(e);
    return e;
  }

  spawnFighter(x, y, z, dir, level = 1) {
    const obj = new THREE.Mesh(this.geo.fighter, this.mat);
    obj.castShadow = true; obj.scale.setScalar(1.15);
    obj.position.set(x, y, z);
    this.scene.add(obj);
    const K = KINDS.fighter;
    const e = {
      kind: 'fighter', obj, pos: obj.position, hp: K.hp, r: K.r, air: true, dead: false, dir: dir.clone().normalize(), vel: new THREE.Vector3(),
      speed: 170, state: 'pursue', stateT: 0, roll: 0, level, cool: 2 + Math.random() * 2, burst: 0, breakSign: Math.random() < 0.5 ? 1 : -1, t: 0, deadT: 0,
      turn: 0.62 + 0.05 * level + Math.random() * 0.1,
    };
    this.enemies.push(e);
    return e;
  }

  get alive() { return this.enemies.filter(e => !e.dead); }

  // ---- armas del jugador ----
  fire(input, dt) {
    const p = this.player;
    if (!p || p.fm.crashed || !p.spec.arms) return;
    const a = p.spec.arms, fm = p.fm;
    this.gunT -= dt; this.rocketT -= dt;
    if (input.gun && p.ammo > 0) {
      while (this.gunT <= 0 && p.ammo > 0) {
        this.gunT += 1 / a.gun.rps;
        p.ammo--;
        const at = a.gun.at[this.gunIdx++ % a.gun.at.length];
        _a.set(at[0], at[1], at[2]).applyQuaternion(fm.quat).add(fm.pos);
        const spread = 0.0026;
        _b.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, -1).normalize().applyQuaternion(fm.quat);
        this.addBullet(_a, _b.multiplyScalar(BULLET_V).add(fm.vel), a.gun.dmg, true);
        this.fx.glow(_a.x, _a.y, _a.z, fm.vel.x, fm.vel.y, fm.vel.z, 10, 6.5, 2.5, 3.4, 0.05, 0);
      }
      if (this.frame % 3 === 0) this.audio.gun();
    } else if (this.gunT < 0) this.gunT = 0;
    if (input.rocket && p.rockets > 0 && this.rocketT <= 0) {
      this.rocketT = 0.16;
      p.rockets--;
      const rk = a.racks[Math.floor(Math.random() * a.racks.length)];
      this.rocketSide *= -1;
      _a.set(rk[0] * this.rocketSide, rk[1], rk[2]).applyQuaternion(fm.quat).add(fm.pos);
      _b.set((Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.008, -1).normalize().applyQuaternion(fm.quat);
      const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
      mesh.position.copy(_a); this.scene.add(mesh);
      this.rockets.push({ mesh, pos: mesh.position, vel: fm.vel.clone().addScaledVector(_b, 90), dir: _b.clone(), age: 0, burn: 1.7 });
      this.audio.rocket();
    }
  }

  addBullet(pos, vel, dmg, friendly) {
    if (this.bullets.length >= MAX_BULLETS) this.bullets.shift();
    this.bullets.push({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, age: 0, dmg, friendly, big: dmg > 13, id: this.frame + this.bullets.length });
  }

  damage(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    e.dead = true; e.deadT = 0;
    const K = KINDS[e.kind];
    this.score += K.score;
    this.fx.explosion(e.pos, e.air ? 2 : e.kind === 'bunker' ? 2.4 : 1.5);
    this.audio.explosion();
    if (e.air) { this.remove(e); }
    else e.obj.traverse(o => { if (o.isMesh) o.material = this.wreckMat; });
  }

  hurtPlayer(dmg) {
    const p = this.player;
    if (!p || p.fm.crashed) return;
    p.hp -= dmg; p.hitFlash = 1;
    this.audio.hit();
    if (p.hp <= 0) {
      p.hp = 0; p.fm.crashed = true;
      p.fm.events.push({ type: 'crash', reason: '¡Derribado por fuego enemigo!' });
    }
  }

  // ---- bucle ----
  update(dt, world) {
    this.frame++;
    const p = this.player;
    if (p) p.hitFlash = Math.max(0, p.hitFlash - dt * 2.5);
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) {
        e.deadT += dt;
        if (e.air) { this.enemies.splice(i--, 1); continue; }
        if (e.deadT < 25 && Math.random() < dt * 5) this.fx.puff(e.pos.x + (Math.random() - 0.5) * 3, e.pos.y + 3, e.pos.z + (Math.random() - 0.5) * 3, 1.5, 7, 1, 2 + Math.random() * 2, 3.5, 0.1);
        continue;
      }
      if (!p || p.fm.crashed) continue;
      if (e.air) this.updateFighter(e, dt, world); else this.updateGround(e, dt, world);
    }
    this.updateRockets(dt, world);
    this.updateBullets(dt, world);
  }

  aimAt(from, targetPos, targetVel, speed, out) {
    // solución de puntería con adelanto (una iteración basta para estas distancias)
    const d = _c.copy(targetPos).sub(from).length();
    const t = d / speed;
    return out.copy(targetPos).addScaledVector(targetVel, t).sub(from).normalize();
  }

  updateGround(e, dt, world) {
    const p = this.player, fm = p.fm;
    e.t += dt;
    const dist = e.pos.distanceTo(fm.pos);
    // desplazamiento en patrulla, siguiendo el relieve
    if (e.speed > 0) {
      if (Math.random() < dt * 0.1) e.turnTo = e.heading + (Math.random() - 0.5) * 1.6;
      if (e.turnTo !== undefined) e.heading = lerp(e.heading, e.turnTo, dt * 0.4);
      const nx = e.pos.x - Math.sin(e.heading) * e.speed * dt, nz = e.pos.z - Math.cos(e.heading) * e.speed * dt;
      const h = world.groundHeight(nx, nz);
      if (h > 1.5) { e.pos.x = nx; e.pos.z = nz; e.pos.y = h; } else { e.turnTo = e.heading + 2; }
      e.obj.rotation.y = e.heading;
    }
    if (!e.turret) return;
    const range = e.kind === 'aaa' ? 3400 : 1900;
    if (dist > range) return;
    const speed = e.kind === 'aaa' ? 720 : 430;
    _a.copy(e.pos); _a.y += 2.4;
    const scatter = (e.kind === 'aaa' ? 0.03 : 0.045) / (1 + 0.12 * e.level);
    this.aimAt(_a, fm.pos, fm.vel, speed, _b);
    const yaw = Math.atan2(-_b.x, -_b.z) - e.obj.rotation.y;
    e.turret.rotation.y = yaw;
    e.cool -= dt;
    if (e.cool > 0) return;
    if (e.burst <= 0) e.burst = e.kind === 'aaa' ? 6 + Math.floor(Math.random() * 5) : 1;
    e.burst--;
    e.cool = e.burst > 0 ? 0.11 : (e.kind === 'aaa' ? 2.2 : 3.6) + Math.random() * 1.6;
    _b.x += (Math.random() - 0.5) * scatter; _b.y += (Math.random() - 0.5) * scatter + 0.004; _b.z += (Math.random() - 0.5) * scatter;
    _b.normalize().multiplyScalar(speed);
    this.addBullet(_a, _b, e.kind === 'aaa' ? 6 : 16, false);
    this.fx.glow(_a.x, _a.y, _a.z, 0, 0, 0, 8, 3, 1.5, 2.6, 0.06, 0);
  }

  updateFighter(e, dt, world) {
    const p = this.player, fm = p.fm;
    e.t += dt; e.stateT -= dt;
    const toP = _a.copy(fm.pos).sub(e.pos), dist = toP.length();
    toP.divideScalar(dist || 1);
    const playerFwd = _b.set(0, 0, -1).applyQuaternion(fm.quat);
    const onMySix = -playerFwd.dot(toP) > 0.92 && e.dir.dot(toP) < 0 && dist < 1100;
    if (e.state === 'pursue' && (onMySix || e.hp < 28) && e.stateT <= 0) { e.state = 'evade'; e.stateT = 2.8 + Math.random() * 2; e.breakSign = Math.random() < 0.5 ? 1 : -1; }
    else if (e.state === 'evade' && e.stateT <= 0) { e.state = 'pursue'; e.stateT = 3; }
    const want = _c;
    if (e.state === 'evade') {
      // rotura evasiva: viraje cerrado alrededor de un eje que gira despacio
      _d.crossVectors(e.dir, UP).normalize().multiplyScalar(e.breakSign);
      want.copy(e.dir).addScaledVector(_d, 1.6).addScaledVector(UP, Math.sin(e.t * 1.3) * 0.7).normalize();
    } else {
      this.aimAt(e.pos, fm.pos, fm.vel, BULLET_V * 0.55, want);
    }
    // evitar el terreno: mirar por delante
    const ahead = world.height(e.pos.x + e.dir.x * 500, e.pos.z + e.dir.z * 500);
    const here = world.height(e.pos.x, e.pos.z);
    const clearance = e.pos.y - Math.max(ahead, here, 0);
    if (clearance < 280) want.y = Math.max(want.y, lerp(0.75, 0.05, clamp(clearance / 280, 0, 1)));
    want.normalize();
    const ang = Math.acos(clamp(e.dir.dot(want), -1, 1));
    if (ang > 1e-4) {
      const t = Math.min(1, e.turn * dt / ang);
      _d.crossVectors(e.dir, want);
      const side = _d.y;
      e.dir.lerp(want, t).normalize();
      e.roll = lerp(e.roll, clamp(side * 2.2, -1.25, 1.25), 1 - Math.exp(-dt * 3));
    }
    e.speed = lerp(e.speed, e.state === 'evade' ? 205 : clamp(fm.vel.length() * 1.05 + 25, 125, 195), 1 - Math.exp(-dt * 0.6));
    e.vel.copy(e.dir).multiplyScalar(e.speed);
    e.pos.addScaledVector(e.vel, dt);
    // orientación visual: morro a -Z
    _m.lookAt(ZERO, e.dir, UP);
    _q.setFromRotationMatrix(_m);
    _q2.setFromAxisAngle(Z, e.roll);
    e.obj.quaternion.copy(_q).multiply(_q2);
    // fuego
    e.cool -= dt;
    if (e.state === 'pursue' && dist < 1400 && e.dir.dot(toP) > 0.985 && e.cool <= 0) {
      if (e.burst <= 0) e.burst = 12;
      e.burst--;
      e.cool = e.burst > 0 ? 0.06 : 1.3 + Math.random();
      this.aimAt(e.pos, fm.pos, fm.vel, BULLET_V, _d);
      const sc = 0.022 / (1 + 0.15 * e.level);
      _d.x += (Math.random() - 0.5) * sc; _d.y += (Math.random() - 0.5) * sc; _d.z += (Math.random() - 0.5) * sc;
      _d.normalize().multiplyScalar(BULLET_V).add(e.vel);
      _a.copy(e.pos).addScaledVector(e.dir, 8);
      this.addBullet(_a, _d, 6, false);
    }
  }

  updateRockets(dt, world) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age += dt;
      const burning = r.age < r.burn;
      // con el motor encendido las aletas mantienen la trayectoria; apagado, cae en balística
      if (burning) r.vel.addScaledVector(r.dir, 520 * dt); else r.vel.y -= G * dt;
      const sp = r.vel.length();
      r.vel.multiplyScalar(Math.exp(-0.05 * dt));
      _a.copy(r.pos); // punto anterior
      r.pos.addScaledVector(r.vel, dt);
      r.dir.copy(r.vel).divideScalar(sp || 1);
      _m.lookAt(ZERO, r.dir, UP); r.mesh.quaternion.setFromRotationMatrix(_m);
      if (burning) {
        const n = 3;
        for (let k = 0; k < n; k++) {
          const f = k / n, x = lerp(_a.x, r.pos.x, f), y = lerp(_a.y, r.pos.y, f), z = lerp(_a.z, r.pos.z, f);
          this.fx.glow(x, y, z, 0, 0, 0, 9, 4.5, 1.4, 1.9, 0.14, 0);
        }
        this.fx.puff(r.pos.x, r.pos.y, r.pos.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.55, 2.2, 0.82);
      }
      let boom = r.age > 9;
      if (!boom) {
        const h = Math.max(world.height(r.pos.x, r.pos.z), 0);
        if (r.pos.y <= h + 0.5) boom = true;
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (segHit(_a, r.pos, e.pos, e.r * (e.air ? 1.2 : 1), e.air ? 0 : 1.5)) { boom = true; break; }
        }
      }
      if (boom) {
        this.fx.explosion(r.pos, 0.85);
        this.audio.hit();
        for (const e of this.enemies) {
          if (e.dead) continue;
          const d = e.pos.distanceTo(r.pos);
          if (d < 24) this.damage(e, 130 * (1 - d / 34));
        }
        this.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }
  }

  updateBullets(dt, world) {
    const p = this.player;
    let n = 0;
    const d = this.tracers;
    const near = this.enemies.filter(e => !e.dead);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.age += dt;
      const px = b.x, py = b.y, pz = b.z;
      b.vy -= G * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      let dead = b.age > 3.2;
      if (!dead) {
        _a.set(px, py, pz); _b.set(b.x, b.y, b.z);
        if (b.friendly) {
          for (const e of near) {
            if (e.dead) continue;
            if (segHit(_a, _b, e.pos, e.r, e.air ? 0 : 1.5)) {
              this.fx.spark(_b, 7, 5, 2);
              this.damage(e, b.dmg);
              dead = true; break;
            }
          }
        } else if (p && !p.fm.crashed && segHit(_a, _b, p.fm.pos, p.radius, 0)) {
          this.hurtPlayer(b.dmg);
          this.fx.spark(_b, 8, 3, 1);
          dead = true;
        }
        // relieve: reparto por fotogramas, cada bala se comprueba 1 de cada 3
        if (!dead && (b.y < 0 || (((b.id + this.frame) % 3 === 0) && b.y < 2400 && b.y < world.height(b.x, b.z)))) {
          dead = true;
          if (b.y > -2) {
            const R = Math.random;
            this.fx.spark(_b, 5, 3.5, 1.5, 3);
            if (b.friendly && R() < 0.3) this.fx.puff(b.x, b.y + 1, b.z, 0, 3, 0, 1 + R(), 1.3, 0.45);
          }
        }
      }
      if (dead) { this.bullets.splice(i, 1); continue; }
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      _a.set(b.vx / sp, b.vy / sp, b.vz / sp);
      _q.setFromUnitVectors(Z, _a);
      const len = b.friendly ? (b.big ? 11 : 8) : 9, th = b.big ? 0.42 : 0.3;
      _m.compose(_b.set(b.x, b.y, b.z), _q, _c.set(th, th, len));
      d.setMatrixAt(n, _m);
      if (b.friendly) this.color.setRGB(8, 6.5, 2.2); else this.color.setRGB(9, 1.6, 1.1);
      d.setColorAt(n, this.color);
      n++;
    }
    d.count = n;
    d.instanceMatrix.needsUpdate = true;
    if (d.instanceColor) d.instanceColor.needsUpdate = true;
  }
}

// Intersección segmento-esfera (yOff eleva el centro: las unidades de tierra se apoyan en su base)
function segHit(a, b, c, r, yOff) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - (c.y + yOff), fz = a.z - c.z;
  const aa = dx * dx + dy * dy + dz * dz;
  if (aa < 1e-9) return false;
  const t = clamp(-(fx * dx + fy * dy + fz * dz) / aa, 0, 1);
  const px = fx + dx * t, py = fy + dy * t, pz = fz + dz * t;
  return px * px + py * py + pz * pz <= r * r;
}

export const BULLET_SPEED = BULLET_V;
