import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRoad, roadSVG } from '../app/js/road.js';

const road = (over = {}) => computeRoad({ startKg: 84, goalKg: 78, trendKg: 81, unit: 'kg', ...over });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~ ${b}`);

test('84→78 builds 24 quarter-kg tiles plus the start node', () => {
  const m = road();
  assert.equal(m.state, 'ok');
  assert.equal(m.steps, 24);
  assert.equal(m.nodes.length, 25);
  assert.equal(m.nodes[0].kind, 'start');
  assert.equal(m.nodes[24].kind, 'goal');
  close(m.nodes[1].w, 83.75);
  close(m.nodes[24].w, 78);
  assert.equal(m.sig, '84|78|kg');
});

test('whole-kg tiles are checkpoints with weight labels; goal wins over checkpoint', () => {
  const m = road();
  const cps = m.nodes.filter((n) => n.kind === 'checkpoint');
  assert.deepEqual(cps.map((n) => n.w), [83, 82, 81, 80, 79]);
  assert.equal(cps[0].label, '83 kg');
  // 78 is a whole kg but it is the goal tile
  assert.equal(m.nodes[24].kind, 'goal');
});

test('lbs mode rounds checkpoint labels like the old milestones', () => {
  const m = road({ unit: 'lbs' });
  const cp = m.nodes.find((n) => n.w === 83);
  assert.equal(cp.label, '183 lbs'); // 83 kg ≈ 182.98 lbs
  assert.equal(m.sig, '84|78|lbs');
});

test('off-grid start keeps whole-kg checkpoints on tiles; first tile is a partial step', () => {
  const m = road({ startKg: 84.3 });
  assert.equal(m.steps, 26);
  assert.equal(m.nodes.length, 27);
  close(m.nodes[1].w, 84.25); // 0.05 kg partial first step
  const cpW = m.nodes.filter((n) => n.kind === 'checkpoint').map((n) => n.w);
  assert.deepEqual(cpW, [84, 83, 82, 81, 80, 79]);
});

test('avatarPos interpolates within the current segment and snaps visually to a node', () => {
  close(road({ trendKg: 84 }).avatarPos, 0);
  close(road({ trendKg: 83.75 }).avatarPos, 1);
  const m = road({ trendKg: 83.7 });
  close(m.avatarPos, 1.2);
  assert.equal(m.avatarNode, 1);
  close(m.nodes[2].arcFrac, 0.2);
});

test('trend above the start clamps the avatar to node 0', () => {
  const m = road({ trendKg: 85 });
  assert.equal(m.state, 'ok');
  assert.equal(m.avatarPos, 0);
  assert.equal(m.avatarNode, 0);
});

test('trend at or below the goal reaches the last node and celebrates', () => {
  const at = road({ trendKg: 78 });
  assert.equal(at.state, 'reached');
  assert.equal(at.avatarPos, 24);
  const below = road({ trendKg: 77 });
  assert.equal(below.state, 'reached');
  assert.equal(below.avatarPos, 24);
});

test('statuses are stateless: a rebound flips a done checkpoint back', () => {
  const done = road({ trendKg: 82.9 }).nodes.find((n) => n.w === 83);
  assert.equal(done.status, 'done');
  const undone = road({ trendKg: 83.1 }).nodes.find((n) => n.w === 83);
  assert.equal(undone.status, 'todo');
});

test('serpentine geometry stays in the viewBox and climbs upward', () => {
  const m = road();
  m.nodes.forEach((n) => {
    assert.ok(n.x >= 70 - 1e-6 && n.x <= 260 + 1e-6, `x ${n.x} out of band`);
  });
  // start at the bottom, goal at the top: y decreases along the journey
  for (let i = 1; i < m.nodes.length; i++) {
    assert.ok(m.nodes[i].y < m.nodes[i - 1].y, 'y must decrease');
  }
  assert.equal(m.W, 330);
  assert.equal(m.H, m.nodes[0].y + 50);
  assert.equal(m.nodes[m.nodes.length - 1].y, 50);
  assert.ok(m.pathD.startsWith('M'));
});

test('doneD covers exactly the traveled prefix', () => {
  assert.equal(road({ trendKg: 84 }).doneD, '');
  const m = road({ trendKg: 83.2 }); // done through node 3 (w 83.25)
  assert.equal(m.avatarNode, 3);
  assert.ok(m.doneD.startsWith('M'));
  // one cubic segment per traveled edge
  assert.equal((m.doneD.match(/C/g) || []).length, 3);
});

test('empty states: noEntries, noGoal, gaining', () => {
  assert.equal(computeRoad({ startKg: null, goalKg: 78, trendKg: null, unit: 'kg' }).state, 'noEntries');
  assert.equal(computeRoad({ startKg: 84, goalKg: null, trendKg: 84, unit: 'kg' }).state, 'noGoal');
  assert.equal(computeRoad({ startKg: 84, goalKg: 90, trendKg: 84, unit: 'kg' }).state, 'gaining');
  assert.equal(computeRoad({ startKg: 84, goalKg: 84, trendKg: 84, unit: 'kg' }).state, 'gaining');
});

test('sub-quarter-kg journey is a single tile; one entry works', () => {
  const m = computeRoad({ startKg: 78.1, goalKg: 78, trendKg: 78.1, unit: 'kg' });
  assert.equal(m.state, 'ok');
  assert.equal(m.steps, 1);
  assert.equal(m.nodes.length, 2);
  assert.equal(m.nodes[1].kind, 'goal');
});

test('roadSVG renders one group per node and never the avatar', () => {
  const m = road({ trendKg: 82.9 });
  const svg = roadSVG(m);
  assert.ok(svg.startsWith('<svg'));
  assert.equal((svg.match(/class="rnode/g) || []).length, m.nodes.length);
  assert.ok(svg.includes(`viewBox="0 0 ${m.W} ${m.H}"`));
  assert.ok(!svg.includes('road-avatar'));
  // empty states render nothing
  assert.equal(roadSVG(computeRoad({ startKg: 84, goalKg: null, trendKg: 84, unit: 'kg' })), '');
});
