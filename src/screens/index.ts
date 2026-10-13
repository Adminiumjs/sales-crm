/**
 * Every built screen, added to the shell's registry. Imported once, by the
 * app's entry, before anything is drawn.
 */
import { register } from "../shell/screens.tsx";
import { Closed } from "./closed/Closed.tsx";
import { DealScreen } from "./deal/Deal.tsx";
import { Handover } from "./deal/Handover.tsx";
import { Pipeline } from "./pipeline/Pipeline.tsx";
import { Approvals } from "./quotes/Approvals.tsx";
import { Quotes } from "./quotes/Quotes.tsx";
import { Feed } from "./team/Feed.tsx";
import { Health } from "./team/Health.tsx";
import { Lost } from "./team/Lost.tsx";
import { Nudges } from "./team/Nudges.tsx";
import { Team } from "./team/Team.tsx";
import { Today } from "./today/Today.tsx";
import { Visits } from "./visits/Visits.tsx";
import { Week } from "./week/Week.tsx";

register("today", Today);
register("week", Week);
register("visits", Visits);
register("pipeline", Pipeline);
register("archive", Closed);
register("quotes", Quotes);
register("approvals", Approvals);
register("team", Team);
register("health", Health);
register("lost", Lost);
register("feed", Feed);
register("nudges", Nudges);
register("deal", DealScreen);
register("handover", Handover);
