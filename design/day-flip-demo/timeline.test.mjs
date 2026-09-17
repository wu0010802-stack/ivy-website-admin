import test from 'node:test';
import assert from 'node:assert/strict';
import { bookState, sceneProgress } from './timeline.mjs';

// Catch skipped pages and stale turn state when the reader rapidly reverses scroll.
test('scroll can jump to the last spread and reverse to the first', () => {
  assert.deepEqual(bookState(1, 3), { scene: 2, turns: [1, 1] });
  assert.deepEqual(bookState(0, 3), { scene: 0, turns: [0, 0] });
  assert.deepEqual(bookState(-0.1, 3), { scene: 0, turns: [0, 0] });
  assert.deepEqual(bookState(1.1, 3), { scene: 2, turns: [1, 1] });
});

test('all six mobile pages have reachable, flat reading positions', () => {
  for (let scene = 0; scene < 6; scene++) {
    const state = bookState(sceneProgress(scene, 6), 6);
    assert.equal(state.scene, scene);
    assert.deepEqual(state.turns, Array.from({ length: 5 }, (_, i) => i < scene ? 1 : 0));
  }
});

test('a turn passes through 90 degrees while adjacent pages stay flat', () => {
  const state = bookState(1.825 / 2.65, 3);
  assert.equal(state.scene, 2);
  assert.equal(state.turns[0], 1);
  assert.ok(Math.abs(state.turns[1] - 0.5) < 0.00001);
});

test('a reading interval does not keep turning the paper', () => {
  assert.deepEqual(bookState(0.1, 3), { scene: 0, turns: [0, 0] });
  assert.deepEqual(bookState(0.5, 3), { scene: 1, turns: [1, 0] });
  assert.deepEqual(bookState(0.95, 3), { scene: 2, turns: [1, 1] });
});
