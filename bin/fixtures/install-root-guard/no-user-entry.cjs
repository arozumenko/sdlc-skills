// Test preload (node --require), loaded BEFORE account-home.cjs: make the real
// os.userInfo() throw, as it does for an account with no user-database entry.
// account-home.cjs must then still report the fixture home on its own.
const os = require("node:os");
const { syncBuiltinESMExports } = require("node:module");

os.userInfo = () => { throw new Error("no user-database entry for this account"); };
syncBuiltinESMExports();
