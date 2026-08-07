import { env } from 'cloudflare:workers';
import { fetchGeotabImage } from '@/lib/geotab-media';

const MEDIA_ID = /^[a-z0-9._:-]+$/i;

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
    if (!id || !MEDIA_ID.test(id)) {
      return Response.json({ error: 'A valid Geotab media ID is required.' }, { status: 400 });
    }

    const key = `geotab-media/${id}`;
    const cached = await env.FILES.get(key);
    if (cached) {
      return new Response(cached.body, {
        headers: {
          'content-type': cached.httpMetadata?.contentType || 'image/jpeg',
          'cache-control': 'private, max-age=86400',
          'x-photo-cache': 'R2',
        },
      });
    }

    const image = await fetchGeotabImage(env, id);
    await env.FILES.put(key, image.bytes, {
      httpMetadata: { contentType: image.contentType },
      customMetadata: { source: 'geotab', mediaId: id },
    });

    return new Response(image.bytes, {
      headers: {
        'content-type': image.contentType,
        'cache-control': 'private, max-age=86400',
        'x-photo-cache': 'GEOTAB',
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_media_failed', error: String(error) }));
    return Response.json({ error: 'The Geotab photo could not be loaded.' }, { status: 502 });
  }
}
