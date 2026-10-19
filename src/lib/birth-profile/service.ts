import "server-only";
import { parseStoredChart } from "@/lib/astrology/chart-schema";
import { inputHash } from "@/lib/astrology/input-hash";
import { getAstrologyProvider } from "@/lib/astrology/provider";
import type {
  BirthInput,
  BirthTimeAccuracy,
  NatalChart,
} from "@/lib/astrology/types";
import { requireUserId } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BirthProfileData } from "./schema";

export class BirthProfileSaveError extends Error {}

export interface StoredBirthProfile {
  id: string;
  displayName: string | null;
  placeLabel: string;
  input: BirthInput;
}

const PROFILE_COLUMNS =
  "id, display_name, birth_place_label, birth_date, birth_time, birth_time_accuracy, latitude, longitude, timezone_id";

function toStoredProfile(
  row: Pick<
    Database["public"]["Tables"]["birth_profiles"]["Row"],
    | "id"
    | "display_name"
    | "birth_place_label"
    | "birth_date"
    | "birth_time"
    | "birth_time_accuracy"
    | "latitude"
    | "longitude"
    | "timezone_id"
  >,
): StoredBirthProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    placeLabel: row.birth_place_label,
    input: {
      birthDate: row.birth_date,
      // Postgres returns "HH:mm:ss"; the engine uses "HH:mm".
      birthTime: row.birth_time ? row.birth_time.slice(0, 5) : null,
      accuracy: row.birth_time_accuracy as BirthTimeAccuracy,
      latitude: row.latitude,
      longitude: row.longitude,
      timezone: row.timezone_id,
    },
  };
}

export async function getOwnBirthProfile(): Promise<StoredBirthProfile | null> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("birth_profiles")
    .select("*")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to load birth profile");
  return data ? toStoredProfile(data) : null;
}

type ChartStage = "load" | "calculate" | "store" | "prune";

/**
 * Carries only a stage and a short code: the PostgREST error code for database
 * steps, or the error class name for the calculation step. Messages are never
 * kept because engine and database messages can embed birth data.
 */
class ChartError extends Error {
  constructor(
    readonly stage: ChartStage,
    readonly detail: string,
  ) {
    super("Chart step failed");
  }
}

const dbCause = (e: { code?: string | null }) => e.code || "unknown";

function logChartFailure(profileId: string, e: unknown) {
  const stage = e instanceof ChartError ? e.stage : "calculate";
  const code =
    e instanceof ChartError ? e.detail : ((e as Error)?.name ?? "Error");
  // Never log the error message or any input: both can contain birth data.
  console.error("Chart calculation failed", { profileId, stage, code });
}

type AdminClient = SupabaseClient<Database>;

function logPruneFailure(profileId: string, code: string) {
  console.error("Chart prune failed", { profileId, stage: "prune", code });
}

/**
 * Removes charts made from older inputs. A failure here never fails the request,
 * including a missing secret key. Clients cannot delete charts, so this uses the
 * admin client.
 */
async function pruneStaleCharts(
  getAdmin: () => AdminClient,
  profileId: string,
  hash: string,
) {
  let admin: AdminClient;
  try {
    admin = getAdmin();
  } catch {
    logPruneFailure(profileId, "config");
    return;
  }
  const { error } = await admin
    .from("charts")
    .delete()
    .eq("birth_profile_id", profileId)
    .neq("input_hash", hash);
  if (error) logPruneFailure(profileId, dbCause(error));
}

/**
 * Returns the chart for this input, reusing a stored one when the input hash
 * matches, otherwise calculating and storing it. Older charts are always pruned.
 *
 * The existing chart is read with `reader`; writes and pruning always use the
 * admin client (created once, lazily) because clients cannot insert or delete
 * charts. Before any admin write for a chart that is not stored yet, ownership
 * of `profileId` is proven with the same `reader`: with the user client RLS
 * returns the profile only to its owner, and on the partner path the reader is
 * the admin client and the caller has already verified membership. The drop of
 * an unreadable stored row follows a successful `reader` select of that chart,
 * which RLS already scopes, so it needs no extra check.
 */
async function ensureChart(
  reader: SupabaseClient<Database>,
  profileId: string,
  input: BirthInput,
  admin?: AdminClient,
): Promise<NatalChart> {
  const provider = getAstrologyProvider();
  const hash = inputHash(input, provider.version);
  const adminFor = (stage: ChartStage) => {
    try {
      return (admin ??= createAdminClient());
    } catch {
      throw new ChartError(stage, "config");
    }
  };
  const getAdmin = () => adminFor("prune");

  const { data: existing, error: loadError } = await reader
    .from("charts")
    .select("chart_json")
    .eq("birth_profile_id", profileId)
    .eq("input_hash", hash)
    .maybeSingle();
  if (loadError) throw new ChartError("load", dbCause(loadError));
  if (existing) {
    const stored = parseStoredChart(existing.chart_json, provider.version);
    if (stored) {
      await pruneStaleCharts(getAdmin, profileId, hash);
      return stored;
    }
    // Unreadable or out-of-date row: drop it and recalculate below.
    try {
      const { error: dropError } = await getAdmin()
        .from("charts")
        .delete()
        .eq("birth_profile_id", profileId)
        .eq("input_hash", hash);
      if (dropError) logPruneFailure(profileId, dbCause(dropError));
    } catch {
      // Missing secret key: logged here, and the insert below fails on it.
      logPruneFailure(profileId, "config");
    }
  }

  // No usable chart yet: prove ownership before any admin write.
  const { data: owned, error: ownerError } = await reader
    .from("birth_profiles")
    .select("id")
    .eq("id", profileId)
    .maybeSingle();
  if (ownerError) throw new ChartError("load", dbCause(ownerError));
  if (!owned) throw new ChartError("load", "not_found");

  let chart: NatalChart;
  try {
    chart = provider.calculateNatalChart(input);
  } catch (e) {
    throw new ChartError("calculate", (e as Error)?.name ?? "Error");
  }
  const { error: insertError } = await adminFor("store")
    .from("charts")
    .insert({
      birth_profile_id: profileId,
      house_system: chart.houseSystem,
      calculation_provider: provider.name,
      calculation_version: provider.version,
      input_hash: hash,
      chart_json: chart as unknown as Json,
    });
  // 23505: a concurrent request stored the same chart first, so it already exists.
  if (insertError && insertError.code !== "23505")
    throw new ChartError("store", dbCause(insertError));
  await pruneStaleCharts(getAdmin, profileId, hash);
  return chart;
}

export async function saveBirthProfile(
  userId: string,
  data: BirthProfileData,
): Promise<{ chartError: boolean }> {
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("birth_profiles")
    .upsert(
      {
        owner_user_id: userId,
        display_name: data.displayName,
        birth_date: data.input.birthDate,
        birth_time: data.input.birthTime,
        birth_time_accuracy: data.input.accuracy,
        birth_place_label: data.placeLabel,
        latitude: data.input.latitude,
        longitude: data.input.longitude,
        timezone_id: data.input.timezone,
      },
      { onConflict: "owner_user_id" },
    )
    .select("id")
    .single();
  if (error || !row) throw new BirthProfileSaveError();

  try {
    await ensureChart(supabase, row.id, data.input);
    return { chartError: false };
  } catch (e) {
    // The profile is saved and the chart page offers a retry.
    logChartFailure(row.id, e);
    return { chartError: true };
  }
}

/**
 * `profile` MUST come from `getOwnBirthProfile()` or an RLS-checked write:
 * ownership is re-checked with the user's client before any chart is stored, but
 * callers must never build a profile from request data.
 */
export async function getCurrentChart(
  profile: StoredBirthProfile,
): Promise<{ chart: NatalChart } | { chart: null; error: true }> {
  try {
    return {
      chart: await ensureChart(await createClient(), profile.id, profile.input),
    };
  } catch (e) {
    logChartFailure(profile.id, e);
    return { chart: null, error: true };
  }
}

/**
 * Loads another user's chart with the admin client. Callers MUST have verified
 * that the current user is an active member of a relationship with this user.
 * If the partner's chart is not stored yet it is calculated and stored (a
 * server-derived admin write). The result contains the partner's birth-derived
 * chart, including the birth input, so callers must project it to partner-safe
 * facts before anything reaches the browser.
 */
export async function getChartForVerifiedPartner(
  partnerUserId: string,
): Promise<
  | { chart: NatalChart; displayName: string | null }
  | { chart: null; missing: true }
  | { chart: null; error: true }
> {
  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    console.error("Partner chart failed", { stage: "load", code: "config" });
    return { chart: null, error: true };
  }
  const { data, error } = await admin
    .from("birth_profiles")
    .select(PROFILE_COLUMNS)
    .eq("owner_user_id", partnerUserId)
    .maybeSingle();
  if (error) {
    console.error("Partner chart failed", {
      stage: "load",
      code: dbCause(error),
    });
    return { chart: null, error: true };
  }
  if (!data) return { chart: null, missing: true };
  const profile = toStoredProfile(data);
  try {
    return {
      chart: await ensureChart(admin, profile.id, profile.input, admin),
      displayName: profile.displayName,
    };
  } catch (e) {
    logChartFailure(profile.id, e);
    return { chart: null, error: true };
  }
}
