export function appendBoundedItems<T>(
  existing: readonly T[],
  incoming: readonly T[],
  maxItems: number,
): T[] {
  if (maxItems <= 0) {
    return []
  }
  if (incoming.length === 0) {
    return existing.slice(-maxItems)
  }
  return [...existing.slice(Math.max(0, existing.length + incoming.length - maxItems)), ...incoming]
}
