// Mundo procedural infinito: terreno por chunks con LOD, biomas, lagos,
// ciudades, pueblos, granjas, bosques, aerogeneradores y aeropuertos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2D, mulberry32, hash2, clamp, lerp, smoothstep, randomPlaceName, randomICAO } from './util.js?v=4';
import { buildModel } from './models.js?v=4';

export const CHUNK = 1000;
const CITY_CELL = 6000;
const VILLAGE_CELL = 1700;
const FARM_CELL = 4500;
const BLOCK = 100;
const PHYS_RES = 24;

export const sharedUniforms = { uNight: { value: 0 }, uTime: { value: 0 } };

const GLSL_HASH = `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),f.x), mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),f.x), f.y); }
`;

function makeTerrainMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = sharedUniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aField; attribute float aCity;
varying float vField; varying float vCity; varying vec3 vWPos;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vField = aField; vCity = aCity; vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight; varying float vField; varying float vCity; varying vec3 vWPos;
${GLSL_HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vWPos.xz;
  float gr = vnoise(p*0.07)*0.5 + vnoise(p*0.5)*0.5;
  diffuseColor.rgb *= 0.88 + 0.22*gr;
  if (vField > 0.01) {
    float s = 190.0;
    float row = floor(p.y / s);
    vec2 q = vec2(p.x + h21(vec2(row, 7.0))*s, p.y);
    vec2 cell = floor(q / s);
    float h = h21(cell);
    vec3 fc = h<0.18 ? vec3(0.66,0.6,0.27) : h<0.38 ? vec3(0.33,0.5,0.15) : h<0.52 ? vec3(0.48,0.36,0.22)
            : h<0.72 ? vec3(0.52,0.6,0.2) : h<0.86 ? vec3(0.76,0.68,0.33) : vec3(0.26,0.4,0.14);
    vec2 f = fract(q/s);
    float stripes = 0.9 + 0.1*sin(((h>0.5)?q.x:q.y)*1.3);
    float edge = smoothstep(0.0,0.03,f.x)*smoothstep(0.0,0.03,f.y)*smoothstep(1.0,0.97,f.x)*smoothstep(1.0,0.97,f.y);
    fc = mix(vec3(0.16,0.27,0.09), fc*stripes, edge);
    diffuseColor.rgb = mix(diffuseColor.rgb, fc*(0.9+0.15*gr), vField);
  }
  if (vCity < 0.5 && vWPos.y > 1.2) {
    float e = 2.0;
    float n0 = vnoise(p*0.00035) + 0.5*vnoise(p*0.0011);
    float nx = vnoise((p+vec2(e,0.0))*0.00035) + 0.5*vnoise((p+vec2(e,0.0))*0.0011);
    float nz = vnoise((p+vec2(0.0,e))*0.00035) + 0.5*vnoise((p+vec2(0.0,e))*0.0011);
    float g = length(vec2(nx-n0, nz-n0))/e;
    float d = abs(n0 - 0.75)/max(g,1e-7);
    float road = (1.0 - smoothstep(3.0, 4.5, d)) * (1.0 - vCity*2.0);
    float line = (1.0 - smoothstep(0.15, 0.3, d)) * step(0.5, fract(dot(p, vec2(0.05))));
    vec3 rc = mix(vec3(0.21,0.21,0.22), vec3(0.85,0.8,0.5), line*0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, rc, road);
  }
  if (vCity > 0.01) {
    vec2 f = mod(p, 100.0);
    float road = 1.0 - step(10.0, f.x)*step(10.0, f.y);
    float side = (1.0 - step(12.0, f.x)*step(12.0, f.y)) - road;
    float dash = step(4.6, f.x)*step(f.x,5.4)*step(0.5, fract(p.y*0.1)) + step(4.6, f.y)*step(f.y,5.4)*step(0.5, fract(p.x*0.1));
    vec3 cc = vec3(0.45,0.44,0.41) * (0.8+0.4*h21(floor(p/100.0)));
    cc = mix(cc, vec3(0.62,0.6,0.57), side);
    cc = mix(cc, vec3(0.16,0.16,0.17), road);
    cc = mix(cc, vec3(0.8,0.8,0.75), clamp(dash,0.0,1.0)*road);
    diffuseColor.rgb = mix(diffuseColor.rgb, cc*(0.9+0.15*gr), smoothstep(0.3,0.7,vCity));
    totalEmissiveRadiance += vec3(1.0,0.6,0.25) * road * uNight * 0.12 * smoothstep(0.3,0.7,vCity);
  }
}
`);
  };
  return m;
}

function makeBuildingMaterial() {
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = sharedUniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWN;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vec4 wp4 = vec4(transformed,1.0);
vec3 nn = objectNormal;
#ifdef USE_INSTANCING
  wp4 = instanceMatrix * wp4;
  nn = mat3(instanceMatrix) * nn;
#endif
wp4 = modelMatrix * wp4; vWPos = wp4.xyz; vWN = normalize(mat3(modelMatrix) * nn);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight; varying vec3 vWPos; varying vec3 vWN;
${GLSL_HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float vert = 1.0 - step(0.5, abs(vWN.y));
  vec2 uv = abs(vWN.x) > 0.5 ? vWPos.zy : vWPos.xy;
  vec2 cell = vec2(uv.x/3.2, uv.y/3.4);
  vec2 f = fract(cell);
  float win = step(0.22,f.x)*step(f.x,0.78)*step(0.3,f.y)*step(f.y,0.82) * vert;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*0.35 + vec3(0.06,0.09,0.13), win*0.85);
  float lit = step(0.5, h21(floor(cell) + floor(vWPos.xz*0.013)*3.1));
  totalEmissiveRadiance += vec3(1.0,0.78,0.42) * win * lit * uNight * 0.95;
}
`);
  };
  return m;
}

function waterNormalTexture() {
  const S = 256, n = new Noise2D(99);
  const data = new Uint8Array(S * S * 4);
  const h = (x, y) => n.fbm(x / 22, y / 22, 3, 2, 0.5) + 0.3 * n.noise(x / 6, y / 6);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // ruido periódico aproximado mezclando bordes
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const nx = -dx * 3, ny = -dy * 3, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * S + x) * 4;
    data[i] = (nx / l * 0.5 + 0.5) * 255; data[i + 1] = (ny / l * 0.5 + 0.5) * 255; data[i + 2] = (nz / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function colorize(geo, color) {
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

function prism(w, h, d) {
  // tejado a dos aguas: base w x d a y=0, cumbrera a altura h
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

function buildPropGeometries() {
  const G = {};
  // Árboles
  G.conifer = mergeGeometries([
    colorize(new THREE.CylinderGeometry(0.35, 0.5, 3, 5).translate(0, 1.5, 0), 0x4a3320),
    colorize(new THREE.ConeGeometry(3.2, 7, 6).translate(0, 5.5, 0), 0x1f4a24),
    colorize(new THREE.ConeGeometry(2.4, 5, 6).translate(0, 8.5, 0), 0x245428),
  ]);
  G.broad = mergeGeometries([
    colorize(new THREE.CylinderGeometry(0.4, 0.6, 4, 5).translate(0, 2, 0), 0x553a22),
    colorize(new THREE.IcosahedronGeometry(3.6, 0).scale(1, 0.85, 1).translate(0, 6.5, 0), 0x3b6b26),
    colorize(new THREE.IcosahedronGeometry(2.4, 0).translate(1.6, 7.8, 0.8), 0x447a2c),
  ]);
  G.box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  G.roof = colorize(prism(1, 1, 1), 0xffffff);
  // Granja: casa + establo rojo + silo
  G.farm = mergeGeometries([
    colorize(new THREE.BoxGeometry(10, 6, 8).translate(0, 3, 0), 0xe8dcc0),
    colorize(prism(11, 3.5, 9).translate(0, 6, 0), 0x8a3a22),
    colorize(new THREE.BoxGeometry(14, 8, 22).translate(20, 4, 6), 0x9a2a1e),
    colorize(prism(15, 5, 23).translate(20, 8, 6), 0x555555),
    colorize(new THREE.CylinderGeometry(3, 3, 16, 8).translate(32, 8, -6), 0xbcbcbc),
    colorize(new THREE.SphereGeometry(3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(32, 16, -6), 0x8a8a8a),
  ]);
  // Iglesia de pueblo
  G.church = mergeGeometries([
    colorize(new THREE.BoxGeometry(10, 9, 24).translate(0, 4.5, 0), 0xd9cbb0),
    colorize(prism(11, 5, 25).translate(0, 9, 0), 0x9b4a2c),
    colorize(new THREE.BoxGeometry(5, 22, 5).translate(0, 11, -14), 0xd2c3a6),
    colorize(new THREE.ConeGeometry(4, 8, 4).rotateY(Math.PI / 4).translate(0, 26, -14), 0x6b3a26),
  ]);
  // Aerogenerador (torre + góndola); el rotor va aparte
  G.turbine = mergeGeometries([
    colorize(new THREE.CylinderGeometry(1.2, 2.4, 80, 8).translate(0, 40, 0), 0xf2f2f2),
    colorize(new THREE.BoxGeometry(3, 3, 9).translate(0, 81, 1.5), 0xe8e8e8),
  ]);
  const blade = () => new THREE.BoxGeometry(1.6, 34, 0.4).translate(0, 18, 0);
  G.rotor = mergeGeometries([
    colorize(blade(), 0xf8f8f8),
    colorize(blade().rotateZ((Math.PI * 2) / 3), 0xf8f8f8),
    colorize(blade().rotateZ((Math.PI * 4) / 3), 0xf8f8f8),
    colorize(new THREE.SphereGeometry(1.6, 8, 6), 0xdddddd),
  ]);
  // Torre de agua
  G.watertower = mergeGeometries([
    colorize(new THREE.CylinderGeometry(1.2, 1.6, 25, 6).translate(0, 12.5, 0), 0xaaaaaa),
    colorize(new THREE.CylinderGeometry(7, 5, 8, 10).translate(0, 29, 0), 0xc9d6dd),
  ]);
  // Chimenea industrial
  G.chimney = mergeGeometries([
    colorize(new THREE.CylinderGeometry(2.5, 4, 70, 10).translate(0, 35, 0), 0x9a8f86),
    colorize(new THREE.CylinderGeometry(2.6, 2.6, 4, 10).translate(0, 62, 0), 0xb33a2a),
    colorize(new THREE.CylinderGeometry(2.6, 2.6, 4, 10).translate(0, 52, 0), 0xeeeeee),
  ]);
  return G;
}

const FACADES = [0xe9dfcc, 0xd8c7a8, 0xf2efe8, 0xc9b79c, 0xb9a48a, 0xe3d4c4, 0xcfc6bd, 0xa89c94, 0xdcb9a0];
const TOWERS = [0x8fa6b8, 0x6f8799, 0xa9b6bf, 0x7b8f8a, 0xc0c4c8, 0x5d6f80, 0x9aa7a0];
const ROOFS = [0x9b3d26, 0xa4532f, 0x7a3020, 0x5a4a44, 0x8b5a3c, 0x6a6a6a];

export class World {
  constructor(seed, scene, quality = 'medium') {
    this.seed = seed;
    this.scene = scene;
    this.nBase = new Noise2D(seed + 1);
    this.nDet = new Noise2D(seed + 2);
    this.nRidge = new Noise2D(seed + 3);
    this.nLake = new Noise2D(seed + 4);
    this.nBiome = new Noise2D(seed + 5);
    this.nForest = new Noise2D(seed + 6);
    this.airports = [];
    this.forcedCities = [];
    this.cityCache = new Map();
    this.chunks = new Map();
    this.objChunks = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.setQuality(quality);

    this.terrainMat = makeTerrainMaterial();
    this.buildingMat = makeBuildingMaterial();
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.lightMat = new THREE.PointsMaterial({ color: 0xffc070, size: 2.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
    this.redLightMat = new THREE.PointsMaterial({ color: 0xff2a1a, size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
    this.G = buildPropGeometries();
    this.rotors = new Set();

    // Agua
    this.waterTex = waterNormalTexture();
    this.waterTex.repeat.set(1200, 1200);
    this.waterMat = new THREE.MeshPhongMaterial({ color: 0x1d4f6b, specular: 0x9fb8c8, shininess: 90, normalMap: this.waterTex, normalScale: new THREE.Vector2(0.35, 0.35) });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000).rotateX(-Math.PI / 2), this.waterMat);
    this.water.receiveShadow = true;
    scene.add(this.water);
    this.airportGroups = [];
  }

  setQuality(q) {
    this.quality = q;
    this.viewRadius = { low: 5, medium: 8, high: 11 }[q] || 8;
    this.objRadius = { low: 1.6, medium: 2.6, high: 3.6 }[q] || 2.6;
    this.treeSpacing = { low: 30, medium: 22, high: 17 }[q] || 22;
  }

  // ---------- Funciones de altura ----------
  baseHeight(x, z) {
    const c = this.nBase.fbm(x / 11000, z / 11000, 3);
    let h = 55 + c * 80;
    const mMask = smoothstep(0.08, 0.55, c + 0.35 * this.nDet.noise(x / 23000 + 11, z / 23000 - 7));
    if (mMask > 0) {
      const r = this.nRidge.ridged(x / 4200, z / 4200, 4);
      h += r * r * 1400 * mMask;
    }
    h += this.nDet.fbm(x / 1100, z / 1100, 3) * 32 * (0.4 + mMask);
    h += this.nDet.noise(x / 170, z / 170) * 2.5;
    const l = this.nLake.fbm(x / 3000, z / 3000, 2);
    if (l > 0.5) h -= (l - 0.5) * 700 * (1 - mMask);
    return h;
  }

  cityForCell(cx, cz) {
    const key = cx * 100003 + cz;
    let city = this.cityCache.get(key);
    if (city !== undefined) return city;
    city = null;
    if (hash2(cx, cz, this.seed + 77) < 0.42) {
      const x = (cx + 0.25 + 0.5 * hash2(cx, cz, this.seed + 78)) * CITY_CELL;
      const z = (cz + 0.25 + 0.5 * hash2(cx, cz, this.seed + 79)) * CITY_CELL;
      const h = this.baseHeight(x, z);
      if (h > 4 && h < 380 && !this.nearAirport(x, z, 1500)) {
        const size = hash2(cx, cz, this.seed + 80);
        city = { x, z, r: 450 + size * size * 1400, h: Math.max(h, 8), big: size };
      }
    }
    this.cityCache.set(key, city);
    return city;
  }

  // Ciudad con mayor influencia en (x,z): {city, flat, dens}
  cityAt(x, z) {
    const cx = Math.floor(x / CITY_CELL), cz = Math.floor(z / CITY_CELL);
    let best = null, bestFlat = 0;
    const test = (c) => {
      const dx = x - c.x, dz = z - c.z;
      const d2 = dx * dx + dz * dz, lim = c.r * 1.5;
      if (d2 > lim * lim) return;
      const flat = 1 - smoothstep(c.r * 0.8, c.r * 1.5, Math.sqrt(d2));
      if (flat > bestFlat) { bestFlat = flat; best = c; }
    };
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = this.cityForCell(cx + i, cz + j);
      if (c) test(c);
    }
    for (const c of this.forcedCities) test(c);
    return best ? { city: best, flat: bestFlat } : null;
  }

  cityDensity(x, z, ci) {
    if (!ci) return 0;
    const c = ci.city;
    const d = Math.hypot(x - c.x, z - c.z) / c.r + 0.22 * this.nBiome.noise(x / 380, z / 380);
    return 1 - smoothstep(0.62, 0.95, d);
  }

  airportLocal(ap, x, z) {
    const dx = x - ap.x, dz = z - ap.z;
    return { u: dx * ap.dir.x + dz * ap.dir.z, v: dx * ap.right.x + dz * ap.right.z };
  }

  airportWeight(ap, x, z, pad = 0) {
    const { u, v } = this.airportLocal(ap, x, z);
    const hu = ap.len / 2 + 450;
    const du = Math.max(Math.abs(u) - hu, 0);
    const dv = Math.max(v < -300 ? -300 - v : v - 600, 0);
    const d = Math.hypot(du, dv);
    return 1 - smoothstep(pad, pad + 900, d);
  }

  nearAirport(x, z, margin) {
    for (const ap of this.airports) {
      const { u, v } = this.airportLocal(ap, x, z);
      if (Math.abs(u) < ap.len / 2 + 450 + margin && v > -300 - margin && v < 600 + margin) return ap;
    }
    return null;
  }

  height(x, z) {
    let h = this.baseHeight(x, z);
    const ci = this.cityAt(x, z);
    if (ci) h = lerp(h, ci.city.h, ci.flat);
    for (const ap of this.airports) {
      const w = this.airportWeight(ap, x, z);
      if (w > 0) h = lerp(h, ap.elev, w);
    }
    return h;
  }

  // Altura que coincide con la malla de alta resolución (para física)
  groundHeight(x, z) {
    const s = CHUNK / PHYS_RES;
    const gx = Math.floor(x / s), gz = Math.floor(z / s);
    const fx = x / s - gx, fz = z / s - gz;
    const x0 = gx * s, z0 = gz * s;
    const a = this.height(x0, z0), b = this.height(x0, z0 + s), c = this.height(x0 + s, z0);
    if (fx + fz <= 1) return a + (c - a) * fx + (b - a) * fz;
    const d = this.height(x0 + s, z0 + s);
    return d + (b - d) * (1 - fx) + (c - d) * (1 - fz);
  }

  surfaceInfo(x, z) {
    // Para el minimapa
    const h = this.height(x, z);
    if (h < 0) return [40, 90, 130];
    const ci = this.cityAt(x, z);
    const cd = this.cityDensity(x, z, ci);
    if (cd > 0.4) return [130, 128, 122];
    if (this.nearAirport(x, z, 0)) return [110, 130, 90];
    if (h > 1150) return [235, 235, 240];
    if (h > 700) return [120, 112, 100];
    const f = this.nForest.fbm(x / 2200, z / 2200, 3);
    if (f > 0.15) return [35, 75, 35];
    const fi = this.nBiome.noise(x / 3500 + 50, z / 3500);
    if (fi > 0.05) return [140, 150, 70];
    return [80, 130, 55];
  }

  // ---------- Aeropuertos ----------
  findAirportSite(x, z, rnd) {
    let best = null, bestScore = Infinity;
    for (let k = 0; k < 40; k++) {
      const px = x + (rnd() - 0.5) * 7000 * (k > 0 ? 1 : 0);
      const pz = z + (rnd() - 0.5) * 7000 * (k > 0 ? 1 : 0);
      const hdg = rnd() * Math.PI * 2;
      const dir = { x: Math.sin(hdg), z: -Math.cos(hdg) };
      let mn = Infinity, mx = -Infinity, sum = 0;
      for (let t = -1; t <= 1; t += 0.25) {
        const h = this.baseHeight(px + dir.x * t * 1500, pz + dir.z * t * 1500);
        mn = Math.min(mn, h); mx = Math.max(mx, h); sum += h;
      }
      const avg = sum / 9;
      let score = (mx - mn) + (avg < 6 ? 400 + (6 - avg) * 20 : 0) + Math.max(0, avg - 250) * 2;
      if (score < bestScore) { bestScore = score; best = { x: px, z: pz, hdg, elev: Math.max(avg, 10) }; }
    }
    return best;
  }

  addAirport(x, z, rnd, isDestination = false) {
    const s = this.findAirportSite(x, z, rnd);
    const hdg = Math.round((s.hdg * 180 / Math.PI) / 10) * 10 * Math.PI / 180;
    const ap = {
      x: s.x, z: s.z, hdg, elev: s.elev, len: 2600, width: 45,
      dir: { x: Math.sin(hdg), z: -Math.cos(hdg) },
      right: { x: Math.cos(hdg), z: Math.sin(hdg) },
      name: randomPlaceName(rnd), icao: randomICAO(rnd), isDestination,
    };
    // Ciudad junto al aeropuerto
    const side = rnd() < 0.5 ? -1 : 1;
    const off = 3200 + rnd() * 1500;
    const cx = ap.x + ap.right.x * off * side + ap.dir.x * (rnd() - 0.5) * 2000;
    const cz = ap.z + ap.right.z * off * side + ap.dir.z * (rnd() - 0.5) * 2000;
    this.airports.push(ap);
    const ch = this.baseHeight(cx, cz);
    this.forcedCities.push({ x: cx, z: cz, r: 900 + rnd() * 900, h: Math.max(ch, ap.elev, 8), big: 0.6 + rnd() * 0.4 });
    this.cityCache.clear();
    // invalidar chunks cercanos
    for (const [k, c] of this.chunks) {
      if (Math.hypot(c.cx * CHUNK - ap.x, c.cz * CHUNK - ap.z) < 9000) { this.disposeChunk(c); this.chunks.delete(k); }
    }
    for (const [k, c] of this.objChunks) {
      if (Math.hypot(c.cx * CHUNK - ap.x, c.cz * CHUNK - ap.z) < 9000) { this.disposeObj(c); this.objChunks.delete(k); }
    }
    this.airportGroups.push(this.buildAirport(ap));
    return ap;
  }

  runwayTexture(ap) {
    const W = 256, H = 4096;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#3a3b3d'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? 20 : 90},${Math.random() < 0.5 ? 20 : 90},${Math.random() < 0.5 ? 20 : 90},0.15)`;
      g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 2 + Math.random() * 20);
    }
    // marcas de goma en zonas de toma
    for (const y0 of [200, H - 900]) {
      g.fillStyle = 'rgba(15,15,15,0.35)';
      for (let i = 0; i < 40; i++) g.fillRect(W / 2 - 40 + Math.random() * 80, y0 + Math.random() * 700, 6, 30 + Math.random() * 80);
    }
    g.fillStyle = '#f2f2f2';
    g.fillRect(6, 0, 5, H); g.fillRect(W - 11, 0, 5, H);
    for (let y = 420; y < H - 420; y += 110) g.fillRect(W / 2 - 3, y, 6, 60);
    const num1 = Math.round(((ap.hdg * 180 / Math.PI) % 360) / 10) || 36;
    const num2 = ((num1 + 18 - 1) % 36) + 1;
    const ends = [[H, num1, 0], [0, num2, Math.PI]];
    for (const [yEnd, num, rot] of ends) {
      g.save();
      g.translate(W / 2, yEnd); g.rotate(rot);
      // umbral (piano)
      for (let i = 0; i < 8; i++) {
        g.fillRect(-W / 2 + 16 + i * 29 + (i >= 4 ? 8 : 0), -150, 18, 120);
      }
      g.font = 'bold 110px sans-serif';
      g.textAlign = 'center';
      g.save(); g.scale(1, 1.6);
      g.fillText(String(num).padStart(2, '0'), 0, -190 / 1.6);
      g.restore();
      // marcas de zona de toma
      for (const y of [-520, -720, -920]) { g.fillRect(-70, y, 22, 60); g.fillRect(48, y, 22, 60); }
      g.fillRect(-80, -640, 36, 100); g.fillRect(44, -640, 36, 100);
      g.restore();
    }
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  buildAirport(ap) {
    const grp = new THREE.Group();
    grp.position.set(ap.x, ap.elev, ap.z);
    grp.rotation.y = -ap.hdg;
    const L = ap.len, W = ap.width;
    const po = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 };
    const asphalt = new THREE.MeshLambertMaterial({ color: 0x4a4b4d, ...po });
    const concrete = new THREE.MeshLambertMaterial({ color: 0x9a9890, ...po });
    // Pista
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: this.runwayTexture(ap), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 }));
    rw.position.y = 0.3; rw.receiveShadow = true;
    grp.add(rw);
    // Arcén
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(W + 16, L + 120).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5f6058, ...po }));
    sh.position.y = 0.2; sh.receiveShadow = true; grp.add(sh);
    // Rodadura paralela y conexiones
    const tw = new THREE.Mesh(new THREE.PlaneGeometry(23, L).rotateX(-Math.PI / 2), asphalt);
    tw.position.set(130, 0.25, 0); tw.receiveShadow = true; grp.add(tw);
    for (const u of [-L / 2 + 30, -L / 4, 0, L / 4, L / 2 - 30]) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(108, 23).rotateX(-Math.PI / 2), asphalt);
      c.position.set(76, 0.24, -u); c.receiveShadow = true; grp.add(c);
    }
    // Plataforma
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(150, 520).rotateX(-Math.PI / 2), concrete);
    apron.position.set(220, 0.26, 0); apron.receiveShadow = true; grp.add(apron);
    // Helipuerto
    const hcv = document.createElement('canvas'); hcv.width = hcv.height = 128;
    const hg = hcv.getContext('2d');
    hg.fillStyle = '#555'; hg.fillRect(0, 0, 128, 128);
    hg.strokeStyle = '#fff'; hg.lineWidth = 6; hg.beginPath(); hg.arc(64, 64, 54, 0, Math.PI * 2); hg.stroke();
    hg.fillStyle = '#ffd400'; hg.font = 'bold 80px sans-serif'; hg.textAlign = 'center'; hg.textBaseline = 'middle'; hg.fillText('H', 64, 68);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(hcv), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 }));
    pad.position.set(220, 0.32, 200); grp.add(pad);
    ap.helipad = this.localToWorld(ap, 220, -200);
    // Terminal
    const term = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 240).translate(0, 7, 0), new THREE.MeshLambertMaterial({ color: 0xd9dde0 }));
    term.position.set(320, 0, -20); term.castShadow = term.receiveShadow = true; grp.add(term);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(41, 6, 236).translate(0, 7, 0), new THREE.MeshPhongMaterial({ color: 0x35607a, shininess: 100, specular: 0xffffff, emissive: 0x000000 }));
    glass.position.set(320, 0, -20); grp.add(glass);
    ap.glassMat = glass.material;
    const roofT = new THREE.Mesh(new THREE.BoxGeometry(48, 1.5, 250).translate(0, 14.5, 0), new THREE.MeshLambertMaterial({ color: 0x7c8288 }));
    roofT.position.set(320, 0, -20); grp.add(roofT);
    // Pasarelas
    for (const u of [-80, -20, 40]) {
      const j = new THREE.Mesh(new THREE.BoxGeometry(30, 3.5, 3.5).translate(-15, 0, 0), new THREE.MeshLambertMaterial({ color: 0xc0c4c8 }));
      j.position.set(300, 5, u); grp.add(j);
    }
    // Torre de control
    const tower = new THREE.Group();
    tower.add(new THREE.Mesh(new THREE.CylinderGeometry(3.5, 5, 38, 10).translate(0, 19, 0), new THREE.MeshLambertMaterial({ color: 0xe0e0dc })));
    tower.add(new THREE.Mesh(new THREE.CylinderGeometry(8, 6, 7, 8).translate(0, 41.5, 0), new THREE.MeshPhongMaterial({ color: 0x2e5670, shininess: 120, specular: 0xffffff })));
    tower.add(new THREE.Mesh(new THREE.CylinderGeometry(8.6, 8.6, 1.2, 8).translate(0, 45.5, 0), new THREE.MeshLambertMaterial({ color: 0x777777 })));
    const bcn = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
    bcn.position.y = 48; tower.add(bcn);
    tower.position.set(330, 0, 200);
    tower.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    grp.add(tower);
    // Hangares
    for (let i = 0; i < 3; i++) {
      const hg2 = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 50, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: [0x8a9099, 0x6f7a6c, 0x9a8f7a][i] }));
      hg2.position.set(320, 0, 300 + i * 60); hg2.castShadow = hg2.receiveShadow = true; grp.add(hg2);
    }
    // Manga de viento
    const ws = new THREE.Group();
    ws.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8, 6).translate(0, 4, 0), new THREE.MeshLambertMaterial({ color: 0xdddddd })));
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 8, 1, true).rotateZ(Math.PI / 2).translate(2.5, 7.6, 0), new THREE.MeshLambertMaterial({ color: 0xff6a00, side: THREE.DoubleSide }));
    ws.add(sock); ws.position.set(-60, 0, -L / 2 + 300); grp.add(ws);
    ap.windsock = ws;
    // Aviones aparcados
    const parked = ['b737', 'b737', 'learjet', 'c172', 'b737'];
    parked.forEach((id, i) => {
      try {
        const bm = buildModel(id), m = bm.group;
        m.position.set(id === 'b737' ? 262 : 250, bm.gearHeight + 0.26, -170 + i * 70);
        m.rotation.y = Math.PI / 2;
        for (const d of bm.parts.discs) d.visible = false;
        m.traverse(o => { if (o.isMesh) o.castShadow = true; });
        grp.add(m);
      } catch (e) { /* modelos opcionales */ }
    });
    // Luces de pista (Points de tamaño fijo en pantalla)
    const pos = [], col = [];
    const add = (x, y, z, c) => { pos.push(x, y, z); col.push(c[0], c[1], c[2]); };
    const WHITE = [1, 0.95, 0.8], GREEN = [0.2, 1, 0.3], RED = [1, 0.15, 0.1], BLUE = [0.3, 0.45, 1], AMB = [1, 0.75, 0.2];
    for (let u = -L / 2; u <= L / 2; u += 60) {
      const c = Math.abs(u) > L / 2 - 600 ? AMB : WHITE;
      add(-W / 2 - 2, 0.8, u, c); add(W / 2 + 2, 0.8, u, c);
      add(0, 0.5, u, WHITE);
    }
    for (let x = -W / 2; x <= W / 2; x += 4) { add(x, 0.8, L / 2 + 2, GREEN); add(x, 0.8, -L / 2 - 2, GREEN); }
    for (let x = -W / 2; x <= W / 2; x += 6) { add(x, 0.8, L / 2 - 2, RED); add(x, 0.8, -L / 2 + 2, RED); }
    // Luces de aproximación en ambas cabeceras
    for (const s of [1, -1]) {
      for (let k = 1; k <= 30; k++) {
        const u = s * (L / 2 + k * 30);
        add(0, 1, u, WHITE);
        if (k % 5 === 0) for (let x = -15; x <= 15; x += 3) add(x, 1, u, WHITE);
      }
    }
    for (let u = -L / 2; u <= L / 2; u += 50) { add(118, 0.6, u, BLUE); add(142, 0.6, u, BLUE); }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lpm = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false });
    const pts = new THREE.Points(lg, lpm);
    pts.frustumCulled = false;
    grp.add(pts);
    ap.lightsMat = lpm;
    // PAPI a la izquierda de ambas cabeceras
    ap.papi = [];
    for (const s of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const x = s * (-(W / 2 + 15 + i * 9));
        m.position.set(x, 0.8, s * (L / 2 - 300));
        grp.add(m);
        ap.papi.push({ mesh: m, end: s, thr: [3.5, 3.17, 2.83, 2.5][i] });
      }
    }
    // Baliza de destino (columna de luz)
    if (ap.isDestination) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(25, 25, 4000, 16, 1, true).translate(0, 2000, 0),
        new THREE.MeshBasicMaterial({ color: 0x55ddff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(0, 0, 0);
      grp.add(beam);
      ap.beam = beam;
    }
    grp.traverse(o => { if (o.isMesh && !o.castShadow) o.receiveShadow = true; });
    this.scene.add(grp);
    ap.group = grp;
    return grp;
  }

  localToWorld(ap, v, u) {
    return { x: ap.x + ap.right.x * v + ap.dir.x * u, z: ap.z + ap.right.z * v + ap.dir.z * u };
  }

  // ---------- Chunks de terreno ----------
  buildChunkMesh(cx, cz, res) {
    const step = CHUNK / res, N = res + 1, M = res + 3;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const hs = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) hs[j * M + i] = this.height(ox + (i - 1) * step, oz + (j - 1) * step);
    const nv = N * N + 4 * N;
    const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
    const F = new Float32Array(nv), CI = new Float32Array(nv);
    const tmp = [0, 0, 0];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const h = hs[(j + 1) * M + i + 1];
      const x = i * step, z = j * step;
      P[k * 3] = x; P[k * 3 + 1] = h; P[k * 3 + 2] = z;
      let nx = hs[(j + 1) * M + i] - hs[(j + 1) * M + i + 2];
      let ny = 2 * step;
      let nz = hs[j * M + i + 1] - hs[(j + 2) * M + i + 1];
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      Nn[k * 3] = nx; Nn[k * 3 + 1] = ny; Nn[k * 3 + 2] = nz;
      const r = this.surface(ox + x, oz + z, h, ny, tmp);
      C[k * 3] = tmp[0]; C[k * 3 + 1] = tmp[1]; C[k * 3 + 2] = tmp[2];
      F[k] = r.field; CI[k] = r.city;
    }
    // faldones para ocultar grietas entre LODs
    const edges = [];
    for (let e = 0; e < 4; e++) {
      const list = [];
      for (let t = 0; t < N; t++) {
        const i = e === 0 ? t : e === 1 ? res : e === 2 ? res - t : 0;
        const j = e === 0 ? 0 : e === 1 ? t : e === 2 ? res : res - t;
        list.push(j * N + i);
      }
      edges.push(list);
    }
    let sk = N * N;
    const idx = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const a = j * N + i, b = (j + 1) * N + i, c = j * N + i + 1, d = (j + 1) * N + i + 1;
      idx.push(a, b, c, c, b, d);
    }
    for (const list of edges) {
      const start = sk;
      for (const k of list) {
        P[sk * 3] = P[k * 3]; P[sk * 3 + 1] = P[k * 3 + 1] - 40 - step; P[sk * 3 + 2] = P[k * 3 + 2];
        Nn[sk * 3] = Nn[k * 3]; Nn[sk * 3 + 1] = Nn[k * 3 + 1]; Nn[sk * 3 + 2] = Nn[k * 3 + 2];
        C[sk * 3] = C[k * 3]; C[sk * 3 + 1] = C[k * 3 + 1]; C[sk * 3 + 2] = C[k * 3 + 2];
        F[sk] = F[k]; CI[sk] = CI[k];
        sk++;
      }
      for (let t = 0; t < list.length - 1; t++) {
        const a = list[t], b = list[t + 1], c = start + t, d = start + t + 1;
        idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('aField', new THREE.BufferAttribute(F, 1));
    g.setAttribute('aCity', new THREE.BufferAttribute(CI, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.boundingSphere.radius += 50;
    const mesh = new THREE.Mesh(g, this.terrainMat);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  surface(x, z, h, ny, out) {
    const slope = 1 - ny;
    const moist = this.nBiome.fbm(x / 5200, z / 5200, 2);
    let r = lerp(0.52, 0.24, (moist + 1) / 2), g = lerp(0.56, 0.45, (moist + 1) / 2), b = lerp(0.28, 0.14, (moist + 1) / 2);
    const forest = smoothstep(0.05, 0.22, this.nForest.fbm(x / 2200, z / 2200, 3)) * (1 - smoothstep(950, 1250, h));
    const ci = this.cityAt(x, z);
    const city = this.cityDensity(x, z, ci);
    let apw = 0;
    for (const ap of this.airports) apw = Math.max(apw, this.airportWeight(ap, x, z, -200));
    const fw = forest * (1 - city) * (1 - apw);
    r = lerp(r, 0.11, fw); g = lerp(g, 0.25, fw); b = lerp(b, 0.09, fw);
    const rock = Math.max(smoothstep(0.28, 0.5, slope), smoothstep(650, 1050, h) * 0.75);
    r = lerp(r, 0.44, rock); g = lerp(g, 0.41, rock); b = lerp(b, 0.37, rock);
    const snow = smoothstep(1050, 1300, h + this.nDet.noise(x / 300, z / 300) * 120) * (1 - smoothstep(0.45, 0.7, slope));
    r = lerp(r, 0.95, snow); g = lerp(g, 0.96, snow); b = lerp(b, 1.0, snow);
    const sand = 1 - smoothstep(1.2, 4, h);
    r = lerp(r, 0.72, sand); g = lerp(g, 0.66, sand); b = lerp(b, 0.48, sand);
    if (h < 0) { const d = clamp(-h / 30, 0, 1); r = lerp(r, 0.25, d); g = lerp(g, 0.3, d); b = lerp(b, 0.25, d); }
    r = lerp(r, 0.36, apw * 0.7); g = lerp(g, 0.5, apw * 0.7); b = lerp(b, 0.22, apw * 0.7);
    out[0] = r; out[1] = g; out[2] = b;
    const field = smoothstep(-0.05, 0.15, this.nBiome.noise(x / 3500 + 50, z / 3500)) * (1 - fw) * (1 - rock) *
      (1 - smoothstep(250, 450, h)) * (1 - sand) * (1 - city) * (1 - apw);
    return { field, city };
  }

  // ---------- Objetos por chunk ----------
  buildChunkObjects(cx, cz) {
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const rnd = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ this.seed);
    const grp = new THREE.Group();
    grp.position.set(ox, 0, oz);
    const trees = { conifer: [], broad: [] };
    const boxes = [], roofs = [], farms = [], churches = [], lamps = [], reds = [], turbines = [], misc = { watertower: [], chimney: [] };
    const free = (x, z) => !this.nearAirport(x, z, 60);

    // Bosques
    const sp = this.treeSpacing;
    for (let z = sp / 2; z < CHUNK; z += sp) for (let x = sp / 2; x < CHUNK; x += sp) {
      const wx = ox + x + (rnd() - 0.5) * sp * 0.9, wz = oz + z + (rnd() - 0.5) * sp * 0.9;
      const fN = this.nForest.fbm(wx / 2200, wz / 2200, 3);
      const dens = smoothstep(0.05, 0.25, fN);
      const iso = 0.012;
      if (rnd() > dens * 0.95 + iso) continue;
      const h = this.groundHeight(wx, wz);
      if (h < 2 || h > 1150) continue;
      if (!free(wx, wz)) continue;
      const ci = this.cityAt(wx, wz);
      const cd = this.cityDensity(wx, wz, ci);
      if (cd > 0.05) continue;
      const kind = h > 450 || this.nDet.noise(wx / 900, wz / 900) > 0.2 ? 'conifer' : 'broad';
      trees[kind].push(wx - ox, h - 0.3, wz - oz, 0.7 + rnd() * 0.7, rnd() * 6.28);
    }

    // Ciudad (manzanas de 100 m)
    for (let bz = 0; bz < CHUNK / BLOCK; bz++) for (let bx = 0; bx < CHUNK / BLOCK; bx++) {
      const x0 = ox + bx * BLOCK, z0 = oz + bz * BLOCK;
      const ccx = x0 + 55, ccz = z0 + 55;
      const ci = this.cityAt(ccx, ccz);
      if (!ci) continue;
      const dens = this.cityDensity(ccx, ccz, ci);
      if (dens < 0.25) continue;
      if (!free(ccx, ccz)) continue;
      const h = this.height(ccx, ccz) - 0.5;
      const big = ci.city.big;
      const bh = hash2(Math.floor(x0 / BLOCK), Math.floor(z0 / BLOCK), this.seed + 5);
      // farolas
      for (let t = 0; t < 4; t++) {
        lamps.push(x0 + 5 + t * 25 - ox, h + 7, z0 + 11 - oz);
        lamps.push(x0 + 11 - ox, h + 7, z0 + 5 + t * 25 - oz);
      }
      if (bh < 0.07) {
        // parque
        for (let t = 0; t < 14; t++) trees.broad.push(x0 + 16 + rnd() * 78 - ox, h, z0 + 16 + rnd() * 78 - oz, 0.6 + rnd() * 0.5, rnd() * 6.28);
        continue;
      }
      if (dens > 0.82 && big > 0.45 && rnd() < 0.85) {
        // torres del centro
        const n = rnd() < 0.5 ? 1 : 2;
        for (let t = 0; t < n; t++) {
          const w = n === 1 ? 40 + rnd() * 30 : 28 + rnd() * 10;
          const d = n === 1 ? 40 + rnd() * 30 : 60 + rnd() * 15;
          const x = n === 1 ? x0 + 55 : x0 + 35 + t * 40;
          const ht = (35 + rnd() * rnd() * 170) * (0.5 + big);
          boxes.push(x - ox, h, z0 + 55 - oz, w, ht, d, TOWERS[Math.floor(rnd() * TOWERS.length)]);
          boxes.push(x - ox, h + ht, z0 + 55 - oz, w * 0.6, 3 + rnd() * 6, d * 0.6, 0x777777);
          if (ht > 80) reds.push(x - ox, h + ht + 6, z0 + 55 - oz);
        }
      } else if (dens > 0.55) {
        // bloques de pisos alrededor de la manzana
        const ht = 9 + rnd() * 24 * (0.4 + big);
        const col = FACADES[Math.floor(rnd() * FACADES.length)];
        boxes.push(x0 + 55 - ox, h, z0 + 22 - oz, 82, ht * (0.8 + rnd() * 0.4), 18, col);
        boxes.push(x0 + 55 - ox, h, z0 + 88 - oz, 82, ht * (0.8 + rnd() * 0.4), 18, FACADES[Math.floor(rnd() * FACADES.length)]);
        boxes.push(x0 + 22 - ox, h, z0 + 55 - oz, 18, ht * (0.8 + rnd() * 0.4), 48, col);
        boxes.push(x0 + 88 - ox, h, z0 + 55 - oz, 18, ht * (0.8 + rnd() * 0.4), 48, FACADES[Math.floor(rnd() * FACADES.length)]);
        if (rnd() < 0.08) misc.chimney.push(x0 + 55 - ox, h, z0 + 55 - oz);
      } else {
        // casas unifamiliares
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
          if (rnd() < 0.15) continue;
          const x = x0 + 26 + i * 28 + (rnd() - 0.5) * 4, z = z0 + 26 + j * 28 + (rnd() - 0.5) * 4;
          const w = 9 + rnd() * 5, d = 9 + rnd() * 6, ht = 3 + rnd() * 4;
          boxes.push(x - ox, h, z - oz, w, ht, d, FACADES[Math.floor(rnd() * FACADES.length)]);
          roofs.push(x - ox, h + ht, z - oz, w + 1, 2.5 + rnd() * 1.5, d + 1, ROOFS[Math.floor(rnd() * ROOFS.length)], rnd() < 0.5 ? 0 : Math.PI / 2);
          if (rnd() < 0.4) trees.broad.push(x + 10 - ox, h, z + 8 - oz, 0.5 + rnd() * 0.4, rnd() * 6);
        }
        if (rnd() < 0.03) misc.watertower.push(x0 + 55 - ox, h, z0 + 55 - oz);
      }
    }

    // Pueblos
    const vx0 = Math.floor(ox / VILLAGE_CELL) - 1, vx1 = Math.floor((ox + CHUNK) / VILLAGE_CELL) + 1;
    const vz0 = Math.floor(oz / VILLAGE_CELL) - 1, vz1 = Math.floor((oz + CHUNK) / VILLAGE_CELL) + 1;
    for (let vz = vz0; vz <= vz1; vz++) for (let vx = vx0; vx <= vx1; vx++) {
      if (hash2(vx, vz, this.seed + 300) > 0.3) continue;
      const cxv = (vx + 0.2 + 0.6 * hash2(vx, vz, this.seed + 301)) * VILLAGE_CELL;
      const czv = (vz + 0.2 + 0.6 * hash2(vx, vz, this.seed + 302)) * VILLAGE_CELL;
      const ch = this.height(cxv, czv);
      if (ch < 3 || ch > 900 || this.cityAt(cxv, czv) || this.nearAirport(cxv, czv, 300)) continue;
      const vr = mulberry32(vx * 9176 + vz * 131 + this.seed);
      const n = 10 + Math.floor(vr() * 28);
      const inChunk = (x, z) => x >= ox && x < ox + CHUNK && z >= oz && z < oz + CHUNK;
      if (inChunk(cxv, czv)) churches.push(cxv - ox, this.groundHeight(cxv, czv) - 0.5, czv - oz, vr() * 6.28);
      for (let k = 0; k < n; k++) {
        const a = vr() * Math.PI * 2, d = 25 + Math.sqrt(vr()) * 190;
        const x = cxv + Math.cos(a) * d, z = czv + Math.sin(a) * d;
        const w = 8 + vr() * 5, dd = 8 + vr() * 6, ht = 3 + vr() * 3.5, col = FACADES[Math.floor(vr() * FACADES.length)];
        const rc = ROOFS[Math.floor(vr() * 3)], rr = vr() < 0.5 ? 0 : Math.PI / 2;
        if (!inChunk(x, z)) continue;
        const h = this.groundHeight(x, z);
        if (h < 1) continue;
        boxes.push(x - ox, h - 1, z - oz, w, ht + 1, dd, col);
        roofs.push(x - ox, h + ht, z - oz, w + 1, 2.4, dd + 1, rc, rr);
        if (k % 3 === 0) lamps.push(x + 6 - ox, h + 6, z - oz);
      }
    }

    // Granjas aisladas
    for (let k = 0; k < 3; k++) {
      const x = ox + rnd() * CHUNK, z = oz + rnd() * CHUNK;
      const fi = this.nBiome.noise(x / 3500 + 50, z / 3500);
      if (fi < 0.1 || rnd() < 0.3) continue;
      const h = this.groundHeight(x, z);
      if (h < 2 || h > 400 || !free(x, z) || this.cityAt(x, z)) continue;
      farms.push(x - ox, h - 0.5, z - oz, rnd() * 6.28);
      lamps.push(x - ox + 6, h + 5, z - oz);
      for (let t = 0; t < 5; t++) trees.broad.push(x - ox - 15 + rnd() * 10, h, z - oz - 20 + rnd() * 40, 0.7 + rnd() * 0.4, rnd() * 6);
    }

    // Parques eólicos
    const fx0 = Math.floor(ox / FARM_CELL), fz0 = Math.floor(oz / FARM_CELL);
    for (let fz = fz0 - 1; fz <= fz0 + 1; fz++) for (let fx = fx0 - 1; fx <= fx0 + 1; fx++) {
      if (hash2(fx, fz, this.seed + 500) > 0.16) continue;
      const bx = (fx + 0.3 + 0.4 * hash2(fx, fz, this.seed + 501)) * FARM_CELL;
      const bz = (fz + 0.3 + 0.4 * hash2(fx, fz, this.seed + 502)) * FARM_CELL;
      const ang = hash2(fx, fz, this.seed + 503) * Math.PI;
      const n = 5 + Math.floor(hash2(fx, fz, this.seed + 504) * 8);
      for (let k = 0; k < n; k++) {
        const x = bx + Math.cos(ang) * (k - n / 2) * 260, z = bz + Math.sin(ang) * (k - n / 2) * 260;
        if (x < ox || x >= ox + CHUNK || z < oz || z >= oz + CHUNK) continue;
        const h = this.groundHeight(x, z);
        if (h < 30 || this.cityAt(x, z) || !free(x, z)) continue;
        turbines.push(x - ox, h - 1, z - oz, ang + Math.PI / 2 + 0.3);
        reds.push(x - ox, h + 84, z - oz);
      }
    }

    // ---- crear mallas ----
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const inst = (geo, mat, arr, stride, fn, shadow = true) => {
      const n = arr.length / stride;
      if (!n) return null;
      const im = new THREE.InstancedMesh(geo, mat, n);
      for (let i = 0; i < n; i++) {
        fn(arr, i * stride, dummy, i, im);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      grp.add(im);
      return im;
    };
    for (const kind of ['conifer', 'broad']) {
      inst(this.G[kind], this.propMat, trees[kind], 5, (a, o, d, i, im) => {
        d.position.set(a[o], a[o + 1], a[o + 2]); d.scale.setScalar(a[o + 3]); d.rotation.set(0, a[o + 4], 0);
        const v = 0.8 + 0.25 * Math.sin(i * 12.9898), w2 = 0.12 * Math.cos(i * 4.1);
        color.setRGB(v + w2, v, v - w2 * 0.5);
        im.setColorAt(i, color);
      }, false);
    }
    inst(this.G.box, this.buildingMat, boxes, 7, (a, o, d, i, im) => {
      d.position.set(a[o], a[o + 1], a[o + 2]); d.scale.set(a[o + 3], a[o + 4], a[o + 5]); d.rotation.set(0, 0, 0);
      im.setColorAt(i, color.set(a[o + 6]));
    });
    inst(this.G.roof, this.propMat, roofs, 8, (a, o, d, i, im) => {
      d.position.set(a[o], a[o + 1], a[o + 2]); d.scale.set(a[o + 3], a[o + 4], a[o + 5]); d.rotation.set(0, a[o + 7], 0);
      im.setColorAt(i, color.set(a[o + 6]));
    });
    const place4 = (a, o, d) => { d.position.set(a[o], a[o + 1], a[o + 2]); d.scale.setScalar(1); d.rotation.set(0, a[o + 3], 0); };
    inst(this.G.farm, this.propMat, farms, 4, place4);
    inst(this.G.church, this.propMat, churches, 4, place4);
    inst(this.G.turbine, this.propMat, turbines, 4, place4);
    const place3 = (a, o, d) => { d.position.set(a[o], a[o + 1], a[o + 2]); d.scale.setScalar(1); d.rotation.set(0, 0, 0); };
    inst(this.G.watertower, this.propMat, misc.watertower, 3, place3);
    inst(this.G.chimney, this.propMat, misc.chimney, 3, place3);
    const rotors = [];
    for (let i = 0; i < turbines.length; i += 4) {
      const holder = new THREE.Group();
      holder.position.set(turbines[i], turbines[i + 1] + 81, turbines[i + 2]);
      holder.rotation.y = turbines[i + 3];
      const r = new THREE.Mesh(this.G.rotor, this.propMat);
      r.position.z = -3.5;
      r.rotation.z = Math.random() * 6;
      holder.add(r);
      grp.add(holder);
      rotors.push(r);
      this.rotors.add(r);
    }
    const pts = (arr, mat) => {
      if (!arr.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const p = new THREE.Points(g, mat);
      grp.add(p);
    };
    pts(lamps, this.lightMat);
    pts(reds, this.redLightMat);
    this.scene.add(grp);
    return { grp, cx, cz, rotors };
  }

  disposeChunk(c) {
    this.group.remove(c.mesh);
    c.mesh.geometry.dispose();
  }

  disposeObj(c) {
    this.scene.remove(c.grp);
    c.grp.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isPoints) o.geometry.dispose();
    });
    for (const r of c.rotors) this.rotors.delete(r);
  }

  lodFor(d) { return d <= 1.6 ? 24 : d <= 3.5 ? 12 : d <= 6.5 ? 6 : 4; }

  update(camPos, dt, budgetMs = 7, force = false) {
    const t0 = performance.now();
    const fx = camPos.x / CHUNK, fz = camPos.z / CHUNK;
    const ccx = Math.floor(fx), ccz = Math.floor(fz);
    const R = this.viewRadius;
    const jobs = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      const d = Math.hypot(cx + 0.5 - fx, cz + 0.5 - fz);
      if (d > R + 0.5) continue;
      const res = this.lodFor(d);
      const key = cx + ',' + cz;
      const ex = this.chunks.get(key);
      if (!ex || ex.res !== res) jobs.push({ cx, cz, res, d, key, ex, kind: 't' });
      if (d < this.objRadius && !this.objChunks.has(key)) jobs.push({ cx, cz, d: d + 0.3, key, kind: 'o' });
    }
    jobs.sort((a, b) => a.d - b.d);
    for (const j of jobs) {
      if (!force && performance.now() - t0 > budgetMs) break;
      if (j.kind === 't') {
        const mesh = this.buildChunkMesh(j.cx, j.cz, j.res);
        if (j.ex) this.disposeChunk(j.ex);
        this.group.add(mesh);
        this.chunks.set(j.key, { mesh, res: j.res, cx: j.cx, cz: j.cz });
      } else {
        this.objChunks.set(j.key, this.buildChunkObjects(j.cx, j.cz));
      }
    }
    for (const [k, c] of this.chunks) {
      if (Math.hypot(c.cx + 0.5 - fx, c.cz + 0.5 - fz) > R + 1.5) { this.disposeChunk(c); this.chunks.delete(k); }
    }
    for (const [k, c] of this.objChunks) {
      if (Math.hypot(c.cx + 0.5 - fx, c.cz + 0.5 - fz) > this.objRadius + 1) { this.disposeObj(c); this.objChunks.delete(k); }
    }
    this.water.position.set(Math.round(camPos.x / 1000) * 1000, 0, Math.round(camPos.z / 1000) * 1000);
    this.waterTex.offset.set((camPos.x / 80000) * 1200 % 1, -(camPos.z / 80000) * 1200 % 1);
    for (const r of this.rotors) r.rotation.z += dt * 1.3;
    return jobs.length;
  }

  updateLights(night, camPos) {
    this.lightMat.opacity = smoothstep(0.15, 0.6, night);
    this.redLightMat.opacity = smoothstep(0.1, 0.5, night) * (Math.sin(performance.now() / 400) > 0 ? 1 : 0.15);
    for (const ap of this.airports) {
      ap.lightsMat.size = 1.6 + 2.6 * night;
      ap.lightsMat.opacity = 0.5 + 0.5 * night;
      if (ap.glassMat) ap.glassMat.emissive.setRGB(0.5 * night, 0.42 * night, 0.25 * night);
      // PAPI según ángulo de planeo del observador
      for (const p of ap.papi) {
        const tp = this.localToWorld(ap, 0, p.end * (ap.len / 2 - 300) * -1);
        const dist = Math.hypot(camPos.x - tp.x, camPos.z - tp.z);
        const ang = Math.atan2(camPos.y - ap.elev, dist) * 180 / Math.PI;
        p.mesh.material.color.set(ang > p.thr ? 0xffffff : 0xff2010);
      }
      if (ap.beam) ap.beam.material.opacity = 0.07 + 0.06 * Math.sin(performance.now() / 500) + night * 0.08;
    }
  }

  dispose() {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    for (const c of this.objChunks.values()) this.disposeObj(c);
    this.chunks.clear(); this.objChunks.clear();
    this.scene.remove(this.group);
    this.scene.remove(this.water);
    for (const g of this.airportGroups) this.scene.remove(g);
  }
}

function colorizeInPlace(geo) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3).fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
