// Libreas: pieles procedurales (camuflaje, líneas de paneles, remaches y
// suciedad), calcomanías dibujadas en canvas, contornos marcados y reflejos
// de entorno (PBR simplificado) para los modelos de aeronaves.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Entorno para reflejos: cielo en degradado con sol, prefiltrado con PMREM
// ---------------------------------------------------------------------------
let envMap = null;
const envMats = new Set();

export function createEnvMap(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col = [], p = geo.attributes.position;
  const top = new THREE.Color(0.18, 0.4, 0.95), hor = new THREE.Color(0.85, 0.9, 1.0), gnd = new THREE.Color(0.22, 0.25, 0.18);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.6)); else c.copy(hor).lerp(gnd, Math.min(1, -y * 4));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  sc.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 10) }));
  sun.position.set(5, 6, -4);
  sc.add(sun);
  envMap = pm.fromScene(sc, 0.02).texture;
  pm.dispose();
  for (const m of envMats) { m.envMap = envMap; m.needsUpdate = true; }
  return envMap;
}

// intensidad de reflejos según la luz del día
export function setEnvIntensity(v) { for (const m of envMats) m.envMapIntensity = v * (m.userData.envK ?? 1); }

function registerEnv(m, k = 1) {
  if (!m.isMeshStandardMaterial) return;
  m.userData.envK = k;
  if (envMap) m.envMap = envMap;
  envMats.add(m);
}

// ---------------------------------------------------------------------------
// Pieles: textura repetible de 6 m de lado
// ---------------------------------------------------------------------------
const SKIN_METERS = 6;
const skinCache = new Map();

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function skinTexture(key, { colors, blobs = 0, blobSize = 0.22, seed = 1, lines = 0.3, rivets = true, grime = 0.1, sheen = 0 }) {
  if (skinCache.has(key)) return skinCache.get(key);
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), r = rng(seed);
  g.fillStyle = colors[0]; g.fillRect(0, 0, S, S);
  // manchas de camuflaje orgánicas y repetibles (se dibujan también desplazadas un periodo)
  for (let i = 0; i < blobs; i++) {
    const cx = r() * S, cy = r() * S, rad = S * blobSize * (0.5 + r()), n = 9 + Math.floor(r() * 5);
    const pts = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; const rr = rad * (0.55 + r() * 0.6); pts.push([Math.cos(a) * rr, Math.sin(a) * rr * (0.5 + r() * 0.4)]); }
    g.fillStyle = colors[1 + (i % (colors.length - 1))];
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.beginPath();
      pts.forEach(([x, y], k) => { const X = cx + ox + x, Y = cy + oy + y; k ? g.lineTo(X, Y) : g.moveTo(X, Y); });
      g.closePath(); g.fill();
    }
  }
  // variación tonal suave (desgaste)
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + r() * 0.03})`;
    const w = 20 + r() * 90, h = 8 + r() * 40;
    g.fillRect(r() * S, r() * S, w, h);
  }
  // líneas de paneles: retícula irregular (cada fila desplazada)
  if (lines > 0) {
    g.strokeStyle = `rgba(0,0,0,${lines})`; g.lineWidth = 1.4;
    const rows = 7;
    for (let j = 0; j <= rows; j++) {
      const y = Math.round(j * S / rows) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
      const cols = 3 + Math.floor(r() * 3), off = r() * S;
      for (let i = 0; i < cols; i++) {
        const x = Math.round((off + i * S / cols) % S) + 0.5;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + S / rows); g.stroke();
      }
      // escotillas pequeñas
      if (r() < 0.6) { g.strokeRect(Math.round(r() * (S - 60)) + 0.5, y + 12.5, 30 + Math.round(r() * 30), 20 + Math.round(r() * 14)); }
    }
    g.strokeStyle = `rgba(255,255,255,${lines * 0.25})`; g.lineWidth = 1;
    for (let j = 0; j <= rows; j++) { const y = Math.round(j * S / rows) + 1.5; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    if (rivets) {
      g.fillStyle = `rgba(0,0,0,${lines * 0.7})`;
      for (let j = 0; j <= rows; j++) {
        const y = Math.round(j * S / rows) + 5;
        for (let x = 3; x < S; x += 9) g.fillRect(x, y, 1.6, 1.6);
      }
    }
  }
  // chorreones de suciedad
  for (let i = 0; i < 40 * grime * 10; i++) {
    const x = r() * S, y = r() * S, h = 30 + r() * 120;
    const gr = g.createLinearGradient(x, y, x, y + h);
    gr.addColorStop(0, `rgba(20,18,15,${0.12 * grime * 4})`); gr.addColorStop(1, 'rgba(20,18,15,0)');
    g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 6, h);
  }
  if (sheen) { g.fillStyle = `rgba(255,255,255,${sheen})`; g.fillRect(0, 0, S, S); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  skinCache.set(key, t);
  return t;
}

// Proyección de UV por caras (mapeo «caja») en el espacio del modelo:
// el camuflaje queda continuo entre fuselaje, alas y derivas.
const _m = new THREE.Matrix4(), _n = new THREE.Matrix3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _fn = new THREE.Vector3();
function projectUV(mesh, rootInv) {
  let geo = mesh.geometry;
  if (geo.index) geo = geo.toNonIndexed(); else geo = geo.clone();
  _m.multiplyMatrices(rootInv, mesh.matrixWorld);
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    _a.fromBufferAttribute(p, i).applyMatrix4(_m); _b.fromBufferAttribute(p, i + 1).applyMatrix4(_m); _c.fromBufferAttribute(p, i + 2).applyMatrix4(_m);
    _fn.crossVectors(_e1.subVectors(_b, _a), _e2.subVectors(_c, _a));
    const ax = Math.abs(_fn.x), ay = Math.abs(_fn.y), az = Math.abs(_fn.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? _a : k === 1 ? _b : _c;
      let u, w;
      if (ax >= ay && ax >= az) { u = v.z; w = v.y; } else if (ay >= az) { u = v.x; w = v.z; } else { u = v.x; w = v.y; }
      uv[(i + k) * 2] = u / SKIN_METERS; uv[(i + k) * 2 + 1] = w / SKIN_METERS;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  mesh.geometry = geo;
}

// ---------------------------------------------------------------------------
// Calcomanías
// ---------------------------------------------------------------------------
const decalCache = new Map();
function canvasTex(key, w, h, draw) {
  if (decalCache.has(key)) return decalCache.get(key);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  decalCache.set(key, t);
  return t;
}
function starPath(g, cx, cy, R, r = R * 0.38) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  g.closePath();
}

export const DECALS = {
  // insignia de EE. UU. (estrella y barras); lowVis = gris táctico
  usInsignia: (lowVis) => canvasTex('ins' + lowVis, 512, 256, (g, W, H) => {
    const blue = lowVis ? '#4a5056' : '#1d2f6e', white = lowVis ? '#7d858c' : '#ffffff', red = lowVis ? '#4a5056' : '#c0182a';
    const cy = H / 2, R = H * 0.42;
    g.fillStyle = blue; g.fillRect(W / 2 - R * 2.15, cy - R * 0.42, R * 4.3, R * 0.84);
    g.fillStyle = white; g.fillRect(W / 2 - R * 2.0, cy - R * 0.3, R * 4.0, R * 0.6);
    g.fillStyle = red; g.fillRect(W / 2 - R * 2.0, cy - R * 0.09, R * 4.0, R * 0.18);
    g.fillStyle = blue; g.beginPath(); g.arc(W / 2, cy, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = white; starPath(g, W / 2, cy, R * 0.95); g.fill();
  }),
  text: (str, color, { font = 'bold 150px "Arial Black", Impact, sans-serif', w = 1024, h = 256, stroke = null } = {}) =>
    canvasTex('t' + str + color + font + stroke, w, h, (g, W, H) => {
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (stroke) { g.lineWidth = 14; g.strokeStyle = stroke; g.strokeText(str, W / 2, H / 2 + 6); }
      g.fillStyle = color; g.fillText(str, W / 2, H / 2 + 6);
    }),
  // calavera y tibias de los «Jolly Rogers»
  jollyRoger: () => canvasTex('jolly', 512, 512, (g, W) => {
    const c = W / 2;
    g.fillStyle = '#f2efe6'; g.strokeStyle = '#f2efe6'; g.lineCap = 'round';
    g.lineWidth = 46;
    for (const s of [1, -1]) { g.beginPath(); g.moveTo(c - 170, c + 50 + s * 120); g.lineTo(c + 170, c + 50 - s * 120); g.stroke(); }
    for (const [x, y] of [[-170, -70], [-170, 170], [170, -70], [170, 170]]) {
      g.beginPath(); g.arc(c + x + Math.sign(x) * 4, c + 50 + y - 20 * Math.sign(y), 30, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(c + x - Math.sign(x) * 10, c + 50 + y + 22 * Math.sign(y), 30, 0, Math.PI * 2); g.fill();
    }
    g.beginPath(); g.ellipse(c, c - 40, 120, 130, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(c - 70, c + 40, 140, 80);
    g.fillStyle = '#111';
    g.beginPath(); g.ellipse(c - 48, c - 40, 34, 40, 0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(c + 48, c - 40, 34, 40, -0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(c, c + 10); g.lineTo(c - 18, c + 45); g.lineTo(c + 18, c + 45); g.closePath(); g.fill();
    for (let i = -2; i <= 2; i++) g.fillRect(c + i * 26 - 3, c + 70, 6, 50);
  }),
  // boca de tiburón del A-10 «Flying Tigers»
  sharkMouth: () => canvasTex('shark', 1024, 384, (g, W, H) => {
    g.fillStyle = '#b3201e';
    g.beginPath(); g.moveTo(W * 0.02, H * 0.5); g.quadraticCurveTo(W * 0.45, H * 0.05, W * 0.92, H * 0.18);
    g.quadraticCurveTo(W * 0.6, H * 0.5, W * 0.92, H * 0.86); g.quadraticCurveTo(W * 0.45, H * 0.98, W * 0.02, H * 0.5); g.fill();
    g.fillStyle = '#f4f1e8';
    for (let i = 0; i < 9; i++) {
      const t = i / 9, x = W * (0.08 + t * 0.75);
      const yu = H * (0.42 - Math.sin(t * Math.PI * 0.85) * 0.22), yl = H * (0.58 + Math.sin(t * Math.PI * 0.85) * 0.24);
      g.beginPath(); g.moveTo(x, yu - 4); g.lineTo(x + W * 0.04, yu - 4); g.lineTo(x + W * 0.02, yu + H * 0.14); g.fill();
      g.beginPath(); g.moveTo(x, yl + 4); g.lineTo(x + W * 0.04, yl + 4); g.lineTo(x + W * 0.02, yl - H * 0.14); g.fill();
    }
    g.lineWidth = 10; g.strokeStyle = '#111'; g.beginPath(); g.moveTo(W * 0.02, H * 0.5); g.quadraticCurveTo(W * 0.45, H * 0.05, W * 0.92, H * 0.18); g.stroke();
    g.beginPath(); g.moveTo(W * 0.02, H * 0.5); g.quadraticCurveTo(W * 0.45, H * 0.98, W * 0.92, H * 0.86); g.stroke();
  }),
  sharkEye: () => canvasTex('eye', 256, 256, (g) => {
    g.fillStyle = '#f4f1e8'; g.beginPath(); g.ellipse(128, 128, 110, 70, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(150, 128, 48, 0, Math.PI * 2); g.fill();
    g.lineWidth = 12; g.strokeStyle = '#111'; g.beginPath(); g.ellipse(128, 128, 110, 70, 0, 0, Math.PI * 2); g.stroke();
  }),
  // banda de cuadros para cola
  checker: (c1, c2, cols = 12, rows = 2) => canvasTex('chk' + c1 + c2 + cols + rows, 1024, Math.round(1024 / cols * rows), (g, W, H) => {
    const s = W / cols;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { g.fillStyle = (i + j) % 2 ? c1 : c2; g.fillRect(i * s, j * s, s, s); }
  }),
  // franja de color con borde
  stripe: (color, edge) => canvasTex('str' + color + edge, 512, 64, (g, W, H) => {
    g.fillStyle = edge || color; g.fillRect(0, 0, W, H);
    g.fillStyle = color; g.fillRect(0, H * 0.18, W, H * 0.64);
  }),
  // marca de advertencia (triángulo de rescate del asiento eyectable)
  rescue: () => canvasTex('rescue', 256, 256, (g) => {
    g.fillStyle = '#e8401c'; g.beginPath(); g.moveTo(128, 20); g.lineTo(236, 220); g.lineTo(20, 220); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.font = 'bold 50px sans-serif'; g.textAlign = 'center'; g.fillText('!', 128, 190);
  }),
};

const decalMats = new Map();
function decalMat(tex) {
  let m = decalMats.get(tex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, depthWrite: false, roughness: 0.55, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    registerEnv(m, 0.6);
    decalMats.set(tex, m);
  }
  return m;
}

// Calcomanía plana: pos/rot en el espacio del grupo padre. mirror: copia en el lado −X.
// facing: 'side' (mira a +X), 'up' (encima de ala), 'down' (intradós), 'front'.
export function addDecal(parent, tex, w, h, pos, facing = 'side', { mirror = false, rotZ = 0, flipText = true } = {}) {
  const make = (sx) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMat(tex));
    m.position.set(pos[0] * sx, pos[1], pos[2]);
    if (facing === 'side') m.rotation.set(0, sx * Math.PI / 2, 0);
    else if (facing === 'up') { m.rotation.set(-Math.PI / 2, 0, rotZ); }
    else if (facing === 'down') { m.rotation.set(Math.PI / 2, 0, rotZ); }
    if (facing === 'side' && sx < 0 && !flipText) m.scale.x = -1;
    m.userData.decal = true; m.userData.noEdge = true;
    m.renderOrder = 2;
    parent.add(m);
    return m;
  };
  const out = [make(1)];
  if (mirror) out.push(make(-1));
  return out;
}

// ---------------------------------------------------------------------------
// Aplicación al modelo: pieles por color de material, reflejos y contornos
// ---------------------------------------------------------------------------
const edgeMat = new THREE.LineBasicMaterial({ color: 0x07090c, transparent: true, opacity: 0.55 });
const edgeCache = new WeakMap();
export const edgeLines = new Set();

export function applyLivery(group, livery, { edges = true } = {}) {
  group.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const skinned = new Map();
  const skinFor = (m) => {
    const hex = m.color?.getHex();
    const def = livery?.skins?.[hex];
    if (!def) return null;
    if (!skinned.has(m)) {
      const tex = skinTexture(livery.id + ':' + hex, def);
      const nm = new THREE.MeshStandardMaterial({
        map: tex, color: 0xffffff, roughness: def.rough ?? 0.55, metalness: def.metal ?? 0.3,
        flatShading: true, side: THREE.DoubleSide,
      });
      registerEnv(nm, def.env ?? 1);
      skinned.set(m, nm);
    }
    return skinned.get(m);
  };
  const meshes = [];
  group.traverse(o => { if (o.isMesh && !o.userData.decal) meshes.push(o); });
  for (const o of meshes) {
    const m = o.material;
    if (!m || Array.isArray(m)) continue;
    const sk = m.isMeshStandardMaterial ? skinFor(m) : null;
    if (sk) { projectUV(o, rootInv); o.material = sk; }
    else registerEnv(m, m.metalness > 0.5 ? 1.2 : 0.7);
    // contornos marcados en las aristas vivas
    if (edges && !m.transparent && !o.userData.noEdge && o.geometry.attributes.position.count < 6000) {
      let eg = edgeCache.get(o.geometry);
      if (!eg) { eg = new THREE.EdgesGeometry(o.geometry, 28); edgeCache.set(o.geometry, eg); }
      const l = new THREE.LineSegments(eg, edgeMat);
      l.raycast = () => { };
      o.add(l);
      edgeLines.add(l);
    }
  }
}

export function setEdgesVisible(v) { for (const l of edgeLines) l.visible = v; }
export function forgetEdges(group) { group.traverse(o => { if (o.isLineSegments) edgeLines.delete(o); }); }

// ---------------------------------------------------------------------------
// Libreas por aeronave: colores de material que se sustituyen por piel
// ---------------------------------------------------------------------------
export const LIVERIES = {
  f14: {
    id: 'f14', skins: {
      0xa9b2ba: { colors: ['#b4bcc3', '#a5aeb6', '#c1c8ce'], blobs: 6, blobSize: 0.3, seed: 14, lines: 0.32, metal: 0.35 },
      0x838c94: { colors: ['#8d969d'], lines: 0.25, seed: 15 },
      0x16171a: { colors: ['#17181b', '#202125'], blobs: 4, seed: 16, lines: 0.35, rough: 0.45 },
    },
  },
  f16: {
    id: 'f16', skins: {
      0x8f989f: { colors: ['#8e979e', '#737c84', '#a1a9af'], blobs: 10, blobSize: 0.26, seed: 21, lines: 0.3, metal: 0.3 },
      0x6e767d: { colors: ['#6f777e'], lines: 0.25, seed: 22 },
    },
  },
  f18: {
    id: 'f18', skins: {
      0x0f2c6e: { colors: ['#132f72', '#10295f'], blobs: 0, seed: 31, lines: 0.28, metal: 0.4, rough: 0.35, env: 1.3 },
      0xf2c315: { colors: ['#f2c417', '#e8b80f'], blobs: 2, seed: 32, lines: 0.22, metal: 0.25, rough: 0.4 },
    },
  },
  a10: {
    id: 'a10', skins: {
      0x46533b: { colors: ['#3b4a33', '#2b3427', '#4a4d4f'], blobs: 18, blobSize: 0.2, seed: 41, lines: 0.32, metal: 0.08, rough: 0.75, grime: 0.18 },
      0x363c33: { colors: ['#30362e', '#3d4637'], blobs: 6, seed: 42, lines: 0.3, metal: 0.08, rough: 0.8 },
    },
  },
  apache: {
    id: 'apache', skins: {
      0x3c4433: { colors: ['#3a4231', '#353d2d', '#414a37'], blobs: 8, blobSize: 0.25, seed: 51, lines: 0.32, metal: 0.05, rough: 0.85, grime: 0.2 },
    },
  },
  lhx: {
    id: 'lhx', skins: {
      0x3b3f44: { colors: ['#3d4146', '#34383d', '#45494e'], blobs: 6, blobSize: 0.3, seed: 61, lines: 0.26, metal: 0.25, rough: 0.6 },
    },
  },
};
