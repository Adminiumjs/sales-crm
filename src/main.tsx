/*
 * Entry point.
 *
 * The stylesheets are imported here, before `App`, so the cascade order is
 * deterministic in the built bundle: tokens (custom properties) → base
 * (reset, fonts) → the page's own rules.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/rebuilding.css";

import App from "./app/App.tsx";
import { I18nProvider } from "./i18n/index.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root — check index.html");

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
