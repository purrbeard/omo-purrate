/** Lets another surface (the browser's element picker) add text to the active composer draft. */
export const COMPOSER_INSERT_EVENT = "omo-ui:composer-insert";

/** Appends `text` on its own line to the active thread's composer draft and focuses the composer. */
export function insertIntoComposer(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(COMPOSER_INSERT_EVENT, { detail: text }));
}

/** @returns `draft` with `text` appended on a new line */
export function appendToDraft(draft: string, text: string): string {
  if (draft === "") return text;
  return draft.endsWith("\n") ? `${draft}${text}` : `${draft}\n${text}`;
}
