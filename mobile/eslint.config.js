// Expo's official flat ESLint config — mirrors the main app's use of eslint-config-next.
const expoConfig = require("eslint-config-expo/flat")

module.exports = [
  ...expoConfig,
  {
    ignores: ["dist/*", ".expo/*", "node_modules/*"],
  },
]
