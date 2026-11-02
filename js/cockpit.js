// Interiores de cabina detallados: estructura, mandos animados, piloto
// (piernas y guantes), paneles con instrumentos dibujados en canvas y HUD.
import * as THREE from 'three';
import * as I from './instruments.js?v=9';
import { mat, glassMat } from './models.js?v=9';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function consoleTexture(seed = 3, base = '#2c2f33') {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 512);
  let k = seed;
  const rnd = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
  for (let y = 10; y < 500; y += 70 + rnd() * 30) {
    const h = 50 + rnd() * 20;
    g.fillStyle = '#1b1d20'; g.fillRect(10, y, 236, h);
    g.strokeStyle = '#555'; g.strokeRect(10, y, 236, h);
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const x = 30 + i * (200 / n);
      const t = rnd();
      if (t < 0.4) { g.fillStyle = '#777'; g.beginPath(); g.arc(x + 10, y + h / 2, 8, 0, 7); g.fill(); g.fillStyle = '#ddd'; g.fillRect(x + 9, y + h / 2 - 12, 3, 10); }
      else if (t < 0.7) { g.fillStyle = '#111'; g.beginPath(); g.arc(x + 10, y + h / 2, 11, 0, 7); g.fill(); g.strokeStyle = '#999'; g.stroke(); }
      else { g.fillStyle = ['#c22', '#2a2', '#cc2', '#888'][Math.floor(rnd() * 4)]; g.fillRect(x, y + h / 2 - 7, 22, 14); }
    }
    g.fillStyle = '#bbb'; g.font = '10px sans-serif'; g.fillText(['FUEL', 'ELEC', 'COMM', 'NAV', 'ECS', 'EXT LT', 'IFF', 'AUDIO', 'HYD', 'ANTI-ICE'][Math.floor(rnd() * 10)], 16, y + 12);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Cockpit {
  constructor(spec, mapCanvas) {
    this.spec = spec;
    this.mapCanvas = mapCanvas;
    this.group = new THREE.Group();
    this.panels = [];
    this.anim = { sticks: [], yokes: [], throttles: [], collectives: [], pedals: [] };
    this.hud = null;
    this.timer = 0; this.hudTimer = 0;
    this.M = {
      dark: mat(0x1d1f22, { r: 0.8, m: 0.2 }), panel: mat(0x2b2e31, { r: 0.75, m: 0.2 }), frame: mat(0x2a2c2e, { r: 0.6, m: 0.4 }),
      seat: mat(0x3a3a33, { r: 0.9, m: 0 }), suit: mat(0x4a5638, { r: 0.95, m: 0 }), glove: mat(0x2a2420, { r: 0.9, m: 0 }),
      boot: mat(0x151515, { r: 0.7, m: 0 }), metal: mat(0x8a8e92, { r: 0.35, m: 0.8 }), black: mat(0x0e0f10, { r: 0.6, m: 0.2 }),
      yellow: mat(0xe0b000), red: mat(0xb01010), white: mat(0xe8e8e2, { r: 0.7, m: 0 }), beige: mat(0xb8ae98, { r: 0.9, m: 0 }),
      green: mat(0x4e5c40, { r: 0.85, m: 0.1 }), teal: mat(0x3f6e70, { r: 0.8, m: 0.1 }), grey: mat(0x5c6064, { r: 0.8, m: 0.1 }),
    };
    (STYLES[spec.cockpit] || STYLES.fighter)(this, spec);
    this.group.traverse(o => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } });
  }

  box(w, h, d, x, y, z, m, rx = 0, ry = 0, rz = 0, parent = this.group) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
    parent.add(o); return o;
  }
  bar(a, b, r, m, parent = this.group) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), m);
    o.position.copy(a).addScaledVector(d, 0.5);
    o.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    parent.add(o); return o;
  }
  arc(rx, ry, tube, x, y, z, m, arcA = Math.PI) {
    const o = new THREE.Mesh(new THREE.TorusGeometry(1, tube, 5, 20, arcA), m);
    o.scale.set(rx, ry, 1); o.position.set(x, y, z);
    if (arcA < Math.PI) o.rotation.z = (Math.PI - arcA) / 2;
    this.group.add(o); return o;
  }

  addPanel({ w, h, cw, ch, x, y, z, rx = -0.15, draw, ry = 0 }) {
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.1 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z); p.rotation.set(rx, ry, 0);
    this.group.add(p);
    const entry = { cv, g: cv.getContext('2d'), tex, draw, mat: m };
    this.panels.push(entry);
    return entry;
  }

  addHUD(x, y, z, size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const tex = new THREE.CanvasTexture(cv);
    // brillo por encima de 1 y sin tone mapping: legible contra el cielo y realzado por el bloom
    const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.6, 2.2), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    p.position.set(x, y, z); p.userData.noShadow = true; p.renderOrder = 5;
    this.group.add(p);
    const comb = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.9, size * 0.8), glassMat(0x6a8a70, 0.12));
    comb.position.set(x, y - size * 0.05, z + 0.03); comb.rotation.x = 0.35; comb.userData.noShadow = true;
    this.group.add(comb);
    this.box(size * 0.6, 0.04, 0.12, x, y - size * 0.5, z + 0.05, this.M.black);
    this.hud = { cv, g: cv.getContext('2d'), tex };
  }

  canopyGlass(w, h, len, y, z) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(w, h, len), glassMat(0x8899aa, 0.05));
    g.position.set(0, y, z); g.userData.noShadow = true; g.castShadow = false;
    this.group.add(g);
  }

  // Palanca central/lateral con guante
  stick(x, y, z, len, side = false) {
    const p = new THREE.Group(); p.position.set(x, y, z);
    this.bar(V(0, 0, 0), V(0, len, 0), side ? 0.018 : 0.016, this.M.black, p);
    const grip = this.box(0.045, 0.11, 0.05, 0, len + 0.04, 0, this.M.black, 0, 0, 0, p);
    this.box(0.012, 0.015, 0.012, 0, len + 0.1, -0.015, this.M.red, 0, 0, 0, p);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6).scale(1, 1.3, 1.1), this.M.glove); gl.position.set(0.005, len + 0.03, 0.02); p.add(gl);
    if (!side) this.box(0.08, 0.04, 0.08, 0, 0, 0, this.M.dark, 0, 0, 0, p);
    this.group.add(p);
    this.anim.sticks.push({ obj: p, k: side ? 0.12 : 0.28 });
    return p;
  }
  throttle(x, y, z, len = 0.13, n = 1, gap = 0.05, knob = this.M.black) {
    const base = this.box(0.08 + gap * (n - 1), 0.04, 0.22, x + gap * (n - 1) / 2, y - 0.02, z, this.M.dark);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Group(); p.position.set(x + i * gap, y, z);
      this.bar(V(0, 0, 0), V(0, len, 0), 0.012, this.M.metal, p);
      this.box(0.05, 0.035, 0.06, 0, len, 0, knob, 0, 0, 0, p);
      if (i === 0) { const gl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6).scale(1.1, 1, 1.2), this.M.glove); gl.position.set(n > 1 ? gap * (n - 1) / 2 : 0, len + 0.03, 0.01); p.add(gl); }
      this.group.add(p);
      this.anim.throttles.push({ obj: p });
    }
    return base;
  }
  yoke(x, y, z, colLen = 0.3) {
    const col = new THREE.Group(); col.position.set(x, y, z);
    this.bar(V(0, 0, 0), V(0, 0, colLen), 0.02, this.M.metal, col);
    const wheel = new THREE.Group(); wheel.position.z = colLen;
    this.box(0.04, 0.06, 0.04, 0, 0, 0, this.M.black, 0, 0, 0, wheel);
    this.box(0.3, 0.035, 0.03, 0, 0, 0, this.M.black, 0, 0, 0, wheel);
    for (const sx of [-1, 1]) {
      this.box(0.035, 0.13, 0.035, sx * 0.15, 0.035, 0, this.M.black, 0, 0, 0, wheel);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6).scale(1, 1.3, 1), this.M.glove);
      gl.position.set(sx * 0.15, 0.06, 0.01); wheel.add(gl);
    }
    col.add(wheel);
    this.group.add(col);
    this.anim.yokes.push({ obj: col, wheel, z0: z });
    return col;
  }
  collective(x, y, z, len = 0.45) {
    const p = new THREE.Group(); p.position.set(x, y, z);
    this.bar(V(0, 0, 0), V(0, 0.05, -len), 0.018, this.M.black, p);
    this.box(0.05, 0.06, 0.12, 0, 0.06, -len, this.M.dark, 0, 0, 0, p);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6).scale(1, 1.1, 1.3), this.M.glove); gl.position.set(0, 0.06, -len + 0.02); p.add(gl);
    this.group.add(p);
    this.anim.collectives.push({ obj: p });
  }
  legs(x, seatY, seatZ, pedalY, pedalZ, spread = 0.12, m = this.M.suit) {
    for (const sx of [-1, 1]) {
      const hip = V(x + sx * spread, seatY + 0.08, seatZ);
      const knee = V(x + sx * (spread + 0.02), seatY + 0.2, seatZ + (pedalZ - seatZ) * 0.55);
      const foot = V(x + sx * (spread + 0.02), pedalY + 0.05, pedalZ + 0.05);
      const t = this.bar(hip, knee, 0.075, m); t.scale.set(1, 1, 0.9);
      this.bar(knee, foot, 0.06, m);
      this.box(0.1, 0.09, 0.26, foot.x, foot.y, foot.z - 0.05, this.M.boot);
      const pedal = this.box(0.09, 0.14, 0.03, foot.x, pedalY + 0.05, pedalZ - 0.1, this.M.metal, -0.3);
      this.anim.pedals.push({ obj: pedal, z0: pedal.position.z, sx });
    }
    // torso (visible al mirar abajo)
    this.box(0.4, 0.5, 0.24, x, seatY + 0.35, seatZ + 0.05, m);
    this.box(0.06, 0.5, 0.25, x - 0.1, seatY + 0.36, seatZ + 0.04, this.M.dark);
    this.box(0.06, 0.5, 0.25, x + 0.1, seatY + 0.36, seatZ + 0.04, this.M.dark);
  }
  seat(x, y, z, w = 0.48, backH = 0.75, m = this.M.seat, headbox = false) {
    this.box(w, 0.1, 0.48, x, y, z, m);
    this.box(w, backH, 0.1, x, y + backH / 2, z + 0.26, m, 0.12);
    if (headbox) {
      this.box(w * 0.85, 0.36, 0.24, x, y + backH + 0.15, z + 0.36, this.M.dark);
      this.box(w * 0.3, 0.05, 0.05, x, y + backH + 0.36, z + 0.25, this.M.yellow);
    }
  }

  setNight(n) {
    for (const p of this.panels) p.mat.emissiveIntensity = 0.3 + n * 0.55;
  }

  update(dt, s, input) {
    for (const st of this.anim.sticks) { st.obj.rotation.x = input.pitch * st.k; st.obj.rotation.z = -input.roll * st.k; }
    for (const y of this.anim.yokes) { y.obj.position.z = y.z0 + input.pitch * 0.08; y.wheel.rotation.z = -input.roll * 0.9; }
    for (const t of this.anim.throttles) t.obj.rotation.x = -(s.throttle - 0.4) * 1.1;
    for (const c of this.anim.collectives) c.obj.rotation.x = s.throttle * 0.35;
    for (const p of this.anim.pedals) p.obj.position.z = p.z0 - input.yaw * 0.05 * p.sx;
    this.timer -= dt; this.hudTimer -= dt;
    if (this.timer <= 0) {
      this.timer = 1 / 15;
      for (const p of this.panels) { p.draw(p.g, p.cv.width, p.cv.height, s, this.mapCanvas); p.tex.needsUpdate = true; }
    }
    if (this.hud && this.hudTimer <= 0) {
      this.hudTimer = 1 / 30;
      I.fighterHUD(this.hud.g, 512, 512, s);
      this.hud.tex.needsUpdate = true;
    }
  }
}

// ======================= Paneles =======================
const PANELS = {
  fighter(g, W, H, s, map) {
    g.fillStyle = '#2a2d30'; g.fillRect(0, 0, W, H);
    I.mfdFrame(g, 40, 170, 290, 290, ['MAP', 'HSD', 'SMS', 'TGP', 'DTE']);
    I.mapDisplay(g, 40, 170, 290, 290, s, map);
    I.mfdFrame(g, 694, 170, 290, 290, ['HSI', 'FCR', 'TEST', 'WPN', 'FLIR']);
    I.nd(g, 694, 170, 290, 290, s);
    I.ufc(g, 400, 15, 224, 170, s);
    I.attitude(g, 445, 290, 55, s); I.asi(g, 580, 260, 38, s); I.altimeter(g, 580, 350, 38, s);
    I.warnPanel(g, 380, 400, 264, 100, s);
  },
  f14(g, W, H, s, map) {
    g.fillStyle = '#34383b'; g.fillRect(0, 0, W, H);
    I.asi(g, 90, 120, 62, s); I.attitude(g, 245, 140, 82, s); I.altimeter(g, 90, 280, 62, s);
    I.vsi(g, 245, 330, 60, s); I.heading(g, 90, 430, 55, s);
    I.mfdFrame(g, 380, 150, 264, 264, ['TID', '', '', '', '']);
    I.mapDisplay(g, 380, 150, 264, 264, s, map);
    I.warnPanel(g, 390, 20, 244, 100, s);
    I.tach(g, 770, 110, 58, s, 'RPM %', 11); I.tach(g, 910, 110, 58, s, 'RPM %', 11);
    I.smallGauge(g, 770, 260, 50, s.ab ? 0.95 : s.rpm * 0.7, 'EGT'); I.smallGauge(g, 910, 260, 50, s.ab ? 0.95 : s.rpm * 0.7, 'EGT');
    I.smallGauge(g, 840, 400, 60, s.fuelFrac, 'FUEL');
    I.gearPanel(g, 690, 380, 100, 100, s);
  },
  heliGlass(g, W, H, s, map) {
    g.fillStyle = '#2b2e2a'; g.fillRect(0, 0, W, H);
    I.mfdFrame(g, 40, 120, 300, 300, ['FLT', 'TSD', 'WPN', 'FUEL', 'ENG']); I.pfd(g, 40, 120, 300, 300, s);
    I.mfdFrame(g, 684, 120, 300, 300, ['TSD', 'MAP', 'COM', 'ASE', 'UTIL']); I.mapDisplay(g, 684, 120, 300, 300, s, map);
    I.smallGauge(g, 450, 150, 60, s.throttle, 'TRQ %'); I.smallGauge(g, 575, 150, 60, s.rpm, 'NR %');
    I.altimeter(g, 450, 300, 55, s); I.vsi(g, 575, 300, 55, s);
    I.warnPanel(g, 400, 390, 224, 100, s);
  },
};

// ======================= Estilos de cabina =======================
const STYLES = {
  fighter(c, spec) {
    const M = c.M;
    const framed = spec.id !== 'f16';
    const tub = M.grey;
    // bañera y laterales
    c.box(0.04, 0.55, 1.7, -0.5, -0.65, -0.15, tub); c.box(0.04, 0.55, 1.7, 0.5, -0.65, -0.15, tub);
    c.box(1.0, 0.04, 1.8, 0, -1.0, -0.2, M.dark);
    // consolas laterales con botones
    const ct = new THREE.MeshStandardMaterial({ map: consoleTexture(5, '#2c2f33'), roughness: 0.8 });
    const ct2 = new THREE.MeshStandardMaterial({ map: consoleTexture(9, '#2c2f33'), roughness: 0.8 });
    c.box(0.2, 0.26, 0.95, -0.36, -0.62, -0.05, tub); c.box(0.2, 0.26, 0.95, 0.36, -0.62, -0.05, tub);
    const tl = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.93), ct); tl.rotation.x = -Math.PI / 2; tl.position.set(-0.36, -0.488, -0.05); c.group.add(tl);
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.93), ct2); tr.rotation.x = -Math.PI / 2; tr.position.set(0.36, -0.488, -0.05); c.group.add(tr);
    // rieles de cúpula
    c.box(0.09, 0.1, 1.9, -0.48, -0.36, -0.2, M.frame); c.box(0.09, 0.1, 1.9, 0.48, -0.36, -0.2, M.frame);
    // panel frontal
    const pw = 0.9, ph = 0.45;
    c.box(pw + 0.04, ph + 0.04, 0.06, 0, -0.45, -0.76, M.panel, -0.15);
    c.addPanel({ w: pw, h: ph, cw: 1024, ch: 512, x: 0, y: -0.45, z: -0.725, rx: -0.15, draw: PANELS[spec.panel] || PANELS.fighter });
    // visera / guardasol
    c.box(0.92, 0.05, 0.32, 0, -0.205, -0.86, M.dark);
    c.box(0.6, 0.08, 0.06, 0, -0.23, -0.71, M.dark);
    // HUD
    c.addHUD(0, -0.05, -0.78, 0.25);
    // cúpula
    if (framed) {
      c.arc(0.5, 0.58, 0.03, 0, -0.36, -0.66, M.frame);
      c.bar(V(-0.44, -0.33, -0.7), V(-0.12, 0.13, -1.25), 0.025, M.frame);
      c.bar(V(0.44, -0.33, -0.7), V(0.12, 0.13, -1.25), 0.025, M.frame);
      for (const x of [-0.18, 0, 0.18]) c.box(0.08, 0.035, 0.02, x, 0.2, -0.64, M.metal, 0.3);
    }
    c.arc(0.52, 0.62, 0.035, 0, -0.36, 0.62, M.frame);
    c.canopyGlass(0.5, 0.6, 1.6, -0.36, -0.1);
    // asiento eyectable
    c.seat(0, -0.82, 0.08, 0.5, 0.75, M.seat, true);
    const hd = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 5, 10), M.yellow); hd.position.set(0, -0.74, -0.18); hd.rotation.x = Math.PI / 2; c.group.add(hd);
    // piloto
    c.legs(0, -0.82, 0.05, -1.0, -0.72, 0.12, M.suit);
    // mandos
    if (spec.sideStick) c.stick(0.36, -0.49, -0.12, 0.08, true);
    else c.stick(0, -0.82, -0.32, 0.3);
    c.throttle(-0.36, -0.49, -0.12, 0.1, spec.id === 'f16' ? 1 : 2, 0.04);
  },

  heliApache(c, spec) {
    const M = c.M;
    const og = mat(0x2f352a, { r: 0.9 });
    c.box(0.04, 0.6, 1.6, -0.46, -0.62, -0.1, og); c.box(0.04, 0.6, 1.6, 0.46, -0.62, -0.1, og);
    c.box(0.95, 0.04, 1.8, 0, -1.0, -0.2, M.dark);
    c.box(0.08, 0.08, 1.8, -0.45, -0.32, -0.1, M.frame); c.box(0.08, 0.08, 1.8, 0.45, -0.32, -0.1, M.frame);
    // marcos de los cristales planos
    c.bar(V(-0.44, -0.3, -0.78), V(-0.34, 0.28, -0.55), 0.018, M.frame);
    c.bar(V(0.44, -0.3, -0.78), V(0.34, 0.28, -0.55), 0.018, M.frame);
    c.bar(V(-0.34, 0.28, -0.55), V(0.34, 0.28, -0.55), 0.018, M.frame);
    c.bar(V(-0.34, 0.28, -0.55), V(-0.34, 0.3, 0.6), 0.018, M.frame);
    c.bar(V(0.34, 0.28, -0.55), V(0.34, 0.3, 0.6), 0.018, M.frame);
    c.bar(V(-0.45, -0.3, 0.1), V(-0.34, 0.29, 0.1), 0.018, M.frame);
    c.bar(V(0.45, -0.3, 0.1), V(0.34, 0.29, 0.1), 0.018, M.frame);
    c.box(0.7, 0.04, 1.15, 0, 0.31, 0.05, og);
    c.bar(V(-0.45, -0.3, 0.6), V(-0.34, 0.3, 0.6), 0.018, M.frame);
    c.bar(V(0.45, -0.3, 0.6), V(0.34, 0.3, 0.6), 0.018, M.frame);
    // panel
    c.box(0.74, 0.38, 0.05, 0, -0.5, -0.66, og, -0.25);
    c.addPanel({ w: 0.7, h: 0.35, cw: 1024, ch: 512, x: 0, y: -0.5, z: -0.63, rx: -0.25, draw: PANELS.heliGlass });
    c.box(0.76, 0.06, 0.2, 0, -0.3, -0.72, M.dark);
    c.addHUD(0, -0.2, -0.64, 0.2);
    // artillero delantero y su cabina
    c.box(0.9, 0.32, 0.05, 0, -0.84, -0.85, og);
    const gunner = new THREE.Group();
    gunner.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(0x2f3a2a)));
    const vis = new THREE.Mesh(new THREE.SphereGeometry(0.152, 10, 6, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.35, Math.PI * 0.3), M.black); vis.rotation.y = Math.PI; gunner.add(vis);
    const tor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.28), mat(0x4a5638)); tor.position.y = -0.36; gunner.add(tor);
    gunner.position.set(0, -0.56, -1.4); c.group.add(gunner);
    c.box(0.46, 0.3, 0.08, 0, -0.74, -1.15, M.seat);
    c.bar(V(-0.42, -0.6, -1.0), V(-0.3, -0.05, -1.65), 0.018, M.frame);
    c.bar(V(0.42, -0.6, -1.0), V(0.3, -0.05, -1.65), 0.018, M.frame);
    c.bar(V(-0.3, -0.05, -1.65), V(0.3, -0.05, -1.65), 0.018, M.frame);
    c.canopyGlass(0.45, 0.55, 1.2, -0.3, -0.1);
    c.seat(0, -0.82, 0.12, 0.5, 0.8, M.seat, false);
    c.legs(0, -0.82, 0.08, -1.0, -0.65, 0.12);
    c.stick(0, -0.82, -0.3, 0.32);
    c.collective(-0.32, -0.62, 0.15, 0.4);
  },

};
