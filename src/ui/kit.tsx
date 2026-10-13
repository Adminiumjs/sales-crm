/**
 * One of Adminium's own parts, drawn in a screen of this app (`kitParts.ts`
 * does the asking; this is its React wrapper).
 *
 * The part is mounted once and then only told what changed, so it keeps its
 * own scroll, focus and a card being carried. When the part cannot be drawn
 * here (no kit in this Adminium, another contract, the file did not load),
 * `fallback` is shown in its place, told why.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { KitUnavailable, mountPart, type KitMissing, type KitMounted, type KitPartName } from "../kitParts.ts";
import { useSession } from "../session/session.tsx";

export function KitPart<Props extends object>({ part, props, fallback, className }: { part: KitPartName; props: Props; fallback: (why: KitMissing, again: () => void) => ReactNode; className?: string }) {
  const session = useSession();
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<KitMounted<Props> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [missing, setMissing] = useState<KitMissing | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let gone = false;
    setMissing(null);
    mountPart<Props>(session.config, part, element, latest.current).then(
      (made) => {
        if (gone) return made.unmount();
        mounted.current = made;
        // What changed while the kit was loading.
        made.update(latest.current);
      },
      (error: unknown) => {
        if (gone) return;
        if (error instanceof KitUnavailable) setMissing(error.why);
        else throw error;
      },
    );
    return () => {
      gone = true;
      mounted.current?.unmount();
      mounted.current = null;
    };
  }, [session, part, round]);

  useEffect(() => {
    mounted.current?.update(props);
  }, [props]);

  return (
    <>
      <div ref={host} className={className} hidden={missing !== null} data-kit-part={part} />
      {missing !== null && fallback(missing, () => setRound((n) => n + 1))}
    </>
  );
}
