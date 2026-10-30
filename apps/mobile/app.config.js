// Dynamic config layered over app.json. Two jobs:
//
// 1. Inject the Android Google Maps key at (pre)build time so it never lives
//    in git — GitGuardian gates the repo, and EAS env is where client-baked
//    keys live (same pattern as the Stripe publishable key). The key comes
//    from GOOGLE_MAPS_ANDROID_API_KEY: set in EAS env for the "production"
//    environment (which the production AND beta profiles use), and in the
//    gitignored apps/mobile/.env for local prebuilds. Missing var → the
//    config passes through untouched and Android maps render blank; iOS
//    (Apple Maps) never needs it.
//
// 2. Ask for local-network access only in builds that talk to a Metro
//    server: the EAS `development` profile, and local prebuilds
//    (expo run:ios, scripts/install_on_device.sh), where EAS_BUILD_PROFILE is
//    unset. A store build has no reason to carry the permission string, and
//    App Review reads it as the app wanting to scan the user's network.
module.exports = ({ config }) => {
  const apiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  const profile = process.env.EAS_BUILD_PROFILE;
  const talksToMetro = !profile || profile === 'development';

  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        ...(talksToMetro
          ? {
              NSLocalNetworkUsageDescription:
                'Ludi uses local-network access only when connecting to a development server. Normal use of the app connects over the internet and does not access devices on your network.',
            }
          : {}),
      },
    },
    android: apiKey
      ? {
          ...config.android,
          config: {
            ...config.android?.config,
            googleMaps: { apiKey },
          },
        }
      : config.android,
  };
};
