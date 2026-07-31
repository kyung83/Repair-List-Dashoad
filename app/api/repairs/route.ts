const SHEET_API_URL = process.env.SHEET_API_URL;
const SHEET_API_TOKEN = process.env.SHEET_API_TOKEN;

export async function GET() {
  if (!SHEET_API_URL || !SHEET_API_TOKEN) return Response.json({ error: "Google Sheet connector is not configured" }, { status: 503 });
  const url = new URL(SHEET_API_URL);
  url.searchParams.set("action", "dashboard");
  url.searchParams.set("token", SHEET_API_TOKEN);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Google Sheet connector failed" }, { status: 502 });
  return Response.json(await response.json(), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!SHEET_API_URL || !SHEET_API_TOKEN) return Response.json({ error: "Google Sheet connector is not configured" }, { status: 503 });
  const body = await request.json() as Record<string, unknown>;
  const response = await fetch(SHEET_API_URL, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, token: SHEET_API_TOKEN }) });
  return Response.json(await response.json(), { status: response.ok ? 200 : 502 });
}
