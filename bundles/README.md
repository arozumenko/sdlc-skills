# Moved to `factories/`

The `bundles/` directory was renamed to [`factories/`](../factories/). The
"bundle" concept is now called a **factory** throughout this repo.

| Old | New |
|---|---|
| `bundles/<id>/` | [`factories/<id>/`](../factories/) |
| `bundles/<id>/BUNDLE.md` | `factories/<id>/FACTORY.md` |
| `bundles/<id>/bundle.json` | `factories/<id>/factory.json` |
| `bundles/SPEC.md` | [`factories/SPEC.md`](../factories/SPEC.md) |
| `npm run validate:bundles` | `npm run validate:factories` |

Install a team with `--factory` (the `--bundle` flag still works as a silent
back-compat alias):

```bash
npx github:arozumenko/sdlc-skills init --factory feature-development
```

See [`factories/SPEC.md`](../factories/SPEC.md) for the full spec.
