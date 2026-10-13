/**
 * The icons the shell draws, by the names the table of screens uses.
 *
 * Named one by one so the bundle carries these and no others: an icon looked
 * up by an arbitrary string would pull in the whole set.
 */
import {
  Activity, AlarmClock, ArrowRightLeft, Bell, CalendarPlus, CalendarSync, CalendarX, ClockAlert, BellRing, Bookmark, Building2, CalendarArrowUp, CalendarClock, CalendarDays, CalendarRange, Check, CheckCheck, Clock, Handshake, Plus, TriangleAlert, Trophy, ChevronUp, Trash2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleDot, CircleSlash, ClipboardList, ClockArrowUp, Columns3, Contact, Factory,
  FileQuestion, FileText, FolderClock, GraduationCap, HeartHandshake, History, House, Inbox, Layers, Loader, Lock, LogOut, Mail, Map, MapPin, Menu, Moon, NotebookPen, Package, Plane, Repeat,
  RotateCw, Search, Send, Settings, Stamp, Sun, Target, Tent, TrendingUp, UserRoundPlus, Users, X, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  activity: Activity, "alarm-clock": AlarmClock, "calendar-plus": CalendarPlus, "calendar-sync": CalendarSync, "calendar-x": CalendarX, "clock-alert": ClockAlert, "calendar-arrow-up": CalendarArrowUp, "calendar-days": CalendarDays, check: Check, "check-check": CheckCheck,
  "circle-alert": CircleAlert, "circle-dot": CircleDot, "clock-arrow-up": ClockArrowUp, loader: Loader, "trending-up": TrendingUp, "arrow-right-left": ArrowRightLeft, bell: Bell, "bell-ring": BellRing, bookmark: Bookmark, "building-2": Building2, "calendar-clock": CalendarClock,
  "calendar-range": CalendarRange, "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "circle-slash": CircleSlash, "clipboard-list": ClipboardList,
  "columns-3": Columns3, contact: Contact, factory: Factory, "file-question": FileQuestion, "file-text": FileText, "folder-clock": FolderClock, "graduation-cap": GraduationCap,
  "heart-handshake": HeartHandshake, history: History, house: House, inbox: Inbox, layers: Layers, lock: Lock, "log-out": LogOut, mail: Mail, map: Map, "map-pin": MapPin, menu: Menu, moon: Moon,
  "notebook-pen": NotebookPen, package: Package, plane: Plane, repeat: Repeat, "rotate-cw": RotateCw, search: Search, send: Send, settings: Settings, stamp: Stamp, sun: Sun, target: Target,
  tent: Tent, clock: Clock, handshake: Handshake, plus: Plus, "triangle-alert": TriangleAlert, trophy: Trophy, "chevron-up": ChevronUp, "trash-2": Trash2, "user-round-plus": UserRoundPlus, users: Users, x: X,
};

export const ICON_NAMES: readonly string[] = Object.keys(ICONS);

/** An icon by its name, sized in pixels. Decorative: the words beside it say what it is. */
export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Glyph = ICONS[name];
  if (Glyph === undefined) return null;
  return <Glyph width={size} height={size} aria-hidden="true" focusable="false" className={className} />;
}
