/**
 * WHO IS SIGNED IN, and the one client every screen reads and writes through.
 *
 * The staff side is served by Adminium behind the person's own sign-in. At
 * boot it asks Adminium for its config (the person, what they may do, the
 * app's parts, the server's clock) and opens the session client on it
 * (`staffSession.ts`, shared with the other apps).
 *
 * Three things can be true before any screen is drawn, and each has a page:
 *
 *  - `ready`       a session; the screens render inside it;
 *  - `outside`     no config answered: the bundle was opened somewhere that is
 *                  not an Adminium (a plain `npm run build`, a static host).
 *                  The app has no data of its own to show there, and says so;
 *  - `unreachable` the config did not arrive at all: the line, or the server.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { setWeekStart } from "../lib/format.ts";
import { connectStaffSession, LostReply, StaffError, type StaffSession } from "../staffSession.ts";

export type Boot = { state: "loading" } | { state: "ready"; session: StaffSession } | { state: "outside" } | { state: "unreachable" };

const SessionContext = createContext<StaffSession | null>(null);

/** The session of whoever is signed in. Only inside `<SessionGate>`'s ready state. */
export function useSession(): StaffSession {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession is read inside <SessionGate>, once the session is open");
  return session;
}

/** Open the session once; `again` asks afresh after "could not be reached". */
export function useBoot(open: () => Promise<StaffSession> = connectStaffSession): { boot: Boot; again: () => void } {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let gone = false;
    setBoot({ state: "loading" });
    open().then(
      async (session) => {
        // The business's first day of the week, before any screen works a week out (plan 68 S9). A reader who may not read
        // the settings row keeps Monday.
        if (session.can("settings", "read")) {
          await session
            .list<{ week_starts?: string | null }>("settings", { select: ["week_starts"], limit: 1 })
            .then((page) => setWeekStart(page.rows[0]?.week_starts))
            .catch(() => undefined);
        }
        if (!gone) setBoot({ state: "ready", session });
      },
      (error: unknown) => {
        if (gone) return;
        // No config document at this address is an answer: the page is not inside Adminium.
        setBoot(error instanceof StaffError && error.code === "NO_CONFIG" ? { state: "outside" } : error instanceof LostReply ? { state: "unreachable" } : { state: "unreachable" });
      },
    );
    return () => {
      gone = true;
    };
  }, [open, round]);
  const again = useCallback(() => setRound((n) => n + 1), []);
  return { boot, again };
}

export function SessionProvider({ session, children }: { session: StaffSession; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
