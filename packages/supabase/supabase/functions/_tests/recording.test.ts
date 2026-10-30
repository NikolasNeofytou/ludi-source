import { assertEquals } from 'std/assert/mod.ts';
import { hashToken, publicUrl, recError, RecorderInput, RecordingInput } from '../_shared/recording.ts';

Deno.test('hashToken: SHA-256 hex, as camera_register stores it', async () => {
  assertEquals(
    await hashToken('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

Deno.test('recError: a database reason becomes a code and a status', () => {
  assertEquals(recError('REC_NOT_VIEWER'), { code: 'REC_NOT_VIEWER', status: 403 });
  assertEquals(recError('REC_UNKNOWN_DEVICE'), { code: 'REC_UNKNOWN_DEVICE', status: 401 });
  assertEquals(recError(' REC_NOT_READY '), { code: 'REC_NOT_READY', status: 409 });
  assertEquals(recError('duplicate key value'), null);
  assertEquals(recError(undefined), null);
});

Deno.test('RecorderInput: sync, and a mark with a known state only', () => {
  assertEquals(RecorderInput.safeParse({ action: 'sync' }).success, true);
  const id = '01a134e8-8faa-78b2-b05e-bd5e2380b472';
  assertEquals(RecorderInput.safeParse({ action: 'mark', recording_id: id, state: 'ready', bytes: 10, duration_s: 60 }).success, true);
  assertEquals(RecorderInput.safeParse({ action: 'mark', recording_id: id, state: 'deleted' }).success, false);
  assertEquals(RecorderInput.safeParse({ action: 'mark', recording_id: 'x', state: 'ready' }).success, false);
});

Deno.test('RecordingInput: staff must give a reason', () => {
  const id = '01a134e8-8faa-78b2-b05e-bd5e2380b472';
  assertEquals(RecordingInput.safeParse({ action: 'url', booking_id: id }).success, true);
  assertEquals(RecordingInput.safeParse({ action: 'staff_url', recording_id: id, reason: '  ' }).success, false);
  assertEquals(RecordingInput.safeParse({ action: 'staff_url', recording_id: id, reason: 'support ticket 12' }).success, true);
});

Deno.test('publicUrl: the internal host is swapped only when a public base is set', () => {
  const signed = 'http://kong:8000/storage/v1/object/sign/recordings/a.mp4?token=t';
  assertEquals(publicUrl(signed, 'http://kong:8000', undefined), signed);
  assertEquals(
    publicUrl(signed, 'http://kong:8000', 'http://127.0.0.1:64321'),
    'http://127.0.0.1:64321/storage/v1/object/sign/recordings/a.mp4?token=t',
  );
  assertEquals(
    publicUrl('https://x.supabase.co/storage/v1/a', 'https://x.supabase.co', 'http://127.0.0.1:64321'),
    'http://127.0.0.1:64321/storage/v1/a',
  );
});
