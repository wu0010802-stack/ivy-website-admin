// Each scene has a reading interval, followed by one turn. The last scene just rests.
export const HOLD = 0.65;
const clamp = value => Math.max(0, Math.min(1, value));

export function bookState(progress, count) {
  const position = clamp(progress) * (count - 1 + HOLD);
  const turns = Array.from({ length: count - 1 }, (_, i) =>
    clamp((position - i - HOLD) / (1 - HOLD)));
  return { scene: turns.filter(turn => turn >= 0.5 - 1e-9).length, turns };
}

export function sceneProgress(scene, count) {
  return (Math.max(0, Math.min(count - 1, scene)) + HOLD / 2) / (count - 1 + HOLD);
}

export function turnRange(index, count) {
  const length = count - 1 + HOLD;
  return [(index + HOLD) / length, (index + 1) / length];
}
