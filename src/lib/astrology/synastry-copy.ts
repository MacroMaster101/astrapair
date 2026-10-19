import {
  ASPECT_LABELS,
  ASPECT_MEANINGS,
  HOUSE_MEANINGS,
  bodyLabel,
  ordinal,
  pointLabel,
} from "./interpretations";
import type { HouseOverlay, SynastryAspect } from "./synastry";
import type { AspectType } from "./types";

export const SUPPORTIVE_TYPES: AspectType[] = [
  "conjunction",
  "trine",
  "sextile",
];
export const CHALLENGING_TYPES: AspectType[] = ["square", "opposition"];

export function synastryAspectTitle(x: SynastryAspect): string {
  return `Your ${pointLabel(x.a)} ${ASPECT_LABELS[x.type].toLowerCase()} their ${pointLabel(x.b)}`;
}

export function describeSynastryAspect(x: SynastryAspect): string {
  return `Your ${pointLabel(x.a)} and their ${pointLabel(x.b)} ${ASPECT_MEANINGS[x.type]}.`;
}

export function describeOverlay(
  o: HouseOverlay,
  direction: "yoursInTheirs" | "theirsInYours",
): string {
  const [owner, host] =
    direction === "yoursInTheirs" ? ["Your", "their"] : ["Their", "your"];
  return `${owner} ${bodyLabel(o.body)} falls in ${host} ${ordinal(o.house)} house, the area of ${HOUSE_MEANINGS[o.house]}.`;
}
