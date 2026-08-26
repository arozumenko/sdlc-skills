# Coverage runs in both directions

Checking that every flow node has a screen is only half the job. A screen can
also point at a node that **no longer exists** — a decision retires a node, the
flow map is rewritten, and the screen spec keeps its old `node` value.

That orphan passes a node→screen check silently, because nothing is *missing*.
Something is *stale*, which no "is everything covered?" question will surface.

This is not hypothetical. On this project `S-003-5 "Sign In [FLOW GAP]"` kept
pointing at node `6.1` for two passes after that node was retired and replaced,
while a node→screen check reported a clean 44/44.

## Run both

**Forward — every node that should be a screen has one:**

```python
import json, glob
spec = json.load(open('docs/discovery/flows/hotelbooking.flowspec.json'))
screens = {}
for f in sorted(glob.glob('docs/design/*.screens.json')):
    d = json.load(open(f))
    for s in d['screens']:
        n = s.get('node'); n = n if isinstance(n, list) else [n]
        for x in n:
            screens.setdefault(d['flow'], set()).add(str(x).strip())

for fl in spec['flows']:
    have = screens.get(fl['key'], set())
    for nd in fl['nodes']:
        if (nd.get('decision') or {}).get('question'):      # a decision is not a screen
            continue
        lab = str(nd.get('label') or '')
        if lab.startswith('[Handoff]') or nd.get('archetype') == 'handoff':
            continue                                        # a handoff is a transition
        if lab.startswith('[N/A'):
            continue                                        # superseded by a decision
        if str(nd['id']) not in have:
            print('UNDESIGNED', fl['key'], nd['id'], lab)
```

**Reverse — every screen points at a node that still exists:**

```python
import json, glob
spec = json.load(open('docs/discovery/flows/hotelbooking.flowspec.json'))
nodes = {f['key']: {str(n['id']) for n in f['nodes']} for f in spec['flows']}
for fp in sorted(glob.glob('docs/design/*.screens.json')):
    d = json.load(open(fp)); k = d['flow']
    for s in d['screens']:
        n = s.get('node'); n = n if isinstance(n, list) else [n]
        for x in n:
            if str(x).strip() not in nodes.get(k, set()):
                print('ORPHAN', k, s['id'], '-> node', repr(x), '|', s['title'])
```

Both must report nothing.

## Why it matters more than it looks

Downstream work is traced through these ids. Test cases cite an acceptance
criterion, which cites a flow node, which cites a screen. An orphaned screen
means a test author writes a case against something that was deliberately
removed — and the failure surfaces days later as "this screen doesn't exist",
long after the cheap moment to fix it.

Run both directions **after any pass that edits a flow map**, not only after
editing screens. The orphan is created by the flow edit, not by the screen.
