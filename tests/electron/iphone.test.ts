import { describe, expect, it } from "vitest";
import { decodePlist, encodePlist, muxPacket, MuxDecoder } from "../../electron/iphone/usbmux";
import { allowedMethod, encodeFrame, FrameDecoder, IPHONE_METHODS } from "../../electron/iphone/bridge";

describe("iPhone wire codecs", () => {
  it("round trips dict, strings, integers and XML entities", () => {
    const value = { MessageType: "Attached", DeviceID: 7, Properties: { SerialNumber: "<&\"'한글>", ConnectionType: "USB", Empty: "" } };
    expect(decodePlist(encodePlist(value))).toEqual(value);
    expect(decodePlist('<?xml version="1.0"?><!DOCTYPE plist PUBLIC "x" "y"><plist version="1.0">\n<dict><key>a</key><string/><key>b</key><integer>64951</integer></dict></plist>')).toEqual({ a: "", b: 64951 });
  });
  it("rejects invalid plist", () => { expect(() => decodePlist('<plist version="1.0"><dict><string>x</string></dict></plist>')).toThrow(); });
  it("frames little endian headers and decodes fragmented/coalesced packets", () => {
    const packet = muxPacket({ MessageType: "Result", Number: 0 }, 12);
    expect(packet.readUInt32LE()).toBe(packet.length);
    expect([packet.readUInt32LE(4), packet.readUInt32LE(8), packet.readUInt32LE(12)]).toEqual([1, 8, 12]);
    const decoder = new MuxDecoder(); const values: unknown[] = [];
    decoder.push(packet.subarray(0, 9), (value) => { values.push(value); });
    decoder.push(Buffer.concat([packet.subarray(9), packet]), (value) => { values.push(value); });
    expect(values).toEqual([{ MessageType: "Result", Number: 0 }, { MessageType: "Result", Number: 0 }]);
  });
  it("preserves raw bytes following Connect Result", () => {
    const raw = encodeFrame({ type: "ping", t: 1 });
    const decoder = new MuxDecoder();
    expect(decoder.push(Buffer.concat([muxPacket({ MessageType: "Result", Number: 0 }), raw]), () => false)).toEqual(raw);
  });
  it("rejects malformed usbmux headers", () => { const packet = muxPacket({}); packet.writeUInt32LE(2); expect(() => new MuxDecoder().push(packet, () => {})).toThrow(); });
  it("decodes fragmented and coalesced JSON frames", () => {
    const frame = { type: "rpc", id: 7, method: "thread/start", params: { text: "안녕" } };
    const bytes = encodeFrame(frame); expect(bytes.readUInt32BE()).toBe(bytes.length - 4);
    const decoder = new FrameDecoder(); const values: unknown[] = [];
    for (const byte of Buffer.concat([bytes, bytes])) decoder.push(Buffer.from([byte]), (v) => values.push(v));
    expect(values).toEqual([frame, frame]);
  });
  it("rejects oversized and invalid JSON frames", () => {
    const header = Buffer.alloc(4); header.writeUInt32BE(8 * 1024 * 1024 + 1);
    expect(() => new FrameDecoder().push(header, () => {})).toThrow("Frame too large");
    expect(() => new FrameDecoder().push(Buffer.from([0, 0, 0, 1, 123]), () => {})).toThrow();
  });
  it("allows only the documented phone RPC methods", () => {
    expect(IPHONE_METHODS).toHaveLength(13);
    for (const method of IPHONE_METHODS) expect(allowedMethod(method)).toBe(true);
    for (const method of ["thread/name/set", "thread/delete", "thread/archive"]) expect(allowedMethod(method)).toBe(true);
    for (const method of ["initialize", "mcpServerStatus/list", "config/write", "", null]) expect(allowedMethod(method)).toBe(false);
  });
});
