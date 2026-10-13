/** The role whose menu leads for a person, from the slugs of the app's roles they hold. Kept apart from `routes.ts` so a screen can ask without the whole table. */
import { rolesOf, type RoleKey } from "./routes.ts";

export const leadRole = (slugs: readonly string[]): RoleKey => rolesOf(slugs)[0]!;
