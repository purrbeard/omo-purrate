import { version } from "../../package.json";

/** The app version from package.json, bundled at build time. */
export const APP_VERSION: string = version;

/** True while the major version is 0 (the DEV badge in the sidebar brand row). */
export function isPreRelease(appVersion: string): boolean {
  return /^0\./.test(appVersion);
}
