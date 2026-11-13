// The process scene: a cut-open coronary artery over a slab of heart muscle.
// One number u (0..6, from scroll) drives everything: plaque, rupture, clot,
// flow, dying muscle, and the stent that reopens the artery.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { smooth } from './ecg.js';
const coarse = window.matchMedia('(pointer: coarse)').matches;

const R = 1;            // inner radius of the artery
const WALL = 0.3;       // wall thickness
const L = 14;           // length
const XP = 0.2;         // plaque centre along x
const AC = Math.PI + 0.42; // plaque centre angle (bottom, slightly back)
const A0 = Math.PI - 0.32, A1 = 2 * Math.PI + 0.32; // visible arc (back half + lips)

const ramp = (u, a, b) => smooth(a, b, u);

export function paramsAt(u) {
  const plaque = Math.max(0, 0.3 * ramp(u, 0.75, 1.8) + 0.34 * ramp(u, 1.65, 2.6) + 0.05 * ramp(u, 2.7, 3.0) - 0.52 * ramp(u, 5.15, 5.6));
  const ldl = ramp(u, 0.6, 1.1) * (1 - ramp(u, 2.5, 3.0));
  const rupture = ramp(u, 2.75, 3.15) * (1 - ramp(u, 5.15, 5.45));
  const clotGrow = 0.45 * ramp(u, 2.95, 3.6) + 0.55 * ramp(u, 3.6, 4.15);
  const clot = clotGrow * (1 - ramp(u, 5.2, 5.6));
  let flow = 1 - 0.42 * ramp(u, 1.6, 2.6) - 0.28 * ramp(u, 3.0, 3.6) - 0.3 * ramp(u, 3.65, 4.15);
  flow = Math.min(1, Math.max(0, flow) + 0.92 * ramp(u, 5.3, 5.75));
  const death = ramp(u, 3.95, 4.9) * (1 - 0.55 * ramp(u, 5.35, 5.9));
  const cath = ramp(u, 4.85, 5.15) * (1 - ramp(u, 5.7, 5.98));
  const balloon = ramp(u, 5.1, 5.35) * (1 - ramp(u, 5.5, 5.7));
  const stent = ramp(u, 5.1, 5.4);
  const st = 0.36 * ramp(u, 3.6, 4.1) * (1 - ramp(u, 5.35, 5.75)) - 0.09 * ramp(u, 1.8, 2.5) * (1 - ramp(u, 2.85, 3.2));
  const bpm = 70 + 34 * ramp(u, 3.5, 4.4) * (1 - ramp(u, 5.4, 5.9)) + 10 * ramp(u, 1.9, 2.5) * (1 - ramp(u, 2.9, 3.3));
  return { plaque, ldl, rupture, clot, flow, death, cath, balloon, stent, st, bpm };
}

const plaqueAt = (x, a, h) => h * Math.exp(-(((x - XP) / 1.05) ** 2)) * Math.exp(-(((a - AC) / 0.95) ** 2));

export function createArtery(container, labelsHost) {
  const W = () => container.clientWidth, H = () => container.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.25 : 1.75));
  renderer.setSize(W(), H());
  renderer.setClearColor('#070308');
  container.appendChild(renderer.domElement);
  renderer.domElement.className = 'art';

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#070308', 9, 22);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.28;

  const camera = new THREE.PerspectiveCamera(38, W() / H(), 0.05, 60);
  scene.add(new THREE.HemisphereLight(0xffd0d8, 0x14040a, 0.35));
  const key = new THREE.DirectionalLight(0xfff2ea, 1.5); key.position.set(2, 5, 6); scene.add(key);
  const back = new THREE.DirectionalLight(0x5a7dff, 1.6); back.position.set(-5, 2, -6); scene.add(back);
  const inner = new THREE.PointLight(0xff4060, 3, 6); inner.position.set(-1.5, 0.2, 0.6); scene.add(inner);

  const world = new THREE.Group();
  scene.add(world);

  // ---------- artery wall (custom cut-away tube) ----------
  const NX = 220, NA = 72;
  const wallGeo = new THREE.BufferGeometry();
  // inner surface (NX+1)*(NA+1), outer surface same, two cut edges 2*(NX+1)
  const innerCount = (NX + 1) * (NA + 1);
  const total = innerCount * 2 + (NX + 1) * 4;
  const wPos = new Float32Array(total * 3), wCol = new Float32Array(total * 3);
  const idx = [];
  const I = (s, i, j) => s * innerCount + i * (NA + 1) + j;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NA; j++) {
    const a = I(0, i, j), b = I(0, i + 1, j), c = I(0, i + 1, j + 1), d = I(0, i, j + 1);
    idx.push(a, d, b, b, d, c); // inner faces point inward
    const a2 = I(1, i, j), b2 = I(1, i + 1, j), c2 = I(1, i + 1, j + 1), d2 = I(1, i, j + 1);
    idx.push(a2, b2, d2, b2, c2, d2);
  }
  const E0 = innerCount * 2;
  for (let e = 0; e < 2; e++) {
    const base = E0 + e * (NX + 1) * 2;
    for (let i = 0; i < NX; i++) {
      const a = base + i * 2, b = base + (i + 1) * 2;
      if (e === 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  wallGeo.setIndex(idx);
  wallGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
  wallGeo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));
  const wallMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.18,
    sheen: 1, sheenColor: new THREE.Color('#ff8fa3'), sheenRoughness: 0.5, side: THREE.DoubleSide,
    emissive: new THREE.Color('#1c0207'), emissiveIntensity: 0.5,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  world.add(wall);
  const cIn = new THREE.Color('#8a1a30'), cIn2 = new THREE.Color('#5a0c1e'), cOut = new THREE.Color('#9a2a40'),
    cCut = new THREE.Color('#c25468'), cPl = new THREE.Color('#e0a030'), cPlDeep = new THREE.Color('#b86a10'), cRupt = new THREE.Color('#fff1c8');
  const col = new THREE.Color();
  let lastPlaque = -1, lastRupt = -1;
  function buildWall(h, rupt) {
    for (let i = 0; i <= NX; i++) {
      const x = -L / 2 + (L * i) / NX;
      for (let j = 0; j <= NA; j++) {
        const a = A0 + ((A1 - A0) * j) / NA;
        const pl = plaqueAt(x, a, h);
        const r = R - pl;
        const k = I(0, i, j) * 3;
        wPos[k] = x; wPos[k + 1] = Math.cos(a) * r; wPos[k + 2] = Math.sin(a) * r;
        const w = h > 0 ? Math.min(1, pl / 0.12) : 0;
        const stripe = 0.5 + 0.5 * Math.sin(x * 9 + Math.sin(a * 5) * 1.5);
        col.copy(cIn).lerp(cIn2, stripe * 0.4).lerp(cPl, w);
        if (rupt > 0 && pl > 0.05) {
          const crest = Math.exp(-(((x - XP) / 0.35) ** 2)) * Math.exp(-(((a - AC) / 0.32) ** 2));
          col.lerp(cRupt, crest * rupt * 0.9);
        }
        wCol[k] = col.r; wCol[k + 1] = col.g; wCol[k + 2] = col.b;
        const k2 = I(1, i, j) * 3;
        const ro = R + WALL;
        wPos[k2] = x; wPos[k2 + 1] = Math.cos(a) * ro; wPos[k2 + 2] = Math.sin(a) * ro;
        col.copy(cOut).lerp(cIn2, 0.3 * stripe);
        wCol[k2] = col.r; wCol[k2 + 1] = col.g; wCol[k2 + 2] = col.b;
      }
      for (let e = 0; e < 2; e++) {
        const a = e === 0 ? A0 : A1;
        const pl = plaqueAt(x, a, h);
        const base = (E0 + e * (NX + 1) * 2 + i * 2) * 3;
        const ri = R - pl, ro = R + WALL;
        wPos[base] = x; wPos[base + 1] = Math.cos(a) * ri; wPos[base + 2] = Math.sin(a) * ri;
        wPos[base + 3] = x; wPos[base + 4] = Math.cos(a) * ro; wPos[base + 5] = Math.sin(a) * ro;
        const w = Math.min(1, pl / 0.08);
        col.copy(cCut).lerp(cPlDeep, w);
        wCol[base] = col.r; wCol[base + 1] = col.g; wCol[base + 2] = col.b;
        col.copy(cCut);
        wCol[base + 3] = col.r; wCol[base + 4] = col.g; wCol[base + 5] = col.b;
      }
    }
    wallGeo.attributes.position.needsUpdate = true;
    wallGeo.attributes.color.needsUpdate = true;
    wallGeo.computeVertexNormals();
  }
  buildWall(0, 0);

  // ---------- heart muscle slab ----------
  const slabGeo = new THREE.BoxGeometry(L, 1.1, 4.2, 200, 4, 40);
  const slabMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uDeath: { value: 0 }, uBeat: { value: 0 }, uStart: { value: XP + 0.9 }, uFog: { value: new THREE.Color('#070308') } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){ vP=position; vN=normalize(normalMatrix*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uT,uDeath,uBeat,uStart; uniform vec3 uFog; varying vec3 vP; varying vec3 vN; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        float fib = 0.5+0.5*sin(vP.z*38.0 + n(vP.xz*vec2(1.2,6.))*5.0);
        float str = 0.5+0.5*sin(vP.x*60.0 + vP.z*4.0);
        vec3 healthy = mix(vec3(0.42,0.04,0.09), vec3(0.78,0.12,0.2), fib*0.7+0.15*str);
        healthy *= 0.85 + 0.35*uBeat;
        float front = uStart + uDeath*(7.0);
        float dead = smoothstep(uStart-0.2, uStart+0.2, vP.x) * (1.0 - smoothstep(front-0.6, front, vP.x)) * step(0.001,uDeath);
        float mottled = n(vP.xz*3.0)*0.5+n(vP.xz*9.)*0.25;
        vec3 deadC = mix(vec3(0.20,0.15,0.24), vec3(0.42,0.36,0.48), fib*0.5+mottled*0.5);
        float edge = smoothstep(front-0.9, front-0.6, vP.x)*(1.0-smoothstep(front-0.35, front, vP.x))*step(0.001,uDeath);
        vec3 c = mix(healthy, deadC, dead);
        c += vec3(1.0,0.35,0.15)*edge*0.5;
        float l = 0.45 + 0.55*max(dot(vN, normalize(vec3(0.3,1.0,0.6))),0.0);
        c *= l;
        float fd = smoothstep(9.0, 22.0, length(vW - cameraPosition));
        gl_FragColor = vec4(mix(c, uFog, fd), 1.0);
      }`,
  });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.set(0, -R - WALL - 0.95, -0.6);
  world.add(slab);
  // small vessels sinking from artery into the muscle
  const capMat = new THREE.MeshStandardMaterial({ color: '#b3263c', roughness: 0.5, emissive: '#400612' });
  const capillaries = [];
  for (let i = 0; i < 9; i++) {
    const x = -5.6 + i * 1.4 + (i % 2) * 0.3;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, -R - WALL + 0.05, -0.55), new THREE.Vector3(x + 0.3, -R - WALL - 0.3, -0.7), new THREE.Vector3(x + 0.6, -R - WALL - 0.45, -0.3 - (i % 3) * 0.4),
    ]);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.05, 8, false), capMat.clone());
    m.userData.x = x;
    world.add(m); capillaries.push(m);
  }

  // ---------- red blood cells (instanced, biconcave) ----------
  const prof = [];
  const R0 = 0.15;
  for (let k = 0; k <= 16; k++) { const rr = (k / 16) * R0; const q = rr / R0; const t = 0.5 * 0.28 * R0 * 3 * Math.sqrt(Math.max(0, 1 - q * q)) * (0.207 + 2.003 * q * q - 1.123 * q ** 4); prof.push(new THREE.Vector2(rr, Math.max(0.004, t))); }
  for (let k = 16; k >= 0; k--) { const pnt = prof[k]; prof.push(new THREE.Vector2(pnt.x, -pnt.y)); }
  const rbcGeo = new THREE.LatheGeometry(prof, 28);
  const rbcMat = new THREE.MeshPhysicalMaterial({ color: '#d4122e', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 1, sheenColor: new THREE.Color('#ff7d90'), emissive: '#3a0008', emissiveIntensity: 0.35 });
  const NC = 340;
  const rbc = new THREE.InstancedMesh(rbcGeo, rbcMat, NC);
  rbc.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  world.add(rbc);
  const cells = Array.from({ length: NC }, () => ({
    x: -L / 2 + Math.random() * L, rho: Math.sqrt(Math.random()) * 0.92, a: Math.random() * Math.PI * 2,
    sp: 0.75 + Math.random() * 0.5, rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 3, s: 0.7 + Math.random() * 0.2,
  }));

  // ---------- LDL particles ----------
  const NL = 70;
  const ldlMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.055, 2), new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#ffb020', emissiveIntensity: 1.6, roughness: 0.4 }), NL);
  world.add(ldlMesh);
  const ldls = Array.from({ length: NL }, () => ({ t: Math.random(), sp: 0.12 + Math.random() * 0.12, a: AC + (Math.random() - 0.5) * 1.6, x0: -L / 2 + Math.random() * 2, xe: XP + (Math.random() - 0.5) * 1.8, y0: (Math.random() - 0.5) * 1.2, z0: (Math.random() - 0.5) * 1.2 }));

  // ---------- platelets + clot + fibrin ----------
  const NP = 140;
  const plt = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: '#ffb84a', emissiveIntensity: 1.2, roughness: 0.5 }), NP);
  world.add(plt);
  const plts = Array.from({ length: NP }, (_, i) => ({ th: i / NP, ph: Math.random(), dx: (Math.random() - 0.5) * 1.0, da: (Math.random() - 0.5) * 0.7, lift: Math.random() * 0.25, x: -L / 2 + Math.random() * L, a: Math.random() * 6.28, rho: Math.random() * 0.8 }));

  const NK = 260;
  const clotMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshPhysicalMaterial({ color: '#7a0718', roughness: 0.55, clearcoat: 0.6, sheen: 1, sheenColor: new THREE.Color('#ff4466'), emissive: '#2a0008' }), NK);
  world.add(clotMesh);
  const clots = Array.from({ length: NK }, () => {
    const rr = Math.cbrt(Math.random());
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    return { ox: Math.sin(ph) * Math.cos(th) * rr, oy: Math.sin(ph) * Math.sin(th) * rr, oz: Math.cos(ph) * rr, r: 0.06 + Math.random() * 0.09, thr: rr * 0.85 + Math.random() * 0.15 };
  });
  const fibGeo = new THREE.BufferGeometry();
  const NF = 90; const fibPos = new Float32Array(NF * 6);
  const fibSeeds = Array.from({ length: NF }, () => [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
  fibGeo.setAttribute('position', new THREE.BufferAttribute(fibPos, 3));
  const fibMat = new THREE.LineBasicMaterial({ color: '#ffe6ea', transparent: true, opacity: 0 });
  const fibrin = new THREE.LineSegments(fibGeo, fibMat);
  world.add(fibrin);

  // ---------- catheter, balloon, stent ----------
  const cathMat = new THREE.MeshPhysicalMaterial({ color: '#cfe0ff', roughness: 0.2, clearcoat: 1, transmission: 0.2, emissive: '#1a2c66', emissiveIntensity: 0.6 });
  const cath = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 16, 1, true), cathMat);
  cath.rotation.z = Math.PI / 2;
  world.add(cath);
  const balloon = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1.4, 12, 32), new THREE.MeshPhysicalMaterial({ color: '#7fb0ff', transparent: true, opacity: 0.38, roughness: 0.1, clearcoat: 1, emissive: '#2a52c8', emissiveIntensity: 0.9, depthWrite: false }));
  balloon.rotation.z = Math.PI / 2;
  world.add(balloon);
  const RINGS = 9, SEG = 14, SL = 2.0;
  const NS = RINGS * SEG * 2 + (RINGS - 1) * (SEG / 2);
  const strut = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), new THREE.MeshStandardMaterial({ color: '#e6eef8', metalness: 1, roughness: 0.18, emissive: '#7fa8ff', emissiveIntensity: 0.25 }), NS);
  world.add(strut);

  // ---------- bloom ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.4, 0.55, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  // ---------- camera keys per step ----------
  const keys = [
    { p: [-2.6, 1.9, 10.8], t: [-1.7, -0.9, 0] },
    { p: [-2.2, 1.3, 8.4], t: [-1.5, -0.6, 0] },
    { p: [-1.2, 0.7, 7.8], t: [-1.35, -0.45, 0] },
    { p: [-0.8, 0.8, 6.9], t: [-1.25, -0.4, 0] },
    { p: [0.2, 2.8, 11.8], t: [-0.2, -1.6, 0] },
    { p: [-1.6, 1.5, 8.8], t: [-1.3, -0.7, 0] },
  ];
  const tmpP = new THREE.Vector3(), tmpT = new THREE.Vector3(), camT = new THREE.Vector3();
  let camInit = false;
  function camAt(u) {
    const k = Math.min(5, Math.floor(u)), f = k < 5 ? ramp(u - k, 0.55, 1.0) : 0;
    const a = keys[k], b = keys[Math.min(5, k + 1)];
    tmpP.set(...a.p).lerp(new THREE.Vector3(...b.p), f);
    tmpT.set(...a.t).lerp(new THREE.Vector3(...b.t), f);
    if (camera.aspect < 0.9) { tmpP.z *= 1.5; tmpP.x = XP * 0.5 + tmpP.x * 0.2; tmpT.x = XP; tmpT.y += 2.3; }
  }

  // ---------- 3D labels ----------
  const labelDefs = [
    { id: 'rbc', text: 'Ερυθρά αιμοσφαίρια', pos: () => [-3.2, 0.25, 0.2], show: (P, u) => (u < 1.4 ? 1 : 0) },
    { id: 'ldl', text: 'LDL χοληστερόλη', pos: () => [-1.2, 0.35, 0.3], show: (P) => P.ldl },
    { id: 'pl', text: 'Αθηρωματική πλάκα', pos: (P) => [XP - 1.1, Math.cos(AC) * (R - P.plaque * 0.6), Math.sin(AC) * (R - P.plaque * 0.6) + 0.5], show: (P) => smooth(0.18, 0.3, P.plaque) * (1 - P.clot) },
    { id: 'cr', text: 'Ρήξη', pos: (P) => [XP + 0.4, Math.cos(AC) * (R - P.plaque) + 0.15, 0.25], show: (P) => P.rupture * (1 - smooth(0.4, 0.7, P.clot)) },
    { id: 'clot', text: 'Θρόμβος', pos: (P) => [XP + 0.3, 0.5, 0.3], show: (P) => smooth(0.4, 0.6, P.clot) * (1 - P.stent) },
    { id: 'mus', text: 'Καρδιακός μυς', pos: () => [-4.2, -R - WALL - 0.55, 1.5], show: (P, u) => (u > 0.2 ? 1 : 0) },
    { id: 'dead', text: 'Μυς χωρίς οξυγόνο', pos: (P) => [XP + 1.2 + P.death * 3.2, -R - WALL - 0.55, 1.5], show: (P) => smooth(0.15, 0.35, P.death) },
    { id: 'st', text: 'Stent', pos: () => [XP, 0.95, 0.3], show: (P) => smooth(0.3, 0.6, P.stent) },
  ];
  const labelEls = labelDefs.map((d) => {
    const el = document.createElement('div');
    el.className = 'lbl3d'; el.textContent = d.text; labelsHost.appendChild(el); return el;
  });
  const proj = new THREE.Vector3();

  const fit = () => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix();
    renderer.setSize(W(), H()); composer.setSize(W(), H()); bloom.setSize(W(), H());
  };
  let lastW = innerWidth;
  // on phones the URL bar changes only the height: ignore that, resizing WebGL buffers mid-scroll causes jank
  window.addEventListener('resize', () => { if (coarse && innerWidth === lastW) return; lastW = innerWidth; fit(); });
  fit();

  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '100px' }).observe(container);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), dirV = new THREE.Vector3();
  let flowPhase = 0;

  // free lumen around angle a at position x
  const lumenR = (x, a, h) => R - plaqueAt(x, a, h) - 0.14;

  return {
    get visible() { return visible; },
    update(t, dt, u, phase, beat) {
      if (!visible) return;
      const P = paramsAt(u);

      if (Math.abs(P.plaque - lastPlaque) > 0.002 || Math.abs(P.rupture - lastRupt) > 0.01) {
        buildWall(P.plaque, P.rupture); lastPlaque = P.plaque; lastRupt = P.rupture;
      }
      wallMat.emissiveIntensity = 0.35 + 0.45 * beat;
      inner.intensity = (2 + 3 * beat) * (0.35 + 0.65 * P.flow);

      // blood cells
      const pulse = 0.65 + 0.7 * beat;
      flowPhase += dt * pulse;
      const blockX = XP + 0.1;
      for (let i = 0; i < NC; i++) {
        const c = cells[i];
        const near = Math.exp(-(((c.x - XP) / 1.1) ** 2));
        const narrowBoost = 1 + near * P.plaque * 1.6;
        let v = 1.6 * c.sp * pulse * narrowBoost * Math.max(0.0, P.flow);
        // jam upstream of the clot
        if (P.clot > 0.5 && c.x < blockX && c.x > blockX - 4) v *= Math.max(0, (blockX - 0.7 - c.x) / 4);
        c.x += v * dt;
        if (c.x > L / 2) { c.x = -L / 2; c.rho = Math.sqrt(Math.random()) * 0.92; c.a = Math.random() * Math.PI * 2; }
        let scale = c.s;
        if (c.x > blockX - 0.2) scale *= 1 - smooth(0.55, 0.95, P.clot) * smooth(blockX - 0.2, blockX + 0.6, c.x) * (1 - P.stent);
        if (P.clot > 0.4 && Math.abs(c.x - blockX) < 0.6) scale *= 1 - smooth(0.4, 0.8, P.clot) * (1 - P.stent);
        const lr = Math.max(0.05, lumenR(c.x, c.a, P.plaque));
        // squeeze toward the open side above the plaque
        const rr = c.rho * lr;
        pv.set(c.x, Math.cos(c.a) * rr, Math.sin(c.a) * rr);
        e3.set(c.rx + t * c.spin * 0.6, c.ry + t * c.spin * 0.4, 0);
        q.setFromEuler(e3);
        sv.setScalar(Math.max(0.0001, scale));
        m4.compose(pv, q, sv);
        rbc.setMatrixAt(i, m4);
      }
      rbc.instanceMatrix.needsUpdate = true;

      // LDL drifting into the wall
      for (let i = 0; i < NL; i++) {
        const d = ldls[i];
        d.t = (d.t + dt * d.sp) % 1;
        const tt = d.t;
        const x = d.x0 + (d.xe - d.x0) * smooth(0, 0.7, tt);
        const sink = smooth(0.55, 1, tt);
        const r0 = Math.hypot(d.y0, d.z0);
        const rr = r0 * (1 - sink) + (R + 0.12 - P.plaque * 0.4) * sink;
        const a = Math.atan2(d.z0, d.y0) * (1 - sink) + d.a * sink;
        pv.set(x, Math.cos(a) * rr, Math.sin(a) * rr);
        const sc = P.ldl * (1 - smooth(0.85, 1, tt)) * 1.0;
        sv.setScalar(Math.max(0.0001, sc));
        m4.compose(pv, q.identity(), sv);
        ldlMesh.setMatrixAt(i, m4);
      }
      ldlMesh.instanceMatrix.needsUpdate = true;

      // platelets: flow freely, then gather at the crack
      const crestR = R - P.plaque;
      const gather = Math.max(P.rupture, P.clot);
      for (let i = 0; i < NP; i++) {
        const d = plts[i];
        d.x += dt * 1.4 * P.flow * pulse; if (d.x > L / 2) d.x = -L / 2;
        const lr = Math.max(0.05, lumenR(d.x, d.a, P.plaque)) * d.rho;
        const fx = d.x, fy = Math.cos(d.a) * lr, fz = Math.sin(d.a) * lr;
        const g = smooth(d.th * 0.6, d.th * 0.6 + 0.4, gather);
        const ga = AC + d.da;
        const gr = crestR - 0.06 - d.lift;
        const gx = XP + d.dx * 0.7, gy = Math.cos(ga) * gr, gz = Math.sin(ga) * gr;
        pv.set(fx + (gx - fx) * g, fy + (gy - fy) * g, fz + (gz - fz) * g);
        sv.set(1, 0.45, 1).multiplyScalar((0.7 + 0.5 * g) * (1 - P.stent * 0.9) + 0.0001);
        e3.set(t + i, i, 0); q.setFromEuler(e3);
        m4.compose(pv, q, sv);
        plt.setMatrixAt(i, m4);
      }
      plt.instanceMatrix.needsUpdate = true;

      // clot fills the remaining lumen above the plaque
      const cy = (Math.cos(AC) * crestR + R) / 2 - 0.05;
      const ry = Math.max(0.2, (R - Math.cos(AC) * crestR) / 2) * 0.95;
      const growScale = 1 - P.stent * 0.92;
      for (let i = 0; i < NK; i++) {
        const c = clots[i];
        const on = smooth(c.thr, c.thr + 0.18, P.clot);
        pv.set(XP + 0.15 + c.ox * 0.75, cy + c.oy * ry * 0.95 * growScale, c.oz * 0.8 * growScale);
        sv.setScalar(Math.max(0.0001, c.r * on));
        e3.set(i, i * 2, 0); q.setFromEuler(e3);
        m4.compose(pv, q, sv);
        clotMesh.setMatrixAt(i, m4);
      }
      clotMesh.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < NF; i++) {
        const s = fibSeeds[i], k = i * 6;
        fibPos[k] = XP + 0.15 + s[0] * 0.8; fibPos[k + 1] = cy + s[1] * ry * growScale; fibPos[k + 2] = s[2] * 0.75 * growScale;
        fibPos[k + 3] = XP + 0.15 + s[3] * 0.8; fibPos[k + 4] = cy + s[4] * ry * growScale; fibPos[k + 5] = s[5] * 0.75 * growScale;
      }
      fibGeo.attributes.position.needsUpdate = true;
      fibMat.opacity = 0.45 * smooth(0.5, 0.9, P.clot);

      // catheter + balloon + stent
      const tipX = -L / 2 + (XP + 1.2 + L / 2) * P.cath;
      cath.visible = P.cath > 0.001;
      const cl = Math.max(0.01, tipX + L / 2);
      cath.scale.set(1, cl, 1); cath.position.set(-L / 2 + cl / 2, 0.05, 0);
      balloon.visible = P.cath > 0.001 && P.balloon > 0.001 || (P.cath > 0.02 && P.stent < 0.05);
      const br = 0.08 + 0.62 * P.balloon;
      balloon.scale.set(br, 1, br);
      balloon.position.set(Math.min(tipX - 0.7, XP), 0.05, 0);
      const sr = 0.1 + 0.7 * P.stent;
      let si = 0;
      const sx0 = XP - SL / 2;
      const ringPts = [];
      for (let r = 0; r < RINGS; r++) {
        const pts = [];
        for (let s = 0; s <= SEG * 2; s++) {
          const a = (s / (SEG * 2)) * Math.PI * 2;
          const x = sx0 + (r / (RINGS - 1)) * SL + (s % 2 ? 0.11 : -0.11) * (0.4 + 0.6 * P.stent);
          pts.push(new THREE.Vector3(x, Math.cos(a) * sr + 0.05, Math.sin(a) * sr));
        }
        ringPts.push(pts);
        for (let s = 0; s < SEG * 2; s++) setStrut(si++, pts[s], pts[s + 1]);
      }
      for (let r = 0; r < RINGS - 1; r++) for (let s = 0; s < SEG; s += 2) setStrut(si++, ringPts[r][s * 2 + 1], ringPts[r + 1][s * 2 + 1]);
      strut.count = si;
      strut.visible = P.stent > 0.01 && P.cath > 0.0 || P.stent > 0.5;
      strut.instanceMatrix.needsUpdate = true;
      function setStrut(i, a, b) {
        dirV.subVectors(b, a); const len = dirV.length();
        pv.addVectors(a, b).multiplyScalar(0.5);
        q.setFromUnitVectors(up, dirV.normalize());
        sv.set(1, len, 1);
        m4.compose(pv, q, sv); strut.setMatrixAt(i, m4);
      }
      if (P.cath > 0.001 && P.stent < 0.02) { // crimped stent riding on the balloon tip
        world.updateMatrixWorld();
      }

      // muscle
      slabMat.uniforms.uDeath.value = P.death;
      slabMat.uniforms.uBeat.value = beat;
      slabMat.uniforms.uT.value = t;
      for (const m of capillaries) {
        const dead = P.death > 0 && m.userData.x > XP + 0.6 && m.userData.x < XP + 0.9 + P.death * 7;
        m.material.color.set(dead ? '#3a2a40' : '#b3263c');
        m.material.emissive.set(dead ? '#000000' : '#400612');
      }

      // camera
      camAt(u);
      if (!camInit) { camera.position.copy(tmpP); camT.copy(tmpT); camInit = true; }
      const k = 1 - Math.pow(0.0015, dt);
      camera.position.lerp(tmpP, k);
      camT.lerp(tmpT, k);
      camera.position.y += Math.sin(t * 0.5) * 0.002;
      camera.lookAt(camT);

      composer.render();

      // labels
      const w = W(), h = H();
      for (let i = 0; i < labelDefs.length; i++) {
        const d = labelDefs[i]; const el = labelEls[i];
        const o = d.show(P, u);
        proj.set(...d.pos(P)).project(camera);
        const x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        el.style.opacity = proj.z < 1 ? o.toFixed(3) : 0;
      }
      return P;
    },
    params: paramsAt,
  };
}
