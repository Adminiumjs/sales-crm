/**
 * The one page the app has while it is rebuilt.
 *
 * The foundation is tables, roles and sample data, installed by Adminium from
 * `manifest.json`; it has no screen of its own. This page says so, in the
 * reader's language, wherever the staff side is opened. The screens the app
 * had before are kept in `reference/` (not built) for the steps that draw the
 * new ones.
 */
import { useT } from "../i18n/index.tsx";

export default function App() {
  const t = useT();
  return (
    <main className="crm-rebuilding">
      <h1>{t("base.rebuilding.heading")}</h1>
      <p>{t("base.rebuilding.body")}</p>
    </main>
  );
}
