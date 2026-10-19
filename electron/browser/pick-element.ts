/**
 * Element picker injected into the page's isolated world. Arming it returns at once; PICK_RESULT_SCRIPT then awaits it. It highlights the element under the pointer and resolves
 * with the clicked element's tag, CSS selector, visible text and rect, or null on Escape or cancel. The overlay lives
 * in a foreign page, so it carries its own fixed colors rather than app tokens.
 */
export const PICK_SCRIPT = String.raw`(() => { window.__omoPickResult = new Promise((resolve) => {
  window.__omoPickCancel?.();
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:2px solid #4c8dff;background:rgba(76,141,255,.14);border-radius:3px;left:0;top:0;width:0;height:0;display:none";
  const tag = document.createElement("div");
  tag.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;font:11px/16px ui-monospace,Consolas,monospace;background:#111827;color:#f9fafb;padding:2px 6px;border-radius:4px;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none";
  document.documentElement.append(box, tag);
  const esc = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
  const selectorOf = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      if (node.id) { parts.unshift("#" + esc(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((name) => /^[a-zA-Z][\w-]*$/.test(name)).slice(0, 2);
      if (classes.length > 0) part += "." + classes.map(esc).join(".");
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (node.tagName === "BODY") break;
    }
    return parts.join(" > ");
  };
  let current = null;
  const show = (element) => {
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px" });
    tag.textContent = selectorOf(element);
    Object.assign(tag.style, { display: "block", left: Math.max(0, rect.left) + "px", top: (rect.top > 22 ? rect.top - 20 : rect.bottom + 2) + "px" });
  };
  const move = (event) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || element === current || element === box || element === tag) return;
    current = element;
    show(element);
  };
  const block = (event) => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
  const finish = (element) => {
    removeEventListener("mousemove", move, true);
    removeEventListener("mousedown", block, true);
    removeEventListener("mouseup", block, true);
    removeEventListener("click", click, true);
    removeEventListener("keydown", key, true);
    box.remove();
    tag.remove();
    window.__omoPickCancel = undefined;
    if (!element) { resolve(null); return; }
    const rect = element.getBoundingClientRect();
    const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 120);
    resolve({ tag: element.tagName.toLowerCase(), selector: selectorOf(element), text, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  };
  const click = (event) => { block(event); move(event); finish(current || event.target); };
  const key = (event) => { if (event.key === "Escape") { block(event); finish(null); } };
  window.__omoPickCancel = () => finish(null);
  addEventListener("mousemove", move, true);
  addEventListener("mousedown", block, true);
  addEventListener("mouseup", block, true);
  addEventListener("click", click, true);
  addEventListener("keydown", key, true);
}); return true; })()`;

/** Resolves with the armed picker's result. */
export const PICK_RESULT_SCRIPT = "window.__omoPickResult";

export const CANCEL_PICK_SCRIPT = "window.__omoPickCancel?.()";
