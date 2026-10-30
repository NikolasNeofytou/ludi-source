// Uptime probe target. docs/infra.md §Monitoring points UptimeRobot at
// https://ludi.football/.well-known/health every 5 minutes; before this
// route existed that check had nothing to hit.
//
// The middleware matcher excludes `.well-known`, so this is not rewritten
// into a locale segment — it answers on the bare path in both locales.
export const dynamic = 'force-static';

export function GET() {
  return Response.json({ status: 'ok' });
}
