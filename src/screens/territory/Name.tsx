/**
 * A COMPANY'S OR A CONTACT'S NAME on the Territory screen and on the screens
 * for customers after a sale (Renewals, Repeat orders, Referrals, the account
 * manager's home).
 *
 * Plain text today: the Accounts screens (`companies/<id>`, `contacts/<id>`)
 * are built in another lane. When they are merged, this is the ONE place that
 * turns every such name into a link to its record: wrap `children` in the
 * shell's link, by `kind` and `id`, for somebody whose menu holds Accounts.
 */
import type { ReactNode } from "react";

export function RecordName({ kind, id, className, children }: { kind: "company" | "contact"; id: number | null; className?: string; children: ReactNode }) {
  return (
    <span className={className} data-record={kind} data-record-id={id ?? undefined}>
      {children}
    </span>
  );
}
