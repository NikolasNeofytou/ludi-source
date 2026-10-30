// main.ts — the court recorder (ADR-0042, plans/court-cameras.md C2).
//
// Runs on a small box at the venue next to one camera. Every tick it
// syncs with Ludi (the heartbeat; Ludi arms consented bookings), starts
// ffmpeg when an armed booking kicks off, stops at the booking's end,
// uploads the file, and says so. It never records on its own account:
// what to record, and the refusal to record outside a booking, are Ludi's.
//
// Configuration (environment):
//   LUDI_URL         https://<ref>.supabase.co (locally http://127.0.0.1:64321)
//   CAMERA_TOKEN     the device token camera_register showed once
//   CAMERA_INPUT     ffmpeg input args, e.g. "-rtsp_transport tcp -i rtsp://10.0.0.5/stream1"
//   CAMERA_CODEC     ffmpeg output args (default "-c:v copy -an": the camera
//                    already encodes H.264)
//   WORK_DIR         where files wait for upload (default ./work)
//   TICK_S           seconds between syncs (default 15)
//   LUDI_ANON_KEY    optional; sent as apikey if the gateway wants one
//
// Run: deno run --allow-net --allow-env --allow-run=ffmpeg,ffprobe --allow-read --allow-write main.ts

import { type Action, type Armed, plan, splitArgs } from './schedule.ts';

const env = (k: string, d?: string) => {
  const v = Deno.env.get(k) ?? d;
  if (v === undefined) throw new Error(`${k} is not set`);
  return v;
};
const BASE = env('LUDI_URL').replace(/\/$/, '');
const TOKEN = env('CAMERA_TOKEN');
const INPUT = splitArgs(env('CAMERA_INPUT'));
const CODEC = splitArgs(env('CAMERA_CODEC', '-c:v copy -an'));
const DIR = env('WORK_DIR', './work');
const TICK_S = Number(env('TICK_S', '15'));
const ANON = Deno.env.get('LUDI_ANON_KEY');

const log = (event: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...extra }));

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/functions/v1/recorder`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-camera-token': TOKEN,
      ...(ANON ? { apikey: ANON } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${(json as { error?: string }).error ?? res.status}`);
  return json as T;
}

async function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const out = await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped' }).output();
  return { ok: out.success, out: new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr) };
}

async function record(a: Extract<Action, { kind: 'start' }>) {
  const id = a.recording_id;
  const mkv = `${DIR}/${id}.mkv`;
  const mp4 = `${DIR}/${id}.mp4`;
  try {
    await call({ action: 'mark', recording_id: id, state: 'recording' });
    log('recording', { id, seconds: a.seconds });
    // Matroska while recording: a cut-off file is still readable.
    const rec = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...INPUT, '-t', String(a.seconds), ...CODEC, mkv]);
    const size = await Deno.stat(mkv).then((s) => s.size).catch(() => 0);
    if (!rec.ok && size === 0) throw new Error(`ffmpeg: ${rec.out.slice(0, 300)}`);
    if (!rec.ok) log('recording_cut_short', { id, out: rec.out.slice(0, 300) });

    const mux = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mkv, '-c', 'copy', '-movflags', '+faststart', mp4]);
    if (!mux.ok) throw new Error(`remux: ${mux.out.slice(0, 300)}`);
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]);
    const duration = Math.round(Number(probe.out.trim()) || 0);
    const bytes = (await Deno.stat(mp4)).size;

    const { upload } = await call<{ upload: { bucket: string; path: string; token: string } }>({
      action: 'mark', recording_id: id, state: 'processing',
    });
    const file = await Deno.open(mp4, { read: true });
    const put = await fetch(
      `${BASE}/storage/v1/object/upload/sign/${upload.bucket}/${upload.path}?token=${encodeURIComponent(upload.token)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'video/mp4', 'content-length': String(bytes), 'x-upsert': 'true' },
        body: file.readable,
      },
    );
    if (!put.ok) throw new Error(`upload ${put.status}: ${(await put.text()).slice(0, 200)}`);

    await call({ action: 'mark', recording_id: id, state: 'ready', bytes, duration_s: duration });
    log('ready', { id, bytes, duration });
    await Deno.remove(mkv).catch(() => {});
    await Deno.remove(mp4).catch(() => {});
  } catch (e) {
    const failure = String(e instanceof Error ? e.message : e).slice(0, 500);
    log('failed', { id, failure });
    await call({ action: 'mark', recording_id: id, state: 'failed', failure }).catch(() => {});
  }
}

const running = new Map<string, Promise<void>>();

async function tick() {
  const { now, recordings } = await call<{ now: string; recordings: Armed[] }>({ action: 'sync' });
  // Plan on Ludi's clock, not the box's: a box running fast would start
  // inside the previous booking.
  const skew = Date.parse(now) - Date.now();
  for (const a of plan(Date.now() + skew, recordings, new Set(running.keys()))) {
    if (a.kind === 'abandon') {
      log('abandon', a);
      await call({ action: 'mark', recording_id: a.recording_id, state: 'failed', failure: a.reason }).catch(() => {});
    } else {
      running.set(a.recording_id, record(a).finally(() => running.delete(a.recording_id)));
    }
  }
}

await Deno.mkdir(DIR, { recursive: true });
log('up', { base: BASE, tick_s: TICK_S });
while (true) {
  try {
    await tick();
  } catch (e) {
    log('sync_failed', { error: String(e) });
  }
  await new Promise((r) => setTimeout(r, TICK_S * 1000));
}
