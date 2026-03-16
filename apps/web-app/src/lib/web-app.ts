/** Web app entry - for client applications release demo. */
export const WEB_APP_NAME = 'web-app-v2';
export const WEB_APP_ENV = 'production';
/** Get display name for release demo. */
export function getAppName(): string {
  return WEB_APP_NAME.trim();
}

export function webApp(): string {
  return WEB_APP_NAME.toLowerCase();
}

/** App version for release demo. */
export const WEB_APP_VERSION = '1.0.0';
