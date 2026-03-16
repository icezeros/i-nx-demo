/** Web app entry - for client applications release demo. */
export const WEB_APP_NAME = 'web-app-v2';
/** Get display name for release demo. */
export function getAppName(): string {
  return WEB_APP_NAME;
}

export function webApp(): string {
  return WEB_APP_NAME.toLowerCase();
}
