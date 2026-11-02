// Dibujo de instrumentos (analógicos y de cristal) en canvas 2D.
const TAU = Math.PI * 2;

function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }

function bezel(g, x, y, r) {
  circle(g, x, y, r * 1.12); g.fillStyle = '#1c1d1f'; g.fill();
  circle(g, x, y, r * 1.12); g.lineWidth = r * 0.06; g.strokeStyle = '#4a4c50'; g.stroke();
  circle(g, x, y, r); g.fillStyle = '#0b0c0d'; g.fill();
  // tornillos
  g.fillStyle = '#5a5c60';
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    circle(g, x + Math.cos(a) * r * 1.22, y + Math.sin(a) * r * 1.22, r * 0.05); g.fill();
  }
}

function glassShine(g, x, y, r) {
  const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
  gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.03)');
  circle(g, x, y, r); g.fillStyle = gr; g.fill();
}

function needle(g, x, y, len, ang, color = '#f2f2f2', w = 3, tail = 0.18) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(-len * tail, -w); g.lineTo(len, 0); g.lineTo(-len * tail, w); g.closePath();
  g.fillStyle = color; g.fill(); g.restore();
  circle(g, x, y, w * 1.6); g.fillStyle = '#333'; g.fill();
}

function dial(g, x, y, r, opt) {
  const { min, max, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, major, minor, label, arcs = [], fmt = v => v, numbers = true, unit } = opt;
  const A = v => a0 + (a1 - a0) * (v - min) / (max - min);
  for (const [f, t, col] of arcs) {
    g.beginPath(); g.arc(x, y, r * 0.86, A(f), A(t)); g.lineWidth = r * 0.07; g.strokeStyle = col; g.stroke();
  }
  g.strokeStyle = '#eee'; g.fillStyle = '#eee';
  for (let v = min; v <= max + 1e-6; v += minor) {
    const a = A(v), isM = Math.abs((v - min) / major - Math.round((v - min) / major)) < 1e-6;
    const l = isM ? 0.16 : 0.08;
    g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95);
    g.lineTo(x + Math.cos(a) * r * (0.95 - l), y + Math.sin(a) * r * (0.95 - l));
    g.lineWidth = isM ? r * 0.035 : r * 0.02; g.stroke();
    if (isM && numbers) {
      g.font = `bold ${r * 0.2}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(fmt(Math.round(v * 100) / 100), x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62);
    }
  }
  if (label) { g.font = `${r * 0.14}px sans-serif`; g.fillStyle = '#bbb'; g.textAlign = 'center'; g.fillText(label, x, y + r * 0.35); }
  if (unit) { g.font = `${r * 0.12}px sans-serif`; g.fillStyle = '#999'; g.fillText(unit, x, y - r * 0.3); }
  return A;
}

// ---------- Instrumentos analógicos ----------
export function asi(g, x, y, r, s) {
  bezel(g, x, y, r);
  const max = Math.ceil(s.vmaxKt * 1.15 / 20) * 20;
  const step = max > 300 ? 50 : 20;
  const A = dial(g, x, y, r, {
    min: 0, max, major: step * 2 > max / 4 ? step : step * 2, minor: step / 2, label: 'NUDOS',
    arcs: [[s.vsKt * 0.85, s.vsKt * 1.6, '#eee'], [s.vsKt, s.vmaxKt * 0.75, '#2c2'], [s.vmaxKt * 0.75, s.vmaxKt, '#ec2'], [s.vmaxKt, max, '#d22']],
  });
  needle(g, x, y, r * 0.85, A(Math.min(s.ias, max)));
  glassShine(g, x, y, r);
}

export function attitude(g, x, y, r, s) {
  bezel(g, x, y, r);
  g.save(); circle(g, x, y, r * 0.97); g.clip();
  g.translate(x, y); g.rotate(-s.roll * Math.PI / 180);
  const pp = r / 30;
  const off = s.pitch * pp;
  g.fillStyle = '#2d7fd0'; g.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
  g.fillStyle = '#7a4a22'; g.fillRect(-r * 2, off, r * 4, r * 3);
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
  g.lineWidth = 1.5; g.fillStyle = '#fff'; g.font = `${r * 0.12}px sans-serif`; g.textAlign = 'left';
  for (let p = -30; p <= 30; p += 5) {
    if (!p) continue;
    const w = p % 10 === 0 ? r * 0.35 : r * 0.18, yy = off - p * pp;
    g.beginPath(); g.moveTo(-w / 2, yy); g.lineTo(w / 2, yy); g.stroke();
    if (p % 10 === 0) g.fillText(Math.abs(p), w / 2 + 3, yy + 4);
  }
  // escala de alabeo
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const ra = (a - 90) * Math.PI / 180;
    const l = a % 30 === 0 ? 0.14 : 0.08;
    g.beginPath(); g.moveTo(Math.cos(ra) * r * 0.95, Math.sin(ra) * r * 0.95); g.lineTo(Math.cos(ra) * r * (0.95 - l), Math.sin(ra) * r * (0.95 - l)); g.stroke();
  }
  g.restore();
  // avión fijo
  g.strokeStyle = '#ffae00'; g.lineWidth = r * 0.06;
  g.beginPath(); g.moveTo(x - r * 0.55, y); g.lineTo(x - r * 0.18, y); g.lineTo(x - r * 0.08, y + r * 0.08);
  g.moveTo(x + r * 0.55, y); g.lineTo(x + r * 0.18, y); g.lineTo(x + r * 0.08, y + r * 0.08); g.stroke();
  circle(g, x, y, r * 0.04); g.fillStyle = '#ffae00'; g.fill();
  g.beginPath(); g.moveTo(x, y - r * 0.8); g.lineTo(x - r * 0.07, y - r * 0.68); g.lineTo(x + r * 0.07, y - r * 0.68); g.closePath(); g.fill();
  glassShine(g, x, y, r);
}

export function altimeter(g, x, y, r, s) {
  bezel(g, x, y, r);
  dial(g, x, y, r, { min: 0, max: 10, a0: -Math.PI / 2, a1: Math.PI * 1.5, major: 1, minor: 0.2, numbers: true, fmt: v => v % 10, label: 'ALT x100 FT' });
  const ft = Math.max(0, s.alt);
  // ventana de miles
  g.fillStyle = '#000'; g.fillRect(x + r * 0.1, y - r * 0.12, r * 0.42, r * 0.24);
  g.fillStyle = '#fff'; g.font = `bold ${r * 0.18}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(Math.floor(ft / 1000)).padStart(2, '0'), x + r * 0.31, y + 1);
  needle(g, x, y, r * 0.55, -Math.PI / 2 + ((ft % 10000) / 10000) * TAU, '#ddd', r * 0.06, 0.1);
  needle(g, x, y, r * 0.85, -Math.PI / 2 + ((ft % 1000) / 1000) * TAU, '#fff', r * 0.035);
  glassShine(g, x, y, r);
}

export function heading(g, x, y, r, s) {
  bezel(g, x, y, r);
  g.save(); g.translate(x, y); g.rotate(-s.hdg * Math.PI / 180);
  g.strokeStyle = '#eee'; g.fillStyle = '#eee'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let a = 0; a < 360; a += 5) {
    const ra = (a - 90) * Math.PI / 180, l = a % 30 === 0 ? 0.15 : a % 10 === 0 ? 0.1 : 0.06;
    g.lineWidth = a % 10 === 0 ? 2 : 1;
    g.beginPath(); g.moveTo(Math.cos(ra) * r * 0.95, Math.sin(ra) * r * 0.95); g.lineTo(Math.cos(ra) * r * (0.95 - l), Math.sin(ra) * r * (0.95 - l)); g.stroke();
    if (a % 30 === 0) {
      g.save(); g.rotate(a * Math.PI / 180);
      g.font = `bold ${r * (a % 90 === 0 ? 0.22 : 0.16)}px sans-serif`;
      g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] ?? String(a / 10), 0, -r * 0.66);
      g.restore();
    }
  }
  // bug de destino
  if (s.destBrg != null) {
    g.save(); g.rotate(s.destBrg * Math.PI / 180);
    g.fillStyle = '#ff3fd0'; g.fillRect(-r * 0.06, -r * 0.98, r * 0.12, r * 0.1);
    g.restore();
  }
  g.restore();
  // avión fijo
  g.strokeStyle = '#ffae00'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x, y - r * 0.35); g.lineTo(x, y + r * 0.3); g.moveTo(x - r * 0.25, y - r * 0.05); g.lineTo(x + r * 0.25, y - r * 0.05);
  g.moveTo(x - r * 0.1, y + r * 0.25); g.lineTo(x + r * 0.1, y + r * 0.25); g.stroke();
  g.fillStyle = '#ffae00'; g.beginPath(); g.moveTo(x, y - r * 0.98); g.lineTo(x - r * 0.06, y - r * 1.08); g.lineTo(x + r * 0.06, y - r * 1.08); g.fill();
  glassShine(g, x, y, r);
}

export function vsi(g, x, y, r, s) {
  bezel(g, x, y, r);
  const A = dial(g, x, y, r, { min: -20, max: 20, a0: Math.PI * 0.1, a1: Math.PI * 1.9, major: 5, minor: 1, fmt: v => Math.abs(v / 10), label: 'VS x1000' });
  needle(g, x, y, r * 0.85, A(Math.max(-20, Math.min(20, s.vs / 100))));
  glassShine(g, x, y, r);
}

export function turnCoord(g, x, y, r, s) {
  bezel(g, x, y, r);
  g.strokeStyle = '#eee'; g.lineWidth = 2;
  g.save(); g.translate(x, y - r * 0.05); g.rotate(Math.max(-0.6, Math.min(0.6, s.turnRate / 3 * 0.35)));
  g.fillStyle = '#fff'; g.fillRect(-r * 0.62, -r * 0.03, r * 1.24, r * 0.06); g.fillRect(-r * 0.03, -r * 0.18, r * 0.06, r * 0.2);
  circle(g, 0, 0, r * 0.08); g.fill();
  g.restore();
  // marcas de viraje estándar
  g.fillStyle = '#fff';
  for (const sx of [-1, 1]) { g.save(); g.translate(x, y - r * 0.05); g.rotate(sx * 0.35); g.fillRect(sx > 0 ? r * 0.7 : -r * 0.85, -2, r * 0.15, 4); g.restore(); }
  // bola
  g.fillStyle = '#222'; g.strokeStyle = '#aaa'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(x, y + r * 0.45, r * 0.45, r * 0.11, 0, 0, TAU); g.fill(); g.stroke();
  circle(g, x + Math.max(-0.38, Math.min(0.38, s.slip)) * r, y + r * 0.45, r * 0.09); g.fillStyle = '#ddd'; g.fill();
  g.font = `${r * 0.13}px sans-serif`; g.fillStyle = '#bbb'; g.textAlign = 'center'; g.fillText('L    TURN    R', x, y + r * 0.78);
  glassShine(g, x, y, r);
}

export function smallGauge(g, x, y, r, val, label, min = 0, max = 1, arcs) {
  bezel(g, x, y, r);
  const A = dial(g, x, y, r, { min, max, major: (max - min) / 4, minor: (max - min) / 8, numbers: false, label, a0: Math.PI * 0.8, a1: Math.PI * 2.2, arcs: arcs || [[min + (max - min) * 0.2, min + (max - min) * 0.85, '#2c2']] });
  needle(g, x, y, r * 0.8, A(Math.max(min, Math.min(max, val))));
}

export function tach(g, x, y, r, s, label = 'RPM x100', max = 30) {
  bezel(g, x, y, r);
  const A = dial(g, x, y, r, { min: 0, max, major: 5, minor: 1, label, arcs: [[max * 0.35, max * 0.85, '#2c2'], [max * 0.85, max, '#d22']] });
  needle(g, x, y, r * 0.85, A(s.rpm * max * 0.92));
  glassShine(g, x, y, r);
}

export function gearPanel(g, x, y, w, h, s) {
  g.fillStyle = '#18191b'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#444'; g.strokeRect(x, y, w, h);
  g.font = `bold ${h * 0.14}px sans-serif`; g.fillStyle = '#ccc'; g.textAlign = 'center';
  g.fillText('TREN', x + w * 0.5, y + h * 0.16);
  const lights = [[0.5, 0.36], [0.25, 0.62], [0.75, 0.62]];
  for (const [lx, ly] of lights) {
    const col = s.gear > 0.99 ? '#1f2' : s.gear > 0.01 ? '#f31' : '#222';
    circle(g, x + w * lx, y + h * ly, h * 0.1); g.fillStyle = col; g.fill();
    g.strokeStyle = '#555'; g.stroke();
  }
  g.fillStyle = '#ccc'; g.font = `${h * 0.11}px sans-serif`;
  g.fillText(`FLAPS ${Math.round(s.flaps * 100)}%`, x + w * 0.5, y + h * 0.9);
}

export function switches(g, x, y, w, h, rows = 2, cols = 6, seed = 1) {
  g.fillStyle = '#202224'; g.fillRect(x, y, w, h);
  let k = seed;
  const rnd = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const cx = x + (i + 0.5) * w / cols, cy = y + (j + 0.5) * h / rows;
    g.fillStyle = '#555'; circle(g, cx, cy, Math.min(w / cols, h / rows) * 0.18); g.fill();
    g.fillStyle = '#bbb'; g.fillRect(cx - 2, cy - (rnd() < 0.5 ? 10 : -2), 4, 10);
    g.fillStyle = '#888'; g.font = '9px sans-serif'; g.textAlign = 'center';
    g.fillText(['BAT', 'ALT', 'PUMP', 'BCN', 'LAND', 'TAXI', 'NAV', 'STRB', 'PITOT', 'AVN', 'FUEL', 'IGN'][(i + j * cols) % 12], cx, cy + Math.min(w / cols, h / rows) * 0.42);
  }
}

export function radio(g, x, y, w, h, s) {
  g.fillStyle = '#121314'; g.fillRect(x, y, w, h);
  const rows = 3;
  for (let i = 0; i < rows; i++) {
    const yy = y + (i + 0.5) * h / rows;
    g.fillStyle = '#000'; g.fillRect(x + w * 0.08, yy - h * 0.1, w * 0.84, h * 0.2);
    g.fillStyle = i === 2 ? '#ffb000' : '#3f3'; g.font = `bold ${h * 0.13}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(['COM1 118.300  121.900', 'NAV1 110.50   114.10', 'XPDR 7000  ALT'][i], x + w * 0.5, yy + 1);
  }
}

// ---------- Instrumentos de cristal ----------
export function pfd(g, x, y, w, h, s) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#000'; g.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h * 0.48;
  const ppd = h / 45;
  g.save(); g.translate(cx, cy); g.rotate(-s.roll * Math.PI / 180);
  const off = s.pitch * ppd;
  g.fillStyle = '#2478c8'; g.fillRect(-w * 2, -h * 3 + off, w * 4, h * 3);
  g.fillStyle = '#7b4a1d'; g.fillRect(-w * 2, off, w * 4, h * 3);
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-w * 2, off); g.lineTo(w * 2, off); g.stroke();
  g.lineWidth = 1.5; g.fillStyle = '#fff'; g.font = `${h * 0.04}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let p = -40; p <= 40; p += 2.5) {
    if (!p) continue;
    const yy = off - p * ppd, ww = p % 10 === 0 ? w * 0.22 : p % 5 === 0 ? w * 0.12 : w * 0.06;
    if (Math.abs(yy) > h * 0.4) continue;
    g.beginPath(); g.moveTo(-ww / 2, yy); g.lineTo(ww / 2, yy); g.stroke();
    if (p % 10 === 0) { g.fillText(Math.abs(p), -ww / 2 - 12, yy); g.fillText(Math.abs(p), ww / 2 + 12, yy); }
  }
  // arco de alabeo
  g.restore();
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, h * 0.33, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
  g.save(); g.translate(cx, cy); g.rotate(-s.roll * Math.PI / 180);
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -h * 0.33); g.lineTo(-6, -h * 0.3); g.lineTo(6, -h * 0.3); g.fill();
  g.restore();
  // símbolo avión
  g.fillStyle = '#ffd400'; g.strokeStyle = '#000'; g.lineWidth = 1;
  g.fillRect(cx - w * 0.22, cy - 3, w * 0.12, 6); g.fillRect(cx + w * 0.1, cy - 3, w * 0.12, 6); g.fillRect(cx - 4, cy - 4, 8, 8);
  // cinta de velocidad
  const tw = w * 0.17;
  g.fillStyle = 'rgba(40,40,50,0.85)'; g.fillRect(x, y + h * 0.1, tw, h * 0.76);
  g.fillStyle = '#fff'; g.font = `${h * 0.045}px sans-serif`; g.textAlign = 'right';
  const kpp = h * 0.76 / 80;
  for (let v = Math.floor((s.ias - 40) / 10) * 10; v <= s.ias + 40; v += 10) {
    if (v < 0) continue;
    const yy = cy - (v - s.ias) * kpp;
    if (yy < y + h * 0.1 || yy > y + h * 0.86) continue;
    g.fillRect(x + tw - 10, yy, 10, 1.5);
    if (v % 20 === 0) g.fillText(v, x + tw - 14, yy + 5);
  }
  g.fillStyle = '#000'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.fillRect(x + 2, cy - h * 0.04, tw - 4, h * 0.08); g.strokeRect(x + 2, cy - h * 0.04, tw - 4, h * 0.08);
  g.fillStyle = '#fff'; g.font = `bold ${h * 0.055}px monospace`; g.fillText(Math.round(s.ias), x + tw - 8, cy + h * 0.02);
  // cinta de altitud
  const ax = x + w - tw - w * 0.05;
  g.fillStyle = 'rgba(40,40,50,0.85)'; g.fillRect(ax, y + h * 0.1, tw, h * 0.76);
  g.fillStyle = '#fff'; g.font = `${h * 0.042}px sans-serif`; g.textAlign = 'left';
  const app = h * 0.76 / 800;
  for (let a = Math.floor((s.alt - 400) / 100) * 100; a <= s.alt + 400; a += 100) {
    const yy = cy - (a - s.alt) * app;
    if (yy < y + h * 0.1 || yy > y + h * 0.86) continue;
    g.fillRect(ax, yy, 10, 1.5);
    if (a % 200 === 0) g.fillText(a, ax + 14, yy + 5);
  }
  g.fillStyle = '#000'; g.fillRect(ax + 2, cy - h * 0.04, tw - 4, h * 0.08); g.strokeRect(ax + 2, cy - h * 0.04, tw - 4, h * 0.08);
  g.fillStyle = '#fff'; g.font = `bold ${h * 0.05}px monospace`; g.fillText(Math.round(s.alt), ax + 6, cy + h * 0.02);
  // VS
  const vx = x + w - w * 0.045;
  g.fillStyle = 'rgba(40,40,50,0.85)'; g.fillRect(vx, y + h * 0.2, w * 0.04, h * 0.56);
  const vy = cy - Math.max(-1, Math.min(1, s.vs / 4000)) * h * 0.26;
  g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(vx + w * 0.04, cy); g.lineTo(vx, vy); g.stroke();
  // rumbo
  g.fillStyle = 'rgba(40,40,50,0.85)'; g.fillRect(x + w * 0.2, y + h * 0.9, w * 0.6, h * 0.1);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `${h * 0.045}px sans-serif`;
  for (let a = Math.floor((s.hdg - 30) / 5) * 5; a <= s.hdg + 30; a += 5) {
    const xx = cx + (a - s.hdg) * (w * 0.6 / 60);
    g.fillRect(xx, y + h * 0.9, 1.5, a % 10 === 0 ? 8 : 4);
    if (a % 10 === 0) g.fillText(String(((a % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), xx, y + h * 0.975);
  }
  g.fillStyle = '#ffd400'; g.fillRect(cx - 1, y + h * 0.89, 2, h * 0.11);
  // modos
  g.fillStyle = '#2f2'; g.font = `${h * 0.04}px sans-serif`; g.textAlign = 'left';
  g.fillText(s.onGround ? 'TO/GA' : 'MAN', x + w * 0.2, y + h * 0.05);
  g.fillText(s.gearDown ? 'GEAR DN' : '', x + w * 0.45, y + h * 0.05);
  if (s.stall) { g.fillStyle = '#f22'; g.font = `bold ${h * 0.07}px sans-serif`; g.textAlign = 'center'; g.fillText('STALL', cx, cy + h * 0.25); }
  g.restore();
}

export function nd(g, x, y, w, h, s) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#000'; g.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h * 0.7, r = h * 0.6;
  g.strokeStyle = '#fff'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${h * 0.05}px sans-serif`;
  for (let a = 0; a < 360; a += 10) {
    const rel = ((a - s.hdg + 540) % 360) - 180;
    if (Math.abs(rel) > 55) continue;
    const ra = (rel - 90) * Math.PI / 180;
    g.beginPath(); g.moveTo(cx + Math.cos(ra) * r, cy + Math.sin(ra) * r); g.lineTo(cx + Math.cos(ra) * r * 0.94, cy + Math.sin(ra) * r * 0.94); g.stroke();
    if (a % 30 === 0) g.fillText(String(a / 10), cx + Math.cos(ra) * r * 0.86, cy + Math.sin(ra) * r * 0.86);
  }
  g.beginPath(); g.arc(cx, cy, r * 0.5, Math.PI * 1.1, Math.PI * 1.9); g.setLineDash([4, 4]); g.stroke(); g.setLineDash([]);
  // destino
  if (s.destBrg != null) {
    const rel = ((s.destBrg - s.hdg + 540) % 360) - 180;
    const ra = (rel - 90) * Math.PI / 180;
    const rd = Math.min(1, s.destDist / 40) * r;
    g.strokeStyle = '#ff3fd0'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ra) * rd, cy + Math.sin(ra) * rd); g.stroke();
    g.fillStyle = '#ff3fd0';
    g.beginPath(); g.arc(cx + Math.cos(ra) * rd, cy + Math.sin(ra) * rd, 5, 0, TAU); g.fill();
    g.font = `bold ${h * 0.055}px sans-serif`; g.textAlign = 'right';
    g.fillText(`${s.destName}`, x + w - 6, y + h * 0.07);
    g.fillStyle = '#fff'; g.fillText(`${s.destDist.toFixed(1)} KM`, x + w - 6, y + h * 0.14);
    g.fillText(`BRG ${String(Math.round(s.destBrg)).padStart(3, '0')}`, x + w - 6, y + h * 0.21);
  }
  g.fillStyle = '#ffd400';
  g.beginPath(); g.moveTo(cx, cy - 10); g.lineTo(cx - 8, cy + 10); g.lineTo(cx + 8, cy + 10); g.closePath(); g.fill();
  g.fillStyle = '#2f2'; g.textAlign = 'left'; g.font = `${h * 0.05}px sans-serif`;
  g.fillText(`GS ${Math.round(s.gs)}`, x + 6, y + h * 0.07);
  g.fillText(`HDG ${String(Math.round(s.hdg)).padStart(3, '0')}`, x + 6, y + h * 0.14);
  g.fillStyle = '#0cf'; g.fillText(`VIENTO ${Math.round(s.windDir)}°/${Math.round(s.windKt)}`, x + 6, y + h * 0.95);
  g.restore();
}

export function eicas(g, x, y, w, h, s, engines = 2) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#000'; g.fillRect(x, y, w, h);
  const r = Math.min(w / (engines * 2.6), h * 0.17);
  for (let e = 0; e < engines; e++) {
    const cx = x + w * (e + 0.5) / engines, cy = y + h * 0.22;
    for (const [val, yy, lab] of [[s.rpm * 100, cy, 'N1'], [500 + s.rpm * 400 + (s.ab ? 150 : 0), cy + r * 2.4, 'EGT']]) {
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, yy, r, Math.PI, Math.PI * 2.2); g.stroke();
      const max = lab === 'N1' ? 110 : 1100;
      const a = Math.PI + (val / max) * Math.PI * 1.2;
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath(); g.moveTo(cx, yy); g.arc(cx, yy, r, Math.PI, a); g.closePath(); g.fill();
      g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(cx, yy); g.lineTo(cx + Math.cos(a) * r, yy + Math.sin(a) * r); g.stroke();
      g.fillStyle = '#fff'; g.font = `bold ${r * 0.45}px monospace`; g.textAlign = 'center';
      g.fillText(lab === 'N1' ? val.toFixed(1) : Math.round(val), cx + r * 0.3, yy - r * 0.35);
      g.fillStyle = '#0cf'; g.font = `${r * 0.35}px sans-serif`; g.fillText(lab, cx, yy + r * 0.45);
    }
  }
  g.fillStyle = '#fff'; g.font = `${h * 0.05}px sans-serif`; g.textAlign = 'left';
  g.fillText(`FUEL ${Math.round(s.fuel)} KG`, x + 8, y + h * 0.72);
  g.fillText(`FLAPS ${Math.round(s.flaps * 100)}%`, x + 8, y + h * 0.8);
  g.fillText(`THR ${Math.round(s.throttle * 100)}%${s.ab ? ' AB' : ''}`, x + 8, y + h * 0.88);
  // tren
  const gc = s.gear > 0.99 ? '#1f2' : s.gear > 0.01 ? '#fa0' : '#555';
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = gc; g.lineWidth = 2;
    g.strokeRect(x + w * 0.62 + i * w * 0.12, y + h * 0.7, w * 0.1, h * 0.1);
    g.fillStyle = gc; g.font = `bold ${h * 0.04}px sans-serif`; g.textAlign = 'center';
    g.fillText(s.gear > 0.99 ? 'DN' : s.gear > 0.01 ? '--' : 'UP', x + w * 0.67 + i * w * 0.12, y + h * 0.765);
  }
  if (s.brakes) { g.fillStyle = '#fa0'; g.fillText('PARK BRK', x + w * 0.78, y + h * 0.9); }
  g.restore();
}

export function mapDisplay(g, x, y, w, h, s, mapCanvas) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#000'; g.fillRect(x, y, w, h);
  if (mapCanvas) g.drawImage(mapCanvas, x, y, w, h);
  g.strokeStyle = '#2f2'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = '#2f2'; g.font = `${h * 0.06}px monospace`; g.textAlign = 'left';
  g.fillText('MAP', x + 6, y + h * 0.08);
  g.restore();
}

export function mfdFrame(g, x, y, w, h, labels = ['TGT', 'HSI', 'SMS', 'FCR', 'DTE']) {
  g.fillStyle = '#26282a'; g.fillRect(x - 14, y - 14, w + 28, h + 28);
  g.fillStyle = '#3a3c3f';
  for (let i = 0; i < 5; i++) {
    const bx = x + (i + 0.5) * w / 5 - 9;
    g.fillRect(bx, y - 12, 18, 9); g.fillRect(bx, y + h + 3, 18, 9);
    const by = y + (i + 0.5) * h / 5 - 5;
    g.fillRect(x - 12, by, 9, 18); g.fillRect(x + w + 3, by, 9, 18);
  }
  g.fillStyle = '#2f2'; g.font = '10px monospace'; g.textAlign = 'center';
  labels.forEach((l, i) => g.fillText(l, x + (i + 0.5) * w / 5, y + h - 4));
}

export function ufc(g, x, y, w, h, s) {
  g.fillStyle = '#1d1f21'; g.fillRect(x, y, w, h);
  g.fillStyle = '#000'; g.fillRect(x + w * 0.1, y + h * 0.08, w * 0.8, h * 0.2);
  g.fillStyle = '#3f3'; g.font = `bold ${h * 0.13}px monospace`; g.textAlign = 'center';
  g.fillText(`${String(Math.round(s.hdg)).padStart(3, '0')}  ${Math.round(s.alt)}`, x + w / 2, y + h * 0.23);
  g.fillStyle = '#444';
  for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) {
    g.fillRect(x + w * (0.22 + i * 0.2), y + h * (0.36 + j * 0.15), w * 0.14, h * 0.11);
  }
  g.fillStyle = '#ddd'; g.font = `${h * 0.08}px sans-serif`;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) g.fillText(String((j * 3 + i + 1) % 10), x + w * (0.29 + i * 0.2), y + h * (0.44 + j * 0.15));
}

export function warnPanel(g, x, y, w, h, s) {
  g.fillStyle = '#141516'; g.fillRect(x, y, w, h);
  const items = [['MASTER CAUTION', s.stall || s.lowFuel, '#fa0'], ['STALL', s.stall, '#f22'], ['GEAR', !s.gearDown && s.alt < 1000 && s.ias < s.vsKt * 1.5, '#f22'],
    ['FUEL', s.lowFuel, '#fa0'], ['AB', s.ab, '#3cf'], ['BRAKE', s.brakes, '#fa0']];
  items.forEach(([t, on, col], i) => {
    const bx = x + (i % 2) * w / 2 + 3, by = y + Math.floor(i / 2) * h / 3 + 3;
    g.fillStyle = on ? col : '#2a2a2a'; g.fillRect(bx, by, w / 2 - 6, h / 3 - 6);
    g.fillStyle = on ? '#000' : '#555'; g.font = `bold ${h * 0.09}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, bx + (w / 2 - 6) / 2, by + (h / 3 - 6) / 2);
  });
}

// HUD de caza (verde, fondo transparente)
export function fighterHUD(g, W, H, s) {
  g.clearRect(0, 0, W, H);
  const col = 'rgba(80,255,120,1)';
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3;
  g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const cx = W / 2, cy = H * 0.5, ppd = H / 30;
  // escalera de cabeceo
  g.save(); g.beginPath(); g.rect(W * 0.12, H * 0.12, W * 0.76, H * 0.76); g.clip();
  g.translate(cx, cy); g.rotate(-s.roll * Math.PI / 180);
  for (let p = -90; p <= 90; p += 5) {
    const yy = (s.pitch - p) * ppd;
    if (Math.abs(yy) > H * 0.6) continue;
    const w = p === 0 ? W * 0.7 : W * 0.25;
    g.setLineDash(p < 0 ? [8, 6] : []);
    g.beginPath(); g.moveTo(-w / 2, yy); g.lineTo(-W * 0.07, yy); g.moveTo(W * 0.07, yy); g.lineTo(w / 2, yy); g.stroke();
    if (p !== 0) {
      g.beginPath(); g.moveTo(-w / 2, yy); g.lineTo(-w / 2, yy + (p > 0 ? 8 : -8)); g.moveTo(w / 2, yy); g.lineTo(w / 2, yy + (p > 0 ? 8 : -8)); g.stroke();
      g.fillText(Math.abs(p), -w / 2 - 22, yy); g.fillText(Math.abs(p), w / 2 + 22, yy);
    }
  }
  g.setLineDash([]);
  g.restore();
  // marcador de trayectoria (FPM)
  const fx = cx + s.beta * ppd, fy = cy + s.aoa * ppd;
  g.beginPath(); g.arc(fx, fy, 9, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(fx - 22, fy); g.lineTo(fx - 9, fy); g.moveTo(fx + 9, fy); g.lineTo(fx + 22, fy); g.moveTo(fx, fy - 9); g.lineTo(fx, fy - 18); g.stroke();
  // cruz de mira
  g.beginPath(); g.moveTo(cx - 10, cy - H * 0.2); g.lineTo(cx + 10, cy - H * 0.2); g.moveTo(cx, cy - H * 0.2 - 10); g.lineTo(cx, cy - H * 0.2 + 10); g.stroke();
  // velocidad y altitud
  g.strokeRect(W * 0.05, cy - 16, 90, 32); g.fillText(Math.round(s.ias), W * 0.05 + 45, cy);
  g.strokeRect(W * 0.95 - 100, cy - 16, 100, 32); g.fillText(Math.round(s.alt), W * 0.95 - 50, cy);
  g.font = 'bold 16px monospace';
  g.fillText(`M ${s.mach.toFixed(2)}`, W * 0.05 + 45, cy + 40);
  g.fillText(`G ${s.g.toFixed(1)}`, W * 0.05 + 45, cy - 40);
  g.fillText(`α ${s.aoa.toFixed(1)}`, W * 0.05 + 45, cy + 64);
  g.fillText(`${s.vs > 0 ? '+' : ''}${Math.round(s.vs)}`, W * 0.95 - 50, cy + 40);
  // cinta de rumbo
  for (let a = Math.floor((s.hdg - 20) / 5) * 5; a <= s.hdg + 20; a += 5) {
    const xx = cx + (a - s.hdg) * (W * 0.5 / 40);
    g.beginPath(); g.moveTo(xx, H * 0.06); g.lineTo(xx, H * 0.06 + (a % 10 === 0 ? 12 : 6)); g.stroke();
    if (a % 10 === 0) g.fillText(String(((a % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), xx, H * 0.06 + 26);
  }
  g.beginPath(); g.moveTo(cx, H * 0.06 - 2); g.lineTo(cx - 6, H * 0.06 - 12); g.lineTo(cx + 6, H * 0.06 - 12); g.closePath(); g.fill();
  // destino
  if (s.destBrg != null) {
    const rel = ((s.destBrg - s.hdg + 540) % 360) - 180;
    const xx = cx + Math.max(-1, Math.min(1, rel / 20)) * W * 0.25;
    g.fillRect(xx - 4, H * 0.06 + 34, 8, 8);
    g.fillText(`${s.destDist.toFixed(1)} KM`, W * 0.95 - 50, H * 0.88);
  }
  g.fillText(`${s.heli ? 'COL' : 'THR'} ${Math.round(s.throttle * 100)}${s.ab ? ' AB' : ''}`, W * 0.05 + 45, H * 0.88);
  if (s.armed) {
    g.fillText(`GUN ${s.ammo}`, cx - W * 0.16, H * 0.94);
    g.fillText(`RKT ${s.rockets}`, cx + W * 0.16, H * 0.94);
    g.fillRect(cx - W * 0.1, H * 0.975, W * 0.2 * s.hp, 4);
  }
  if (s.gearDown) g.fillText('GEAR', cx, H * 0.82);
  if (s.stall) { g.font = 'bold 26px monospace'; g.fillText('STALL', cx, H * 0.7); }
}
