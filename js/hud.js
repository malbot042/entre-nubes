// HUD táctico sobre el canvas 3D: retícula, marcadores, adelanto de tiro y flechas fuera de pantalla.
import * as THREE from 'three';
import { BULLET_SPEED } from './combat.js?v=18';
import * as I from './instruments.js?v=18';

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _f = new THREE.Vector3();
const CY = '#3df2ff', RD = '#ff4a3c', AM = '#ffc14d';
const LABELS = { tank: 'TANQUE', aaa: 'ANTIAÉREO', bunker: 'BÚNKER', truck: 'CAMIÓN' };

export class TacticalHUD {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.curve = null; // [kx, ky] del efecto CRT: los marcadores siguen la curvatura del tubo
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
    if (this.curve && !behind) {
      // inversa de q' = q + q·(q.yx)²·k por punto fijo
      const [kx, ky] = this.curve, sx = _p.x, sy = _p.y;
      for (let i = 0; i < 4; i++) { const x = _p.x, y = _p.y; _p.x = sx / (1 + y * y * kx); _p.y = sy / (1 + x * x * ky); }
    }
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

  draw(camera, { fm, markers, armed, hitFlash = 0, ammoEmpty = false }) {
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
    // ordenar por cercanía: solo la más próxima lleva flecha
    let nearest = null, nd = Infinity;
    const list = markers.map(m => { const d = m.pos.distanceTo(fm.pos); if (d < nd) { nd = d; nearest = m; } return { m, d }; });
    for (const { m, d } of list) {
      this.toScreen(m.pos, camera, s);
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
}
