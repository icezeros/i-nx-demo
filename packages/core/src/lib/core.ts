/**
 * Core library - used by platform packages.
 */
/** Default version used when not set. */
export const DEFAULT_VERSION = '0.0.0';
export const CORE_VERSION = '2.0.0';

export function core(): string {
  return 'core-v2';
}

/** Get current core version for release demo. */
export function getCoreVersion(): string {
  return CORE_VERSION.trim();
}
