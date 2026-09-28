// Pitch dimensions, in metres. x runs the length of the pitch (the Reds attack
// +x, the Blues attack -x), z runs across it, and y is up. It's a small-sided
// pitch (six a side) with full-size goals.

export const HALF_L = 35; // goal line at x = ±35
export const HALF_W = 22; // touchlines at z = ±22
export const GOAL_HALF_W = 3.66; // 7.32 m between the posts
export const GOAL_H = 2.44;
export const GOAL_DEPTH = 2;
export const POST_R = 0.06;
export const BOX_DEPTH = 12;
export const BOX_HALF_W = 14;
export const SIX_DEPTH = 4.5;
export const SIX_HALF_W = 7;
export const PENALTY_SPOT = 9; // from the goal line
export const CENTRE_R = 7;

export const BALL_R = 0.11;
export const G = 9.81;

// Is (x, z) inside the penalty box at the end the given team defends?
// attack is +1 or -1: the team defends the goal at x = -attack * HALF_L.
export function inOwnBox(attack, x, z) {
  const fromLine = x * attack + HALF_L; // metres out from their own goal line
  return fromLine >= -1 && fromLine <= BOX_DEPTH && Math.abs(z) <= BOX_HALF_W;
}
