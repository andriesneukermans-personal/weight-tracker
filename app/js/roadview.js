// Persistent DOM island for the journey road. render() replaces #scroll's
// innerHTML wholesale on every state change, which would destroy Lottie
// instances and restart the avatar mid-animation; this module keeps one
// detached .road-wrap node alive across renders and re-appends it into the
// #road-host placeholder. Only the SVG half is re-rendered per update —
// the avatar overlay (and its Lottie players) survives untouched.
import { roadSVG } from './road.js';

const POSES = ['idle', 'hop', 'celebrate', 'pushback'];

let wrap = null;       // the island; a module reference keeps it alive while detached
let svgHost = null;
let avatarEl = null;
let anims = null;      // {pose: lottie instance} once the player + JSONs arrive
let lottieReady = null; // cached script-injection promise
let pose = 'idle';

const reducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Static stand-in shown until Lottie is up (and forever if it never loads):
// a simplified Zubulig in the same palette, so the swap is seamless.
const FALLBACK = `<svg viewBox="0 0 64 72">
  <path d="M32 6 C47 6 55 20 54 38 C53 56 45 64 32 64 C19 64 11 56 10 38 C9 20 17 6 32 6 Z" fill="#ffb084"/>
  <path d="M22 22 q4 -3 8 0" stroke="#1a3a3a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <path d="M36 22 q4 -3 8 0" stroke="#1a3a3a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <circle cx="25" cy="31" r="4" fill="#1a3a3a"/><circle cx="41" cy="31" r="4" fill="#1a3a3a"/>
  <circle cx="26.5" cy="29.5" r="1.4" fill="#fffaf0"/><circle cx="42.5" cy="29.5" r="1.4" fill="#fffaf0"/>
  <ellipse cx="33" cy="42" rx="4.5" ry="3" fill="#ff4d8b"/>
  <circle cx="18" cy="38" r="3.5" fill="#ff8ab0" opacity=".6"/><circle cx="48" cy="38" r="3.5" fill="#ff8ab0" opacity=".6"/>
</svg>`;

function loadLottie() {
  if (!lottieReady) {
    lottieReady = new Promise((resolve, reject) => {
      if (window.lottie) return resolve(window.lottie);
      const s = document.createElement('script');
      s.src = './js/vendor/lottie_svg.min.js';
      s.onload = () => resolve(window.lottie);
      s.onerror = () => reject(new Error('lottie failed'));
      document.head.appendChild(s);
    });
  }
  return lottieReady;
}

async function initAnims() {
  try {
    const lottie = await loadLottie();
    const datas = await Promise.all(POSES.map((p) =>
      fetch(`./anim/avatar-${p}.json`).then((r) => { if (!r.ok) throw new Error(p); return r.json(); })));
    if (!avatarEl) return;
    const built = {};
    POSES.forEach((p, i) => {
      const box = document.createElement('div');
      box.className = 'av-lot';
      box.dataset.pose = p;
      box.style.display = 'none';
      avatarEl.appendChild(box);
      // every pose loops; the movement machine decides when to switch,
      // so a short walk never gets cut off by a 'complete' event
      built[p] = lottie.loadAnimation({
        container: box, renderer: 'svg', autoplay: false, loop: true,
        animationData: datas[i],
      });
    });
    anims = built;
    const fb = avatarEl.querySelector('.av-fallback');
    if (fb) fb.remove();
    setPose(pose, true);
  } catch {
    /* progressive enhancement: the static fallback simply stays */
  }
}

export function setPose(next, force = false) {
  // force is for initAnims: the pose name is unchanged but no player is
  // visible yet, so the early-out must be skipped once
  if (!force && next === pose && anims) return;
  const prev = pose;
  pose = next;
  if (!anims) return;
  if (prev !== next) { anims[prev].stop(); anims[prev].wrapper.style.display = 'none'; }
  const a = anims[next];
  a.wrapper.style.display = '';
  if (reducedMotion()) a.goToAndStop(0, true);
  else a.goToAndPlay(0, true);
}

function placeAt(m, idx) {
  const n = m.nodes[Math.max(0, Math.min(idx, m.nodes.length - 1))];
  avatarEl.style.left = (n.x / m.W * 100).toFixed(3) + '%';
  avatarEl.style.top = (n.y / m.H * 100).toFixed(3) + '%';
  avatarEl.dataset.index = String(idx);
}

/* ---------- movement state machine ----------
   The previous position is persisted in wt.road, so each real change
   animates exactly once: a re-render mid-animation reads an already
   up-to-date record and leaves the running animation alone. */
const ROAD_KEY = 'wt.road';
let moveTimer = null;

function readRec() {
  try { return JSON.parse(localStorage.getItem(ROAD_KEY) || 'null'); } catch { return null; }
}

function cancelMove() {
  if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
  avatarEl.classList.remove('av-shake', 'av-push');
}

function sparkleAt(m, idx) {
  const n = m.nodes[idx];
  const el = document.createElement('div');
  el.className = 'road-sparkle';
  el.style.left = (n.x / m.W * 100).toFixed(3) + '%';
  el.style.top = (n.y / m.H * 100).toFixed(3) + '%';
  el.innerHTML = `<svg viewBox="0 0 56 56">
    <path d="M28 6 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" fill="#e8b94a"/>
    <circle cx="10" cy="34" r="3" fill="#ff4d8b"/><circle cx="46" cy="30" r="2.5" fill="#b8a4ed"/>
    <path d="M44 44 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 Z" fill="#ff4d8b"/>
    <circle cx="14" cy="14" r="2.5" fill="#a4d4c5"/></svg>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function walk(m, from, to) {
  // long gaps: jump silently to 4 tiles out, then walk the rest
  let i = Math.max(from, to - 4);
  if (i !== from) placeAt(m, i);
  setPose('hop');
  const tick = () => {
    i++;
    placeAt(m, i);
    const n = m.nodes[i];
    if (n && n.kind === 'checkpoint' && n.status === 'done') sparkleAt(m, i);
    moveTimer = setTimeout(i < to ? tick : () => {
      moveTimer = null;
      setPose(m.state === 'reached' ? 'celebrate' : 'idle');
    }, i < to ? 300 : 350);
  };
  moveTimer = setTimeout(tick, 60);
}

function pushback(m, to) {
  avatarEl.classList.add('av-push', 'av-shake');
  setPose('pushback');
  placeAt(m, to); // .av-push lengthens the left/top transition into a slide
  moveTimer = setTimeout(() => {
    moveTimer = null;
    avatarEl.classList.remove('av-shake', 'av-push');
    setPose(m.state === 'reached' ? 'celebrate' : 'idle');
  }, 1400);
}

export function mountRoad(host, model) {
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'road-wrap';
    svgHost = document.createElement('div');
    svgHost.className = 'road-svg-host';
    avatarEl = document.createElement('div');
    avatarEl.className = 'road-avatar';
    avatarEl.innerHTML = `<div class="av-fallback">${FALLBACK}</div>`;
    wrap.append(svgHost, avatarEl);
    initAnims();
  }
  // the SVG is cheap to rebuild; the avatar overlay is what must persist
  svgHost.innerHTML = roadSVG(model);
  wrap.style.aspectRatio = `${model.W}/${model.H}`;

  const resting = model.state === 'reached' ? 'celebrate' : 'idle';
  const rec = readRec();
  localStorage.setItem(ROAD_KEY, JSON.stringify({ sig: model.sig, pos: model.avatarPos }));
  const to = model.avatarNode;
  const from = rec && rec.sig === model.sig ? Math.floor(rec.pos) : null;
  if (from == null || from === to || reducedMotion()) {
    // new journey/unit/goal, no change, or reduced motion: snap, never animate
    if (!moveTimer || from == null || reducedMotion()) {
      cancelMove();
      placeAt(model, to);
      setPose(resting);
    } // else: a movement is mid-flight for this same target; let it finish
  } else if (to > from) {
    cancelMove();
    walk(model, from, to);
  } else {
    cancelMove();
    pushback(model, to);
  }
  if (anims && !reducedMotion()) anims[pose].play();
  if (wrap.parentElement !== host) host.appendChild(wrap);
}

export function suspendRoad() {
  if (anims) anims[pose].pause();
}

/* Center the avatar in the scroll viewport; called on screen entry only so
   it never fights the same-screen scroll preservation in render(). */
export function scrollRoadToAvatar(scrollEl) {
  if (!wrap || !wrap.isConnected || !avatarEl) return;
  const a = avatarEl.getBoundingClientRect();
  const s = scrollEl.getBoundingClientRect();
  scrollEl.scrollTop += a.top + a.height / 2 - (s.top + s.height / 2);
}
