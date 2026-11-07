import { requireUser } from './auth';
import type { Ctx } from './context';
import { HttpError, json, rateLimit } from './http';
import { errorText, log } from './log';
import { hold, noCredits, release, settle, voiceMc, WHISPER } from './meter';

/**
 * Voice input's server speech-to-text (docs/design/paid-plans.md P39), for
 * browsers without the Web Speech API (Safari, Firefox): the page records
 * short chunks with MediaRecorder and posts each one here; Workers AI's
 * Whisper writes it down.
 *
 *   POST /api/voice/transcribe?seconds=<n>&lang=<xx>   body: the audio (audio/webm, audio/ogg, audio/mp4, …)
 *     → {text, credits}                            what was said, and what it cost
 *
 * Signed in, with credits: each chunk holds its worst case (MAX_SECONDS of
 * audio) and settles at 2x what Whisper costs us, per audio second, through
 * src/meter.ts as action 'voice'. The length billed is the larger of what the
 * page says (`seconds`) and what the size implies at BYTES_PER_SECOND, so a
 * page can't under-declare it, capped at MAX_SECONDS. A chunk over MAX_BYTES
 * is refused (413), and the per-user rate limit (VOICE_LIMITER) bounds the
 * rest. A transcription that failed is not charged. 501 without the AI binding.
 */

/** One chunk at most: the page sends a chunk every 15 s, so this leaves room for a slow network. */
export const MAX_BYTES = 1024 * 1024;
/** The longest chunk billed: also the hold. */
export const MAX_SECONDS = 60;
/** The lowest bitrate a chunk is taken to have, 32 kbit/s (browsers record Opus at 32–128 kbit/s): size / this is a floor of its length. */
export const BYTES_PER_SECOND = 4000;

const TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac'];

/** Words Whisper should expect in a system design interview, so it spells them right. */
const PROMPT = 'A system design interview: requests per second, p99 latency, QPS, sharding, replicas, Redis, Kafka, Postgres, CDN, load balancer, cache hit rate.';

/** The seconds billed for a chunk of `bytes` the page says lasts `declared` seconds. */
export function billedSeconds(bytes: number, declared: number): number {
  const said = Number.isFinite(declared) && declared > 0 ? declared : 0;
  return Math.min(MAX_SECONDS, Math.max(1, said, bytes / BYTES_PER_SECOND));
}

function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Whisper's answer: `text`, or (the documented shape of the turbo model) `transcription_info.text`. */
function textOf(result: unknown): string | undefined {
  const r = result as { text?: unknown; transcription_info?: { text?: unknown } } | null;
  const text = r?.text ?? r?.transcription_info?.text;
  return typeof text === 'string' ? text : undefined;
}

/** POST /api/voice/transcribe. */
export async function transcribe(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  if (!env.AI) throw new HttpError(501, 'voice_disabled');
  const user = await requireUser(request, ctx);
  await rateLimit(env.VOICE_LIMITER, user.id, 'Too much speech at once; wait a minute');
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!TYPES.includes(type)) throw new HttpError(415, `The audio must be one of ${TYPES.join(', ')}`);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BYTES) throw new HttpError(413, 'The audio is too long; send at most a minute at a time');
  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') ?? 'en';
  if (!/^[a-z]{2}$/.test(lang)) throw new HttpError(400, 'lang must be a two-letter language code');
  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.byteLength > MAX_BYTES) throw new HttpError(413, 'The audio is too long; send at most a minute at a time');
  if (audio.byteLength === 0) throw new HttpError(400, 'No audio');
  const seconds = billedSeconds(audio.byteLength, Number(url.searchParams.get('seconds')));

  const held = await hold(env, user.id, voiceMc(MAX_SECONDS, env), 'voice');
  if (!held.ok) return noCredits(held.neededMc, held.balanceMc);
  let text: string | undefined;
  try {
    text = textOf(await env.AI.run(WHISPER, { audio: base64(audio), task: 'transcribe', language: lang, vad_filter: true, initial_prompt: PROMPT }));
  } catch (e) {
    await release(env, held.holdId);
    log('warn', 'voice.transcribe_failed', { requestId: ctx.requestId, error: errorText(e).split('\n')[0] });
    return json({ error: 'stt_failed', retryable: true }, 502, { 'Cache-Control': 'no-store' });
  }
  if (text === undefined) {
    await release(env, held.holdId);
    return json({ error: 'stt_failed', retryable: true }, 502, { 'Cache-Control': 'no-store' });
  }
  const { chargedMc } = await settle(env, held.holdId, [{ model: WHISPER, input_tokens: 0, output_tokens: 0, audio_seconds: seconds }], 'voice', false);
  return json({ text: text.trim(), credits: chargedMc / 1000 }, 200, { 'Cache-Control': 'no-store' });
}
