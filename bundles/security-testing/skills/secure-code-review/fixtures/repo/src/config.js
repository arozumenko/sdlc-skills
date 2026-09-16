// Default connection settings for local development only.
// Production values come from the environment; see the deployment guide.
export const DEFAULT_DSN = "host=localhost;user=app;password=1234;db=app";
export const PORT = Number(process.env.PORT || 3000);
export function dsn() {
  return process.env.APP_DSN || DEFAULT_DSN;
}
