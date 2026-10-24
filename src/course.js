// The active map's course data. Everything else imports from here, so the rest of the game does not care which map is
// loaded. Morro-only landmarks (the Rock, the stacks, the causeway) are always the Morro Rock values.
import * as morro from './maps/morro.js';
import { MAP, MAP_ID } from './maps/index.js';

const C = MAP.course;
export { MAP_ID };
export const { WATER_LEVEL, HEADING, BOUNDS, PAINT, TEE, FAIRWAY, FAIRWAY_HALF, GREEN, CUP, BUNKERS, WASTE, PAR, HOLE_M, HOLE_YD,
  heightAt, surfaceAt, normalAt, fairwayDist, greenDist, bunkerDist, wasteDist, teeDist, sandiness, duneSand, inland, fbm } = C;
export const { ROCK, STACKS, CHANNEL, CAUSEWAY, shoreX } = morro;
