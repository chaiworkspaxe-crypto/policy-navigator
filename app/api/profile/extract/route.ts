// app/api/profile/extract/route.ts
import { NextResponse } from 'next/server';
import { extractProfileCore } from './_logic';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'edge';

const supabase = getSupabase();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_RE = /^user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const userId = body.userId;
    const threadId = body.threadId;
    const lastUserMessage = body.lastUserMessage;

    if (
      typeof userId !== 'string' ||
      typeof threadId !== 'string' ||
      typeof lastUserMessage !== 'string' ||
      !USER_ID_RE.test(userId) ||
      !UUID_RE.test(threadId)
    ) {
      return NextResponse.json({ ok: false, reason: 'invalid fields' }, { status: 400 });
    }

    const trimmed = lastUserMessage.trim();
    if (trimmed.length === 0 || trimmed.length > 1200) {
      return NextResponse.json({ ok: false, reason: 'invalid message length' }, { status: 400 });
    }

    const { data: thread, error: threadErr } = await supabase
      .from('chat_threads')
      .select('thread_id, user_id')
      .eq('thread_id', threadId)
      .maybeSingle();

    if (threadErr) {
      console.error('[extract profile ownership]', threadErr);
      return NextResponse.json({ ok: false, reason: 'ownership check failed' }, { status: 503 });
    }

    if (!thread || thread.user_id !== userId) {
      return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
    }

    const result = await extractProfileCore({
      userId,
      threadId,
      lastUserMessage: trimmed,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: result.reason === 'missing fields' ? 400 : 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      profile: result.profile,
      reasoning: result.reasoning,
    });
  } catch (e: any) {
    console.error('[extract profile route]', e);
    return NextResponse.json(
      { ok: false, reason: e?.message ?? 'unknown' },
      { status: 500 },
    );
  }
}
