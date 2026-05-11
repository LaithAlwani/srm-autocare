// Maps string icon names stored on Convex `services` rows (from the Stitch
// design's Material Symbols vocabulary) to lucide-react components, so the
// admin can pick an icon by name without bundling Material Symbols.

import {
  BadgeCheck,
  Wand2,
  Armchair,
  Shield,
  Droplets,
  Car,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export const ICON_MAP: Record<string, LucideIcon> = {
  verified: BadgeCheck,
  auto_fix_high: Wand2,
  airline_seat_recline_extra: Armchair,
  shield: Shield,
  local_car_wash: Droplets,
  directions_car: Car,
  sparkles: Sparkles,
};

export function resolveIcon(name?: string | null): LucideIcon {
  if (!name) return Sparkles;
  return ICON_MAP[name] ?? Sparkles;
}

export const ICON_OPTIONS = Object.keys(ICON_MAP);
