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

import { SURFACE_SIDE } from "./surface.ts";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root — check index.html");
const root = createRoot(container);

/*
 * Two sides, one source. `SURFACE_SIDE` folds to a literal at build time, so
 * the branch not taken is not in the bundle: the customer's quote page ships
 * none of the staff screens, and the staff side none of the customer's page.
 */
if (SURFACE_SIDE === "customer") {
  void Promise.all([import("./styles/customer.css"), import("./customer/CustomerApp.tsx")]).then(([, { default: CustomerApp }]) => {
    root.render(
      <StrictMode>
        <CustomerApp />
      </StrictMode>,
    );
  });
} else {
  void Promise.all([
    import("./app/App.tsx"),
    import("./screens/index.ts"),
    import("./styles/rebuilding.css"),
    import("./styles/shell.css"),
    import("./styles/screens.css"),
    import("./styles/selling.css"),
    import("./styles/quotes.css"),
    import("./styles/deal.css"),
    import("./styles/visits.css"),
    import("./styles/team.css"),
    import("./styles/teamwork.css"),
    import("./styles/accounts.css"),
    import("./styles/inbox.css"),
    import("./styles/own.css"),
    import("./styles/appsettings.css"),
    import("./styles/finding.css"),
    import("./styles/callnotes.css"),
    import("./styles/territory.css"),
    import("./styles/aftersale.css"),
    import("./styles/supply.css"),
    import("./styles/aftercare.css"),
    import("./styles/showroom.css"),
    import("./styles/jobs.css"),
    import("./styles/crew.css"),
    import("./styles/hours.css"),
    import("./styles/fleet.css"),
    import("./styles/vandays.css"),
  ]).then(([{ default: App }]) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
