const REMOTE_METHOD_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

/** Removes the "Error invoking remote method '<channel>': Error: " prefix Electron adds to errors thrown by ipcMain handlers. */
export function stripRemoteMethodPrefix(message: string): string {
  return message.replace(REMOTE_METHOD_PREFIX, "");
}
