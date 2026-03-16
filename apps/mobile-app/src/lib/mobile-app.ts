/** Mobile app - fix display name for release demo. */
export const MOBILE_APP_ID = 'mobile-app';
export const MOBILE_APP_VERSION = '1.0.0';

export function mobileApp(): string {
  return MOBILE_APP_ID;
}

/** Get display name for release demo. */
export function getMobileAppName(): string {
  return MOBILE_APP_ID;
}
