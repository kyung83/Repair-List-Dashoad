import { env } from 'cloudflare:workers';
import { getGeotabDeviceOptions } from '@/lib/geotab';

export async function GET() {
  try {
    return Response.json(await getGeotabDeviceOptions(env), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_device_options_failed', error: String(error) }));
    return Response.json({ error: 'Geotab devices could not be loaded.' }, { status: 500 });
  }
}
