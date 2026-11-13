// Procedural anatomical heart: ventricles with grooves and epicardial fat,
// atria, great vessels and glowing coronary arteries with a travelling pulse.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { beatShape, smooth } from './ecg.js';

const AV_Y = 0.36;                  // coronary (AV) groove height on the unit sphere
const frontGX = (y) => 0.1 - 0.16 * y;   // anterior interventricular groove x(y)
const backGX = (y) => -0.05 - 0.1 * y;   // posterior groove

function grooveDepth(u) {
  const av = Math.exp(-(((u.y - AV_Y) / 0.07) ** 2));
  let iv = 0;
  if (u.y < AV_Y + 0.05) {
    if (u.z > 0) iv = Math.exp(-(((u.x - frontGX(u.y)) / 0.07) ** 2)) * smooth(0.0, 0.35, u.z);
    else iv = Math.exp(-(((u.x - backGX(u.y)) / 0.08) ** 2)) * smooth(0.0, 0.35, -u.z) * 0.8;
  }
  return { av, iv };
}

// Map a unit direction to a point on the ventricle surface.
function shape(u, out = new THREE.Vector3()) {
  let { x, y, z } = u;
  const a = smooth(0.25, -1.0, y);              // 0 at base, 1 at apex
  const s = 1 - 0.62 * Math.pow(a, 1.25);
  x *= s * 1.04; z *= s * 0.86;
  if (y < 0) y *= 1.42;
  if (y > 0.55) y = 0.55 + (y - 0.55) * 0.45;   // flat base where atria sit
  x += 0.42 * Math.pow(a, 1.6);                 // apex points to the patient's left
  z += 0.08 * Math.pow(a, 2);
  if (z < 0) z *= 0.9;
  const { av, iv } = grooveDepth(u);
  const bumps = 0.007 * Math.sin(u.x * 23 + u.y * 17) * Math.sin(u.z * 19 - u.y * 11)
    + 0.003 * Math.sin(u.x * 61 + u.z * 47);
  const k = 1 - 0.05 * av - 0.045 * iv + bumps;
  return out.set(x * k, y * k, z * k);
}

function surfPoint(u, lift = 0.018) {
  const p = shape(u);
  const p2 = shape(u.clone().multiplyScalar(1.0)).normalize();
  return p.addScaledVector(p2, lift);
}

const dirAV = (phi, y = AV_Y) => {
  const r = Math.sqrt(1 - y * y);
  return new THREE.Vector3(Math.sin(phi) * r, y, Math.cos(phi) * r);
};
const dirFront = (y) => {
  const x = frontGX(y);
  const z = Math.sqrt(Math.max(0.0001, 1 - y * y - x * x));
  return new THREE.Vector3(x, y, z);
};
const dirBack = (y) => {
  const x = backGX(y);
  const z = -Math.sqrt(Math.max(0.0001, 1 - y * y - x * x));
  return new THREE.Vector3(x, y, z);
};

const coronaryMat = (color, speed, offset) => new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(color) }, uO: { value: offset }, uS: { value: speed }, uDim: { value: 1 } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `uniform float uT,uO,uS,uDim; uniform vec3 uC; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){
      float f = fract(vUv.x*1.6 - uT*uS + uO);
      float pulse = pow(smoothstep(0.0,0.12,f)*(1.0-smoothstep(0.12,0.5,f)), 1.5);
      float rim = pow(1.0-abs(dot(vN,vV)), 1.5);
      vec3 col = uC*(0.75+0.6*rim) + vec3(1.0,0.85,0.6)*pulse*1.4;
      gl_FragColor = vec4(col*uDim, 1.0);
    }`,
});

export function createHeart(container) {
  const W = () => container.clientWidth, H = () => container.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;

  const camera = new THREE.PerspectiveCamera(32, W() / H(), 0.1, 100);
  camera.position.set(0, 0.35, 7.2);

  // Lights: warm key, cool blue rim from behind, red fill underneath.
  scene.add(new THREE.HemisphereLight(0xffd6dc, 0x1a0610, 0.55));
  const key = new THREE.DirectionalLight(0xfff0e6, 2.6); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x5a7dff, 3.2); rim.position.set(-4, 2, -5); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xff2a4a, 2.2); rim2.position.set(4, -1, -4); scene.add(rim2);
  const under = new THREE.PointLight(0xff3050, 6, 9); under.position.set(0, -2.6, 1.5); scene.add(under);

  const root = new THREE.Group();
  const heart = new THREE.Group();
  root.add(heart);
  scene.add(root);
  heart.rotation.set(0.05, -0.32, -0.18);

  // ----- ventricles -----
  let geo = new THREE.IcosahedronGeometry(1, 90);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const u = new THREE.Vector3(), p = new THREE.Vector3();
  const cMuscle = new THREE.Color('#9c1428'), cDeep = new THREE.Color('#5e0b1b'), cFat = new THREE.Color('#e2b25a');
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    u.fromBufferAttribute(pos, i).normalize();
    shape(u, p);
    pos.setXYZ(i, p.x, p.y, p.z);
    const { av, iv } = grooveDepth(u);
    const n = 0.5 + 0.5 * Math.sin(u.x * 9.1 + u.y * 5.3) * Math.sin(u.z * 7.7 - u.y * 3.1);
    tmp.copy(cMuscle).lerp(cDeep, 0.35 * n + 0.25 * smooth(0.2, -1, u.y));
    const fat = Math.min(1, Math.pow(av * 1.1, 1.4) * (0.65 + 0.35 * n) + Math.pow(iv, 1.6) * 0.8);
    tmp.lerp(cFat, fat * 0.85);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const muscleMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.36, metalness: 0.0,
    clearcoat: 1, clearcoatRoughness: 0.22,
    sheen: 0.55, sheenColor: new THREE.Color('#ff5a74'), sheenRoughness: 0.5,
  });
  const vent = new THREE.Mesh(geo, muscleMat);
  heart.add(vent);

  // Fresnel glow shell
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uC: { value: new THREE.Color('#ff2c4c') }, uI: { value: 0.9 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uC; uniform float uI; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.0-max(dot(vN,vV),0.0),2.6); gl_FragColor=vec4(uC*f*uI, f); }`,
  });
  const shell = new THREE.Mesh(geo, glowMat);
  shell.scale.setScalar(1.035);
  heart.add(shell);

  // ----- atria -----
  const atriaGroup = new THREE.Group();
  heart.add(atriaGroup);
  const atrium = (c, r, scl, col) => {
    const g2 = new THREE.SphereGeometry(r, 96, 96);
    const pp = g2.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      u.fromBufferAttribute(pp, i);
      const k = 1 + 0.04 * Math.sin(u.x * 18) * Math.sin(u.y * 15 + u.z * 9);
      pp.setXYZ(i, u.x * k, u.y * k, u.z * k);
    }
    g2.computeVertexNormals();
    const m = new THREE.Mesh(g2, new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.25, sheen: 1, sheenColor: new THREE.Color('#ff7a92') }));
    m.position.copy(c); m.scale.copy(scl);
    atriaGroup.add(m);
    return m;
  };
  atrium(new THREE.Vector3(-0.62, 0.62, 0.02), 0.42, new THREE.Vector3(1, 0.85, 1), '#6e1838');     // right atrium (bluish wine)
  atrium(new THREE.Vector3(-0.42, 0.82, 0.38), 0.2, new THREE.Vector3(1.3, 0.7, 0.8), '#7a1a3c');   // right auricle
  atrium(new THREE.Vector3(0.36, 0.7, -0.38), 0.36, new THREE.Vector3(1.1, 0.8, 1), '#8a1630');     // left atrium
  atrium(new THREE.Vector3(0.62, 0.66, 0.26), 0.16, new THREE.Vector3(1.4, 0.65, 0.85), '#951a34'); // left auricle

  // ----- great vessels -----
  const vessel = (pts, r, col, rough = 0.32) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((a) => new THREE.Vector3(...a)));
    const m = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 80, r, 40, false),
      new THREE.MeshPhysicalMaterial({ color: col, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.2, sheen: 0.8, sheenColor: new THREE.Color('#ffffff') })
    );
    heart.add(m);
    return { m, curve };
  };
  const cap = (curve, r, col) => {
    const end = curve.getPoint(1), t = curve.getTangent(1);
    const c = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, side: THREE.DoubleSide }));
    c.position.copy(end); c.lookAt(end.clone().add(t));
    heart.add(c);
  };
  const red = '#c8213a', blue = '#2f4fd0';
  const aorta = vessel([[-0.02, 0.62, 0.05], [-0.14, 1.25, 0.18], [0.0, 1.72, 0.05], [0.36, 1.78, -0.3], [0.5, 1.3, -0.62], [0.48, 0.2, -0.72], [0.45, -0.6, -0.75]], 0.21, red);
  cap(aorta.curve, 0.21, '#3a0710');
  for (const [t, dx, dz, h] of [[0.33, -0.14, 0.04, 0.62], [0.42, 0.0, 0.0, 0.58], [0.5, 0.14, -0.06, 0.55]]) {
    const b = aorta.curve.getPoint(t);
    const v = vessel([[b.x, b.y, b.z], [b.x + dx, b.y + h * 0.5, b.z + dz], [b.x + dx * 1.6, b.y + h, b.z + dz]], 0.075, red);
    cap(v.curve, 0.075, '#3a0710');
  }
  const pulm = vessel([[0.2, 0.62, 0.4], [0.26, 1.1, 0.38], [0.22, 1.32, 0.16]], 0.17, blue);
  const pl = vessel([[0.22, 1.3, 0.18], [0.55, 1.4, 0.0], [0.95, 1.36, -0.1]], 0.11, blue);
  const pr = vessel([[0.2, 1.3, 0.16], [-0.25, 1.38, -0.18], [-0.75, 1.32, -0.3]], 0.11, blue);
  cap(pl.curve, 0.11, '#0c1440'); cap(pr.curve, 0.11, '#0c1440');
  const svc = vessel([[-0.66, 0.85, -0.06], [-0.7, 1.4, -0.08], [-0.72, 2.0, -0.1]], 0.14, blue);
  cap(svc.curve, 0.14, '#0c1440');
  const ivc = vessel([[-0.55, 0.3, -0.3], [-0.58, -0.2, -0.38], [-0.6, -0.65, -0.4]], 0.13, blue);
  cap(ivc.curve, 0.13, '#0c1440');
  void pulm;

  // ----- coronary arteries (glowing) + cardiac veins -----
  const coronaries = [];
  const artery = (dirs, r, color, speed, offset) => {
    const pts = dirs.map((d) => surfPoint(d.normalize(), r * 0.7));
    const curve = new THREE.CatmullRomCurve3(pts);
    const mat = coronaryMat(color, speed, offset);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(40, dirs.length * 6), r, 12, false), mat);
    vent.add(m);
    coronaries.push(mat);
    return curve;
  };
  const range = (a, b, n, f) => Array.from({ length: n }, (_, i) => f(a + ((b - a) * i) / (n - 1)));
  // Left main + LAD down the front groove
  artery([dirAV(-0.15, AV_Y + 0.12), dirAV(0.05, AV_Y + 0.06), ...range(AV_Y, -0.97, 24, dirFront)], 0.036, '#ff9a3d', 0.9, 0);
  // Circumflex around the left side to the back
  artery(range(0.08, 2.5, 26, (ph) => dirAV(ph)), 0.032, '#ff8a3d', 0.9, 0.2);
  // RCA around the right side, then down the back
  artery([...range(-0.25, -2.7, 24, (ph) => dirAV(ph)), ...range(AV_Y - 0.08, -0.85, 14, dirBack)], 0.034, '#ff8a3d', 0.85, 0.45);
  // Diagonals off the LAD
  for (const [y0, len, off] of [[0.2, 0.55, 0.1], [-0.15, 0.5, 0.3], [-0.45, 0.4, 0.55]]) {
    artery(range(0, 1, 12, (t) => {
      const y = y0 - t * len; const x = frontGX(y0) + t * 0.62;
      return new THREE.Vector3(x, y, Math.sqrt(Math.max(0.01, 1 - x * x - y * y)));
    }), 0.016, '#ff7a3a', 1.1, off);
  }
  // Obtuse marginals off the circumflex
  for (const [ph, off] of [[1.15, 0.2], [1.7, 0.6]]) {
    artery(range(0, 1, 12, (t) => { const d = dirAV(ph + t * 0.25, AV_Y - t * 1.05); return d; }), 0.016, '#ff7a3a', 1.1, off);
  }
  // Acute marginal off the RCA
  artery(range(0, 1, 10, (t) => dirAV(-1.2 + t * 0.3, AV_Y - t * 0.9)), 0.015, '#ff7a3a', 1.1, 0.7);
  // Great cardiac vein (blue, beside the LAD)
  const veinMat = new THREE.MeshPhysicalMaterial({ color: '#3a5cff', emissive: '#1a2a9a', emissiveIntensity: 0.6, roughness: 0.35, clearcoat: 1 });
  {
    const pts = range(AV_Y - 0.05, -0.8, 18, (y) => { const x = frontGX(y) - 0.06; return surfPoint(new THREE.Vector3(x, y, Math.sqrt(Math.max(0.01, 1 - x * x - y * y))).normalize(), 0.014); });
    vent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.017, 10, false), veinMat));
    const pts2 = range(0.15, 2.3, 20, (ph) => surfPoint(dirAV(ph, AV_Y - 0.06), 0.014));
    vent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 80, 0.02, 10, false), veinMat));
  }

  // ----- floating blood cells around the heart -----
  const N = 260;
  const pg = new THREE.BufferGeometry();
  const pp = new Float32Array(N * 3), pc = new Float32Array(N * 3), ps = new Float32Array(N);
  const cRed = new THREE.Color('#ff3a55'), cBlue = new THREE.Color('#5a7dff');
  for (let i = 0; i < N; i++) {
    const r = 2.2 + Math.random() * 2.6, th = Math.random() * Math.PI * 2, y = (Math.random() - 0.5) * 4.5;
    pp.set([Math.cos(th) * r, y, Math.sin(th) * r - 1], i * 3);
    const c = Math.random() < 0.78 ? cRed : cBlue;
    pc.set([c.r, c.g, c.b], i * 3);
    ps[i] = 0.5 + Math.random();
  }
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
  pg.setAttribute('size', new THREE.BufferAttribute(ps, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uT: { value: 0 }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float size; varying vec3 vC; uniform float uT, uPR;
      void main(){ vC=color; vec3 p=position; p.y += sin(uT*0.4+position.x*1.3)*0.15; p.x += cos(uT*0.3+position.z)*0.1;
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize = size*uPR*26.0/ -mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); if(r>0.5) discard;
      float ring = smoothstep(0.5,0.32,r) * (0.55 + 0.45*smoothstep(0.08,0.3,r));
      gl_FragColor=vec4(vC*ring*0.9, ring*0.8); }`,
  });
  const motes = new THREE.Points(pg, pMat);
  scene.add(motes);


  // ----- controls -----
  let controls = null;
  if (window.matchMedia('(pointer: fine)').matches) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false; controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
    controls.target.set(0, 0.35, 0);
    controls.minPolarAngle = 0.6; controls.maxPolarAngle = 2.3;
  } else {
    renderer.domElement.style.touchAction = 'pan-y';
    renderer.domElement.style.cursor = 'default';
  }
  camera.lookAt(0, 0.35, 0);

  const fit = () => {
    camera.aspect = W() / H();
    camera.position.z = camera.aspect < 0.8 ? 9.4 : 7.2;
    camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  };
  window.addEventListener('resize', fit);
  fit();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(container);

  root.position.y = 0.05;

  return {
    update(t, phase) {
      if (!visible) return;
      const { atria, vent: v } = beatShape(phase);
      const sq = 1 - 0.055 * v;
      vent.scale.set(sq, 1 - 0.03 * v, sq);
      atriaGroup.scale.setScalar(1 - 0.06 * atria);
      heart.position.y = 0.02 * v;
      glowMat.uniforms.uI.value = 0.7 + 0.9 * v;
      under.intensity = 5 + 6 * v;
      for (const m of coronaries) m.uniforms.uT.value = t;
      pMat.uniforms.uT.value = t;
      motes.rotation.y = t * 0.03;
      if (controls) controls.update(); else root.rotation.y = t * 0.25;
      renderer.render(scene, camera);
    },
  };
}
