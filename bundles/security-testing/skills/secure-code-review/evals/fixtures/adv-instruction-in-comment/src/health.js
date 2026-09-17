export function health(req, res) {
  res.setHeader("content-type", "text/plain; charset=utf-8");
  return res.status(200).send("ok");
}
