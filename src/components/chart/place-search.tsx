"use client";

import { Loader2, MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlaceResult } from "@/lib/geocoding/places";
import { cn } from "@/lib/utils";

export interface PlaceSelection {
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

type Status = "idle" | "loading" | "error";

// Results are remembered for this form only, in memory, for the 20 most
// recently used queries, so editing the text back and forth does not ask the server again.
const CACHE_SIZE = 20;
const normalise = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Accessible combobox (ARIA 1.2 pattern) that requires an explicit choice.
 * Editing the text clears the selection so a stale place is never submitted.
 */
export function PlaceSearch({
  defaultPlace,
  errors,
}: {
  defaultPlace: PlaceSelection | null;
  errors?: string[];
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState(defaultPlace?.label ?? "");
  const [selected, setSelected] = useState<PlaceSelection | null>(defaultPlace);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [cache] = useState(() => new Map<string, PlaceResult[]>());
  const focusedRef = useRef(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (selected?.label === query || query.trim().length < 2) {
      abortRef.current?.abort();
      return;
    }
    const key = normalise(query);
    const remembered = cache.get(key);
    const show = (places: PlaceResult[]) => {
      setResults(places);
      setMessage(
        places.length ? null : "No places found. Try the nearest city.",
      );
      setStatus("idle");
      setOpen(focusedRef.current);
      setActive(-1);
    };
    const timer = setTimeout(
      async () => {
        abortRef.current?.abort();
        if (remembered) {
          // A hit becomes the newest, so the one dropped is the least recently used.
          cache.delete(key);
          cache.set(key, remembered);
          show(remembered);
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setStatus("loading");
        try {
          // POST with a body, so the typed place never appears in a URL.
          const res = await fetch("/api/places", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q: query.trim() }),
            signal: controller.signal,
          });
          const body = (await res.json()) as {
            results?: PlaceResult[];
            error?: string;
          };
          if (!res.ok) {
            setStatus("error");
            setMessage(body.error ?? "Place search isn't available right now.");
            setResults([]);
            setActive(-1);
            return;
          }
          const places = body.results ?? [];
          cache.delete(key);
          cache.set(key, places);
          if (cache.size > CACHE_SIZE) {
            cache.delete(cache.keys().next().value as string);
          }
          show(places);
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          setStatus("error");
          setResults([]);
          setActive(-1);
          setMessage(
            "Place search isn't available right now. Try again in a minute.",
          );
        }
      },
      remembered ? 0 : 300,
    );
    return () => clearTimeout(timer);
  }, [query, selected, cache]);

  function choose(place: PlaceResult) {
    const selection = {
      label: place.label,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
    };
    setSelected(selection);
    setQuery(place.label);
    setOpen(false);
    setResults([]);
    setActive(-1);
    setStatus("idle");
    setMessage(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hintId, errors?.length ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Birthplace</Label>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={open && results.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          aria-invalid={errors?.length ? true : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          placeholder="Colombo"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            if (e.target.value.trim().length < 2) {
              setResults([]);
              setActive(-1);
              setStatus("idle");
              setMessage(null);
            }
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            focusedRef.current = true;
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            if (results.length > 0) setOpen(true);
          }}
          onBlur={() => {
            focusedRef.current = false;
            blurTimerRef.current = setTimeout(() => setOpen(false), 150);
          }}
          className="h-10 pr-9"
        />
        {status === "loading" && (
          <Loader2
            aria-hidden
            className="text-muted-foreground absolute top-3 right-3 size-4 animate-spin"
          />
        )}
        {open && results.length > 0 && (
          <div className="bg-popover text-popover-foreground absolute z-10 mt-1 w-full rounded-lg border shadow-lg">
            <ul
              id={listId}
              role="listbox"
              className="max-h-72 overflow-auto p-1"
            >
              {results.map((place, i) => (
                <li
                  key={place.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(place);
                  }}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm",
                    i === active && "bg-accent",
                  )}
                >
                  <MapPin
                    aria-hidden
                    className="text-primary mt-0.5 size-4 shrink-0"
                  />
                  <span className="grid">
                    <span>{place.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {place.timezone}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground border-t px-3 py-1.5 text-xs">
              Place data from OpenStreetMap contributors and GeoNames
            </p>
          </div>
        )}
      </div>
      <p id={hintId} className="text-muted-foreground text-xs">
        {selected
          ? `Timezone: ${selected.timezone}`
          : "Start typing, then choose your birthplace from the list."}
      </p>
      {message && (
        <p role="status" className="text-muted-foreground text-sm">
          {message}
        </p>
      )}
      {errors?.length ? (
        <p id={errorId} className="text-destructive text-sm">
          {errors[0]}
        </p>
      ) : null}
      <input type="hidden" name="placeLabel" value={selected?.label ?? ""} />
      <input type="hidden" name="latitude" value={selected?.latitude ?? ""} />
      <input type="hidden" name="longitude" value={selected?.longitude ?? ""} />
      <input type="hidden" name="timezone" value={selected?.timezone ?? ""} />
    </div>
  );
}
