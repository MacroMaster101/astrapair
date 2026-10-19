import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceSearch, type PlaceSelection } from "./place-search";

const colombo: PlaceSelection = {
  label: "Colombo, Western Province, Sri Lanka",
  latitude: 6.9319,
  longitude: 79.8478,
  timezone: "Asia/Colombo",
};

function hidden(container: HTMLElement, name: string) {
  const el = container.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${name}"]`,
  );
  if (!el) throw new Error(`Missing hidden input ${name}`);
  return el;
}

describe("PlaceSearch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("carries the default place in hidden inputs", () => {
    const { container } = render(<PlaceSearch defaultPlace={colombo} />);

    expect(hidden(container, "placeLabel").value).toBe(colombo.label);
    expect(hidden(container, "latitude").value).toBe("6.9319");
    expect(hidden(container, "longitude").value).toBe("79.8478");
    expect(hidden(container, "timezone").value).toBe("Asia/Colombo");
  });

  it("clears the selection when the user edits the text", () => {
    const { container } = render(<PlaceSearch defaultPlace={colombo} />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Kandy" },
    });

    expect(hidden(container, "placeLabel").value).toBe("");
    expect(hidden(container, "latitude").value).toBe("");
    expect(hidden(container, "longitude").value).toBe("");
    expect(hidden(container, "timezone").value).toBe("");
  });

  describe("with a mocked search response", () => {
    async function search(results: unknown[]) {
      vi.useFakeTimers();
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ results }),
      } as Response);
      render(<PlaceSearch defaultPlace={null} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "Kandy" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      return input;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("is not expanded when the search returns no places", async () => {
      const input = await search([]);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(input.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(screen.queryByText(/OpenStreetMap/)).toBeNull();
    });

    it("sends the typed place in a POST body, never in the URL", async () => {
      await search([]);

      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe("/api/places");
      expect(String(url)).not.toContain("Kandy");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ q: "Kandy" });
    });

    it("shows the server's message and keeps no selection when the search answers 502", async () => {
      vi.useFakeTimers();
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          error:
            "Place search isn't available right now. Try again in a minute.",
        }),
      } as Response);
      const { container } = render(<PlaceSearch defaultPlace={null} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "Kandy" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(screen.getByRole("status").textContent).toBe(
        "Place search isn't available right now. Try again in a minute.",
      );
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(input.getAttribute("aria-expanded")).toBe("false");
      expect(hidden(container, "placeLabel").value).toBe("");
      expect(hidden(container, "timezone").value).toBe("");
    });

    it("shows fallback copy when the request itself fails, such as offline", async () => {
      vi.useFakeTimers();
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      const { container } = render(<PlaceSearch defaultPlace={null} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "Kandy" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(screen.getByRole("status").textContent).toBe(
        "Place search isn't available right now. Try again in a minute.",
      );
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(hidden(container, "latitude").value).toBe("");
    });

    it("recovers: a later successful search replaces the error message", async () => {
      vi.useFakeTimers();
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          json: async () => ({ error: "Place search isn't available." }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [{ id: "osm:N1", ...colombo, country: "LK" }],
          }),
        } as Response);
      render(<PlaceSearch defaultPlace={null} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "Kandy" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(screen.getByRole("status").textContent).toContain(
        "isn't available",
      );

      fireEvent.change(input, { target: { value: "Colombo" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });

    describe("remembering results", () => {
      const kandy = {
        id: "osm:N2",
        label: "Kandy, Central Province, Sri Lanka",
        latitude: 7.2906,
        longitude: 80.6337,
        timezone: "Asia/Colombo",
        country: "LK",
      };

      async function type(input: HTMLElement, value: string) {
        fireEvent.change(input, { target: { value } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(400);
        });
      }

      function setup() {
        vi.useFakeTimers();
        vi.mocked(fetch).mockImplementation(async (_url, init) => {
          const { q } = JSON.parse(String(init?.body)) as { q: string };
          return {
            ok: true,
            json: async () => ({
              results: [{ ...kandy, id: `osm:${q}`, label: `${q} place` }],
            }),
          } as Response;
        });
        render(<PlaceSearch defaultPlace={null} />);
        const input = screen.getByRole("combobox");
        fireEvent.focus(input);
        return input;
      }

      it("does not ask again when the text is edited back to an earlier query", async () => {
        const input = setup();

        await type(input, "Kandy");
        await type(input, "Colombo");
        expect(fetch).toHaveBeenCalledTimes(2);

        await type(input, "Kandy");
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(screen.getAllByRole("option")).toHaveLength(1);
        expect(screen.getByText("Kandy place")).toBeTruthy();
        expect(input.getAttribute("aria-expanded")).toBe("true");
      });

      it("treats case and extra spaces as the same query", async () => {
        const input = setup();

        await type(input, "Kandy");
        await type(input, "  kANDY ");
        await type(input, "Kandy  ");
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole("option")).toHaveLength(1);
      });

      it("does not remember a failed search", async () => {
        vi.useFakeTimers();
        vi.mocked(fetch)
          .mockResolvedValueOnce({
            ok: false,
            status: 502,
            json: async () => ({ error: "Place search isn't available." }),
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ results: [kandy] }),
          } as Response);
        render(<PlaceSearch defaultPlace={null} />);
        const input = screen.getByRole("combobox");
        fireEvent.focus(input);

        await type(input, "Kandy");
        await type(input, "Colombo");
        await type(input, "Kandy");

        expect(fetch).toHaveBeenCalledTimes(3);
      });

      it("keeps only the last 20 queries", async () => {
        const input = setup();

        for (let i = 0; i < 21; i++) await type(input, `Place ${i}`);
        expect(fetch).toHaveBeenCalledTimes(21);

        // The newest are still remembered; the oldest was dropped.
        await type(input, "Place 19");
        expect(fetch).toHaveBeenCalledTimes(21);
        await type(input, "Place 0");
        expect(fetch).toHaveBeenCalledTimes(22);
      });

      it("drops the least recently used query, not the oldest one added", async () => {
        const input = setup();

        for (let i = 0; i < 20; i++) await type(input, `Place ${i}`);
        expect(fetch).toHaveBeenCalledTimes(20);

        // Using the oldest again makes it the newest.
        await type(input, "Place 0");
        expect(fetch).toHaveBeenCalledTimes(20);
        await type(input, "Place 20");
        expect(fetch).toHaveBeenCalledTimes(21);

        // "Place 1" was the least recently used and is gone; "Place 0" stays.
        await type(input, "Place 0");
        expect(fetch).toHaveBeenCalledTimes(21);
        await type(input, "Place 1");
        expect(fetch).toHaveBeenCalledTimes(22);
      });

      it("keeps the results in memory only, never in browser storage", async () => {
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        const input = setup();

        await type(input, "Kandy");

        expect(setItem).not.toHaveBeenCalled();
        setItem.mockRestore();
      });
    });

    it("is expanded when the search returns places", async () => {
      const input = await search([{ id: "osm:N1", ...colombo, country: "LK" }]);

      expect(input.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(
        screen.getByText(
          "Place data from OpenStreetMap contributors and GeoNames",
        ),
      ).toBeTruthy();
    });
  });
});
