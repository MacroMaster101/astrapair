"use client";

import { useActionState, useState } from "react";
import {
  PlaceSearch,
  type PlaceSelection,
} from "@/components/chart/place-search";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { BirthTimeAccuracy } from "@/lib/astrology/types";
import type { FormState } from "@/lib/auth/validation";
import { cn } from "@/lib/utils";
import { saveBirthDetails } from "../actions";

export interface BirthDetailsDefaults {
  displayName: string;
  birthDate: string;
  birthTime: string;
  accuracy: BirthTimeAccuracy;
  place: PlaceSelection | null;
}

const ACCURACY_OPTIONS: {
  value: BirthTimeAccuracy;
  label: string;
  hint: string;
}[] = [
  {
    value: "exact",
    label: "Exact",
    hint: "From a birth certificate or record",
  },
  {
    value: "approximate",
    label: "About this time",
    hint: "Within an hour or so",
  },
  {
    value: "unknown",
    label: "I don't know",
    hint: "We'll skip time-based details",
  },
];

export function BirthDetailsForm({
  defaults,
  today,
}: {
  defaults: BirthDetailsDefaults;
  today: string;
}) {
  const [state, action, pending] = useActionState(
    saveBirthDetails,
    {} as FormState,
  );
  const v = state.values;
  const [accuracy, setAccuracy] = useState<BirthTimeAccuracy>(
    (v?.accuracy as BirthTimeAccuracy) ?? defaults.accuracy,
  );
  // Keep the typed time while switching accuracy; re-sync when the server
  // action returns new values.
  const [time, setTime] = useState(v?.birthTime ?? defaults.birthTime);
  const [syncedValues, setSyncedValues] = useState(v);
  if (v !== syncedValues) {
    setSyncedValues(v);
    if (v?.birthTime) setTime(v.birthTime);
  }
  const echoedPlace: PlaceSelection | null =
    v?.placeLabel && v.timezone
      ? {
          label: v.placeLabel,
          latitude: Number(v.latitude),
          longitude: Number(v.longitude),
          timezone: v.timezone,
        }
      : v
        ? null
        : defaults.place;

  return (
    <form action={action} className="grid gap-6" noValidate>
      <FormField
        name="displayName"
        key={`name-${v?.displayName}`}
        defaultValue={v?.displayName ?? defaults.displayName}
        label="Name on your chart"
        autoComplete="nickname"
        required
        maxLength={80}
        errors={state.fieldErrors?.displayName}
      />
      <FormField
        name="birthDate"
        key={`date-${v?.birthDate}`}
        defaultValue={v?.birthDate ?? defaults.birthDate}
        label="Birth date"
        type="date"
        min="1900-01-01"
        max={today}
        required
        errors={state.fieldErrors?.birthDate}
      />

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">
          How sure are you of the birth time?
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {ACCURACY_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "has-focus-visible:ring-ring/50 grid cursor-pointer gap-0.5 rounded-lg border p-3 text-sm transition-colors has-focus-visible:ring-3",
                accuracy === o.value
                  ? "border-primary bg-primary/5"
                  : "hover:bg-accent",
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="accuracy"
                  value={o.value}
                  checked={accuracy === o.value}
                  onChange={() => setAccuracy(o.value)}
                  className="accent-primary"
                />
                {o.label}
              </span>
              <span className="text-muted-foreground pl-5 text-xs">
                {o.hint}
              </span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.accuracy?.length ? (
          <p className="text-destructive text-sm">
            {state.fieldErrors.accuracy[0]}
          </p>
        ) : null}
      </fieldset>

      <FormField
        name="birthTime"
        value={accuracy === "unknown" ? "" : time}
        onChange={(e) => setTime(e.target.value)}
        label="Birth time"
        type="time"
        disabled={accuracy === "unknown"}
        hint={
          accuracy === "unknown"
            ? "Without a time, your Ascendant and houses can't be calculated."
            : "Local time where you were born."
        }
        errors={state.fieldErrors?.birthTime}
      />

      <PlaceSearch
        key={`place-${v?.placeLabel ?? defaults.place?.label}`}
        defaultPlace={echoedPlace}
        errors={
          state.fieldErrors?.placeLabel ??
          state.fieldErrors?.timezone ??
          state.fieldErrors?.latitude ??
          state.fieldErrors?.longitude
        }
      />

      <FormError message={state.error} />
      <Button
        type="submit"
        disabled={pending}
        className="h-10 justify-self-start px-5"
      >
        {pending ? "Calculating your chart…" : "Save and see my chart"}
      </Button>
    </form>
  );
}
