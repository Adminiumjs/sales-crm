/**
 * Area bundle: **Jobs on site**, the office side and the route (P20, P21).
 * Two halves, each a key at a time (see `table.ts`): `jobs-office.ts` (the
 * menu, Deliveries, the booking dialog, the day sheet, the operations
 * manager's home) and `jobs-more.ts` (the route, the sign-off, a job's site,
 * the snag list, delivery notes, recycling, Settings → Crews).
 */
import { jobsMore } from "./jobs-more.ts";
import { jobsOffice } from "./jobs-office.ts";
import { tables } from "./table.ts";

export const jobs = /*#__PURE__*/ tables({ ...jobsOffice, ...jobsMore });
