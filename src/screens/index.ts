/**
 * Every built screen, added to the shell's registry. Imported once, by the
 * app's entry, before anything is drawn.
 */
import { register } from "../shell/screens.tsx";
import { Closed } from "./closed/Closed.tsx";
import { Pipeline } from "./pipeline/Pipeline.tsx";
import { Approvals } from "./quotes/Approvals.tsx";
import { Quotes } from "./quotes/Quotes.tsx";
import { Today } from "./today/Today.tsx";
import { Week } from "./week/Week.tsx";

register("today", Today);
register("week", Week);
register("pipeline", Pipeline);
register("archive", Closed);
register("quotes", Quotes);
register("approvals", Approvals);
