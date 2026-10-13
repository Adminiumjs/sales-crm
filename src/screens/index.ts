/**
 * Every built screen, added to the shell's registry. Imported once, by the
 * app's entry, before anything is drawn.
 */
import { register } from "../shell/screens.tsx";
import { Today } from "./today/Today.tsx";

register("today", Today);
