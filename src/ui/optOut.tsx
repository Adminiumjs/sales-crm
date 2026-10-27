/**
 * THE LINE WHERE THE CRM TAKES AN ADDRESS: what to tell the person ("we may
 * e-mail you now and then; you can say no now, or from any e-mail"), and the
 * button for when they say no right there.
 *
 * The screen that draws it says so with its save (`optOut: { shown: true }`),
 * and the server stamps the row's mark: the person was offered a way to say
 * no. A row brought in from a file never carries the mark. "They said no" is
 * kept until the save, then puts the saved row's address on the do-not-email
 * list; a person who said no is never saved as offered, so they are never
 * mailed as an existing customer whatever the list says.
 *
 * Each screen gives the words in its own namespace: the line is said in the
 * screen's own voice.
 */
import { useId } from "react";

import { Icon } from "../shell/icons.tsx";

export interface OptOutWords {
  /** What to tell them. */
  line: string;
  /** The button: "They said no". */
  no: string;
  /** Under the button once pressed: what the save will do. */
  noted: string;
}

export function OptOutLine({ words, saidNo, onSaidNo, disabled }: { words: OptOutWords; saidNo: boolean; onSaidNo: (no: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="crm-optout" data-optout={saidNo ? "no" : "told"}>
      <p className="crm-optout-line" id={`${id}-line`}>
        <Icon name="mail" size={14} />
        <span>{words.line}</span>
      </p>
      <button
        type="button"
        className="crm-btn crm-btn-ghost crm-btn-32 mr-gi"
        aria-pressed={saidNo}
        aria-describedby={`${id}-line`}
        disabled={disabled === true}
        onClick={() => onSaidNo(!saidNo)}
      >
        <Icon name={saidNo ? "check" : "ban"} size={14} />
        {words.no}
      </button>
      {saidNo && (
        <p className="crm-field-note" role="status">
          {words.noted}
        </p>
      )}
    </div>
  );
}
