import tzlookup from "@photostructure/tz-lookup";
import { describe, expect, it, vi } from "vitest";
import { GeocodingUnavailableError, searchPlaces } from "./places";

vi.mock("server-only", () => ({}));
// Wraps the real lookup so individual tests can override it once.
vi.mock("@photostructure/tz-lookup", async (importActual) => {
  const actual = await importActual<{
    default: (a: number, b: number) => string;
  }>();
  return { default: vi.fn(actual.default) };
});

type Reply = { ok?: boolean; body?: unknown } | Error;

/** Routes by hostname so each source can succeed or fail independently. */
function mockFetch(photon: Reply, openMeteo: Reply = { body: {} }) {
  const fn = vi.fn(async (input: URL | string) => {
    const host = new URL(String(input)).hostname;
    const reply = host === "photon.komoot.io" ? photon : openMeteo;
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.ok ?? true,
      json: async () => reply.body,
    } as Response;
  });
  return fn as typeof fn & typeof fetch;
}

const feature = (
  properties: Record<string, unknown>,
  coordinates: unknown = [80.1110099, 7.1256209],
) => ({
  type: "Feature",
  properties: { osm_type: "N", osm_id: 1, osm_value: "town", ...properties },
  geometry: { type: "Point", coordinates },
});

const wathupitiwala = feature({
  osm_id: 4878217750,
  osm_value: "suburb",
  name: "Wathupitiwala",
  city: "Ranpokunagama",
  county: "Gampaha District",
  state: "Western Province",
  country: "Sri Lanka",
});

const openMeteoColombo = {
  results: [
    {
      id: 1248991,
      name: "Colombo",
      admin1: "Western Province",
      country: "Sri Lanka",
      latitude: 6.93548,
      longitude: 79.84868,
      timezone: "Asia/Colombo",
    },
  ],
};

describe("searchPlaces with Photon", () => {
  it("maps a feature to a place with label, coordinates, timezone and id", async () => {
    const fetchImpl = mockFetch({ body: { features: [wathupitiwala] } });
    const places = await searchPlaces("Wathupitiwala", fetchImpl);

    expect(places).toEqual([
      {
        id: "osm:N4878217750",
        label:
          "Wathupitiwala, Ranpokunagama, Gampaha District, Western Province, Sri Lanka",
        latitude: 7.1256209,
        longitude: 80.1110099,
        timezone: "Asia/Colombo",
        country: "Sri Lanka",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api/");
    expect(url.searchParams.get("q")).toBe("Wathupitiwala");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("osm_tag")).toBe("place");
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toContain("AstraPair");
  });

  it("drops repeated label parts", async () => {
    const places = await searchPlaces(
      "Singapore",
      mockFetch({
        body: {
          features: [
            feature(
              { name: "Singapore", city: "Singapore", country: "Singapore" },
              [103.85, 1.29],
            ),
          ],
        },
      }),
    );
    expect(places.map((p) => p.label)).toEqual(["Singapore"]);
    expect(places[0].timezone).toBe("Asia/Singapore");
  });

  it("drops areas that are not a birthplace", async () => {
    const excluded = [
      "country",
      "state",
      "region",
      "province",
      "county",
      "archipelago",
      "island",
      "continent",
      "ocean",
      "sea",
    ];
    const places = await searchPlaces(
      "x",
      mockFetch({
        body: {
          features: [
            ...excluded.map((osm_value, i) =>
              feature({
                osm_id: i + 100,
                osm_value,
                name: `Area ${osm_value}`,
              }),
            ),
            feature({ osm_id: 5, osm_value: "village", name: "Keepville" }),
          ],
        },
      }),
    );
    expect(places.map((p) => p.label)).toEqual(["Keepville"]);
  });

  it("skips invalid features and keeps valid ones", async () => {
    const places = await searchPlaces(
      "x",
      mockFetch({
        body: {
          features: [
            null,
            feature({ name: "" }),
            feature({ osm_id: 2, name: "BadCoords" }, [80, 200]),
            feature({ osm_id: 3, name: "ShortCoords" }, [80]),
            feature({ osm_id: 4, osm_type: "X", name: "BadType" }),
            feature({ osm_id: 6, name: "Valid" }),
          ],
        },
      }),
    );
    expect(places.map((p) => p.id)).toEqual(["osm:N6"]);
  });

  it("keeps a feature that has no osm_value", async () => {
    const places = await searchPlaces(
      "x",
      mockFetch({
        body: {
          features: [
            {
              type: "Feature",
              properties: { osm_type: "N", osm_id: 9, name: "Nameless" },
              geometry: { type: "Point", coordinates: [80.11, 7.12] },
            },
          ],
        },
      }),
    );
    expect(places.map((p) => p.id)).toEqual(["osm:N9"]);
  });

  it("drops a feature when the timezone lookup throws", async () => {
    vi.mocked(tzlookup).mockImplementationOnce(() => {
      throw new Error("invalid coordinates");
    });
    const places = await searchPlaces(
      "x",
      mockFetch({
        body: {
          features: [
            feature({ osm_id: 1, name: "Broken" }),
            feature({ osm_id: 2, name: "Fine" }),
          ],
        },
      }),
    );
    expect(places.map((p) => p.id)).toEqual(["osm:N2"]);
  });

  it("drops a feature when the timezone lookup returns an invalid zone", async () => {
    vi.mocked(tzlookup).mockImplementationOnce(() => "Mars/Base");
    const places = await searchPlaces(
      "x",
      mockFetch({
        body: {
          features: [
            feature({ osm_id: 1, name: "Marsville" }),
            feature({ osm_id: 2, name: "Fine" }),
          ],
        },
      }),
    );
    expect(places.map((p) => p.id)).toEqual(["osm:N2"]);
  });

  it("removes duplicate labels", async () => {
    const places = await searchPlaces(
      "x",
      mockFetch({
        body: {
          features: [
            feature({ osm_id: 1, name: "Kandy", country: "Sri Lanka" }),
            feature({
              osm_id: 2,
              osm_type: "R",
              name: "Kandy",
              country: "Sri Lanka",
            }),
            feature({ osm_id: 3, name: "Kandy", country: "Elsewhere" }),
          ],
        },
      }),
    );
    expect(places.map((p) => p.id)).toEqual(["osm:N1", "osm:N3"]);
  });

  it("returns at most 8 places", async () => {
    const features = Array.from({ length: 10 }, (_, i) =>
      feature({ osm_id: i + 1, name: `Town ${i + 1}` }),
    );
    const places = await searchPlaces(
      "Town",
      mockFetch({ body: { features } }),
    );
    expect(places).toHaveLength(8);
  });
});

describe("searchPlaces fallback to Open-Meteo", () => {
  it("uses Open-Meteo when Photon has a network error", async () => {
    const fetchImpl = mockFetch(new Error("offline"), {
      body: openMeteoColombo,
    });
    const places = await searchPlaces("Colombo", fetchImpl);
    expect(places).toEqual([
      {
        id: "om:1248991",
        label: "Colombo, Western Province, Sri Lanka",
        latitude: 6.93548,
        longitude: 79.84868,
        timezone: "Asia/Colombo",
        country: "Sri Lanka",
      },
    ]);
    const url = new URL(String(fetchImpl.mock.calls[1][0]));
    expect(url.hostname).toBe("geocoding-api.open-meteo.com");
    expect(url.searchParams.get("name")).toBe("Colombo");
    expect(url.searchParams.get("count")).toBe("8");
  });

  it("uses Open-Meteo when Photon returns a non-2xx status", async () => {
    const places = await searchPlaces(
      "Colombo",
      mockFetch({ ok: false, body: {} }, { body: openMeteoColombo }),
    );
    expect(places.map((p) => p.id)).toEqual(["om:1248991"]);
  });

  it("uses Open-Meteo when Photon returns a malformed body", async () => {
    for (const body of [null, [], { features: {} }, {}]) {
      const places = await searchPlaces(
        "Colombo",
        mockFetch({ body }, { body: openMeteoColombo }),
      );
      expect(places.map((p) => p.id)).toEqual(["om:1248991"]);
    }
  });

  it("uses Open-Meteo when Photon json() rejects", async () => {
    const fetchImpl = vi.fn(async (input: URL | string) => {
      const isPhoton = new URL(String(input)).hostname === "photon.komoot.io";
      return {
        ok: true,
        json: isPhoton
          ? vi.fn().mockRejectedValue(new Error("bad json"))
          : async () => openMeteoColombo,
      } as unknown as Response;
    });
    const places = await searchPlaces(
      "Colombo",
      fetchImpl as unknown as typeof fetch,
    );
    expect(places.map((p) => p.id)).toEqual(["om:1248991"]);
  });

  it("uses Open-Meteo when Photon finds nothing", async () => {
    const places = await searchPlaces(
      "Colombo",
      mockFetch({ body: { features: [] } }, { body: openMeteoColombo }),
    );
    expect(places.map((p) => p.id)).toEqual(["om:1248991"]);
  });

  it("uses Open-Meteo when Photon only returns excluded areas", async () => {
    const places = await searchPlaces(
      "Colombo",
      mockFetch(
        {
          body: {
            features: [feature({ osm_value: "country", name: "Sri Lanka" })],
          },
        },
        { body: openMeteoColombo },
      ),
    );
    expect(places.map((p) => p.id)).toEqual(["om:1248991"]);
  });

  it("returns an empty list when both sources find nothing", async () => {
    expect(
      await searchPlaces("zzzz", mockFetch({ body: { features: [] } })),
    ).toEqual([]);
  });

  it("returns an empty list when Photon is empty and Open-Meteo is down", async () => {
    expect(
      await searchPlaces(
        "zzzz",
        mockFetch({ body: { features: [] } }, new Error("offline")),
      ),
    ).toEqual([]);
  });

  it("throws GeocodingUnavailableError when both sources fail", async () => {
    await expect(
      searchPlaces("x", mockFetch(new Error("offline"), new Error("offline"))),
    ).rejects.toBeInstanceOf(GeocodingUnavailableError);
    await expect(
      searchPlaces(
        "x",
        mockFetch({ ok: false, body: {} }, { ok: false, body: {} }),
      ),
    ).rejects.toBeInstanceOf(GeocodingUnavailableError);
    await expect(
      searchPlaces("x", mockFetch({ body: null }, { body: { results: {} } })),
    ).rejects.toBeInstanceOf(GeocodingUnavailableError);
  });

  it("keeps Open-Meteo filtering: invalid elements and timezones dropped", async () => {
    const places = await searchPlaces(
      "test",
      mockFetch(new Error("offline"), {
        body: {
          results: [
            null,
            {
              id: 1,
              name: "Valid",
              latitude: 10,
              longitude: 20,
              timezone: "UTC",
            },
            { id: 2, name: "", latitude: 30, longitude: 40, timezone: "UTC" },
            { id: 3, name: "NoLatitude", longitude: 50, timezone: "UTC" },
            {
              id: 4,
              name: "Mars",
              latitude: 1,
              longitude: 2,
              timezone: "Mars/Base",
            },
            { id: 5, name: "NoZone", latitude: 1, longitude: 2 },
          ],
        },
      }),
    );
    expect(places.map((p) => p.id)).toEqual(["om:1"]);
  });

  it("keeps labels within 200 characters, dropping the least specific parts first", async () => {
    const long = (n: number, c: string) => c.repeat(n);
    const places = await searchPlaces(
      "long",
      mockFetch({
        body: {
          features: [
            feature({
              osm_id: 10,
              name: "Small Town",
              city: long(60, "c"),
              county: long(60, "d"),
              state: long(60, "e"),
              country: "Sri Lanka",
            }),
          ],
        },
      }),
    );
    expect(places).toHaveLength(1);
    const label = places[0].label;
    expect(label.length).toBeLessThanOrEqual(200);
    expect(label.startsWith("Small Town, ")).toBe(true);
    expect(label).not.toContain("Sri Lanka");
  });

  it("truncates a single over-long name to 200 characters", async () => {
    const places = await searchPlaces(
      "long",
      mockFetch({
        body: {
          features: [feature({ osm_id: 11, name: "n".repeat(300) })],
        },
      }),
    );
    expect(places[0].label).toHaveLength(200);
    expect(places[0].label.endsWith("…")).toBe(true);
  });
});
