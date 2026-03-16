/**
 * Core library - used by platform packages.
 */
export const CORE_VERSION = '2.0.0';

export function core(): string {
  return 'core-v2';
}

/** Get current core version for release demo. */
export function getCoreVersion(): string {
  return CORE_VERSION;
}
