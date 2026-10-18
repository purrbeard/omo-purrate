/** omo keeps open_session context only while a session is live, so the app's extension persists it as ORIGIN_ENTRY;
 * every message this app sends carries CLIENT_MESSAGE_PREFIX, which omo records in its admission entry. */
export const ORIGIN_ENTRY = "omo-ui.origin";
export const ORIGIN_CONTEXT = { created_by: "omo-ui", surface: "desktop" } as const;
export const CLIENT_MESSAGE_PREFIX = "omo-ui:";
