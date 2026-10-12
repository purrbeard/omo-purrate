import { version } from "../../package.json";

/** The app version from package.json, bundled at build time. */
export const APP_VERSION: string = version;

/** True for the development server build only (the DEV badge in the sidebar brand row); packaged builds carry no badge. */
export function isDevBuild(): boolean {
  return import.meta.env.DEV;
}
