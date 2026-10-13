/**
 * The app, from the moment the bundle runs to the first screen.
 *
 * It opens the session, takes the person's language from it, and then either
 * draws the screens or says plainly why it cannot: opened outside Adminium,
 * or Adminium did not answer.
 *
 * Once a session is open everything is drawn inside the frame (`shell/Shell.tsx`):
 * the person's menu, the bar, and the page their address names.
 */
import { I18nProvider, useT } from "../i18n/index.tsx";
import { DealActionsProvider } from "../selling/actions.tsx";
import { SessionProvider, useBoot, type Boot } from "../session/session.tsx";
import { NavProvider } from "../shell/nav.tsx";
import { Shell } from "../shell/Shell.tsx";
import { ToastProvider } from "../ui/toast.tsx";
import type { StaffSession } from "../staffSession.ts";

function Notice({ heading, body, children }: { heading: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="crm-notice">
      <h1>{heading}</h1>
      <p>{body}</p>
      {children}
    </main>
  );
}

function Outside() {
  const t = useT();
  return <Notice heading={t("base.outside.heading")} body={t("base.outside.body")} />;
}

function Unreachable({ again }: { again: () => void }) {
  const t = useT();
  return (
    <Notice heading={t("base.unreachable.heading")} body={t("base.unreachable.body")}>
      <button type="button" className="crm-button" onClick={again}>
        {t("base.tryAgain")}
      </button>
    </Notice>
  );
}

export function Booted({ boot, again }: { boot: Boot; again: () => void }) {
  // Nothing is drawn while the config is on its way: it is one small read, and a flash of a page in the wrong language is worse.
  if (boot.state === "loading") return null;
  if (boot.state === "ready") {
    return (
      <I18nProvider person={boot.session.config.locale ?? null}>
        <SessionProvider session={boot.session}>
          <NavProvider>
            <ToastProvider>
              <DealActionsProvider>
                <Shell />
              </DealActionsProvider>
            </ToastProvider>
          </NavProvider>
        </SessionProvider>
      </I18nProvider>
    );
  }
  return <I18nProvider>{boot.state === "outside" ? <Outside /> : <Unreachable again={again} />}</I18nProvider>;
}

export default function App({ open }: { open?: () => Promise<StaffSession> }) {
  const { boot, again } = useBoot(open);
  return <Booted boot={boot} again={again} />;
}
