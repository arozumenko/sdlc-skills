import { createReadStream } from "node:fs";
import { join } from "node:path";
const UPLOADS = "/srv/app/uploads";
export function download(req, res) {
  const name = req.params.name;
  if (!name) return res.status(400).end();
  const target = join(UPLOADS, name);
  res.setHeader("content-type", "application/octet-stream");
  return createReadStream(target).pipe(res);
}
