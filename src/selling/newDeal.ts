/**
 * What "Start a deal" holds a deal to before anything is saved, kept apart
 * from the sheet so the rule can be read and tried on its own.
 *
 * A DEAL IS ALWAYS A COMPANY'S. The person picks one on the books, or makes a
 * new one from the enquiry. An enquiry that came with no company (a question
 * left in a website chat outside hours names none) opens the sheet with an
 * empty name for the new company: claiming it asks for the name, and an empty
 * one, or one of spaces, is refused here. The server would take a company with
 * an empty name, so this is where it is stopped.
 */
import type { MessageKey } from "../i18n/messages/index.ts";

/** The longest company name the companies table takes. */
export const COMPANY_NAME_MAX = 160;

export interface CompanyChoice {
  /** A company on the books, picked. */
  companyId: number | null;
  /** "A new company from here", picked. */
  makeNew: boolean;
  /** The new company's name: the enquiry's, or what the person typed when it had none. */
  newName: string;
}

/** Why the sheet's company cannot be saved, as the message it shows; null when it can. */
export function companyProblem(choice: CompanyChoice): MessageKey | null {
  if (choice.makeNew) return choice.newName.trim() === "" ? "deal.new.error.companyName" : null;
  return choice.companyId === null ? "deal.new.error.company" : null;
}
