// Post-procesado moderno: EffectComposer con oclusión ambiental (SSAO) y UnrealBloom.
// La SSAO reconstruye la posición desde el búfer de profundidad, sin volver a
// dibujar la escena: las normales salen de las facetas y el coste no depende
// del número de objetos, algo clave con un mundo tan grande.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const AO_FS = `
uniform sampler2D tDepth; uniform mat4 uInvProj; uniform float uProjY; uniform vec2 uRes;
varying vec2 vUv;
vec3 viewPos(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  vec4 p = uInvProj * vec4(uv*2.0-1.0, d*2.0-1.0, 1.0);
  return p.xyz/p.w;
}
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }
void main(){
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 > 0.99995) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  float dist = -P.z;
  float fade = 1.0 - smoothstep(150.0, 700.0, dist);
  if (fade <= 0.0) { gl_FragColor = vec4(1.0); return; }
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  float radius = clamp(dist*0.035, 0.8, 9.0);
  float rs = min(radius*uProjY*0.5/max(dist,0.1), 0.06);
  float a = ign(gl_FragCoord.xy)*6.2831853;
  float occ = 0.0;
  const int N_S = 10;
  for (int i=0;i<N_S;i++){
    float t = (float(i)+0.5)/float(N_S);
    float th = a + t*19.3;
    vec2 uv = vUv + vec2(cos(th),sin(th))*rs*sqrt(t)*vec2(uRes.y/uRes.x,1.0);
    vec3 v = viewPos(uv) - P;
    float l2 = dot(v,v);
    occ += max(dot(N,v)-0.02*dist*0.05, 0.0) / (l2 + 0.05*radius*radius) * smoothstep(radius*radius*4.0, 0.0, l2);
  }
  occ *= radius*1.6/float(N_S);
  gl_FragColor = vec4(vec3(1.0 - clamp(occ,0.0,1.0)*fade), 1.0);
}`;

const COMP_FS = `
uniform sampler2D tColor; uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uStrength;
varying vec2 vUv;
void main(){
  float d0 = texture2D(tDepth, vUv).x, sum = 0.0, wt = 0.0;
  for (int j=-1;j<=2;j++) for (int i=-1;i<=2;i++){
    vec2 o = (vec2(float(i),float(j))-0.5)*uTexel;
    float w = 1.0/(1.0 + 4000.0*abs(texture2D(tDepth, vUv+o).x - d0)/max(1.0-d0,1e-5));
    sum += texture2D(tAO, vUv+o).r*w; wt += w;
  }
  float ao = sum/max(wt,1e-4);
  vec4 c = texture2D(tColor, vUv);
  // sombra de contacto ligeramente púrpura: da peso sin ensuciar los colores
  c.rgb *= mix(vec3(0.42,0.34,0.5), vec3(1.0), mix(1.0, ao, uStrength));
  gl_FragColor = c;
}`;

class ScenePass extends Pass {
  constructor() { super(); this.needsSwap = false; this.scene = null; this.camera = null; }
  render(renderer, _w, readBuffer) {
    renderer.setRenderTarget(readBuffer);
    renderer.clear();
    this.camera.layers.set(0);
    renderer.render(this.scene, this.camera);
  }
}

class AOPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: AO_FS, depthTest: false, depthWrite: false,
      uniforms: { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProjY: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) } },
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false,
      uniforms: { tColor: { value: null }, tAO: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uStrength: { value: 0.85 } },
    });
    this.quad = new FullScreenQuad(this.aoMat);
    this.camera = null;
  }
  setSize(w, h) {
    const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
    this.rt.setSize(hw, hh);
    this.aoMat.uniforms.uRes.value.set(hw, hh);
    this.compMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.aoMat.uniforms;
    u.tDepth.value = readBuffer.depthTexture;
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uProjY.value = this.camera.projectionMatrix.elements[5];
    this.quad.material = this.aoMat;
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    const c = this.compMat.uniforms;
    c.tColor.value = readBuffer.texture; c.tAO.value = this.rt.texture; c.tDepth.value = readBuffer.depthTexture;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(writeBuffer);
    this.quad.render(renderer);
  }
}

// Monitor CRT: curvatura de tubo, líneas de barrido, máscara de fósforo RGB,
// aberración cromática en los bordes, viñeta y un leve parpadeo. Va después de
// OutputPass, así que trabaja ya en sRGB y escribe tal cual en pantalla.
export const CRT_CURVE = [0.03, 0.04];
const CRT_FS = `
uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uPR; uniform float uTime; uniform vec2 uCurve;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 q = vUv*2.0-1.0;
  q += q*(q.yx*q.yx)*uCurve;
  vec2 uv = q*0.5+0.5;
  // bordes del tubo redondeados y suavizados
  vec2 e = min(uv, 1.0-uv)*uRes/uPR;
  float edge = smoothstep(0.0, 2.5, min(e.x, e.y));
  if (edge <= 0.0) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
  vec2 d = uv-0.5;
  vec2 ca = d*(0.0015 + dot(d,d)*0.006);
  vec3 c = vec3(texture2D(tDiffuse, uv-ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv+ca).b);
  // barrido cada 3 px de CSS; en las zonas brillantes el haz "engorda" y la línea se nota menos
  float l = dot(c, vec3(0.299,0.587,0.114));
  float s = 0.5+0.5*cos(uv.y*uRes.y/uPR*2.0943951);
  c *= mix(mix(0.68, 0.9, l), 1.0, s);
  // máscara de fósforo en tríadas verticales de píxeles reales
  float m = mod(floor(gl_FragCoord.x), 3.0);
  vec3 mask = vec3(m < 0.5 ? 1.08 : 0.94, m > 0.5 && m < 1.5 ? 1.08 : 0.94, m > 1.5 ? 1.08 : 0.94);
  c *= mask;
  float vig = pow(16.0*uv.x*uv.y*(1.0-uv.x)*(1.0-uv.y), 0.16);
  c *= vig*1.14*(1.0 + 0.012*sin(uTime*95.0));
  c += (hash(gl_FragCoord.xy + fract(uTime)*91.0)-0.5)*0.025;
  gl_FragColor = vec4(c*edge, 1.0);
}`;

class CRTPass extends Pass {
  constructor() {
    super();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: CRT_FS, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uPR: { value: 1 }, uTime: { value: 0 }, uCurve: { value: new THREE.Vector2(...CRT_CURVE) } },
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w, h) { this.mat.uniforms.uRes.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    this.mat.uniforms.uTime.value = performance.now() / 1000;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

// Visión nocturna del visor del casco (antes del CRT, ya en sRGB).
// Modo 1: intensificador de luz verde con ganancia automática (más de noche),
// grano y tubo circular. Modo 2: térmica en blanco caliente: lo frío (cielo,
// agua) se oscurece y los blancos, que llevan emisivo blanco en este modo, saturan.
const NIGHT_FS = `
uniform sampler2D tDiffuse; uniform float uMode; uniform float uGain; uniform float uTime; uniform vec2 uRes;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.299,0.587,0.114));
  float n = hash(gl_FragCoord.xy + fract(uTime*7.0)*vec2(113.0,71.0)) - 0.5;
  vec2 d = vUv - 0.5; d.x *= uRes.x / uRes.y;
  vec3 o;
  if (uMode < 1.5) {
    float v = 1.0 - exp(-l * uGain) + n * 0.08;
    o = vec3(0.32, 1.0, 0.42) * v * mix(0.12, 1.0, smoothstep(0.78, 0.42, length(d)));
  } else {
    float cold = clamp((c.b - max(c.r, c.g)) * 6.0, 0.0, 1.0);
    float v = (0.1 + 0.48 * l) * (1.0 - 0.8 * cold);
    v = mix(v, 1.0, smoothstep(0.78, 0.95, min(c.r, min(c.g, c.b)))) + n * 0.035;
    o = vec3(v) * mix(0.55, 1.0, smoothstep(0.95, 0.4, length(d)));
  }
  gl_FragColor = vec4(o, 1.0);
}`;

class NightPass extends Pass {
  constructor() {
    super();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: NIGHT_FS, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uMode: { value: 1 }, uGain: { value: 4 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w, h) { this.mat.uniforms.uRes.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    this.mat.uniforms.uTime.value = performance.now() / 1000;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

// Interior de cabina: segunda pasada con plano cercano propio, encima del mundo
class CockpitPass extends Pass {
  constructor() { super(); this.needsSwap = false; this.scene = null; this.camera = null; }
  render(renderer, _w, readBuffer) {
    if (!this.scene) return;
    drawCockpit(renderer, this.scene, this.camera, readBuffer);
  }
}

function drawCockpit(renderer, scene, camera, target) {
  const cam = camera, n = cam.near, f = cam.far, auto = renderer.autoClear;
  renderer.setRenderTarget(target);
  renderer.autoClear = false;
  renderer.clearDepth();
  cam.near = 0.02; cam.far = 60; cam.updateProjectionMatrix();
  cam.layers.set(1);
  renderer.render(scene, cam);
  cam.near = n; cam.far = f; cam.updateProjectionMatrix();
  cam.layers.set(0);
  renderer.autoClear = auto;
}

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples || 0),
      depthTexture: new THREE.DepthTexture(4, 4, THREE.UnsignedIntType),
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    this.sceneP = new ScenePass();
    this.ao = new AOPass();
    this.cockpit = new CockpitPass();
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 1.0);
    this.output = new OutputPass();
    this.nightP = new NightPass();
    this.nightP.enabled = false;
    this.crtP = new CRTPass();
    this.crtP.enabled = false;
    this.crtP.mat.uniforms.uPR.value = pr;
    for (const p of [this.sceneP, this.ao, this.cockpit, this.bloom, this.output, this.nightP, this.crtP]) this.composer.addPass(p);
    this.quality = 'medium';
    this.enabled = true;
  }

  // en calidad baja no hay composer, salvo que el CRT o la visión nocturna lo necesiten (sin bloom ni SSAO)
  setQuality(q) {
    this.quality = q;
    const low = q === 'low';
    this.enabled = !low || this.crtP.enabled || this.nightP.enabled;
    this.ao.enabled = !low;
    this.bloom.enabled = !low;
    this.bloom.strength = q === 'high' ? 0.5 : 0.42;
  }

  set crt(on) { this.crtP.enabled = on; this.setQuality(this.quality); }
  get crt() { return this.crtP.enabled; }

  // visión nocturna: 0 apagada, 1 verde, 2 térmica; gain sube la ganancia del intensificador
  setNight(mode, gain = 4) {
    const on = mode > 0;
    this.nightP.mat.uniforms.uMode.value = mode;
    this.nightP.mat.uniforms.uGain.value = gain;
    if (on !== this.nightP.enabled) { this.nightP.enabled = on; this.setQuality(this.quality); }
  }

  resize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.crtP.mat.uniforms.uPR.value = this.renderer.getPixelRatio();
  }

  render(scene, camera, withCockpit = false) {
    const r = this.renderer;
    if (!this.enabled) {
      camera.layers.set(0);
      r.setRenderTarget(null);
      r.render(scene, camera);
      if (withCockpit) drawCockpit(r, scene, camera, null);
      return;
    }
    this.sceneP.scene = scene; this.sceneP.camera = camera;
    this.ao.camera = camera;
    this.cockpit.scene = withCockpit ? scene : null; this.cockpit.camera = camera;
    this.composer.render();
  }
}
