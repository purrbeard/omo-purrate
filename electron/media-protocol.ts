import { protocol } from "electron";
import { MEDIA_SCHEME } from "../shared/media";
import { serveMedia } from "./media-serve";

/** Must run before the app is ready: the scheme needs standard/stream privileges for <img> and seekable <video>. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Serves allowlisted local images and videos to the renderer; runs after the app is ready. */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request));
}
