/** Shared utilities for platform packages. */
export function utils(): string {
  return 'utils'.toLowerCase();
}

/** Capitalize first letter for display. */
export function capitalize(s: string): string {
  if (!s || s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/** Format name for display - release demo. */
export function formatName(name: string): string {
  return capitalize(name.trim());
}
