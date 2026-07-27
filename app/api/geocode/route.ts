import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, corsPreflight } from "@/lib/cors";

const headers = {
  "User-Agent": "Mistopis-beta/0.1 (AI location guide)",
  "Accept-Language": "cs,en;q=0.7",
};

export async function GET(request: NextRequest) {
  const responseHeaders = corsHeaders(request.headers.get("origin"));
  const latitude = Number(request.nextUrl.searchParams.get("lat"));
  const longitude = Number(request.nextUrl.searchParams.get("lon"));
  const query = request.nextUrl.searchParams.get("q")?.trim();

  try {
    if (query) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query.slice(0, 160));
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "5");
      url.searchParams.set("addressdetails", "1");

      const response = await fetch(url, { headers, next: { revalidate: 3600 } });
      if (!response.ok) throw new Error("Geocoding service failed");
      const places = (await response.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
      }>;

      return NextResponse.json(
        places.map((place) => ({
          label: place.display_name,
          latitude: Number(place.lat),
          longitude: Number(place.lon),
        })),
        { headers: responseHeaders },
      );
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json(
        { error: "Chybí platná poloha." },
        { status: 400, headers: responseHeaders },
      );
    }

    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("zoom", "18");

    const response = await fetch(url, { headers, next: { revalidate: 3600 } });
    if (!response.ok) throw new Error("Reverse geocoding service failed");
    const place = (await response.json()) as { display_name?: string };

    return NextResponse.json(
      {
        label:
          place.display_name ??
          `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        latitude,
        longitude,
      },
      { headers: responseHeaders },
    );
  } catch {
    return NextResponse.json(
      { error: "Místo se teď nepodařilo dohledat." },
      { status: 502, headers: responseHeaders },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
