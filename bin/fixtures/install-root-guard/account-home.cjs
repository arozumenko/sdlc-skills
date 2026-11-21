// Test preload (node --require): report the directory named in
// SDLC_TEST_ACCOUNT_HOME as the account's home directory, so the installer's
// home-directory refusal can be exercised in a temp dir, never in a real home.
const os = require("node:os");
const { syncBuiltinESMExports } = require("node:module");

const real = os.userInfo;
os.userInfo = (...args) => ({ ...real(...args), homedir: process.env.SDLC_TEST_ACCOUNT_HOME });
syncBuiltinESMExports();
