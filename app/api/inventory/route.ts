const lockedResponse = () => Response.json(
  { error: 'Inventory is temporarily locked until dashboard user authentication is enabled.' },
  { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '3600' } },
);

export async function GET() {
  return lockedResponse();
}

export async function POST() {
  return lockedResponse();
}
