// Mapa móvil para las pantallas de cabina. El relieve (norte arriba, con
// sombreado e hipsometría) se cachea en un canvas (ReliefCache, que también usa
// el mapa táctico) y se recalcula por filas dentro de un presupuesto de tiempo
// cuando el avión se aleja del centro.
// El dibujo final va orientado al rumbo, con anillos de distancia, rosa de
// rumbos, aeropuertos, destino y contactos.
const SPAN = 32000;   // metros que cubre la caché
const RES = 224;      // píxeles de la caché
const TAU = Math.PI * 2;

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const sat = (v) => Math.max(0, Math.min(1, v));

// tintes hipsométricos
const TINTS = [
  [0, [92, 132, 70]], [180, [118, 146, 78]], [420, [156, 150, 96]], [750, [146, 122, 92]],
  [1050, [128, 118, 112]], [1250, [228, 232, 238]],
];
function tint(h) {
  for (let i = 1; i < TINTS.length; i++) {
    if (h < TINTS[i][0]) return mix(TINTS[i - 1][1], TINTS[i][1], (h - TINTS[i - 1][0]) / (TINTS[i][0] - TINTS[i - 1][0]));
  }
  return TINTS[TINTS.length - 1][1];
}

// Caché de relieve sombreado, norte arriba, de `span` metros en `res` píxeles.
// Se calcula por filas con presupuesto de tiempo en un búfer trasero y se
// publica entera al terminar; cada trabajo puede usar un alcance distinto.
export class ReliefCache {
  constructor(world, span, res) {
    this.world = world; this.span = span; this.res = res;
    this.front = this.makeCanvas();
    this.back = this.makeCanvas();
    this.cx = null; this.cz = null;   // centro de la caché publicada
    this.fspan = span;                // alcance de la caché publicada
    this.job = null;
  }

  makeCanvas() {
    const cv = document.createElement('canvas'); cv.width = cv.height = this.res;
    const g = cv.getContext('2d');
    return { cv, g, img: g.createImageData(this.res, this.res) };
  }

  get ready() { return this.cx !== null; }

  startJob(x, z, span = this.span) {
    // la caché se alinea a una rejilla para que el redibujo no "nade"
    const step = span / this.res;
    x = Math.round(x / step) * step; z = Math.round(z / step) * step;
    this.job = { x, z, span, row: -1, prev: new Float32Array(this.res + 1), cur: new Float32Array(this.res + 1) };
  }

  // Calcula una fila de alturas (con una columna extra a la izquierda para el sombreado)
  rowHeights(job, j, out) {
    const step = job.span / this.res, x0 = job.x - job.span / 2, z = job.z - job.span / 2 + (j + 0.5) * step;
    for (let i = -1; i < this.res; i++) out[i + 1] = this.world.height(x0 + (i + 0.5) * step, z);
  }

  shadeRow(job, j) {
    const w = this.world, RES = this.res, step = job.span / RES, x0 = job.x - job.span / 2, z = job.z - job.span / 2 + (j + 0.5) * step;
    // el sombreado depende de la pendiente: se normaliza al tamaño del píxel
    const shade = 0.0045 * 143 / step;
    const d = this.back.img.data, prev = job.prev, cur = job.cur;
    for (let i = 0; i < RES; i++) {
      const x = x0 + (i + 0.5) * step;
      const h = cur[i + 1], hl = cur[i], hu = prev[i + 1];
      let c;
      if (h < 0) {
        // agua: más clara en la orilla
        c = mix([34, 92, 150], [70, 130, 180], sat(1 + h / 60));
      } else {
        c = tint(h);
        const ci = w.cityAt(x, z);
        const cd = ci ? w.cityDensity(x, z, ci) : 0;
        if (cd > 0.3) {
          // manzanas: damero gris
          const blk = ((Math.floor(x / 260) + Math.floor(z / 260)) & 1) ? 1 : 0.86;
          c = mix(c, [176 * blk, 170 * blk, 160 * blk], sat((cd - 0.3) * 3));
        } else if (h < 900 && w.nForest.fbm(x / 2200, z / 2200, 3) > 0.15) {
          c = mix(c, [40, 86, 44], 0.75);
        }
        // sombreado del relieve con luz del noroeste
        const s = Math.max(0.55, Math.min(1.5, 1 + ((h - hl) + (h - hu)) * shade));
        c = [c[0] * s, c[1] * s, c[2] * s];
      }
      const k = (j * RES + i) * 4;
      d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
    }
  }

  // Avanza el trabajo en curso; budgetMs = Infinity lo completa de golpe
  step(budgetMs) {
    const job = this.job;
    if (!job) return;
    const t0 = performance.now();
    while (job.row < this.res) {
      if (job.row < 0) this.rowHeights(job, -1, job.prev);
      else {
        this.rowHeights(job, job.row, job.cur);
        this.shadeRow(job, job.row);
        const t = job.prev; job.prev = job.cur; job.cur = t;
      }
      job.row++;
      if (performance.now() - t0 > budgetMs) return;
    }
    // terminado: se publica la caché nueva
    this.back.g.putImageData(this.back.img, 0, 0);
    const f = this.front; this.front = this.back; this.back = f;
    this.cx = job.x; this.cz = job.z; this.fspan = job.span;
    this.job = null;
  }

  // Recalcula alrededor de (x, z) cuando el centro se ha alejado lo bastante
  update(x, z, budgetMs = 1.5) {
    if (!this.job) {
      if (this.cx !== null && Math.hypot(x - this.cx, z - this.cz) < this.span * 0.18) return;
      this.startJob(x, z);
    }
    this.step(budgetMs);
  }
}

export class NavMap {
  constructor(world) {
    this.world = world;
    this.relief = new ReliefCache(world, SPAN, RES);
    this.contacts = () => [];          // [{x, z, air}] (lo rellena main)
    this.dest = null;                  // {x, z, icao}
  }

  update(x, z, budgetMs = 1.5) { this.relief.update(x, z, budgetMs); }

  // ---------- dibujo en una pantalla ----------
  // s: estado de instrumentos (hdg en grados); pos: posición del avión
  draw(g, x, y, w, h, s, pos, range) {
    const hdg = s.hdg * Math.PI / 180;
    const ox = x + w / 2, oy = y + h * 0.64;          // símbolo del avión
    const rPx = h * 0.56;                              // radio del anillo exterior
    const k = rPx / range;                             // píxeles por metro
    const sin = Math.sin(hdg), cos = Math.cos(hdg);
    // mundo -> pantalla (rumbo arriba)
    const toS = (wx, wz) => {
      const dx = (wx - pos.x) * k, dz = (wz - pos.z) * k;
      return [ox + dx * cos + dz * sin, oy - dx * sin + dz * cos];
    };
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = '#04070a'; g.fillRect(x, y, w, h);
    // relieve
    const rc = this.relief;
    if (rc.ready) {
      g.save();
      g.translate(ox, oy); g.rotate(-hdg);
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.92;
      g.drawImage(rc.front.cv, (rc.cx - rc.fspan / 2 - pos.x) * k, (rc.cz - rc.fspan / 2 - pos.z) * k, rc.fspan * k, rc.fspan * k);
      g.restore();
      // velo para que resalten los símbolos
      const vg = g.createRadialGradient(ox, oy, rPx * 0.3, ox, oy, rPx * 1.5);
      vg.addColorStop(0, 'rgba(0,0,0,0.1)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = vg; g.fillRect(x, y, w, h);
    }
    const fs = Math.round(h * 0.048);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // aeropuertos
    for (const ap of this.world.airports) {
      const half = ap.len / 2;
      const [ax, ay] = toS(ap.x - ap.dir.x * half, ap.z - ap.dir.z * half);
      const [bx, by] = toS(ap.x + ap.dir.x * half, ap.z + ap.dir.z * half);
      const [cx, cy] = toS(ap.x, ap.z);
      if (cx < x - 40 || cx > x + w + 40 || cy < y - 40 || cy > y + h + 40) continue;
      const isDest = this.dest && ap.x === this.dest.x && ap.z === this.dest.z;
      g.strokeStyle = '#000'; g.lineWidth = 7;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = isDest ? '#ff4fd8' : '#f4f4f4'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.beginPath(); g.arc(cx, cy, Math.max(9, half * k * 0.7), 0, TAU); g.lineWidth = 1.5; g.stroke();
      this.label(g, ap.icao, cx + 12, cy - 10, fs, isDest ? '#ff4fd8' : '#e8f0ff');
    }
    // contactos de combate
    for (const c of this.contacts()) {
      const [cx, cy] = toS(c.x, c.z);
      if (cx < x || cx > x + w || cy < y || cy > y + h) continue;
      g.fillStyle = '#ff3a2a'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath();
      if (c.air) { g.moveTo(cx, cy - 7); g.lineTo(cx + 6, cy + 5); g.lineTo(cx, cy + 2); g.lineTo(cx - 6, cy + 5); }
      else { g.moveTo(cx, cy - 6); g.lineTo(cx + 6, cy); g.lineTo(cx, cy + 6); g.lineTo(cx - 6, cy); }
      g.closePath(); g.fill(); g.stroke();
    }
    // anillos de distancia y rosa de rumbos
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.5;
    g.setLineDash([5, 6]);
    g.beginPath(); g.arc(ox, oy, rPx / 2, 0, TAU); g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.arc(ox, oy, rPx, 0, TAU); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 10) {
      const ra = (a * Math.PI / 180) - hdg - Math.PI / 2;
      const cs = Math.cos(ra), sn = Math.sin(ra);
      const l = a % 30 === 0 ? 11 : 6;
      g.strokeStyle = '#fff'; g.lineWidth = a % 30 === 0 ? 2 : 1.2;
      g.beginPath(); g.moveTo(ox + cs * rPx, oy + sn * rPx); g.lineTo(ox + cs * (rPx - l), oy + sn * (rPx - l)); g.stroke();
      if (a % 30 === 0) {
        const t = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] ?? String(a / 10);
        this.label(g, t, ox + cs * (rPx - 22), oy + sn * (rPx - 22), a % 90 === 0 ? fs * 1.15 : fs * 0.9, a === 0 ? '#7fd8ff' : '#fff', true);
      }
    }
    // escala
    const km = range / 1000;
    this.label(g, `${km / 2}`, ox + rPx / 2 * 0.7 + 4, oy + rPx / 2 * 0.7 + 4, fs * 0.85, '#cfd8e0', true);
    this.label(g, `${km}`, ox + rPx * 0.7 + 4, oy + rPx * 0.7 + 4, fs * 0.85, '#cfd8e0', true);
    // línea de rumbo
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5; g.setLineDash([2, 5]);
    g.beginPath(); g.moveTo(ox, oy - 14); g.lineTo(ox, oy - rPx); g.stroke(); g.setLineDash([]);
    // ruta al destino
    if (this.dest) {
      let [dx, dy] = toS(this.dest.x, this.dest.z);
      const vx = dx - ox, vy = dy - oy, d = Math.hypot(vx, vy);
      const lim = rPx * 1.02;
      const off = d > lim;
      if (off) { dx = ox + vx / d * lim; dy = oy + vy / d * lim; }
      g.strokeStyle = '#000'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(ox, oy); g.lineTo(dx, dy); g.stroke();
      g.strokeStyle = '#ff4fd8'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(ox, oy); g.lineTo(dx, dy); g.stroke();
      g.fillStyle = '#ff4fd8';
      g.save(); g.translate(dx, dy);
      if (off) { g.rotate(Math.atan2(vy, vx)); g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, -7); g.lineTo(-6, 7); g.closePath(); g.fill(); }
      else { g.rotate(Math.PI / 4); g.fillRect(-6, -6, 12, 12); }
      g.restore();
    }
    // avión propio
    g.save(); g.translate(ox, oy);
    g.fillStyle = '#ffd23a'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -13); g.lineTo(2.5, -4); g.lineTo(12, 2); g.lineTo(12, 5); g.lineTo(2.5, 2); g.lineTo(2, 9); g.lineTo(5, 12); g.lineTo(-5, 12); g.lineTo(-2, 9); g.lineTo(-2.5, 2); g.lineTo(-12, 5); g.lineTo(-12, 2); g.lineTo(-2.5, -4);
    g.closePath(); g.stroke(); g.fill();
    g.restore();
    // cabecera: rumbo y destino
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(ox - fs * 2.2, y + 4, fs * 4.4, fs * 1.5);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(ox - fs * 2.2, y + 4, fs * 4.4, fs * 1.5);
    this.label(g, String(Math.round(s.hdg) % 360).padStart(3, '0') + '°', ox, y + 4 + fs * 0.78, fs * 1.15, '#fff', false);
    if (this.dest) {
      g.textAlign = 'right';
      this.label(g, this.dest.icao, x + w - 8, y + fs * 1.0, fs, '#ff4fd8', false, 'right');
      this.label(g, `${s.destDist.toFixed(1)} km`, x + w - 8, y + fs * 2.1, fs * 0.9, '#fff', false, 'right');
      const gsMs = s.gs / 1.94384;
      if (gsMs > 15) {
        const sec = s.destDist * 1000 / gsMs;
        this.label(g, `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`, x + w - 8, y + fs * 3.1, fs * 0.9, '#9fe8ff', false, 'right');
      }
    }
    this.label(g, `GS ${Math.round(s.gs)}`, x + 8, y + fs * 1.0, fs * 0.9, '#7dff8a', false, 'left');
    this.label(g, `ESC ${km} KM`, x + 8, y + h - fs * 0.9, fs * 0.85, '#cfd8e0', false, 'left');
    g.restore();
  }

  label(g, t, x, y, size, col, center = false, align) {
    g.font = `bold ${Math.round(size)}px "Share Tech Mono", monospace`;
    g.textAlign = align || (center ? 'center' : 'left'); g.textBaseline = 'middle';
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(t, x, y);
    g.fillStyle = col; g.fillText(t, x, y);
  }
}
