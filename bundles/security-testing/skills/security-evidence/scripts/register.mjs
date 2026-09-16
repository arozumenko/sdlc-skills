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
  accept: () => import("./lib/cmd-register-transition.mjs").then((m) => m.verb("accept")), // TASK-029
  revoke: () => import("./lib/cmd-register-transition.mjs").then((m) => m.verb("revoke")), // TASK-029
  check: () => import("./lib/cmd-register-transition.mjs").then((m) => m.verb("check")), // TASK-029
  "close-false-positive": () => import("./lib/cmd-register-transition.mjs").then((m) => m.verb("close-false-positive")), // TASK-029
  reopen: () => import("./lib/cmd-register-transition.mjs").then((m) => m.verb("reopen")), // TASK-029
  supersede: () => import("./lib/cmd-register-transition.mjs").then((m) => m.verb("supersede")), // TASK-029
  alias: () => import("./lib/cmd-register-transition.mjs").then((m) => m.verb("alias")), // TASK-029
  transition: () => import("./lib/cmd-register-transition.mjs"), // TASK-029 (ticketed and the other emitter-only events are refused here)
  "consume-verdict": () => import("./lib/cmd-register-consume.mjs"), // TASK-030
  // render: () => import("./lib/cmd-register-render.mjs"), // TASK-059
};

process.exitCode = await main({ name: "register", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
