/** The token in a deck server's URL fragment. */
export function deckToken(text: string): string | null {
  return /^#?([a-z2-9]{6})$/i.exec(text.trim())?.[1]?.toLowerCase() ?? null;
}
