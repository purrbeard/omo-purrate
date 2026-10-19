/**
 * data-testid values of the new-thread chips, shaped like `TESTID` in `../testids` (each value is the kebab-case of
 * its key). A project option also carries `data-cwd`, and `data-selected` on the thread's current project; an
 * environment option carries `data-transport`.
 */
export const PROJECT_TESTID = {
  newThreadBar: "new-thread-bar",
  projectChip: "project-chip",
  projectOption: "project-option",
  projectNew: "project-new",
  environmentChip: "environment-chip",
  environmentOption: "environment-option",
} as const;
