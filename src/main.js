import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/gfs-didot';
import './style.css';
import Lenis from 'lenis';
import { Trace } from './ecg.js';
import { beatShape } from './ecg.js';
import { createHeart } from './heart.js';
import { createArtery, paramsAt } from './artery.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------- smooth scroll ----------------
const lenis = new Lenis({ lerp: 0.1, smoothWheel: !reduced });
document.documentElement.classList.add('lenis');

// ---------------- process steps copy ----------------
const STEPS = [
  { short: 'Υγιής αρτηρία', term: 'Στεφανιαία αρτηρία', title: 'Το αίμα περνά ελεύθερα', text: 'Μέσα σε μια στεφανιαία αρτηρία τα ερυθρά αιμοσφαίρια κουβαλούν οξυγόνο στον καρδιακό μυ από κάτω. Τα τοιχώματα είναι λεία και ο δρόμος ανοιχτός.' },
  { short: 'Το λίπος μπαίνει', term: 'Αθηροσκλήρωση', title: 'Η χοληστερόλη χώνεται στο τοίχωμα', text: 'Η «κακή» χοληστερόλη (LDL) περνά μέσα στο τοίχωμα της αρτηρίας. Εκεί μαζεύονται λίπος, χοληστερόλη και ασβέστιο και φτιάχνουν μια πλάκα. Γίνεται αργά, μέσα σε χρόνια, χωρίς να το καταλάβεις.' },
  { short: 'Στένωση', term: 'Στένωση · Στηθάγχη', title: 'Ο δρόμος στενεύει', text: 'Η πλάκα μεγαλώνει και χωράει λιγότερο αίμα. Σε ηρεμία μπορεί να φτάνει, όμως όταν η καρδιά χρειάζεται περισσότερο οξυγόνο, για παράδειγμα στην άσκηση, το στήθος πονάει. Αυτό λέγεται στηθάγχη.' },
  { short: 'Ρήξη και θρόμβος', term: 'Ρήξη πλάκας · Θρόμβος', title: 'Η πλάκα ραγίζει', text: 'Ξαφνικά η επιφάνεια της πλάκας σπάει. Τα αιμοπετάλια τρέχουν να «κλείσουν την πληγή», όπως σε ένα κόψιμο, και φτιάχνουν θρόμβο. Μόνο που εδώ ο θρόμβος είναι μέσα στην αρτηρία.' },
  { short: 'Έμφραγμα', term: 'Ισχαιμία · Νέκρωση', title: 'Το αίμα σταματά. Ο μυς πεθαίνει.', text: 'Ο θρόμβος φράζει την αρτηρία. Ο μυς μετά το φράξιμο μένει χωρίς οξυγόνο και σε περίπου 30 λεπτά αρχίζει μόνιμη βλάβη, που απλώνεται όσο περνά η ώρα. Στο ηλεκτροκαρδιογράφημα εμφανίζεται «ανάσπαση ST».' },
  { short: 'Θεραπεία: stent', term: 'Αγγειοπλαστική · Stent', title: 'Ανοίγουμε ξανά τον δρόμο', text: 'Ένας λεπτός σωλήνας φτάνει ως την αρτηρία. Ένα μπαλονάκι φουσκώνει, πιέζει την πλάκα και ένα μεταλλικό πλέγμα, το stent, κρατά την αρτηρία ανοιχτή. Το αίμα ξαναρέει. Ό,τι μυς πέθανε δεν γυρνά πίσω, γι\' αυτό μετράει κάθε λεπτό.' },
];

const rail = $('#steps-rail');
const railGlass = $('.glass', rail);
STEPS.forEach((s, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `<span class="k">0${i + 1}</span><span class="t">${s.short}</span><span class="prog"><i></i></span>`;
  b.addEventListener('click', () => lenis.scrollTo(stepTarget(i), { duration: 1.4 }));
  rail.appendChild(b);
});
const railBtns = $$('button', rail);
const labelsHost = document.createElement('div');
labelsHost.className = 'labels3d';
$('#process .pin').insertBefore(labelsHost, $('.stage-ui'));

let curStep = -1;
function setStep(i) {
  if (i === curStep) return;
  const first = curStep === -1;
  curStep = i;
  const box = $('#step-copy');
  const apply = () => {
    $('#step-n').textContent = String(i + 1).padStart(2, '0');
    $('#step-term').textContent = STEPS[i].term;
    $('#step-title').textContent = STEPS[i].title;
    $('#step-text').textContent = STEPS[i].text;
    box.classList.remove('out');
  };
  if (first) apply(); else { box.classList.add('out'); setTimeout(apply, 260); }
  railBtns.forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); });
  const btn = railBtns[i];
  railGlass.style.width = btn.offsetWidth + 'px';
  railGlass.style.transform = `translateX(${btn.offsetLeft}px)`;
  railGlass.classList.remove('squish'); void railGlass.offsetWidth; railGlass.classList.add('squish');
}
window.addEventListener('resize', () => { const c = curStep; curStep = -1; if (c >= 0) setStep(c); });

// ---------------- 3D scenes ----------------
const heart = createHeart($('#heart-stage'));
const artery = createArtery($('#artery-stage'), labelsHost);
window.__art = artery;

// ---------------- ECG traces ----------------
const heroTrace = new Trace($('#hero-ecg'), { color: '#3ee6a8', amp: 0.4, baseline: 0.68, speed: 110, grid: true });
const stageTrace = new Trace($('#stage-ecg'), { color: '#3ee6a8', amp: 0.34, baseline: 0.66, speed: 70, glow: 8, width: 1.5 });
const bgTrace = new Trace($('#bg-ecg'), { color: '#ff2d4d', alpha: 0.14, amp: 0.13, baseline: 0.52, speed: 150, glow: 18, width: 1.4 });

// ---------------- process scroll mapping ----------------
const proc = $('#process');
function procRange() {
  const top = proc.getBoundingClientRect().top + window.scrollY;
  return { top, len: proc.offsetHeight - window.innerHeight };
}
function stepTarget(i) { const { top, len } = procRange(); return top + len * ((i + 0.35) / 6); }
function processU() {
  const { top, len } = procRange();
  return clamp(((window.scrollY - top) / len) * 6, 0, 5.999);
}

// ---------------- meters ----------------
const mFlow = $('#m-flow'), mFlowBar = $('#m-flow-bar'), mO2 = $('#m-o2'), mO2Bar = $('#m-o2-bar');
const mini = $('#mini-ecg'), miniLbl = $('#mini-ecg-lbl');
const barColor = (v) => (v > 0.7 ? 'linear-gradient(90deg,#e3243f,#ff5a70)' : v > 0.35 ? 'linear-gradient(90deg,#d58418,#f5b53a)' : 'linear-gradient(90deg,#4b3a5c,#8a7aa3)');
let lastMeter = '';
function setMeters(P) {
  const flow = P.flow, o2 = clamp(flow * 1.05 - P.death * 0.15, 0, 1);
  const key = `${Math.round(flow * 100)}|${Math.round(o2 * 100)}|${P.st > 0.15}|${P.st < -0.04}`;
  if (key === lastMeter) return;
  lastMeter = key;
  mFlow.textContent = Math.round(flow * 100) + '%';
  mFlowBar.style.width = flow * 100 + '%'; mFlowBar.style.background = barColor(flow);
  mO2.textContent = Math.round(o2 * 100) + '%';
  mO2Bar.style.width = o2 * 100 + '%'; mO2Bar.style.background = barColor(o2);
  const alarm = P.st > 0.15;
  mini.classList.toggle('alarm', alarm);
  miniLbl.textContent = alarm ? 'ΗΚΓ · ανάσπαση ST' : P.st < -0.04 ? 'ΗΚΓ · ισχαιμία' : 'ΗΚΓ · φυσιολογικό';
  stageTrace.color = alarm ? '#ff5a70' : P.st < -0.04 ? '#f5b53a' : '#3ee6a8';
}

// ---------------- main loop ----------------
let phase = 0, bpm = 70, last = performance.now();
const bpmEl = $('#bpm');
function frame(now) {
  lenis.raf(now);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  const u = processU();
  const P = paramsAt(u);
  const inProc = artery.visible;
  const targetBpm = inProc ? P.bpm : 70;
  bpm += (targetBpm - bpm) * Math.min(1, dt * 2);
  phase = (phase + (dt * bpm) / 60) % 1;
  const phaseAt = (back) => (((phase - (back * bpm) / 60) % 1) + 1) % 1;
  const beat = beatShape(phase).vent;

  if (!reduced || !heart._drawn) { heart.update(t, phase); heart._drawn = true; }
  heroTrace.step(dt, phaseAt, 0);
  bgTrace.step(dt, phaseAt, inProc ? P.st : 0);
  if (inProc) {
    artery.update(t, dt, u, phase, beat);
    stageTrace.step(dt, phaseAt, P.st);
    setStep(Math.min(5, Math.floor(u)));
    setMeters(P);
    const f = u - Math.floor(u);
    railBtns.forEach((b, k) => { $('.prog i', b).style.width = (k < Math.floor(u) ? 100 : k === Math.floor(u) ? f * 100 : 0) + '%'; });
  }
  bpmEl.textContent = Math.round(bpm);
  document.documentElement.style.setProperty('--beat', (60 / bpm).toFixed(3) + 's');
  updateNav();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- nav pill ----------------
const links = $$('.nav a.link');
const pill = $('.nav .pill');
let activeLink = null;
links.forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const id = a.getAttribute('href');
  const target = id === '#process' ? stepTarget(0) : $(id);
  lenis.scrollTo(target, { duration: 1.5, offset: id === '#process' ? 0 : -10 });
}));
function updateNav() {
  const y = window.scrollY + window.innerHeight * 0.4;
  let cur = null;
  for (const a of links) {
    const el = $(a.getAttribute('href'));
    if (el && el.getBoundingClientRect().top + window.scrollY <= y) cur = a;
  }
  if (cur === activeLink) return;
  activeLink = cur;
  links.forEach((a) => a.classList.toggle('on', a === cur));
  if (cur && cur.offsetParent) { pill.style.opacity = 1; pill.style.width = cur.offsetWidth + 'px'; pill.style.transform = `translateX(${cur.offsetLeft}px)`; }
  else pill.style.opacity = 0;
}

// ---------------- reveal + count-up ----------------
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  e.target.classList.add('in');
  $$('[data-count]', e.target).forEach(countUp);
  io.unobserve(e.target);
}), { threshold: 0.15 });
$$('.rv').forEach((el) => io.observe(el));
function countUp(el) {
  const to = parseFloat(el.dataset.count), dec = +(el.dataset.dec || 0), t0 = performance.now(), D = 1400;
  const tick = (now) => {
    const k = clamp((now - t0) / D, 0, 1), e = 1 - Math.pow(1 - k, 3);
    el.textContent = (to * e).toFixed(dec).replace('.', ',');
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------- anatomy flow strips ----------------
const flowSet = (id, colors, dur) => {
  const host = $(id);
  for (let i = 0; i < 7; i++) {
    const d = document.createElement('i');
    const c = colors[i % colors.length];
    d.style.background = `radial-gradient(circle at 35% 35%, #fff8, ${c} 45%, ${c}00 75%)`;
    d.style.boxShadow = `0 0 14px ${c}`;
    d.style.animationDuration = dur + 's';
    d.style.animationDelay = (-dur * i) / 7 + 's';
    d.style.marginTop = (Math.sin(i * 2.1) * 14 - 7) + 'px';
    host.appendChild(d);
  }
};
flowSet('#flow-a', ['#4c74ff', '#4c74ff', '#ff3d5a', '#ff3d5a'], 3.2);
flowSet('#flow-b', ['#ff9a3d', '#ff3d5a'], 2.4);
flowSet('#flow-c', ['#ff3d5a'], 1.7);

// ---------------- symptoms ----------------
const SYMS = [
  { id: 'chest', ic: '01', title: 'Πόνος ή πίεση στο στήθος', text: 'Στο κέντρο του στήθους, σαν σφίξιμο, βάρος ή πλάκωμα. Κρατά πάνω από λίγα λεπτά ή πάει κι έρχεται. Είναι το πιο συχνό σύμπτωμα.', hot: [160, 188], zones: ['chest'] },
  { id: 'arm', ic: '02', title: 'Ο πόνος απλώνεται', text: 'Στο ένα ή και στα δύο χέρια, στον ώμο, στον λαιμό, στο σαγόνι ή στην πλάτη.', hot: [242, 236], zones: ['arm', 'jaw'] },
  { id: 'breath', ic: '03', title: 'Δύσπνοια', text: 'Δυσκολία στην αναπνοή, με ή χωρίς πόνο στο στήθος.', hot: [118, 166], zones: ['breath'] },
  { id: 'sweat', ic: '04', title: 'Κρύος ιδρώτας', text: 'Ξαφνικός κρύος ιδρώτας και χλωμό δέρμα.', hot: [150, 30], zones: ['sweat'] },
  { id: 'nausea', ic: '05', title: 'Ναυτία', text: 'Ναυτία, εμετός ή κάτι που μοιάζει με δυσπεψία.', hot: [150, 262], zones: ['nausea'] },
  { id: 'dizzy', ic: '06', title: 'Ζάλη και κούραση', text: 'Ζάλη, αδυναμία, ακόμα και λιποθυμία. Μερικές φορές ένα άσχημο προαίσθημα.', hot: [122, 60], zones: ['dizzy'] },
];
const list = $('#sym-list'), hots = $('#hots');
const NS = 'http://www.w3.org/2000/svg';
SYMS.forEach((s, i) => {
  const el = document.createElement('div');
  el.className = 'sym rv'; el.dataset.id = s.id; el.style.transitionDelay = i * 60 + 'ms';
  el.innerHTML = `<span class="ic">${s.ic}</span><div><h3>${s.title}</h3><p>${s.text}</p></div>`;
  el.addEventListener('mouseenter', () => selectSym(s.id));
  el.addEventListener('click', () => selectSym(s.id));
  list.appendChild(el); io.observe(el);
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'hot'); g.dataset.id = s.id;
  g.innerHTML = `<circle class="ring" cx="${s.hot[0]}" cy="${s.hot[1]}" r="9" fill="none" stroke="#ff5a70" stroke-width="2" style="animation-delay:${i * 0.25}s"/>
    <circle class="core" cx="${s.hot[0]}" cy="${s.hot[1]}" r="7" fill="#ff5a70" stroke="#fff" stroke-width="2"/>`;
  g.addEventListener('click', () => selectSym(s.id));
  g.addEventListener('mouseenter', () => selectSym(s.id));
  hots.appendChild(g);
});
function selectSym(id) {
  const s = SYMS.find((x) => x.id === id);
  $$('.sym').forEach((e) => e.classList.toggle('on', e.dataset.id === id));
  $$('.hot').forEach((e) => e.classList.toggle('on', e.dataset.id === id));
  $$('#body .zone').forEach((z) => { z.style.transition = 'opacity .5s'; z.setAttribute('opacity', s.zones.includes(z.dataset.z) ? 1 : 0); });
}
selectSym('chest');

// ---------------- risk factors ----------------
const RISKS = [
  ['smoke', 'Κάπνισμα', 0.16], ['chol', 'Υψηλή χοληστερόλη', 0.17], ['bp', 'Υψηλή πίεση', 0.13], ['diab', 'Διαβήτης', 0.12],
  ['sit', 'Καθιστική ζωή', 0.09], ['diet', 'Ανθυγιεινή διατροφή', 0.09], ['fat', 'Παχυσαρκία', 0.08], ['alc', 'Πολύ αλκοόλ', 0.06],
];
const on = new Set();
const tg = $('#toggles');
RISKS.forEach(([id, label]) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tog'; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span>${label}</span><i class="sw"></i>`;
  b.addEventListener('click', () => {
    on.has(id) ? on.delete(id) : on.add(id);
    b.classList.toggle('on', on.has(id)); b.setAttribute('aria-pressed', on.has(id));
    xsTarget = RISKS.reduce((s, [k, , w]) => s + (on.has(k) ? w : 0), 0);
    $('#xs-n').textContent = `${on.size}/8`;
  });
  tg.appendChild(b);
});
let xsTarget = 0, xsVal = 0;
const circ = (cx, cy, r) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
const xsP = $('#xs-plaque'), xsL = $('#xs-lumen'), xsCells = $('#xs-cells'), xsOpen = $('#xs-open');
xsP.setAttribute('d', circ(0, 0, 112));
const xc = Array.from({ length: 14 }, (_, i) => {
  const e = document.createElementNS(NS, 'ellipse');
  e.setAttribute('rx', 9); e.setAttribute('ry', 5); e.setAttribute('fill', '#ff8094'); e.setAttribute('opacity', 0.85);
  xsCells.appendChild(e);
  return { a: Math.random() * 6.28, r: Math.sqrt(Math.random()), s: 0.3 + Math.random() * 0.7, k: i };
});
function xsTick(now) {
  xsVal += (xsTarget - xsVal) * 0.08;
  const T = 6 + 112 * 1.35 * xsVal;
  const rl = 112 - T / 2, cy = -T / 2;
  xsL.setAttribute('d', circ(0, cy, rl));
  const open = Math.round((rl / 112) ** 2 * 100);
  xsOpen.textContent = open + '%';
  xsOpen.style.color = open > 65 ? 'var(--ink)' : open > 35 ? 'var(--plaque)' : 'var(--blood-hi)';
  const t = now / 1000;
  xc.forEach((c) => {
    const a = c.a + t * c.s * 0.6, r = c.r * (rl - 12);
    const el = xsCells.children[c.k];
    el.setAttribute('cx', (Math.cos(a) * r).toFixed(1)); el.setAttribute('cy', (cy + Math.sin(a) * r).toFixed(1));
    el.setAttribute('transform', `rotate(${(a * 57).toFixed(0)} ${(Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)})`);
  });
  requestAnimationFrame(xsTick);
}
requestAnimationFrame(xsTick);

// ---------------- quiz ----------------
const QUIZ = [
  { q: 'Τι προκαλεί τα περισσότερα εμφράγματα;', a: ['Θρόμβος πάνω σε πλάκα που έσπασε μέσα σε στεφανιαία αρτηρία', 'Ένας ιός που μολύνει την καρδιά', 'Η καρδιά «κουράζεται» και σταματά', 'Πολύ γρήγοροι παλμοί από άγχος'], r: 0, why: 'Η πλάκα σπάει, γίνεται θρόμβος και φράζει την αρτηρία.' },
  { q: 'Πώς λέγεται η συσσώρευση λίπους στο τοίχωμα των αρτηριών;', a: ['Αρρυθμία', 'Αθηροσκλήρωση', 'Αναιμία', 'Υπέρταση'], r: 1, why: 'Αθηροσκλήρωση: λίπος, χοληστερόλη και ασβέστιο φτιάχνουν πλάκα.' },
  { q: 'Ποιο είναι το πιο συχνό σύμπτωμα;', a: ['Πονοκέφαλος', 'Πόνος στο γόνατο', 'Πίεση ή πόνος στο κέντρο του στήθους', 'Φαγούρα'], r: 2, why: 'Συνήθως σαν σφίξιμο ή βάρος, που μπορεί να απλώνεται σε χέρι, σαγόνι ή πλάτη.' },
  { q: 'Ποιον αριθμό καλείς στην Ελλάδα;', a: ['100', '199', '1566', '166'], r: 3, why: '166 για το ΕΚΑΒ, ή 112. Και όχι οδήγηση μόνος σου.' },
  { q: 'Τι κάνει το stent;', a: ['Κρατά την αρτηρία ανοιχτή', 'Διαλύει τη χοληστερόλη σε όλο το σώμα', 'Αντικαθιστά τον νεκρό μυ', 'Μετρά τους παλμούς'], r: 0, why: 'Είναι ένα μεταλλικό πλέγμα που μένει μέσα στην αρτηρία για να μην ξανακλείσει.' },
];
let qi = 0, score = 0, answered = false;
const qb = $('#quiz-box');
function renderQ() {
  if (qi >= QUIZ.length) {
    const msg = score === 5 ? 'Τέλειο. Θα μπορούσες να το παρουσιάσεις εσύ.' : score >= 3 ? 'Πολύ καλά. Ξαναδές τα βήματα για τα υπόλοιπα.' : 'Ξαναδές τη διαδικασία από πάνω και δοκίμασε ξανά.';
    qb.innerHTML = `<div class="q"><span class="qn">ΑΠΟΤΕΛΕΣΜΑ</span><h3>${score}/5 σωστές</h3><p class="muted" style="margin:0">${msg}</p><div class="qnav"><span></span><button class="btn" id="q-re">Ξανά από την αρχή</button></div></div>`;
    $('#q-re').onclick = () => { qi = 0; score = 0; renderQ(); };
    return;
  }
  const Q = QUIZ[qi]; answered = false;
  qb.innerHTML = `<div class="q"><span class="qn">ΕΡΩΤΗΣΗ ${qi + 1}/5</span><h3>${Q.q}</h3><div class="opts">${Q.a.map((a, i) => `<button class="opt" data-i="${i}">${a}</button>`).join('')}</div><div class="why" id="q-why"></div><div class="qnav"><span class="score">${score}/5</span><button class="btn" id="q-next" disabled>${qi === 4 ? 'Αποτέλεσμα' : 'Επόμενη'} →</button></div></div>`;
  $$('.opt', qb).forEach((b) => b.onclick = () => {
    if (answered) return; answered = true;
    const i = +b.dataset.i;
    if (i === Q.r) score++;
    $$('.opt', qb).forEach((o) => { o.disabled = true; if (+o.dataset.i === Q.r) o.classList.add('right'); });
    if (i !== Q.r) b.classList.add('wrong');
    $('#q-why').textContent = (i === Q.r ? 'Σωστό. ' : 'Όχι ακριβώς. ') + Q.why;
    $('.score', qb).textContent = `${score}/5`;
    $('#q-next').disabled = false;
  });
  $('#q-next').onclick = () => { qi++; renderQ(); };
}
renderQ();

// ---------------- presentation mode (arrow keys) ----------------
function slideTargets() {
  const t = [];
  $$('[data-slide]').forEach((el) => t.push(el.getBoundingClientRect().top + window.scrollY - (el.id === 'top' ? 0 : 40)));
  for (let i = 0; i < 6; i++) t.push(stepTarget(i));
  return t.map((v) => Math.max(0, Math.round(v))).sort((a, b) => a - b);
}
const toast = $('#toast');
let toastT;
function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), 1600); }
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const next = ['ArrowRight', 'PageDown', ' '].includes(e.key) && !(e.key === ' ' && e.target.closest('button'));
  const prev = ['ArrowLeft', 'PageUp'].includes(e.key);
  if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); return; }
  if (!next && !prev) return;
  e.preventDefault();
  const ts = slideTargets(), y = window.scrollY;
  const goal = next ? ts.find((v) => v > y + 8) : [...ts].reverse().find((v) => v < y - 8);
  if (goal !== undefined) { lenis.scrollTo(goal, { duration: 1.3 }); const n = ts.indexOf(goal) + 1; showToast(`Διαφάνεια ${n}/${ts.length} · F για πλήρη οθόνη`); }
});
