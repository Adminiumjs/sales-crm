/**
 * The icons the shell draws, by the names the table of screens uses.
 *
 * Named one by one so the bundle carries these and no others: an icon looked
 * up by an arbitrary string would pull in the whole set.
 */
import {
  Activity, AlarmClock, ArrowRightLeft, Bell, CalendarPlus, CalendarSync, CalendarX, ClockAlert, BellRing, Bookmark, Building2, CalendarArrowUp, CalendarClock, CalendarDays, CalendarRange, Check, CheckCheck, Clock, Handshake, Plus, TriangleAlert, Trophy, ChevronUp, Trash2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleDot, CircleSlash, ClipboardList, ClockArrowUp, Columns3, Contact, Factory,
  FileQuestion, FileText, FolderClock, GraduationCap, HeartHandshake, History, House, Inbox, Layers, Loader, Lock, LogOut, Mail, Map, MapPin, Menu, Moon, NotebookPen, Package, Plane, Repeat,
  RotateCw, Search, Send, Settings, Stamp, Sun, Target, Tent, TrendingUp, UserRoundPlus, Users, X, MessageSquare, MessageSquarePlus, Pencil, Phone, StickyNote, MoveRight, FilePlus, PanelRightOpen, RotateCcw, EyeOff, CornerDownRight, Gavel, Hand, OctagonAlert, UserRound, type LucideIcon, ArrowLeftRight, CalendarCheck, Eye, Footprints, Gauge, UserRoundCheck, Flame, Globe, Languages, Link2, Pin, PinOff, ArrowUp, ArrowDown, Blocks, Command, Compass, Keyboard, SearchX, SunMoon, Zap, Truck, Store, Armchair,
  NotebookTabs, Route, ClipboardCheck, Recycle, Printer, FileCheck, FileX, FileWarning, PenLine, HardHat,
} from "lucide-react";
// After the job.
import { CircleOff, Frown, MessageSquareOff, PackageX, PhoneCall, PhoneOff, ShieldCheck, Star, Wrench } from "lucide-react";
// The crew's phone.
import { Camera, CircleX, Hourglass, Navigation, RefreshCw, WifiOff } from "lucide-react";
// Time sheets and training; Vehicles and crew, part A.
import { BadgeCheck, Fuel, Shield, ShieldX } from "lucide-react";
// A crew's vehicle for the day (plan 68 S14).
import { Ban, ChevronsUpDown, Info } from "lucide-react";
// The signed copy (plan 68 S13).
import { Download } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  activity: Activity, "alarm-clock": AlarmClock, "calendar-plus": CalendarPlus, "calendar-sync": CalendarSync, "calendar-x": CalendarX, "clock-alert": ClockAlert, "calendar-arrow-up": CalendarArrowUp, "calendar-days": CalendarDays, check: Check, "check-check": CheckCheck,
  "circle-alert": CircleAlert, "circle-dot": CircleDot, "clock-arrow-up": ClockArrowUp, loader: Loader, "trending-up": TrendingUp, "arrow-right-left": ArrowRightLeft, bell: Bell, "bell-ring": BellRing, bookmark: Bookmark, "building-2": Building2, "calendar-clock": CalendarClock,
  "calendar-range": CalendarRange, "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "circle-slash": CircleSlash, "clipboard-list": ClipboardList,
  "columns-3": Columns3, contact: Contact, factory: Factory, "file-question": FileQuestion, "file-text": FileText, "folder-clock": FolderClock, "graduation-cap": GraduationCap,
  "heart-handshake": HeartHandshake, history: History, house: House, inbox: Inbox, layers: Layers, lock: Lock, "log-out": LogOut, mail: Mail, map: Map, "map-pin": MapPin, menu: Menu, moon: Moon,
  "notebook-pen": NotebookPen, package: Package, plane: Plane, repeat: Repeat, "rotate-cw": RotateCw, search: Search, send: Send, settings: Settings, stamp: Stamp, sun: Sun, target: Target,
  tent: Tent, clock: Clock, handshake: Handshake, plus: Plus, "triangle-alert": TriangleAlert, trophy: Trophy, "chevron-up": ChevronUp, "trash-2": Trash2, "user-round-plus": UserRoundPlus, users: Users, x: X,
  // After the job.
  "phone-call": PhoneCall, "phone-off": PhoneOff, star: Star, frown: Frown, wrench: Wrench, "shield-check": ShieldCheck, "package-x": PackageX, "circle-off": CircleOff, "message-square-off": MessageSquareOff,
  "message-square": MessageSquare, "message-square-plus": MessageSquarePlus, pencil: Pencil, phone: Phone, "sticky-note": StickyNote, "move-right": MoveRight, "file-plus": FilePlus, "panel-right-open": PanelRightOpen, "rotate-ccw": RotateCcw, "eye-off": EyeOff, "corner-down-right": CornerDownRight, gavel: Gavel, hand: Hand, "octagon-alert": OctagonAlert, "user-round": UserRound, "arrow-left-right": ArrowLeftRight, "calendar-check": CalendarCheck, eye: Eye, footprints: Footprints, gauge: Gauge, "user-round-check": UserRoundCheck, flame: Flame, globe: Globe, languages: Languages, link: Link2, pin: Pin, "pin-off": PinOff, "arrow-up": ArrowUp, "arrow-down": ArrowDown, blocks: Blocks, command: Command, compass: Compass, keyboard: Keyboard, "search-x": SearchX, "sun-moon": SunMoon, zap: Zap, truck: Truck, store: Store, armchair: Armchair,
  // The crew's phone.
  camera: Camera, navigation: Navigation, "refresh-cw": RefreshCw, "wifi-off": WifiOff, hourglass: Hourglass, "circle-x": CircleX,
  // Time sheets and training; Vehicles and crew, part A.
  "badge-check": BadgeCheck, fuel: Fuel, shield: Shield, "shield-x": ShieldX,
  // A crew's vehicle for the day.
  ban: Ban, "chevrons-up-down": ChevronsUpDown, info: Info,
  // The signed copy.
  download: Download,
  "notebook-tabs": NotebookTabs, route: Route, "clipboard-check": ClipboardCheck, recycle: Recycle, printer: Printer, "file-check": FileCheck, "file-x": FileX, "file-warning": FileWarning, "pen-line": PenLine, "hard-hat": HardHat,
};

export const ICON_NAMES: readonly string[] = Object.keys(ICONS);

/** An icon by its name, sized in pixels. Decorative: the words beside it say what it is. */
export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Glyph = ICONS[name];
  if (Glyph === undefined) return null;
  return <Glyph width={size} height={size} aria-hidden="true" focusable="false" className={className} />;
}
