import { coastGarage } from './coast'
import { coastOverlook } from './coast-overlook'
import { fujiPavilion } from './fuji'
import { fujiMeadow } from './fuji-meadow'
import { hangar } from './hangar'
import { hexBay } from './hex-bay'
import { lightWall } from './light-wall'
import type { GarageDef } from './kit'
import { studio } from './studio'
import { underground } from './underground'

export { collectGlowMeshes, type GarageDef, type Room } from './kit'

/**
 * Every garage the car can be shown in. Add one: write a GarageDef in its own
 * file (see hex-bay.ts for the full contract, kit.ts for the shared parts)
 * and list it here.
 */
export const GARAGES: GarageDef[] = [hexBay, studio, lightWall, underground, hangar, fujiPavilion, fujiMeadow, coastGarage, coastOverlook]

export const DEFAULT_GARAGE = hexBay.id
