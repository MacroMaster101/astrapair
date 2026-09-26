"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/auth/session";
import {
  displayNameSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

const profileSchema = z.object({ displayName: displayNameSchema });

export async function updateProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName })
    .eq("id", userId);
  if (error)
    return { error: "We couldn't save your profile. Please try again." };

  revalidatePath("/", "layout");
  return { message: "Profile saved." };
}
