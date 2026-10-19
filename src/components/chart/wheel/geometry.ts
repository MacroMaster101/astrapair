const TAU = 2 * Math.PI;

/** Wraps a longitude into 0 (inclusive) to 360 (exclusive). */
export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Screen angle, in radians, of an ecliptic longitude on the wheel. The
 * Ascendant sits at PI (left) and longitudes increase counterclockwise on
 * screen: left, bottom, right, top. That puts houses 1 to 6 below the horizon.
 */
export function wheelAngle(
  longitude: number,
  ascendantLongitude: number,
): number {
  const offset = normalizeDegrees(longitude - ascendantLongitude);
  return (Math.PI + (offset * Math.PI) / 180) % TAU;
}

/** Point on a circle, with the y axis pointing down as it does in SVG. */
export function polar(
  cx: number,
  cy: number,
  r: number,
  angle: number,
): { x: number; y: number } {
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}

interface Cluster {
  /** Unrolled true longitudes, ascending. */
  longitudes: number[];
  indexes: number[];
  fixed: boolean[];
}

const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * Display longitude of a cluster's first member. A cluster is centred on its
 * members, unless it holds fixed points: then it slides so those stay put.
 */
function clusterStart(c: Cluster, separation: number): number {
  const anchored = c.longitudes
    .map((longitude, i) => longitude - i * separation)
    .filter((_, i) => c.fixed[i]);
  return anchored.length > 0
    ? mean(anchored)
    : mean(c.longitudes) - ((c.longitudes.length - 1) * separation) / 2;
}

const clusterEnd = (c: Cluster, separation: number) =>
  clusterStart(c, separation) + (c.longitudes.length - 1) * separation;

/**
 * Fans out points that sit closer together than `minSeparationDeg` so their
 * labels do not overlap. Each cluster is spread evenly around its own centre,
 * the order around the ring is kept, and points with room to spare do not
 * move. A `fixed` point (an axis line, say) keeps its place and its
 * neighbours make room around it. The result is in the same order as the
 * input.
 */
export function declutter(
  points: { id: string; longitude: number; fixed?: boolean }[],
  minSeparationDeg: number,
): { id: string; longitude: number; displayLongitude: number }[] {
  const count = points.length;
  if (count === 0) return [];
  // More points than fit at the requested spacing: share the circle evenly.
  const separation = Math.min(minSeparationDeg, 360 / count);

  const order = points
    .map((p, index) => ({ index, longitude: normalizeDegrees(p.longitude) }))
    .sort((a, b) => a.longitude - b.longitude);

  // Cut the circle at its widest gap so a cluster across 0/360 stays whole.
  let cut = 0;
  let widest = -1;
  for (let i = 0; i < count; i++) {
    const next = order[(i + 1) % count];
    const gap = normalizeDegrees(next.longitude - order[i].longitude);
    const span = count === 1 ? 360 : gap;
    if (span > widest) {
      widest = span;
      cut = (i + 1) % count;
    }
  }

  const base = order[cut].longitude;
  let clusters: Cluster[] = [];
  for (let i = 0; i < count; i++) {
    const item = order[(cut + i) % count];
    clusters.push({
      longitudes: [base + normalizeDegrees(item.longitude - base)],
      indexes: [item.index],
      fixed: [points[item.index].fixed === true],
    });
  }

  // Merge neighbours until every cluster clears the one before it. If the
  // last cluster runs into the first one across the cut, join those too.
  for (let pass = 0; pass <= count; pass++) {
    const merged: Cluster[] = [];
    for (const cluster of clusters) {
      let current = cluster;
      while (
        merged.length > 0 &&
        clusterStart(current, separation) <
          clusterEnd(merged[merged.length - 1], separation) + separation - 1e-9
      ) {
        const previous = merged.pop()!;
        current = {
          longitudes: [...previous.longitudes, ...current.longitudes],
          indexes: [...previous.indexes, ...current.indexes],
          fixed: [...previous.fixed, ...current.fixed],
        };
      }
      merged.push(current);
    }
    clusters = merged;

    const first = clusters[0];
    const last = clusters[clusters.length - 1];
    const wraps =
      clusters.length > 1 &&
      clusterEnd(last, separation) + separation - 1e-9 >
        clusterStart(first, separation) + 360;
    if (!wraps) break;
    clusters = [
      ...clusters.slice(1),
      {
        longitudes: first.longitudes.map((l) => l + 360),
        indexes: first.indexes,
        fixed: first.fixed,
      },
    ];
  }

  const display = new Array<number>(count);
  for (const cluster of clusters) {
    const start = clusterStart(cluster, separation);
    cluster.indexes.forEach((index, i) => {
      // A lone point keeps its exact longitude, free of rounding noise.
      display[index] =
        cluster.indexes.length === 1
          ? normalizeDegrees(points[index].longitude)
          : normalizeDegrees(start + i * separation);
    });
  }

  return points.map((p, index) => ({
    id: p.id,
    longitude: p.longitude,
    displayLongitude: display[index],
  }));
}
