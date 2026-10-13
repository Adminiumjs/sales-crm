/**
 * The app, from the moment the bundle runs to the first screen.
 *
 * It opens the session, takes the person's language from it, and then either
 * draws the screens or says plainly why it cannot: opened outside Adminium,
 * or Adminium did not answer.
 *
 * The screens themselves arrive with the shell (the next step of the plan);
 * until then the signed-in page says who is signed in and that the screens
 * are being rebuilt.
 */
import { I18nProvider, useT } from "../i18n/index.tsx";
import { SessionProvider, useBoot, useSession, type Boot } from "../session/session.tsx";
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

function Ground() {
  const t = useT();
  const session = useSession();
  const name = session.config.user?.name ?? "";
  return (
    <Notice heading={t("base.rebuilding.heading")} body={t("base.rebuilding.body")}>
      <p className="crm-notice-who" data-testid="signed-in-as">
        {t("base.signedInAs", { name })}
      </p>
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
          <Ground />
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
