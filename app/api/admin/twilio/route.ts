import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  addBreakdownSmsContact,
  clearTwilioRuntimeCredentials,
  getTwilioRuntimeMetadata,
  listBreakdownSmsContacts,
  listBreakdownSmsTemplates,
  saveBreakdownSmsTemplate,
  saveTwilioRuntimeCredentials,
  sendTwilioRuntimeSms,
  setTwilioRuntimeEnabled,
  updateBreakdownSmsContact,
  removeBreakdownSmsContact,
} from '@/lib/twilio-runtime';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { response: Response.json({ error: 'Authentication required.' }, { status: 401 }), user: null };
  if (user.role !== 'admin') return { response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }), user: null };
  return { response: null, user };
}

function webhookUrl(request: Request) {
  return new URL('/api/webhook/twilio-sms', request.url).toString();
}

async function statusPayload(request: Request) {
  const [connection, templates, contacts] = await Promise.all([
    getTwilioRuntimeMetadata(env.DB),
    listBreakdownSmsTemplates(env.DB),
    listBreakdownSmsContacts(env.DB),
  ]);
  return {
    connection,
    templates,
    contacts,
    webhookUrl: webhookUrl(request),
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    return Response.json(await statusPayload(request), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'twilio_admin_status_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Twilio settings could not be loaded.' }, { status: 500 });
  }
}

type ActionBody = {
  action?: string;
  accountSid?: string;
  authToken?: string;
  sender?: string;
  enabled?: boolean;
  testPhone?: string;
  templateKey?: string;
  templateBody?: string;
  templateActive?: boolean;
  contactId?: number;
  contactLabel?: string;
  contactPhone?: string;
  contactActive?: boolean;
};

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json().catch(() => ({})) as ActionBody;
    const action = String(body.action || '').trim();

    if (action === 'save-connection') {
      await saveTwilioRuntimeCredentials(env.DB, env, {
        accountSid: String(body.accountSid || ''),
        authToken: String(body.authToken || ''),
        sender: String(body.sender || ''),
        enabled: Boolean(body.enabled),
      }, auth.user.id);
      return Response.json({ ok: true, message: 'Twilio connection saved.', status: await statusPayload(request) });
    }

    if (action === 'set-enabled') {
      await setTwilioRuntimeEnabled(env.DB, Boolean(body.enabled), auth.user.id);
      return Response.json({ ok: true, message: body.enabled ? 'Live breakdown texts enabled.' : 'Breakdown texts paused.', status: await statusPayload(request) });
    }

    if (action === 'clear-connection') {
      await clearTwilioRuntimeCredentials(env.DB);
      return Response.json({ ok: true, message: 'Twilio connection removed. Text templates and users were kept.', status: await statusPayload(request) });
    }

    if (action === 'test') {
      const phone = String(body.testPhone || '').trim();
      if (!phone) return Response.json({ error: 'Enter a phone number for the test text.' }, { status: 400 });
      await sendTwilioRuntimeSms(env.DB, env, phone, `Norlow breakdown texting test. Sent ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', dateStyle: 'short', timeStyle: 'short' }).format(new Date())}.`);
      return Response.json({ ok: true, message: `Test text sent to ${phone}.` });
    }

    if (action === 'save-template') {
      await saveBreakdownSmsTemplate(
        env.DB,
        String(body.templateKey || ''),
        String(body.templateBody || ''),
        body.templateActive !== false,
        auth.user.id,
      );
      return Response.json({ ok: true, message: 'Breakdown text wording saved.', status: await statusPayload(request) });
    }

    if (action === 'add-contact') {
      await addBreakdownSmsContact(
        env.DB,
        String(body.contactLabel || ''),
        String(body.contactPhone || ''),
        body.contactActive !== false,
      );
      return Response.json({ ok: true, message: 'Breakdown text user added.', status: await statusPayload(request) });
    }

    if (action === 'update-contact') {
      await updateBreakdownSmsContact(
        env.DB,
        Number(body.contactId),
        String(body.contactLabel || ''),
        String(body.contactPhone || ''),
        body.contactActive !== false,
      );
      return Response.json({ ok: true, message: 'Breakdown text user updated.', status: await statusPayload(request) });
    }

    if (action === 'remove-contact') {
      await removeBreakdownSmsContact(env.DB, Number(body.contactId));
      return Response.json({ ok: true, message: 'Breakdown text user removed from SMS.', status: await statusPayload(request) });
    }

    return Response.json({ error: 'Unknown Twilio admin action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'twilio_admin_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Twilio action failed.' }, { status: 500 });
  }
}
