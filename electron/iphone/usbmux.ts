import net from "node:net";

export type Plist = string | number | { [key: string]: Plist };
const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
export function encodePlist(value: Plist): string {
  const encode = (v: Plist): string => typeof v === "string" ? `<string>${escape(v)}</string>` : typeof v === "number" ? `<integer>${v}</integer>` : `<dict>${Object.entries(v).map(([k, x]) => `<key>${escape(k)}</key>${encode(x)}`).join("")}</dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${encode(value)}</plist>`;
}
export function decodePlist(xml: string): Plist {
  const tokens = xml.replace(/<\?[^>]*\?>|<!DOCTYPE[^>]*>/g, "").match(/<[^>]+>|[^<]+/g) ?? [];
  let i = 0;
  const text = (tag: string): string => {
    let value = "";
    while (tokens[i] !== `</${tag}>`) { if (i >= tokens.length || tokens[i]!.startsWith("<")) throw new Error("Invalid plist text"); value += tokens[i++]; }
    i++;
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, e: string) => e.startsWith("#") ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e]!);
  };
  const next = (): Plist => {
    while (tokens[i]?.trim() === "") i++;
    const tag = tokens[i++];
    if (tag === "<string/>" || tag === "<string />") return "";
    if (tag === "<string>") return text("string");
    if (tag === "<integer>") { const n = Number(text("integer")); if (!Number.isSafeInteger(n)) throw new Error("Invalid integer"); return n; }
    if (tag === "<dict>" || tag === "<dict/>" || tag === "<dict />") {
      const result: { [key: string]: Plist } = Object.create(null) as { [key: string]: Plist };
      if (tag !== "<dict>") return result;
      for (;;) {
        while (tokens[i]?.trim() === "") i++;
        if (tokens[i] === "</dict>") { i++; return result; }
        if (tokens[i++] !== "<key>") throw new Error("Invalid plist key");
        const key = text("key"); result[key] = next();
      }
    }
    throw new Error("Unsupported plist value");
  };
  while (tokens[i]?.trim() === "") i++;
  if (!tokens[i++]?.startsWith("<plist ")) throw new Error("Invalid plist");
  return next();
}
export function muxPacket(value: Plist, tag = 1): Buffer {
  const body = Buffer.from(encodePlist(value)); const header = Buffer.alloc(16);
  header.writeUInt32LE(16 + body.length); header.writeUInt32LE(1, 4); header.writeUInt32LE(8, 8); header.writeUInt32LE(tag, 12);
  return Buffer.concat([header, body]);
}
export class MuxDecoder {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer, receive: (value: Plist) => boolean | void): Buffer {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 16) {
      const size = this.buffer.readUInt32LE();
      if (size < 16 || size > 8 * 1024 * 1024 || this.buffer.readUInt32LE(4) !== 1 || this.buffer.readUInt32LE(8) !== 8) throw new Error("Invalid usbmux header");
      if (this.buffer.length < size) break;
      const value = decodePlist(this.buffer.subarray(16, size).toString()); this.buffer = this.buffer.subarray(size);
      if (receive(value) === false) { const rest = this.buffer; this.buffer = Buffer.alloc(0); return rest; }
    }
    return Buffer.alloc(0);
  }
}
export interface UsbDevice { id: number; name: string; serial: string }
export class Usbmux {
  private sockets = new Set<net.Socket>();
  constructor(private readonly socketPath = process.env["OMO_UI_USBMUXD_SOCKET"] ?? "/var/run/usbmuxd") {}
  private open(): net.Socket { const socket = net.createConnection(this.socketPath); this.sockets.add(socket); socket.once("close", () => this.sockets.delete(socket)); return socket; }
  listen(attached: (device: UsbDevice) => void, detached: (id: number) => void, closed: () => void): net.Socket {
    const socket = this.open(); const decoder = new MuxDecoder();
    socket.on("connect", () => socket.write(muxPacket({ MessageType: "Listen", ClientVersionString: "OmO UI", ProgName: "OmO UI" })));
    socket.on("data", (chunk) => { try { decoder.push(chunk, (value) => {
      const v = value as Record<string, Plist>;
      if (v["MessageType"] === "Result" && v["Number"] !== 0) throw new Error("Listen rejected");
      const p = v["Properties"] as Record<string, Plist> | undefined;
      if (v["MessageType"] === "Attached" && p?.["ConnectionType"] === "USB" && typeof v["DeviceID"] === "number") attached({ id: v["DeviceID"], serial: String(p["SerialNumber"] ?? ""), name: String(p["DeviceName"] ?? "iPhone") });
      if (v["MessageType"] === "Detached" && typeof v["DeviceID"] === "number") detached(v["DeviceID"]);
    }); } catch (error) { socket.destroy(error as Error); } });
    socket.on("error", () => { /* Close schedules another Listen attempt. */ }); socket.once("close", closed); return socket;
  }
  connect(deviceId: number, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = this.open(); const decoder = new MuxDecoder();
      const fail = (error: Error): void => { socket.destroy(); reject(error); };
      const close = (): void => reject(new Error("usbmux closed before Connect result"));
      socket.once("error", fail); socket.once("close", close); socket.setTimeout(10_000, () => fail(new Error("usbmux Connect timed out")));
      const data = (chunk: Buffer): void => { try { const rest = decoder.push(chunk, (value) => {
        const v = value as Record<string, Plist>;
        if (v["MessageType"] !== "Result" || v["Number"] !== 0) throw new Error("usbmux Connect rejected");
        socket.pause(); socket.removeListener("data", data); socket.removeListener("error", fail); socket.removeListener("close", close); socket.setTimeout(0); resolve(socket); return false;
      }); if (rest.length) socket.unshift(rest); } catch (error) { fail(error as Error); } };
      socket.on("data", data);
      socket.once("connect", () => socket.write(muxPacket({ MessageType: "Connect", DeviceID: deviceId, PortNumber: ((port & 255) << 8) | (port >> 8), ClientVersionString: "OmO UI", ProgName: "OmO UI" })));
    });
  }
  stop(): void { for (const socket of this.sockets) socket.destroy(); }
}
