/**
 * THE SCREENS THAT EXIST. A screen is listed here when it is built and proved;
 * the menu holds a line for it from that moment, and not before.
 *
 * A screen is given what follows its address (`pipeline/12` → `["12"]`) and
 * draws a record page, or "no record", from that itself.
 */
import type { ComponentType } from "react";

import type { RouteKey } from "./routes.ts";

export interface ScreenProps {
  rest: string[];
}

export const SCREENS: Partial<Record<RouteKey, ComponentType<ScreenProps>>> = {};

/** Add a built screen. Called once per screen from `screens/index.ts`, so this file imports no screen (a screen reads `isBuilt`). */
export function register(route: RouteKey, screen: ComponentType<ScreenProps>): void {
  SCREENS[route] = screen;
}

export const isBuilt = (route: RouteKey): boolean => SCREENS[route] !== undefined;
