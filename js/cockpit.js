// Interiores de cabina detallados: estructura, mandos animados, piloto
// (piernas y guantes), paneles con instrumentos dibujados en canvas y HUD.
import * as THREE from 'three';
import * as I from './instruments.js?v=5';
import { mat, glassMat } from './models.js?v=5';

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
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
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
  classic(g, W, H, s) {
    g.fillStyle = '#2d2f31'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#232527'; g.fillRect(0, 0, W, 14);
    const r = 56;
    I.asi(g, 110, 85, r, s); I.attitude(g, 251, 85, r, s); I.altimeter(g, 392, 85, r, s);
    I.turnCoord(g, 110, 228, r, s); I.heading(g, 251, 228, r, s); I.vsi(g, 392, 228, r, s);
    I.radio(g, 470, 30, 190, 150, s);
    I.gearPanel(g, 480, 200, 90, 100, s);
    I.switches(g, 580, 200, 100, 100, 2, 2, 7);
    I.tach(g, 750, 85, 58, s);
    I.smallGauge(g, 860, 70, 34, s.fuelFrac, 'FUEL'); I.smallGauge(g, 950, 70, 34, 0.55 + s.rpm * 0.2, 'OIL T');
    I.smallGauge(g, 860, 160, 34, 0.6, 'OIL P'); I.smallGauge(g, 950, 160, 34, 0.75, 'AMP');
    I.switches(g, 720, 240, 290, 70, 1, 8, 3);
  },
  aero(g, W, H, s) {
    g.fillStyle = '#d9d9d6'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c4c4c0'; g.fillRect(0, H * 0.82, W, H * 0.18);
    I.asi(g, 200, 160, 120, s); I.altimeter(g, 512, 160, 120, s);
    I.smallGauge(g, 820, 160, 110, s.g, 'G', -4, 10, [[-4, -2, '#d22'], [-2, 6, '#2c2'], [6, 10, '#d22']]);
    I.tach(g, 200, 400, 85, s, 'RPM x100', 30); I.vsi(g, 512, 400, 85, s); I.heading(g, 820, 400, 85, s);
  },
  warbird(g, W, H, s) {
    g.fillStyle = '#121212'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1a1a1a'; g.fillRect(230, 60, 564, 400);
    I.asi(g, 330, 160, 78, s); I.attitude(g, 512, 160, 85, s); I.altimeter(g, 694, 160, 78, s);
    I.turnCoord(g, 330, 360, 70, s); I.heading(g, 512, 370, 75, s); I.vsi(g, 694, 360, 70, s);
    I.tach(g, 115, 130, 78, s, 'RPM x100', 35);
    I.smallGauge(g, 115, 330, 62, 0.3 + s.throttle * 0.6, 'BOOST');
    I.smallGauge(g, 910, 120, 55, 0.55 + s.rpm * 0.2, 'OIL');
    I.smallGauge(g, 910, 280, 55, s.fuelFrac, 'FUEL');
    I.gearPanel(g, 860, 380, 110, 110, s);
    I.switches(g, 40, 430, 180, 70, 1, 4, 11);
  },
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
  glassFighter(g, W, H, s, map) {
    g.fillStyle = '#1f2124'; g.fillRect(0, 0, W, H);
    I.mfdFrame(g, 360, 170, 304, 304, ['NAV', 'TAC', 'SMS', 'FUEL', 'ICAW']);
    I.mapDisplay(g, 360, 170, 304, 304, s, map);
    I.mfdFrame(g, 40, 230, 260, 240, ['PFD', '', '', '', '']);
    I.pfd(g, 40, 230, 260, 240, s);
    I.mfdFrame(g, 724, 230, 260, 240, ['ENG', '', '', '', '']);
    I.eicas(g, 724, 230, 260, 240, s, 2);
    I.ufc(g, 400, 10, 224, 140, s);
    I.warnPanel(g, 60, 40, 220, 140, s);
    I.nd(g, 744, 40, 220, 160, s);
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
  mig(g, W, H, s) {
    g.fillStyle = '#3f6e70'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#365f61'; g.fillRect(300, 40, 424, 440);
    I.attitude(g, 512, 170, 100, s); I.heading(g, 512, 395, 80, s);
    I.asi(g, 370, 150, 62, s); I.altimeter(g, 654, 150, 62, s);
    I.vsi(g, 370, 330, 55, s); I.turnCoord(g, 654, 330, 55, s);
    I.tach(g, 110, 110, 70, s, 'ОБ/МИН %', 11); I.smallGauge(g, 110, 290, 60, s.ab ? 0.95 : s.rpm * 0.7, 'T°');
    I.smallGauge(g, 910, 110, 60, s.fuelFrac, 'ТОПЛИВО'); I.smallGauge(g, 910, 270, 55, (s.g + 3) / 12, 'G');
    I.warnPanel(g, 820, 360, 180, 120, s);
    I.gearPanel(g, 40, 380, 120, 110, s);
  },
  airliner(g, W, H, s, map) {
    g.fillStyle = '#2f3336'; g.fillRect(0, 0, W, H);
    const sz = 250, y = 40;
    const xs = [30, 300, 643, 993, 1263];
    I.mfdFrame(g, xs[0], y, sz, sz, ['', '', '', '', '']); I.pfd(g, xs[0], y, sz, sz, s);
    I.mfdFrame(g, xs[1], y, sz, sz, ['', '', '', '', '']); I.nd(g, xs[1], y, sz, sz, s);
    I.mfdFrame(g, xs[2], y, sz, sz, ['', '', '', '', '']); I.eicas(g, xs[2], y, sz, sz, s, 2);
    I.mfdFrame(g, xs[3], y, sz, sz, ['', '', '', '', '']); I.nd(g, xs[3], y, sz, sz, s);
    I.mfdFrame(g, xs[4], y, sz, sz, ['', '', '', '', '']); I.pfd(g, xs[4], y, sz, sz, s);
    I.gearPanel(g, 560, 120, 70, 100, s);
    I.attitude(g, 950, 160, 26, s);
  },
  heliGlass(g, W, H, s, map) {
    g.fillStyle = '#2b2e2a'; g.fillRect(0, 0, W, H);
    I.mfdFrame(g, 40, 120, 300, 300, ['FLT', 'TSD', 'WPN', 'FUEL', 'ENG']); I.pfd(g, 40, 120, 300, 300, s);
    I.mfdFrame(g, 684, 120, 300, 300, ['TSD', 'MAP', 'COM', 'ASE', 'UTIL']); I.mapDisplay(g, 684, 120, 300, 300, s, map);
    I.smallGauge(g, 450, 150, 60, s.throttle, 'TRQ %'); I.smallGauge(g, 575, 150, 60, s.rpm, 'NR %');
    I.altimeter(g, 450, 300, 55, s); I.vsi(g, 575, 300, 55, s);
    I.warnPanel(g, 400, 390, 224, 100, s);
  },
  heliClassic(g, W, H, s) {
    g.fillStyle = '#1b1c1d'; g.fillRect(0, 0, W, H);
    I.asi(g, 180, 140, 95, s); I.attitude(g, 512, 140, 105, s); I.altimeter(g, 844, 140, 95, s);
    I.smallGauge(g, 140, 380, 80, s.throttle, 'TORQUE'); I.tach(g, 370, 380, 80, s, 'NR / N2', 11);
    I.vsi(g, 654, 380, 80, s); I.heading(g, 884, 380, 80, s);
  },
};

// ======================= Estilos de cabina =======================
const STYLES = {
  fighter(c, spec) {
    const M = c.M;
    const framed = !['f16', 'f22'].includes(spec.id);
    const mig = spec.id.startsWith('mig');
    const tub = mig ? M.teal : M.grey;
    // bañera y laterales
    c.box(0.04, 0.55, 1.7, -0.5, -0.65, -0.15, tub); c.box(0.04, 0.55, 1.7, 0.5, -0.65, -0.15, tub);
    c.box(1.0, 0.04, 1.8, 0, -1.0, -0.2, M.dark);
    // consolas laterales con botones
    const ct = new THREE.MeshStandardMaterial({ map: consoleTexture(5, mig ? '#3a6466' : '#2c2f33'), roughness: 0.8 });
    const ct2 = new THREE.MeshStandardMaterial({ map: consoleTexture(9, mig ? '#3a6466' : '#2c2f33'), roughness: 0.8 });
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
    if (!mig || spec.id === 'mig29') c.addHUD(0, -0.06, -0.78, 0.2);
    else { c.box(0.12, 0.1, 0.1, 0, -0.13, -0.74, M.dark); const r = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.1), glassMat(0x6a8a70, 0.2)); r.position.set(0, -0.04, -0.74); r.rotation.x = 0.5; c.group.add(r); }
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
    c.legs(0, -0.82, 0.05, -1.0, -0.72, 0.12, mig ? M.green : M.suit);
    // mandos
    if (spec.sideStick) c.stick(0.36, -0.49, -0.12, 0.08, true);
    else c.stick(0, -0.82, -0.32, 0.3);
    c.throttle(-0.36, -0.49, -0.12, 0.1, spec.id === 'f16' || spec.id === 'f22' ? 1 : 2, 0.04);
  },

  warbird(c, spec) {
    const M = c.M;
    const p51 = spec.id === 'p51';
    const intr = p51 ? mat(0x6b6f52, { r: 0.9 }) : M.green;
    c.box(0.04, 0.6, 1.5, -0.38, -0.48, -0.15, intr); c.box(0.04, 0.6, 1.5, 0.38, -0.48, -0.15, intr);
    c.box(0.8, 0.04, 1.5, 0, -0.95, -0.2, M.dark);
    c.box(0.07, 0.06, 1.6, -0.37, -0.17, -0.1, M.frame); c.box(0.07, 0.06, 1.6, 0.37, -0.17, -0.1, M.frame);
    // costillas visibles
    for (const z of [-0.5, -0.1, 0.3]) { c.box(0.03, 0.55, 0.03, -0.355, -0.47, z, M.metal); c.box(0.03, 0.55, 0.03, 0.355, -0.47, z, M.metal); }
    c.box(0.72, 0.38, 0.04, 0, -0.29, -0.66, M.black, -0.08);
    c.addPanel({ w: 0.66, h: 0.33, cw: 1024, ch: 512, x: 0, y: -0.29, z: -0.635, rx: -0.08, draw: PANELS.warbird });
    c.box(0.7, 0.05, 0.2, 0, -0.1, -0.72, M.black);
    // mira reflectora
    c.box(0.07, 0.07, 0.12, 0, -0.04, -0.66, M.black);
    const ref = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.09), glassMat(0xaaccaa, 0.18)); ref.position.set(0, 0.04, -0.66); ref.rotation.x = 0.6; c.group.add(ref);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.021, 20), new THREE.MeshBasicMaterial({ color: 0xff7030, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); ring.position.set(0, 0.045, -0.665); ring.userData.noShadow = true; c.group.add(ring);
    // parabrisas blindado con marcos
    c.bar(V(-0.22, -0.12, -0.74), V(-0.15, 0.18, -0.52), 0.018, M.frame);
    c.bar(V(0.22, -0.12, -0.74), V(0.15, 0.18, -0.52), 0.018, M.frame);
    c.bar(V(-0.15, 0.18, -0.52), V(0.15, 0.18, -0.52), 0.018, M.frame);
    c.bar(V(-0.36, -0.16, -0.66), V(-0.15, 0.18, -0.52), 0.018, M.frame);
    c.bar(V(0.36, -0.16, -0.66), V(0.15, 0.18, -0.52), 0.018, M.frame);
    const wsg = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.33), glassMat(0x99aabb, 0.08)); wsg.position.set(0, 0.03, -0.63); wsg.rotation.x = -0.6; wsg.userData.noShadow = true; c.group.add(wsg);
    if (!p51) {
      c.box(0.14, 0.04, 0.02, 0, 0.22, -0.5, M.metal); // retrovisor
      c.arc(0.37, 0.4, 0.02, 0, -0.17, 0.2, M.frame);
      c.arc(0.37, 0.4, 0.02, 0, -0.17, -0.25, M.frame);
    } else {
      c.arc(0.42, 0.5, 0.02, 0, -0.17, 0.75, M.frame);
    }
    c.canopyGlass(0.38, p51 ? 0.48 : 0.42, 0.9, -0.17, 0.0);
    // blindaje y asiento
    c.box(0.36, 0.42, 0.04, 0, 0.0, 0.32, M.dark);
    c.seat(0, -0.78, 0.05, 0.42, 0.6, mat(0x5a3a2a));
    c.legs(0, -0.78, 0.02, -0.95, -0.7, 0.11, mat(0x6b5a40));
    // palanca de pala
    const st = c.stick(0, -0.82, -0.32, 0.3);
    const tor = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 12), M.black); tor.position.set(0, 0.36, 0); st.add(tor);
    c.throttle(-0.33, -0.36, -0.15, 0.12, 1, 0.04, mat(0x222222));
    c.box(0.06, 0.15, 0.4, -0.35, -0.42, -0.15, intr);
  },

  aero(c, spec) {
    const M = c.M;
    const w = mat(0xd9d9d6, { r: 0.8 });
    c.box(0.04, 0.6, 1.5, -0.38, -0.5, -0.1, w); c.box(0.04, 0.6, 1.5, 0.38, -0.5, -0.1, w);
    c.box(0.8, 0.04, 1.6, 0, -0.95, -0.2, M.dark);
    c.box(0.07, 0.05, 1.8, -0.37, -0.2, -0.1, mat(0xd0202a)); c.box(0.07, 0.05, 1.8, 0.37, -0.2, -0.1, mat(0xd0202a));
    c.box(0.58, 0.3, 0.04, 0, -0.33, -0.7, w, -0.1);
    c.addPanel({ w: 0.55, h: 0.275, cw: 1024, ch: 512, x: 0, y: -0.33, z: -0.675, rx: -0.1, draw: PANELS.aero });
    c.box(0.6, 0.04, 0.15, 0, -0.18, -0.75, M.dark);
    c.arc(0.4, 0.5, 0.015, 0, -0.2, -0.85, mat(0xd0202a));
    c.canopyGlass(0.4, 0.5, 1.2, -0.2, 0.1);
    c.seat(0, -0.8, 0.1, 0.42, 0.65, mat(0x222222));
    c.legs(0, -0.8, 0.05, -0.95, -0.75, 0.11, mat(0x1d2a44));
    c.stick(0, -0.85, -0.3, 0.32);
    c.throttle(-0.33, -0.4, -0.15, 0.1);
  },

  light(c, spec) {
    const M = c.M; const E = spec.eye;
    const L = (x, y, z) => V(x - E[0], y - E[1], z - E[2]);
    const B = (w, h, d, x, y, z, m, rx = 0) => c.box(w, h, d, x - E[0], y - E[1], z - E[2], m, rx);
    const inter = mat(0x8a8478, { r: 0.95, m: 0 });
    const head = mat(0xd8d2c4, { r: 0.95, m: 0 });
    // suelo, paredes, techo
    B(1.12, 0.04, 2.4, 0, -0.18, -0.4, mat(0x3a3530));
    B(0.04, 0.85, 2.3, -0.56, 0.25, -0.45, inter); B(0.04, 0.85, 2.3, 0.56, 0.25, -0.45, inter);
    B(0.06, 0.06, 1.6, -0.55, 0.68, -0.4, inter); B(0.06, 0.06, 1.6, 0.55, 0.68, -0.4, inter);
    B(1.12, 0.04, 1.95, 0, 1.2, -0.2, head);
    B(0.9, 0.06, 0.25, 0, 1.17, -1.05, head);
    // apoyabrazos en puertas
    B(0.08, 0.06, 0.5, -0.52, 0.42, -0.6, mat(0x5a544a)); B(0.08, 0.06, 0.5, 0.52, 0.42, -0.6, mat(0x5a544a));
    // montantes del parabrisas y puertas
    c.bar(L(-0.53, 0.62, -1.86), L(-0.51, 1.19, -1.16), 0.03, inter);
    c.bar(L(0.53, 0.62, -1.86), L(0.51, 1.19, -1.16), 0.03, inter);
    c.bar(L(-0.555, 0.66, 0.42), L(-0.555, 1.19, 0.42), 0.035, inter);
    c.bar(L(0.555, 0.66, 0.42), L(0.555, 1.19, 0.42), 0.035, inter);
    c.bar(L(0, 0.64, -1.84), L(0, 1.18, -1.18), 0.012, inter);
    // panel y guardasol
    B(1.1, 0.4, 0.06, 0, 0.42, -1.47, M.panel, -0.12);
    c.addPanel({ w: 1.08, h: 0.338, cw: 1024, ch: 320, x: -E[0], y: 0.42 - E[1], z: -1.41 - E[2], rx: -0.12, draw: PANELS.classic });
    B(1.1, 0.05, 0.25, 0, 0.6, -1.55, M.dark);
    B(1.1, 0.25, 0.3, 0, 0.12, -1.55, M.dark);
    // brújula magnética sobre el guardasol
    B(0.06, 0.05, 0.06, 0, 0.66, -1.52, M.black);
    // cuadrante central (gases, mezcla)
    const thr = c.throttle(-E[0] - 0.02, 0.28 - E[1], -1.35 - E[2], 0.07, 1, 0, mat(0x111111));
    const mix = c.box(0.025, 0.025, 0.08, -E[0] + 0.08, 0.28 - E[1], -1.32 - E[2], M.red);
    // cuernos (yokes) piloto y copiloto
    c.yoke(-0.28 - E[0], 0.46 - E[1], -1.42 - E[2], 0.3);
    c.yoke(0.28 - E[0], 0.46 - E[1], -1.42 - E[2], 0.3);
    // asientos
    c.seat(-0.28 - E[0], 0.12 - E[1], -0.5 - E[2], 0.45, 0.7, mat(0x4a4038));
    c.seat(0.28 - E[0], 0.12 - E[1], -0.5 - E[2], 0.45, 0.7, mat(0x4a4038));
    B(1.0, 0.12, 0.45, 0, 0.12, 0.45, mat(0x4a4038)); B(1.0, 0.6, 0.1, 0, 0.45, 0.72, mat(0x4a4038));
    c.legs(-0.28 - E[0], 0.12 - E[1], -0.5 - E[2], -0.15 - E[1], -1.25 - E[2], 0.11, mat(0x2a3a5a));
    // palanca de flaps
    B(0.05, 0.03, 0.02, 0.1, 0.27, -1.37, M.white);
  },

  airliner(c, spec) {
    const M = c.M;
    const k = spec.id === 'learjet' ? 0.8 : 1;
    const cx = -spec.eye[0];
    const wall = mat(0x8e9396, { r: 0.85, m: 0.1 }), wall2 = mat(0x6e7376, { r: 0.85, m: 0.1 });
    const hw = 1.0 * k;
    // suelo, techo, paredes
    c.box(2.1 * k, 0.04, 2.4, cx, -1.05, 0.1, mat(0x2d3032));
    c.box(2.1 * k, 0.04, 1.6, cx, 0.5, 0.5, wall);
    c.box(0.04, 0.78, 2.2, cx - hw, -0.66, 0.1, wall); c.box(0.04, 0.78, 2.2, cx + hw, -0.66, 0.1, wall);
    c.box(0.04, 0.25, 2.0, cx - hw * 0.98, 0.38, 0.3, wall); c.box(0.04, 0.25, 2.0, cx + hw * 0.98, 0.38, 0.3, wall);
    c.box(2.1 * k, 1.6, 0.05, cx, -0.25, 1.2, wall2);
    c.box(0.6, 1.4, 0.03, cx, -0.32, 1.17, mat(0x55595c)); // puerta
    // ventanas: montantes
    const fy0 = -0.28, fy1 = 0.25;
    c.box(2.0 * k, 0.07, 0.07, cx, fy0, -0.92, M.frame);
    c.box(1.9 * k, 0.07, 0.07, cx, fy1, -0.68, M.frame);
    for (const x of [-0.95 * k, 0, 0.95 * k]) c.bar(V(cx + x, fy0, -0.92), V(cx + x * 0.97, fy1, -0.68), 0.045, M.frame);
    for (const sx of [-1, 1]) {
      c.bar(V(cx + sx * hw, fy0, -0.5), V(cx + sx * hw * 0.98, fy1, -0.4), 0.04, M.frame);
      c.bar(V(cx + sx * hw, fy0, 0.2), V(cx + sx * hw * 0.98, fy1, 0.25), 0.04, M.frame);
      c.box(0.05, 0.06, 1.4, cx + sx * hw, fy0, -0.2, M.frame);
      c.box(0.05, 0.06, 1.2, cx + sx * hw * 0.98, fy1, -0.2, M.frame);
      // pared trasera de ventanas
      c.box(0.04, 0.55, 0.9, cx + sx * hw, 0.0, 0.75, wall);
      c.bar(V(cx + sx * 0.95 * k, fy0, -0.92), V(cx + sx * hw, fy0, -0.5), 0.04, M.frame);
    }
    // techo inclinado frontal con panel superior
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(1.0 * k, 0.6), new THREE.MeshStandardMaterial({ map: consoleTexture(21, '#3a3f44'), roughness: 0.8 }));
    ov.position.set(cx, 0.4, -0.25); ov.rotation.x = Math.PI / 2 + 0.5; c.group.add(ov);
    c.box(2.0 * k, 0.04, 0.5, cx, 0.32, -0.45, wall, 0.5);
    // guardasol con MCP
    c.box(2.0 * k, 0.08, 0.38, cx, -0.32, -0.78, M.dark);
    const mcp = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * k, 0.07), new THREE.MeshStandardMaterial({ map: consoleTexture(31, '#3a3f44'), roughness: 0.8 }));
    mcp.position.set(cx, -0.37, -0.585); c.group.add(mcp);
    // panel principal
    c.box(2.0 * k, 0.46, 0.05, cx, -0.6, -0.68, M.panel, -0.1);
    c.addPanel({ w: 1.95 * k, h: 0.406 * k, cw: 1536, ch: 320, x: cx, y: -0.6, z: -0.65, rx: -0.1, draw: PANELS.airliner });
    // pedestal central con palancas de gases
    c.box(0.36, 0.42, 1.0, cx, -0.85, -0.15, M.panel);
    const ped = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.98), new THREE.MeshStandardMaterial({ map: consoleTexture(41, '#2c2f33'), roughness: 0.8 }));
    ped.rotation.x = -Math.PI / 2; ped.position.set(cx, -0.638, -0.15); c.group.add(ped);
    c.throttle(cx - 0.05, -0.62, -0.35, 0.16, 2, 0.1);
    c.box(0.03, 0.08, 0.03, cx + 0.12, -0.6, -0.25, M.white);
    // asientos y cuernos
    c.seat(0, -0.75, 0.15, 0.5, 0.8, mat(0x2b2f36));
    c.seat(2 * cx, -0.75, 0.15, 0.5, 0.8, mat(0x2b2f36));
    c.yoke(0, -0.95, -0.65, 0.35);
    c.yoke(2 * cx, -0.95, -0.65, 0.35);
    c.bar(V(0, -1.05, -0.62), V(0, -0.95, -0.65), 0.03, M.metal);
    c.legs(0, -0.75, 0.12, -1.02, -0.65, 0.12, mat(0x1c2230));
    // copiloto
    const fo = new THREE.Group();
    fo.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xc89a78)));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x1c2230)); fo.add(cap);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.25), mat(0xeeeeee)); torso.position.y = -0.42; fo.add(torso);
    fo.position.set(2 * cx, -0.05, 0.12);
    c.group.add(fo);
  },

  heliApache(c, spec) {
    const M = c.M;
    const og = mat(0x2f352a, { r: 0.9 });
    c.box(0.04, 0.6, 1.6, -0.46, -0.62, -0.1, og); c.box(0.04, 0.6, 1.6, 0.46, -0.62, -0.1, og);
    c.box(0.95, 0.04, 1.8, 0, -1.0, -0.2, M.dark);
    c.box(0.08, 0.08, 1.8, -0.45, -0.32, -0.1, M.frame); c.box(0.08, 0.08, 1.8, 0.45, -0.32, -0.1, M.frame);
    // marcos de los cristales planos
    c.bar(V(-0.44, -0.3, -0.78), V(-0.34, 0.28, -0.55), 0.03, M.frame);
    c.bar(V(0.44, -0.3, -0.78), V(0.34, 0.28, -0.55), 0.03, M.frame);
    c.bar(V(-0.34, 0.28, -0.55), V(0.34, 0.28, -0.55), 0.03, M.frame);
    c.bar(V(-0.34, 0.28, -0.55), V(-0.34, 0.3, 0.6), 0.03, M.frame);
    c.bar(V(0.34, 0.28, -0.55), V(0.34, 0.3, 0.6), 0.03, M.frame);
    c.bar(V(-0.45, -0.3, 0.1), V(-0.34, 0.29, 0.1), 0.03, M.frame);
    c.bar(V(0.45, -0.3, 0.1), V(0.34, 0.29, 0.1), 0.03, M.frame);
    c.box(0.7, 0.04, 1.15, 0, 0.31, 0.05, og);
    c.bar(V(-0.45, -0.3, 0.6), V(-0.34, 0.3, 0.6), 0.03, M.frame);
    c.bar(V(0.45, -0.3, 0.6), V(0.34, 0.3, 0.6), 0.03, M.frame);
    // panel
    c.box(0.74, 0.38, 0.05, 0, -0.5, -0.66, og, -0.25);
    c.addPanel({ w: 0.7, h: 0.35, cw: 1024, ch: 512, x: 0, y: -0.5, z: -0.63, rx: -0.25, draw: PANELS.heliGlass });
    c.box(0.76, 0.06, 0.2, 0, -0.3, -0.72, M.dark);
    // artillero delantero y su cabina
    c.box(0.9, 0.5, 0.05, 0, -0.75, -0.85, og);
    const gunner = new THREE.Group();
    gunner.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(0x2f3a2a)));
    const vis = new THREE.Mesh(new THREE.SphereGeometry(0.152, 10, 6, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.35, Math.PI * 0.3), M.black); vis.rotation.y = Math.PI; gunner.add(vis);
    const tor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.28), mat(0x4a5638)); tor.position.y = -0.36; gunner.add(tor);
    gunner.position.set(0, -0.42, -1.35); c.group.add(gunner);
    c.box(0.46, 0.5, 0.08, 0, -0.62, -1.15, M.seat);
    c.bar(V(-0.42, -0.6, -1.0), V(-0.3, -0.05, -1.65), 0.03, M.frame);
    c.bar(V(0.42, -0.6, -1.0), V(0.3, -0.05, -1.65), 0.03, M.frame);
    c.bar(V(-0.3, -0.05, -1.65), V(0.3, -0.05, -1.65), 0.03, M.frame);
    c.canopyGlass(0.45, 0.55, 1.2, -0.3, -0.1);
    c.seat(0, -0.82, 0.12, 0.5, 0.8, M.seat, false);
    c.legs(0, -0.82, 0.08, -1.0, -0.65, 0.12);
    c.stick(0, -0.82, -0.3, 0.32);
    c.collective(-0.32, -0.62, 0.15, 0.4);
  },

  heliBubble(c, spec) {
    const M = c.M; const E = spec.eye;
    const L = (x, y, z) => V(x - E[0], y - E[1], z - E[2]);
    const B = (w, h, d, x, y, z, m, rx = 0) => c.box(w, h, d, x - E[0], y - E[1], z - E[2], m, rx);
    const inter = mat(0x6a6d70, { r: 0.9 });
    B(1.25, 0.04, 1.8, 0, -0.45, -0.25, mat(0x2f2f2f));
    // ventanas de suelo (chin)
    const chin = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), glassMat(0x4a6a7a, 0.12));
    chin.rotation.x = -Math.PI / 2 + 0.6; chin.position.set(-E[0], -0.32 - E[1], -1.4 - E[2]); chin.userData.noShadow = true; c.group.add(chin);
    B(0.04, 0.6, 1.4, -0.66, -0.15, -0.3, inter); B(0.04, 0.6, 1.4, 0.66, -0.15, -0.3, inter);
    B(1.3, 0.04, 1.6, 0, 1.12, -0.2, inter);
    c.bar(L(0, 1.1, -1.05), L(0, 0.2, -1.85), 0.025, inter);
    for (const sx of [-1, 1]) {
      c.bar(L(sx * 0.66, -0.4, -1.05), L(sx * 0.6, 1.1, -1.05), 0.03, inter);
      c.bar(L(sx * 0.66, -0.4, 0.25), L(sx * 0.62, 1.1, 0.25), 0.035, inter);
      c.bar(L(sx * 0.66, 0.15, -1.05), L(sx * 0.66, 0.15, 0.25), 0.02, inter);
      c.bar(L(sx * 0.6, 1.1, -1.05), L(sx * 0.62, 0.6, -1.65), 0.025, inter);
    }
    // consola central con instrumentos
    B(0.62, 0.32, 0.25, 0, 0.32, -1.38, M.panel);
    B(0.12, 0.6, 0.25, 0, -0.05, -1.3, M.panel);
    c.addPanel({ w: 0.6, h: 0.3, cw: 1024, ch: 512, x: -E[0], y: 0.33 - E[1], z: -1.21 - E[2], rx: -0.25, draw: PANELS.heliClassic });
    B(0.66, 0.05, 0.22, 0, 0.5, -1.4, M.dark);
    // consola superior
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5), new THREE.MeshStandardMaterial({ map: consoleTexture(51), roughness: 0.8 }));
    ov.rotation.x = Math.PI / 2; ov.position.set(-E[0], 1.09 - E[1], -0.5 - E[2]); c.group.add(ov);
    // asientos
    c.seat(0.32 - E[0], -0.05 - E[1], -0.45 - E[2], 0.48, 0.8, mat(0x3a3f4a));
    c.seat(-0.32 - E[0], -0.05 - E[1], -0.45 - E[2], 0.48, 0.8, mat(0x3a3f4a));
    c.legs(0.32 - E[0], -0.05 - E[1], -0.5 - E[2], -0.42 - E[1], -1.12 - E[2], 0.11, mat(0x2a2f3a));
    c.stick(0.32 - E[0], -0.43 - E[1], -0.8 - E[2], 0.42);
    c.collective(0.05 - E[0], -0.15 - E[1], -0.2 - E[2], 0.45);
  },

  heliCabin(c, spec) {
    const M = c.M; const E = spec.eye;
    const L = (x, y, z) => V(x - E[0], y - E[1], z - E[2]);
    const B = (w, h, d, x, y, z, m, rx = 0) => c.box(w, h, d, x - E[0], y - E[1], z - E[2], m, rx);
    const inter = mat(0x5c6064, { r: 0.9 });
    B(1.7, 0.04, 2.2, 0, -0.2, -2.2, mat(0x2a2a2a));
    const chin = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), glassMat(0x4a6a7a, 0.12));
    chin.rotation.x = -Math.PI / 2 + 0.7; chin.position.set(-E[0], 0.0 - E[1], -3.75 - E[2]); chin.userData.noShadow = true; c.group.add(chin);
    B(0.04, 0.6, 2.2, -0.86, 0.15, -2.4, inter); B(0.04, 0.6, 2.2, 0.86, 0.15, -2.4, inter);
    B(1.7, 0.04, 1.6, 0, 1.35, -1.9, inter);
    B(1.7, 1.5, 0.05, 0, 0.6, -1.3, mat(0x6e7376));
    for (const sx of [-1, 1]) {
      c.bar(L(sx * 0.85, 0.45, -3.85), L(sx * 0.7, 1.3, -3.2), 0.03, inter);
      c.bar(L(sx * 0.86, 0.45, -2.5), L(sx * 0.82, 1.33, -2.5), 0.035, inter);
      c.bar(L(sx * 0.86, 0.45, -3.85), L(sx * 0.86, 0.45, -1.3), 0.02, inter);
    }
    c.bar(L(0, 0.75, -4.0), L(0, 1.3, -3.25), 0.03, inter);
    B(1.5, 0.05, 0.6, 0, 1.3, -2.95, inter, 0.6);
    // panel
    B(1.5, 0.42, 0.08, 0, 0.55, -3.55, M.panel, -0.2);
    c.addPanel({ w: 0.75, h: 0.375, cw: 1024, ch: 512, x: 0.42 - E[0], y: 0.55 - E[1], z: -3.5 - E[2], rx: -0.2, draw: PANELS.heliGlass });
    c.addPanel({ w: 0.6, h: 0.3, cw: 1024, ch: 512, x: -0.42 - E[0], y: 0.55 - E[1], z: -3.5 - E[2], rx: -0.2, draw: PANELS.heliGlass });
    B(1.55, 0.06, 0.28, 0, 0.78, -3.65, M.dark);
    B(0.3, 0.35, 0.9, 0, 0.05, -3.0, M.panel);
    c.seat(0.42 - E[0], 0.12 - E[1], -2.75 - E[2], 0.5, 0.8, mat(0x2b2f36));
    c.seat(-0.42 - E[0], 0.12 - E[1], -2.75 - E[2], 0.5, 0.8, mat(0x2b2f36));
    c.legs(0.42 - E[0], 0.12 - E[1], -2.8 - E[2], -0.18 - E[1], -3.45 - E[2], 0.12, mat(0x1c2230));
    c.stick(0.42 - E[0], -0.18 - E[1], -3.15 - E[2], 0.42);
    c.collective(0.16 - E[0], 0.05 - E[1], -2.55 - E[2], 0.45);
    const fo = new THREE.Group();
    fo.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xc89a78)));
    const hs = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 4, 10, Math.PI), M.black); fo.add(hs);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.25), mat(0xeeeeee)); torso.position.y = -0.42; fo.add(torso);
    fo.position.set(-0.84, -0.05, 0.08); c.group.add(fo);
  },
};
