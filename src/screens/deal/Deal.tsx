/**
 * ONE DEAL, by its address: `deals/<id>` is its room, `deals/<id>/comments`
 * the team's comments on it. A deal is in no menu: it is reached from a card
 * on the board, a row of Today, This week, Closed or Quotes, or a link
 * somebody sent.
 */
import type { ScreenProps } from "../../shell/screens.tsx";
import { Comments } from "./Comments.tsx";
import { NoDeal, Room } from "./Room.tsx";

export function DealScreen({ rest }: ScreenProps) {
  const [id, page, ...more] = rest;
  if (id === undefined || more.length > 0 || (page !== undefined && page !== "comments")) {
    return (
      <div className="crm-screen crm-room mr-screen" data-screen="deal">
        <NoDeal />
      </div>
    );
  }
  return page === "comments" ? <Comments id={id} /> : <Room id={id} />;
}
