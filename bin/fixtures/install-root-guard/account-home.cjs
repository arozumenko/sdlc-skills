// Test preload (node --require): report the directory named in
// SDLC_TEST_ACCOUNT_HOME as the account's home directory, so the installer's
// home-directory refusal can be exercised in a temp dir, never in a real home.
// The record is synthetic — the real os.userInfo() is never called, because it
// throws for an account with no user-database entry.
const os = require("node:os");
const { syncBuiltinESMExports } = require("node:module");

os.userInfo = () => ({ uid: -1, gid: -1, username: "fixture", homedir: process.env.SDLC_TEST_ACCOUNT_HOME, shell: null });
syncBuiltinESMExports();
