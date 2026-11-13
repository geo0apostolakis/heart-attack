// Full-window heart explorer built on the real BodyParts3D heart.
// X-ray / cut / solid views, blood flow through the real vessels, callout
// labels with leader lines, hover + click info, and a guided "follow one drop" tour.
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
const RED = new THREE.Color('#ff3352'), BLUE = new THREE.Color('#4a72ff');
const BIN_URL = `${import.meta.env.BASE_URL}heart/heart.bin`;

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
        <button type="button" data-mode="xray" class="on">Ακτινογραφία</button>
        <button type="button" data-mode="cut">Τομή</button>
        <button type="button" data-mode="solid">Συμπαγής</button>
      </div>
      <div class="ex-tg">
        <button type="button" data-t="flow" class="on"><i></i>Ροή</button>
        <button type="button" data-t="labels" class="on"><i></i>Ετικέτες</button>
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
function glassify(mat, u) {
  // fresnel-driven alpha so walls read like x-ray glass, plus darker inner faces in the cut view
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uA0 = u.a0; sh.uniforms.uA1 = u.a1; sh.uniforms.uHi = u.hi; sh.uniforms.uHiC = u.hiC;
    sh.fragmentShader = 'uniform float uA0, uA1, uHi; uniform vec3 uHiC;\n' + sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.2);
       diffuseColor.a = mix(uA0, uA1, fres);
       if (!gl_FrontFacing) outgoingLight *= 0.42;
       outgoingLight += uHiC * uHi * (0.35 + 0.65 * fres);
       #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'glass';
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
  const groups = {};          // group -> { meshes:[], mat, uniforms }
  const pickables = [];
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.6);
  const heartRoot = new THREE.Group();
  const beatGroup = new THREE.Group();
  const state = { mode: 'xray', flow: true, labels: true, beat: true, hover: null, selected: null, tour: false, tourT: 0, zone: null };

  // ---------------- build scene ----------------
  async function build() {
    const buf = await prefetchHeart();
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = bgTexture();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    camera = new THREE.PerspectiveCamera(30, 1, 0.02, 60);
    camera.position.set(0.6, 0.35, 9);

    scene.add(new THREE.HemisphereLight(0xffe2e6, 0x12040a, 0.6));
    const key = new THREE.DirectionalLight(0xfff1e8, 2.2); key.position.set(2.5, 3.5, 4); scene.add(key);
    const rimB = new THREE.DirectionalLight(0x5a7dff, 2.4); rimB.position.set(-4, 1.5, -4); scene.add(rimB);
    const rimR = new THREE.DirectionalLight(0xff2a4a, 1.8); rimR.position.set(4, -1.5, -3); scene.add(rimR);
    const camLight = new THREE.PointLight(0xffd6dc, 1.2, 8); camera.add(camLight); scene.add(camera);

    // the model sits at its true orientation: x = patient's left, y = up, z = front
    heartRoot.add(beatGroup);
    scene.add(heartRoot);

    const mk = (gk, base) => {
      const u = { a0: { value: 1 }, a1: { value: 1 }, hi: { value: 0 }, hiC: { value: new THREE.Color('#ffffff') } };
      const mat = glassify(new THREE.MeshPhysicalMaterial({ transparent: true, side: THREE.DoubleSide, ...base }), u);
      groups[gk] = { meshes: [], mat, u };
      return mat;
    };
    const muscle = { color: '#8c1a2a', roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 0.7, sheenColor: new THREE.Color('#ff7088'), sheenRoughness: 0.5 };
    const art = { color: '#c3203a', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.5, sheenColor: new THREE.Color('#ffb0bc') };
    const vein = { color: '#2d4fd2', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.5, sheenColor: new THREE.Color('#b0c4ff') };
    const MATS = {
      wallV: muscle, wallLA: { ...muscle, color: '#9a2235' }, wallRA: { ...muscle, color: '#7c1d3c' },
      cavRA: { color: '#3157e8', emissive: '#16299a', emissiveIntensity: 0.9, roughness: 0.6 },
      cavRV: { color: '#3157e8', emissive: '#16299a', emissiveIntensity: 0.9, roughness: 0.6 },
      cavLA: { color: '#e3243f', emissive: '#8a0a1e', emissiveIntensity: 0.9, roughness: 0.6 },
      cavLV: { color: '#e3243f', emissive: '#8a0a1e', emissiveIntensity: 0.9, roughness: 0.6 },
      valveTri: { color: '#f2d5c8', roughness: 0.5, sheen: 1, sheenColor: new THREE.Color('#ffffff'), emissive: '#ffb08a', emissiveIntensity: 0 },
      valvePul: { color: '#f2d5c8', roughness: 0.5, sheen: 1, sheenColor: new THREE.Color('#ffffff'), emissive: '#ffb08a', emissiveIntensity: 0 },
      valveMit: { color: '#f2d5c8', roughness: 0.5, sheen: 1, sheenColor: new THREE.Color('#ffffff'), emissive: '#ffb08a', emissiveIntensity: 0 },
      valveAor: { color: '#f2d5c8', roughness: 0.5, sheen: 1, sheenColor: new THREE.Color('#ffffff'), emissive: '#ffb08a', emissiveIntensity: 0 },
      coronaryA: { color: '#ff6a3d', emissive: '#ff4a20', emissiveIntensity: 0.55, roughness: 0.3, clearcoat: 1 },
      cardiacV: { color: '#4466ff', emissive: '#2238c8', emissiveIntensity: 0.45, roughness: 0.3, clearcoat: 1 },
      aorta: art, aortaBranches: art, pulmVeins: { ...art, color: '#d42a44' },
      pulmTrunk: vein, pulmArteries: vein, svc: vein, ivc: vein,
    };

    for (const [gk, parts] of Object.entries(manifest.groups)) {
      const mat = mk(gk, MATS[gk]);
      for (const p of parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, p.positions, p.vertexCount * 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(buf, p.normals, p.vertexCount * 3), 3, true));
        g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, p.indices, p.indexCount), 1));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat);
        m.userData = { group: gk, id: p.id, name: p.name };
        m.renderOrder = gk.startsWith('wall') ? 5 : gk.startsWith('cav') ? 3 : 1;
        beatGroup.add(m);
        groups[gk].meshes.push(m);
        pickables.push(m);
      }
    }

    buildFlow();
    buildLabels();

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.minDistance = 1.2; controls.maxDistance = 9;
    controls.enablePan = true; controls.screenSpacePanning = true;
    controls.target.set(0, 0.12, 0);
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
    x.fillStyle = '#060207'; x.fillRect(0, 0, 1024, 1024);
    let g = x.createRadialGradient(560, 470, 0, 560, 470, 620);
    g.addColorStop(0, 'rgba(120,14,38,0.55)'); g.addColorStop(0.45, 'rgba(60,6,22,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
    g = x.createRadialGradient(140, 900, 0, 140, 900, 520);
    g.addColorStop(0, 'rgba(50,80,220,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
    x.fillStyle = 'rgba(255,140,160,0.05)';
    for (let i = 0; i < 1024; i += 22) for (let j = 0; j < 1024; j += 22) x.fillRect(i, j, 1.4, 1.4);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---------------- blood flow ----------------
  const flow = { paths: [], mesh: null, parts: [], drop: null, trail: null, journey: null, zones: [] };
  const P = (id) => Object.values(manifest.groups).flat().find((p) => p.id === id);
  const line = (id) => P(id).line.pts.map(V);
  const rad = (id) => P(id).line.r;
  const gc = (gk) => { const c = new THREE.Vector3(); const ps = manifest.groups[gk]; ps.forEach((p) => c.add(V(p.center))); return c.divideScalar(ps.length); };
  const endNear = (pts, t) => (pts[0].distanceTo(t) < pts.at(-1).distanceTo(t) ? pts.slice().reverse() : pts);
  const startNear = (pts, t) => (pts[0].distanceTo(t) <= pts.at(-1).distanceTo(t) ? pts : pts.slice().reverse());
  const W = (pts, r) => pts.map((p) => ({ p, r }));

  function makePath(nodes, color, weight) {
    const clean = [];
    for (const n of nodes) if (!clean.length || clean.at(-1).p.distanceTo(n.p) > 0.03) clean.push(n);
    const curve = new THREE.CatmullRomCurve3(clean.map((n) => n.p), false, 'centripetal');
    const N = 420, pts = curve.getSpacedPoints(N);
    const radii = pts.map((pt) => { let best = 1e9, r = 0.05; for (const n of clean) { const d = n.p.distanceTo(pt); if (d < best) { best = d; r = n.r; } } return r; });
    const len = curve.getLength();
    return { pts, radii, color, weight, len };
  }

  function buildFlow() {
    const RA = gc('cavRA'), RV = gc('cavRV'), LA = gc('cavLA'), LV = gc('cavLV');
    const TRI = gc('valveTri'), PUL = gc('valvePul'), MIT = gc('valveMit'), AOV = gc('valveAor');
    const RVlow = RV.clone().add(new THREE.Vector3(-0.04, -0.2, 0.0));
    const RVout = RV.clone().lerp(PUL, 0.55).add(new THREE.Vector3(0, 0, 0.03));
    const LVapex = LV.clone().add(new THREE.Vector3(0.14, -0.22, 0.1));
    const LVout = LV.clone().lerp(AOV, 0.55);
    const SVC = endNear(line('FJ3645'), RA), IVC = endNear(line('FJ3441'), RA);
    const RBV = endNear(line('FJ3583'), SVC[0]), LBV = endNear(line('FJ3482'), SVC[0]);
    const trunk = startNear(line('FJ2966'), PUL);
    const LPA = startNear(line('FJ2924'), trunk.at(-1)), RPA = startNear(line('FJ3019'), trunk.at(-1));
    const asc = startNear(line('FJ3413'), AOV), arch = startNear(line('FJ3411'), asc.at(-1)), desc = startNear(line('FJ1931'), arch.at(-1));

    const rightHeart = [...W([RA], 0.12), ...W([TRI], 0.06), ...W([RVlow, RV, RVout], 0.1), ...W([PUL], 0.06), ...W(trunk, rad('FJ2966') * 0.7)];
    const lpa = W(LPA, rad('FJ2924') * 0.7), rpa = W(RPA, rad('FJ3019') * 0.7);
    const svcIn = (bv, id) => [...W(bv, rad(id) * 0.7), ...W(SVC, rad('FJ3645') * 0.7)];
    const ivcIn = W(IVC, rad('FJ3441') * 0.7);
    for (const [src, out, w] of [[svcIn(RBV, 'FJ3583'), lpa, 1], [svcIn(LBV, 'FJ3482'), rpa, 1], [ivcIn, lpa, 1.3], [ivcIn, rpa, 1.3]]) {
      flow.paths.push(makePath([...src, ...rightHeart, ...out], BLUE, w));
    }
    const leftHeart = [...W([LA], 0.12), ...W([MIT], 0.06), ...W([LV, LVapex, LV, LVout], 0.1), ...W([AOV], 0.06), ...W(asc, rad('FJ3413') * 0.7)];
    const archW = W(arch, rad('FJ3411') * 0.7), descW = W(desc, rad('FJ1931') * 0.7);
    for (const id of ['FJ2925', 'FJ2933', 'FJ2944', 'FJ2950', 'FJ2955', 'FJ3020', 'FJ3040']) {
      flow.paths.push(makePath([...W(endNear(line(id), LA), rad(id) * 0.7), ...leftHeart, ...archW, ...descW], RED, 0.9));
    }
    for (const id of ['FJ3417', 'FJ3483', 'FJ3479']) {
      const br = line(id);
      let k = 0, best = 1e9;
      arch.forEach((a, i) => { const d = Math.min(a.distanceTo(br[0]), a.distanceTo(br.at(-1))); if (d < best) { best = d; k = i; } });
      const brO = startNear(br, arch[k]);
      flow.paths.push(makePath([...W(endNear(line('FJ3020'), LA), 0.03), ...leftHeart, ...archW.slice(0, k + 1), ...W(brO, rad(id) * 0.7)], RED, 0.7));
    }

    // instanced glowing cells
    const total = 2600;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false });
    flow.mesh = new THREE.InstancedMesh(geo, mat, total);
    flow.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flow.mesh.frustumCulled = false;
    flow.mesh.renderOrder = 4;
    const wsum = flow.paths.reduce((s, p) => s + p.weight, 0);
    for (let i = 0; i < total; i++) {
      let r = Math.random() * wsum, pi = 0;
      while (r > flow.paths[pi].weight) { r -= flow.paths[pi].weight; pi++; }
      const path = flow.paths[pi];
      flow.parts.push({ pi, t: Math.random(), sp: (0.8 + Math.random() * 0.4) / path.len, off: new THREE.Vector3().randomDirection().multiplyScalar(Math.sqrt(Math.random())), s: 0.0065 + Math.random() * 0.0065 });
      flow.mesh.setColorAt(i, path.color.clone().multiplyScalar(1.6 + Math.random() * 0.8));
    }
    beatGroup.add(flow.mesh);

    // the guided drop + its trail
    const blue = makePath([...ivcIn, ...rightHeart, ...lpa], BLUE, 1);
    const red = makePath([...W(endNear(line('FJ2925'), LA), rad('FJ2925') * 0.7), ...leftHeart, ...archW, ...descW], RED, 1);
    flow.journey = { blue, red };
    flow.drop = new THREE.Mesh(new THREE.SphereGeometry(0.035, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
    flow.drop.visible = false;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex(), color: '#ffffff', depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.scale.setScalar(0.4); flow.drop.add(halo);
    beatGroup.add(flow.drop);
    const TR = 60;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TR * 3), 3));
    flow.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, toneMapped: false }));
    flow.trail.frustumCulled = false; flow.trail.visible = false; flow.trailPts = [];
    beatGroup.add(flow.trail);

    // zones for "where is the drop now"
    const zonePts = {
      ivc: [...IVC, ...SVC], cavRA: [RA], valveTri: [TRI], cavRV: [RVlow, RV, RVout], valvePul: [PUL],
      pulmArteries: [...trunk, ...LPA, ...RPA], pulmVeins: line('FJ2925'), cavLA: [LA], valveMit: [MIT], cavLV: [LV, LVapex, LVout], valveAor: [AOV], aorta: [...asc, ...arch, ...desc],
    };
    flow.zones = Object.entries(zonePts).map(([zone, pts]) => ({ zone, pts }));
    flow.anchors = { RA, RV, LA, LV, TRI, PUL, MIT, AOV, SVC, IVC, trunk, LPA, RPA, asc, arch, desc };
  }

  function dotTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
  }

  // ---------------- labels with leader lines ----------------
  const labels = [];
  function buildLabels() {
    const A = flow.anchors;
    const mid = (pts, f = 0.5) => pts[Math.min(pts.length - 1, Math.round((pts.length - 1) * f))];
    const defs = [
      ['svc', mid(A.SVC, 0.35)], ['ivc', mid(A.IVC, 0.8)], ['cavRA', A.RA], ['cavRV', A.RV], ['cavLA', A.LA], ['cavLV', A.LV],
      ['valveTri', A.TRI], ['valvePul', A.PUL], ['valveMit', A.MIT], ['valveAor', A.AOV],
      ['pulmTrunk', mid(A.trunk, 0.5)], ['pulmArteries', mid(A.LPA, 0.55)], ['pulmVeins', V(P('FJ3020').center)],
      ['aorta', mid(A.arch, 0.35)], ['coronaryA', V(P('FJ2631').center)], ['wallV', new THREE.Vector3(0.42, -0.28, 0.28)],
    ];
    for (const [gk, anchor] of defs) {
      const g = GROUPS[gk];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `ex-lbl ${g.blood || 'muscle'}`;
      el.innerHTML = `<b>${g.el}</b><small>${g.blood === 'o2' ? 'με οξυγόνο' : g.blood === 'co2' ? 'χωρίς οξυγόνο' : 'μυς'}</small>`;
      el.addEventListener('click', () => select(gk, true));
      el.addEventListener('mouseenter', () => setHover(gk));
      el.addEventListener('mouseleave', () => setHover(null));
      labelHost.appendChild(el);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '3.2');
      path.setAttribute('class', `lead ${g.blood || 'muscle'}`); dot.setAttribute('class', `ldot ${g.blood || 'muscle'}`);
      svg.append(path, dot);
      labels.push({ gk, anchor, el, path, dot, w: 0, h: 0, sx: 0, sy: 0, y: 0, side: 1 });
    }
  }

  const PANEL = 322; // left journey panel width + gutter
  const tmpV = new THREE.Vector3(), centerV = new THREE.Vector3();
  function layoutLabels() {
    const w = root.clientWidth, h = root.clientHeight, mobile = w < 760;
    const show = state.labels;
    beatGroup.updateMatrixWorld();
    centerV.set(0, 0.05, 0).applyMatrix4(beatGroup.matrixWorld).project(camera);
    const cx = (centerV.x * 0.5 + 0.5) * w;
    // heart radius on screen
    tmpV.set(0.62, 0.05, 0).applyMatrix4(beatGroup.matrixWorld).project(camera);
    const rr = Math.max(80, Math.abs((tmpV.x * 0.5 + 0.5) * w - cx) * 1.25);
    const focus = state.selected || state.hover || (state.tour ? state.zone : null);
    const sides = { [-1]: [], [1]: [] };
    for (const L of labels) {
      tmpV.copy(L.anchor).applyMatrix4(beatGroup.matrixWorld).project(camera);
      L.sx = (tmpV.x * 0.5 + 0.5) * w; L.sy = (-tmpV.y * 0.5 + 0.5) * h;
      L.side = L.sx < cx ? -1 : 1;
      const zoneMatch = focus && (L.gk === focus || (focus === 'pulmArteries' && L.gk === 'pulmTrunk') || (focus === 'ivc' && L.gk === 'svc'));
      const crowd = state.selected && !mobile && L.side > 0 && !zoneMatch;
      const inView = !crowd && L.sx > 40 && L.sx < w - 40 && L.sy > 60 && L.sy < h - 60;
      L.vis = show && tmpV.z < 1 && inView && (!state.tour || zoneMatch || labels.indexOf(L) % 2 === 0) && (!mobile || zoneMatch || ['cavRA', 'cavRV', 'cavLA', 'cavLV', 'aorta', 'pulmTrunk'].includes(L.gk));
      L.active = !!zoneMatch;
      if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      if (L.vis) sides[L.side].push(L);
    }
    const gap = mobile ? 30 : 40;
    const top = mobile ? 90 : 150, bottom = h - (mobile ? 250 : 120);
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
      const colX = cx + L.side * (rr + (mobile ? 6 : 40));
      const lx = L.side < 0 ? Math.max(mobile ? 8 : PANEL + 16, colX - L.w) : Math.min(w - (mobile ? 8 : 16) - L.w - (state.selected && !mobile ? 350 : 0), colX);
      const ex = L.side < 0 ? lx + L.w + 6 : lx - 6;
      const elbowX = cx + L.side * rr * 0.92;
      L.el.style.transform = `translate(${lx.toFixed(1)}px, ${(L.y - L.h / 2).toFixed(1)}px)`;
      L.path.setAttribute('d', `M${L.sx.toFixed(1)} ${L.sy.toFixed(1)} L${elbowX.toFixed(1)} ${L.y.toFixed(1)} L${ex.toFixed(1)} ${L.y.toFixed(1)}`);
      L.dot.setAttribute('cx', L.sx.toFixed(1)); L.dot.setAttribute('cy', L.sy.toFixed(1));
    }
  }

  // ---------------- modes ----------------
  function applyMode(instant) {
    const m = state.mode;
    for (const [gk, g] of Object.entries(groups)) {
      const wall = gk.startsWith('wall'), cav = gk.startsWith('cav');
      const vessel = ['aorta', 'aortaBranches', 'pulmTrunk', 'pulmArteries', 'pulmVeins', 'svc', 'ivc'].includes(gk);
      let a0 = 1, a1 = 1, depthWrite = true, clipOn = false, visible = true;
      if (m === 'xray') {
        if (wall) { a0 = 0.07; a1 = 0.6; depthWrite = false; }
        else if (cav) { a0 = 0.1; a1 = 0.38; depthWrite = false; }
        else if (vessel) { a0 = 0.16; a1 = 0.85; depthWrite = false; }
      } else if (m === 'cut') {
        if (wall || vessel) { clipOn = true; }
        if (cav) { a0 = 0.32; a1 = 0.55; depthWrite = false; clipOn = true; }
      } else {
        if (cav) visible = false;
      }
      g.target = { a0, a1 };
      if (instant) { g.u.a0.value = a0; g.u.a1.value = a1; }
      g.mat.depthWrite = depthWrite;
      g.mat.clippingPlanes = clipOn ? [clip] : null;
      g.mat.needsUpdate = true;
      g.meshes.forEach((mesh) => { mesh.visible = visible; });
    }
    clipTarget = m === 'cut' ? 0.08 : 0.9;
    if (instant) clip.constant = clipTarget;
  }
  let clipTarget = 0.9;

  // ---------------- picking, hover, select ----------------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let downAt = null;
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const list = pickables.filter((m) => m.visible && !(state.mode === 'xray' && m.userData.group.startsWith('wall')) && !(state.mode !== 'solid' && m.userData.group.startsWith('cav') && false));
    const hits = ray.intersectObjects(list, false).filter((h) => !h.object.material.clippingPlanes || clip.distanceToPoint(h.point) >= 0);
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
        if (hit) select(hit.group, false, hit.name); else select(null);
      }
      downAt = null;
    });
  }
  function setHover(gk) { state.hover = gk; }
  let focusTarget = null;
  function select(gk, focus, enName) {
    state.selected = gk;
    if (!gk) { info.hidden = true; root.classList.remove('has-info'); return; }
    const g = GROUPS[gk];
    const chip = info.querySelector('.ex-info-chip');
    chip.className = `ex-info-chip ${g.blood || 'muscle'}`;
    chip.textContent = g.blood === 'o2' ? 'Αίμα με οξυγόνο' : g.blood === 'co2' ? 'Αίμα χωρίς οξυγόνο' : 'Καρδιακός μυς';
    info.querySelector('h3').textContent = g.el;
    info.querySelector('.ex-info-en').textContent = enName || manifest.groups[gk][0].name;
    info.querySelector('.ex-info-text').textContent = g.text;
    info.hidden = false;
    info.classList.remove('pop'); void info.offsetWidth; info.classList.add('pop');
    root.classList.add('has-info');
    if (focus || true) {
      const c = new THREE.Vector3();
      const L = labels.find((l) => l.gk === gk);
      if (L) c.copy(L.anchor); else c.copy(V(manifest.groups[gk][0].center));
      focusTarget = c;
      userMoved = false;
    }
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
  function setTour(on) {
    state.tour = on;
    playBtn.classList.toggle('on', on);
    playBtn.querySelector('.ic').textContent = on ? '❚❚' : '▶';
    playBtn.querySelector('.lb').textContent = on ? 'Παύση' : (state.tourT > 0.001 ? 'Συνέχεια' : 'Ακολούθησε μια σταγόνα');
    if (flow.drop) { flow.drop.visible = on || state.tourT > 0; flow.trail.visible = flow.drop.visible; }
    root.classList.toggle('touring', on);
    if (on) { select(null); userMoved = false; }
  }
  let zoneT = null;
  function jumpTo(zone) {
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
    state.mode = b.dataset.mode; applyMode(false);
  }));
  root.querySelectorAll('.ex-tg button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === 'reset') { resetView(); return; }
    state[t] = !state[t]; b.classList.toggle('on', state[t]);
    if (t === 'flow' && flow.mesh) flow.mesh.visible = state.flow;
  }));
  $('.ex-close').addEventListener('click', () => close());
  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); setTour(!state.tour); }
    e.stopPropagation();
  }, true);

  let userMoved = false;
  const HOME = { pos: new THREE.Vector3(0.75, 0.38, 3.9), target: new THREE.Vector3(0.02, 0.1, 0) };
  function resetView() { setTour(false); state.tourT = 0; flow.trailPts.length = 0; if (flow.drop) { flow.drop.visible = false; flow.trail.visible = false; } select(null); focusTarget = null; flyTo(HOME.pos, HOME.target); }
  let fly = null;
  function flyTo(pos, target, dur = 1.4) {
    fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), s: performance.now(), d: dur * 1000 };
  }

  function resize() {
    if (!renderer) return;
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h;
    // phones: heart sits above the bottom sheet
    camera.setViewOffset(w, h, w < 760 ? 0 : -PANEL / 2, w < 760 ? h * 0.1 : 0, w, h);
    camera.updateProjectionMatrix();
    HOME.pos.set(0.75, 0.38, w / h < 0.8 ? 6.4 : 3.9);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    labels.forEach((L) => { L.w = 0; });
    moveSeg();
  }

  // ---------------- per-frame ----------------
  function dropAt(T, out = new THREE.Vector3()) {
    const { blue, red } = flow.journey;
    if (T < 0.47) { const k = (T / 0.47) * (blue.pts.length - 1); return out.copy(blue.pts[Math.floor(k)]).lerp(blue.pts[Math.min(blue.pts.length - 1, Math.floor(k) + 1)], k % 1); }
    if (T < 0.53) { return out.copy(blue.pts.at(-1)).lerp(red.pts[0], (T - 0.47) / 0.06); }
    const k = ((T - 0.53) / 0.47) * (red.pts.length - 1);
    return out.copy(red.pts[Math.floor(k)]).lerp(red.pts[Math.min(red.pts.length - 1, Math.floor(k) + 1)], k % 1);
  }
  function zoneAt(p) {
    let best = 1e9, zone = null;
    for (const z of flow.zones) for (const q of z.pts) { const d = q.distanceToSquared(p); if (d < best) { best = d; zone = z.zone; } }
    return zone;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), dropPos = new THREE.Vector3();
  let phase = 0, last = performance.now(), openT = 0, lastZone = null;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    const t = now / 1000;
    if (!ready) return;
    phase = (phase + dt * (state.beat ? 70 / 60 : 0)) % 1;
    const { atria, vent } = beatShape(phase);
    const b = state.beat ? vent : 0;
    beatGroup.scale.set(1 - 0.018 * b, 1 - 0.012 * b, 1 - 0.018 * b);

    // intro dolly
    openT = Math.min(1, openT + dt / 1.6);

    // material easing + highlight
    const hiGroup = state.hover || state.selected || (state.tour ? state.zone : null);
    for (const [gk, g] of Object.entries(groups)) {
      g.u.a0.value += (g.target.a0 - g.u.a0.value) * Math.min(1, dt * 6);
      g.u.a1.value += (g.target.a1 - g.u.a1.value) * Math.min(1, dt * 6);
      const zoneLink = hiGroup === gk || (hiGroup === 'pulmArteries' && gk === 'pulmTrunk') || (hiGroup === 'ivc' && gk === 'svc') || (hiGroup === 'aorta' && gk === 'aortaBranches');
      const hi = zoneLink ? 0.55 + 0.25 * Math.sin(t * 4) : 0;
      g.u.hi.value += (hi - g.u.hi.value) * Math.min(1, dt * 8);
      const blood = GROUPS[gk].blood;
      g.u.hiC.value.set(blood === 'o2' ? '#ff6a80' : blood === 'co2' ? '#7a96ff' : '#ffb0a0');
    }
    // valves glow when they open: AV valves in diastole, semilunar in systole
    const sys = vent, dia = Math.max(0, 1 - vent * 1.6) * (0.4 + 0.6 * atria);
    for (const [gk, v] of [['valveTri', dia], ['valveMit', dia], ['valvePul', sys], ['valveAor', sys]]) groups[gk].mat.emissiveIntensity = state.beat ? 0.15 + 0.9 * v : 0.1;
    groups.coronaryA.mat.emissiveIntensity = 0.45 + 0.5 * b;

    clip.constant += (clipTarget - clip.constant) * Math.min(1, dt * 3);

    // blood cells
    if (flow.mesh.visible) {
      const pump = 0.35 + 1.5 * vent + 0.4 * atria;
      for (let i = 0; i < flow.parts.length; i++) {
        const c = flow.parts[i], path = flow.paths[c.pi];
        c.t += c.sp * dt * pump * 0.55;
        c.t = ((c.t % 1) + 1) % 1;
        const k = c.t * (path.pts.length - 1), i0 = Math.floor(k);
        pv.copy(path.pts[i0]).lerp(path.pts[Math.min(path.pts.length - 1, i0 + 1)], k - i0);
        const r = path.radii[i0];
        pv.addScaledVector(c.off, r);
        const fade = Math.min(1, c.t * 25, (1 - c.t) * 25);
        sv.setScalar(c.s * fade);
        m4.compose(pv, q, sv);
        flow.mesh.setMatrixAt(i, m4);
      }
      flow.mesh.instanceMatrix.needsUpdate = true;
      if (flow.mesh.instanceColor && !flow.colorsSet) { flow.mesh.instanceColor.needsUpdate = true; flow.colorsSet = true; }
    }

    // guided drop
    if (state.tour) {
      state.tourT += dt * (0.016 + 0.034 * vent);
      if (state.tourT >= 1) { state.tourT = 0; flow.trailPts.length = 0; }
    }
    if (flow.drop.visible) {
      dropAt(state.tourT, dropPos);
      flow.drop.position.copy(dropPos);
      const col = state.tourT < 0.47 ? BLUE : state.tourT < 0.53 ? BLUE.clone().lerp(RED, (state.tourT - 0.47) / 0.06) : RED;
      flow.drop.children[0].material.color.copy(col);
      flow.trail.material.color.copy(col);
      flow.trailPts.push(dropPos.clone()); if (flow.trailPts.length > 60) flow.trailPts.shift();
      const arr = flow.trail.geometry.attributes.position.array;
      for (let i = 0; i < 60; i++) { const p = flow.trailPts[Math.max(0, flow.trailPts.length - 60 + i)] || dropPos; arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; }
      flow.trail.geometry.attributes.position.needsUpdate = true;
      const zone = zoneAt(dropPos);
      state.zone = zone;
      if (zone !== lastZone) {
        lastZone = zone;
        const idx = JOURNEY.findIndex((s) => s.zone === zone);
        stepEls.forEach((li, i) => { li.classList.toggle('on', i === idx); li.classList.toggle('done', state.tour && i < idx); });
        if (idx >= 0 && innerWidth >= 760) stepEls[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      if (state.tour && !userMoved) {
        // camera follows the drop from a slowly orbiting angle
        const ang = 0.5 + state.tourT * 2.2;
        const dist = camera.aspect < 0.8 ? 5 : 3.3;
        const want = new THREE.Vector3(Math.sin(ang) * dist, 0.5 + dropPos.y * 0.4, Math.cos(ang) * dist).add(dropPos.clone().multiplyScalar(0.6));
        controls.target.lerp(dropPos, Math.min(1, dt * 2.2));
        camera.position.lerp(want, Math.min(1, dt * 0.9));
      }
    }

    if (fly) {
      const k = Math.min(1, (now - fly.s) / fly.d), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (k >= 1) fly = null;
    } else if (focusTarget && !state.tour && !userMoved) {
      controls.target.lerp(focusTarget, Math.min(1, dt * 3));
      const dir = camera.position.clone().sub(controls.target).normalize();
      const want = focusTarget.clone().addScaledVector(dir, camera.aspect < 0.8 ? 4.2 : 2.6);
      camera.position.lerp(want, Math.min(1, dt * 2));
      if (camera.position.distanceTo(want) < 0.01) focusTarget = null;
    }
    if (!state.tour && !fly && !focusTarget && !userMoved && openT >= 1) {
      controls.autoRotate = true; controls.autoRotateSpeed = 0.5;
    } else controls.autoRotate = false;
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
    if (!isOpen) return;
    openT = 0;
    camera.position.set(1.6, 0.9, 10);
    controls.target.copy(HOME.target);
    flyTo(HOME.pos, HOME.target, 1.8);
    userMoved = false;
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
