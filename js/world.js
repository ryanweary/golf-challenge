// Three.js scene: sky, terrain, water, trees, grass, flags, ball, tracer, aim preview.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAY, SURF, WATER_Y, YD, TREE_SHAPE } from './terrain.js';
import { makeNoise2D, mulberry32, clamp, smoothstep } from './noise.js';
import { BALL_R } from './physics.js';

const nV = makeNoise2D(71), nV2 = makeNoise2D(83), nV3 = makeNoise2D(97);
export const SUN_DIR = new THREE.Vector3(-0.2067, 0.1080, -0.9724).normalize();
const FOG_COLOR = new THREE.Color(0xcfb49c);

export const QUALITY = [
  { name: 'Low', dpr: 0.85, shadow: 0, grass: 0.0, far: 0.4, tex: 768 },
  { name: 'Medium', dpr: 1.25, shadow: 1024, grass: 0.35, far: 0.65, tex: 768 },
  { name: 'High', dpr: 1.6, shadow: 1024, grass: 0.7, far: 0.85, tex: 1024 },
  { name: 'Ultra', dpr: 2.0, shadow: 2048, grass: 1.0, far: 1.0, tex: 1024 },
];

// ------------------------------------------------------------ procedural textures
function periodicValueNoise(size, cells, seed) {
  const r = mulberry32(seed), g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * cells, fy = y / size * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(iy % cells) * cells + ix % cells], b = g[(iy % cells) * cells + (ix + 1) % cells];
    const c = g[((iy + 1) % cells) * cells + ix % cells], d = g[((iy + 1) % cells) * cells + (ix + 1) % cells];
    out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return out;
}
function makeDetailTexture() {
  const S = 256, a = periodicValueNoise(S, 64, 3), b = periodicValueNoise(S, 16, 5), c = periodicValueNoise(S, 128, 9), d = periodicValueNoise(S, 8, 13);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = clamp((a[i] * 0.5 + c[i] * 0.5) * 255, 0, 255);
    data[i * 4 + 1] = clamp((b[i] * 0.6 + d[i] * 0.4) * 255, 0, 255);
    data[i * 4 + 2] = clamp(c[i] * 255, 0, 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
function makeWaterNormals() {
  const S = 256, h = new Float32Array(S * S), r = mulberry32(21);
  const waves = [];
  for (let k = 0; k < 64; k++) {
    let fx = 0, fy = 0; while (fx === 0 && fy === 0) { fx = Math.round((r() * 2 - 1) * 14); fy = Math.round((r() * 2 - 1) * 14); }
    const kk = Math.hypot(fx, fy); waves.push([fx, fy, r() * 6.28, 1 / Math.pow(kk, 1.35)]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0; for (const [fx, fy, ph, amp] of waves) v += Math.sin((fx * x + fy * y) / S * Math.PI * 2 + ph) * amp;
    h[y * S + x] = v * 6;
  }
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S];
    const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    const nx = -dx * 0.35, ny = -dy * 0.35, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * S + x) * 4;
    data[i] = (nx / l * 0.5 + 0.5) * 255; data[i + 1] = (ny / l * 0.5 + 0.5) * 255; data[i + 2] = (nz / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
  return t;
}
function makeBillboardTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d'); const r = mulberry32(4);
  const drawPine = (cx, w, hgt) => {
    g.fillStyle = '#3b2a1c'; g.fillRect(cx - 3, 250 - hgt * 0.2, 6, hgt * 0.2);
    for (let i = 0; i < 60; i++) {
      const t = r(), y = 250 - hgt * (0.15 + t * 0.85), half = w * (1 - t) * (0.6 + r() * 0.5);
      const l = 22 + r() * 20; g.fillStyle = `hsl(${105 + r() * 25},${30 + r() * 15}%,${l * (0.6 + t * 0.6)}%)`;
      g.beginPath(); g.moveTo(cx - half, y + 10); g.lineTo(cx + half, y + 10); g.lineTo(cx + (r() - 0.5) * 6, y - 18); g.fill();
    }
  };
  const drawBroad = (cx, w, hgt) => {
    g.fillStyle = '#3d2b1d'; g.fillRect(cx - 4, 250 - hgt * 0.45, 8, hgt * 0.45);
    for (let i = 0; i < 70; i++) {
      const a = r() * 6.28, rr = Math.sqrt(r());
      const x = cx + Math.cos(a) * rr * w * 0.8, y = 250 - hgt * 0.62 + Math.sin(a) * rr * hgt * 0.32;
      const lit = 0.55 + 0.45 * (1 - (y - (250 - hgt)) / hgt) + (x < cx ? 0.1 : -0.1);
      g.fillStyle = `hsl(${88 + r() * 30},${32 + r() * 18}%,${(18 + r() * 12) * lit + 6}%)`;
      g.beginPath(); g.arc(x, y, 10 + r() * 14, 0, 6.28); g.fill();
    }
  };
  g.save(); g.beginPath(); g.rect(0, 0, 128, 256); g.clip(); drawPine(64, 50, 240); g.restore();
  g.save(); g.beginPath(); g.rect(128, 0, 128, 256); g.clip(); drawBroad(192, 58, 220); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.8)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeSignTexture(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#f4efe2'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#1f5a2e'; g.fillRect(8, 8, 240, 112);
  g.fillStyle = '#fff'; g.font = 'bold 72px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function jitterGeo(geo, amt, seed) {
  const n = makeNoise2D(seed), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amt * n(x * 9 + y * 3, z * 9 - y * 5);
    p.setXYZ(i, x * k, y + amt * 0.3 * n(y * 7, x * 7 + z * 7) * 0.2, z * k);
  }
  geo.computeVertexNormals(); return geo;
}
function colorGeo(geo, fn) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}
const ni = g => (g.index ? g.toNonIndexed() : g);

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.42;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxAniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00062);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 9000);
    this.time = 0; this.q = 3;
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
    this.detailTex = makeDetailTexture();
    this.buildSky();
    this.buildLights();
    this.buildMountains();
    this.buildStaticMaterials();
    this.buildBall();
    this.buildTracer();
    this.buildAimPreview();
    this.courseGroup = new THREE.Group(); scene.add(this.courseGroup);
    this.flags = []; this.labels = [];
    this.resize();
  }

  // ---------------------------------------------------------- sky + light
  buildSky() {
    const tint = m => { m.fragmentShader = m.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', `
      float hz = pow(1.0 - clamp(direction.y, 0.0, 1.0), 3.0);
      float sunAmt = pow(max(dot(direction, vSunDirection), 0.0), 3.0);
      retColor *= mix(vec3(0.82, 0.88, 1.06), vec3(1.32, 0.95, 0.66), clamp(hz * 0.85 + sunAmt * 0.5, 0.0, 1.0));
      gl_FragColor = vec4( retColor, 1.0 );`); };
    const sky = this.sky = new Sky(); sky.scale.setScalar(8000); tint(sky.material);
    const u = sky.material.uniforms;
    u.turbidity.value = 8; u.rayleigh.value = 3.0; u.mieCoefficient.value = 0.007; u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(SUN_DIR);
    this.scene.add(sky);
    // environment from sky
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene(); const s2 = new Sky(); s2.scale.setScalar(1000); tint(s2.material);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = u[k].value;
    s2.material.uniforms.sunPosition.value.copy(SUN_DIR);
    envScene.add(s2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a5a2c }));
    ground.position.y = -5; envScene.add(ground);
    this.envRT = pm.fromScene(envScene, 0.02, 0.1, 3000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.85;
    pm.dispose();
  }
  buildLights() {
    const sun = this.sun = new THREE.DirectionalLight(0xffb070, 4.2);
    sun.castShadow = true;
    const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 900;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
    this.scene.add(sun); this.scene.add(sun.target);
    this.hemi = new THREE.HemisphereLight(0xb7c4e0, 0x4a5a2a, 0.65); this.scene.add(this.hemi);
    this.shadowFocus = new THREE.Vector3();
  }
  setShadowFocus(p) {
    this.shadowFocus.copy(p);
    const snap = 140 / (this.sun.shadow.mapSize.x || 1024) * 2;
    const f = this.shadowFocus; f.x = Math.round(f.x / snap) * snap; f.z = Math.round(f.z / snap) * snap;
    this.sun.target.position.copy(f); this.sun.position.copy(f).addScaledVector(SUN_DIR, 400);
    this.sun.target.updateMatrixWorld();
  }
  buildMountains() {
    const segA = 520, segR = 40, geo = new THREE.BufferGeometry(), pos = [], col = [], idx = [];
    const nm = makeNoise2D(5), nm2 = makeNoise2D(6), c = new THREE.Color();
    const ridge = (x, y) => { let v = 0, a = 1, f = 1; for (let o = 0; o < 5; o++) { const n = 1 - Math.abs(nm(x * f, y * f)); v += n * n * a; a *= 0.5; f *= 2.1; } return v / 1.9; };
    for (let j = 0; j <= segR; j++) {
      const tR = j / segR, rr = 2500 + tR * 3600;
      for (let i = 0; i <= segA; i++) {
        const a = i / segA * Math.PI * 2, x = Math.cos(a) * rr, z = Math.sin(a) * rr - 300;
        const ca = x / 1100, sa = z / 1100;
        const big = 0.5 + 0.5 * nm2(Math.cos(a) * 1.5, Math.sin(a) * 1.5);
        let h = ridge(ca, sa) * 1900 * big * Math.pow(Math.sin(tR * Math.PI), 0.6) + 40;
        if (j === 0 || j === segR) h = -40;
        pos.push(x, h, z);
        const t = clamp(h / 1400, 0, 1);
        c.setRGB(0.30 + t * 0.12, 0.33 + t * 0.1, 0.36 + t * 0.14); col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < segR; j++) for (let i = 0; i < segA; i++) {
      const a = j * (segA + 1) + i, b = a + 1, cc = a + segA + 1, d = cc + 1; idx.push(a, cc, b, b, cc, d);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    m.material.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
        float fd = 1.0 - exp(-vFogDepth * vFogDepth * fogDensity * fogDensity * 0.35);
        vec3 haze = mix(vec3(0.62, 0.6, 0.72), fogColor, 0.35);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, clamp(0.12 + fd, 0.0, 0.88));`);
    };
    this.scene.add(m);
  }
  buildStaticMaterials() {
    const U = this.uniforms, detail = this.detailTex;
    this.terrainMat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, vertexColors: true });
    this.terrainMat.onBeforeCompile = sh => {
      sh.uniforms.detailMap = { value: detail };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vWPos;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 d1 = texture2D(detailMap, vWPos.xz * 0.31);
          vec4 d2 = texture2D(detailMap, vWPos.xz * 0.037 + 0.3);
          vec4 d3 = texture2D(detailMap, vWPos.xz * 1.7);
          float camD = length(vWPos - cameraPosition);
          float fine = mix(0.7 + 0.6 * d3.r, 1.0, smoothstep(6.0, 40.0, camD));
          diffuseColor.rgb *= (0.86 + 0.28 * d1.r) * (0.93 + 0.14 * d2.g) * fine;`);
    };
    this.waterNormals = makeWaterNormals();
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x0a3a44, roughness: 0.05, metalness: 0.0, normalMap: this.waterNormals, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 1.7 });
    this.waterMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = U.uTime;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
          vec3 mapN = texture2D( normalMap, vNormalMapUv + vec2(uTime * 0.011, uTime * 0.007) ).xyz * 2.0 - 1.0;
          vec3 mapN2 = texture2D( normalMap, mat2(0.8, -0.6, 0.6, 0.8) * vNormalMapUv * 2.7 + vec2(-uTime * 0.013, uTime * 0.021) ).xyz * 2.0 - 1.0;
          mapN = normalize(vec3(mapN.xy + mapN2.xy * 0.7, 1.0));`);
    };
    // trees
    const pine = [
      [0.27, 0.46, 0.16], [0.215, 0.4, 0.38], [0.15, 0.36, 0.64],
    ].map(([rad, h, y0], k) => ni(new THREE.ConeGeometry(rad, h, 9, 2).translate(0, y0 + h / 2, 0)));
    let pg = mergeGeometries(pine); pg = jitterGeo(pg, 0.12, 3);
    colorGeo(pg, (x, y, z, c) => { const t = clamp(y, 0, 1); c.setRGB(0.10 + t * 0.12, 0.2 + t * 0.16, 0.09 + t * 0.06); });
    const blobs = [[0, 0.64, 0, 0.27], [0.15, 0.58, 0.05, 0.18], [-0.14, 0.6, -0.06, 0.19], [0.03, 0.8, 0.02, 0.19], [0.02, 0.52, 0.16, 0.17], [-0.04, 0.55, -0.16, 0.17]];
    let bg = mergeGeometries(blobs.map(([x, y, z, rr], k) => ni(new THREE.IcosahedronGeometry(rr, k < 2 ? 1 : 0)).translate(x, y, z)));
    bg = jitterGeo(bg, 0.16, 7);
    colorGeo(bg, (x, y, z, c) => { const t = clamp((y - 0.35) / 0.6, 0, 1); c.setRGB(0.16 + t * 0.2, 0.26 + t * 0.2, 0.08 + t * 0.06); });
    let pp = ni(new THREE.IcosahedronGeometry(1, 1)).scale(0.14, 0.45, 0.14).translate(0, 0.56, 0);
    pp = jitterGeo(pp, 0.12, 11);
    colorGeo(pp, (x, y, z, c) => { const t = clamp(y, 0, 1); c.setRGB(0.12 + t * 0.14, 0.22 + t * 0.18, 0.08 + t * 0.05); });
    const trunk = new THREE.CylinderGeometry(0.6, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.95 });
    const MAXT = 1700;
    this.treeMeshes = [pg, bg, pp].map(g => { const m = new THREE.InstancedMesh(g, leafMat, MAXT); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0; return m; });
    this.trunkMesh = new THREE.InstancedMesh(trunk, barkMat, MAXT * 2); this.trunkMesh.castShadow = true; this.trunkMesh.frustumCulled = false; this.trunkMesh.count = 0;
    for (const m of [...this.treeMeshes, this.trunkMesh]) this.scene.add(m);
    // far billboards
    const q1 = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), q2 = q1.clone().rotateY(Math.PI / 2);
    const bb = mergeGeometries([q1, q2]);
    this.bbMatPine = new THREE.MeshLambertMaterial({ map: makeBillboardTexture(), alphaTest: 0.45, side: THREE.DoubleSide });
    this.bbGeoPine = bb.clone(); this.bbGeoBroad = bb.clone();
    const setUV = (g, u0) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5); };
    setUV(this.bbGeoPine, 0); setUV(this.bbGeoBroad, 0.5);
    this.billboards = [this.bbGeoPine, this.bbGeoBroad].map(g => { const m = new THREE.InstancedMesh(g, this.bbMatPine, 2400); m.frustumCulled = false; m.count = 0; this.scene.add(m); return m; });
    // grass tufts
    const blades = [], r = mulberry32(9);
    for (let b = 0; b < 9; b++) {
      const a = r() * 6.28, off = r() * 0.08, w = 0.012 + r() * 0.01, h = 0.07 + r() * 0.13, lean = (r() - 0.5) * 0.1;
      const cx = Math.cos(a) * off, cz = Math.sin(a) * off, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      blades.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
    const nrm = []; for (let i = 0; i < blades.length / 3; i++) nrm.push(0, 1, 0);
    tg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    colorGeo(tg, (x, y, z, c) => { const t = clamp(y / 0.3, 0, 1); c.setRGB(0.16 + t * 0.34, 0.24 + t * 0.36, 0.07 + t * 0.12); });
    const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    gm.onBeforeCompile = sh => {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sw = sin(uTime * 1.9 + ip.x * 0.31 + ip.z * 0.23) * 0.6 + sin(uTime * 3.7 + ip.x * 1.1) * 0.25;
          transformed.x += sw * position.y * 0.35 * uWind; transformed.z += sw * position.y * 0.18 * uWind;`);
    };
    this.grass = new THREE.InstancedMesh(tg, gm, 9000); this.grass.receiveShadow = true; this.grass.frustumCulled = false; this.grass.count = 0;
    this.scene.add(this.grass);
    this.glowTex = makeGlowTexture();
  }

  // ---------------------------------------------------------- ball / tracer / aim
  buildBall() {
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0, emissive: 0x222222 }));
    this.ball.castShadow = true; this.scene.add(this.ball);
    this.ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xfff1d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.scene.add(this.ballGlow);
    this.tee = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0025, 0.055, 8).translate(0, -0.0275, 0), new THREE.MeshStandardMaterial({ color: 0xf0c040, roughness: 0.6 }));
    this.tee.castShadow = true; this.scene.add(this.tee);
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, map: this.glowTex, alphaMap: this.glowTex }));
    this.blob.renderOrder = 2; this.scene.add(this.blob);
    // landing marker
    const ring = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);
    this.landMark = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.landMark.visible = false; this.scene.add(this.landMark);
    // tee markers & range balls
    const mk = new THREE.MeshStandardMaterial({ color: 0xc8352e, roughness: 0.4 });
    this.teeMarkers = [-3.8, 3.8].map(x => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 10), mk); m.castShadow = true; this.scene.add(m); m.userData.x = x; return m; });
    const rb = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_R, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.4 }), 30);
    rb.castShadow = true; this.rangeBalls = rb; this.scene.add(rb);
  }
  buildTracer() {
    const N = this.trN = 600;
    const g = new THREE.BufferGeometry();
    this.trPos = new Float32Array(N * 2 * 3); this.trA = new Float32Array(N * 2 * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT', new THREE.BufferAttribute(this.trA, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.trGeo = g; g.setDrawRange(0, 0);
    this.trMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uFade: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.72, 0.32) } },
      vertexShader: `attribute vec2 aT; varying vec2 vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uFade; uniform vec3 uColor; varying vec2 vT;
        void main(){ float edge = 1.0 - abs(vT.y); float core = pow(edge, 3.0); float a = (0.25 + 0.75 * vT.x) * uFade;
          vec3 c = mix(uColor, vec3(1.0, 0.97, 0.9), core);
          gl_FragColor = vec4(c * (edge * edge * 1.6) * a, 1.0); }`,
    });
    this.tracer = new THREE.Mesh(g, this.trMat); this.tracer.frustumCulled = false; this.tracer.renderOrder = 5;
    this.scene.add(this.tracer);
    this.trPts = [];
  }
  setTracer(points, fade = 1) { this.trPts = points; this.trMat.uniforms.uFade.value = fade; }
  updateTracer() {
    const P = this.trPts, n = Math.min(P.length, this.trN), cam = this.camera.position;
    if (n < 2) { this.trGeo.setDrawRange(0, 0); return; }
    const off = P.length - n;
    const t = new THREE.Vector3(), v = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = P[off + i], q = P[off + Math.min(n - 1, i + 1)], o = P[off + Math.max(0, i - 1)];
      t.set(q.x - o.x, q.y - o.y, q.z - o.z).normalize();
      v.set(cam.x - p.x, cam.y - p.y, cam.z - p.z); const d = v.length(); v.divideScalar(d || 1);
      s.crossVectors(t, v).normalize();
      const w = clamp(d * 0.0045, 0.025, 2.2) * (0.35 + 0.65 * (i / (n - 1)));
      const k = i * 6;
      this.trPos[k] = p.x + s.x * w; this.trPos[k + 1] = p.y + s.y * w; this.trPos[k + 2] = p.z + s.z * w;
      this.trPos[k + 3] = p.x - s.x * w; this.trPos[k + 4] = p.y - s.y * w; this.trPos[k + 5] = p.z - s.z * w;
      const a = i / (n - 1); this.trA[i * 4] = a; this.trA[i * 4 + 1] = 1; this.trA[i * 4 + 2] = a; this.trA[i * 4 + 3] = -1;
    }
    this.trGeo.attributes.position.needsUpdate = true; this.trGeo.attributes.aT.needsUpdate = true;
    this.trGeo.setDrawRange(0, (n - 1) * 6);
  }
  buildAimPreview() {
    const N = 64; this.aimN = N;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const uv = new Float32Array(N * 2 * 2); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    this.aimMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: this.uniforms.uTime, uLen: { value: 100 }, uCharge: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uLen; uniform float uCharge; varying vec2 vUv;
        void main(){ float d = vUv.x * uLen; float dash = step(0.45, fract(d / 3.0 - uTime * 0.9));
          float edge = 1.0 - abs(vUv.y * 2.0 - 1.0); float fade = smoothstep(0.0, 0.04, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x) * 0.6);
          vec3 c = mix(vec3(1.0), vec3(1.0, 0.85, 0.35), uCharge);
          gl_FragColor = vec4(c, dash * smoothstep(0.0, 0.5, edge) * fade * 0.85); }`,
    });
    this.aimLine = new THREE.Mesh(g, this.aimMat); this.aimLine.frustumCulled = false; this.aimLine.renderOrder = 3; this.scene.add(this.aimLine);
    // landing zone: draped ellipse
    const M = 56, zg = new THREE.BufferGeometry();
    zg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((M + 1) * 2 * 3), 3));
    const zuv = new Float32Array((M + 1) * 2 * 2); for (let i = 0; i <= M; i++) { zuv[i * 4] = i / M; zuv[i * 4 + 1] = 0; zuv[i * 4 + 2] = i / M; zuv[i * 4 + 3] = 1; }
    zg.setAttribute('uv', new THREE.BufferAttribute(zuv, 2));
    const zi = []; for (let i = 0; i < M; i++) { const a = i * 2; zi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } zg.setIndex(zi);
    this.zoneN = M;
    this.zoneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: { uTime: this.uniforms.uTime, uCharge: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uCharge; varying vec2 vUv; void main(){
        float e = 1.0 - abs(vUv.y * 2.0 - 1.0); float pulse = 0.65 + 0.35 * sin(uTime * 5.0);
        vec3 c = mix(vec3(1.0), vec3(1.0, 0.82, 0.3), uCharge); gl_FragColor = vec4(c, e * pulse); }`,
    });
    this.zone = new THREE.Mesh(zg, this.zoneMat); this.zone.frustumCulled = false; this.zone.renderOrder = 3; this.scene.add(this.zone);
    this.zoneDot = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    this.zoneDot.renderOrder = 3; this.scene.add(this.zoneDot);
    this.beaconMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
      uniforms: { uTime: this.uniforms.uTime, uCharge: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uCharge; varying vec2 vUv; void main(){
        float a = pow(1.0 - vUv.y, 1.6) * (0.55 + 0.25 * sin(uTime * 4.0)); vec3 c = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.8, 0.3), uCharge);
        gl_FragColor = vec4(c * a, 1.0); }`,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0), this.beaconMat);
    this.beacon.frustumCulled = false; this.beacon.renderOrder = 4; this.scene.add(this.beacon);
  }
  /** start {x,z}, aim rad, carry m, charge 0..1 */
  setAimPreview(start, aim, carry, charge, visible = true) {
    this.aimLine.visible = this.zone.visible = this.zoneDot.visible = this.beacon.visible = visible;
    if (!visible || !this.course) return;
    const C = this.course, N = this.aimN, fx = Math.sin(aim), fz = -Math.cos(aim), rx = Math.cos(aim), rz = Math.sin(aim);
    const len = Math.max(8, carry - 4), p = this.aimLine.geometry.attributes.position, uv = this.aimLine.geometry.attributes.uv;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), d = 2.2 + t * len, x = start.x + fx * d, z = start.z + fz * d;
      const w = 0.035 + d * 0.0035;
      for (let s = 0; s < 2; s++) {
        const sx = x + rx * w * (s ? 1 : -1), sz = z + rz * w * (s ? 1 : -1);
        p.setXYZ(i * 2 + s, sx, C.heightAt(sx, sz) + 0.05 + d * 0.0006, sz); uv.setXY(i * 2 + s, t, s);
      }
    }
    p.needsUpdate = true; uv.needsUpdate = true; this.aimMat.uniforms.uLen.value = len; this.aimMat.uniforms.uCharge.value = charge;
    const cx = start.x + fx * carry, cz = start.z + fz * carry, M = this.zoneN, zp = this.zone.geometry.attributes.position;
    const ra = 3.2 + carry * 0.03, rb = 5 + carry * 0.05, th = 0.6 + carry * 0.009;
    for (let i = 0; i <= M; i++) {
      const a = i / M * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let s = 0; s < 2; s++) {
        const k = s ? 1 : 1 - th / ra;
        const lx = ca * ra * k, lz = sa * rb * (s ? 1 : 1 - th / rb);
        const x = cx + rx * lx + fx * lz, z = cz + rz * lx + fz * lz;
        zp.setXYZ(i * 2 + s, x, C.heightAt(x, z) + 0.12, z);
      }
    }
    zp.needsUpdate = true; this.zoneMat.uniforms.uCharge.value = charge;
    this.zoneDot.position.set(cx, C.heightAt(cx, cz) + 0.1, cz);
    this.beacon.position.copy(this.zoneDot.position); const bw = 0.25 + carry * 0.006; this.beacon.scale.set(bw, 6 + carry * 0.04, bw);
    this.beaconMat.uniforms.uCharge.value = charge; this.zoneCenter = this.zoneDot.position;
  }

  // ---------------------------------------------------------- course build
  buildCourse(course, q) {
    this.course = course;
    const L = course.L;
    // clear old
    for (const c of [...this.courseGroup.children]) { this.courseGroup.remove(c); c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== this.terrainMat && o.material !== this.waterMat) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
    this.flags = []; this.labels = []; this.targetRings = [];
    this.buildTerrain(course, q);
    // water
    for (const lk of L.lakes) {
      const w = lk.rx * 2.9, h = lk.rz * 2.9;
      const g = new THREE.PlaneGeometry(w, h, 1, 1).rotateX(-Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 24, uv.getY(i) * h / 24);
      const m = new THREE.Mesh(g, this.waterMat); m.position.set(lk.x, WATER_Y, lk.z); m.receiveShadow = true;
      this.courseGroup.add(m);
    }
    this.placeTrees(course, q);
    this.placeGrass(course);
    // flags / greens
    const pole = new THREE.CylinderGeometry(0.018, 0.018, 2.6, 6).translate(0, 1.3, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const cupMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const g of L.greens) {
      const grp = new THREE.Group(); const y = course.heightAt(g.pinX, g.pinZ);
      grp.position.set(g.pinX, y, g.pinZ);
      const pm = new THREE.Mesh(pole, poleMat); pm.castShadow = true; grp.add(pm);
      const cloth = new THREE.PlaneGeometry(0.75, 0.48, 10, 4).translate(0.375, 0, 0);
      const col = g.target ? 0xffd23a : g.deco ? 0x3b7bd9 : 0xe8433a;
      const fm = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, side: THREE.DoubleSide, emissive: col, emissiveIntensity: 0.15 }));
      fm.position.y = 2.33; fm.castShadow = true; grp.add(fm);
      fm.userData.base = Float32Array.from(cloth.attributes.position.array);
      const cup = new THREE.Mesh(new THREE.CircleGeometry(0.054, 16).rotateX(-Math.PI / 2), cupMat); cup.position.y = 0.012; grp.add(cup);
      this.courseGroup.add(grp); this.flags.push({ g, grp, cloth: fm });
      if (g.target) this.labels.push({ pos: new THREE.Vector3(g.pinX, y + 3.2, g.pinZ), g, kind: 'flag' });
    }
    // distance signs
    const signSide = L.fwHalf + 9;
    for (let d = 50; d <= 300; d += 50) {
      const z = -d * YD, x = (d / 50) % 2 ? signSide : -signSide;
      if (L.lakes.some(lk => course.lakeE(lk, x, z) < 1.4)) continue;
      const y = course.heightAt(x, z);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: makeSignTexture(String(d)), roughness: 0.8 }));
      board.position.set(x, y + 1.6, z); board.rotation.y = Math.atan2(-x, 60) * 0.5; board.castShadow = true;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), poleMat); post.position.set(x, y + 0.55, z);
      this.courseGroup.add(board, post);
    }
    // distance line (crosswind)
    for (const ln of L.lines) {
      const cone = new THREE.ConeGeometry(0.22, 0.5, 10).translate(0, 0.25, 0), cm = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, emissive: 0xff5a00, emissiveIntensity: 0.2 });
      const n = Math.floor(L.fwHalf * 2 / 4); const im = new THREE.InstancedMesh(cone, cm, n + 1); const mt = new THREE.Matrix4();
      for (let i = 0; i <= n; i++) { const x = -L.fwHalf + i * 4 + course.fwCenter(ln.z); mt.makeTranslation(x, course.heightAt(x, ln.z), ln.z); im.setMatrixAt(i, mt); }
      im.castShadow = true; this.courseGroup.add(im);
      for (const s of [-1, 1]) {
        const x = s * (L.fwHalf + 1.5), y = course.heightAt(x, ln.z);
        const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 6).translate(0, 2.5, 0), cm); pm.position.set(x, y, ln.z); this.courseGroup.add(pm);
      }
      this.labels.push({ pos: new THREE.Vector3(0, course.heightAt(0, ln.z) + 4, ln.z), text: ln.label, kind: 'line' });
    }
    // tee markers & range balls
    for (const m of this.teeMarkers) m.position.set(m.userData.x, course.heightAt(m.userData.x, -2.5) + 0.05, -2.5);
    const r = mulberry32(3), mt = new THREE.Matrix4();
    for (let i = 0; i < 30; i++) { const x = 2.3 + r() * 0.6, z = 1.2 + r() * 0.6; mt.makeTranslation(x, course.heightAt(x, z) + BALL_R + (i > 18 ? BALL_R * 1.6 : 0), z); this.rangeBalls.setMatrixAt(i, mt); }
    this.rangeBalls.instanceMatrix.needsUpdate = true;
  }

  targetRing(g, R, on) {
    const segs = 96, geo = new THREE.BufferGeometry(), pos = new Float32Array((segs + 1) * 6), uv = new Float32Array((segs + 1) * 4);
    const rIn = R - 0.35;
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < 2; k++) { const rr = k ? R : rIn, x = g.pinX + c * rr, z = g.pinZ + s * rr; pos.set([x, this.course.heightAt(x, z) + 0.06, z], (i * 2 + k) * 3); uv.set([i / segs, k], (i * 2 + k) * 2); }
    }
    const idx = []; for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: on ? 0xffd54a : 0xffffff, transparent: true, opacity: on ? 0.95 : 0.35, depthWrite: false, fog: false }));
    m.renderOrder = 2; this.courseGroup.add(m); return m;
  }
  setTargets(greens, R, activeIdx) {
    for (const m of this.targetRings) { this.courseGroup.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.targetRings = [];
    greens.forEach((g, i) => {
      if (R) this.targetRings.push(this.targetRing(g, R * YD, i === activeIdx));
      if (R) this.targetRings.push(this.targetRing(g, R * YD / 3, i === activeIdx));
    });
    for (const f of this.flags) if (f.g.target) {
      const on = greens.indexOf(f.g) === activeIdx;
      f.cloth.material.color.set(on ? 0xffd23a : 0xe8433a); f.cloth.material.emissive.set(on ? 0xffb000 : 0x551010);
      f.cloth.material.emissiveIntensity = on ? 0.5 : 0.1;
    }
  }

  buildTerrain(course, q) {
    const { x0, x1, z0, z1, step } = PLAY;
    const axis = (a0, a1, lo, hi) => { // dense inside [a0,a1] with grid step, geometric outside to lo/hi
      const out = [];
      let s = step, v = a0; const left = [];
      while (v > lo) { s *= 1.28; v -= s; left.push(Math.max(v, lo)); }
      out.push(...left.reverse());
      for (let t = a0; t <= a1 + 1e-6; t += step) out.push(t);
      s = step; v = a1; while (v < hi) { s *= 1.28; v += s; out.push(Math.min(v, hi)); }
      return out;
    };
    const xs = axis(x0, x1, -3200, 3200);
    const zsAsc = axis(z1, z0, -3600, 2600); const zs = zsAsc.slice().reverse(); // z descending (near -> far)
    const nx = xs.length, nz = zs.length;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
    const ix0 = xs.indexOf(x0), iz0 = zs.indexOf(z0);
    const cc = new THREE.Color();
    for (let j = 0; j < nz; j++) {
      const z = zs[j];
      for (let i = 0; i < nx; i++) {
        const x = xs[i], k = j * nx + i;
        const gi = i - ix0, gj = j - iz0;
        const inside = gi >= 0 && gj >= 0 && gi < course.nx && gj < course.nz;
        const h = inside ? course.heights[gj * course.nx + gi] : course.rawHeight(x, z);
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        uv[k * 2] = (x - x0) / (x1 - x0); uv[k * 2 + 1] = (z0 - z) / (z0 - z1);
        // outer tint
        const out = Math.max(0, Math.abs(x) - 230, z1 - z, z - z0) ;
        const t = smoothstep(0, 400, out), nn = nV(x * 0.004, z * 0.004);
        cc.setRGB(1 - t * (0.18 - nn * 0.08), 1 - t * (0.12 + nn * 0.05), 1 - t * (0.25 + nn * 0.1));
        const hi = smoothstep(40, 140, h); cc.r += hi * 0.12; cc.g += hi * 0.02; cc.b += hi * 0.04;
        col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let p = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // flip winding check: normals must point up
    if (geo.attributes.normal.getY(Math.floor(nx * nz / 2)) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.computeVertexNormals(); }
    if (this.terrainMat.map) this.terrainMat.map.dispose();
    this.terrainMat.map = this.paintSurface(course, QUALITY[q].tex);
    this.terrainMat.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, this.terrainMat); mesh.receiveShadow = true;
    this.courseGroup.add(mesh); this.terrain = mesh;
  }

  paintSurface(course, W) {
    const { x0, x1, z0, z1 } = PLAY, H = Math.round(W * (z0 - z1) / (x1 - x0));
    const data = new Uint8Array(W * H * 4), L = course.L;
    const put = (k, r, g, b) => { data[k] = r > 255 ? 255 : r; data[k + 1] = g > 255 ? 255 : g; data[k + 2] = b > 255 ? 255 : b; data[k + 3] = 255; };
    for (let j = 0; j < H; j++) {
      const z = z0 + (j + 0.5) / H * (z1 - z0);
      const fc = course.fwCenter(z);
      for (let i = 0; i < W; i++) {
        const x = x0 + (i + 0.5) / W * (x1 - x0), k = (j * W + i) * 4;
        const h = course.heightAt(x, z), s = course.surfaceAt(x, z, h);
        const v = 1 + 0.07 * nV(x * 0.07, z * 0.07) + 0.035 * nV2(x * 0.4, z * 0.4);
        let r, g, b;
        switch (s) {
          case SURF.FAIRWAY: {
            const band = (Math.floor((z + 2000) / 7.5) & 1) ? 1.075 : 0.93;
            const lane = (Math.floor((x - fc + 1000) / 11) & 1) ? 1.02 : 0.985;
            const f = band * lane * v; r = 90 * f; g = 142 * f; b = 50 * f; break;
          }
          case SURF.TEE: { const f = ((Math.floor((x + 100) / 1.6) & 1) ? 1.06 : 0.95) * v; r = 94 * f; g = 146 * f; b = 52 * f; const dv = nV3(x * 3.1, z * 3.1); if (dv > 0.78) { const t = Math.min(1, (dv - 0.78) * 6) * 0.55; r += (156 - r) * t; g += (140 - g) * t; b += (100 - b) * t; } break; }
          case SURF.GREEN: { const f = (((Math.floor((x + z + 999) / 1.7) + Math.floor((x - z + 999) / 1.7)) & 1) ? 1.03 : 0.972) * (1 + 0.02 * nV(x * 0.3, z * 0.3)); r = 96 * f; g = 160 * f; b = 62 * f; break; }
          case SURF.FRINGE: r = 84 * v; g = 134 * v; b = 48 * v; break;
          case SURF.SAND: { const f = 0.94 + 0.08 * nV2(x * 1.5, z * 1.5); r = 226 * f; g = 205 * f; b = 160 * f; break; }
          case SURF.WATER: r = 58; g = 70; b = 52; break;
          case SURF.DEEP: { const n = nV3(x * 0.12, z * 0.12); const f = v * 0.95; r = (58 + n * 14) * f; g = (90 + n * 6) * f; b = (34 + n * 4) * f; if (n > 0.45) { r = 88 * f; g = 78 * f; b = 50 * f; } break; }
          default: {
            let f = v * (0.95 + 0.06 * nV3(x * 0.2, z * 0.2));
            const ax = Math.abs(x - fc);
            if (z < L.fwStart + 2 && z > L.fwEnd - 2 && ax < L.fwHalf + 4.2) { r = 80 * f; g = 126 * f; b = 45 * f; }
            else { r = 68 * f; g = 106 * f; b = 38 * f; }
          }
        }
        if (s !== SURF.WATER && h < WATER_Y + 0.35 && L.lakes.some(lk => course.lakeE(lk, x, z) < 1.35)) { const t = clamp((WATER_Y + 0.35 - h) / 0.5, 0, 1); r += (150 - r) * t; g += (132 - g) * t; b += (98 - b) * t; }
        put(k, r, g, b);
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = this.maxAniso; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.flipY = false; tex.needsUpdate = true;
    return tex;
  }

  placeTrees(course, q) {
    const mt = new THREE.Matrix4(), c = new THREE.Color(), qn = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const counts = [0, 0, 0]; let tc = 0; const r = mulberry32(17);
    for (const t of course.trees) {
      const m = this.treeMeshes[t.type], i = counts[t.type]++;
      if (i >= m.instanceMatrix.count) continue;
      qn.setFromAxisAngle(up, t.hue * 6.28);
      sc.set(t.H * t.wide, t.H, t.H * t.wide); ps.set(t.x, t.y, t.z);
      mt.compose(ps, qn, sc); m.setMatrixAt(i, mt);
      const hs = t.type === 0 ? 0 : 0.03;
      c.setHSL(0.24 + hs + (t.hue - 0.5) * 0.07, 0.28 + t.hue * 0.18, 0.5 + (r() - 0.5) * 0.16); c.multiplyScalar(1.5);
      if (t.obstacle && t.type === 1) c.multiplyScalar(0.95);
      m.setColorAt(i, c);
      const sh = TREE_SHAPE[t.type];
      const trH = sh.cy0 * t.H + (t.type === 1 ? t.H * 0.15 : 0.5), trR = 0.022 * t.H + 0.08;
      sc.set(trR, trH, trR); ps.set(t.x, t.y, t.z); mt.compose(ps, qn, sc); this.trunkMesh.setMatrixAt(tc++, mt);
    }
    this.treeMeshes.forEach((m, k) => { m.count = Math.min(counts[k], m.instanceMatrix.count); m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    this.trunkMesh.count = tc; this.trunkMesh.instanceMatrix.needsUpdate = true;
    // far billboards on the hills
    const rb = mulberry32(31); const bc = [0, 0];
    this.bbAll = [[], []];
    for (let n = 0; n < 6000 && bc[0] + bc[1] < 4600; n++) {
      const x = (rb() * 2 - 1) * 1700, z = 700 - rb() * 2600;
      const inPlay = Math.abs(x) < course.L.treeX + 64 && z > -700 && z < 110;
      if (inPlay) continue;
      if (nV(x * 0.003, z * 0.003) < -0.25) continue;
      const h = course.rawHeight(x, z); if (h < WATER_Y + 0.5) continue;
      const type = rb() < 0.6 ? 0 : 1, H = 11 + rb() * 12;
      this.bbAll[type].push([x, h - 0.5, z, H, rb()]); bc[type]++;
    }
    this.applyFarDensity(q);
  }
  applyFarDensity(q) {
    const frac = QUALITY[q].far, mt = new THREE.Matrix4(), c = new THREE.Color();
    this.billboards.forEach((m, k) => {
      const arr = this.bbAll?.[k] || []; const n = Math.min(m.instanceMatrix.count, Math.floor(arr.length * frac));
      for (let i = 0; i < n; i++) { const [x, y, z, H, hu] = arr[i]; mt.makeScale(H * 0.62, H, H * 0.62).setPosition(x, y, z); m.setMatrixAt(i, mt); c.setHSL(0.25, 0.25, 0.75 + hu * 0.35); m.setColorAt(i, c); }
      m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }
  placeGrass(course) {
    const r = mulberry32(55), mt = new THREE.Matrix4(), qn = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const max = this.grass.instanceMatrix.count; let n = 0, tries = 0;
    while (n < max && tries < max * 6) {
      tries++;
      const a = r() * Math.PI * 2, d = 2.5 + Math.pow(r(), 1.7) * 75;
      const x = Math.sin(a) * d * 1.3, z = -Math.cos(a) * d * 0.9 - 10;
      const s = course.surfaceAt(x, z);
      if (s !== SURF.ROUGH && s !== SURF.DEEP) continue;
      const k = 0.6 + r() * 0.6 * (s === SURF.DEEP ? 1.5 : 1);
      qn.setFromAxisAngle(up, r() * 6.28); sc.set(k, k * (0.8 + r() * 0.5), k); ps.set(x, course.heightAt(x, z) - 0.01, z);
      mt.compose(ps, qn, sc); this.grass.setMatrixAt(n++, mt);
    }
    this.grassTotal = n; this.grass.instanceMatrix.needsUpdate = true;
    this.applyGrassDensity(this.q);
  }
  applyGrassDensity(q) { this.grass.count = Math.floor((this.grassTotal || 0) * QUALITY[q].grass); this.grass.visible = this.grass.count > 0; }

  setQuality(q) {
    this.q = q; const Q = QUALITY[q];
    const dpr = Math.min(window.devicePixelRatio || 1, Q.dpr, 2);
    this.renderer.setPixelRatio(dpr);
    const want = Q.shadow > 0;
    if (this.renderer.shadowMap.enabled !== want) {
      this.renderer.shadowMap.enabled = want;
      this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
    }
    if (want && this.sun.shadow.mapSize.x !== Q.shadow) {
      this.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.applyGrassDensity(q); if (this.bbAll) this.applyFarDensity(q);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 58 : 55;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.time += dt; this.uniforms.uTime.value = this.time;
    for (const f of this.flags) {
      const p = f.cloth.geometry.attributes.position, b = f.cloth.userData.base, t = this.time;
      for (let i = 0; i < p.count; i++) {
        const x = b[i * 3], y = b[i * 3 + 1];
        p.setZ(i, Math.sin(x * 7 - t * 7 + y * 2) * 0.07 * x + Math.sin(x * 3 - t * 4) * 0.03 * x);
        p.setY(i, y - x * x * 0.08);
      }
      p.needsUpdate = true; f.cloth.geometry.computeVertexNormals();
      f.grp.rotation.y = this.windYaw ?? 0;
    }
  }

  setBall(p, scaleMode = 0) {
    this.ball.position.copy(p);
    const d = this.camera.position.distanceTo(p);
    const s = Math.max(1, d * (scaleMode ? 0.0021 : 0.006) / BALL_R);
    this.ball.scale.setScalar(s);
    this.ballGlow.position.copy(p);
    const gs = clamp(d * 0.018, 0.05, 6) * (scaleMode ? 1 : 0.35);
    this.ballGlow.scale.set(gs, gs, 1); this.ballGlow.material.opacity = scaleMode ? 0.9 : 0.0;
    if (this.course) {
      const h = this.course.heightAt(p.x, p.z), above = p.y - h;
      const bs = 0.03 + above * 0.02; this.blob.scale.setScalar(bs * s * 0.7 + 0.02);
      this.blob.position.set(p.x, Math.max(h, WATER_Y) + 0.02, p.z);
      this.blob.material.opacity = clamp(0.5 - above * 0.012, 0.05, 0.5);
      this.blob.visible = above < 60;
    }
  }

  render() { this.updateTracer(); this.renderer.render(this.scene, this.camera); }
}
