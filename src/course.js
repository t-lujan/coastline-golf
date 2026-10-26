// The active map's course data. Everything else imports from here, so the rest of the game does not care which map is
// loaded. Morro-only landmarks (the Rock, the stacks, the causeway) are always the Morro Rock values.
import * as morro from './maps/morro.js';
import { MAP, MAP_ID } from './maps/index.js';

const C = MAP.course;
export { MAP_ID };
export const { WATER_LEVEL, HEADING, BOUNDS, PAINT, TEE, FAIRWAY, FAIRWAY_HALF, GREEN, CUP, BUNKERS, WASTE, PAR, HOLE_M, HOLE_YD,
  heightAt, surfaceAt, normalAt, fairwayDist, greenDist, bunkerDist, wasteDist, teeDist, sandiness, duneSand, inland, fbm } = C;
export const { CHANNEL, CAUSEWAY, shoreX } = morro;
// the Rock and its stacks only stand at Morro Rock; a map can declare its own (Pismo: none, far away) and where the gulls wheel
export const ROCK = C.ROCK || morro.ROCK, STACKS = C.STACKS || morro.STACKS, GULLS = C.GULLS || { x: ROCK.x, z: ROCK.z };
