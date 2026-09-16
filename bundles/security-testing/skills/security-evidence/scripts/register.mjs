#!/usr/bin/env node
// register.mjs — entry point for the residual-risk register (plan §4.3). A
// thin dispatcher (TL-1): commands live in lib/cmd-<name>.mjs. There is no
// approval verb that marks anything authenticated (D15, G-8): every
// approval-like record is stored and reported as unauthenticated.
// The usage text is lib/register-usage.mjs (built from tokens.mjs rows).
import { main } from "./lib/cli.mjs";
import { USAGE } from "./lib/register-usage.mjs";

const COMMANDS = {
  add: () => import("./lib/cmd-register-add.mjs"), // TASK-028
  replay: () => import("./lib/cmd-register-replay.mjs"), // TASK-028
  status: () => import("./lib/cmd-register-status.mjs"), // TASK-028
  anchor: () => import("./lib/cmd-register-anchor.mjs"), // TASK-028
  // accept / revoke / check / close-false-positive / reopen / supersede / alias / transition
  //   → () => import("./lib/cmd-register-transition.mjs")  // TASK-029
  // "consume-verdict": () => import("./lib/cmd-consume-verdict.mjs"), // TASK-030
  // render: () => import("./lib/cmd-register-render.mjs"), // TASK-059
};

process.exitCode = await main({ name: "register", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
