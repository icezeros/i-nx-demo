/** Internal helpers - return value is package name. */
export const HELPERS_PACKAGE_NAME = 'internal-helpers';
/** Version for release demo. */
export const HELPERS_VERSION = '1.0.0';

export function internalHelpers(): string {
  return HELPERS_PACKAGE_NAME;
}

/** Get package name for release demo. */
export function getPackageName(): string {
  return String(HELPERS_PACKAGE_NAME);
}
