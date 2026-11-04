// Mapa táctico (J o botón de la barra): relieve norte arriba con zoom (rueda,
// centrado en el cursor) y desplazamiento (arrastrar), aeropuertos, ruta, el
// avión con su rumbo y todos los blancos con su posición. Un clic en un blanco,
// en el mapa o en la lista lateral, lo designa en el sistema de fijación.
// El relieve combina tres cachés: una amplia de 96 km alrededor del avión, la
// del mapa móvil de cabina (32 km) y una de detalle que sigue a la vista y se
// recalcula al hacer zoom.
import { ReliefCache } from './navmap.js?v=39';
import { KINDS } from './combat.js?v=39';

const TAU = Math.PI * 2;
const MIN_MPP = 2.5, MAX_MPP = 240;           // metros por píxel de pantalla
const COL = { hostile: '#ff4a3c', training: '#ffc14d', sel: '#62ff86', me: '#ffd23a', dest: '#ff4fd8' };
const fmtD = (d) => d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`;
const brg = (dx, dz) => String(Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360)).padStart(3, '0');

export class TacMap {
  constructor({ combat, targeting, getFm, getNav, onSelect }) {
    this.combat = combat; this.targeting = targeting;
    this.getFm = getFm; this.getNav = getNav; this.onSelect = onSelect;
    this.el = document.getElementById('tacmap');
    this.cv = document.getElementById('tacmap-cv');
    this.g = this.cv.getContext('2d');
    this.listEl = document.getElementById('tacmap-list');
    this.selEl = document.getElementById('tacmap-sel');
    this.isOpen = false; this.follow = true;
    this.vx = 0; this.vz = 0; this.mpp = 30;
    this.hover = null; this.listT = 0; this.rows = [];
    this.world = null;
    this.bindEvents();
  }

  setWorld(world, navMap) {
    this.world = world; this.navMap = navMap;
    this.wide = new ReliefCache(world, 96000, 256);
    this.detail = new ReliefCache(world, 8000, 384);
  }

  open() {
    if (!this.world || this.isOpen) return;
    this.isOpen = true; this.follow = true; this.listT = 0;
    this.el.classList.remove('hidden');
  }
  close() {
    this.isOpen = false; this.hover = null;
    this.el.classList.add('hidden');
  }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  // ---------- coordenadas ----------
  get dpr() { return Math.min(devicePixelRatio || 1, 2); }
  toS(x, z) { const k = this.dpr / this.mpp; return [this.cv.width / 2 + (x - this.vx) * k, this.cv.height / 2 + (z - this.vz) * k]; }
  toW(px, py) { return [this.vx + (px - this.cv.width / 2) * this.mpp / this.dpr, this.vz + (py - this.cv.height / 2) * this.mpp / this.dpr]; }
  evPos(e) { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr]; }

  // blanco vivo más próximo a un punto de pantalla (radio en píxeles CSS)
  pick(px, py, radius = 16) {
    let best = null, bd = radius * this.dpr;
    for (const e of this.combat.enemies) {
      if (e.dead) continue;
      const [sx, sy] = this.toS(e.pos.x, e.pos.z);
      const d = Math.hypot(sx - px, sy - py);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  select(e, center = false) {
    if (!e || e.dead) return;
    this.targeting.select(e, true);
    if (center) { this.follow = false; this.vx = e.pos.x; this.vz = e.pos.z; }
    this.listT = 0;
    this.onSelect?.(e);
  }

  bindEvents() {
    const cv = this.cv;
    let drag = null;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = this.evPos(e);
      const [wx, wz] = this.toW(px, py);
      this.mpp = Math.min(MAX_MPP, Math.max(MIN_MPP, this.mpp * Math.pow(1.0015, e.deltaY)));
      // el punto bajo el cursor se queda quieto
      const [nx, nz] = this.toW(px, py);
      this.vx += wx - nx; this.vz += wz - nz;
      if (Math.abs(wx - nx) + Math.abs(wz - nz) > 1) this.follow = false;
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, vx: this.vx, vz: this.vz, moved: false };
    });
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = this.evPos(e);
      this.hover = this.pick(px, py);
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) { this.follow = false; this.vx = drag.vx - dx * this.mpp; this.vz = drag.vz - dy * this.mpp; }
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) { const [px, py] = this.evPos(e); this.select(this.pick(px, py)); }
      drag = null;
    });
    cv.addEventListener('pointerleave', () => { this.hover = null; });
    document.getElementById('tacmap-center').addEventListener('click', () => { this.follow = true; });
    document.getElementById('tacmap-close').addEventListener('click', () => this.close());
    // al pulsar (no al soltar): la lista se regenera y un clic entre dos regeneraciones se perdería
    this.listEl.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('[data-i]');
      if (row) this.select(this.rows[+row.dataset.i], true);
    });
  }

  // ---------- bucle ----------
  update(dt) {
    const fm = this.getFm();
    if (!this.world || !fm) return;
    // cerrado: solo mantiene templada la caché amplia, con un presupuesto mínimo
    if (!this.isOpen) { this.wide.update(fm.pos.x, fm.pos.z, 0.4); return; }
    const cw = this.cv.clientWidth, ch = this.cv.clientHeight, dpr = this.dpr;
    if (this.cv.width !== Math.round(cw * dpr) || this.cv.height !== Math.round(ch * dpr)) {
      this.cv.width = Math.round(cw * dpr); this.cv.height = Math.round(ch * dpr);
    }
    if (this.follow) { this.vx = fm.pos.x; this.vz = fm.pos.z; }
    // relieve: la caché amplia sigue al avión; la de detalle, a la vista
    this.wide.update(fm.pos.x, fm.pos.z, 2.5);
    const want = Math.min(30000, Math.max(2500, this.mpp * Math.max(cw, ch) * 1.15));
    const d = this.detail;
    if (!d.job) {
      const off = d.ready ? Math.hypot(this.vx - d.cx, this.vz - d.cz) : Infinity;
      const ratio = d.ready ? want / d.fspan : 0;
      if (off > d.fspan * 0.22 || ratio > 1.5 || ratio < 0.6) d.startJob(this.vx, this.vz, want);
    }
    d.step(4);
    this.draw(fm);
    this.listT -= dt;
    if (this.listT <= 0) { this.listT = 0.25; this.updateList(fm); }
  }

  drawCache(c, alpha = 1) {
    if (!c || !c.ready) return;
    const [x0, y0] = this.toS(c.cx - c.fspan / 2, c.cz - c.fspan / 2);
    const s = c.fspan * this.dpr / this.mpp;
    if (x0 > this.cv.width || y0 > this.cv.height || x0 + s < 0 || y0 + s < 0) return;
    this.g.globalAlpha = alpha;
    this.g.drawImage(c.front.cv, x0, y0, s, s);
    this.g.globalAlpha = 1;
  }

  draw(fm) {
    const g = this.g, W = this.cv.width, H = this.cv.height, dpr = this.dpr, k = dpr / this.mpp;
    const fs = 12 * dpr;
    g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    this.drawCache(this.wide);
    this.drawCache(this.navMap?.relief);
    if (this.detail.ready && this.detail.fspan < 31000) this.drawCache(this.detail);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, W, H);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const [mx, my] = this.toS(fm.pos.x, fm.pos.z);
    // anillos de distancia alrededor del avión
    const steps = [500, 1000, 2000, 5000, 10000, 20000, 50000];
    const ring = steps.find(s => s * k > 110 * dpr) || 50000;
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = dpr; g.setLineDash([4 * dpr, 6 * dpr]);
    for (let i = 1; i <= 4; i++) {
      g.beginPath(); g.arc(mx, my, ring * i * k, 0, TAU); g.stroke();
      this.label(fmtD(ring * i), mx + ring * i * k * 0.707 + 4 * dpr, my - ring * i * k * 0.707, fs * 0.9, 'rgba(230,240,255,0.8)');
    }
    g.setLineDash([]);
    // aeropuertos
    const nav = this.getNav();
    for (const ap of this.world.airports) {
      const half = ap.len / 2;
      const [ax, ay] = this.toS(ap.x - ap.dir.x * half, ap.z - ap.dir.z * half);
      const [bx, by] = this.toS(ap.x + ap.dir.x * half, ap.z + ap.dir.z * half);
      const [cx, cy] = this.toS(ap.x, ap.z);
      if (cx < -60 || cx > W + 60 || cy < -60 || cy > H + 60) continue;
      const isDest = nav && ap.x === nav.x && ap.z === nav.z;
      g.strokeStyle = '#000'; g.lineWidth = 7 * dpr;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = isDest ? COL.dest : '#f4f4f4'; g.lineWidth = 3.5 * dpr;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      this.label(`${ap.icao} ${ap.name}`, cx + 12 * dpr, cy - 12 * dpr, fs, isDest ? COL.dest : '#e8f0ff');
    }
    // ruta al destino o a la zona de misión
    if (nav) {
      const [dx, dy] = this.toS(nav.x, nav.z);
      g.strokeStyle = '#000'; g.lineWidth = 5 * dpr;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(dx, dy); g.stroke();
      g.strokeStyle = COL.dest; g.lineWidth = 2.5 * dpr;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(dx, dy); g.stroke();
    }
    // blancos
    const sel = this.targeting.target;
    for (const e of this.combat.enemies) {
      if (e.dead) continue;
      const [sx, sy] = this.toS(e.pos.x, e.pos.z);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const col = e.training ? COL.training : COL.hostile, r = 7 * dpr;
      g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 1.5 * dpr;
      g.save(); g.translate(sx, sy);
      g.beginPath();
      if (e.air) {
        // aéreo: flecha según su rumbo
        const a = e.dir ? Math.atan2(e.dir.x, -e.dir.z) : 0;
        g.rotate(a); g.moveTo(0, -r * 1.2); g.lineTo(r, r); g.lineTo(0, r * 0.45); g.lineTo(-r, r);
      } else { g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); }
      g.closePath(); g.fill(); g.stroke();
      g.restore();
      if (e === this.hover || this.mpp < 12) this.label(KINDS[e.kind]?.label || e.kind, sx + 11 * dpr, sy + 1, fs * 0.9, col);
    }
    // blanco designado: línea desde el avión, recuadro y datos
    if (sel && !sel.dead) {
      const [sx, sy] = this.toS(sel.pos.x, sel.pos.z), r = 13 * dpr;
      g.strokeStyle = COL.sel; g.lineWidth = 1.6 * dpr; g.setLineDash([6 * dpr, 5 * dpr]);
      g.beginPath(); g.moveTo(mx, my); g.lineTo(sx, sy); g.stroke(); g.setLineDash([]);
      g.lineWidth = 2.2 * dpr; g.strokeRect(sx - r, sy - r, r * 2, r * 2);
      const tg = this.targeting;
      this.label(`${tg.idText() || (KINDS[sel.kind]?.label || sel.kind)}`, sx + r + 6 * dpr, sy - 7 * dpr, fs, COL.sel);
      this.label(`${fmtD(sel.pos.distanceTo(fm.pos))} · ${brg(sel.pos.x - fm.pos.x, sel.pos.z - fm.pos.z)}°${tg.locked ? ' · FIJADO' : ''}`, sx + r + 6 * dpr, sy + 9 * dpr, fs * 0.9, tg.locked ? COL.hostile : '#e8f0ff');
    }
    // avión propio con su rumbo
    const hdg = -fm.euler.y;
    g.save(); g.translate(mx, my); g.rotate(hdg); g.scale(dpr * 1.2, dpr * 1.2);
    g.fillStyle = COL.me; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -13); g.lineTo(2.5, -4); g.lineTo(12, 2); g.lineTo(12, 5); g.lineTo(2.5, 2); g.lineTo(2, 9); g.lineTo(5, 12); g.lineTo(-5, 12); g.lineTo(-2, 9); g.lineTo(-2.5, 2); g.lineTo(-12, 5); g.lineTo(-12, 2); g.lineTo(-2.5, -4);
    g.closePath(); g.stroke(); g.fill();
    g.strokeStyle = 'rgba(255,210,58,0.7)'; g.lineWidth = 1.5; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(0, -16); g.lineTo(0, -70); g.stroke(); g.setLineDash([]);
    g.restore();
    // ficha emergente del blanco bajo el cursor
    if (this.hover && !this.hover.dead) {
      const e = this.hover, [sx, sy] = this.toS(e.pos.x, e.pos.z);
      const lines = [
        `${KINDS[e.kind]?.label || e.kind} · ${e.training ? 'ENTRENAMIENTO' : 'HOSTIL'}`,
        `${fmtD(e.pos.distanceTo(fm.pos))} · rumbo ${brg(e.pos.x - fm.pos.x, e.pos.z - fm.pos.z)}°`,
        e.air ? `altitud ${Math.round(e.pos.y)} m` : `en tierra · ${Math.round(e.pos.y)} m`,
        e === sel ? 'designado' : 'clic para designar',
      ];
      g.font = `600 ${fs}px "Share Tech Mono", monospace`;
      const bw = Math.max(...lines.map(l => g.measureText(l).width)) + 16 * dpr, bh = lines.length * fs * 1.35 + 10 * dpr;
      const bx = Math.min(sx + 16 * dpr, W - bw - 6), by = Math.max(6, sy - bh - 10 * dpr);
      g.fillStyle = 'rgba(6,12,20,0.92)'; g.fillRect(bx, by, bw, bh);
      g.strokeStyle = e.training ? COL.training : COL.hostile; g.lineWidth = dpr; g.strokeRect(bx, by, bw, bh);
      g.textAlign = 'left'; g.textBaseline = 'top';
      lines.forEach((l, i) => { g.fillStyle = i ? '#dfe8f0' : g.strokeStyle; g.fillText(l, bx + 8 * dpr, by + 6 * dpr + i * fs * 1.35); });
    }
    // norte y barra de escala
    this.label('N ▲', 14 * dpr, 20 * dpr, fs * 1.2, '#7fd8ff');
    const bar = steps.find(s => s * k > 80 * dpr) || 50000;
    const bx = 14 * dpr, by = H - 18 * dpr;
    g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(bx, by - 5 * dpr); g.lineTo(bx, by); g.lineTo(bx + bar * k, by); g.lineTo(bx + bar * k, by - 5 * dpr); g.stroke();
    this.label(fmtD(bar), bx + bar * k + 8 * dpr, by - 3 * dpr, fs, '#fff');
  }

  label(t, x, y, size, col) {
    const g = this.g;
    g.font = `bold ${Math.round(size)}px "Share Tech Mono", monospace`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.lineWidth = 3 * this.dpr; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(t, x, y);
    g.fillStyle = col; g.fillText(t, x, y);
  }

  // lista lateral: blancos por distancia y ficha del designado
  updateList(fm) {
    const tg = this.targeting, sel = tg.target;
    const alive = this.combat.enemies.filter(e => !e.dead).map(e => ({ e, d: e.pos.distanceTo(fm.pos) })).sort((a, b) => a.d - b.d);
    this.rows = alive.map(a => a.e);
    const html = alive.length ? alive.map(({ e, d }, i) =>
      `<div class="tm-row${e === sel ? ' sel' : ''}${e.training ? ' trn' : ''}" data-i="${i}"><i>${e.air ? '▲' : '◆'}</i><span>${KINDS[e.kind]?.label || e.kind}</span><b>${fmtD(d)}</b><em>${brg(e.pos.x - fm.pos.x, e.pos.z - fm.pos.z)}°</em></div>`).join('')
      : '<div class="tm-empty">Sin blancos en la zona</div>';
    if (html !== this.listHtml) { this.listEl.innerHTML = html; this.listHtml = html; }
    if (sel && !sel.dead) {
      const d = sel.pos.distanceTo(fm.pos);
      const st = tg.locked ? '<b class="lock">FIJADO</b>' : tg.cur?.far ? 'fuera de alcance: sigue la flecha del HUD' : 'acércate y apunta el morro para fijarlo';
      this.selEl.innerHTML = `<div class="tm-k">BLANCO DESIGNADO</div><div class="tm-v">${tg.idText() || KINDS[sel.kind]?.label}</div><div>${fmtD(d)} · rumbo ${brg(sel.pos.x - fm.pos.x, sel.pos.z - fm.pos.z)}°</div><div>${st}</div>`;
    } else this.selEl.innerHTML = '<div class="tm-k">BLANCO DESIGNADO</div><div>Ninguno: haz clic en un blanco del mapa o de la lista</div>';
  }
}
