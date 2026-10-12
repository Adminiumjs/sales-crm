/**
 * 404.
 *
 * Reachable from the sidebar's Archive link, which is deliberately a cut
 * feature rather than a dead button — the view exists, says so honestly, and
 * offers the way back.
 */

import { Compass } from "lucide-react";

import { useI18n } from "../i18n/index.tsx";
import { useStore } from "../state/store.ts";
import { Button, Empty } from "../components/Primitives.tsx";

export default function NotFound() {
  const { t } = useI18n();
  const go = useStore((s) => s.go);
  const persona = useStore((s) => s.persona);

  return (
    <div className="mr-screen">
      <Empty
        icon={<Compass size={22} aria-hidden="true" />}
        title={t("notfound.title")}
        body={t("notfound.body")}
        action={
          <Button onClick={() => go(persona === "manager" ? "manager" : "today")}>
            {t("notfound.action")}
          </Button>
        }
      />
    </div>
  );
}
