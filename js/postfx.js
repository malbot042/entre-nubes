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
    for (const p of [this.sceneP, this.ao, this.cockpit, this.bloom, this.output]) this.composer.addPass(p);
    this.enabled = true;
  }

  setQuality(q) {
    this.enabled = q !== 'low';
    this.ao.enabled = q === 'high' || q === 'medium';
    this.bloom.strength = q === 'high' ? 0.5 : 0.42;
  }

  resize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
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
