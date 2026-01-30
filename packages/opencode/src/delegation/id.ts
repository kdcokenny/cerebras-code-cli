import { randomBytes } from "crypto"

const ADJECTIVES = [
  "swift",
  "quiet",
  "bold",
  "clever",
  "gentle",
  "brave",
  "calm",
  "eager",
  "happy",
  "kind",
  "lively",
  "merry",
  "noble",
  "proud",
  "quick",
  "sharp",
  "smart",
  "steady",
  "warm",
  "wise",
  "bright",
  "fierce",
  "agile",
  "nimble",
] as const

const COLORS = [
  "amber",
  "azure",
  "bronze",
  "coral",
  "crimson",
  "cyan",
  "gold",
  "gray",
  "green",
  "indigo",
  "ivory",
  "jade",
  "lavender",
  "maroon",
  "navy",
  "olive",
  "orange",
  "pink",
  "purple",
  "rose",
  "ruby",
  "sage",
  "scarlet",
  "silver",
  "teal",
  "turquoise",
  "violet",
] as const

const ANIMALS = [
  "falcon",
  "otter",
  "wolf",
  "bear",
  "eagle",
  "hawk",
  "tiger",
  "lion",
  "fox",
  "deer",
  "owl",
  "raven",
  "crane",
  "heron",
  "swan",
  "dolphin",
  "whale",
  "shark",
  "cobra",
  "python",
  "panther",
  "jaguar",
  "leopard",
  "cheetah",
  "lynx",
  "badger",
  "beaver",
] as const

/**
 * Generate a human-readable delegation ID.
 *
 * Format: adjective-color-animal (e.g., "swift-amber-falcon")
 *
 * IDs are unique enough for a session based on timestamp + random bytes.
 * Collisions across sessions are acceptable.
 */
export function generateDelegationId(): string {
  // Combine timestamp and random bytes for deterministic selection
  const timestamp = Date.now()
  const random = randomBytes(3)

  // Use timestamp + random for array indexing
  const seed1 = (timestamp + random[0]) % ADJECTIVES.length
  const seed2 = (timestamp + random[1]) % COLORS.length
  const seed3 = (timestamp + random[2]) % ANIMALS.length

  const adjective = ADJECTIVES[seed1]
  const color = COLORS[seed2]
  const animal = ANIMALS[seed3]

  return `${adjective}-${color}-${animal}`
}
