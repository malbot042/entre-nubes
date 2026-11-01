// Utilidades: RNG con semilla, ruido simplex 2D, helpers matemáticos.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash entero determinista -> [0,1)
export function hash2(x, z, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export class Noise2D {
  constructor(seed) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(xin, yin) {
    const p = this.perm;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[p[ii + p[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[p[ii + i1 + p[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[p[ii + 1 + p[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  }

  fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += a * this.noise(x * f, y * f);
      norm += a; a *= gain; f *= lac;
    }
    return s / norm;
  }

  ridged(x, y, oct = 4) {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      const n = 1 - Math.abs(this.noise(x * f, y * f));
      s += a * n * n;
      norm += a; a *= 0.5; f *= 2.1;
    }
    return s / norm;
  }
}

// Nombres aleatorios de aeropuertos
const PRE = ['San', 'Santa', 'Villa', 'Puerto', 'Monte', 'Valle', 'Torre', 'Campo', 'Río', 'Alto', 'Nueva', 'Real de', 'Peña'];
const ROOT = ['Alcor', 'Benal', 'Castrel', 'Dornaz', 'Escala', 'Fuenmar', 'Garrid', 'Horcaj', 'Iruel', 'Jalón', 'Lucen', 'Mirand',
  'Navar', 'Olmed', 'Pradil', 'Quintan', 'Robled', 'Sotill', 'Tarel', 'Ubed', 'Valdem', 'Zarzal', 'Almen', 'Brezal', 'Cieza', 'Doñan'];
const SUF = ['a', 'o', 'illa', 'ejo', 'ares', 'al', 'ena', 'ón', 'uelo', 'ina'];
const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function randomPlaceName(rnd) {
  const r = ROOT[Math.floor(rnd() * ROOT.length)] + SUF[Math.floor(rnd() * SUF.length)];
  return rnd() < 0.55 ? `${PRE[Math.floor(rnd() * PRE.length)]} ${r}` : r;
}
export function randomICAO(rnd) {
  return 'LE' + L[Math.floor(rnd() * 26)] + L[Math.floor(rnd() * 26)];
}

export function fmt(n, d = 0) { return Number(n).toFixed(d); }
