// HUD táctico sobre el canvas 3D: retícula, marcadores, adelanto de tiro y flechas fuera de pantalla.
import * as THREE from 'three';
import { BULLET_SPEED } from './combat.js?v=9';

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _f = new THREE.Vector3();
const CY = '#3df2ff', RD = '#ff4a3c', AM = '#ffc14d';
const LABELS = { tank: 'TANQUE', aaa: 'ANTIAÉREO', bunker: 'BÚNKER', truck: 'CAMIÓN' };

export class TacticalHUD {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
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
