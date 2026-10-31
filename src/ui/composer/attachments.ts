import type { UserInput } from "../../../shared/protocol";

/** A composer attachment: a file on disk, or a pasted/dropped bitmap held as a data URL until it is saved to a file. */
export type ImageInput = Extract<UserInput, { type: "image" | "localImage" }>;
export const IMAGE_LIMIT = 10;
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

/** Legacy path attachment header retained for conversations sent before native image input support. */
export const ATTACHMENT_HEADER = "Attached images (open each file with the read tool):";

export function isImageFile(name: string, mime = ""): boolean {
  return /^image\/(png|jpeg|gif|webp)$/i.test(mime) || IMAGE_EXTENSIONS.includes(name.split(".").at(-1)?.toLowerCase() ?? "");
}
export function capImages(current: readonly ImageInput[], added: readonly ImageInput[]): ImageInput[] {
  return [...current, ...added].slice(0, IMAGE_LIMIT);
}

/** Native image inputs reach the model directly; text bytes remain unchanged. */
export function messageInput(text: string, imagePaths: readonly string[]): UserInput[] {
  return [
    ...(text.trim() === "" ? [] : [{ type: "text", text, text_elements: [] } satisfies UserInput]),
    ...imagePaths.map(path => ({ type: "localImage", path } satisfies UserInput)),
  ];
}

/** Splits a sent message into the user's text and the attached image paths of a trailing attachment block. */
export function splitAttachments(text: string): { text: string; paths: string[] } {
  const index = text.lastIndexOf(ATTACHMENT_HEADER);
  if (index < 0 || (index > 0 && text[index - 1] !== "\n")) return { text, paths: [] };
  const lines = text.slice(index + ATTACHMENT_HEADER.length).split("\n").filter((line) => line !== "");
  if (lines.length === 0 || !lines.every((line) => /^- (?:\/|[A-Za-z]:[\\/]|\\\\)/.test(line))) return { text, paths: [] };
  return { text: text.slice(0, index).replace(/\n+$/, ""), paths: lines.map((line) => line.slice(2)) };
}

export function readImage(file: File): Promise<ImageInput> {
  const path = window.omo.imageFilePath(file);
  if (path !== "") return Promise.resolve({ type: "localImage", path });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.onload = () => resolve({ type: "image", url: String(reader.result) });
    reader.readAsDataURL(file);
  });
}
