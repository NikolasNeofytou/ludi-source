# Court recorder

The box at the venue next to one court camera (ADR-0042,
[plans/court-cameras.md](../../docs/plans/court-cameras.md)). It records a
booking only when Ludi says the booking is armed, only from kickoff to the
end, uploads the file and says so. It never decides what to record.

## Run

Register the camera on the venue page in the dashboard (Court cameras) to
get its device token, shown once. Then, on the box, with ffmpeg and Deno
installed:

```bash
cd tools/court-recorder
LUDI_URL=https://<ref>.supabase.co CAMERA_TOKEN=<token> CAMERA_INPUT="-rtsp_transport tcp -i rtsp://<camera-ip>/stream1" deno task start
```

| Variable | Meaning |
|---|---|
| `LUDI_URL` | The Supabase project URL |
| `CAMERA_TOKEN` | The device token from the dashboard |
| `CAMERA_INPUT` | ffmpeg input arguments for the camera (no spaces inside a URL) |
| `CAMERA_CODEC` | ffmpeg output arguments, default `-c:v copy -an` (the camera already encodes H.264) |
| `WORK_DIR` | Where files wait for upload, default `./work` |
| `TICK_S` | Seconds between syncs, default 15 |

## What it does each tick

1. `POST /functions/v1/recorder {action:'sync'}` — the heartbeat; Ludi arms
   consented bookings starting within two hours and lists them.
2. At kickoff, on Ludi's clock: `mark recording`, then ffmpeg for the rest
   of the booking into Matroska (a cut-off file still reads).
3. At the end: remux to MP4 with faststart, `mark processing` (returns a
   signed upload), `PUT` the file, `mark ready` with its size and length.
4. Anything that fails is marked `failed` with the reason. A box that
   restarts mid-game gives that game up rather than recording half.

## Test without a camera

ffmpeg's test pattern stands in for the camera:

```bash
cd tools/court-recorder
LUDI_URL=http://127.0.0.1:64321 CAMERA_TOKEN=<token> CAMERA_INPUT="-re -f lavfi -i testsrc2=size=1280x720:rate=25" CAMERA_CODEC="-c:v libx264 -preset veryfast -b:v 2500k -pix_fmt yuv420p" deno task start
```

```bash
cd tools/court-recorder
deno task test
```
