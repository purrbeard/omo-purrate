// Parser-blocking and local, so the production CSP needs no unsafe-inline script.
// This cache controls paint only; validated IPC preferences take over in React.
(() => {
  let dark = true;
  let palette = "noir";
  let background = "#0a0a0a";
  try {
    const saved = JSON.parse(localStorage.getItem("omo-ui-appearance") || "null");
    if (saved && ["light", "dark", "system"].includes(saved.theme)) {
      dark = saved.theme === "dark" || (saved.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      if (["noir", "omo", "classic", "mint", "ocean", "sbd"].includes(saved.palette)) palette = saved.palette;
      background = dark ? "#0a0a0a" : "#ffffff";
      if (saved.dark === dark && typeof saved.background === "string" && CSS.supports("color", saved.background)) {
        background = saved.background;
      }
    }
  } catch { /* Private/disabled storage keeps the noir dark fallback. */ }
  document.body.toggleAttribute("data-ds-dark-theme", dark);
  document.body.dataset.palette = palette;
  document.documentElement.style.backgroundColor = background;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
