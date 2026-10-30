'use client';

// Court cameras (ADR-0042), the founder's side of the venue page: which
// courts have a camera and whether the recorder is reporting, a form to put
// one up, and the device token, shown once.

import { useActionState } from 'react';

import { registerCamera, retireCamera, type RegisterCameraState } from '@/lib/camera-actions';

export type CameraRow = {
  id: string;
  pitch_id: string;
  pitch_name: string;
  device_ref: string | null;
  health: 'online' | 'offline' | 'never';
  last_seen_at: string | null;
};

const HEALTH: Record<CameraRow['health'], { label: string; badge: string }> = {
  online: { label: 'Online', badge: 'badge badge-good' },
  offline: { label: 'Offline', badge: 'badge badge-warn' },
  never: { label: 'Not connected yet', badge: 'badge badge-neutral' },
};

export function CameraAdmin({
  venueId,
  cameras,
  courts,
}: {
  venueId: string;
  cameras: CameraRow[];
  courts: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<RegisterCameraState, FormData>(registerCamera, { status: 'idle' });
  const free = courts.filter((c) => !cameras.some((cam) => cam.pitch_id === c.id));

  return (
    <div className="stack">
      {cameras.length ? (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {cameras.map((cam) => (
            <li key={cam.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{cam.pitch_name}</strong>
              <span className={HEALTH[cam.health].badge}>{HEALTH[cam.health].label}</span>
              {cam.device_ref ? <span className="fill-muted">{cam.device_ref}</span> : null}
              {cam.last_seen_at ? (
                <span className="fill-muted">
                  last seen {new Date(cam.last_seen_at).toLocaleString('en-GB', { timeZone: 'Europe/Nicosia' })}
                </span>
              ) : null}
              <form action={retireCamera} style={{ marginLeft: 'auto' }}>
                <input type="hidden" name="venue_id" value={venueId} />
                <input type="hidden" name="camera_id" value={cam.id} />
                <button type="submit" className="fill-quiet">
                  Retire
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fill-muted">No court here has a camera. Nothing is offered to players until one does.</p>
      )}

      {state.status === 'done' ? (
        <div className="stack" style={{ padding: 12, border: '1px solid var(--ludi-line-bold)', borderRadius: 12 }}>
          <strong>Device token for {state.pitchName}, shown once</strong>
          <code style={{ wordBreak: 'break-all' }}>{state.token}</code>
          <p className="fill-muted">
            Put it in the recorder at the venue as CAMERA_TOKEN. Ludi keeps only its hash; lose it and you retire
            the camera and register it again.
          </p>
        </div>
      ) : null}
      {state.status === 'error' ? <p className="fill-muted">{state.message}</p> : null}

      {free.length ? (
        <form action={action} className="stack">
          <input type="hidden" name="venue_id" value={venueId} />
          <label className="field">
            <span className="field-label">Court</span>
            <select name="pitch_id" className="input" defaultValue={free[0]?.id}>
              {free.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Which device (for us)</span>
            <input name="device_ref" className="input" placeholder="e.g. Reolink RLC-810A, north stand" />
          </label>
          <div className="filters-actions">
            <button type="submit" className="btn btn-secondary" disabled={pending}>
              Register a camera
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
