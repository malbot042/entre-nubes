// Cielo, sol/luna, estrellas, iluminación, niebla, nubes, lluvia/nieve y rayos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, mulberry32 } from './util.js?v=11';
import { sharedUniforms } from './world.js?v=11';

export const WEATHER = {
  clear: { name: 'Despejado', clouds: 25, cloudBase: 1800, overcast: 0, fog: 28000, rain: 0, snow: 0, wind: 3, gust: 0.5, turb: 0, dark: 0, lightning: false },
  partly: { name: 'Parcialmente nuboso', clouds: 110, cloudBase: 1400, overcast: 0, fog: 22000, rain: 0, snow: 0, wind: 6, gust: 1.5, turb: 0.15, dark: 0.05, lightning: false },
  overcast: { name: 'Cubierto', clouds: 180, cloudBase: 1100, overcast: 1, fog: 11000, rain: 0, snow: 0, wind: 8, gust: 2, turb: 0.25, dark: 0.35, lightning: false },
  rain: { name: 'Lluvia', clouds: 200, cloudBase: 850, overcast: 1, fog: 5500, rain: 0.7, snow: 0, wind: 10, gust: 3, turb: 0.4, dark: 0.5, lightning: false },
  storm: { name: 'Tormenta', clouds: 240, cloudBase: 650, overcast: 1, fog: 3500, rain: 1, snow: 0, wind: 16, gust: 7, turb: 0.9, dark: 0.7, lightning: true },
  fog: { name: 'Niebla', clouds: 40, cloudBase: 600, overcast: 0, fog: 1400, rain: 0, snow: 0, wind: 2, gust: 0.3, turb: 0, dark: 0.15, lightning: false },
  snow: { name: 'Nieve', clouds: 180, cloudBase: 900, overcast: 1, fog: 4000, rain: 0, snow: 1, wind: 7, gust: 2, turb: 0.3, dark: 0.3, lightning: false },
};

const SKY_VS = `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w*0.99999; }`;
const SKY_FS = `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uMoonDir;
uniform float uSunSize; uniform float uNight; uniform float uOvercast;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.55)) : mix(uHorizon, uGround, clamp(-h*6.0,0.0,1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * pow(sd, 8.0) * 0.35 * (1.0-uOvercast*0.8);
  col += uSunCol * pow(sd, 64.0) * 0.6 * (1.0-uOvercast*0.9);
  col += uSunCol * smoothstep(1.0-uSunSize, 1.0-uSunSize*0.6, sd) * 6.0 * (1.0-uOvercast);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.9,0.92,1.0) * smoothstep(0.99955, 0.9997, md) * uNight * (1.0-uOvercast) * 1.4;
  col += vec3(0.4,0.45,0.6) * pow(md, 30.0) * uNight * 0.15;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function cloudGeometry(rnd, big) {
  const parts = [];
  const n = big ? 9 + Math.floor(rnd() * 6) : 5 + Math.floor(rnd() * 4);
  const len = big ? 500 : 260;
  for (let i = 0; i < n; i++) {
    const r = (big ? 90 : 55) * (0.5 + rnd() * 0.8);
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1, 0.55 + rnd() * 0.25, 1);
    const t = i / (n - 1) - 0.5;
    g.translate(t * len + (rnd() - 0.5) * 60, r * 0.25 + (1 - Math.abs(t) * 2) * r * 0.4, (rnd() - 0.5) * len * 0.35);
    parts.push(g);
  }
  // base plana
  const m = mergeGeometries(parts);
  const p = m.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) * 0.25);
  m.computeVertexNormals();
  return m;
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = 12;
    this.weatherKey = 'clear';
    this.w = { ...WEATHER.clear };
    this.target = { ...WEATHER.clear };
    this.night = 0;
    this.wind = new THREE.Vector3();
    this.gustT = 0;
    this.flash = 0;
    this.thunderQueue = [];
    this.onThunder = null;
    this.sunDir = new THREE.Vector3(0, 1, 0);

    // Cielo
    this.skyU = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uMoonDir: { value: new THREE.Vector3() },
      uSunSize: { value: 0.0006 }, uNight: { value: 0 }, uOvercast: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
    this.sky.renderOrder = -1000; this.sky.frustumCulled = false;
    scene.add(this.sky);

    // Estrellas
    const rnd = mulberry32(42);
    const sp = [], sc = [];
    for (let i = 0; i < 2500; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      if (u < -0.05) continue;
      sp.push(r * Math.cos(th) * 900, u * 900, r * Math.sin(th) * 900);
      const b = 0.4 + rnd() * 0.6; sc.push(b, b, b * (0.9 + rnd() * 0.2));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    this.starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: false, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, color: 0x000000, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -999; this.stars.frustumCulled = false;
    scene.add(this.stars);

    // Luces
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc2 = this.sun.shadow.camera;
    sc2.left = -130; sc2.right = 130; sc2.top = 130; sc2.bottom = -130; sc2.near = 1; sc2.far = 800;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.12;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8fe0e6, 0x6a3a78, 1.0);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(this.ambient);

    scene.fog = new THREE.FogExp2(0xb0c4d8, 0.00008);
    this.viewLimit = 9000; // alcance de la malla de terreno: la niebla debe cerrar antes

    // Nubes
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222, flatShading: true });
    this.cloudGeos = [];
    const crnd = mulberry32(7);
    for (let i = 0; i < 5; i++) this.cloudGeos.push(cloudGeometry(crnd, i >= 3));
    this.MAXC = 80;
    this.clouds = this.cloudGeos.map(g => {
      const im = new THREE.InstancedMesh(g, this.cloudMat, this.MAXC);
      im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false;
      scene.add(im);
      return im;
    });
    this.cloudData = [];
    for (let k = 0; k < this.clouds.length; k++) for (let i = 0; i < this.MAXC; i++) {
      this.cloudData.push({ k, i, x: (crnd() - 0.5) * 30000, z: (crnd() - 0.5) * 30000, y: crnd(), s: 0.7 + crnd() * 1.1, r: crnd() * 6.28 });
    }
    this.cloudRange = 30000;
    // capa de cubierto
    this.layerMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8, side: THREE.DoubleSide, transparent: true, opacity: 1, flatShading: true });
    const lg = new THREE.PlaneGeometry(60000, 60000, 60, 60).rotateX(-Math.PI / 2);
    const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) lp.setY(i, (crnd() - 0.5) * 70);
    lg.computeVertexNormals();
    this.layer = new THREE.Mesh(lg, this.layerMat);
    this.layer.frustumCulled = false;
    scene.add(this.layer);
    this.layerTop = new THREE.Mesh(lg, this.layerMat);
    this.layerTop.frustumCulled = false;
    scene.add(this.layerTop);

    // Lluvia / nieve
    this.RN = 6000;
    const rp = new Float32Array(this.RN * 6);
    for (let i = 0; i < this.RN; i++) {
      const x = (Math.random() - 0.5) * 80, y = Math.random() * 60 - 20, z = (Math.random() - 0.5) * 80;
      rp.set([x, y, z, x, y - 0.9, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.0, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    const spn = new Float32Array(this.RN * 3);
    for (let i = 0; i < this.RN; i++) spn.set([(Math.random() - 0.5) * 80, Math.random() * 60 - 20, (Math.random() - 0.5) * 80], i * 3);
    const sng = new THREE.BufferGeometry(); sng.setAttribute('position', new THREE.BufferAttribute(spn, 3));
    this.snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0, depthWrite: false });
    this.snow = new THREE.Points(sng, this.snowMat);
    this.snow.frustumCulled = false;
    scene.add(this.snow);
    this.precipOffset = new THREE.Vector3();

    this.applyWeather(true);
  }

  setTime(h) { this.hour = ((h % 24) + 24) % 24; }
  setWeather(key, instant = false) {
    this.weatherKey = key;
    this.target = { ...WEATHER[key] };
    if (instant) this.applyWeather(true);
  }

  applyWeather(instant) {
    if (instant) this.w = { ...this.target };
    // distribuir alturas de nubes
    const visible = Math.min(this.MAXC * this.clouds.length, Math.round(this.w.clouds));
    this.visibleClouds = visible;
  }

  computeSky() {
    // Posición solar simple: amanecer 6h, ocaso 20h
    const t = (this.hour - 6) / 14;
    const nightPart = this.hour < 6 || this.hour > 20;
    const elev = nightPart ? -Math.sin(((this.hour + 24 - 20) % 24) / 10 * Math.PI) * 40 * Math.PI / 180 : Math.sin(t * Math.PI) * 62 * Math.PI / 180;
    // acimut continuo en las 24 h: el ciclo día/noche no da saltos a medianoche
    const az = Math.PI * 0.25 + (((this.hour - 6 + 24) % 24) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
    const se = this.sunDir.y;
    const day = smoothstep(-0.12, 0.25, se);
    const golden = smoothstep(0.35, 0.02, se) * smoothstep(-0.15, 0.02, se);
    this.night = 1 - smoothstep(-0.2, 0.05, se);
    const oc = this.w.overcast * 0.8 + this.w.dark * 0.4;
    const top = new THREE.Color().setRGB(lerp(0.012, 0.015, day), lerp(0.012, 0.13, day), lerp(0.07, 0.72, day));
    const hor = new THREE.Color().setRGB(lerp(0.035, 0.3, day), lerp(0.03, 0.68, day), lerp(0.1, 0.98, day));
    hor.lerp(new THREE.Color(1.0, 0.36, 0.16), golden * 0.85);
    top.lerp(new THREE.Color(0.3, 0.1, 0.5), golden * 0.55);
    const grey = new THREE.Color().setRGB(lerp(0.03, 0.55, day), lerp(0.035, 0.57, day), lerp(0.045, 0.6, day));
    top.lerp(grey.clone().multiplyScalar(0.85), clamp(oc, 0, 1));
    hor.lerp(grey, clamp(oc, 0, 1));
    const sunCol = new THREE.Color(1, 0.95, 0.85).lerp(new THREE.Color(1, 0.5, 0.2), golden);
    return { top, hor, sunCol, day, golden, se, oc };
  }

  update(dt, camera, focusPos) {
    // transición suave de clima
    const k = Math.min(1, dt * 0.25);
    for (const key of ['clouds', 'cloudBase', 'overcast', 'fog', 'rain', 'snow', 'wind', 'gust', 'turb', 'dark']) {
      this.w[key] = lerp(this.w[key], this.target[key], key === 'clouds' ? Math.min(1, dt * 2) : k);
    }
    this.w.lightning = this.target.lightning;
    this.applyWeather(false);

    const { top, hor, sunCol, day, se, oc } = this.computeSky();
    this.skyU.uTop.value.copy(top);
    this.skyU.uHorizon.value.copy(hor);
    this.skyU.uGround.value.copy(hor).multiplyScalar(0.55);
    this.skyU.uSunDir.value.copy(this.sunDir);
    this.skyU.uSunCol.value.copy(sunCol);
    this.skyU.uMoonDir.value.set(-this.sunDir.x, Math.abs(this.sunDir.y) * 0.8 + 0.2, -this.sunDir.z).normalize();
    this.skyU.uNight.value = this.night;
    this.skyU.uOvercast.value = clamp(this.w.overcast, 0, 1);
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stars.rotation.y = this.hour * 0.26;
    const starB = this.night * (1 - clamp(this.w.overcast, 0, 1)) * (camera.position.y > this.w.cloudBase + 150 && this.w.overcast > 0.5 ? 1 / (1 - clamp(this.w.overcast, 0, 0.999)) : 1);
    this.starMat.color.setScalar(clamp(starB, 0, 1));

    // relámpagos
    if (this.w.lightning && Math.random() < dt * 0.12) {
      this.flash = 1;
      const delay = 0.5 + Math.random() * 4;
      this.thunderQueue.push(delay);
    }
    for (let i = this.thunderQueue.length - 1; i >= 0; i--) {
      this.thunderQueue[i] -= dt;
      if (this.thunderQueue[i] <= 0) { this.thunderQueue.splice(i, 1); this.onThunder && this.onThunder(); }
    }
    this.flash = Math.max(0, this.flash - dt * (Math.random() < 0.3 ? 2 : 6));

    // luces
    const above = camera.position.y > this.w.cloudBase + 120 && this.w.overcast > 0.5;
    const ocL = above ? 0 : oc;
    const sunI = day * 3.2 * (1 - ocL * 0.8);
    const moonI = this.night * 0.35 * (1 - ocL * 0.7);
    if (this.sunDir.y > -0.05) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = sunI;
      this.sun.position.copy(focusPos).addScaledVector(this.sunDir, 400);
    } else {
      this.sun.color.setRGB(0.6, 0.7, 1.0);
      this.sun.intensity = moonI;
      this.sun.position.copy(focusPos).addScaledVector(this.skyU.uMoonDir.value, 400);
    }
    this.sun.target.position.copy(focusPos);
    this.hemi.color.copy(top).lerp(new THREE.Color(0.55, 0.95, 0.9), 0.45);
    this.hemi.groundColor.setRGB(0.36, 0.2, 0.42);
    this.hemi.intensity = lerp(0.12, 1.15, day) * (1 - ocL * 0.25) + this.flash * 4;
    this.ambient.intensity = lerp(0.12, 0.2, day) + this.night * 0.08;
    sharedUniforms.uNight.value = this.night;

    // niebla
    const fogFar = this.w.fog * (above ? 3 : 1);
    this.scene.fog.color.copy(hor).lerp(new THREE.Color(0.5, 0.52, 0.55).multiplyScalar(lerp(0.08, 1, day)), clamp(this.w.overcast * 0.5 + (1 - fogFar / 28000) * 0.4, 0, 1));
    if (this.flash > 0) this.scene.fog.color.lerp(new THREE.Color(0.8, 0.85, 1), this.flash * 0.5);
    this.scene.fog.density = 1.45 / Math.min(fogFar, this.viewLimit * (above ? 2.5 : 1));
    this.skyU.uHorizon.value.lerp(this.scene.fog.color, 0.6);

    // nubes
    const cloudColor = new THREE.Color().setRGB(1, 1, 1).lerp(new THREE.Color(0.45, 0.47, 0.5), clamp(this.w.dark, 0, 1));
    cloudColor.lerp(sunCol, 0.25 * (1 - day + 0.2));
    this.cloudMat.color.copy(cloudColor);
    this.cloudMat.emissive.copy(cloudColor).multiplyScalar(lerp(0.03, 0.25, day) * (1 - this.night * 0.85) + this.flash * 0.6);
    const R = this.cloudRange, half = R / 2;
    const dummy = this._d || (this._d = new THREE.Object3D());
    const counts = new Array(this.clouds.length).fill(0);
    let vis = 0;
    const windOff = this.windDrift || (this.windDrift = new THREE.Vector2());
    windOff.x += this.wind.x * dt; windOff.y += this.wind.z * dt;
    for (const c of this.cloudData) {
      if (vis >= this.visibleClouds) break;
      let x = c.x + windOff.x, z = c.z + windOff.y;
      x = ((x - focusPos.x + half) % R + R) % R - half + focusPos.x;
      z = ((z - focusPos.z + half) % R + R) % R - half + focusPos.z;
      const y = this.w.cloudBase + c.y * (this.w.overcast > 0.5 ? 250 : 900);
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, c.r, 0);
      dummy.scale.setScalar(c.s * (this.w.overcast > 0.5 ? 1.4 : 1));
      dummy.updateMatrix();
      this.clouds[c.k].setMatrixAt(counts[c.k]++, dummy.matrix);
      vis++;
    }
    this.clouds.forEach((im, i) => { im.count = counts[i]; im.instanceMatrix.needsUpdate = true; });
    // capa de cubierto
    const ocv = clamp(this.w.overcast, 0, 1);
    this.layer.visible = this.layerTop.visible = ocv > 0.02;
    this.layerMat.opacity = ocv;
    this.layerMat.transparent = ocv < 0.99;
    this.layerMat.depthWrite = ocv > 0.99;
    this.layerMat.color.copy(cloudColor).multiplyScalar(0.85);
    this.layerMat.emissive = this.layerMat.emissive || new THREE.Color();
    this.layerMat.emissive.copy(cloudColor).multiplyScalar(lerp(0.02, 0.2, day) * (1 - this.night * 0.85) + this.flash * 0.5);
    this.layer.position.set(Math.round(focusPos.x / 1000) * 1000, this.w.cloudBase + 60, Math.round(focusPos.z / 1000) * 1000);
    this.layerTop.position.set(this.layer.position.x, this.w.cloudBase + 260, this.layer.position.z);

    // viento con ráfagas (más fuerte en altura)
    this.gustT += dt;
    const altF = 1 + clamp(focusPos.y / 2000, 0, 1.5);
    const g = Math.sin(this.gustT * 0.7) * 0.5 + Math.sin(this.gustT * 2.3 + 1) * 0.3 + Math.sin(this.gustT * 5.1) * 0.2;
    const sp = (this.w.wind + g * this.w.gust) * altF;
    const dir = 0.8 + Math.sin(this.gustT * 0.05) * 0.3;
    this.wind.set(Math.cos(dir) * sp, Math.sin(this.gustT * 1.7) * this.w.turb * 1.5, Math.sin(dir) * sp);

    // precipitación
    const cam = camera.position;
    const belowClouds = cam.y < this.w.cloudBase + 50;
    const rainA = this.w.rain * (belowClouds ? 1 : 0);
    const snowA = this.w.snow * (belowClouds ? 1 : 0);
    this.rain.visible = rainA > 0.01;
    this.snow.visible = snowA > 0.01;
    this.rainMat.opacity = rainA * 0.45;
    this.rainMat.color.setScalar(lerp(0.25, 0.75, day));
    this.snowMat.opacity = snowA * 0.9;
    if (this.rain.visible) this.animPrecip(this.rain, dt, cam, 24, 2, true);
    if (this.snow.visible) this.animPrecip(this.snow, dt, cam, 2.5, 1, false);
  }

  animPrecip(obj, dt, cam, fall, stride, lines) {
    const p = obj.geometry.attributes.position;
    const a = p.array;
    const wx = this.wind.x * dt, wz = this.wind.z * dt, dy = fall * dt;
    const n = p.count;
    for (let i = 0; i < n; i += stride) {
      const o = i * 3;
      let x = a[o] + wx, y = a[o + 1] - dy, z = a[o + 2] + wz;
      if (!lines) { x += (Math.random() - 0.5) * 0.05; z += (Math.random() - 0.5) * 0.05; }
      // relativo a la cámara (recentrado en cubo de 80 m)
      x = cam.x + ((((x - cam.x) + 40) % 80) + 80) % 80 - 40;
      z = cam.z + ((((z - cam.z) + 40) % 80) + 80) % 80 - 40;
      y = cam.y + ((((y - cam.y) + 30) % 60) + 60) % 60 - 30;
      a[o] = x; a[o + 1] = y; a[o + 2] = z;
      if (lines) {
        // estela inclinada según velocidad relativa
        a[o + 3] = x - this.wind.x * 0.03; a[o + 4] = y - 0.9; a[o + 5] = z - this.wind.z * 0.03;
      }
    }
    p.needsUpdate = true;
  }
}
