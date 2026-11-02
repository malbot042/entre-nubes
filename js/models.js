// Modelos low-poly procedurales de todas las aeronaves.
// Convención: morro hacia -Z, arriba +Y, derecha +X. Origen ≈ centro de gravedad.
import * as THREE from 'three';
import { AIRCRAFT_BY_ID } from './aircraft.js?v=4';

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
  const g = new THREE.LatheGeometry(pts, seg);
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
    parts: { hide: [], gear: [], props: [], rotors: [], tailRotors: [], surfaces: [], ab: [], navLights: [], strobes: [], sweep: [], discs: [] },
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

// =================== AVIONETA DE ALA ALTA (C172) ===================
function buildC172(spec) {
  const c = newCtx(spec);
  const W = mat(0xf3f3ee), B = mat(0x1d4f9c), D = mat(0x2a2a2a);
  const prof = [[4.4, 0.1], [3.6, 0.24], [2.2, 0.42], [0.6, 0.56], [-0.6, 0.6], [-1.9, 0.58], [-2.6, 0.5], [-3.2, 0.4], [-3.5, 0.26], [-3.6, 0.12]];
  fuselage(c, prof, 0.6, -1.9, 0.95, 1.05, W, 16);
  // Cabina (invernadero)
  const cab = mesh(fin([[-1.9, 0.25], [-1.9, 0.6], [-1.15, 1.2], [0.7, 1.2], [1.6, 0.55], [1.6, 0.25]], 1.08), W);
  c.grp.add(cab); c.parts.hide.push(cab);
  const gm = glassMat(0x1a2a3a, 0.55);
  const ws = mesh(fin([[-1.88, 0.62], [-1.17, 1.18], [-1.12, 1.18], [-1.83, 0.62]], 1.0), gm);
  ws.position.x = 0; c.grp.add(ws); c.parts.hide.push(ws);
  for (const sx of [1, -1]) {
    const sw = mesh(fin([[-1.75, 0.66], [-1.1, 1.12], [0.4, 1.12], [0.4, 0.66]], 0.02), gm);
    sw.position.x = sx * 0.55; c.grp.add(sw); c.parts.hide.push(sw);
    const rw = mesh(fin([[0.55, 0.7], [0.65, 1.12], [1.1, 0.85], [1.1, 0.7]], 0.02), gm);
    rw.position.x = sx * 0.55; c.grp.add(rw); c.parts.hide.push(rw);
  }
  // Franja decorativa
  for (const sx of [1, -1]) {
    const st = mesh(new THREE.BoxGeometry(0.02, 0.12, 6.5).translate(0, 0, 0.6), B);
    st.position.set(sx * 0.585, 0.1, 0); c.grp.add(st); c.parts.hide.push(st);
  }
  // Ala alta
  const wingPts = [[0, -1.15], [3.0, -1.15], [5.5, -1.0], [5.5, 0.25], [0, 0.35]];
  const [wr, wl] = pair(c, plate(wingPts, 0.16, 1.27, 0.3), W, { keep: true });
  // Montantes
  for (const sx of [1, -1]) {
    const s = mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 5), W);
    s.position.set(sx * 1.3, 0.62, -0.5); s.rotation.z = sx * 0.95; s.userData.keep = true; c.grp.add(s);
  }
  // Alerones
  const ail = (sx) => surface(c, new THREE.Vector3(sx * 4.1, 1.27, 0.22), 'x', sx > 0 ? 'rollR' : 'rollL', 0.35,
    new THREE.BoxGeometry(2.4, 0.06, 0.38).translate(0, 0, 0.19), W);
  ail(1); ail(-1);
  // Cola
  const fin1 = mesh(fin([[2.8, 0.35], [3.9, 1.85], [4.35, 1.85], [4.3, 0.15]], 0.08), W);
  fin1.userData.keep = true; c.grp.add(fin1);
  surface(c, new THREE.Vector3(0, 0.2, 4.3), 'y', 'yaw', 0.4, fin([[0, 0], [0, 1.6], [0.35, 1.5], [0.4, 0.05]], 0.06), B);
  const hs = plate([[0, -0.45], [1.7, -0.3], [1.7, 0.25], [0, 0.35]], 0.06, 0);
  const hsp = surface(c, new THREE.Vector3(0, 0.15, 4.0), 'x', 'pitch', 0.3, hs, W);
  const hsl = mesh(hs, W); hsl.scale.x = -1; hsp.add(hsl);
  // Motor y hélice
  const prop = propeller(2, spec.propR, -3.68, -0.05, 0x1a1a1a, 0xeeeeee);
  c.grp.add(prop.group); c.parts.props.push(prop.group); c.parts.discs.push(prop.disc);
  // Tren fijo con carenados
  const pant = W;
  addGear(c, spec, 1.15, -0.45, -0.2, 0.28, 0.16, 'z', 0, { pant, fixed: true });
  addGear(c, spec, -1.15, -0.45, -0.2, 0.28, 0.16, 'z', 0, { pant, fixed: true });
  addGear(c, spec, 0, -0.45, -2.8, 0.22, 0.12, 'x', 0, { pant, fixed: true });
  navLights(c, new THREE.Vector3(-5.5, 1.27, -0.4), new THREE.Vector3(5.5, 1.27, -0.4), new THREE.Vector3(0, 1.85, 4.4));
  addPilot(c, spec, [], 0x6a4a2a);
  c.parts.landingLight = new THREE.Vector3(-2.5, 1.2, -1.2);
  return c;
}

// =================== MONOPLANO DE ALA BAJA CON PATÍN (Spitfire, P-51, Extra) ===================
function buildLowWingProp(spec, o) {
  const c = newCtx(spec);
  const body = mat(o.color, { m: o.metal ?? 0.3, r: o.rough ?? 0.5 });
  const accent = mat(o.accent);
  fuselage(c, o.profile, o.cut[0], o.cut[1], o.sx, o.sy, body, 16, o.yOff || 0);
  canopy(c, o.canopy, 0x20303e, true, o.frame ?? 0x333333);
  // ala
  const [wr, wl] = pair(c, plate(o.wing, o.wingT || 0.22, o.wingY, 0.5), body, { keep: true });
  wr.rotation.z = o.dihedral || 0.07; wl.rotation.z = -(o.dihedral || 0.07);
  const ailG = new THREE.BoxGeometry(o.ail[1], 0.06, 0.32).translate(0, 0, 0.16);
  surface(c, new THREE.Vector3(o.ail[0], o.wingY + o.ail[0] * (o.dihedral || 0.07), o.ail[2]), 'x', 'rollR', 0.35, ailG, body);
  surface(c, new THREE.Vector3(-o.ail[0], o.wingY + o.ail[0] * (o.dihedral || 0.07), o.ail[2]), 'x', 'rollL', 0.35, ailG, body);
  // cola
  const f = mesh(fin(o.fin, 0.1), body); f.userData.keep = true; c.grp.add(f);
  surface(c, new THREE.Vector3(0, o.rudder[1], o.rudder[0]), 'y', 'yaw', 0.4, fin(o.rudder[2], 0.07), accent);
  const hs = plate(o.hstab, 0.08, 0);
  const hp = surface(c, new THREE.Vector3(0, o.hstabY, o.hstabZ), 'x', 'pitch', 0.3, hs, body);
  const hl = mesh(hs, body); hl.scale.x = -1; hp.add(hl);
  // hélice
  const prop = propeller(spec.blades, spec.propR, o.propZ, o.propY || 0, 0x1a1a1a, o.spinner ?? o.accent);
  c.grp.add(prop.group); c.parts.props.push(prop.group); c.parts.discs.push(prop.disc);
  // tren
  const gx = o.gearX, gz = o.gearZ;
  const ret = spec.gearFixed ? {} : {};
  addGear(c, spec, gx, o.wingY - 0.05, gz, o.wheelR, 0.16, 'z', -1.5, { pant: o.pants ? body : null, strut: 0.05 });
  addGear(c, spec, -gx, o.wingY - 0.05, gz, o.wheelR, 0.16, 'z', 1.5, { pant: o.pants ? body : null, strut: 0.05 });
  // patín de cola
  const tw = gearLeg(0.25, 0.1, 0.06, { strut: 0.03 });
  const tailY = -spec.gearH + 0.1 + Math.tan(spec.taildragger * DEG) * (o.tailWheelZ - gz) + 0.25;
  tw.position.set(0, tailY, o.tailWheelZ); c.grp.add(tw); tw.traverse(x => { x.userData.keep = true; });
  // extras
  if (o.extras) o.extras(c, body, accent);
  navLights(c, new THREE.Vector3(-o.span, o.wingY + o.span * (o.dihedral || 0.07), o.navZ || 0), new THREE.Vector3(o.span, o.wingY + o.span * (o.dihedral || 0.07), o.navZ || 0), null);
  addPilot(c, spec, [], o.helmet ?? 0x6b4b2b);
  c.parts.landingLight = new THREE.Vector3(o.span * 0.5, o.wingY, -0.8);
  return c;
}

function ellipticWing(span, root, n = 10) {
  const le = [], te = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * span;
    const ch = root * Math.sqrt(Math.max(0.02, 1 - (x / span) ** 2));
    le.push([x, -ch * 0.38]); te.push([x, ch * 0.62]);
  }
  return [...le, ...te.reverse()];
}

function buildSpitfire(spec) {
  return buildLowWingProp(spec, {
    color: 0x5f6b45, accent: 0x7a5a3a, metal: 0.15, rough: 0.7, spinner: 0x2a2a2a,
    profile: [[4.95, 0.1], [4.2, 0.26], [2.5, 0.46], [0.6, 0.56], [-0.8, 0.6], [-2.4, 0.55], [-3.6, 0.47], [-4.3, 0.33], [-4.6, 0.2]],
    cut: [0.5, -1.0], sx: 0.82, sy: 1.15,
    canopy: { z: -0.2, len: 1.7, w: 0.37, h: 0.42, y: 0.55 },
    wing: ellipticWing(5.6, 2.55), wingY: -0.4, dihedral: 0.1, span: 5.55,
    ail: [3.9, 1.8, 0.75], navZ: 0,
    fin: [[3.6, 0.4], [4.0, 1.25], [4.35, 1.6], [4.7, 1.55], [4.7, 0.3]],
    rudder: [4.7, 0.05, [[0, 0], [0, 1.5], [0.25, 1.35], [0.35, 0.2]]],
    hstab: ellipticWing(1.6, 1.0, 6).map(([x, z]) => [x, z]), hstabY: 0.25, hstabZ: 4.3,
    propZ: -4.75, blades: 4,
    gearX: 0.85, gearZ: -0.9, wheelR: 0.34, tailWheelZ: 4.6,
    extras: (c, body) => {
      // radiadores bajo el ala y escapes
      for (const sx of [1, -1]) {
        const r = mesh(new THREE.BoxGeometry(0.35, 0.25, 1.4), mat(0x4a5235));
        r.position.set(sx * 1.6, -0.62, 0.1); r.userData.keep = true; c.grp.add(r);
        for (let i = 0; i < 6; i++) {
          const e = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.15, 5).rotateZ(Math.PI / 2), mat(0x333333, { m: 0.8 }));
          e.position.set(sx * 0.42, 0.18, -3.4 + i * 0.22); c.grp.add(e);
        }
        const rd = roundel([0x1a2a6a, 0xeeeeee, 0xbb1a1a], 0.55);
        rd.position.set(sx * 3.6, -0.4 + 3.6 * 0.1 + 0.12, -0.2); rd.userData.keep = true; rd.traverse(o => o.userData.keep = true); c.grp.add(rd);
      }
      // borde inferior gris
      const belly = mesh(latheGeo([[4.0, 0.2], [0, 0.5], [-3.5, 0.42]], 12, 0.83, 1.05, -0.08), mat(0x8c9298));
      belly.scale.set(1, 0.6, 1); belly.position.y = -0.2; c.grp.add(belly); c.parts.hide.push(belly);
    },
  });
}

function buildP51(spec) {
  return buildLowWingProp(spec, {
    color: 0xb9c0c6, accent: 0xd6b200, metal: 0.75, rough: 0.3, spinner: 0xd6b200,
    profile: [[5.0, 0.1], [4.2, 0.28], [2.4, 0.5], [0.5, 0.6], [-1.0, 0.62], [-2.5, 0.58], [-3.8, 0.48], [-4.4, 0.34], [-4.7, 0.2]],
    cut: [0.7, -0.9], sx: 0.82, sy: 1.15,
    canopy: { z: 0.0, len: 2.0, w: 0.42, h: 0.5, y: 0.56 }, frame: 0x777777,
    wing: [[0, -1.3], [5.6, -0.45], [5.65, 0.45], [5.6, 0.62], [0, 1.25]], wingY: -0.45, dihedral: 0.09, span: 5.6,
    ail: [3.9, 1.8, 0.55],
    fin: [[3.5, 0.45], [4.2, 1.45], [4.65, 1.6], [4.85, 1.4], [4.85, 0.3]],
    rudder: [4.85, 0.05, [[0, 0], [0, 1.4], [0.3, 1.2], [0.35, 0.2]]],
    hstab: [[0, -0.5], [2.0, -0.25], [2.05, 0.2], [0, 0.45]], hstabY: 0.3, hstabZ: 4.3,
    propZ: -4.85, blades: 4,
    gearX: 1.2, gearZ: -0.85, wheelR: 0.36, tailWheelZ: 4.5, helmet: 0x5a4632,
    extras: (c) => {
      const scoop = mesh(latheGeo([[2.4, 0.08], [1.6, 0.3], [0.2, 0.32], [-0.2, 0.25]], 10, 1.1, 0.8, 0), mat(0xb9c0c6, { m: 0.75, r: 0.3 }));
      scoop.position.y = -0.66; scoop.userData.keep = true; c.grp.add(scoop);
      const band = mesh(latheGeo([[-3.9, 0.47], [-4.4, 0.34]], 16, 0.83, 1.16), mat(0xd6b200));
      c.grp.add(band);
      for (const sx of [1, -1]) {
        const s = star(0.4, 0x1a2a6a); s.rotation.x = -Math.PI / 2; s.position.set(sx * 4.0, -0.45 + 4 * 0.09 + 0.13, 0.1); s.userData.keep = true; c.grp.add(s);
      }
    },
  });
}

function buildExtra(spec) {
  return buildLowWingProp(spec, {
    color: 0xf4f4f4, accent: 0xd0202a, metal: 0.2, spinner: 0xd0202a,
    profile: [[3.6, 0.08], [2.6, 0.28], [0.8, 0.48], [-0.6, 0.55], [-1.8, 0.5], [-2.7, 0.42], [-3.1, 0.25], [-3.25, 0.12]],
    cut: [1.3, -0.8], sx: 0.85, sy: 1.12,
    canopy: { z: 0.25, len: 2.3, w: 0.42, h: 0.52, y: 0.5 }, frame: 0xd0202a,
    wing: [[0, -0.95], [3.75, -0.45], [3.75, 0.5], [0, 0.85]], wingY: -0.35, dihedral: 0.0, span: 3.75, wingT: 0.2,
    ail: [2.2, 2.9, 0.55],
    fin: [[2.4, 0.4], [3.1, 1.3], [3.45, 1.35], [3.5, 0.2]],
    rudder: [3.5, 0.0, [[0, 0], [0, 1.35], [0.4, 1.3], [0.45, -0.2]]],
    hstab: [[0, -0.4], [1.45, -0.2], [1.45, 0.3], [0, 0.4]], hstabY: 0.25, hstabZ: 3.15,
    propZ: -3.35, blades: 3, pants: true,
    gearX: 0.85, gearZ: -0.75, wheelR: 0.24, tailWheelZ: 3.4, helmet: 0xd0202a,
    extras: (c) => {
      // rayos rojos tipo "sunburst" en las alas
      for (const sx of [1, -1]) for (let i = 0; i < 3; i++) {
        const r = mesh(plate([[0.3, -0.6 + i * 0.5], [3.6, -0.35 + i * 0.25], [3.6, -0.2 + i * 0.25], [0.3, -0.35 + i * 0.5]], 0.01, -0.235), mat(0xd0202a));
        r.scale.x = sx; r.userData.keep = true; c.grp.add(r);
      }
    },
  });
}

// =================== REACTORES CIVILES ===================
function buildAirliner(spec, o) {
  const c = newCtx(spec);
  const body = mat(0xf2f3f5, { m: 0.35, r: 0.35 });
  const livery = mat(o.livery);
  const dark = mat(0x111418, { m: 0.6, r: 0.2 });
  fuselage(c, o.profile, o.cut[0], o.cut[1], 1, o.sy, body, 20, 0, true);
  const R = o.R;
  // ventanillas y franja
  for (const sx of [1, -1]) {
    const w = mesh(new THREE.BoxGeometry(0.02, o.winH, o.winLen), dark);
    w.position.set(sx * (R + 0.005), R * 0.28, o.winZ); c.grp.add(w);
    const s = mesh(new THREE.BoxGeometry(0.02, R * 0.12, o.winLen + 4), livery);
    s.position.set(sx * (R * 0.99), R * 0.02, o.winZ + 1); c.grp.add(s);
    // ventanas de cabina
    const cw = mesh(new THREE.BoxGeometry(R * 0.25, R * 0.18, R * 0.55), dark);
    cw.position.set(sx * R * 0.45, R * 0.42, o.cockpitZ); cw.rotation.y = -sx * 0.5; cw.rotation.z = sx * 0.45; c.grp.add(cw); c.parts.hide.push(cw);
  }
  const fw = mesh(new THREE.BoxGeometry(R * 0.7, R * 0.16, 0.05), dark);
  fw.position.set(0, R * 0.48, o.cockpitZ - R * 0.25); fw.rotation.x = -0.9; c.grp.add(fw); c.parts.hide.push(fw);
  // vientre
  const belly = mesh(new THREE.BoxGeometry(R * 1.3, R * 0.3, o.winLen * 0.7), mat(0xc8ccd0));
  belly.position.set(0, -R * 0.85, o.wingZ + 1); c.grp.add(belly);
  // alas
  const [wr, wl] = pair(c, plate(o.wing, o.wingT, o.wingY, 0.6), body, { keep: true });
  wr.rotation.z = 0.08; wl.rotation.z = -0.08;
  const span = o.wing[1][0];
  // winglets
  for (const sx of [1, -1]) {
    const wlt = mesh(fin([[0, 0], [0.9, 1.6], [1.5, 1.6], [1.4, 0]], 0.08), livery);
    wlt.position.set(sx * span, o.wingY + span * 0.08, o.wing[1][1] + 0.3); wlt.userData.keep = true; c.grp.add(wlt);
  }
  surface(c, new THREE.Vector3(span * 0.72, o.wingY + span * 0.72 * 0.08, o.ailZ), 'x', 'rollR', 0.3, new THREE.BoxGeometry(span * 0.2, 0.08, 0.6).translate(0, 0, 0.3), body);
  surface(c, new THREE.Vector3(-span * 0.72, o.wingY + span * 0.72 * 0.08, o.ailZ), 'x', 'rollL', 0.3, new THREE.BoxGeometry(span * 0.2, 0.08, 0.6).translate(0, 0, 0.3), body);
  // motores
  for (const e of o.engines) {
    for (const sx of [1, -1]) {
      const n = mesh(latheGeo([[e.len / 2, e.r * 0.6], [e.len * 0.2, e.r], [-e.len / 2, e.r * 0.95]], 14), mat(0xd8dadc, { m: 0.6, r: 0.3 }));
      n.position.set(sx * e.x, e.y, e.z); n.userData.keep = true; c.grp.add(n);
      const fan = mesh(new THREE.CircleGeometry(e.r * 0.9, 14), mat(0x222222, { m: 0.8 }));
      fan.position.set(sx * e.x, e.y, e.z - e.len / 2 + 0.05); fan.userData.keep = true; c.grp.add(fan);
      const py = mesh(new THREE.BoxGeometry(0.25, Math.abs(e.pylonH), e.len * 0.7), body);
      py.position.set(sx * (e.x - (e.pylonX || 0)), e.y + e.pylonH / 2, e.z + 0.3); py.userData.keep = true; c.grp.add(py);
    }
  }
  // cola
  const vf = mesh(fin(o.fin, 0.3), livery); vf.userData.keep = true; c.grp.add(vf);
  surface(c, new THREE.Vector3(0, o.rudder[1], o.rudder[0]), 'y', 'yaw', 0.35, fin(o.rudder[2], 0.2), livery);
  const hs = plate(o.hstab, 0.2, 0, 0.5);
  const hp = surface(c, new THREE.Vector3(0, o.hstabY, 0), 'x', 'pitch', 0.12, hs, body);
  const hl = mesh(hs, body); hl.scale.x = -1; hp.add(hl);
  // tren
  addGear(c, spec, 0, -R * 0.8, o.noseZ, o.noseWheel, 0.25, 'x', 1.6, { twin: true, strut: 0.09 });
  for (const sx of [1, -1]) addGear(c, spec, sx * o.mainX, o.wingY - 0.2, o.mainZ, o.mainWheel, 0.35, 'z', -sx * 1.5, { twin: true, strut: 0.14 });
  navLights(c, new THREE.Vector3(-span, o.wingY + span * 0.08, o.wing[1][1]), new THREE.Vector3(span, o.wingY + span * 0.08, o.wing[1][1]), new THREE.Vector3(0, o.fin[1][1], o.fin[2][0]));
  addPilot(c, spec, [[-spec.eye[0], spec.eye[1] - 0.05, spec.eye[2] + 0.05]], 0x2a2a3a);
  c.parts.landingLight = new THREE.Vector3(0, -R * 0.6, o.noseZ - 0.4);
  return c;
}

function buildB737(spec) {
  return buildAirliner(spec, {
    livery: 0x1b4f9a,
    profile: [[20, 0.3], [18, 0.95], [15, 1.7], [11, 1.96], [-13.5, 1.96], [-16, 1.82], [-17.8, 1.45], [-19, 0.9], [-19.6, 0.3]],
    cut: [-13.2, -15.4], sy: 1.05, R: 1.96,
    winH: 0.3, winLen: 25, winZ: 0, cockpitZ: -17.2,
    wing: [[1.9, -3], [17, 4.6], [17, 6.2], [1.9, 3.6]], wingT: 0.45, wingY: -1.15, wingZ: 0, ailZ: 5.6,
    engines: [{ x: 5, y: -1.85, z: -3.2, r: 0.95, len: 3.6, pylonH: 0.8 }],
    fin: [[12.5, 1.6], [17.6, 8.6], [19.4, 8.6], [19.6, 1.3]],
    rudder: [19.0, 1.8, [[0, 0], [0.6, 6.6], [1.2, 6.6], [1.0, 0]]],
    hstab: [[1.0, 15.6], [6.6, 18.6], [6.6, 19.6], [1.0, 19.4]], hstabY: 0.7,
    noseZ: -15.2, noseWheel: 0.38, mainX: 2.9, mainZ: 1.6, mainWheel: 0.55,
  });
}

function buildLearjet(spec) {
  const c = buildAirliner(spec, {
    livery: 0xa0182a,
    profile: [[9.2, 0.25], [7.6, 0.6], [5.2, 0.86], [-3.8, 0.86], [-5.6, 0.76], [-7.3, 0.5], [-8.6, 0.1]],
    cut: [-3.6, -4.6], sy: 1.05, R: 0.86,
    winH: 0.2, winLen: 7, winZ: 0.5, cockpitZ: -5.9,
    wing: [[0.8, -1.2], [7.4, 1.4], [7.4, 2.35], [0.8, 2.7]], wingT: 0.22, wingY: -0.55, wingZ: 0.5, ailZ: 2.0,
    engines: [{ x: 1.4, y: 0.35, z: 5.4, r: 0.45, len: 2.6, pylonH: -0.01, pylonX: 0.5 }],
    fin: [[5.8, 0.7], [8.4, 3.3], [9.4, 3.3], [9.3, 0.5]],
    rudder: [9.35, 0.9, [[0, 0], [0.5, 2.2], [0.75, 2.2], [0.6, 0]]],
    hstab: [[0.0, 7.9], [3.2, 8.9], [3.2, 9.5], [0, 9.6]], hstabY: 3.3,
    noseZ: -6.0, noseWheel: 0.25, mainX: 1.45, mainZ: 1.4, mainWheel: 0.32,
  });
  // pilones laterales de los motores traseros
  for (const sx of [1, -1]) {
    const py = mesh(new THREE.BoxGeometry(0.7, 0.12, 1.2), mat(0xf2f3f5));
    py.position.set(sx * 0.95, 0.35, 5.4); c.grp.add(py);
  }
  return c;
}

// =================== CAZAS ===================
function buildFighter(spec, o) {
  const c = newCtx(spec);
  const body = mat(o.color, { m: 0.35, r: 0.5 });
  const dark = mat(o.dark, { m: 0.35, r: 0.55 });
  const metal = mat(0x55585c, { m: 0.85, r: 0.35 });
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
      const g = mesh(new THREE.BoxGeometry(it.w, it.h, it.len), body);
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
      const f = mesh(fin(t.shape, 0.12), body);
      f.userData.keep = true; g.add(f);
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
        new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      flame.position.set(sx * nz.x, nz.y, nz.z + nz.len);
      flame.userData.keep = true;
      c.grp.add(flame);
      const core = new THREE.Mesh(
        new THREE.ConeGeometry((nz.r || nz.box[1] / 2) * 0.5, 1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
        new THREE.MeshBasicMaterial({ color: 0x9ab8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      core.position.copy(flame.position); core.userData.keep = true; c.grp.add(core);
      c.parts.ab.push(flame, core);
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

const usStar = () => {
  const g = new THREE.Group();
  const s = star(0.32, 0x30343a); g.add(s);
  return g;
};
const redStar = () => {
  const g = new THREE.Group();
  const w = star(0.42, 0xffffff); g.add(w);
  const s = star(0.36, 0xc8101a); s.position.z = 0.003; g.add(s);
  return g;
};

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
    navSpan: 4.75, navZ: 2.4, insignia: usStar,
    extras: (c, body) => {
      for (const sx of [1, -1]) {
        const vf = mesh(fin([[0, 0], [1.2, -0.6], [1.7, -0.6], [1.6, 0]], 0.06), body);
        vf.position.set(sx * 0.65, -0.5, 4.6); vf.rotation.z = sx * 0.4; vf.userData.keep = true; c.grp.add(vf);
      }
    },
  });
}

function buildF18(spec) {
  return buildFighter(spec, {
    color: 0x9aa3ab, dark: 0x737c84, radome: 1.6,
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
    navSpan: 6.1, navZ: 2.4, insignia: usStar,
  });
}

function buildF22(spec) {
  return buildFighter(spec, {
    color: 0x80888f, dark: 0x6c747b,
    profile: [[9.4, 0.7], [7.0, 0.95], [3.0, 1.05], [0.0, 1.05], [-3.0, 0.95], [-5.0, 0.75], [-7.0, 0.5], [-8.8, 0.2], [-9.5, 0.03]],
    cut: [-4.4, -7.6], sx: 1.45, sy: 0.68,
    canopy: { z: -6.0, len: 3.8, w: 0.55, h: 0.64, y: 0.42 }, frame: false, tint: 0x6b5520,
    wing: [[1.3, -3.0], [6.8, 2.6], [6.8, 3.6], [1.8, 5.6], [1.3, 5.6]], wingY: 0.0,
    tails: [{ x: 1.75, y: 0.4, cant: 28, shape: [[3.3, 0.2], [5.6, 3.0], [6.8, 3.0], [7.3, 0.2]] }],
    hstab: [[1.6, 6.3], [4.3, 8.4], [4.3, 9.2], [3.6, 9.7], [1.6, 9.7]], hstabPivot: 8.2, hstabY: 0.0,
    nozzles: [{ x: 0.7, y: 0.0, z: 9.2, box: [1.0, 0.55], len: 0.8 }],
    intakes: [{ x: 1.65, y: -0.15, z: -2.0, w: 0.9, h: 1.0, len: 4.5, rz: 0.35, keep: true }],
    missiles: [],
    gear: { attachY: -0.5, noseZ: -6.2, mainX: 1.75, mainZ: 1.4 },
    navSpan: 6.8, navZ: 3.0, pitot: 0.01,
  });
}

function buildF14(spec) {
  return buildFighter(spec, {
    color: 0xa9b2ba, dark: 0x838c94, radome: 2.0,
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
    },
  });
}

function buildMig29(spec) {
  return buildFighter(spec, {
    color: 0xa3b1b9, dark: 0x6f8c99, radome: 1.6,
    profile: [[8.0, 0.35], [6.0, 0.55], [3.0, 0.72], [0.0, 0.8], [-2.5, 0.76], [-4.5, 0.64], [-6.5, 0.46], [-8.2, 0.2], [-9.0, 0.03]],
    cut: [-3.6, -6.8], sx: 1.1, sy: 0.9, yOff: 0.15,
    canopy: { z: -5.4, len: 3.1, w: 0.5, h: 0.6, y: 0.65 },
    wing: [[0.5, -6.4], [1.9, -2.2], [2.1, -0.6], [5.7, 2.6], [5.8, 2.6], [5.8, 3.6], [2.1, 4.6], [0.5, 4.6]], wingY: 0.0,
    nacelles: [{ x: 1.25, y: -0.45, z0: 8.2, z1: -2.4, r: 0.58 }],
    intakes: [{ x: 1.25, y: -0.55, z: -3.0, w: 0.9, h: 0.95, len: 1.8, rz: 0.1, keep: true }],
    tails: [{ x: 1.6, y: 0.05, cant: 6, shape: [[3.4, 0.2], [5.8, 3.0], [6.8, 3.0], [7.1, 0.2]] }],
    hstab: [[1.7, 6.1], [4.1, 7.6], [4.1, 8.3], [1.7, 8.6]], hstabPivot: 7.3, hstabY: -0.15,
    nozzles: [{ x: 1.25, y: -0.45, z: 8.1, r: 0.5, len: 0.9 }],
    missiles: [{ x: 4.6, y: -0.35, z: 1.8, len: 2.9, r: 0.08 }, { x: 3.7, y: -0.4, z: 1.2, len: 2.9, r: 0.08 }, { x: 2.8, y: -0.45, z: 0.8, len: 4.0, r: 0.12, color: 0xd8d8d0 }],
    gear: { attachY: -0.6, noseZ: -5.4, mainX: 1.7, mainZ: 1.2, noseTwin: true },
    navSpan: 5.8, navZ: 2.6, insignia: redStar, helmet: 0xd8d8c0,
  });
}

function buildMig21(spec) {
  return buildFighter(spec, {
    color: 0xbcc3c7, dark: 0x8d969b,
    profile: [[7.6, 0.5], [6.0, 0.6], [2.0, 0.68], [-2.0, 0.68], [-4.0, 0.62], [-6.0, 0.55], [-7.4, 0.48], [-7.45, 0.3]],
    cut: [-2.6, -4.8], sx: 1, sy: 1,
    canopy: { z: -3.8, len: 2.2, w: 0.43, h: 0.46, y: 0.58 },
    wing: [[0.6, -2.0], [3.6, 2.6], [3.6, 3.2], [0.6, 3.6]], wingY: -0.15,
    tails: [{ x: 0, y: 0, shape: [[2.8, 0.55], [6.2, 3.3], [7.0, 3.3], [7.3, 0.55]] }],
    hstab: [[0.6, 5.6], [2.4, 6.6], [2.4, 7.1], [0.6, 7.3]], hstabPivot: 6.4, hstabY: -0.15,
    nozzles: [{ x: 0, y: 0, z: 7.5, r: 0.5, len: 0.8 }],
    missiles: [{ x: 2.2, y: -0.45, z: 1.6, len: 2.9, r: 0.065 }, { x: 1.5, y: -0.45, z: 1.0, len: 2.9, r: 0.065 }],
    gear: { attachY: -0.4, noseZ: -4.2, mainX: 1.35, mainZ: 0.9 },
    navSpan: 3.6, navZ: 2.8, insignia: redStar, pitot: 1.6, helmet: 0xd8d8c0,
    extras: (c, body, dark, metal) => {
      const cone = mesh(new THREE.ConeGeometry(0.3, 1.0, 12).rotateX(-Math.PI / 2), dark);
      cone.position.set(0, 0, -7.85); c.grp.add(cone);
      const spine = mesh(fin([[-2.8, 0.4], [-2.4, 0.95], [3.0, 0.8], [4.0, 0.55]], 0.42), body);
      c.grp.add(spine); spine.userData.keep = true;
      const vf = mesh(fin([[0, 0], [1.4, -0.7], [1.8, -0.7], [1.9, 0]], 0.06), body);
      vf.position.set(0, -0.6, 5.0); vf.userData.keep = true; c.grp.add(vf);
      const tank = mesh(latheGeo([[2, 0.05], [1.2, 0.3], [-1.2, 0.3], [-2, 0.05]], 10), mat(0xa0a8ac, { m: 0.6 }));
      tank.position.set(0, -0.95, 0.6); tank.userData.keep = true; c.grp.add(tank);
    },
  });
}

// =================== HELICÓPTEROS ===================
function buildHeli(spec, o) {
  const c = newCtx(spec);
  const body = mat(o.color, { m: o.metal ?? 0.25, r: 0.55 });
  const accent = mat(o.accent ?? o.color);
  const dark = mat(0x222222, { m: 0.5 });
  const pod = mesh(latheGeo(o.pod, 18, o.podSx, o.podSy, o.podY), body);
  c.grp.add(pod); c.parts.hide.push(pod);
  // Botalón de cola
  const boom = mesh(latheGeo(o.boom, 10, 1, 1, o.boomY), body);
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
    },
  });
}

function buildBell206(spec) {
  return buildHeli(spec, {
    color: 0xf3f3f3, accent: 0xc0282b,
    pod: [[1.4, 0.35], [0.6, 0.75], [-0.4, 0.86], [-1.3, 0.82], [-1.9, 0.6], [-2.2, 0.3], [-2.3, 0.08]], podSx: 0.78, podSy: 1.0, podY: 0.25,
    boom: [[7.2, 0.1], [4, 0.18], [1.5, 0.3], [1.2, 0.28]], boomY: 0.55,
    rotorY: 1.95, rotorZ: -0.3, mastH: 0.6, chord: 0.33,
    tailRotor: [-0.18, 0.95, 7.1], tailR: 0.8,
    fin: [[6.4, 0.5], [7.0, 1.55], [7.3, 1.55], [7.25, 0.05], [6.8, -0.1]],
    hstab: [[0, 5.0], [0.9, 5.1], [0.9, 5.45], [0, 5.5]], hstabY: 0.55,
    nav: [new THREE.Vector3(-0.9, 0.55, 5.3), new THREE.Vector3(0.9, 0.55, 5.3), new THREE.Vector3(0, 0.9, 7.3)],
    crew: [], helmet: 0x2a2a2a,
    light: new THREE.Vector3(0, -0.4, -1.8),
    glass: (c, gm, body) => {
      const front = mesh(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.7, 0.82, 1.15), gm);
      front.rotation.x = -Math.PI / 2 + 0.2; front.position.set(0, 0.35, -1.2); c.grp.add(front); c.parts.hide.push(front);
      for (const sx of [1, -1]) {
        const w = mesh(fin([[-1.0, 0.1], [-1.0, 0.95], [0.2, 0.95], [0.2, 0.15]], 0.02), gm);
        w.position.x = sx * 0.66; c.grp.add(w); c.parts.hide.push(w);
        const st = mesh(new THREE.BoxGeometry(0.02, 0.1, 3.2), mat(0xc0282b));
        st.position.set(sx * 0.67, 0.0, -0.4); c.grp.add(st); c.parts.hide.push(st);
      }
      const top = mesh(fin([[-0.9, 0.9], [-0.6, 1.4], [1.1, 1.4], [1.6, 0.8]], 0.8), body);
      top.userData.keep = true; c.grp.add(top);
    },
    extras: (c, body, accent) => {
      const sm = mat(0xb8bcc0, { m: 0.7, r: 0.3 });
      for (const sx of [1, -1]) {
        const sk = mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 6).rotateX(Math.PI / 2), sm);
        sk.position.set(sx * 0.98, -1.1, -0.2); sk.userData.keep = true; c.grp.add(sk);
        const tip = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6).rotateX(Math.PI / 2 - 0.6), sm);
        tip.position.set(sx * 0.98, -1.0, -1.75); tip.userData.keep = true; c.grp.add(tip);
      }
      for (const z of [-1.0, 0.7]) {
        const cr = mesh(new THREE.TorusGeometry(1.0, 0.045, 5, 12, Math.PI).rotateZ(0), sm);
        cr.scale.set(1, 0.95, 1); cr.position.set(0, -1.1, z); cr.rotation.y = 0; cr.userData.keep = true;
        cr.rotation.x = Math.PI; cr.rotation.z = 0; cr.position.y = -1.1; c.grp.add(cr);
        cr.rotation.set(0, 0, 0); cr.scale.set(0.98, 0.9, 1); cr.position.y = -1.1;
      }
    },
  });
}

function buildS76(spec) {
  const c = buildHeli(spec, {
    color: 0x1f2f4a, accent: 0xe6e6e6, metal: 0.4,
    pod: [[2.6, 0.5], [0.6, 0.98], [-1.5, 1.02], [-3.0, 0.88], [-4.1, 0.55], [-4.6, 0.15]], podSx: 0.92, podSy: 1.0, podY: 0.35,
    boom: [[9.0, 0.15], [5.5, 0.3], [2.6, 0.5], [2.2, 0.45]], boomY: 0.75,
    rotorY: 2.3, rotorZ: -0.6, mastH: 0.7, chord: 0.45,
    tailRotor: [-0.3, 1.6, 9.0], tailR: 1.2, tailBlades: 4,
    fin: [[7.8, 0.6], [8.8, 2.2], [9.25, 2.2], [9.2, 0.4]],
    hstab: [[0, 7.6], [1.5, 7.7], [1.5, 8.2], [0, 8.3]], hstabY: 0.75,
    nav: [new THREE.Vector3(-1.5, 0.75, 7.9), new THREE.Vector3(1.5, 0.75, 7.9), new THREE.Vector3(0, 2.2, 9.3)],
    crew: [[-0.42, 0.9, -2.8]], helmet: 0x1a1a1a,
    light: new THREE.Vector3(0, -0.5, -3.6),
    glass: (c, gm, body) => {
      for (const sx of [1, -1]) {
        const w = mesh(fin([[-4.2, 0.4], [-3.4, 1.15], [-2.4, 1.15], [-2.4, 0.3]], 0.9), gm);
        w.position.x = sx * 0.01; c.grp.add(w); c.parts.hide.push(w);
        for (let i = 0; i < 4; i++) {
          const win = mesh(new THREE.BoxGeometry(0.02, 0.45, 0.6), gm);
          win.position.set(sx * 0.93, 0.6, -1.6 + i * 0.85); c.grp.add(win);
        }
        const st = mesh(new THREE.BoxGeometry(0.02, 0.12, 6.0), mat(0xe6e6e6));
        st.position.set(sx * 0.925, 0.1, -0.8); c.grp.add(st); c.parts.hide.push(st);
      }
      const top = mesh(fin([[-1.6, 1.0], [-1.2, 1.6], [1.5, 1.6], [2.3, 1.0]], 1.0), body);
      top.userData.keep = true; c.grp.add(top);
    },
  });
  addGear(c, spec, 0, -0.5, -3.4, 0.22, 0.14, 'x', -1.6, { strut: 0.05 });
  for (const sx of [1, -1]) addGear(c, spec, sx * 1.15, -0.5, 0.5, 0.3, 0.18, 'x', -1.6, { strut: 0.06 });
  return c;
}

const BUILDERS = {
  c172: buildC172, extra: buildExtra, spitfire: buildSpitfire, p51: buildP51,
  b737: buildB737, learjet: buildLearjet,
  f14: buildF14, f16: buildF16, f18: buildF18, f22: buildF22, mig29: buildMig29, mig21: buildMig21,
  apache: buildApache, bell206: buildBell206, s76: buildS76,
};

export function buildModel(id) {
  const spec = AIRCRAFT_BY_ID[id];
  const c = BUILDERS[id](spec);
  c.parts.eye = new THREE.Vector3(...spec.eye);
  c.group = c.grp;
  c.gearHeight = spec.gearH;
  return c;
}
