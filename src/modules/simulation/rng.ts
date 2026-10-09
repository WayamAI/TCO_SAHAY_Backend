// Seeded, deterministic PRNG for the simulation engine. Math.random() must
// never be used for trial sampling - see SIMULATION_ENGINE_SPECIFICATION.md
// "Seed strategy".

export type Rng = () => number;

/** xmur3: hashes an arbitrary string seed into a 32-bit int for mulberry32. */
function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32: small, fast, deterministic PRNG. Returns a float in [0, 1). */
function mulberry32(seedInt: number): Rng {
  let a = seedInt;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a deterministic RNG from a string seed. Same seed -> same sequence, always. */
export function createRng(seed: string): Rng {
  const seedInt = xmur3(seed)();
  return mulberry32(seedInt);
}

/** Generates a random seed string when the caller doesn't supply one. */
export function generateSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
