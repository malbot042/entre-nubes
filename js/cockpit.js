// Interiores de cabina detallados: estructura, mandos animados, piloto
// (piernas y guantes), paneles con instrumentos dibujados en canvas y HUD.
import * as THREE from 'three';
import * as I from './instruments.js?v=18';
import { mat, glassMat } from './models.js?v=18';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

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
  constructor(spec, navMap) {
    this.spec = spec;
    this.navMap = navMap;
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
      bezel: mat(0x16181a, { r: 0.55, m: 0.3 }), button: mat(0x3b3f43, { r: 0.6, m: 0.2 }), ring: mat(0x55595e, { r: 0.35, m: 0.85 }),
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

  // Panel de instrumentos en tres capas: placa estática con relieve (iluminada),
  // capa viva transparente con pantallas e instrumentos (autoiluminada, ~15 Hz)
  // y geometría real: marcos, botones, aros y cristales.
  addPanel({ w, h, cw = 1024, ch = 512, x, y, z, rx = -0.15, def }) {
    const pg = new THREE.Group(); pg.position.set(x, y, z); pg.rotation.set(rx, 0, 0);
    this.group.add(pg);
    const PX = w / cw;
    const toL = (px, py) => [(px / cw - 0.5) * w, (0.5 - py / ch) * h];
    // placa
    const fcv = document.createElement('canvas'); fcv.width = cw; fcv.height = ch;
    drawFace(fcv.getContext('2d'), cw, ch, def);
    const ftex = new THREE.CanvasTexture(fcv); ftex.colorSpace = THREE.SRGBColorSpace; ftex.anisotropy = 4;
    const fmat = new THREE.MeshStandardMaterial({ map: ftex, bumpMap: ftex, bumpScale: 1.5, roughness: 0.7, metalness: 0.15, emissive: 0xfff2d8, emissiveMap: ftex, emissiveIntensity: 0 });
    pg.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), fmat));
    // capa viva
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const lmat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
    const live = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lmat);
    live.position.z = 0.0015; live.userData.noShadow = true; live.renderOrder = 2;
    pg.add(live);
    // geometría de marcos y botones
    const buttons = [];
    const glassM = glassMat(0x334455, 0.07);
    for (const it of def.items) {
      if (it.k === 'mfd') {
        const b = 16, d = 0.012;
        const [cx, cy] = toL(it.x + it.w / 2, it.y + it.h / 2);
        const W = (it.w + 2 * b) * PX, H = (it.h + 2 * b) * PX;
        this.box(W, b * PX, d, cx, cy + (it.h + b) / 2 * PX, d / 2, this.M.bezel, 0, 0, 0, pg);
        this.box(W, b * PX, d, cx, cy - (it.h + b) / 2 * PX, d / 2, this.M.bezel, 0, 0, 0, pg);
        this.box(b * PX, it.h * PX, d, cx - (it.w + b) / 2 * PX, cy, d / 2, this.M.bezel, 0, 0, 0, pg);
        this.box(b * PX, it.h * PX, d, cx + (it.w + b) / 2 * PX, cy, d / 2, this.M.bezel, 0, 0, 0, pg);
        for (let i = 0; i < 5; i++) {
          const bx = cx + ((i + 0.5) / 5 - 0.5) * it.w * PX, by = cy + ((i + 0.5) / 5 - 0.5) * it.h * PX;
          const o = (it.w / 2 + b / 2) * PX, oy = (it.h / 2 + b / 2) * PX;
          buttons.push([bx, cy + oy, 0.014, 0.008], [bx, cy - oy, 0.014, 0.008], [cx - o, by, 0.008, 0.014], [cx + o, by, 0.008, 0.014]);
        }
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(it.w * PX, it.h * PX), glassM);
        gl.position.set(cx, cy, 0.004); gl.userData.noShadow = true; pg.add(gl);
      } else if (it.k === 'gauge') {
        const [cx, cy] = toL(it.x, it.y), r = it.r * 1.13 * PX;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0035, 5, 28), this.M.ring);
        ring.position.set(cx, cy, 0.003); pg.add(ring);
        const gl = new THREE.Mesh(new THREE.CircleGeometry(r, 24), glassM);
        gl.position.set(cx, cy, 0.005); gl.userData.noShadow = true; pg.add(gl);
      } else if (it.k === 'box') {
        const [cx, cy] = toL(it.x + it.w / 2, it.y + it.h / 2), b = 8, d = 0.006;
        const W = (it.w + 2 * b) * PX;
        this.box(W, b * PX, d, cx, cy + (it.h + b) / 2 * PX, d / 2, this.M.bezel, 0, 0, 0, pg);
        this.box(W, b * PX, d, cx, cy - (it.h + b) / 2 * PX, d / 2, this.M.bezel, 0, 0, 0, pg);
        this.box(b * PX, it.h * PX, d, cx - (it.w + b) / 2 * PX, cy, d / 2, this.M.bezel, 0, 0, 0, pg);
        this.box(b * PX, it.h * PX, d, cx + (it.w + b) / 2 * PX, cy, d / 2, this.M.bezel, 0, 0, 0, pg);
      }
    }
    if (buttons.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.M.button, buttons.length);
      const m4 = new THREE.Matrix4();
      buttons.forEach(([bx, by, bw, bh], i) => { m4.makeScale(bw, bh, 0.008); m4.setPosition(bx, by, 0.016); im.setMatrixAt(i, m4); });
      pg.add(im);
    }
    const entry = { cv, g: cv.getContext('2d'), tex, def, live: lmat, face: fmat };
    this.panels.push(entry);
    return entry;
  }

  // HUD: lámina proyectada + combinador + soporte. Para los cazas se calcula
  // la geometría conforme (píxeles por grado y fila del eje del avión) desde
  // la posición del ojo, que es el origen de la cabina.
  addHUD(x, y, z, size, heli = false) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const tex = new THREE.CanvasTexture(cv);
    // brillo por encima de 1 y sin tone mapping: legible contra el cielo y realzado por el bloom
    const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.6, 2.2), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    p.position.set(x, y, z); p.userData.noShadow = true; p.renderOrder = 5;
    this.group.add(p);
    const comb = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.04, size * 1.0), glassMat(0x6a8a70, 0.1));
    comb.position.set(x, y, z + 0.03); comb.rotation.x = 0.3; comb.userData.noShadow = true;
    this.group.add(comb);
    // marco del combinador y postes
    const top = y + size * 0.5 * Math.cos(0.3), bot = y - size * 0.5 * Math.cos(0.3);
    const zt = z + 0.03 - size * 0.5 * Math.sin(0.3), zb = z + 0.03 + size * 0.5 * Math.sin(0.3);
    for (const sx of [-1, 1]) this.bar(V(x + sx * size * 0.53, bot, zb), V(x + sx * size * 0.53, top, zt), 0.006, this.M.black);
    this.bar(V(x - size * 0.53, top, zt), V(x + size * 0.53, top, zt), 0.005, this.M.black);
    // cuerpo del proyector
    // (en el helicóptero el proyector va integrado en el guardasol para no tapar el panel)
    if (!heli) this.box(size * 1.05, 0.05, 0.12, x, bot - 0.025, z + 0.05, this.M.bezel).userData.noShadow = true;
    this.hud = { cv, g: cv.getContext('2d'), tex, heli, x, y, z, size, geo: { ppd: 1, bx: 256, by: 256 } };
  }

  // Guardasol: tapa sobre el panel con borde redondeado hacia el piloto
  glareshield(w, y, z, depth, m) {
    const t = this.box(w, 0.035, depth, 0, y, z - depth / 2 + 0.02, m);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, w, 10), m);
    lip.rotation.z = Math.PI / 2; lip.position.set(0, y - 0.005, z + 0.02);
    this.group.add(lip);
    return t;
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
    for (const p of this.panels) {
      p.live.color.setScalar(1 - n * 0.3);
      p.face.emissiveIntensity = n * 0.22;
    }
  }

  // Geometría conforme del HUD vista desde el ojo (que se mueve al inclinarse):
  // píxeles por grado y punto del eje del avión sobre la lámina.
  hudGeo(eye) {
    const h = this.hud, d = Math.max(0.1, eye.z - h.z), geo = h.geo;
    const k = 512 / h.size;  // píxeles por metro sobre la lámina
    geo.ppd = d * Math.tan(DEG) * k;
    geo.bx = 256 + (eye.x - h.x) * k;
    geo.by = 256 + (h.y - eye.y) * k;
    return geo;
  }

  update(dt, s, input, eye) {
    for (const st of this.anim.sticks) { st.obj.rotation.x = input.pitch * st.k; st.obj.rotation.z = -input.roll * st.k; }
    for (const y of this.anim.yokes) { y.obj.position.z = y.z0 + input.pitch * 0.08; y.wheel.rotation.z = -input.roll * 0.9; }
    for (const t of this.anim.throttles) t.obj.rotation.x = -(s.throttle - 0.4) * 1.1;
    for (const c of this.anim.collectives) c.obj.rotation.x = s.throttle * 0.35;
    for (const p of this.anim.pedals) p.obj.position.z = p.z0 - input.yaw * 0.05 * p.sx;
    this.timer -= dt; this.hudTimer -= dt;
    if (this.timer <= 0) {
      this.timer = 1 / 15;
      for (const p of this.panels) {
        p.g.clearRect(0, 0, p.cv.width, p.cv.height);
        for (const it of p.def.items) {
          if (it.k === 'gauge') it.draw(p.g, it.x, it.y, it.r, s);
          else if (it.k === 'mfd') I.screen(p.g, it.x, it.y, it.w, it.h, it.osb, () => it.draw(p.g, it.x, it.y, it.w, it.h, s, this));
          else it.draw(p.g, it.x, it.y, it.w, it.h, s);
        }
        p.tex.needsUpdate = true;
      }
    }
    if (this.hud && this.hudTimer <= 0) {
      this.hudTimer = 1 / 30;
      if (this.hud.heli) I.heliHUD(this.hud.g, 512, 512, s);
      else I.fighterHUD(this.hud.g, 512, 512, s, this.hudGeo(eye));
      this.hud.tex.needsUpdate = true;
    }
  }

  map(g, x, y, w, h, s) {
    if (this.navMap) this.navMap.draw(g, x, y, w, h, s, s.pos, s.heli ? 5000 : 12000);
  }
}

// ======================= Placa de los paneles =======================
function seeded(seed) {
  let k = seed;
  return () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
}

function screw(g, x, y, r = 4) {
  g.fillStyle = '#6a6e72'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.strokeStyle = '#2a2c2e'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x - r * 0.7, y - r * 0.3); g.lineTo(x + r * 0.7, y + r * 0.3); g.stroke();
}

function engrave(g, t, x, y, size = 13, col = '#e8e6dc') {
  g.font = `bold ${size}px "Rajdhani", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = col; g.fillText(t, x, y);
}

function drawFace(g, W, H, def) {
  const rnd = seeded(def.seed || 7);
  // pintura base con grano
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, def.bg[0]); gr.addColorStop(1, def.bg[1]);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rnd() * 0.04})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // placas atornilladas
  for (const [x, y, w, h] of def.plates || []) {
    g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    screw(g, x + 9, y + 9); screw(g, x + w - 9, y + 9); screw(g, x + 9, y + h - 9); screw(g, x + w - 9, y + h - 9);
  }
  for (const it of def.items) {
    if (it.k === 'mfd') {
      g.fillStyle = '#121315'; g.fillRect(it.x - 20, it.y - 20, it.w + 40, it.h + 40);
      g.fillStyle = '#000'; g.fillRect(it.x, it.y, it.w, it.h);
      if (it.title) engrave(g, it.title, it.x + it.w / 2, it.y + it.h + 32, 14);
    } else if (it.k === 'gauge') {
      g.fillStyle = '#141517'; g.beginPath(); g.arc(it.x, it.y, it.r * 1.28, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.stroke();
      if (it.title) engrave(g, it.title, it.x, it.y + it.r * 1.28 + 11, 12);
    } else if (it.k === 'box') {
      g.fillStyle = '#121315'; g.fillRect(it.x - 10, it.y - 10, it.w + 20, it.h + 20);
    }
  }
  for (const d of def.deco || []) {
    if (d.k === 'switches') {
      const r2 = seeded(d.seed || 3);
      const cols = d.cols, rows = d.rows, cw = d.w / cols, chh = d.h / rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const cx = d.x + (i + 0.5) * cw, cy = d.y + (j + 0.5) * chh - 6;
        g.fillStyle = '#0d0e0f'; g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
        g.fillStyle = '#9a9ea2'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
        const up = r2() < 0.6;
        g.fillStyle = '#d8dadc'; g.fillRect(cx - 2.5, up ? cy - 15 : cy, 5, 15);
        engrave(g, d.labels[(i + j * cols) % d.labels.length], cx, cy + 20, 11);
      }
      if (d.title) { engrave(g, d.title, d.x + d.w / 2, d.y - 6, 12, '#cfcbbd'); }
    } else if (d.k === 'guard') {
      // botón rojo con tapa a rayas
      g.fillStyle = '#e2b400'; g.fillRect(d.x - 22, d.y - 22, 44, 44);
      g.save(); g.beginPath(); g.rect(d.x - 22, d.y - 22, 44, 44); g.clip();
      g.strokeStyle = '#111'; g.lineWidth = 6;
      for (let k = -60; k < 60; k += 14) { g.beginPath(); g.moveTo(d.x + k, d.y - 30); g.lineTo(d.x + k + 60, d.y + 30); g.stroke(); }
      g.restore();
      g.fillStyle = '#b01010'; g.beginPath(); g.arc(d.x, d.y, 13, 0, 7); g.fill();
      engrave(g, d.label, d.x, d.y + 34, 11);
    } else if (d.k === 'label') {
      engrave(g, d.t, d.x, d.y, d.size || 13, d.col);
    } else if (d.k === 'knobs') {
      for (let i = 0; i < d.n; i++) {
        const cx = d.x + i * d.gap;
        g.fillStyle = '#0c0d0e'; g.beginPath(); g.arc(cx, d.y, 15, 0, 7); g.fill();
        g.strokeStyle = '#555'; g.lineWidth = 2; g.stroke();
        g.fillStyle = '#ddd'; g.fillRect(cx - 1.5, d.y - 14, 3, 9);
        engrave(g, d.labels[i % d.labels.length], cx, d.y + 26, 11);
      }
    }
  }
}

// ======================= Paneles =======================
const tachG = (g, x, y, r, s) => I.tach(g, x, y, r, s, 'RPM %', 11);
const fuelG = (g, x, y, r, s) => I.smallGauge(g, x, y, r, s.fuelFrac, 'FUEL');
const egtG = (g, x, y, r, s) => I.smallGauge(g, x, y, r, s.ab ? 0.95 : s.rpm * 0.7, 'EGT');
const mapD = (g, x, y, w, h, s, c) => c.map(g, x, y, w, h, s);

const PANELS = {
  fighter: {
    bg: ['#383c40', '#2a2d30'], seed: 11,
    plates: [[20, 150, 330, 340], [674, 150, 330, 340], [360, 0, 304, 512], [20, 4, 330, 140], [674, 4, 330, 140]],
    items: [
      { k: 'mfd', x: 45, y: 172, w: 280, h: 280, osb: ['MAP', 'HSD', 'SMS', 'TGP', 'DTE'], draw: mapD },
      { k: 'mfd', x: 699, y: 172, w: 280, h: 280, osb: ['HSI', 'FCR', 'WPN', 'FLIR', 'TEST'], draw: (g, x, y, w, h, s) => I.nd(g, x, y, w, h, s) },
      { k: 'box', x: 400, y: 18, w: 224, h: 165, draw: I.ufc },
      { k: 'gauge', x: 450, y: 292, r: 52, draw: I.attitude, title: 'ADI' },
      { k: 'gauge', x: 582, y: 262, r: 36, draw: I.asi, title: 'IAS' },
      { k: 'gauge', x: 582, y: 356, r: 36, draw: I.altimeter, title: 'ALT' },
      { k: 'box', x: 384, y: 404, w: 256, h: 92, draw: I.warnPanel },
      { k: 'gauge', x: 770, y: 74, r: 44, draw: tachG, title: 'RPM' },
      { k: 'gauge', x: 905, y: 74, r: 44, draw: fuelG, title: 'FUEL' },
      { k: 'box', x: 50, y: 22, w: 104, h: 100, draw: I.gearPanel },
    ],
    deco: [
      { k: 'switches', x: 170, y: 30, w: 170, h: 100, rows: 2, cols: 4, seed: 4, title: 'MASTER', labels: ['ARM', 'SIM', 'LASER', 'RDR', 'ECM', 'IFF', 'TACAN', 'NVG'] },
      { k: 'guard', x: 345, y: 470, label: 'JETT' },
    ],
  },
  f14: {
    bg: ['#3e4245', '#2e3134'], seed: 5,
    plates: [[10, 10, 340, 492], [360, 0, 304, 512], [674, 10, 340, 492]],
    items: [
      { k: 'gauge', x: 92, y: 116, r: 58, draw: I.asi, title: 'AIRSPEED' },
      { k: 'gauge', x: 252, y: 140, r: 76, draw: I.attitude, title: 'VDI' },
      { k: 'gauge', x: 92, y: 280, r: 58, draw: I.altimeter, title: 'ALT' },
      { k: 'gauge', x: 252, y: 336, r: 56, draw: I.vsi, title: 'VVI' },
      { k: 'gauge', x: 92, y: 436, r: 50, draw: I.heading, title: 'BDHI' },
      { k: 'mfd', x: 384, y: 150, w: 256, h: 256, osb: ['TID', 'NAV', 'TGT', '', ''], draw: mapD, title: 'TACTICAL INFORMATION DISPLAY' },
      { k: 'box', x: 392, y: 22, w: 240, h: 96, draw: I.warnPanel },
      { k: 'gauge', x: 770, y: 100, r: 54, draw: tachG, title: 'RPM L' },
      { k: 'gauge', x: 912, y: 100, r: 54, draw: tachG, title: 'RPM R' },
      { k: 'gauge', x: 770, y: 254, r: 46, draw: egtG, title: 'EGT L' },
      { k: 'gauge', x: 912, y: 254, r: 46, draw: egtG, title: 'EGT R' },
      { k: 'gauge', x: 870, y: 410, r: 56, draw: fuelG, title: 'FUEL QTY' },
      { k: 'box', x: 690, y: 370, w: 100, h: 100, draw: I.gearPanel },
    ],
    deco: [{ k: 'guard', x: 252, y: 468, label: 'EMERG JETT' }],
  },
  heliGlass: {
    bg: ['#353a33', '#272b26'], seed: 9,
    plates: [[16, 96, 348, 348], [660, 96, 348, 348], [372, 4, 280, 504], [16, 4, 348, 86], [660, 4, 348, 86]],
    items: [
      { k: 'mfd', x: 46, y: 124, w: 290, h: 290, osb: ['FLT', 'TSD', 'WPN', 'FUEL', 'ENG'], draw: (g, x, y, w, h, s) => I.pfd(g, x, y, w, h, s) },
      { k: 'mfd', x: 688, y: 124, w: 290, h: 290, osb: ['TSD', 'MAP', 'COM', 'ASE', 'UTIL'], draw: mapD },
      { k: 'gauge', x: 452, y: 150, r: 54, draw: (g, x, y, r, s) => I.smallGauge(g, x, y, r, s.throttle, 'TRQ %'), title: 'TORQUE' },
      { k: 'gauge', x: 574, y: 150, r: 54, draw: (g, x, y, r, s) => I.smallGauge(g, x, y, r, s.rpm, 'NR %'), title: 'ROTOR' },
      { k: 'gauge', x: 452, y: 298, r: 50, draw: I.altimeter, title: 'ALT' },
      { k: 'gauge', x: 574, y: 298, r: 50, draw: I.vsi, title: 'VSI' },
      { k: 'box', x: 400, y: 396, w: 224, h: 96, draw: I.warnPanel },
    ],
    deco: [
      { k: 'switches', x: 40, y: 20, w: 300, h: 64, rows: 1, cols: 6, seed: 2, labels: ['BAT', 'APU', 'GEN 1', 'GEN 2', 'FUEL', 'NVS'] },
      { k: 'knobs', x: 720, y: 40, n: 5, gap: 56, labels: ['VOL', 'BRT', 'CONT', 'SYM', 'IHADSS'] },
      { k: 'label', t: 'AH-64 · PILOT', x: 512, y: 30, size: 14, col: '#cfcbbd' },
    ],
  },
};

// Textura de paredes de cabina: costillas, remaches y rótulos de mantenimiento
const wallCache = {};
function wallTexture(base) {
  if (wallCache[base]) return wallCache[base];
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d'), rnd = seeded(13);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
  for (let x = 0; x < 256; x += 64) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, 0, 6, 256);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 6, 0, 2, 256);
    for (let y = 6; y < 256; y += 16) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 14, y, 2, 2); g.fillRect(x + 50, y, 2, 2); }
  }
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 126, 256, 4);
  g.fillStyle = 'rgba(230,220,180,0.5)'; g.font = 'bold 10px sans-serif';
  g.fillText('NO STEP', 80, 60); g.fillText('▲ FWD', 150, 200);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (wallCache[base] = t);
}
const wallMat = (base) => { const t = wallTexture(base); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 2, roughness: 0.8, metalness: 0.15 }); };

// Cuero del guardasol
let leather = null;
function leatherMat() {
  if (!leather) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'), rnd = seeded(21);
    g.fillStyle = '#17181a'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`; g.fillRect(rnd() * 128, rnd() * 128, 2, 1); }
    g.strokeStyle = 'rgba(200,200,200,0.25)'; g.setLineDash([3, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 10); g.lineTo(128, 10); g.stroke();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    leather = new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 3, roughness: 0.95, metalness: 0 });
  }
  return leather;
}

// ======================= Estilos de cabina =======================
const STYLES = {
  fighter(c, spec) {
    const M = c.M;
    const framed = spec.id !== 'f16';
    const tub = wallMat('#565b60');
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
    c.addPanel({ w: pw, h: ph, x: 0, y: -0.45, z: -0.725, rx: -0.15, def: PANELS[spec.panel] || PANELS.fighter });
    // pedestal entre las piernas
    const ped = new THREE.MeshStandardMaterial({ map: consoleTexture(17, '#2a2d30'), roughness: 0.8 });
    c.box(0.22, 0.28, 0.06, 0, -0.82, -0.7, ped, -0.2);
    // guardasol
    c.glareshield(0.94, -0.205, -0.7, 0.34, leatherMat());
    // HUD
    c.addHUD(0, -0.05, -0.78, 0.25);
    // cúpula
    if (framed) {
      c.arc(0.5, 0.58, 0.03, 0, -0.36, -0.66, M.frame);
      c.bar(V(-0.44, -0.33, -0.7), V(-0.12, 0.13, -1.25), 0.025, M.frame);
      c.bar(V(0.44, -0.33, -0.7), V(0.12, 0.13, -1.25), 0.025, M.frame);
      for (const x of [-0.18, 0, 0.18]) c.box(0.08, 0.035, 0.02, x, 0.2, -0.64, M.metal, 0.3);
    } else {
      for (const x of [-0.2, 0.2]) c.box(0.07, 0.03, 0.02, x, 0.22, 0.45, M.metal, -0.3);
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
    const og = wallMat('#3a4234');
    c.box(0.04, 0.6, 1.6, -0.46, -0.62, -0.1, og); c.box(0.04, 0.6, 1.6, 0.46, -0.62, -0.1, og);
    c.box(0.95, 0.04, 1.8, 0, -1.0, -0.2, M.dark);
    c.box(0.08, 0.08, 1.8, -0.45, -0.32, -0.1, M.frame); c.box(0.08, 0.08, 1.8, 0.45, -0.32, -0.1, M.frame);
    // consolas laterales
    const ct = new THREE.MeshStandardMaterial({ map: consoleTexture(23, '#2b302a'), roughness: 0.8 });
    const ct2 = new THREE.MeshStandardMaterial({ map: consoleTexture(31, '#2b302a'), roughness: 0.8 });
    c.box(0.16, 0.22, 0.8, -0.36, -0.66, 0.0, og); c.box(0.16, 0.22, 0.8, 0.36, -0.66, 0.0, og);
    const tl = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.78), ct); tl.rotation.x = -Math.PI / 2; tl.position.set(-0.36, -0.548, 0); c.group.add(tl);
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.78), ct2); tr.rotation.x = -Math.PI / 2; tr.position.set(0.36, -0.548, 0); c.group.add(tr);
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
    c.box(0.74, 0.38, 0.05, 0, -0.5, -0.66, M.panel, -0.25);
    c.addPanel({ w: 0.7, h: 0.35, x: 0, y: -0.5, z: -0.63, rx: -0.25, def: PANELS.heliGlass });
    c.glareshield(0.76, -0.3, -0.62, 0.2, leatherMat());
    c.addHUD(0, -0.19, -0.64, 0.22, true);
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
