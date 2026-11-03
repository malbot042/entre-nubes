// Modelos low-poly procedurales de todas las aeronaves.
// Convención: morro hacia -Z, arriba +Y, derecha +X. Origen ≈ centro de gravedad.
import * as THREE from 'three';
import { AIRCRAFT_BY_ID } from './aircraft.js?v=15';
import { applyLivery, LIVERIES, DECALS, addDecal } from './livery.js?v=15';

const DEG = Math.PI / 180;
const matCache = new Map();

export function mat(color, o = {}) {
  const key = color + '|' + JSON.stringify(o);
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.55, metalness: o.m ?? 0.25, flatShading: true, side: THREE.DoubleSide,
    transparent: !!o.t, opacity: o.op ?? 1, depthWrite: !o.t, emissive: o.e ?? 0x000000,
  });
  matCache.set(key, m);
  return m;
}
export function glassMat(tint = 0x223344, op = 0.32) {
  const key = 'glass' + tint + op;
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshPhongMaterial({ color: tint, transparent: true, opacity: op, shininess: 140, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
  matCache.set(key, m);
  return m;
}

const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; return o; };

function rAt(profile, z) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [za, ra] = profile[i], [zb, rb] = profile[i + 1];
    if (z <= za && z >= zb) return ra + (rb - ra) * ((za - z) / (za - zb || 1));
  }
  return profile[profile.length - 1][1];
}

function latheGeo(profile, seg = 16, sx = 1, sy = 1, yOff = 0) {
  const pts = profile.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.002), -z));
  // fuselajes de pocas caras: la faceta retro se ve incluso a contraluz
  const g = new THREE.LatheGeometry(pts, Math.min(seg, 10));
  g.rotateX(-Math.PI / 2);
  g.scale(sx, sy, 1);
  g.translate(0, yOff, 0);
  return g;
}

function segment(profile, zA, zB) {
  const out = [[zA, rAt(profile, zA)]];
  for (const p of profile) if (p[0] < zA && p[0] > zB) out.push(p);
  out.push([zB, rAt(profile, zB)]);
  return out;
}

// Fuselaje partido en 3 tramos (cola / cabina / morro) para poder ocultar la cabina
function fuselage(c, profile, cutA, cutB, sx, sy, m, seg = 16, yOff = 0, hideFront = false) {
  const zT = profile[0][0], zN = profile[profile.length - 1][0];
  const rear = mesh(latheGeo(segment(profile, zT, cutA), seg, sx, sy, yOff), m);
  const mid = mesh(latheGeo(segment(profile, cutA, cutB), seg, sx, sy, yOff), m);
  const front = mesh(latheGeo(segment(profile, cutB, zN), seg, sx, sy, yOff), m);
  c.grp.add(rear, mid, front);
  c.parts.hide.push(mid);
  if (hideFront) c.parts.hide.push(front);
  return { rear, mid, front };
}

// Placa horizontal (alas, estabilizadores) a partir de una planta [[x,z]]
function plate(pts, thick, y = 0, taper = 0) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, thick / 2, 0);
  if (taper) {
    let mx = 0;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) mx = Math.max(mx, Math.abs(p.getX(i)));
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 - taper * Math.abs(p.getX(i)) / mx));
  }
  g.translate(0, y, 0);
  return g;
}

// Placa vertical (derivas) a partir de un perfil [[z,y]]
function fin(pts, thick) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(thick / 2, 0, 0);
  return g;
}

function pair(c, geo, m, opts = {}) {
  const r = mesh(geo, m);
  const l = mesh(geo, m);
  l.scale.x = -1;
  c.grp.add(r, l);
  if (opts.keep) { r.userData.keep = l.userData.keep = true; }
  return [r, l];
}

function wheel(r, w, m = mat(0x1a1a1a, { r: 0.9, m: 0 })) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), m));
  g.add(mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.05, 10).rotateZ(Math.PI / 2), mat(0xb0b4b8, { m: 0.7, r: 0.3 })));
  return g;
}

// Pata de tren: pivote en (0,0,0), rueda en y=-len
function gearLeg(len, wr, ww, opts = {}) {
  const g = new THREE.Group();
  const sm = mat(0xc8ccd0, { m: 0.8, r: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(opts.strut || 0.06, opts.strut || 0.06, len, 6).translate(0, -len / 2, 0), sm));
  if (opts.twin) {
    const a = wheel(wr, ww); a.position.set(ww * 0.75, -len, 0); g.add(a);
    const b = wheel(wr, ww); b.position.set(-ww * 0.75, -len, 0); g.add(b);
  } else if (opts.tandem) {
    const a = wheel(wr, ww); a.position.set(ww * 0.7, -len, 0); g.add(a);
    const b = wheel(wr, ww); b.position.set(-ww * 0.7, -len, 0); g.add(b);
    const cc = wheel(wr, ww); cc.position.set(ww * 0.7, -len, wr * 2.3); g.add(cc);
    const d = wheel(wr, ww); d.position.set(-ww * 0.7, -len, wr * 2.3); g.add(d);
  } else {
    const a = wheel(wr, ww); a.position.y = -len; g.add(a);
  }
  if (opts.pant) {
    const p = mesh(new THREE.SphereGeometry(1, 10, 6).scale(ww * 0.9, wr * 1.1, wr * 2), opts.pant);
    p.position.y = -len + wr * 0.15; g.add(p);
  }
  return g;
}

function addGear(c, spec, x, attachY, z, wr, ww, axis, up, opts = {}) {
  const len = attachY + spec.gearH - wr;
  const leg = gearLeg(len, wr, ww, opts);
  leg.position.set(x, attachY, z);
  c.grp.add(leg);
  if (!spec.gearFixed && !opts.fixed) c.parts.gear.push({ obj: leg, axis, up });
  leg.traverse(o => { o.userData.keep = true; });
  return leg;
}

function propeller(blades, R, z, y = 0, color = 0x202020, spinnerColor = 0xdddddd) {
  const g = new THREE.Group();
  g.position.set(0, y, z);
  g.add(mesh(new THREE.ConeGeometry(R * 0.16, R * 0.45, 12).rotateX(-Math.PI / 2).translate(0, 0, -R * 0.12), mat(spinnerColor, { m: 0.5 })));
  const bm = mat(color, { r: 0.6 });
  const tip = mat(0xf5d000);
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Group();
    b.add(mesh(new THREE.BoxGeometry(0.15 * R / 1.5 + 0.05, R * 0.9, 0.03).translate(0, R * 0.5, 0), bm));
    b.add(mesh(new THREE.BoxGeometry(0.15 * R / 1.5 + 0.05, R * 0.1, 0.031).translate(0, R * 0.98, 0), tip));
    b.children.forEach(ch => { ch.rotation.y = 0.35; });
    b.rotation.z = (i / blades) * Math.PI * 2;
    g.add(b);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 32), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.z = 0.02;
  g.add(disc);
  g.traverse(o => { o.userData.keep = true; });
  return { group: g, disc };
}

function rotor(blades, R, chord, color = 0x222222) {
  const g = new THREE.Group();
  const bm = mat(color, { r: 0.7 });
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 8), mat(0x444444, { m: 0.6 })));
  for (let i = 0; i < blades; i++) {
    const b = mesh(new THREE.BoxGeometry(R, 0.05, chord).translate(R / 2 + 0.2, 0, 0), bm);
    b.userData.blade = true;
    b.rotation.y = (i / blades) * Math.PI * 2;
    b.rotation.x = 0.04;
    g.add(b);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R + 0.2, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  g.add(disc);
  g.traverse(o => { o.userData.keep = true; });
  return { group: g, disc };
}

function pilotFigure(helmet = 0xdddddd, suit = 0x4d5a3a) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.45, 0.55, 0.28).translate(0, -0.48, 0.05), mat(suit)));
  g.add(mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(helmet, { m: 0.3, r: 0.4 })));
  g.add(mesh(new THREE.SphereGeometry(0.152, 10, 6, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.35, Math.PI * 0.3), mat(0x111111, { m: 0.8, r: 0.1 })));
  return g;
}

function missile(len, r, color = 0xeeeeee) {
  const g = new THREE.Group();
  const m = mat(color, { m: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(r, r, len, 8).rotateX(Math.PI / 2), m));
  g.add(mesh(new THREE.ConeGeometry(r, r * 4, 8).rotateX(-Math.PI / 2).translate(0, 0, -len / 2 - r * 2), mat(0x8a8a7a)));
  for (let i = 0; i < 4; i++) {
    const f = mesh(new THREE.BoxGeometry(0.01, r * 3, r * 4).translate(0, r * 2, len / 2 - r * 2), m);
    f.rotation.z = i * Math.PI / 2 + Math.PI / 4;
    g.add(f);
  }
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.12, len * 0.5).translate(0, r + 0.06, 0), mat(0x666666)));
  return g;
}

function navLights(c, left, right, tail) {
  const mk = (p, col) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: col }));
    s.position.copy(p); s.userData.keep = true; c.grp.add(s);
    c.parts.navLights.push({ pos: p.clone(), color: col });
  };
  mk(left, 0xff2020); mk(right, 0x20ff40); if (tail) mk(tail, 0xffffff);
  c.parts.strobes.push(left.clone(), right.clone());
}

function canopy(c, { z, len, w, h, y }, tint = 0x203040, frame = true, frameColor = 0x333333) {
  const g = mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(w, h, len / 2), glassMat(tint, 0.38));
  g.position.set(0, y, z);
  g.castShadow = false;
  c.grp.add(g);
  c.parts.hide.push(g);
  if (frame) {
    const fr = mesh(new THREE.TorusGeometry(1, 0.035, 4, 16, Math.PI).scale(w, h, 1), mat(frameColor));
    fr.position.set(0, y, z - len * 0.18);
    c.grp.add(fr); c.parts.hide.push(fr);
  }
  return g;
}

function addPilot(c, spec, extra = [], helmet = 0xdddddd) {
  const p = pilotFigure(helmet);
  p.position.set(spec.eye[0], spec.eye[1] - 0.05, spec.eye[2] + 0.05);
  c.grp.add(p); c.parts.hide.push(p);
  for (const e of extra) {
    const q = pilotFigure(helmet);
    q.position.set(e[0], e[1], e[2]);
    c.grp.add(q); c.parts.hide.push(q);
  }
}

function roundel(colors, r) {
  const g = new THREE.Group();
  colors.forEach((col, i) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r * (1 - i / colors.length), 20).rotateX(-Math.PI / 2), mat(col, { r: 0.8, m: 0 }));
    d.position.y = i * 0.002;
    g.add(d);
  });
  return g;
}

function star(r, color = 0xcc1111) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.4 : r;
    i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return new THREE.Mesh(new THREE.ShapeGeometry(s), mat(color, { r: 0.8, m: 0 }));
}

function newCtx(spec) {
  return {
    grp: new THREE.Group(), spec,
    parts: { hide: [], gear: [], props: [], rotors: [], tailRotors: [], surfaces: [], ab: [], navLights: [], strobes: [], sweep: [], discs: [], exhaust: [] },
  };
}

// Superficie de control: devuelve pivote al que añadir geometría
function surface(c, pos, axis, input, max, geo, m) {
  const p = new THREE.Group();
  p.position.copy(pos);
  const s = mesh(geo, m);
  p.add(s);
  p.userData.keep = true; s.userData.keep = true;
  c.grp.add(p);
  c.parts.surfaces.push({ obj: p, axis, input, max });
  return p;
}

// =================== CAZAS ===================
function buildFighter(spec, o) {
  const c = newCtx(spec);
  const body = mat(o.color, { m: 0.35, r: 0.5 });
  const dark = mat(o.dark, { m: 0.35, r: 0.55 });
  const metal = mat(0x55585c, { m: 0.85, r: 0.35 });
  const tailM = o.tailColor ? mat(o.tailColor, { m: 0.3, r: 0.45 }) : body;
  const intakeM = o.intakeColor ? mat(o.intakeColor, { m: 0.25, r: 0.4 }) : body;
  fuselage(c, o.profile, o.cut[0], o.cut[1], o.sx, o.sy, body, 16, o.yOff || 0);
  // radomo oscuro
  if (o.radome) {
    const n = o.profile[o.profile.length - 1][0];
    const rd = mesh(latheGeo(segment(o.profile, n + o.radome, n), 16, o.sx, o.sy, o.yOff || 0), dark);
    rd.scale.setScalar(1.01); c.grp.add(rd);
  }
  canopy(c, o.canopy, o.tint ?? 0x2a3a48, o.frame !== false, 0x2a2d30);
  // Alas
  if (o.glove) pair(c, plate(o.glove, 0.3, o.wingY, 0), body, { keep: true });
  if (o.swing) {
    for (const sx of [1, -1]) {
      const piv = new THREE.Group();
      piv.position.set(sx * o.swing.pivot[0], o.wingY, o.swing.pivot[1]);
      const w = mesh(plate(o.swing.wing, 0.16, 0, 0.5), body);
      w.userData.keep = true;
      if (sx < 0) w.scale.x = -1;
      piv.add(w); piv.userData.keep = true;
      c.grp.add(piv);
      c.parts.sweep.push({ obj: piv, side: sx });
    }
  } else {
    pair(c, plate(o.wing, o.wingT || 0.2, o.wingY, 0.55), body, { keep: true });
  }
  // Tomas de aire
  for (const it of o.intakes || []) {
    for (const sx of it.x === 0 ? [1] : [1, -1]) {
      const g = mesh(new THREE.BoxGeometry(it.w, it.h, it.len), intakeM);
      g.position.set(sx * it.x, it.y, it.z); g.rotation.z = (it.rz || 0) * sx; c.grp.add(g);
      g.userData.keep = it.keep;
      const mouth = mesh(new THREE.PlaneGeometry(it.w * 0.85, it.h * 0.8), mat(0x0a0a0a));
      mouth.position.set(sx * it.x, it.y, it.z - it.len / 2 - 0.01); mouth.rotation.z = (it.rz || 0) * sx; c.grp.add(mouth);
    }
  }
  // Góndolas de motor separadas
  for (const n of o.nacelles || []) {
    for (const sx of [1, -1]) {
      const g = mesh(latheGeo([[n.z1, n.r * 0.85], [n.z1 - 1, n.r], [n.z0, n.r]], 12, 1, n.sy || 1), body);
      g.position.set(sx * n.x, n.y, 0); g.userData.keep = true; c.grp.add(g);
    }
  }
  if (o.pancake) {
    const p = mesh(plate(o.pancake, 0.45, o.pancakeY || -0.15), body);
    p.userData.keep = true; c.grp.add(p);
  }
  // Derivas
  for (const t of o.tails) {
    for (const sx of t.x === 0 ? [1] : [1, -1]) {
      const g = new THREE.Group();
      g.position.set(sx * t.x, t.y, 0);
      g.rotation.z = -sx * (t.cant || 0) * DEG;
      const f = mesh(fin(t.shape, 0.12), tailM);
      f.userData.keep = true; g.add(f);
      for (const d of o.tailArt || []) addDecal(g, d.tex, d.w, d.h, [0.068, d.y, d.z], 'side', { mirror: true, flipText: d.flip !== false });
      // timón
      const last = t.shape[t.shape.length - 1], top = t.shape[2];
      const rp = new THREE.Group();
      rp.position.set(0, 0.15, last[0] - 0.02);
      rp.add(mesh(fin([[0, 0], [top[0] - last[0] + 0.05, top[1] - 0.55], [top[0] - last[0] + 0.5, top[1] - 0.6], [0.55, 0]], 0.08), dark));
      g.add(rp);
      g.userData.keep = true; rp.userData.keep = true; rp.children[0].userData.keep = true;
      c.parts.surfaces.push({ obj: rp, axis: 'y', input: 'yaw', max: 0.35 });
      if (o.insignia) {
        const s = o.insignia();
        s.position.set(0.075, top[1] * 0.55, (t.shape[1][0] + last[0]) / 2); s.rotation.y = Math.PI / 2;
        g.add(s);
        const s2 = o.insignia(); s2.position.set(-0.075, top[1] * 0.55, (t.shape[1][0] + last[0]) / 2); s2.rotation.y = -Math.PI / 2; g.add(s2);
      }
      c.grp.add(g);
    }
  }
  // Estabilizadores monobloque
  for (const sx of [1, -1]) {
    const p = new THREE.Group();
    p.position.set(0, o.hstabY, o.hstabPivot);
    const g = mesh(plate(o.hstab.map(([x, z]) => [x, z - o.hstabPivot]), 0.12, 0, 0.4), body);
    if (sx < 0) g.scale.x = -1;
    g.userData.keep = true;
    p.add(g); p.userData.keep = true;
    p.rotation.z = -sx * (o.hstabAnhedral || 0);
    c.grp.add(p);
    c.parts.surfaces.push({ obj: p, axis: 'x', input: 'pitch', max: 0.25, rollMix: sx * 0.12 });
  }
  // Toberas y postcombustión
  for (const nz of o.nozzles) {
    for (const sx of nz.x === 0 ? [1] : [1, -1]) {
      const geo = nz.box
        ? new THREE.BoxGeometry(nz.box[0], nz.box[1], nz.len)
        : new THREE.CylinderGeometry(nz.r * 0.85, nz.r, nz.len, 14, 1, true).rotateX(Math.PI / 2);
      const n = mesh(geo, metal);
      n.position.set(sx * nz.x, nz.y, nz.z + nz.len / 2); n.userData.keep = true; c.grp.add(n);
      const inner = mesh(new THREE.CircleGeometry((nz.r || nz.box[1] / 2) * 0.8, 12), mat(0x220d00, { e: 0x331100 }));
      inner.position.set(sx * nz.x, nz.y, nz.z + 0.2); c.grp.add(inner);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry((nz.r || nz.box[1] / 2) * 0.8, 1, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a3a).multiplyScalar(3.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      flame.position.set(sx * nz.x, nz.y, nz.z + nz.len);
      flame.userData.keep = true;
      c.grp.add(flame);
      const core = new THREE.Mesh(
        new THREE.ConeGeometry((nz.r || nz.box[1] / 2) * 0.5, 1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9ab8ff).multiplyScalar(4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      core.position.copy(flame.position); core.userData.keep = true; c.grp.add(core);
      c.parts.ab.push(flame, core);
      c.parts.exhaust.push(new THREE.Vector3(sx * nz.x, nz.y, nz.z + nz.len + 0.4));
    }
  }
  // Morro: tubo pitot
  const nzZ = o.profile[o.profile.length - 1][0];
  const pit = mesh(new THREE.CylinderGeometry(0.02, 0.03, o.pitot || 0.8, 5).rotateX(Math.PI / 2), metal);
  pit.position.set(0, o.yOff || 0, nzZ - (o.pitot || 0.8) / 2); c.grp.add(pit);
  // Misiles
  for (const m of o.missiles || []) {
    for (const sx of [1, -1]) {
      const ms = missile(m.len || 3, m.r || 0.08, m.color);
      ms.position.set(sx * m.x, m.y, m.z);
      ms.traverse(q => { q.userData.keep = true; });
      if (m.rail) ms.rotation.z = sx * Math.PI / 2;
      c.grp.add(ms);
    }
  }
  if (o.extras) o.extras(c, body, dark, metal);
  // Tren
  addGear(c, spec, 0, o.gear.attachY, o.gear.noseZ, 0.3, 0.18, 'x', -1.6, { strut: 0.07, twin: o.gear.noseTwin });
  for (const sx of [1, -1]) addGear(c, spec, sx * o.gear.mainX, o.gear.attachY, o.gear.mainZ, 0.42, 0.25, 'z', -sx * 1.55, { strut: 0.09 });
  const span = o.navSpan;
  navLights(c, new THREE.Vector3(-span, o.wingY, o.navZ), new THREE.Vector3(span, o.wingY, o.navZ), null);
  addPilot(c, spec, o.secondSeat ? [o.secondSeat] : [], o.helmet ?? 0xe8e8e8);
  c.parts.landingLight = new THREE.Vector3(0, o.gear.attachY - 0.4, o.gear.noseZ - 0.2);
  return c;
}


function buildF16(spec) {
  return buildFighter(spec, {
    color: 0x8f989f, dark: 0x6e767d, radome: 1.5,
    profile: [[7.4, 0.5], [6.5, 0.62], [4.5, 0.8], [1.5, 0.86], [-1.5, 0.83], [-3.2, 0.73], [-4.8, 0.58], [-6.2, 0.42], [-7.2, 0.2], [-7.6, 0.04]],
    cut: [-2.7, -5.7], sx: 1.15, sy: 0.9,
    canopy: { z: -4.3, len: 3.6, w: 0.5, h: 0.66, y: 0.5 }, frame: false, tint: 0x5a4a20,
    wing: [[0.55, -4.9], [0.95, -2.4], [1.15, -0.6], [4.65, 2.4], [4.75, 2.4], [4.75, 3.4], [1.0, 3.6], [0.55, 3.6]], wingY: -0.05,
    tails: [{ x: 0, y: 0, shape: [[3.6, 0.6], [5.9, 3.3], [6.6, 3.3], [7.0, 0.6]] }],
    hstab: [[0.6, 5.1], [2.9, 6.4], [2.9, 7.2], [0.6, 7.4]], hstabPivot: 6.3, hstabY: -0.1, hstabAnhedral: 0.1,
    nozzles: [{ x: 0, y: 0, z: 7.3, r: 0.52, len: 1.0 }],
    intakes: [{ x: 0, y: -0.78, z: -1.6, w: 1.0, h: 0.7, len: 4.4, keep: true }],
    missiles: [{ x: 4.9, y: -0.05, z: 2.6, len: 2.9, r: 0.065, rail: true }, { x: 3.2, y: -0.45, z: 1.5, len: 3.6, r: 0.09 }, { x: 2.1, y: -0.55, z: 1.0, len: 3.6, r: 0.09, color: 0xbab79d }],
    gear: { attachY: -0.55, noseZ: -3.6, mainX: 1.15, mainZ: 0.9 },
    navSpan: 4.75, navZ: 2.4,
    tailArt: [
      { tex: DECALS.text('HL', '#3b4147', { font: 'bold 190px Impact, "Arial Black", sans-serif' }), w: 1.5, h: 0.38, y: 1.55, z: 6.05 },
      { tex: DECALS.checker('#1d3f8f', '#e9edf0', 10, 2), w: 0.95, h: 0.19, y: 2.85, z: 6.2 },
      { tex: DECALS.text('AF 86-0272', '#3b4147', { font: 'bold 120px "Share Tech Mono", monospace' }), w: 1.1, h: 0.28, y: 1.0, z: 6.3 },
    ],
    extras: (c, body) => {
      addDecal(c.grp, DECALS.usInsignia(true), 1.25, 0.62, [0.9, 0.32, 1.2], 'side', { mirror: true });
      addDecal(c.grp, DECALS.usInsignia(true), 1.4, 0.7, [-3.0, 0.1, 2.3], 'up');
      addDecal(c.grp, DECALS.rescue(), 0.25, 0.25, [0.78, 0.35, -4.9], 'side', { mirror: true });
      for (const sx of [1, -1]) {
        const vf = mesh(fin([[0, 0], [1.2, -0.6], [1.7, -0.6], [1.6, 0]], 0.06), body);
        vf.position.set(sx * 0.65, -0.5, 4.6); vf.rotation.z = sx * 0.4; vf.userData.keep = true; c.grp.add(vf);
      }
    },
  });
}

function buildF18(spec) {
  return buildFighter(spec, {
    color: 0x0f2c6e, dark: 0x0f2c6e, intakeColor: 0xf2c315, radome: 1.6,
    profile: [[8.6, 0.55], [7.2, 0.75], [4.0, 0.9], [1.0, 0.95], [-2.0, 0.9], [-4.0, 0.75], [-6.0, 0.55], [-7.6, 0.3], [-8.4, 0.04]],
    cut: [-3.7, -6.7], sx: 1.25, sy: 0.85,
    canopy: { z: -5.4, len: 3.3, w: 0.55, h: 0.62, y: 0.5 },
    wing: [[0.7, -6.6], [1.3, -2.5], [1.5, -0.4], [6.0, 2.4], [6.1, 2.4], [6.1, 3.8], [1.5, 4.4], [0.7, 4.4]], wingY: 0.1,
    tails: [{ x: 1.15, y: 0.4, cant: 20, shape: [[2.4, 0.3], [4.6, 3.2], [5.6, 3.2], [6.1, 0.3]] }],
    hstab: [[1.0, 6.6], [3.5, 7.7], [3.5, 8.5], [1.0, 8.8]], hstabPivot: 7.5, hstabY: -0.05,
    nozzles: [{ x: 0.55, y: -0.05, z: 8.5, r: 0.46, len: 0.9 }],
    intakes: [{ x: 1.2, y: -0.4, z: -1.0, w: 0.75, h: 0.85, len: 4.2, keep: true }],
    missiles: [{ x: 6.25, y: 0.1, z: 3.0, len: 2.9, r: 0.065, rail: true }, { x: 4.0, y: -0.35, z: 1.8, len: 3.6, r: 0.09 }, { x: 2.6, y: -0.45, z: 1.0, len: 3.0, r: 0.13, color: 0x9a9a8a }],
    gear: { attachY: -0.6, noseZ: -5.2, mainX: 1.6, mainZ: 1.6, noseTwin: true },
    navSpan: 6.1, navZ: 2.4,
    tailArt: [
      { tex: DECALS.text('1', '#f2c315', { font: 'bold 230px Impact, "Arial Black", sans-serif', w: 256, h: 256, stroke: '#0a1d4d' }), w: 1.2, h: 1.2, y: 1.7, z: 4.75 },
      { tex: DECALS.stripe('#f2c315', '#0a1d4d'), w: 1.3, h: 0.14, y: 2.95, z: 4.95 },
    ],
    extras: (c) => {
      addDecal(c.grp, DECALS.text('U.S. NAVY', '#f2c315'), 2.0, 0.5, [0.92, 0.36, -2.6], 'side', { mirror: true });
      addDecal(c.grp, DECALS.text('BLUE ANGELS', '#f2c315'), 3.4, 0.85, [-3.6, 0.27, 2.0], 'up');
      addDecal(c.grp, DECALS.stripe('#f2c315', '#0a1d4d'), 4.6, 0.32, [0, 0.83, -1.0], 'up', { rotZ: Math.PI / 2 });
      addDecal(c.grp, DECALS.rescue(), 0.25, 0.25, [0.86, 0.38, -6.0], 'side', { mirror: true });
    },
  });
}

function buildF14(spec) {
  return buildFighter(spec, {
    color: 0xa9b2ba, dark: 0x838c94, radome: 2.0, tailColor: 0x16171a,
    tailArt: [
      { tex: DECALS.jollyRoger(), w: 1.65, h: 1.65, y: 1.95, z: 7.35 },
      { tex: DECALS.stripe('#f2c315', '#111'), w: 1.15, h: 0.16, y: 3.25, z: 7.75 },
      { tex: DECALS.text('AJ', '#f2efe6', { font: 'bold 190px Impact, "Arial Black", sans-serif' }), w: 1.2, h: 0.3, y: 0.75, z: 7.0 },
    ],
    profile: [[8.0, 0.35], [6.5, 0.5], [4.0, 0.6], [1.5, 0.75], [-1.0, 0.85], [-3.5, 0.86], [-5.5, 0.76], [-7.5, 0.56], [-8.8, 0.3], [-9.6, 0.04]],
    cut: [-3.6, -7.8], sx: 1.15, sy: 0.95, yOff: 0.1,
    canopy: { z: -5.6, len: 4.6, w: 0.6, h: 0.72, y: 0.62 },
    glove: [[0.8, -7.0], [2.7, -1.8], [3.0, -0.2], [3.0, 2.4], [0.8, 3.2]], wingY: 0.15,
    swing: { pivot: [2.75, -0.4], wing: [[0, -0.9], [7.6, 0.4], [7.6, 1.8], [0, 2.4]] },
    pancake: [[-2.1, -2.5], [2.1, -2.5], [2.1, 8.5], [-2.1, 8.5]], pancakeY: -0.25,
    nacelles: [{ x: 1.45, y: -0.25, z0: 8.4, z1: -2.6, r: 0.62 }],
    intakes: [{ x: 1.5, y: -0.28, z: -3.2, w: 1.05, h: 1.1, len: 2.0, keep: true }],
    tails: [{ x: 1.5, y: 0.1, cant: 5, shape: [[4.4, 0.3], [7.2, 3.5], [8.1, 3.5], [8.4, 0.3]] }],
    hstab: [[1.8, 6.3], [4.4, 8.3], [4.4, 9.3], [1.8, 9.4]], hstabPivot: 8.0, hstabY: -0.2,
    nozzles: [{ x: 1.45, y: -0.25, z: 8.4, r: 0.56, len: 1.1 }],
    missiles: [{ x: 0.65, y: -0.85, z: -0.5, len: 3.9, r: 0.19, color: 0xf0f0f0 }, { x: 0.65, y: -0.85, z: 4.0, len: 3.9, r: 0.19, color: 0xf0f0f0 }, { x: 2.4, y: -0.4, z: -0.8, len: 3.6, r: 0.1 }],
    gear: { attachY: -0.5, noseZ: -6.4, mainX: 2.6, mainZ: 1.0, noseTwin: true },
    navSpan: 3.0, navZ: 0.5, secondSeat: [0, 1.2, -4.75],
    extras: (c) => {
      const t = mesh(new THREE.BoxGeometry(0.4, 0.15, 3), mat(0x222222)); t.position.set(0, -0.45, -6.0); c.grp.add(t);
      addDecal(c.grp, DECALS.usInsignia(false), 1.4, 0.7, [2.04, -0.28, -3.2], 'side', { mirror: true });
      addDecal(c.grp, DECALS.text('NAVY', '#16171a'), 1.7, 0.42, [2.08, -0.18, 5.0], 'side', { mirror: true });
      addDecal(c.grp, DECALS.text('201', '#16171a', { font: 'bold 200px Impact, "Arial Black", sans-serif' }), 0.75, 0.19, [0.71, 0.12, -7.0], 'side', { mirror: true });
      addDecal(c.grp, DECALS.usInsignia(false), 1.3, 0.65, [-1.9, 0.32, 0.4], 'up');
      addDecal(c.grp, DECALS.rescue(), 0.25, 0.25, [0.92, 0.55, -6.9], 'side', { mirror: true });
    },
  });
}

// =================== HELICÓPTEROS ===================
function buildHeli(spec, o) {
  const c = newCtx(spec);
  const body = mat(o.color, { m: o.metal ?? 0.25, r: 0.55 });
  const accent = mat(o.accent ?? o.color);
  const dark = mat(0x222222, { m: 0.5 });
  const pod = mesh(latheGeo(o.pod, o.podSeg || 18, o.podSx, o.podSy, o.podY), body);
  c.grp.add(pod); c.parts.hide.push(pod);
  // Botalón de cola
  const boom = mesh(latheGeo(o.boom, o.boomSeg || 10, 1, 1, o.boomY), body);
  boom.userData.keep = true; c.grp.add(boom);
  // Cristales
  if (o.glass) o.glass(c, glassMat(0x18303e, 0.45), body);
  // Rotor principal
  const mast = mesh(new THREE.CylinderGeometry(0.12, 0.15, o.mastH, 8), mat(0x555555, { m: 0.7 }));
  mast.position.set(0, o.rotorY - o.mastH / 2, o.rotorZ); mast.userData.keep = true; c.grp.add(mast);
  const r = rotor(spec.blades, spec.rotorR, o.chord || 0.5, o.bladeColor ?? 0x1e1e1e);
  r.group.position.set(0, o.rotorY, o.rotorZ);
  c.grp.add(r.group); c.parts.rotors.push(r.group); c.parts.discs.push(r.disc);
  // Rotor de cola
  const tr = rotor(o.tailBlades || 2, o.tailR, 0.2, 0x333333);
  const trh = new THREE.Group(); trh.position.set(o.tailRotor[0], o.tailRotor[1], o.tailRotor[2]); trh.rotation.z = Math.PI / 2; trh.add(tr.group);
  c.grp.add(trh); c.parts.tailRotors.push(tr.group); c.parts.discs.push(tr.disc);
  tr.disc.material = tr.disc.material.clone();
  // Deriva y estabilizador
  const vf = mesh(fin(o.fin, 0.12), accent); vf.userData.keep = true; c.grp.add(vf);
  if (o.hstab) pair(c, plate(o.hstab, 0.08, o.hstabY), body, { keep: true });
  if (o.extras) o.extras(c, body, accent, dark);
  navLights(c, o.nav[0], o.nav[1], o.nav[2]);
  addPilot(c, spec, o.crew || [], o.helmet ?? 0x3a3a3a);
  c.parts.landingLight = o.light;
  return c;
}

function buildApache(spec) {
  return buildHeli(spec, {
    color: 0x3c4433, metal: 0.15,
    pod: [[1.8, 0.45], [0.6, 0.78], [-0.6, 0.82], [-2.0, 0.72], [-3.2, 0.52], [-4.0, 0.3], [-4.3, 0.12]], podSx: 0.72, podSy: 1.15, podY: 0.25,
    boom: [[8.8, 0.18], [5, 0.3], [1.5, 0.48], [1.0, 0.4]], boomY: 0.55,
    rotorY: 2.45, rotorZ: -0.6, mastH: 1.0, chord: 0.55,
    tailRotor: [-0.32, 1.95, 8.55], tailR: 1.45, tailBlades: 4,
    fin: [[7.3, 0.4], [8.3, 2.4], [8.85, 2.4], [8.85, 0.3]],
    hstab: [[0, 7.7], [1.7, 7.8], [1.7, 8.5], [0, 8.6]], hstabY: 0.45,
    nav: [new THREE.Vector3(-2.6, 0.3, -0.5), new THREE.Vector3(2.6, 0.3, -0.5), new THREE.Vector3(0, 2.4, 8.8)],
    crew: [[0, 0.82, -2.75]],
    light: new THREE.Vector3(0, -0.3, -3.5),
    glass: (c, gm, body) => {
      // cabina escalonada facetada
      const front = mesh(fin([[-3.6, 0.45], [-3.15, 1.05], [-2.15, 1.12], [-2.15, 0.45]], 0.95), gm);
      const rear = mesh(fin([[-2.2, 0.8], [-1.9, 1.48], [-0.75, 1.52], [-0.6, 0.8]], 1.0), gm);
      c.grp.add(front, rear); c.parts.hide.push(front, rear);
      for (const g of [front, rear]) g.castShadow = false;
      const frames = mat(0x2c3326);
      for (const z of [-3.15, -2.15, -1.9, -0.75]) {
        const f = mesh(new THREE.BoxGeometry(1.02, 0.05, 0.05), frames);
        f.position.set(0, z < -2.1 && z > -2.2 ? 1.12 : z < -3 ? 1.05 : 1.5, z); c.grp.add(f); c.parts.hide.push(f);
      }
      // carenado del motor
      const top = mesh(fin([[-0.6, 0.6], [-0.5, 1.45], [1.6, 1.4], [2.4, 0.8]], 0.9), body);
      c.grp.add(top); top.userData.keep = true;
    },
    extras: (c, body, accent, dark) => {
      for (const sx of [1, -1]) {
        // góndolas motor
        const n = mesh(latheGeo([[2.4, 0.22], [1.6, 0.38], [-0.4, 0.4], [-0.7, 0.3]], 10), body);
        n.position.set(sx * 0.82, 1.05, 0); n.userData.keep = true; c.grp.add(n);
        const ex = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 8).rotateX(Math.PI / 2), mat(0x222222, { m: 0.8 }));
        ex.position.set(sx * 0.95, 1.05, 2.5); ex.userData.keep = true; c.grp.add(ex);
        // alas cortas
        const w = mesh(plate([[0.4, -0.7], [2.5, -0.55], [2.5, 0.35], [0.4, 0.5]], 0.14, 0.2), body);
        w.scale.x = sx; w.userData.keep = true; c.grp.add(w);
        // pod de cohetes y hellfires
        const pod = mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.7, 10).rotateX(Math.PI / 2), mat(0x353b2c));
        pod.position.set(sx * 1.4, -0.25, -0.1); pod.userData.keep = true; c.grp.add(pod);
        const face = mesh(new THREE.CircleGeometry(0.26, 10), dark); face.position.set(sx * 1.4, -0.25, -0.96); face.userData.keep = true; c.grp.add(face);
        for (let i = 0; i < 4; i++) {
          const m = missile(1.6, 0.09, 0x4a4f3a);
          m.position.set(sx * (2.2 + (i % 2) * 0.24), -0.15 - Math.floor(i / 2) * 0.24, -0.1);
          m.traverse(q => q.userData.keep = true); c.grp.add(m);
        }
      }
      // cañón y sensor TADS
      const gun = new THREE.Group();
      gun.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), dark));
      gun.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 6).rotateX(Math.PI / 2).translate(0, 0, -0.8), dark));
      gun.position.set(0, -0.45, -2.6); gun.traverse(q => q.userData.keep = true); c.grp.add(gun);
      const tads = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 10), dark);
      tads.position.set(0, 0.05, -4.25); c.grp.add(tads);
      // tren fijo
      for (const sx of [1, -1]) {
        const leg = gearLeg(0.95, 0.32, 0.2, { strut: 0.07 });
        leg.position.set(sx * 1.15, -0.06, -1.7); c.grp.add(leg); leg.traverse(q => q.userData.keep = true);
      }
      const tw = gearLeg(0.5, 0.18, 0.12, { strut: 0.05 });
      tw.position.set(0, -0.45 + 0.02, 7.6); c.grp.add(tw); tw.traverse(q => q.userData.keep = true);
      addDecal(c.grp, DECALS.text('U.S. ARMY', '#15180f'), 1.7, 0.42, [0.37, 0.55, 3.8], 'side', { mirror: true });
      addDecal(c.grp, DECALS.text('0-23447', '#15180f', { font: 'bold 140px "Share Tech Mono", monospace' }), 0.85, 0.21, [0.07, 1.15, 8.35], 'side', { mirror: true });
      addDecal(c.grp, DECALS.rescue(), 0.22, 0.22, [0.62, 0.65, -1.6], 'side', { mirror: true });
    },
  });
}

// =================== LHX (Comanche): helicóptero furtivo facetado ===================
function buildLHX(spec) {
  const c = buildHeli(spec, {
    color: 0x3b3f44, metal: 0.25, podSeg: 6, boomSeg: 6,
    pod: [[2.2, 0.42], [0.8, 0.76], [-0.6, 0.8], [-2.2, 0.62], [-3.4, 0.36], [-4.0, 0.1]], podSx: 0.78, podSy: 1.1, podY: 0.25,
    boom: [[7.4, 0.28], [5.0, 0.34], [2.0, 0.5], [1.6, 0.45]], boomY: 0.6,
    rotorY: 2.05, rotorZ: -0.55, mastH: 0.75, chord: 0.42, bladeColor: 0x2a2d31,
    tailRotor: [0, 1.15, 7.75], tailR: 0.52, tailBlades: 8,
    fin: [[6.6, 0.3], [7.3, 2.35], [8.3, 2.55], [8.55, 0.15]],
    hstab: [[0, 8.0], [1.25, 8.15], [1.25, 8.6], [0, 8.7]], hstabY: 2.45,
    nav: [new THREE.Vector3(-1.25, 2.45, 8.4), new THREE.Vector3(1.25, 2.45, 8.4), new THREE.Vector3(0, 2.6, 8.4)],
    crew: [[0, 0.75, -2.65]], helmet: 0x2a2c2f,
    light: new THREE.Vector3(0, -0.35, -3.2),
    glass: (c, gm, body) => {
      const front = mesh(fin([[-3.45, 0.5], [-2.95, 1.0], [-2.05, 1.07], [-2.05, 0.5]], 0.86), gm);
      const rear = mesh(fin([[-2.1, 0.75], [-1.85, 1.3], [-0.8, 1.34], [-0.65, 0.75]], 0.92), gm);
      c.grp.add(front, rear); c.parts.hide.push(front, rear);
      for (const g of [front, rear]) g.castShadow = false;
      const top = mesh(fin([[-0.7, 0.62], [-0.45, 1.32], [1.9, 1.22], [2.7, 0.72]], 0.98), body);
      top.userData.keep = true; c.grp.add(top);
      // carenado del buje del rotor
      const hub = mesh(new THREE.CylinderGeometry(0.35, 0.55, 0.35, 6), body);
      hub.position.set(0, 1.85, -0.55); hub.userData.keep = true; c.grp.add(hub);
    },
    extras: (c, body, accent, dark) => {
      // anillo del fenestron integrado en la deriva
      const ring = mesh(new THREE.TorusGeometry(0.6, 0.12, 6, 16).rotateY(Math.PI / 2), body);
      ring.position.set(0, 1.15, 7.75); ring.userData.keep = true; c.grp.add(ring);
      // bodegas de armas laterales (puertas) y torreta del cañón
      for (const sx of [1, -1]) {
        const door = mesh(new THREE.BoxGeometry(0.04, 0.38, 1.7), mat(0x34383d, { m: 0.2, r: 0.65 }));
        door.position.set(sx * 0.6, -0.08, -0.6); door.rotation.z = sx * 0.25; door.userData.keep = true; c.grp.add(door);
        const ex = mesh(new THREE.BoxGeometry(0.22, 0.12, 0.6), mat(0x1c1d20, { m: 0.6 }));
        ex.position.set(sx * 0.42, 1.12, 2.6); ex.userData.keep = true; c.grp.add(ex);
      }
      const gun = new THREE.Group();
      gun.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.25, 6), dark));
      for (let i = 0; i < 3; i++) gun.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 5).rotateX(Math.PI / 2).translate(Math.cos(i * 2.1) * 0.06, -0.08 + Math.sin(i * 2.1) * 0.06, -0.6), dark));
      gun.position.set(0, -0.38, -2.9); gun.traverse(q => q.userData.keep = true); c.grp.add(gun);
      const sensor = mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.32, 6).rotateX(Math.PI / 2), dark);
      sensor.position.set(0, 0.05, -4.05); c.grp.add(sensor);
      addDecal(c.grp, DECALS.text('LHX', '#575c62', { font: 'bold 200px Impact, "Arial Black", sans-serif' }), 0.9, 0.23, [0.44, 0.62, 3.6], 'side', { mirror: true });
      addDecal(c.grp, DECALS.text('94-0327', '#575c62', { font: 'bold 140px "Share Tech Mono", monospace' }), 0.75, 0.19, [0.14, 1.95, 7.8], 'side', { mirror: true });
    },
  });
  // tren retráctil
  addGear(c, spec, 0, -0.35, 6.4, 0.16, 0.1, 'x', 1.4, { strut: 0.04 });
  for (const sx of [1, -1]) addGear(c, spec, sx * 0.85, -0.35, -1.3, 0.24, 0.15, 'x', -1.5, { strut: 0.06 });
  return c;
}

// =================== A-10 THUNDERBOLT II ===================
// Ala recta y baja, dobles derivas, motores en góndola sobre la cola y cañón GAU-8 en el morro.
function buildA10(spec) {
  const c = newCtx(spec);
  const body = mat(0x46533b, { m: 0.1, r: 0.7 }), dark = mat(0x363c33, { m: 0.1, r: 0.75 }), metal = mat(0x4c4f52, { m: 0.85, r: 0.35 });
  const prof = [[8.1, 0.2], [6.2, 0.52], [3.0, 0.8], [0.0, 0.92], [-3.0, 0.92], [-4.6, 0.84], [-6.2, 0.62], [-7.6, 0.36], [-8.0, 0.16]];
  fuselage(c, prof, -3.5, -6.0, 1.0, 1.0, body, 8);
  // bañera de titanio: faceta angulosa bajo la cabina
  const tub = mesh(new THREE.BoxGeometry(1.45, 0.75, 3.6), dark); tub.position.set(0, -0.45, -4.6); tub.userData.keep = true; c.grp.add(tub);
  canopy(c, { z: -4.8, len: 2.6, w: 0.56, h: 0.68, y: 0.56 }, 0x223344, true, 0x2c2f33);
  // Ala recta
  const wing = [[0.7, -1.7], [3.4, -1.7], [8.8, -1.2], [8.8, 0.35], [3.4, 0.75], [0.7, 0.75]];
  pair(c, plate(wing, 0.3, -0.38, 0.45), body, { keep: true });
  for (const [sx, input] of [[1, 'rollR'], [-1, 'rollL']]) {
    surface(c, new THREE.Vector3(sx * 6.6, -0.38, 0.5), 'x', input, 0.35, new THREE.BoxGeometry(3.8, 0.07, 0.42).translate(0, 0, 0.21), dark);
  }
  // Carenados del tren bajo el ala
  for (const sx of [1, -1]) {
    const p = mesh(new THREE.BoxGeometry(0.7, 0.62, 2.8), body); p.position.set(sx * 2.2, -0.68, -0.5); p.userData.keep = true; c.grp.add(p);
  }
  // Góndolas de motor y soportes
  for (const sx of [1, -1]) {
    const n = mesh(latheGeo([[5.4, 0.42], [4.9, 0.6], [3.2, 0.7], [1.7, 0.72], [1.4, 0.56]], 8), body);
    n.position.set(sx * 1.45, 1.15, 0); n.userData.keep = true; c.grp.add(n);
    const lip = mesh(new THREE.CircleGeometry(0.5, 8), mat(0x0a0a0a)); lip.rotation.y = Math.PI; lip.position.set(sx * 1.45, 1.15, 1.38); lip.userData.keep = true; c.grp.add(lip);
    const py = mesh(new THREE.BoxGeometry(0.2, 0.7, 2.2), dark); py.position.set(sx * 1.0, 0.72, 3.4); py.rotation.z = sx * 0.75; py.userData.keep = true; c.grp.add(py);
    const nz = mesh(new THREE.CircleGeometry(0.4, 8), mat(0x220d00, { e: 0x441800 })); nz.position.set(sx * 1.45, 1.15, 5.41); nz.userData.keep = true; c.grp.add(nz);
    c.parts.exhaust.push(new THREE.Vector3(sx * 1.45, 1.15, 5.7));
  }
  // Cola: estabilizador con dobles derivas en los extremos
  const hs = surface(c, new THREE.Vector3(0, 0.15, 6.3), 'x', 'pitch', 0.28,
    plate([[0, -0.75], [3.1, -0.65], [3.1, 1.05], [0, 1.15]], 0.12, 0), body);
  const hsl = mesh(plate([[0, -0.75], [3.1, -0.65], [3.1, 1.05], [0, 1.15]], 0.12, 0), body); hsl.scale.x = -1; hsl.userData.keep = true; hs.add(hsl);
  for (const sx of [1, -1]) {
    const f = mesh(fin([[0, -0.95], [0.5, 1.9], [1.8, 1.9], [1.85, -1.0]], 0.13), body);
    f.position.set(sx * 3.15, 0.15, 5.6); f.userData.keep = true; c.grp.add(f);
    surface(c, new THREE.Vector3(sx * 3.15, 0.15, 7.45), 'y', 'yaw', 0.35, fin([[0, -0.8], [0, 1.7], [0.3, 1.7], [0.3, -0.8]], 0.08), dark);
  }
  // Cañón GAU-8: siete tubos facetados
  const gun = new THREE.Group(); gun.position.set(0, -0.28, -8.0);
  gun.add(mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.9, 7).rotateX(Math.PI / 2).translate(0, 0, 0.1), metal));
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    gun.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 5).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.13, Math.sin(a) * 0.13, -0.9), metal));
  }
  gun.traverse(o => { o.userData.keep = true; });
  c.grp.add(gun); c.parts.gun = gun;
  // Boca de tiburón de los «Flying Tigers», códigos de cola y marcas
  addDecal(c.grp, DECALS.sharkMouth(), 2.1, 0.8, [0.76, -0.3, -6.85], 'side', { mirror: true, flipText: false });
  addDecal(c.grp, DECALS.sharkEye(), 0.3, 0.3, [0.76, 0.05, -5.95], 'side', { mirror: true, flipText: false });
  addDecal(c.grp, DECALS.usInsignia(true), 1.1, 0.55, [0.84, 0.15, 3.0], 'side', { mirror: true });
  addDecal(c.grp, DECALS.usInsignia(true), 1.5, 0.75, [-6.0, -0.2, -0.3], 'up');
  addDecal(c.grp, DECALS.text('USAF', '#22261f'), 1.3, 0.32, [6.0, -0.2, -0.4], 'up');
  for (const sx of [1, -1]) {
    addDecal(c.grp, DECALS.text('FT', '#22261f', { font: 'bold 200px Impact, "Arial Black", sans-serif' }), 0.95, 0.24, [sx * 3.23, 0.75, 6.55], 'side');
    addDecal(c.grp, DECALS.checker('#f2c315', '#141414', 8, 2), 1.3, 0.32, [sx * 3.23, 1.7, 6.75], 'side');
    addDecal(c.grp, DECALS.text('AF 80-0281', '#22261f', { font: 'bold 120px "Share Tech Mono", monospace' }), 1.1, 0.27, [sx * 3.23, 0.3, 6.55], 'side');
  }
  // Soportes con cohetes
  for (const sx of [1, -1]) for (const x of [3.6, 5.2]) {
    const pod = mesh(new THREE.CylinderGeometry(0.2, 0.2, 2, 7).rotateX(Math.PI / 2), mat(0x8c8f7a));
    pod.position.set(sx * x, -0.72, -0.5); pod.userData.keep = true; c.grp.add(pod);
  }
  addGear(c, spec, 0, -0.6, -5.4, 0.34, 0.2, 'x', -1.6, { strut: 0.08 });
  for (const sx of [1, -1]) addGear(c, spec, sx * 2.2, -0.6, -0.5, 0.48, 0.28, 'x', -1.45, { strut: 0.1 });
  navLights(c, new THREE.Vector3(-8.8, -0.38, -0.4), new THREE.Vector3(8.8, -0.38, -0.4), null);
  addPilot(c, spec, [], 0x3a4030);
  c.parts.landingLight = new THREE.Vector3(0, -0.9, -5.4);
  return c;
}

const BUILDERS = {
  a10: buildA10, f14: buildF14, f16: buildF16, f18: buildF18,
  apache: buildApache, lhx: buildLHX,
};

export function buildModel(id) {
  const spec = AIRCRAFT_BY_ID[id];
  const c = BUILDERS[id](spec);
  c.parts.eye = new THREE.Vector3(...spec.eye);
  c.group = c.grp;
  c.gearHeight = spec.gearH;
  applyLivery(c.grp, LIVERIES[id]);
  return c;
}
