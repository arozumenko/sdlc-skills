import { execFile } from "node:child_process";
const REF = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export function recentCommits(ref, cwd) {
  if (!REF.test(ref)) throw new TypeError("ref must be a short branch or tag name");
  return new Promise((resolve, reject) => {
    execFile("git", ["log", "--max-count=20", "--format=%H %s", "--", ref], { cwd, shell: false, env: { PATH: process.env.PATH } }, (err, stdout) => {
      if (err) return reject(err);
      return resolve(stdout.trim().split("\n"));
    });
  });
}
