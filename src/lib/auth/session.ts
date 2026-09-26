import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { SIGN_IN_PATH } from "./routes";

/** Verified user id from the session JWT, or null. Deduped per request. */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
});

export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) redirect(SIGN_IN_PATH);
  return userId;
}

export const getProfile = cache(async () => {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, onboarded_at")
    .eq("id", userId)
    .single();
  if (error) throw new Error("Failed to load profile");
  return data;
});
