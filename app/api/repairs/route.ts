const SHEET_API_URL = process.env.SHEET_API_URL;

export async function GET() {
  if (!SHEET_API_URL) return Response.json({ error: "SHEET_API_URL is not configured" }, { status: 503 });
  const response = await fetch(`${SHEET_API_URL}?action=dashboard`, { cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Google Sheet connector failed" }, { status: 502 });
  return Response.json(await response.json(), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!SHEET_API_URL) return Response.json({ error: "SHEET_API_URL is not configured" }, { status: 503 });
  const body = await request.text();
  const response = await fetch(SHEET_API_URL, { method: "POST", headers: { "content-type": "application/json" }, body });
  return Response.json(await response.json(), { status: response.ok ? 200 : 502 });
}
