import { describe, expect, it } from "vitest";
import { ATTACHMENT_HEADER, capImages, isImageFile, messageInput, splitAttachments, type ImageInput } from "../../src/ui/composer/attachments";

describe("attachments", () => {
  it("accepts supported image extensions and clipboard MIME types only", () => {
    for (const name of ["a.PNG", "a.jpg", "a.jpeg", "a.gif", "a.webp"]) expect(isImageFile(name)).toBe(true);
    expect(isImageFile("clipboard", "image/png")).toBe(true);
    expect(isImageFile("a.pdf", "application/pdf")).toBe(false);
    expect(isImageFile("a.svg", "image/svg+xml")).toBe(false);
  });
  it("caps the combined draft at ten", () => {
    const image: ImageInput = { type: "image", url: "data:image/png;base64,AA==" };
    expect(capImages(Array(9).fill(image), [image, image])).toHaveLength(10);
  });
  it("sends native image items alongside unchanged text, including image-only input", () => {
    const paths = ["/tmp/a.png", "/Users/me/My Shots/b.jpg"];
    const images = paths.map(path => ({ type: "localImage", path }));
    expect(messageInput(" \n", paths)).toEqual(images);
    expect(messageInput(" describe\n", paths)).toEqual([{ type: "text", text: " describe\n", text_elements: [] }, ...images]);
    expect(messageInput("describe", [])).toEqual([{ type: "text", text: "describe", text_elements: [] }]);
  });
  it("continues to read attachment blocks from older conversations", () => {
    expect(splitAttachments(`describe\nthis\n\n${ATTACHMENT_HEADER}\n- /tmp/a.png\n- /tmp/b c.png`)).toEqual({ text: "describe\nthis", paths: ["/tmp/a.png", "/tmp/b c.png"] });
    expect(splitAttachments(`${ATTACHMENT_HEADER}\n- /tmp/a.png`)).toEqual({ text: "", paths: ["/tmp/a.png"] });
    const windowsPaths = ["C:\\Users\\me\\My Shots\\a.png", "\\\\server\\share\\b.png"];
    expect(splitAttachments(`Windows images\n\n${ATTACHMENT_HEADER}\n${windowsPaths.map(path => `- ${path}`).join("\n")}`)).toEqual({ text: "Windows images", paths: windowsPaths });
    for (const text of ["plain", `quote ${ATTACHMENT_HEADER}\n- /tmp/a.png`, `${ATTACHMENT_HEADER}\nnot a path`, `${ATTACHMENT_HEADER}`]) {
      expect(splitAttachments(text), text).toEqual({ text, paths: [] });
    }
  });
});
