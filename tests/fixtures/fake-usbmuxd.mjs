import net from "node:net";

// Independent wire implementation: never opens Apple's daemon or a real device.
const plist = (v) => typeof v === "string" ? `<string>${v}</string>` : typeof v === "number" ? `<integer>${v}</integer>` : `<dict>${Object.entries(v).map(([k, x]) => `<key>${k}</key>${plist(x)}`).join("")}</dict>`;
const packet = (value) => {
  const body = Buffer.from(`<?xml version="1.0"?><plist version="1.0">${plist(value)}</plist>`);
  const header = Buffer.alloc(16); header.writeUInt32LE(body.length + 16); header.writeUInt32LE(1, 4); header.writeUInt32LE(8, 8); header.writeUInt32LE(1, 12);
  return Buffer.concat([header, body]);
};
const frame = (value) => { const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32BE(body.length); return Buffer.concat([header, body]); };
export async function createFakeUsbmuxd(socketPath) {
  if (!socketPath || socketPath === "/var/run/usbmuxd") throw new Error("Fake socket path required");
  const sockets = new Set(); const listeners = new Set(); const frames = []; const waiters = new Set(); let phone; let attached = true;
  const device = { MessageType: "Attached", DeviceID: 7, Properties: { ConnectionType: "USB", SerialNumber: "FAKE-IPHONE-007", DeviceName: "Test iPhone" } };
  const receive = (value) => { frames.push(value); for (const waiter of [...waiters]) if (waiter.predicate(value)) { waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(value); } };
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on("error", (error) => { if (!socket.destroyed) socket.destroy(error); }); socket.once("close", () => { sockets.delete(socket); listeners.delete(socket); });
    let buffer = Buffer.alloc(0); let mode = "mux";
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (mode === "mux" && buffer.length >= 16 && buffer.length >= buffer.readUInt32LE()) {
        const size = buffer.readUInt32LE(); const xml = buffer.subarray(16, size).toString(); buffer = buffer.subarray(size);
        if (xml.includes("<string>Listen</string>")) { listeners.add(socket); socket.write(packet({ MessageType: "Result", Number: 0 })); if (attached) socket.write(packet(device)); mode = "listen"; }
        else if (xml.includes("<string>Connect</string>") && xml.includes("<key>PortNumber</key><integer>64951</integer>")) { phone = socket; socket.write(packet({ MessageType: "Result", Number: 0 })); mode = "phone"; }
        else { socket.write(packet({ MessageType: "Result", Number: 3 })); socket.end(); }
      }
      if (mode === "phone") while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE() + 4) {
        const length = buffer.readUInt32BE(); const value = JSON.parse(buffer.subarray(4, length + 4).toString()); buffer = buffer.subarray(length + 4); receive(value);
        if (value.type === "ping") socket.write(frame({ type: "pong", t: value.t }));
      }
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  return {
    frames,
    waitFor(predicate, timeout = 15000) {
      const existing = frames.find(predicate); if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => { const waiter = { predicate, resolve, timer: undefined }; waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error("Fake phone frame timeout")); }, timeout); waiters.add(waiter); });
    },
    send(value) { if (!phone) throw new Error("No connected phone"); phone.write(frame(value)); },
    detach() { attached = false; for (const socket of listeners) socket.write(packet({ MessageType: "Detached", DeviceID: 7 })); },
    async close() { for (const waiter of waiters) { clearTimeout(waiter.timer); } for (const socket of sockets) socket.destroy(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}
