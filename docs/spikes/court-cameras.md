# Spike — court cameras (C0)

**Date:** 2026-10-13 (software half)
**Verdict so far:** assumption 1 **PASS in software**, on the local stack
with a synthetic camera. Assumptions 2–4 **open**: they need a camera, a
venue, counsel and four weeks. The version does not go to a venue until
all four are written down here.
**Plan:** [plans/court-cameras.md](../plans/court-cameras.md) ·
**ADR:** [0042](../adr/0042-the-recording-belongs-to-the-booking.md)

## 1. A fixed camera can be armed per booking — PASS (software)

**Method.** The full chain on the local stack (2026-10-13): migration
`20261013000006`, the `recorder`, `recording` and `recordings-sweep`
functions served locally, and `tools/court-recorder` running on the Mac
with ffmpeg's `testsrc2` at 1280×720, 25 fps, H.264 at 2.5 Mbps standing
in for the camera. One camera registered on Pitch 2, one consented
one-minute booking.

**What happened, without a human:**

| Step | Result |
|---|---|
| Sync with the device token | The booking armed (`scheduled`) |
| Sync with a wrong token | `REC_UNKNOWN_DEVICE`, 401 |
| Kickoff | Recorder marked `recording`, ffmpeg ran for the rest of the booking |
| Booking end | Stopped, remuxed to MP4 (faststart), `processing`, signed upload, `ready` |
| File | 88 s, 27,570,344 bytes, 1280×720 H.264 |
| Watch link (organiser) | One-hour signed URL; ffprobe read it; range requests answer 206 |
| Watch link (a stranger) | `REC_NOT_VIEWER`, 403; delete `REC_NOT_ORGANISER`, 403 |
| Simulator | "Watch the match" opened the in-app browser and played, with seeking |
| Organiser deletes | Row `deleted`, file removed from storage |
| Sweep | Wrong secret 401; an expired recording's file removed and the row purged |

**Found and fixed during the run.** The first recorder started thirty
seconds before kickoff. On back-to-back bookings that films the end of
somebody else's game. It now starts at kickoff on the server's clock, and
the database refuses a start more than fifteen seconds early.

**Still to prove on hardware.** A real PoE camera's RTSP stream with
`-c:v copy` (no re-encode), a full hour, the venue's uplink, and a power
cut mid-game (the recorder writes Matroska while recording so a cut-off
file still reads; untested on a real cut).

## 2. It costs less than the venue earns from it — OPEN

Measured: **2.51 Mbps** at 720p from the synthetic source, which is about
**1.13 GB per recorded hour**. A real pitch has more motion than a test
pattern; measure again on the camera at the bitrate that looks right on a
phone.

The number to write down, per recorded hour:

    storage   = 1.13 GB × (price per GB-month) × (30 days ÷ 30)
    egress    = 1.13 GB × (whole-match views) × (price per GB out)
    hardware  = (camera + recorder + install) ÷ (recorded hours in its life)

Prices are to be read from the providers on the day, not remembered:
Supabase Storage (current), and an object store without egress fees.
PASS = a total per recorded hour that a €60 booking carries.

## 3. It is lawful the way we run it — OPEN

Questions and drafts for counsel are in
[docs/legal/court-cameras](../legal/court-cameras/README.md). Nothing is
recorded at a venue before the answer is written here.

## 4. Anyone watches — OPEN

One court, one venue that agrees, four weeks. Count recordings made,
opened within 48 hours (`recording_watched` in PostHog), and deleted.
PASS = most recorded games are opened by someone on the roster.
