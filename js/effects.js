// Partículas: chispas brillantes (HDR, alimentan el bloom) y humo facetado low-poly.
import * as THREE from 'three';

const GLOW_VS = `
attribute float aSize; attribute vec3 aColor;
varying vec3 vC;
uniform float uScale;
void main(){
  vC = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.5);
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FS = `
varying vec3 vC;
void main(){
  float d = length(gl_PointCoord-0.5)*2.0;
  float a = 1.0 - smoothstep(0.2, 1.0, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vC*a, 1.0);
}`;

export class Particles {
  constructor(scene, nGlow = 1400, nSmoke = 420) {
    this.scene = scene;
    // --- chispas ---
    this.nGlow = nGlow;
    this.g = [];
    for (let i = 0; i < nGlow; i++) this.g.push({ life: 0, age: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, gr: 0, b: 0, s: 1, drag: 1 });
    this.gi = 0;
    const geo = new THREE.BufferGeometry();
    this.gp = new Float32Array(nGlow * 3); this.gc = new Float32Array(nGlow * 3); this.gs = new Float32Array(nGlow);
    geo.setAttribute('position', new THREE.BufferAttribute(this.gp, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.gc, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.gs, 1).setUsage(THREE.DynamicDrawUsage));
    this.uScale = { value: 600 };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: { uScale: this.uScale },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    // --- humo ---
    this.nSmoke = nSmoke;
    this.s = [];
    for (let i = 0; i < nSmoke; i++) this.s.push({ life: 0, age: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, rx: 0, ry: 0, sp: 0 });
    this.si = 0;
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, metalness: 0 }), nSmoke);
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.smoke.setColorAt(0, new THREE.Color(1, 1, 1));
    this.smoke.count = 0;
    scene.add(this.smoke);
    this._d = new THREE.Object3D();
    this._c = new THREE.Color();
  }

  setViewport(height, fovDeg) { this.uScale.value = height / (2 * Math.tan(fovDeg * Math.PI / 360)); }

  glow(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 1) {
    const p = this.g[this.gi]; this.gi = (this.gi + 1) % this.nGlow;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.r = r; p.gr = g; p.b = b; p.s = size; p.life = life; p.age = 0; p.drag = drag;
  }

  puff(x, y, z, vx, vy, vz, size, life, shade = 0.5) {
    const p = this.s[this.si]; this.si = (this.si + 1) % this.nSmoke;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.size = size; p.life = life; p.age = 0; p.shade = shade;
    p.rx = Math.random() * 6.28; p.ry = Math.random() * 6.28; p.sp = (Math.random() - 0.5) * 1.5;
  }

  explosion(pos, scale = 1) {
    const R = Math.random;
    for (let i = 0; i < 60; i++) {
      const a = R() * 6.28, u = R() * 2 - 1, q = Math.sqrt(1 - u * u), sp = (10 + R() * 40) * scale;
      this.glow(pos.x, pos.y, pos.z, Math.cos(a) * q * sp, Math.abs(u) * sp * 0.8 + 3, Math.sin(a) * q * sp,
        9, 3 + R() * 2.5, 0.5, (2.5 + R() * 4) * scale, 0.4 + R() * 0.8, 2.2);
    }
    for (let i = 0; i < 18; i++) {
      const sp = 3 + R() * 9;
      const a = R() * 6.28;
      this.puff(pos.x + (R() - 0.5) * 5 * scale, pos.y + R() * 4 * scale, pos.z + (R() - 0.5) * 5 * scale,
        Math.cos(a) * sp, 4 + R() * 9, Math.sin(a) * sp, (2 + R() * 3.5) * scale, 2.5 + R() * 3.5, 0.08 + R() * 0.25);
    }
  }

  // chispazo de impacto
  spark(pos, r = 6, g = 4, b = 1.5, n = 7) {
    const R = Math.random;
    for (let i = 0; i < n; i++) this.glow(pos.x, pos.y, pos.z, (R() - 0.5) * 30, R() * 22, (R() - 0.5) * 30, r, g, b, 0.9 + R() * 1.2, 0.2 + R() * 0.3, 3);
  }

  update(dt) {
    const gp = this.gp, gc = this.gc, gs = this.gs;
    for (let i = 0; i < this.nGlow; i++) {
      const p = this.g[i];
      if (p.age >= p.life) { if (gs[i] !== 0) gs[i] = 0; continue; }
      p.age += dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = Math.max(0, 1 - p.age / p.life);
      gp[i * 3] = p.x; gp[i * 3 + 1] = p.y; gp[i * 3 + 2] = p.z;
      gc[i * 3] = p.r * t; gc[i * 3 + 1] = p.gr * t * t; gc[i * 3 + 2] = p.b * t * t;
      gs[i] = p.s * (0.5 + t * 0.5);
    }
    const ga = this.points.geometry.attributes;
    ga.position.needsUpdate = ga.aColor.needsUpdate = ga.aSize.needsUpdate = true;
    let n = 0;
    const d = this._d, c = this._c;
    for (let i = 0; i < this.nSmoke; i++) {
      const p = this.s[i];
      if (p.age >= p.life) continue;
      p.age += dt;
      const k = Math.exp(-0.9 * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k + 0.8 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.sp * dt;
      const t = p.age / p.life;
      // crece rápido y se encoge al disiparse: humo opaco y facetado, sin ordenar transparencias
      const sz = p.size * Math.min(1, t * 6 + 0.25) * (1 + t * 1.2) * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      if (sz <= 0.01) continue;
      d.position.set(p.x, p.y, p.z); d.rotation.set(p.rx, p.ry, 0); d.scale.setScalar(sz); d.updateMatrix();
      this.smoke.setMatrixAt(n, d.matrix);
      this.smoke.setColorAt(n, c.setRGB(p.shade * 1.1, p.shade, p.shade * 1.15));
      n++;
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }

  clear() { for (const p of this.g) p.age = p.life; for (const p of this.s) p.age = p.life; this.smoke.count = 0; }
}
