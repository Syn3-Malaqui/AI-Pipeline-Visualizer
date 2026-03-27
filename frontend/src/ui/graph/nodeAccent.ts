export type PipelineNodeKind = string

type NodeAccent = {
  accent: string
}

function fnv1a32(str: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick<T>(arr: readonly T[], key: string) {
  const idx = fnv1a32(key) % arr.length
  return arr[idx]!
}

// Curated accents derived from Tailwind theme tokens (see `frontend/tailwind.config.js`).
// Used at low alpha in CSS to avoid noise.
const PALETTE_BY_KIND: Record<string, readonly string[]> = {
  Input: ['#003d9b', '#0a57d6', '#0c56d0'],
  Preprocess: ['#0a57d6', '#0052cc', '#003d9b'],
  Embedding: ['#005463', '#007084', '#48d7f9'],
  Search: ['#005463', '#007084', '#0a57d6'],
  Scoring: ['#0040a2', '#0a57d6', '#005463'],
  LLM: ['#005463', '#0a57d6', '#003d9b'],
}

const FALLBACK = ['#0a57d6', '#005463', '#003d9b'] as const

export function getNodeAccent(kind: PipelineNodeKind, id: string): NodeAccent {
  const palette = PALETTE_BY_KIND[kind] ?? FALLBACK
  // Bias by kind first, then deterministic within-kind variation by id.
  return { accent: pick(palette, `${kind}:${id}`) }
}

