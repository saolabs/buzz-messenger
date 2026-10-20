const { build } = require("./package.json");

// An untouched Electron linker signature is invalid after repackaging the app.
// Use a complete ad-hoc signature when no Developer ID is configured.
const hasDeveloperIdentity = Boolean(process.env.CSC_LINK?.trim() || process.env.CSC_NAME?.trim());

module.exports = {
  ...build,
  mac: {
    ...build.mac,
    ...(!hasDeveloperIdentity && {
      identity: "-",
      entitlements: "build/entitlements.adhoc.mac.plist",
      entitlementsInherit: "build/entitlements.adhoc.mac.plist",
    }),
  },
};
