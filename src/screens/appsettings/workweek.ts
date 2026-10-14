/**
 * The business's working days, for a screen that counts them (Cover's "10
 * working days"). Monday to Friday until the setting has been read.
 *
 * It does not listen by itself: each live stream is a connection the browser
 * keeps open, and it keeps six to one server at most. A screen that counts
 * working days adds `settings` to the tables it already listens to, and hands
 * over the count of what it heard as `round`: each new round reads the
 * setting again.
 */
import { useEffect, useState } from "react";

import { useSession } from "../../session/session.tsx";
import { workDaysOf, workWeek, type Day } from "./data.ts";

export function useWorkWeek(round = 0): ReadonlySet<Day> {
  const session = useSession();
  const [days, setDays] = useState<ReadonlySet<Day>>(() => workDaysOf(null));
  useEffect(() => {
    let gone = false;
    void workWeek(session, round > 0).then((week) => {
      if (!gone) setDays(week);
    });
    return () => {
      gone = true;
    };
  }, [session, round]);
  return days;
}
