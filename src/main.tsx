import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ui/theme/fonts.css";
import "./ui/theme/base.css";
import "./ui/theme/legacy-tokens.css";
import "./ui/theme/omo-theme.css";
import "./ui/theme/tokens.css";
import "./ui/theme/dsw-bridge.css";
import "./ui/theme/appearance.css";
import "./ui/app.css";
import "./ui/lib/input-modality";
import { App } from "./App";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
