const coarse = window.matchMedia('(pointer: coarse)').matches;
// ECG waveform + scrolling trace renderer, all driven by one shared beat clock.

const g = (p, m, s) => Math.exp(-0.5 * ((p - m) / s) ** 2);

// One heartbeat, phase 0..1. QRS peak sits at 0.2.
// st > 0 lifts the ST segment (heart attack), st < 0 depresses it (ischaemia).
export function ecgValue(p, st = 0) {
  let v = 0.12 * g(p, 0.1, 0.025);          // P wave (atria)
  v -= 0.12 * g(p, 0.185, 0.008);           // Q
  v += 1.0 * g(p, 0.2, 0.009);              // R
  v -= 0.26 * g(p, 0.216, 0.009);           // S
  const stSeg = smooth(0.222, 0.245, p) * (1 - smooth(0.4, 0.46, p));
  v += st * stSeg;                          // ST segment shift
  v += (0.28 + Math.max(0, st) * 0.4) * g(p, 0.38, 0.045); // T wave
  return v;
}

export function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Systole curve for the 3D heart: atria squeeze on P, ventricles right after QRS.
export function beatShape(p) {
  return {
    atria: g(p, 0.12, 0.04),
    vent: g(p, 0.3, 0.07),
  };
}

export class Trace {
  constructor(canvas, opts = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = opts.color || '#3ee6a8';
    this.glow = opts.glow ?? 10;
    this.alpha = opts.alpha ?? 1;
    this.amp = opts.amp ?? 0.36;
    this.baseline = opts.baseline ?? 0.62;
    this.speed = opts.speed ?? 120; // px per second (CSS px)
    this.width = opts.width ?? 1.8;
    this.grid = opts.grid ?? false;
    this.buf = [];
    this.acc = 0;
    this.resize();
    let lastW = innerWidth;
    window.addEventListener('resize', () => { if (coarse && innerWidth === lastW) return; lastW = innerWidth; this.resize(); });
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * dpr);
    this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cap = Math.ceil(this.w / 2) + 4;
  }
  // dt seconds, phase function returns beat phase at a time offset, st value
  step(dt, phaseAt, st = 0) {
    this.acc += dt * this.speed;
    const n = Math.floor(this.acc / 2); // one sample per 2 px
    this.acc -= n * 2;
    for (let i = n - 1; i >= 0; i--) {
      const back = (i * 2) / this.speed;
      this.buf.push(ecgValue(phaseAt(back), st));
    }
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap);
    this.draw();
  }
  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (this.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x += 12) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
      for (let y = 0; y < h; y += 12) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
      ctx.stroke();
    }
    const b = this.buf;
    if (b.length < 2) return;
    const x0 = w - (b.length - 1) * 2;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.25, this.color);
    grad.addColorStop(1, this.color);
    ctx.globalAlpha = this.alpha;
    ctx.strokeStyle = grad;
    ctx.lineWidth = this.width;
    ctx.lineJoin = 'round';
    ctx.shadowColor = this.color;
    ctx.shadowBlur = this.glow;
    ctx.beginPath();
    for (let i = 0; i < b.length; i++) {
      const x = x0 + i * 2;
      const y = h * this.baseline - b[i] * h * this.amp;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    // leading dot
    const lx = x0 + (b.length - 1) * 2;
    const ly = h * this.baseline - b[b.length - 1] * h * this.amp;
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = this.glow * 1.6;
    ctx.beginPath();
    ctx.arc(lx - 1, ly, this.width + 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}
