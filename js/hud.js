// HUD táctico sobre el canvas 3D: retícula, marcadores, adelanto de tiro y flechas fuera de pantalla.
import * as THREE from 'three';
import { BULLET_SPEED } from './combat.js?v=41';
import * as I from './instruments.js?v=41';

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _f = new THREE.Vector3(), _c = new THREE.Vector3(), _h = new THREE.Vector3();
const CY = '#3df2ff', RD = '#ff4a3c', AM = '#ffc14d';
const LABELS = { tank: 'TANQUE', aaa: 'ANTIAÉREO', bunker: 'BÚNKER', truck: 'CAMIÓN', fighter: 'CAZA', drone: 'DRON' };
const GR = '#62ff86';
const fmtD = (d) => d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km';

export class TacticalHUD {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    // HUD de vuelo para las vistas exteriores: el mismo dibujo que el combinador de cabina
    this.fcv = document.createElement('canvas'); this.fcv.width = this.fcv.height = 512;
    this.fg = this.fcv.getContext('2d');
    this.fTimer = 0; this.fGeo = { ppd: 1, bx: 256, by: 256 };
    // mapa móvil para las vistas exteriores (el mismo de las pantallas de cabina)
    this.mcv = document.createElement('canvas'); this.mcv.width = this.mcv.height = 400;
    this.mg = this.mcv.getContext('2d');
    this.mTimer = 0;
    this.resize();
  }
  resize() { this.cv.width = innerWidth; this.cv.height = innerHeight; this.W = innerWidth; this.H = innerHeight; }
  clear() { this.g.clearRect(0, 0, this.W, this.H); }

  toScreen(v, camera, out) {
    _p.copy(v).project(camera);
    const behind = _p.z > 1;
    out.x = (_p.x * 0.5 + 0.5) * this.W; out.y = (-_p.y * 0.5 + 0.5) * this.H; out.behind = behind;
    out.on = !behind && out.x > 20 && out.x < this.W - 20 && out.y > 20 && out.y < this.H - 20;
    return out;
  }

  // HUD exterior centrado en pantalla. La escalera usa los grados de la cámara,
  // así que en la vista de persecución el horizonte del HUD casa con el real.
  flightHUD(dt, s, camera) {
    const size = Math.min(this.H * 0.66, this.W * 0.56), k = 512 / size;
    this.fTimer -= dt;
    if (this.fTimer <= 0) {
      this.fTimer = 1 / 30;
      const armed = s.armed; s.armed = false; // la retícula con adelanto ya la pone draw()
      if (s.heli) I.heliHUD(this.fg, 512, 512, s);
      else {
        this.fGeo.ppd = this.H / 2 / Math.tan(camera.fov * Math.PI / 360) * Math.tan(Math.PI / 180) * k;
        I.fighterHUD(this.fg, 512, 512, s, this.fGeo);
      }
      s.armed = armed;
    }
    const g = this.g;
    g.save();
    g.shadowColor = 'rgba(0,20,0,0.75)'; g.shadowBlur = 4;
    g.drawImage(this.fcv, (this.W - size) / 2, (this.H - size) / 2, size, size);
    g.restore();
  }

  // mapa en la esquina inferior derecha, redibujado a 15 Hz en su propio canvas
  mapOverlay(dt, s, navMap) {
    this.mTimer -= dt;
    if (this.mTimer <= 0) {
      this.mTimer = 1 / 15;
      I.screen(this.mg, 0, 0, 400, 400, null, () => navMap.draw(this.mg, 0, 0, 400, 400, s, s.pos, s.heli ? 5000 : 12000));
    }
    const g = this.g, size = Math.round(Math.min(this.H * 0.36, this.W * 0.3));
    const x = this.W - size - Math.max(28, this.W * 0.03), y = this.H - size - Math.max(28, this.H * 0.05);
    g.save();
    g.beginPath(); g.roundRect(x, y, size, size, 10);
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 12; g.fillStyle = '#000'; g.fill();
    g.shadowBlur = 0; g.clip();
    g.globalAlpha = 0.94; g.drawImage(this.mcv, x, y, size, size);
    g.globalAlpha = 1; g.lineWidth = 2; g.strokeStyle = 'rgba(98,255,134,0.45)'; g.stroke();
    g.restore();
  }

  // Visor del casco (modo nocturno): símbolos fijos a la mirada, dibujados sobre
  // la vista de cabina allá donde se mire. Rumbo de la mirada, velocidad, altura,
  // horizonte y morro conformes, recuadro de orientación de la cabeza y armas.
  // s: estado de instrumentos; look: {yaw, pitch} de la cabeza en radianes.
  hmd(s, camera, fm, look, mode) {
    const g = this.g, W = this.W, H = this.H, cx = W / 2, cy = H / 2;
    const col = '#7dff9a', u = Math.min(W, H) / 800;
    const font = (px) => { g.font = `bold ${Math.round(px * u)}px "Share Tech Mono", monospace`; };
    const txt = (t, x, y, align = 'center') => {
      g.textAlign = align; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(t, x, y);
      g.fillStyle = col; g.fillText(t, x, y);
    };
    const line = (pts, w = 1.6) => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); this.stroke(col, w); };
    g.save();
    // retícula de la línea de visión
    const r = 14 * u;
    line([[cx - r * 2.2, cy], [cx - r * 0.6, cy]]); line([[cx + r * 0.6, cy], [cx + r * 2.2, cy]]);
    line([[cx, cy - r * 2.2], [cx, cy - r * 0.6]]); line([[cx, cy + r * 0.6], [cx, cy + r * 1.4]]);
    // horizonte conforme: dos puntos a 2 km, a la altura de los ojos, a ±25° de la mirada
    camera.getWorldPosition(_c); camera.getWorldDirection(_f);
    const ya = Math.atan2(_f.x, _f.z);
    const hp = [];
    for (const da of [-0.44, 0.44]) {
      _h.set(_c.x + Math.sin(ya + da) * 2000, _c.y, _c.z + Math.cos(ya + da) * 2000);
      const o = this.toScreen(_h, camera, { x: 0, y: 0 });
      if (!o.behind) hp.push([o.x, o.y]);
    }
    if (hp.length === 2) {
      const [[x0, y0], [x1, y1]] = hp, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, gap = 60 * u;
      line([[x0, y0], [mx - dx / L * gap, my - dy / L * gap]], 1.4);
      line([[mx + dx / L * gap, my + dy / L * gap], [x1, y1]], 1.4);
    }
    // morro del aparato: símbolo en W donde apunta; flecha en el borde si queda fuera
    _f.set(0, 0, -1).applyQuaternion(fm.quat);
    _h.copy(fm.pos).addScaledVector(_f, 3000);
    const nose = this.toScreen(_h, camera, { x: 0, y: 0 });
    if (nose.on && !nose.behind) {
      const x = nose.x, y = nose.y, k = 9 * u;
      line([[x - k * 2.6, y], [x - k * 1.3, y], [x - k * 0.7, y + k * 0.8], [x, y], [x + k * 0.7, y + k * 0.8], [x + k * 1.3, y], [x + k * 2.6, y]], 1.6);
    } else this.arrow(nose, col);
    // cinta de rumbo de la mirada
    const hdg = ((s.hdg - look.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const ty = H * 0.09, tw = W * 0.34, ppd = tw / 60;
    font(14);
    for (let a = Math.ceil((hdg - 30) / 5) * 5; a <= hdg + 30; a += 5) {
      const x = cx + (a - hdg) * ppd, big = a % 10 === 0;
      line([[x, ty], [x, ty + (big ? 10 : 5) * u]], 1.2);
      if (a % 30 === 0) { const v = ((a % 360) + 360) % 360; txt({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v] ?? String(v / 10), x, ty - 10 * u); }
    }
    // marca del rumbo del morro sobre la cinta
    let dn = ((s.hdg - hdg + 540) % 360) - 180;
    const nx = cx + Math.max(-30, Math.min(30, dn)) * ppd;
    line([[nx - 6 * u, ty + 20 * u], [nx, ty + 13 * u], [nx + 6 * u, ty + 20 * u]], 1.4);
    font(18);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(cx - 30 * u, ty + 22 * u, 60 * u, 22 * u);
    g.beginPath(); g.rect(cx - 30 * u, ty + 22 * u, 60 * u, 22 * u); this.stroke(col, 1.2);
    txt(String(Math.round(hdg) % 360).padStart(3, '0'), cx, ty + 33 * u);
    // velocidad y altura a los lados de la retícula
    const box = (t, x, y, w) => {
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x - w / 2, y - 13 * u, w, 26 * u);
      g.beginPath(); g.rect(x - w / 2, y - 13 * u, w, 26 * u); this.stroke(col, 1.2);
      txt(t, x, y);
    };
    font(20);
    box(String(Math.round(s.ias)), cx - W * 0.17, cy, 70 * u);
    const radar = s.agl < 1500;
    box(`${radar ? 'R' : ''}${Math.round(radar ? s.agl : s.alt)}`, cx + W * 0.17, cy, 84 * u);
    font(14);
    txt('KT', cx - W * 0.17, cy + 24 * u);
    txt(`${s.vs > 0 ? '+' : ''}${Math.round(s.vs)} FPM`, cx + W * 0.17, cy + 24 * u);
    txt(`${s.heli ? 'TRQ' : 'THR'} ${Math.round(s.throttle * 100)}%`, cx - W * 0.17, cy - 26 * u);
    txt(`G ${s.g.toFixed(1)}`, cx + W * 0.17, cy - 26 * u);
    // orientación de la cabeza: recuadro que representa ±180° de giro y la mirada como punto
    const bw = 130 * u, bh = 44 * u, bx = cx, by = H * 0.8;
    g.beginPath(); g.rect(bx - bw / 2, by - bh / 2, bw, bh); this.stroke(col, 1.2);
    line([[bx, by - bh / 2], [bx, by - bh / 2 + 6 * u]], 1.2); line([[bx, by + bh / 2], [bx, by + bh / 2 - 6 * u]], 1.2);
    const lx = bx - (look.yaw / Math.PI) * bw / 2, ly = by - (look.pitch / (Math.PI / 2)) * bh / 2;
    g.beginPath(); g.arc(lx, ly, 4 * u, 0, Math.PI * 2); g.fillStyle = col; g.fill();
    // armas y blanco
    font(15);
    if (s.armed) txt(`GUN ${s.ammo}${s.gunMode ? ' ' + s.gunMode : ''}  ·  ${s.wsel}`, cx, by + bh / 2 + 18 * u);
    const t = s.tgt;
    if (t) {
      const rng = t.range < 1000 ? `${Math.round(t.range)} M` : `${(t.range / 1000).toFixed(1)} KM`;
      txt(`TGT ${t.id}  ${rng}  ${t.locked ? 'LOCK' : t.far ? 'LEJOS' : 'FIJANDO'}`, cx, by + bh / 2 + 38 * u);
    }
    if (s.warn && (performance.now() / 300 | 0) % 2 === 0) { font(28); txt(s.warn, cx, cy - H * 0.16); }
    font(13);
    txt(`VISOR · ${mode === 2 ? 'TÉRMICA' : 'VERDE'}`, W * 0.04, H * 0.06, 'left');
    g.restore();
  }

  // doble trazo: halo ancho y núcleo fino, sin el coste de shadowBlur
  stroke(color, w = 1.6) {
    const g = this.g;
    g.globalAlpha = 0.22; g.lineWidth = w + 3.5; g.strokeStyle = color; g.stroke();
    g.globalAlpha = 1; g.lineWidth = w; g.stroke();
  }

  arrow(s, color) {
    const g = this.g, cx = this.W / 2, cy = this.H / 2;
    let dx = s.x - cx, dy = s.y - cy;
    if (s.behind) { dx = -dx; dy = -dy; }
    const a = Math.atan2(dy, dx), R = Math.min(cx, cy) * 0.78;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    g.save(); g.translate(x, y); g.rotate(a);
    g.beginPath(); g.moveTo(13, 0); g.lineTo(-7, -8); g.lineTo(-3, 0); g.lineTo(-7, 8); g.closePath();
    this.stroke(color); g.restore();
  }

  draw(camera, { fm, markers, armed, tg = null, hitFlash = 0, ammoEmpty = false }) {
    const g = this.g;
    this.clear();
    if (hitFlash > 0) {
      const gr = g.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.35, this.W / 2, this.H / 2, this.H * 0.85);
      gr.addColorStop(0, 'rgba(255,40,20,0)'); gr.addColorStop(1, `rgba(255,40,20,${0.45 * hitFlash})`);
      g.fillStyle = gr; g.fillRect(0, 0, this.W, this.H);
    }
    const s = { x: 0, y: 0, on: false, behind: false };
    if (armed) {
      // retícula de cañón: punto a 1000 m en la línea de tiro
      _f.set(0, 0, -1).applyQuaternion(fm.quat);
      _q.copy(fm.pos).addScaledVector(_f, 1000);
      this.toScreen(_q, camera, s);
      if (!s.behind) {
        const col = ammoEmpty ? RD : CY;
        g.beginPath(); g.arc(s.x, s.y, 17, 0, 6.2832); this.stroke(col);
        g.beginPath();
        for (const [a, b] of [[17, 27]]) for (let k = 0; k < 4; k++) {
          const t = k * Math.PI / 2; g.moveTo(s.x + Math.cos(t) * a, s.y + Math.sin(t) * a); g.lineTo(s.x + Math.cos(t) * b, s.y + Math.sin(t) * b);
        }
        this.stroke(col);
        g.fillStyle = col; g.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
      }
    }
    g.font = '600 12px "Share Tech Mono", monospace';
    g.textAlign = 'center';
    // ordenar por cercanía: solo la más próxima lleva flecha (o el blanco designado)
    const sel = tg?.target || null;
    let nearest = null, nd = Infinity;
    const list = markers.map(m => { const d = m.pos.distanceTo(fm.pos); if (d < nd) { nd = d; nearest = m; } return { m, d }; });
    if (sel) nearest = list.find(o => o.m.e === sel)?.m || nearest;
    for (const { m, d } of list) {
      this.toScreen(m.pos, camera, s);
      if (m.e && m.e === sel) { this.designate(s, m, d, tg, camera, fm); continue; }
      const col = m.air ? RD : AM;
      if (s.on) {
        const r = Math.max(9, Math.min(24, 1500 / d * 8));
        g.beginPath();
        const c = r * 0.45;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          g.moveTo(s.x + sx * r, s.y + sy * (r - c)); g.lineTo(s.x + sx * r, s.y + sy * r); g.lineTo(s.x + sx * (r - c), s.y + sy * r);
        }
        this.stroke(col, 1.5);
        if (m === nearest || d < 450) {
          const text = `${LABELS[m.label] || m.label.toUpperCase()} ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}`;
          g.lineWidth = 3; g.strokeStyle = 'rgba(5,10,18,0.75)'; g.strokeText(text, s.x, s.y + r + 15);
          g.fillStyle = col; g.fillText(text, s.x, s.y + r + 15);
        }
        // adelanto de tiro para blancos aéreos
        if (m.air && armed && d < 2200 && m.vel) {
          const t = d / BULLET_SPEED;
          _q.copy(m.pos).addScaledVector(m.vel, t).addScaledVector(fm.vel, -t);
          const lead = { x: 0, y: 0, on: false, behind: false };
          this.toScreen(_q, camera, lead);
          if (lead.on) {
            g.beginPath(); g.arc(lead.x, lead.y, 6, 0, 6.2832); this.stroke(RD, 1.4);
            g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(lead.x, lead.y); g.globalAlpha = 0.45; g.lineWidth = 1; g.strokeStyle = RD; g.stroke(); g.globalAlpha = 1;
          }
        }
      } else if (m === nearest) this.arrow(s, col);
    }
  }

  // blanco designado: recuadro verde, rombo que se cierra mientras se fija,
  // identificación, distancia y estado; con el cañón automático, su punto de mira
  designate(s, m, d, tg, camera, fm) {
    const g = this.g;
    if (!s.on) { this.arrow(s, GR); return; }
    const r = Math.max(14, Math.min(30, 1500 / d * 10));
    g.beginPath(); g.rect(s.x - r, s.y - r, r * 2, r * 2); this.stroke(GR, 1.8);
    const k = tg.locked ? 1 : tg.lockT;
    const dr = r * (2.4 - 1.1 * k);
    g.save(); g.translate(s.x, s.y); g.rotate(tg.locked ? 0 : performance.now() / 400);
    g.beginPath(); g.moveTo(0, -dr); g.lineTo(dr, 0); g.lineTo(0, dr); g.lineTo(-dr, 0); g.closePath();
    this.stroke(tg.locked ? RD : GR, tg.locked ? 2.2 : 1.2);
    g.restore();
    const lines = [tg.idText(), fmtD(d), tg.locked ? (tg.gunAuto ? 'FIJADO · CAÑÓN AUTO' : 'FIJADO') : 'FIJANDO…'];
    g.font = '600 12px "Share Tech Mono", monospace'; g.textAlign = 'left';
    lines.forEach((t, i) => {
      const y = s.y - r + 4 + i * 14;
      g.lineWidth = 3; g.strokeStyle = 'rgba(5,10,18,0.75)'; g.strokeText(t, s.x + r + 8, y);
      g.fillStyle = i === 2 && tg.locked ? RD : GR; g.fillText(t, s.x + r + 8, y);
    });
    g.textAlign = 'center';
    // adelanto de tiro para blancos móviles
    if (m.vel && d < 2500 && m.vel.lengthSq() > 4) {
      const t = d / BULLET_SPEED;
      _q.copy(m.pos).addScaledVector(m.vel, t).addScaledVector(fm.vel, -t);
      const lead = { x: 0, y: 0, on: false, behind: false };
      this.toScreen(_q, camera, lead);
      if (lead.on) {
        g.beginPath(); g.arc(lead.x, lead.y, 6, 0, 6.2832); this.stroke(GR, 1.4);
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(lead.x, lead.y); g.globalAlpha = 0.45; g.lineWidth = 1; g.strokeStyle = GR; g.stroke(); g.globalAlpha = 1;
      }
    }
  }
}
