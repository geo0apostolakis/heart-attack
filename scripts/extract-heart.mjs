// Extracts the heart, its valves, coronary vessels and great vessels from the
// Human Atlas build of BodyParts3D 4.0 (CC BY 4.0, The Database Center for Life Science)
// into one compact binary for the heart explorer.
//
// Usage: node scripts/extract-heart.mjs <path to human-atlas/public/models>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('Pass the human-atlas public/models folder'); process.exit(1); }
const atlas = JSON.parse(readFileSync(path.join(src, 'atlas.json'), 'utf8'));

// group -> ids. Order matters for draw order (opaque first, glassy walls last).
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `FJ${a + i}`);
const byId = new Map(atlas.parts.map((p) => [p.id, p]));
const GROUPS = {
  cavRA: ['FJ2424'], cavRV: ['FJ2423'], cavLA: ['FJ2425'], cavLV: ['FJ2422'],
  valveTri: ['FJ2421', 'FJ2433', 'FJ2436'],
  valvePul: ['FJ2417', 'FJ2427', 'FJ2434'],
  valveMit: ['FJ2420', 'FJ2432'],
  valveAor: ['FJ2426', 'FJ2431', 'FJ2435'],
  coronaryA: range(2631, 2737).filter((id) => byId.get(id)?.system === 'arterial'),
  cardiacV: range(2655, 2731).filter((id) => byId.get(id)?.system === 'venous'),
  aorta: ['FJ3413', 'FJ3411', 'FJ1931'],
  aortaBranches: ['FJ3417', 'FJ3483', 'FJ3479', 'FJ3564', 'FJ3579'],
  pulmTrunk: ['FJ2966'],
  pulmArteries: ['FJ2924', 'FJ3019'],
  pulmVeins: ['FJ2925', 'FJ2933', 'FJ2944', 'FJ2950', 'FJ2955', 'FJ3020', 'FJ3040'],
  svc: ['FJ3645', 'FJ3482', 'FJ3583'],
  ivc: ['FJ3441'],
  wallRA: ['FJ2439'], wallLA: ['FJ2438'], wallV: ['FJ2428'],
};

const VESSELS = new Set(['aorta', 'aortaBranches', 'pulmTrunk', 'pulmArteries', 'pulmVeins', 'svc', 'ivc']);

// Ordered centreline of a tube: principal axis by power iteration, then bin
// the vertices along it and average each bin. r = mean distance to the bin centre.
function centerline(pos, bins = 14) {
  const n = pos.length / 3, m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) m[k] += pos[i * 3 + k] / n;
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const d = [0, 1, 2].map((k) => pos[i * 3 + k] - m[k]);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += d[a] * d[b];
  }
  let v = [1, 0.7, 0.3];
  for (let it = 0; it < 60; it++) {
    const w = [0, 1, 2].map((a) => cov[a][0] * v[0] + cov[a][1] * v[1] + cov[a][2] * v[2]);
    const l = Math.hypot(...w); v = w.map((x) => x / l);
  }
  const t = new Float32Array(n); let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { t[i] = (pos[i * 3] - m[0]) * v[0] + (pos[i * 3 + 1] - m[1]) * v[1] + (pos[i * 3 + 2] - m[2]) * v[2]; lo = Math.min(lo, t[i]); hi = Math.max(hi, t[i]); }
  const acc = Array.from({ length: bins }, () => [0, 0, 0, 0]);
  const bi = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const b = Math.min(bins - 1, Math.floor(((t[i] - lo) / (hi - lo)) * bins)); bi[i] = b;
    for (let k = 0; k < 3; k++) acc[b][k] += pos[i * 3 + k]; acc[b][3]++;
  }
  const pts = acc.filter((a) => a[3] > 0).map((a) => [a[0] / a[3], a[1] / a[3], a[2] / a[3]]);
  const rad = new Array(bins).fill(0), cnt = new Array(bins).fill(0);
  const means = acc.map((a) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : null));
  for (let i = 0; i < n; i++) { const c = means[bi[i]]; rad[bi[i]] += Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]); cnt[bi[i]]++; }
  const r = rad.map((x, i) => (cnt[i] ? x / cnt[i] : 0)).filter((_, i) => cnt[i]);
  return { pts: pts.map((p) => p.map((x) => +x.toFixed(4))), r: +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(4) };
}

const chunks = new Map();
const chunk = (i) => {
  if (!chunks.has(i)) chunks.set(i, readFileSync(path.join(src, atlas.chunks[i].url.split('/').pop())));
  return chunks.get(i);
};

// centre on the heart walls, scale metres -> decimetres (heart ~1.2 units wide)
const walls = ['FJ2428', 'FJ2438', 'FJ2439'].map((id) => byId.get(id));
const mn = [0, 1, 2].map((k) => Math.min(...walls.map((p) => p.bounds[0][k])));
const mx = [0, 1, 2].map((k) => Math.max(...walls.map((p) => p.bounds[1][k])));
const C = mn.map((v, k) => (v + mx[k]) / 2);
const S = 10;

const out = [];
const manifest = { source: 'BodyParts3D 4.0 (CC BY 4.0, The Database Center for Life Science) via Human Atlas', scale: S, center: C, groups: {} };
let offset = 0;
const pushBuf = (buf) => { const pad = (4 - (offset % 4)) % 4; if (pad) { out.push(Buffer.alloc(pad)); offset += pad; } const o = offset; out.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)); offset += buf.byteLength; return o; };

for (const [group, ids] of Object.entries(GROUPS)) {
  manifest.groups[group] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) { console.warn('missing', id); continue; }
    const b = chunk(p.chunk);
    const pos = new Float32Array(b.buffer.slice(b.byteOffset + p.positions, b.byteOffset + p.positions + p.vertexCount * 12));
    const nor = new Int16Array(b.buffer.slice(b.byteOffset + p.normals, b.byteOffset + p.normals + p.vertexCount * 6));
    const idx32 = new Uint32Array(b.buffer.slice(b.byteOffset + p.indices, b.byteOffset + p.indices + p.indexCount * 4));
    const cen = [0, 0, 0];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { pos[i + k] = (pos[i + k] - C[k]) * S; cen[k] += pos[i + k]; }
    for (let k = 0; k < 3; k++) cen[k] /= p.vertexCount;
    const idx = new Uint16Array(idx32);
    let line = null;
    if (VESSELS.has(group)) line = centerline(pos);
    manifest.groups[group].push({
      id, name: p.name, vertexCount: p.vertexCount, indexCount: p.indexCount,
      positions: pushBuf(pos), normals: pushBuf(nor), indices: pushBuf(idx),
      center: cen.map((v) => +v.toFixed(4)),
      ...(line ? { line } : {}),
      bounds: [p.bounds[0].map((v, k) => +((v - C[k]) * S).toFixed(4)), p.bounds[1].map((v, k) => +((v - C[k]) * S).toFixed(4))],
    });
  }
}
const outDir = path.resolve('public/heart');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'heart.bin'), Buffer.concat(out));
writeFileSync(path.resolve('src/heart-parts.json'), JSON.stringify(manifest));
const n = Object.values(manifest.groups).flat();
console.log(`${n.length} parts, ${n.reduce((s, p) => s + p.vertexCount, 0)} vertices, ${n.reduce((s, p) => s + p.indexCount / 3, 0)} triangles, ${(offset / 1e6).toFixed(2)} MB`);
