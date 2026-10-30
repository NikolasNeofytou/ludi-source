// The two WebCrypto calls supabase-js's PKCE needs, backed by expo-crypto.
//
// Hermes has no global `crypto`. Without it auth-js quietly degrades PKCE:
// the code verifier comes from Math.random, and the challenge is sent
// `plain` — the verifier itself — instead of its SHA-256 (it says so once,
// as a "WebCrypto API is not supported" warning). Seen on the simulator
// the day the app moved to PKCE (security audit 2026-10-19, A4). With these
// two in place the verifier is 56 words from the native CSPRNG and the
// challenge is S256.
//
// Only what is missing is filled in, so a runtime that ships WebCrypto
// keeps its own. randomUUID comes along because a library that finds a
// `crypto` global may reach for it next. Imported by supabase.ts before
// the client exists.

import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from 'expo-crypto';

type Shim = {
  getRandomValues?: typeof getRandomValues;
  randomUUID?: typeof randomUUID;
  subtle?: { digest: (algorithm: string, data: BufferSource) => Promise<ArrayBuffer> };
};

const g = globalThis as unknown as { crypto?: Shim };
const shim: Shim = g.crypto ?? {};

if (typeof shim.getRandomValues !== 'function') {
  shim.getRandomValues = getRandomValues;
}
if (typeof shim.randomUUID !== 'function') {
  shim.randomUUID = randomUUID;
}
if (typeof shim.subtle?.digest !== 'function') {
  shim.subtle = {
    digest: (algorithm, data) => {
      if (algorithm !== 'SHA-256') {
        return Promise.reject(new Error(`web-crypto shim: ${algorithm} is not supported`));
      }
      return digest(CryptoDigestAlgorithm.SHA256, data);
    },
  };
}
g.crypto = shim;
