const { withProjectBuildGradle } = require('expo/config-plugins');

// @stripe/stripe-react-native defaults to the dynamic Stripe Android SDK
// version "20.52.+" (its android/gradle.properties). A dynamic version forces
// Gradle to list available versions on EVERY repository — including
// jitpack.io, whose outages then fail the whole build even though the
// artifact lives on Maven Central. Pinning an exact version resolves straight
// from Maven Central and never consults JitPack. The module reads
// rootProject.ext.stripeVersion before its own gradle.properties default, so
// an ext block on the generated root build.gradle wins regardless of Gradle's
// property-precedence rules.
const STRIPE_ANDROID_VERSION = '23.4.0';

module.exports = function withStripeVersionPin(config) {
  return withProjectBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('stripeVersion')) {
      config.modResults.contents += `\next {\n    stripeVersion = "${STRIPE_ANDROID_VERSION}"\n}\n`;
    }
    return config;
  });
};
