// Full-window heart explorer built on the real BodyParts3D heart.
// Default view is a textbook-style section: the front of the heart is cut away
// along a plane that opens all four chambers, so the chambers, valves and septum
// are visible, with clear flow arrows and one bright drop you can follow.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import manifest from './heart-parts.json';
import { GROUPS, JOURNEY } from './explorer-data.js';
import { beatShape } from './ecg.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const BLUE = new THREE.Color('#5f86ff'), RED = new THREE.Color('#ff4a5f');
const BIN_URL = `${import.meta.env.BASE_URL}heart/heart.bin`;

// Plane that opens all four chambers at once (found by testing which share of
// each cavity falls on each side). Everything in front of it is cut away.
const CUT_N = new THREE.Vector3(0.44, 0.34, 0.83).normalize();
const CUT_D = 0.0;
// parts left out to keep the picture simple
const HIDDEN = new Set(['FJ3564', 'FJ3579']);
// keep vessels short, like a textbook drawing (model space: keep n·p + c >= 0)
const TRIM = {
  FJ1931: [[[0, 1, 0], 0.25]],
  FJ3441: [[[0, 1, 0], 0.72]],
  aortaBranches: [[[0, -1, 0], 1.02]],
  svc: [[[0, -1, 0], 1.02]],
  pulmArteries: [[[-1, 0, 0], 0.62], [[1, 0, 0], 0.62]],
};

let binPromise = null;
export function prefetchHeart() {
  if (!binPromise) binPromise = fetch(BIN_URL).then((r) => { if (!r.ok) throw new Error('heart.bin'); return r.arrayBuffer(); });
  return binPromise;
}

// ---------------- DOM ----------------
function buildDom() {
  const root = document.createElement('div');
  root.id = 'explorer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Η καρδιά σε 3D');
  root.innerHTML = `
    <div class="ex-canvas"></div>
    <svg class="ex-leaders" aria-hidden="true"></svg>
    <div class="ex-labels"></div>
    <div class="ex-tip" hidden></div>
    <header class="ex-top">
      <div class="ex-title"><span class="eyebrow">Ανατομία · πραγματικό μοντέλο</span><h2>Μέσα στην <span class="grad">καρδιά</span></h2></div>
      <button class="ex-close" type="button" aria-label="Κλείσιμο">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </header>
    <div class="ex-key" aria-hidden="true">
      <span><i class="co2"></i>Χωρίς οξυγόνο</span>
      <span><i class="o2"></i>Με οξυγόνο</span>
      <span><i class="drop"></i>Η σταγόνα</span>
    </div>
    <aside class="ex-journey">
      <div class="ex-j-head">
        <span class="tag">Η διαδρομή του αίματος</span>
        <button class="ex-play" type="button"><span class="ic">▶</span><span class="lb">Ακολούθησε μια σταγόνα</span></button>
      </div>
      <ol class="ex-steps"></ol>
    </aside>
    <aside class="ex-info" hidden>
      <span class="ex-info-chip"></span>
      <h3></h3>
      <p class="ex-info-en"></p>
      <p class="ex-info-text"></p>
    </aside>
    <div class="ex-bar">
      <div class="ex-seg" role="radiogroup" aria-label="Προβολή">
        <span class="ex-seg-pill" aria-hidden="true"></span>
        <button type="button" data-mode="cut" class="on">Τομή</button>
        <button type="button" data-mode="xray">Διάφανη</button>
        <button type="button" data-mode="solid">Απ' έξω</button>
      </div>
      <div class="ex-tg">
        <button type="button" data-t="flow" class="on"><i></i>Ροή</button>
        <button type="button" data-t="labels" class="on"><i></i>Ονόματα</button>
        <button type="button" data-t="cor"><i></i>Στεφανιαίες</button>
        <button type="button" data-t="beat" class="on"><i></i>Χτύπος</button>
        <button type="button" data-t="reset" class="plain">Επαναφορά</button>
      </div>
    </div>
    <div class="ex-hint">Σύρε για να γυρίσεις · ρόδα ή τσίμπημα για ζουμ · πάτα ένα μέρος για πληροφορίες</div>
    <div class="ex-loading"><span></span>Φόρτωση ανατομικού μοντέλου</div>
    <p class="ex-credit">Ανατομικό μοντέλο: BodyParts3D © The Database Center for Life Science, CC BY 4.0</p>`;
  document.body.appendChild(root);
  return root;
}

// ---------------- materials ----------------
// Fresnel alpha for the see-through view, and a flat pink "cut surface" colour
// on the inside of the muscle where the section opens it (like a textbook drawing).
function sectionify(mat, u) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uA0: u.a0, uA1: u.a1, uHi: u.hi, uHiC: u.hiC, uCap: u.cap, uCapC: u.capC });
    sh.fragmentShader = 'uniform float uA0, uA1, uHi, uCap; uniform vec3 uHiC, uCapC;\n' + sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
       diffuseColor.a = mix(uA0, uA1, fres);
       if (!gl_FrontFacing) {
         float l = 0.72 + 0.28 * abs(normal.z);
         outgoingLight = mix(outgoingLight * 0.45, uCapC * l, uCap);
         diffuseColor.a = mix(diffuseColor.a, 1.0, uCap);
       }
       outgoingLight += uHiC * uHi * (0.25 + 0.5 * fres);
       #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'section';
  return mat;
}

export function createExplorer({ onOpen, onClose } = {}) {
  const root = buildDom();
  const $ = (s) => root.querySelector(s);
  const host = $('.ex-canvas');
  const svg = $('.ex-leaders');
  const labelHost = $('.ex-labels');
  const tip = $('.ex-tip');
  const info = $('.ex-info');

  let renderer, scene, camera, controls, composer, bloom, ready = false, building = null, raf = 0, isOpen = false;
  const groups = {};          // key -> { gk, meshes, mat, u, trim, target }
  const pickables = [];
  const beatGroup = new THREE.Group();
  const state = { mode: 'cut', flow: true, labels: true, beat: true, cor: false, hover: null, selected: null, tour: false, tourT: 0, zone: null };

  // clipping planes live in model space; world copies are refreshed every frame
  const planes = [];
  const mkPlane = (n, c) => { const m = new THREE.Plane(V(n).normalize(), c); const w = m.clone(); planes.push({ m, w }); return w; };
  const cutModel = new THREE.Plane(CUT_N.clone().negate(), CUT_D);
  const cutPlane = cutModel.clone();
  planes.push({ m: cutModel, w: cutPlane });
  const trimFor = {};
  for (const [k, list] of Object.entries(TRIM)) trimFor[k] = list.map(([n, c]) => mkPlane(n, c));
  let cutOffset = 0, cutTarget = 0;

  // ---------------- build scene ----------------
  async function build() {
    const buf = await prefetchHeart();
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 760 ? 1.75 : 2));
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = bgTexture();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    camera = new THREE.PerspectiveCamera(30, 1, 0.02, 60);

    scene.add(new THREE.HemisphereLight(0xfff0f0, 0x2a0a12, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.copy(CUT_N).multiplyScalar(5).add(new THREE.Vector3(1.5, 3, 0)); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe6ea, 0.8); fill.position.set(-4, 0.5, 3); scene.add(fill);
    const rim = new THREE.DirectionalLight(0x8aa2ff, 0.7); rim.position.set(-3, 2, -4); scene.add(rim);
    scene.add(camera);
    scene.add(beatGroup);

    const muscle = { color: '#a8323e', roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.3, sheenColor: new THREE.Color('#ff9aa6'), sheenRoughness: 0.6 };
    const art = { color: '#d5473f', roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 };
    const vein = { color: '#3f63d6', roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 };
    const valve = { color: '#d9c2b6', roughness: 0.7, sheen: 0.15, sheenColor: new THREE.Color('#ffffff'), emissive: '#ffffff', emissiveIntensity: 0 };
    const MATS = {
      wallV: muscle, wallLA: muscle, wallRA: muscle,
      cavRA: { color: '#4a63d8', emissive: '#14205e', emissiveIntensity: 0.6, roughness: 0.75 },
      cavRV: { color: '#4a63d8', emissive: '#14205e', emissiveIntensity: 0.6, roughness: 0.75 },
      cavLA: { color: '#d03040', emissive: '#4a0810', emissiveIntensity: 0.6, roughness: 0.75 },
      cavLV: { color: '#d03040', emissive: '#4a0810', emissiveIntensity: 0.6, roughness: 0.75 },
      valveTri: valve, valvePul: valve, valveMit: valve, valveAor: valve,
      coronaryA: { color: '#ff7a3d', emissive: '#ff4a20', emissiveIntensity: 0.25, roughness: 0.4 },
      cardiacV: { color: '#5577ff', emissive: '#2238c8', emissiveIntensity: 0.2, roughness: 0.4 },
      aorta: art, aortaBranches: art, pulmVeins: { ...art, color: '#c93a40' },
      pulmTrunk: vein, pulmArteries: vein, svc: vein, ivc: vein,
    };

    for (const [gk, parts] of Object.entries(manifest.groups)) {
      for (const p of parts) {
        if (HIDDEN.has(p.id)) continue;
        const key = TRIM[p.id] ? p.id : gk;   // parts with their own trim get their own material
        if (!groups[key]) {
          const u = { a0: { value: 1 }, a1: { value: 1 }, hi: { value: 0 }, hiC: { value: new THREE.Color('#ffffff') }, cap: { value: 0 }, capC: { value: new THREE.Color('#eba7a2') } };
          const mat = sectionify(new THREE.MeshPhysicalMaterial({ transparent: true, side: THREE.DoubleSide, ...MATS[gk] }), u);
          // a chamber's surface sits exactly on the inner wall: pull it forward so it wins cleanly
          if (gk.startsWith('cav')) { mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -6; }
          groups[key] = { gk, meshes: [], mat, u, trim: trimFor[key] || [], target: { a0: 1, a1: 1, cap: 0 } };
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, p.positions, p.vertexCount * 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(buf, p.normals, p.vertexCount * 3), 3, true));
        g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, p.indices, p.indexCount), 1));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, groups[key].mat);
        m.userData = { group: gk, id: p.id, name: p.name };
        m.renderOrder = gk.startsWith('wall') ? 5 : gk.startsWith('cav') ? 3 : 1;
        beatGroup.add(m);
        groups[key].meshes.push(m);
        pickables.push(m);
      }
    }

    buildFlow();
    buildLabels();

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.3, 0.98);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.minDistance = 1.2; controls.maxDistance = 9;
    controls.enablePan = true; controls.screenSpacePanning = true;
    controls.target.copy(HOME.target);
    controls.addEventListener('start', () => { userMoved = true; });

    setupPicking();
    applyMode(true);
    resize();
    new ResizeObserver(resize).observe(root);
    ready = true;
    root.classList.add('ready');
  }

  function bgTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = '#0a0409'; x.fillRect(0, 0, 1024, 1024);
    const g = x.createRadialGradient(580, 470, 0, 580, 470, 640);
    g.addColorStop(0, 'rgba(90,22,40,0.55)'); g.addColorStop(0.5, 'rgba(40,8,20,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
    x.fillStyle = 'rgba(255,170,190,0.04)';
    for (let i = 0; i < 1024; i += 22) for (let j = 0; j < 1024; j += 22) x.fillRect(i, j, 1.4, 1.4);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---------------- blood flow: arrows on the real vessel centrelines ----------------
  const flow = { segs: [], arrows: null, items: [], drop: null, trail: [], trailPts: [], journey: null, zones: [], anchors: null };
  const allParts = Object.values(manifest.groups).flat();
  const P = (id) => allParts.find((p) => p.id === id);
  const line = (id) => P(id).line.pts.map(V);
  const gc = (gk) => { const c = new THREE.Vector3(); const ps = manifest.groups[gk]; ps.forEach((p) => c.add(V(p.center))); return c.divideScalar(ps.length); };
  const endNear = (pts, t) => (pts[0].distanceTo(t) < pts.at(-1).distanceTo(t) ? pts.slice().reverse() : pts);
  const startNear = (pts, t) => (pts[0].distanceTo(t) <= pts.at(-1).distanceTo(t) ? pts : pts.slice().reverse());
  const keep = (pts, f) => pts.filter(f);

  function curveOf(pts) {
    const clean = [];
    for (const p of pts) if (!clean.length || clean.at(-1).distanceTo(p) > 0.03) clean.push(p);
    const curve = new THREE.CatmullRomCurve3(clean, false, 'centripetal');
    return { pts: curve.getSpacedPoints(300), len: curve.getLength() };
  }

  function buildFlow() {
    const RA = gc('cavRA'), RV = gc('cavRV'), LA = gc('cavLA'), LV = gc('cavLV');
    const TRI = gc('valveTri'), PUL = gc('valvePul'), MIT = gc('valveMit'), AOV = gc('valveAor');
    const RVlow = RV.clone().add(new THREE.Vector3(-0.02, -0.2, -0.04));
    const RVout = RV.clone().lerp(PUL, 0.55);
    const LVapex = LV.clone().add(new THREE.Vector3(0.12, -0.22, 0.06));
    const LVout = LV.clone().lerp(AOV, 0.55);
    const SVC = keep(endNear(line('FJ3645'), RA), (p) => p.y < 1.0);
    const IVC = keep(endNear(line('FJ3441'), RA), (p) => p.y > -0.7);
    const trunk = startNear(line('FJ2966'), PUL);
    const LPA = keep(startNear(line('FJ2924'), trunk.at(-1)), (p) => Math.abs(p.x) < 0.6);
    const RPA = keep(startNear(line('FJ3019'), trunk.at(-1)), (p) => Math.abs(p.x) < 0.6);
    const asc = startNear(line('FJ3413'), AOV), arch = startNear(line('FJ3411'), asc.at(-1));
    const desc = keep(startNear(line('FJ1931'), arch.at(-1)), (p) => p.y > -0.24);
    const pv = (id) => [...endNear(line(id), LA)];

    const rightCore = [RA, TRI, RVlow, RV, RVout, PUL, ...trunk];
    const leftCore = [LA, MIT, LV, LVapex, LV, LVout, AOV, ...asc, ...arch];
    const add = (pts, color) => flow.segs.push({ ...curveOf(pts), color });
    add([...SVC, RA], BLUE);
    add([...IVC, RA], BLUE);
    add(rightCore, BLUE);
    add([trunk.at(-1), ...LPA], BLUE);
    add([trunk.at(-1), ...RPA], BLUE);
    for (const id of ['FJ2925', 'FJ3020']) add([...pv(id), LA], RED);
    add(leftCore, RED);
    add([arch.at(-1), ...desc], RED);
    for (const id of []) {
      const br = keep(line(id), (p) => p.y < 1.0);
      let k = 0, best = 1e9;
      arch.forEach((a, i) => { const d = Math.min(a.distanceTo(br[0]), a.distanceTo(br.at(-1))); if (d < best) { best = d; k = i; } });
      add([arch[k], ...startNear(br, arch[k])], RED);
    }

    // arrows: cones pointing along the flow, evenly spaced, moving like a conveyor
    const cone = new THREE.ConeGeometry(0.024, 0.068, 12, 1);
    cone.translate(0, 0.034, 0);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthTest: false, depthWrite: false });
    const SP = 0.2;
    for (let si = 0; si < flow.segs.length; si++) {
      const n = Math.max(2, Math.round(flow.segs[si].len / SP));
      for (let i = 0; i < n; i++) flow.items.push({ si, o: i / n });
    }
    flow.arrows = new THREE.InstancedMesh(cone, mat, flow.items.length);
    flow.arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flow.arrows.frustumCulled = false;
    flow.arrows.renderOrder = 20;
    flow.items.forEach((it, i) => flow.arrows.setColorAt(i, flow.segs[it.si].color.clone().multiplyScalar(1.15)));
    beatGroup.add(flow.arrows);

    // the guided drop: white core, coloured glow and a pulsing ring, drawn on top so it is never hidden
    const blue = curveOf([...IVC, ...rightCore, ...LPA]);
    const red = curveOf([...pv('FJ2925'), ...leftCore, ...desc]);
    flow.journey = { blue, red };
    const tex = dotTex();
    flow.drop = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, depthTest: false, depthWrite: false, transparent: true }));
    core.renderOrder = 31;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffffff', depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.scale.setScalar(0.42); halo.renderOrder = 30;
    // a soft dark disc behind it so the drop stands out on light tissue too
    const shade = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#000000', depthTest: false, depthWrite: false, transparent: true, opacity: 0.7 }));
    shade.scale.setScalar(0.34); shade.renderOrder = 29;
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex(), color: '#ffffff', depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
    ring.scale.setScalar(0.16); ring.renderOrder = 32;
    flow.drop.add(shade, halo, core, ring);
    flow.drop.userData = { halo, ring, core };
    flow.drop.visible = false;
    beatGroup.add(flow.drop);
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffffff', depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true, toneMapped: false }));
      s.renderOrder = 28; s.visible = false; flow.trail.push(s); beatGroup.add(s);
    }

    const zonePts = {
      ivc: [...IVC, ...SVC], cavRA: [RA], valveTri: [TRI], cavRV: [RVlow, RV, RVout], valvePul: [PUL],
      pulmArteries: [...trunk, ...LPA, ...RPA], pulmVeins: line('FJ2925'), cavLA: [LA], valveMit: [MIT], cavLV: [LV, LVapex, LVout], valveAor: [AOV], aorta: [...asc, ...arch, ...desc],
    };
    flow.zones = Object.entries(zonePts).map(([zone, pts]) => ({ zone, pts }));
    flow.anchors = { RA, RV, LA, LV, TRI, PUL, MIT, AOV, SVC, IVC, trunk, LPA, RPA, asc, arch, desc, LVapex };
  }

  function dotTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
  }
  function ringTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.strokeStyle = '#fff'; x.lineWidth = 10;
    x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.stroke(); return new THREE.CanvasTexture(c);
  }

  // ---------------- labels with leader lines ----------------
  const labels = [];
  function buildLabels() {
    const A = flow.anchors;
    const mid = (pts, f = 0.5) => pts[Math.min(pts.length - 1, Math.round((pts.length - 1) * f))];
    const defs = [
      ['svc', mid(A.SVC, 0.4)], ['ivc', mid(A.IVC, 0.5)], ['aorta', mid(A.arch, 0.25)], ['pulmTrunk', mid(A.trunk, 0.6)], ['pulmVeins', V(P('FJ3020').center)],
      ['cavRA', A.RA], ['cavRV', A.RV.clone().add(new THREE.Vector3(-0.04, -0.12, -0.08))], ['cavLA', A.LA], ['cavLV', A.LV.clone().lerp(A.LVapex, 0.5)],
      ['valveTri', A.TRI], ['valvePul', A.PUL], ['valveMit', A.MIT], ['valveAor', A.AOV],
      ['septum', new THREE.Vector3(0.06, -0.2, 0.02)], ['coronaryA', V(P('FJ2631').center)],
    ];
    for (const [gk, anchor] of defs) {
      const g = GROUPS[gk];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `ex-lbl ${g.blood || 'muscle'}`;
      el.innerHTML = `<b>${g.el}</b><small>${g.blood === 'o2' ? 'με οξυγόνο' : g.blood === 'co2' ? 'χωρίς οξυγόνο' : 'μυς'}</small>`;
      el.addEventListener('click', () => select(gk));
      el.addEventListener('mouseenter', () => setHover(gk));
      el.addEventListener('mouseleave', () => setHover(null));
      labelHost.appendChild(el);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '3.5');
      path.setAttribute('class', `lead ${g.blood || 'muscle'}`); dot.setAttribute('class', `ldot ${g.blood || 'muscle'}`);
      svg.append(path, dot);
      labels.push({ gk, anchor, el, path, dot, w: 0, h: 0, sx: 0, sy: 0, y: 0, side: 1 });
    }
  }

  const PANEL = 322; // left journey panel width + gutter
  const tmpV = new THREE.Vector3(), centerV = new THREE.Vector3(), sideV = new THREE.Vector3();
  const MOBILE_SET = ['cavRA', 'cavRV', 'cavLA', 'cavLV', 'aorta', 'pulmTrunk', 'svc'];
  function layoutLabels() {
    const w = root.clientWidth, h = root.clientHeight, mobile = w < 760;
    centerV.set(0, 0.05, 0).applyMatrix4(beatGroup.matrixWorld).project(camera);
    const cx = (centerV.x * 0.5 + 0.5) * w;
    sideV.copy(camera.position).sub(controls.target).cross(camera.up).normalize().multiplyScalar(0.62).add(new THREE.Vector3(0, 0.05, 0)).project(camera);
    const rr = Math.max(90, Math.abs((sideV.x * 0.5 + 0.5) * w - cx) * 1.15);
    const focus = state.selected || state.hover || (state.tour ? state.zone : null);
    const sides = { [-1]: [], [1]: [] };
    for (const L of labels) {
      tmpV.copy(L.anchor).applyMatrix4(beatGroup.matrixWorld).project(camera);
      L.sx = (tmpV.x * 0.5 + 0.5) * w; L.sy = (-tmpV.y * 0.5 + 0.5) * h;
      L.side = L.sx < cx ? -1 : 1;
      const zoneMatch = !!focus && (L.gk === focus || (focus === 'pulmArteries' && L.gk === 'pulmTrunk'));
      const crowd = state.selected && !mobile && L.side > 0 && !zoneMatch;
      const inView = !crowd && L.sx > 30 && L.sx < w - 30 && L.sy > 50 && L.sy < h - 50;
      const allowed = L.gk === 'coronaryA' ? state.cor : true;
      L.vis = state.labels && allowed && tmpV.z < 1 && inView && (!mobile || zoneMatch || MOBILE_SET.includes(L.gk));
      if (state.tour && !zoneMatch && L.vis) L.vis = !mobile && MOBILE_SET.includes(L.gk);
      L.active = zoneMatch;
      if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      if (L.vis) sides[L.side].push(L);
    }
    const gap = mobile ? 30 : 42;
    const top = mobile ? 92 : 150, bottom = h - (mobile ? 250 : 120);
    for (const s of [-1, 1]) {
      const arr = sides[s].sort((a, b) => a.sy - b.sy);
      arr.forEach((L) => { L.y = Math.min(bottom, Math.max(top, L.sy)); });
      for (let i = 1; i < arr.length; i++) if (arr[i].y - arr[i - 1].y < gap) arr[i].y = arr[i - 1].y + gap;
      const over = arr.length ? arr.at(-1).y - bottom : 0;
      if (over > 0) for (let i = arr.length - 1; i >= 0; i--) { arr[i].y -= over; if (i && arr[i].y - arr[i - 1].y >= gap) break; }
      for (let i = arr.length - 2; i >= 0; i--) if (arr[i + 1].y - arr[i].y < gap) arr[i].y = arr[i + 1].y - gap;
    }
    for (const L of labels) {
      L.el.classList.toggle('vis', L.vis);
      L.el.classList.toggle('active', L.active);
      L.path.classList.toggle('vis', L.vis); L.dot.classList.toggle('vis', L.vis);
      L.path.classList.toggle('active', L.active); L.dot.classList.toggle('active', L.active);
      if (!L.vis) continue;
      const colX = cx + L.side * (rr + (mobile ? 4 : 36));
      const lx = L.side < 0 ? Math.max(mobile ? 8 : PANEL + 16, colX - L.w) : Math.min(w - (mobile ? 8 : 16) - L.w - (state.selected && !mobile ? 350 : 0), colX);
      const ex = L.side < 0 ? lx + L.w + 6 : lx - 6;
      const elbowX = L.side < 0 ? Math.min(ex + 30, L.sx) : Math.max(ex - 30, L.sx);
      L.el.style.transform = `translate(${lx.toFixed(1)}px, ${(L.y - L.h / 2).toFixed(1)}px)`;
      L.path.setAttribute('d', `M${L.sx.toFixed(1)} ${L.sy.toFixed(1)} L${elbowX.toFixed(1)} ${L.y.toFixed(1)} L${ex.toFixed(1)} ${L.y.toFixed(1)}`);
      L.dot.setAttribute('cx', L.sx.toFixed(1)); L.dot.setAttribute('cy', L.sy.toFixed(1));
    }
  }

  // ---------------- modes ----------------
  const VESSELS = ['aorta', 'aortaBranches', 'pulmTrunk', 'pulmArteries', 'pulmVeins', 'svc', 'ivc'];
  function applyMode(instant) {
    const m = state.mode;
    for (const g of Object.values(groups)) {
      const gk = g.gk;
      const wall = gk.startsWith('wall'), cav = gk.startsWith('cav'), cor = gk === 'coronaryA' || gk === 'cardiacV';
      const vessel = VESSELS.includes(gk);
      let a0 = 1, a1 = 1, cap = 0, depthWrite = true, cut = false, visible = true;
      if (m === 'cut') {
        if (wall) { cut = true; cap = 1; }
        else if (cav) { cut = true; }   // opaque: its far side becomes the chamber's inner wall
        else if (cor || gk.startsWith('valve')) { cut = true; }
        else if (gk === 'pulmTrunk') { a0 = 0.32; a1 = 0.85; depthWrite = false; }   // it crosses in front: see through it
      } else if (m === 'xray') {
        if (wall) { a0 = 0.06; a1 = 0.5; depthWrite = false; }
        else if (cav) { a0 = 0.14; a1 = 0.32; depthWrite = false; }
        else if (vessel) { a0 = 0.3; a1 = 0.85; depthWrite = false; }
      } else if (cav) visible = false;
      if (cor && !state.cor) visible = false;
      g.target = { a0, a1, cap };
      if (instant) { g.u.a0.value = a0; g.u.a1.value = a1; g.u.cap.value = cap; }
      g.mat.depthWrite = depthWrite;
      const cp = [...(cut ? [cutPlane] : []), ...g.trim];
      g.mat.clippingPlanes = cp.length ? cp : null;
      g.mat.needsUpdate = true;
      g.meshes.forEach((mesh) => { mesh.visible = visible; });
    }
    // the section slides in from in front of the heart
    cutTarget = 0;
    if (m === 'cut' && !instant) cutOffset = 0.9;
    if (flow.arrows) { flow.arrows.material.depthTest = m === 'solid'; flow.arrows.material.needsUpdate = true; }
    root.dataset.mode = m;
  }

  // ---------------- picking, hover, select ----------------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let downAt = null;
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const list = pickables.filter((m) => m.visible && !(state.mode === 'xray' && m.userData.group.startsWith('wall')));
    const hits = ray.intersectObjects(list, false).filter((h) => !h.object.material.clippingPlanes || h.object.material.clippingPlanes.every((pl) => pl.distanceToPoint(h.point) >= 0));
    return hits[0]?.object.userData || null;
  }
  function setupPicking() {
    const el = renderer.domElement;
    let last = 0;
    el.addEventListener('pointermove', (e) => {
      if (e.buttons || e.pointerType === 'touch') { tip.hidden = true; return; }
      const now = performance.now(); if (now - last < 40) return; last = now;
      const hit = pick(e);
      setHover(hit?.group || null);
      if (hit) {
        tip.hidden = false;
        tip.innerHTML = `<b>${GROUPS[hit.group].el}</b><small>${hit.name}</small>`;
        tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
        el.style.cursor = 'pointer';
      } else { tip.hidden = true; el.style.cursor = 'grab'; }
    });
    el.addEventListener('pointerleave', () => { tip.hidden = true; setHover(null); });
    el.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY, performance.now()]; });
    el.addEventListener('pointerup', (e) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      if (moved < (e.pointerType === 'touch' ? 10 : 5) && performance.now() - downAt[2] < 500) {
        const hit = pick(e);
        if (hit) select(hit.group, hit.name); else select(null);
      }
      downAt = null;
    });
  }
  function setHover(gk) { state.hover = gk; }
  let focusTarget = null;
  function select(gk, enName) {
    state.selected = gk;
    if (!gk) { info.hidden = true; root.classList.remove('has-info'); focusTarget = null; return; }
    const g = GROUPS[gk];
    const chip = info.querySelector('.ex-info-chip');
    chip.className = `ex-info-chip ${g.blood || 'muscle'}`;
    chip.textContent = g.blood === 'o2' ? 'Αίμα με οξυγόνο' : g.blood === 'co2' ? 'Αίμα χωρίς οξυγόνο' : 'Καρδιακός μυς';
    info.querySelector('h3').textContent = g.el;
    info.querySelector('.ex-info-en').textContent = enName || g.en || manifest.groups[gk]?.[0]?.name || '';
    info.querySelector('.ex-info-text').textContent = g.text;
    info.hidden = false;
    info.classList.remove('pop'); void info.offsetWidth; info.classList.add('pop');
    root.classList.add('has-info');
    const L = labels.find((l) => l.gk === gk);
    focusTarget = L ? L.anchor.clone() : manifest.groups[gk] ? V(manifest.groups[gk][0].center) : null;
    userMoved = false;
  }

  // ---------------- UI wiring ----------------
  const stepsEl = $('.ex-steps');
  JOURNEY.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="tx"><b>${s.title}</b><small>${s.text}</small></span></button>`;
    li.querySelector('button').addEventListener('click', () => jumpTo(s.zone));
    stepsEl.appendChild(li);
  });
  const stepEls = [...stepsEl.children];
  const playBtn = $('.ex-play');
  playBtn.addEventListener('click', () => setTour(!state.tour));
  function showDrop(on) {
    if (!flow.drop) return;
    flow.drop.visible = on;
    if (!on) flow.trail.forEach((s) => { s.visible = false; });
  }
  function setTour(on) {
    state.tour = on;
    playBtn.classList.toggle('on', on);
    playBtn.querySelector('.ic').textContent = on ? '❚❚' : '▶';
    playBtn.querySelector('.lb').textContent = on ? 'Παύση' : (state.tourT > 0.001 ? 'Συνέχεια' : 'Ακολούθησε μια σταγόνα');
    showDrop(on || state.tourT > 0);
    root.classList.toggle('touring', on);
    if (on) { select(null); userMoved = false; }
  }
  let zoneT = null;
  function jumpTo(zone) {
    if (!ready) return;
    if (!zoneT) {
      zoneT = {};
      for (let i = 0; i <= 600; i++) { const T = i / 600; const z = zoneAt(dropAt(T)); if (z && !(z in zoneT)) zoneT[z] = T; }
    }
    if (zone in zoneT) state.tourT = zoneT[zone];
    flow.trailPts.length = 0;
    setTour(true);
  }

  const seg = $('.ex-seg'), segPill = $('.ex-seg-pill');
  const segBtns = [...seg.querySelectorAll('button')];
  const moveSeg = () => { const b = segBtns.find((x) => x.classList.contains('on')); segPill.style.width = b.offsetWidth + 'px'; segPill.style.transform = `translateX(${b.offsetLeft}px)`; };
  segBtns.forEach((b) => b.addEventListener('click', () => {
    segBtns.forEach((x) => x.classList.toggle('on', x === b)); moveSeg();
    state.mode = b.dataset.mode; if (ready) applyMode(false);
  }));
  root.querySelectorAll('.ex-tg button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === 'reset') { resetView(); return; }
    state[t] = !state[t]; b.classList.toggle('on', state[t]);
    if (t === 'flow' && flow.arrows) flow.arrows.visible = state.flow;
    if (t === 'cor' && ready) { applyMode(false); if (state.cor) select('coronaryA'); else if (state.selected === 'coronaryA') select(null); }
  }));
  $('.ex-close').addEventListener('click', () => close());
  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === ' ') { e.preventDefault(); setTour(!state.tour); }
  }, true);

  let userMoved = false;
  const HOME = { pos: new THREE.Vector3(), target: new THREE.Vector3(0.02, 0.1, 0), dist: 4 };
  const homePos = (out = HOME.pos) => out.copy(CUT_N).multiplyScalar(HOME.dist).add(HOME.target);
  function resetView() { setTour(false); state.tourT = 0; flow.trailPts.length = 0; showDrop(false); select(null); flyTo(homePos(), HOME.target); }
  let fly = null;
  function flyTo(pos, target, dur = 1.4) {
    fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), s: performance.now(), d: dur * 1000 };
    userMoved = false;
  }

  function resize() {
    if (!renderer) return;
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w < 760 ? 0 : -PANEL / 2, w < 760 ? h * 0.1 : 0, w, h);
    camera.updateProjectionMatrix();
    HOME.dist = w / h < 0.8 ? 6.6 : 4.1;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    labels.forEach((L) => { L.w = 0; });
    moveSeg();
  }

  // ---------------- per-frame ----------------
  function along(c, k, out) {
    const f = Math.min(0.99999, Math.max(0, k)) * (c.pts.length - 1), i = Math.floor(f);
    return out.copy(c.pts[i]).lerp(c.pts[i + 1], f - i);
  }
  function dropAt(T, out = new THREE.Vector3()) {
    const { blue, red } = flow.journey;
    if (T < 0.46) return along(blue, T / 0.46, out);
    if (T < 0.54) return out.copy(blue.pts.at(-1)).lerp(red.pts[0], (T - 0.46) / 0.08);
    return along(red, (T - 0.54) / 0.46, out);
  }
  function zoneAt(p) {
    let best = 1e9, zone = null;
    for (const z of flow.zones) for (const q of z.pts) { const d = q.distanceToSquared(p); if (d < best) { best = d; zone = z.zone; } }
    return zone;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), pv2 = new THREE.Vector3(), dir = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), dropPos = new THREE.Vector3(), swayV = new THREE.Vector3();
  const tmpCol = new THREE.Color();
  let phase = 0, last = performance.now(), flowT = 0, lastZone = null;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    const t = now / 1000;
    if (!ready) return;
    phase = (phase + dt * (state.beat ? 70 / 60 : 0)) % 1;
    const { atria, vent } = beatShape(phase);
    const b = state.beat ? vent : 0;
    beatGroup.scale.set(1 - 0.016 * b, 1 - 0.01 * b, 1 - 0.016 * b);
    beatGroup.updateMatrixWorld();

    // clipping planes follow the beating model
    cutOffset += (cutTarget - cutOffset) * Math.min(1, dt * 2.5);
    cutModel.constant = CUT_D + cutOffset;
    for (const pl of planes) pl.w.copy(pl.m).applyMatrix4(beatGroup.matrixWorld);

    const hiGroup = state.hover || state.selected || (state.tour ? state.zone : null);
    for (const g of Object.values(groups)) {
      const k = Math.min(1, dt * 6);
      g.u.a0.value += (g.target.a0 - g.u.a0.value) * k;
      g.u.a1.value += (g.target.a1 - g.u.a1.value) * k;
      g.u.cap.value += (g.target.cap - g.u.cap.value) * k;
      const gk = g.gk;
      const link = hiGroup === gk || (hiGroup === 'pulmArteries' && gk === 'pulmTrunk') || (hiGroup === 'aorta' && gk === 'aortaBranches') || (hiGroup === 'ivc' && gk === 'svc');
      const hi = link ? 0.4 + 0.15 * Math.sin(t * 4) : 0;
      g.u.hi.value += (hi - g.u.hi.value) * Math.min(1, dt * 8);
      const blood = GROUPS[gk].blood;
      g.u.hiC.value.set(blood === 'o2' ? '#ff6a7a' : blood === 'co2' ? '#7c98ff' : '#ffd0c4');
    }
    // valves brighten a little as they open: AV valves in diastole, semilunar in systole
    const dia = Math.max(0, 1 - vent * 1.6) * (0.4 + 0.6 * atria);
    for (const [gk, v] of [['valveTri', dia], ['valveMit', dia], ['valvePul', vent], ['valveAor', vent]]) groups[gk].mat.emissiveIntensity = state.beat ? 0.02 + 0.1 * v : 0.02;

    // flow arrows
    if (flow.arrows.visible) {
      flowT += dt * (0.25 + 1.3 * vent + 0.3 * atria) * 0.13;
      for (let i = 0; i < flow.items.length; i++) {
        const it = flow.items[i], s = flow.segs[it.si];
        const u = (it.o + flowT / s.len) % 1;
        along(s, u, pv);
        along(s, Math.min(1, u + 0.01), pv2);
        dir.subVectors(pv2, pv);
        if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
        q.setFromUnitVectors(UP, dir.normalize());
        sv.setScalar(Math.min(1, u * 8, (1 - u) * 8));
        m4.compose(pv, q, sv);
        flow.arrows.setMatrixAt(i, m4);
      }
      flow.arrows.instanceMatrix.needsUpdate = true;
      flow.arrows.material.opacity = state.tour ? 0.35 : 0.92;
    }

    // guided drop
    if (state.tour) {
      state.tourT += dt * (0.014 + 0.03 * vent);
      if (state.tourT >= 1) { state.tourT = 0; flow.trailPts.length = 0; }
    }
    if (flow.drop.visible) {
      dropAt(state.tourT, dropPos);
      flow.drop.position.copy(dropPos);
      const T = state.tourT;
      tmpCol.copy(T < 0.46 ? BLUE : T < 0.54 ? BLUE.clone().lerp(RED, (T - 0.46) / 0.08) : RED);
      flow.drop.userData.halo.material.color.copy(tmpCol).multiplyScalar(1.4);
      flow.drop.userData.ring.material.color.copy(tmpCol);
      const pulse = 1 + 0.35 * Math.sin(t * 6);
      flow.drop.userData.ring.scale.setScalar(0.2 * pulse);
      flow.drop.userData.core.material.color.copy(tmpCol).lerp(new THREE.Color('#ffffff'), 0.45).multiplyScalar(1.3);
      flow.drop.userData.ring.material.opacity = 1.2 - 0.5 * pulse;
      if (!flow.trailPts.length || flow.trailPts.at(-1).distanceTo(dropPos) > 0.018) { flow.trailPts.push(dropPos.clone()); if (flow.trailPts.length > flow.trail.length) flow.trailPts.shift(); }
      flow.trail.forEach((s, i) => {
        const p = flow.trailPts[flow.trailPts.length - 1 - i];
        s.visible = !!p;
        if (!p) return;
        s.position.copy(p);
        const k = 1 - i / flow.trail.length;
        s.scale.setScalar(0.09 * k + 0.02);
        s.material.color.copy(tmpCol); s.material.opacity = 0.75 * k;
      });
      const zone = zoneAt(dropPos);
      state.zone = zone;
      if (zone !== lastZone) {
        lastZone = zone;
        const idx = JOURNEY.findIndex((s) => s.zone === zone);
        stepEls.forEach((li, i) => { li.classList.toggle('on', i === idx); li.classList.toggle('done', state.tour && i < idx); });
        if (idx >= 0 && innerWidth >= 760) stepEls[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      if (state.tour && !userMoved && !fly) {
        // keep the section facing the viewer and glide towards the drop
        controls.target.lerp(pv.copy(dropPos).lerp(HOME.target, 0.35), Math.min(1, dt * 1.8));
        const want = pv2.copy(CUT_N).multiplyScalar(HOME.dist * (camera.aspect < 0.8 ? 0.95 : 0.72)).add(controls.target);
        camera.position.lerp(want, Math.min(1, dt * 1.2));
      }
    }

    if (fly) {
      const k = Math.min(1, (now - fly.s) / fly.d), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (k >= 1) fly = null;
    } else if (focusTarget && !state.tour && !userMoved) {
      controls.target.lerp(focusTarget, Math.min(1, dt * 3));
      const d = pv.copy(camera.position).sub(controls.target).normalize();
      const want = pv2.copy(focusTarget).addScaledVector(d, HOME.dist * 0.7);
      camera.position.lerp(want, Math.min(1, dt * 2));
      if (camera.position.distanceTo(want) < 0.01) focusTarget = null;
    }
    // idle: a gentle sway in the section view, a slow turn in the others
    const idle = !state.tour && !fly && !focusTarget && !userMoved;
    controls.autoRotate = idle && state.mode !== 'cut';
    controls.autoRotateSpeed = 0.45;
    if (idle && state.mode === 'cut') {
      homePos(swayV).sub(HOME.target).applyAxisAngle(UP, Math.sin(t * 0.35) * 0.12).add(HOME.target);
      camera.position.lerp(swayV, Math.min(1, dt * 0.8));
    }
    controls.update();
    composer.render();
    layoutLabels();
  }

  // ---------------- open / close ----------------
  async function open(origin) {
    if (isOpen) return;
    isOpen = true;
    const x = origin?.x ?? innerWidth / 2, y = origin?.y ?? innerHeight / 2;
    root.style.setProperty('--ox', x + 'px'); root.style.setProperty('--oy', y + 'px');
    root.classList.add('show');
    document.documentElement.classList.add('ex-open');
    onOpen?.();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
    if (!building) building = build().catch((err) => { root.classList.add('failed'); $('.ex-loading').textContent = 'Το μοντέλο δεν φόρτωσε. Ανανέωσε τη σελίδα.'; console.error(err); });
    await building;
    if (!isOpen || !ready) return;
    resize();
    camera.position.copy(homePos()).sub(HOME.target).multiplyScalar(2.4).add(HOME.target);
    controls.target.copy(HOME.target);
    cutOffset = 0.9; cutTarget = 0;
    flyTo(homePos(), HOME.target, 1.8);
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    setTimeout(() => { root.querySelector('.ex-close').focus({ preventScroll: true }); }, 50);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    setTour(false);
    root.classList.remove('open');
    document.documentElement.classList.remove('ex-open');
    onClose?.();
    setTimeout(() => { if (!isOpen) { root.classList.remove('show'); cancelAnimationFrame(raf); } }, 900);
  }

  return { open, close, get isOpen() { return isOpen; } };
}
