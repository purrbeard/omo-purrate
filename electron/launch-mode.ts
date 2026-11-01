/** Scripted launches (install verification, relaunch after an update) pass this so the window never takes the user's focus. */
export const INACTIVE_LAUNCH_ARG = "--inactive";

export function launchesInactive(argv: readonly string[], background: boolean): boolean {
  return background || argv.includes(INACTIVE_LAUNCH_ARG);
}
