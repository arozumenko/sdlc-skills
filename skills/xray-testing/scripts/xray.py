#!/usr/bin/env python3
"""Xray CLI — thin HTTP surface over Xray Cloud (GraphQL) and Server/DC (REST).

See ../SKILL.md and ../references/*.md for the concepts; this script is
the fallback when an MCP tool isn't wired. Every write verifies itself by
re-fetching the target and checking counts / status. Stdlib only.

Jira REST API version
---------------------
This CLI hits `/rest/api/2/...` for its Jira lookups (`issue/{key}`,
`user/search`, `field`). v2 vs v3 differs materially for rich-text
fields (v2 returns wiki markup on Cloud, v3 returns ADF), but this
CLI only ever reads `id` / `summary` / `accountId` / field metadata
— none of which differ between versions — so v2 is retained for
simplicity. The sibling `atlassian-content` skill uses v3 where
rich-text shape matters.

Environment
-----------
Deployment is auto-detected. Override with XRAY_DEPLOYMENT=cloud|server.

  Cloud:
    XRAY_CLIENT_ID       client ID from Jira → Apps → Xray → API Keys
    XRAY_CLIENT_SECRET   the secret paired with XRAY_CLIENT_ID
    JIRA_BASE_URL        https://<site>.atlassian.net        (for issueId lookups)
    XRAY_BASE_URL        https://xray.cloud.getxray.app/api/v2 (optional)

  Server / DC:
    JIRA_BASE_URL        https://<your-jira>
    JIRA_TOKEN           PAT (preferred) or API token
    JIRA_USER            only for basic auth (paired with JIRA_TOKEN)

Cache
-----
  XRAY_CACHE_DIR         default ~/.cache/xray    (JWT cache for Cloud)

Output
------
Default is human-readable. Pass --json for pure JSON on stdout so you can
pipe to jq. Non-zero exit on any validation mismatch after a write.
"""
from __future__ import annotations

import argparse
import base64
import dataclasses
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any


# ────────────────────────────────────────────────────────────────────────
# Config + environment
# ────────────────────────────────────────────────────────────────────────

DEFAULT_CLOUD_BASE = "https://xray.cloud.getxray.app/api/v2"

# Regional Xray Cloud endpoints. Set XRAY_REGION to pick one without
# having to spell out XRAY_BASE_URL (XRAY_BASE_URL still wins if both are set).
# If your tenant is on a region not listed here, set XRAY_BASE_URL directly.
XRAY_REGION_BASES = {
    "global": "https://xray.cloud.getxray.app/api/v2",
    "us":     "https://xray.cloud.getxray.app/api/v2",  # alias for global
    "eu":     "https://eu.xray.cloud.getxray.app/api/v2",
    "au":     "https://au.xray.cloud.getxray.app/api/v2",
    "apac":   "https://au.xray.cloud.getxray.app/api/v2",  # alias for au
}


@dataclasses.dataclass
class Config:
    deployment: str                # "cloud" | "server"
    xray_base_url: str             # /api/v2 root (cloud) OR /rest/raven/2.0 root (server)
    jira_base_url: str             # for Jira REST lookups (issueId)
    auth_header: str               # Authorization header for Xray API calls
    jira_auth_header: str | None   # Authorization for Jira REST; None on Cloud without JIRA_USER+JIRA_TOKEN
    cache_dir: Path
    # Lazily-populated cache of Jira custom fields (name → id). Populated
    # on first `custom_field_id()` call and reused for subsequent lookups
    # in the same process — avoids fetching `/rest/api/2/field` three times
    # for a single Server `test create` (Test Type, Generic Definition,
    # Cucumber Content).
    _field_cache: dict[str, str] | None = None


def _die(msg: str, code: int = 2) -> None:
    print(f"xray: {msg}", file=sys.stderr)
    sys.exit(code)


def load_config() -> Config:
    deployment = os.environ.get("XRAY_DEPLOYMENT", "").strip().lower()
    client_id = os.environ.get("XRAY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("XRAY_CLIENT_SECRET", "").strip()
    jira_base_url = os.environ.get("JIRA_BASE_URL", "").strip().rstrip("/")
    jira_token = os.environ.get("JIRA_TOKEN", "").strip()
    jira_user = os.environ.get("JIRA_USER", "").strip()
    cache_dir = Path(os.environ.get("XRAY_CACHE_DIR", Path.home() / ".cache" / "xray"))

    if not deployment:
        if client_id and client_secret:
            deployment = "cloud"
        elif jira_token:
            deployment = "server"
        else:
            _die(
                "cannot detect deployment. Set XRAY_CLIENT_ID+XRAY_CLIENT_SECRET "
                "for cloud, or JIRA_TOKEN (+JIRA_BASE_URL) for server, "
                "or export XRAY_DEPLOYMENT=cloud|server."
            )

    if deployment == "cloud":
        if not (client_id and client_secret):
            _die("cloud deployment requires XRAY_CLIENT_ID + XRAY_CLIENT_SECRET.")
        if not jira_base_url:
            _die("JIRA_BASE_URL is required on cloud.")
        # Resolve Xray base URL: XRAY_BASE_URL (exact) > XRAY_REGION lookup > default global.
        raw_base = os.environ.get("XRAY_BASE_URL", "").strip()
        if raw_base:
            xray_base_url = raw_base.rstrip("/")
        else:
            region = os.environ.get("XRAY_REGION", "global").strip().lower()
            if region not in XRAY_REGION_BASES:
                _die(
                    f"unknown XRAY_REGION={region!r}. "
                    f"Known aliases: {', '.join(sorted(XRAY_REGION_BASES))}. "
                    "If your tenant is on a non-listed region, set "
                    "XRAY_BASE_URL to the exact endpoint."
                )
            xray_base_url = XRAY_REGION_BASES[region]
        # Tolerate base URL without /api/v2 suffix so bare regional URLs work
        # (e.g. XRAY_BASE_URL=https://eu.xray.cloud.getxray.app).
        if not xray_base_url.endswith("/api/v2"):
            xray_base_url = xray_base_url + "/api/v2"
        jwt = _cloud_get_jwt(xray_base_url, client_id, client_secret, cache_dir)
        auth_header = f"Bearer {jwt}"
        # Jira REST on Cloud uses email+API-token via Basic auth; the Xray JWT
        # does NOT authenticate against /rest/api/3/*.
        if jira_user and jira_token:
            raw = f"{jira_user}:{jira_token}".encode()
            jira_auth_header = "Basic " + base64.b64encode(raw).decode()
        else:
            jira_auth_header = None
    elif deployment == "server":
        if not jira_base_url:
            _die("server deployment requires JIRA_BASE_URL.")
        if not jira_token:
            _die("server deployment requires JIRA_TOKEN.")
        xray_base_url = f"{jira_base_url}/rest/raven/2.0"
        if jira_user:
            raw = f"{jira_user}:{jira_token}".encode()
            auth_header = "Basic " + base64.b64encode(raw).decode()
        else:
            auth_header = f"Bearer {jira_token}"
        # Same credential authenticates both Xray-on-Jira and Jira REST on Server/DC.
        jira_auth_header = auth_header
    else:
        _die(f"unknown XRAY_DEPLOYMENT: {deployment!r}")
        raise SystemExit(2)  # unreachable, for type checkers

    return Config(
        deployment=deployment,
        xray_base_url=xray_base_url,
        jira_base_url=jira_base_url,
        auth_header=auth_header,
        jira_auth_header=jira_auth_header,
        cache_dir=cache_dir,
    )


# ────────────────────────────────────────────────────────────────────────
# HTTP
# ────────────────────────────────────────────────────────────────────────

def _http(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    expect_json: bool = True,
) -> Any:
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
    except urllib.error.HTTPError as e:  # includes 4xx / 5xx
        detail = e.read().decode("utf-8", "replace")[:2000]
        _die(f"HTTP {e.code} on {method} {url}\n  {detail}")
    except urllib.error.URLError as e:
        _die(f"network error on {method} {url}: {e.reason}")

    if not body:
        return None
    if expect_json:
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            return body.decode("utf-8", "replace")
    return body


def _cloud_get_jwt(base_url: str, client_id: str, client_secret: str, cache_dir: Path) -> str:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / "token.json"
    now = int(time.time())

    if cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text())
            # Cache hit requires matching base URL **and** client_id —
            # otherwise rotating XRAY_CLIENT_ID (or switching tenants at
            # the same base URL) would silently reuse the stale JWT
            # until expiry.
            if (
                cached.get("base_url") == base_url
                and cached.get("client_id") == client_id
                and cached.get("expires_at", 0) > now + 60
            ):
                return cached["jwt"]
        except Exception:
            pass

    payload = json.dumps({
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode()
    jwt = _http(
        f"{base_url}/authenticate",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=payload,
        expect_json=True,
    )
    if not isinstance(jwt, str):
        _die(f"unexpected /authenticate response type: {type(jwt).__name__}")
    # Xray JWTs live ~24h; cache 23h to be safe.
    cache_file.write_text(json.dumps({
        "base_url": base_url,
        "client_id": client_id,
        "jwt": jwt,
        "expires_at": now + 23 * 3600,
    }))
    try:
        cache_file.chmod(0o600)
    except OSError:
        pass
    return jwt


def _call_xray(
    cfg: Config,
    path: str,
    *,
    method: str = "GET",
    params: dict[str, Any] | None = None,
    json_body: Any = None,
    multipart: list[tuple[str, str, bytes, str]] | None = None,
) -> Any:
    url = cfg.xray_base_url + path
    if params:
        flat = {k: v for k, v in params.items() if v is not None}
        if flat:
            url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(flat)
    headers = {"Authorization": cfg.auth_header}
    data: bytes | None = None

    if multipart is not None:
        boundary = "----xray-boundary-" + uuid.uuid4().hex
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        data = _encode_multipart(multipart, boundary)
    elif json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode()

    return _http(url, method=method, headers=headers, data=data)


def _call_jira(cfg: Config, path: str, *, method: str = "GET", json_body: Any = None) -> Any:
    if not cfg.jira_auth_header:
        _die(
            "Jira REST call requires JIRA_USER (email) + JIRA_TOKEN on cloud. "
            "Set both to enable issueId / accountId / field-id lookups."
        )
    url = cfg.jira_base_url + path
    headers = {"Authorization": cfg.jira_auth_header, "Accept": "application/json"}
    data: bytes | None = None
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode()
    return _http(url, method=method, headers=headers, data=data)


def _encode_multipart(
    parts: list[tuple[str, str, bytes, str]], boundary: str
) -> bytes:
    """parts: list of (field_name, filename, data, content_type)."""
    crlf = b"\r\n"
    buf: list[bytes] = []
    for name, filename, content, ctype in parts:
        buf.append(f"--{boundary}".encode())
        disp = f'Content-Disposition: form-data; name="{name}"; filename="{filename}"'
        buf.append(disp.encode())
        buf.append(f"Content-Type: {ctype}".encode())
        buf.append(b"")
        buf.append(content)
    buf.append(f"--{boundary}--".encode())
    buf.append(b"")
    return crlf.join(buf)


# ────────────────────────────────────────────────────────────────────────
# Shared identity helpers
# ────────────────────────────────────────────────────────────────────────

def resolve_issue_id(cfg: Config, key: str) -> str:
    """Jira numeric issueId (required by Cloud GraphQL)."""
    data = _call_jira(cfg, f"/rest/api/2/issue/{key}?fields=summary")
    if not isinstance(data, dict) or "id" not in data:
        _die(f"could not resolve issueId for {key}")
    return str(data["id"])


def resolve_account_id(cfg: Config, query: str) -> str:
    """Cloud: resolve an email / display-name to an accountId.

    Server / DC: Jira expects a **username**, not an accountId — the input
    is returned as-is and the caller is responsible for passing a valid
    Server username. Passing an email (e.g. `alice@example.com`) on Server
    will cause Jira to reject the subsequent create/update with a
    ``user not found`` error; use the operator's Jira username instead.
    """
    if cfg.deployment != "cloud":
        return query  # server uses username directly — see docstring above
    data = _call_jira(
        cfg, "/rest/api/2/user/search?query=" + urllib.parse.quote(query)
    )
    if not isinstance(data, list) or not data:
        _die(f"no user found for query {query!r}")
    if len(data) > 1:
        _die(
            f"ambiguous user query {query!r} matched {len(data)} users; "
            "narrow it down (e.g. use email)."
        )
    return data[0]["accountId"]


def custom_field_id(cfg: Config, field_name: str) -> str:
    """Server-only: resolve a custom-field name to its customfield_XXXXX id.

    Memoized on the Config instance — a single ``test create`` can trigger
    three lookups (Test Type, Generic Definition, Cucumber Content) on
    Server, and ``/rest/api/2/field`` is a full-catalog response; we fetch
    it once per process.
    """
    if cfg._field_cache is None:
        data = _call_jira(cfg, "/rest/api/2/field")
        if not isinstance(data, list):
            _die("unexpected /rest/api/2/field response")
        cfg._field_cache = {
            fld["name"]: fld["id"]
            for fld in data
            if isinstance(fld, dict) and "name" in fld and "id" in fld
        }
    if field_name in cfg._field_cache:
        return cfg._field_cache[field_name]
    _die(f"custom field {field_name!r} not found in this Jira project.")
    raise SystemExit(2)


# ────────────────────────────────────────────────────────────────────────
# GraphQL helper (Cloud)
# ────────────────────────────────────────────────────────────────────────

def _graphql(cfg: Config, query: str, variables: dict[str, Any] | None = None) -> Any:
    body = {"query": query, "variables": variables or {}}
    out = _call_xray(cfg, "/graphql", method="POST", json_body=body)
    if isinstance(out, dict) and out.get("errors"):
        msgs = "; ".join(e.get("message", "?") for e in out["errors"])
        _die(f"GraphQL error: {msgs}")
    if not isinstance(out, dict):
        _die(f"unexpected GraphQL response shape: {type(out).__name__}")
    return out.get("data")


# ────────────────────────────────────────────────────────────────────────
# Entity ops — dispatched on cfg.deployment
# ────────────────────────────────────────────────────────────────────────

def test_get(cfg: Config, key: str) -> dict:
    if cfg.deployment == "cloud":
        issue_id = resolve_issue_id(cfg, key)
        data = _graphql(cfg, """
            query($id: String!) {
              getTest(issueId: $id) {
                issueId projectId
                testType { name kind }
                jira(fields: ["key","summary","status"])
                steps { id action data result attachments { filename } }
                gherkin
                unstructured
                preconditions(limit: 50) { total results { jira(fields:["key","summary"]) } }
              }
            }
        """, {"id": issue_id})
        test = (data or {}).get("getTest") or _die(f"Test {key} not found.")
        return test
    # server
    t = _call_xray(cfg, f"/api/test/{key}")
    steps = _call_xray(cfg, f"/api/test/{key}/step") or []
    pre = _call_xray(cfg, f"/api/test/{key}/preconditions") or []
    if not isinstance(t, dict):
        _die(f"Test {key} not found or wrong issue type.")
    t["steps"] = steps
    t["preconditions"] = pre
    return t


def test_create(
    cfg: Config,
    project_key: str,
    summary: str,
    test_type: str,
    steps: list[dict] | None,
    gherkin: str | None,
    definition: str | None,
    assignee: str | None,
) -> str:
    if cfg.deployment == "cloud":
        jira_fields: dict[str, Any] = {"project": {"key": project_key}, "summary": summary}
        if assignee:
            jira_fields["assignee"] = {"accountId": resolve_account_id(cfg, assignee)}
        variables: dict[str, Any] = {
            "tt": {"name": test_type},
            "jira": {"fields": jira_fields},
        }
        mutation = """
          mutation($tt: UpdateTestTypeInput!, $jira: JSON!,
                   $steps: [CreateStepInput], $gherkin: String, $unstructured: String) {
            createTest(testType: $tt, jira: $jira,
                       steps: $steps, gherkin: $gherkin, unstructured: $unstructured) {
              test { issueId jira(fields: ["key"]) }
              warnings
            }
          }
        """
        if test_type == "Manual":
            variables["steps"] = steps or []
        elif test_type == "Cucumber":
            variables["gherkin"] = gherkin or ""
        else:
            variables["unstructured"] = definition or ""
        data = _graphql(cfg, mutation, variables)
        node = ((data or {}).get("createTest") or {}).get("test") or _die("createTest returned no test.")
        key = node["jira"]["key"]
        return key
    # server
    tt_field = custom_field_id(cfg, "Test Type")
    fields: dict[str, Any] = {
        "project":   {"key": project_key},
        "summary":   summary,
        "issuetype": {"name": "Test"},
        tt_field:    {"value": test_type},
    }
    if assignee:
        fields["assignee"] = {"name": assignee}
    if test_type == "Generic" and definition:
        defn_field = custom_field_id(cfg, "Generic Test Definition")
        fields[defn_field] = definition
    if test_type == "Cucumber" and gherkin:
        gherkin_field = custom_field_id(cfg, "Cucumber Test Content")
        fields[gherkin_field] = gherkin
    created = _call_jira(cfg, "/rest/api/2/issue", method="POST", json_body={"fields": fields})
    key = created["key"]
    if test_type == "Manual":
        for step in steps or []:
            _call_xray(cfg, f"/api/test/{key}/step", method="POST", json_body={
                "step": step.get("action", ""),
                "data": step.get("data", ""),
                "result": step.get("result", ""),
            })
    return key


def test_add_step(cfg: Config, key: str, action: str, data_val: str, result: str) -> None:
    if cfg.deployment == "cloud":
        issue_id = resolve_issue_id(cfg, key)
        _graphql(cfg, """
            mutation($id: String!, $step: CreateStepInput!) {
              addTestStep(issueId: $id, step: $step) { warnings }
            }
        """, {"id": issue_id, "step": {"action": action, "data": data_val, "result": result}})
        return
    _call_xray(cfg, f"/api/test/{key}/step", method="POST", json_body={
        "step": action, "data": data_val, "result": result,
    })


def test_link_requirement(cfg: Config, test_key: str, req_key: str) -> None:
    if cfg.deployment == "cloud":
        _graphql(cfg, """
            mutation($req: String!, $tests: [String]!) {
              addTestsToRequirement(issueId: $req, testIssueIds: $tests) { addedTests warning }
            }
        """, {"req": resolve_issue_id(cfg, req_key),
              "tests": [resolve_issue_id(cfg, test_key)]})
        return
    _call_xray(cfg, f"/api/test/{test_key}/requirement",
               method="POST", json_body={"add": [req_key]})


def testset_add(cfg: Config, set_key: str, test_keys: list[str]) -> None:
    if cfg.deployment == "cloud":
        _graphql(cfg, """
            mutation($id: String!, $tests: [String]!) {
              addTestsToTestSet(issueId: $id, testIssueIds: $tests) { addedTests warning }
            }
        """, {"id": resolve_issue_id(cfg, set_key),
              "tests": [resolve_issue_id(cfg, k) for k in test_keys]})
        return
    _call_xray(cfg, f"/api/testset/{set_key}/test",
               method="POST", json_body={"add": test_keys})


def testplan_add(cfg: Config, plan_key: str, test_keys: list[str]) -> None:
    if cfg.deployment == "cloud":
        _graphql(cfg, """
            mutation($id: String!, $tests: [String]!) {
              addTestsToTestPlan(issueId: $id, testIssueIds: $tests) { addedTests warning }
            }
        """, {"id": resolve_issue_id(cfg, plan_key),
              "tests": [resolve_issue_id(cfg, k) for k in test_keys]})
        return
    _call_xray(cfg, f"/api/testplan/{plan_key}/test",
               method="POST", json_body={"add": test_keys})


def exec_create(
    cfg: Config,
    project_key: str,
    summary: str,
    test_keys: list[str],
    plan_key: str | None,
) -> str:
    if cfg.deployment == "cloud":
        variables: dict[str, Any] = {
            "tests": [resolve_issue_id(cfg, k) for k in test_keys],
            "jira":  {"fields": {"project": {"key": project_key}, "summary": summary}},
        }
        if plan_key:
            variables["plan"] = resolve_issue_id(cfg, plan_key)
            mutation = """
              mutation($plan: String!, $tests: [String]!, $jira: JSON!) {
                createTestExecution(testPlanIssueId: $plan,
                                    testIssueIds: $tests, jira: $jira) {
                  testExecution { jira(fields: ["key"]) } warnings
                }
              }
            """
        else:
            mutation = """
              mutation($tests: [String]!, $jira: JSON!) {
                createTestExecution(testIssueIds: $tests, jira: $jira) {
                  testExecution { jira(fields: ["key"]) } warnings
                }
              }
            """
        data = _graphql(cfg, mutation, variables)
        node = ((data or {}).get("createTestExecution") or {}).get("testExecution") \
            or _die("createTestExecution returned no execution.")
        return node["jira"]["key"]
    # server
    created = _call_jira(cfg, "/rest/api/2/issue", method="POST", json_body={
        "fields": {
            "project":   {"key": project_key},
            "summary":   summary,
            "issuetype": {"name": "Test Execution"},
        },
    })
    exec_key = created["key"]
    if test_keys:
        _call_xray(cfg, f"/api/testexec/{exec_key}/test",
                   method="POST", json_body={"add": test_keys})
    if plan_key:
        _call_xray(cfg, f"/api/testplan/{plan_key}/testexecution",
                   method="POST", json_body={"add": [exec_key]})
    return exec_key


def exec_list_runs(cfg: Config, exec_key: str) -> list[dict]:
    if cfg.deployment == "cloud":
        issue_id = resolve_issue_id(cfg, exec_key)
        # Xray caps `limit` at 100 per query; paginate with `start`.
        results: list[dict] = []
        start = 0
        while True:
            data = _graphql(cfg, """
                query($id: String!, $start: Int!) {
                  getTestExecution(issueId: $id) {
                    testRuns(limit: 100, start: $start) {
                      total
                      results {
                        id
                        status { name }
                        test { jira(fields: ["key","summary"]) }
                      }
                    }
                  }
                }
            """, {"id": issue_id, "start": start})
            tr = ((data or {}).get("getTestExecution") or {}).get("testRuns") or {}
            batch = tr.get("results") or []
            results.extend(batch)
            total = tr.get("total") or 0
            start += len(batch)
            if len(batch) == 0 or start >= total:
                break
        return results
    rows = _call_xray(cfg, f"/api/testexec/{exec_key}/test") or []
    return rows if isinstance(rows, list) else []


def run_set_status(cfg: Config, run_id: str, status: str, comment: str | None) -> None:
    if cfg.deployment == "cloud":
        _graphql(cfg, """
            mutation($id: String!, $status: String!) {
              updateTestRunStatus(id: $id, status: $status) { warnings }
            }
        """, {"id": run_id, "status": status})
        if comment:
            _graphql(cfg, """
                mutation($id: String!, $c: String!) {
                  updateTestRunComment(id: $id, comment: $c) { warnings }
                }
            """, {"id": run_id, "c": comment})
        return
    body: dict[str, Any] = {"status": status}
    if comment:
        body["comment"] = comment
    _call_xray(cfg, f"/api/testrun/{run_id}", method="PUT", json_body=body)


def run_add_evidence(cfg: Config, run_id: str, file_path: Path) -> None:
    content = file_path.read_bytes()
    ctype = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    if cfg.deployment == "cloud":
        _graphql(cfg, """
            mutation($id: String!, $ev: [AttachmentDataInput]) {
              addEvidenceToTestRun(id: $id, evidence: $ev) { warnings }
            }
        """, {"id": run_id, "ev": [{
            "filename": file_path.name,
            "mimeType": ctype,
            "data": base64.b64encode(content).decode(),
        }]})
        return
    _call_xray(
        cfg, f"/api/testrun/{run_id}/attachment",
        method="POST",
        multipart=[("file", file_path.name, content, ctype)],
    )


# ────────────────────────────────────────────────────────────────────────
# Results import
# ────────────────────────────────────────────────────────────────────────

def _import_query(project_key: str, plan_key: str | None, env: str | None,
                  exec_key: str | None) -> dict[str, str]:
    return {
        "projectKey":       project_key if not exec_key else None,
        "testExecKey":      exec_key,
        "testPlanKey":      plan_key,
        "testEnvironments": env,
    }


def import_junit(cfg: Config, path: Path, project_key: str, plan_key: str | None,
                 env: str | None, exec_key: str | None) -> str:
    content = path.read_bytes()
    res = _call_xray(
        cfg, "/import/execution/junit",
        method="POST",
        params=_import_query(project_key, plan_key, env, exec_key),
        multipart=[("file", path.name, content, "application/xml")],
    )
    key = _extract_exec_key(res)
    return key


def import_cucumber(cfg: Config, path: Path, project_key: str,
                    plan_key: str | None, env: str | None, exec_key: str | None) -> str:
    content = json.loads(path.read_text())
    res = _call_xray(
        cfg, "/import/execution/cucumber",
        method="POST",
        params=_import_query(project_key, plan_key, env, exec_key),
        json_body=content,
    )
    return _extract_exec_key(res)


def import_xray_json(cfg: Config, path: Path) -> str:
    content = json.loads(path.read_text())
    res = _call_xray(cfg, "/import/execution", method="POST", json_body=content)
    return _extract_exec_key(res)


def _extract_exec_key(resp: Any) -> str:
    if isinstance(resp, dict):
        if "key" in resp:
            return resp["key"]
        tr = resp.get("testExecIssue") or resp.get("testExecIssueKey")
        if isinstance(tr, dict) and "key" in tr:
            return tr["key"]
        if isinstance(tr, str):
            return tr
    _die(f"could not locate Test Execution key in import response: {resp!r}")
    raise SystemExit(2)


# ────────────────────────────────────────────────────────────────────────
# Misc queries
# ────────────────────────────────────────────────────────────────────────

def coverage(cfg: Config, req_key: str) -> list[dict]:
    if cfg.deployment == "cloud":
        issue_id = resolve_issue_id(cfg, req_key)
        results: list[dict] = []
        start = 0
        while True:
            data = _graphql(cfg, """
                query($id: String!, $start: Int!) {
                  getCoverableIssue(issueId: $id) {
                    tests(limit: 100, start: $start) {
                      total
                      results { jira(fields: ["key","summary"]) }
                    }
                  }
                }
            """, {"id": issue_id, "start": start})
            inner = ((data or {}).get("getCoverableIssue") or {}).get("tests") or {}
            batch = inner.get("results") or []
            results.extend(batch)
            total = inner.get("total") or 0
            start += len(batch)
            if len(batch) == 0 or start >= total:
                break
        return results
    rows = _call_xray(cfg, f"/api/requirement/{req_key}/test") or []
    return rows if isinstance(rows, list) else []


def statuses(cfg: Config) -> list[dict]:
    if cfg.deployment == "cloud":
        data = _graphql(cfg, "query { getStatuses { name description color final } }")
        return (data or {}).get("getStatuses") or []
    rows = _call_xray(cfg, "/api/settings/teststatuses") or []
    return rows if isinstance(rows, list) else []


# ────────────────────────────────────────────────────────────────────────
# Output helpers
# ────────────────────────────────────────────────────────────────────────

def _out(args: argparse.Namespace, data: Any, human: str | None = None) -> None:
    if getattr(args, "json", False):
        print(json.dumps(data, indent=2, sort_keys=True))
    elif human is not None:
        print(human)
    else:
        print(json.dumps(data, indent=2, sort_keys=True))


def _parse_steps_file(path: Path | None) -> list[dict]:
    if not path:
        return []
    raw = path.read_text()
    if path.suffix == ".json":
        data = json.loads(raw)
        if not isinstance(data, list):
            _die("--steps file must contain a JSON array of {action,data,result} objects.")
        return data
    # plain text: one step per line with "|" separator
    out: list[dict] = []
    for line in raw.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|", 2)]
        while len(parts) < 3:
            parts.append("")
        out.append({"action": parts[0], "data": parts[1], "result": parts[2]})
    return out


# ────────────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="xray", description="Xray CLI (stdlib-only).")
    p.add_argument("--json", action="store_true",
                   help="emit JSON on stdout (default: human-readable).")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("config", help="print effective configuration.")
    sub.add_parser("statuses", help="list project-allowed Test Run statuses.")
    sub.add_parser("auth-verify", help="one-shot API reachability check.")

    # test
    t = sub.add_parser("test", help="Test CRUD.").add_subparsers(dest="sub", required=True)
    tg = t.add_parser("get"); tg.add_argument("key")
    tg.add_argument("--raw", action="store_true")
    tc = t.add_parser("create")
    tc.add_argument("--project", required=True)
    tc.add_argument("--summary", required=True)
    tc.add_argument("--type", default="Manual", choices=["Manual", "Cucumber", "Generic"])
    tc.add_argument("--steps", type=Path, help="steps file (.json array or .txt action|data|result)")
    tc.add_argument("--gherkin", type=Path)
    tc.add_argument("--definition", type=Path)
    tc.add_argument("--assignee", help="email / accountId (cloud) or username (server)")
    tc.add_argument("--link-to", dest="link_to",
                    help="story/requirement key to link as Xray coverage (e.g. PROJ-123). "
                         "Creates an Xray requirement link — the correct link type for "
                         "coverage rollup. Verified after create; exit 3 on mismatch.")
    ts = t.add_parser("add-step")
    ts.add_argument("key"); ts.add_argument("--action", required=True)
    ts.add_argument("--data", default=""); ts.add_argument("--result", required=True)
    tl = t.add_parser("link-requirement")
    tl.add_argument("test_key"); tl.add_argument("req_key")

    # sets / plans
    ss = sub.add_parser("testset", help="Test Set ops.").add_subparsers(dest="sub", required=True)
    sa = ss.add_parser("add")
    sa.add_argument("set_key"); sa.add_argument("test_keys", nargs="+")
    pp = sub.add_parser("testplan", help="Test Plan ops.").add_subparsers(dest="sub", required=True)
    pa = pp.add_parser("add")
    pa.add_argument("plan_key"); pa.add_argument("test_keys", nargs="+")

    # executions + runs
    ex = sub.add_parser("exec", help="Test Execution ops.").add_subparsers(dest="sub", required=True)
    ec = ex.add_parser("create")
    ec.add_argument("--project", required=True)
    ec.add_argument("--summary", required=True)
    ec.add_argument("--tests", required=True, help="comma-separated Test keys")
    ec.add_argument("--plan")
    er = ex.add_parser("list-runs"); er.add_argument("exec_key")

    rn = sub.add_parser("run", help="Test Run ops.").add_subparsers(dest="sub", required=True)
    rs = rn.add_parser("status")
    rs.add_argument("run_id"); rs.add_argument("--set", dest="status", required=True)
    rs.add_argument("--comment")
    re_ = rn.add_parser("evidence")
    re_.add_argument("run_id"); re_.add_argument("--file", required=True, type=Path)

    # import
    imp = sub.add_parser("import", help="Results import.").add_subparsers(dest="sub", required=True)
    for fmt in ("junit", "cucumber", "xray-json"):
        ip = imp.add_parser(fmt)
        ip.add_argument("file", type=Path)
        if fmt != "xray-json":
            ip.add_argument("--project", required=True)
            ip.add_argument("--plan"); ip.add_argument("--env")
            ip.add_argument("--exec")

    # coverage
    cv = sub.add_parser("coverage"); cv.add_argument("req_key")

    return p


def main() -> None:
    args = build_parser().parse_args()

    if args.cmd == "config":
        try:
            cfg = load_config()
        except SystemExit:
            raise
        _out(args, {
            "deployment": cfg.deployment,
            "xray_base_url": cfg.xray_base_url,
            "jira_base_url": cfg.jira_base_url,
            "cache_dir": str(cfg.cache_dir),
        }, human=(
            f"deployment: {cfg.deployment}\n"
            f"xray:       {cfg.xray_base_url}\n"
            f"jira:       {cfg.jira_base_url}\n"
            f"cache:      {cfg.cache_dir}"
        ))
        return

    cfg = load_config()

    if args.cmd == "auth-verify":
        sts = statuses(cfg)
        _out(args, {"ok": True, "status_count": len(sts)},
             human=f"OK: {cfg.deployment} reachable, {len(sts)} statuses configured.")
        return
    if args.cmd == "statuses":
        sts = statuses(cfg)
        _out(args, sts, human="\n".join(
            f"{s.get('name'):12} final={s.get('final')}" for s in sts))
        return

    if args.cmd == "test" and args.sub == "get":
        t = test_get(cfg, args.key)
        if args.raw or getattr(args, "json", False):
            _out(args, t)
        else:
            key = (t.get("jira") or {}).get("key") or t.get("key")
            summary = (t.get("jira") or {}).get("summary") or t.get("summary")
            tt = (t.get("testType") or {}).get("name") or t.get("testType", "?")
            tt_kind = (t.get("testType") or {}).get("kind", "").lower()
            steps = t.get("steps") or []
            gherkin = t.get("gherkin") or ""
            unstructured = t.get("unstructured") or ""
            lines = [f"{key}  [{tt}]  {summary}"]
            if steps:
                lines.append(f"  {len(steps)} step(s)")
                for i, s in enumerate(steps, 1):
                    lines.append(f"    {i}. {s.get('action','')}  →  {s.get('result','')}")
            if gherkin.strip():
                lines.append("  gherkin:")
                lines.extend("    " + ln for ln in gherkin.splitlines())
            if unstructured.strip():
                lines.append("  definition:")
                lines.extend("    " + ln for ln in unstructured.splitlines())
            if not steps and not gherkin.strip() and not unstructured.strip():
                lines.append(f"  (no body — {tt_kind or 'unknown'} test has no content)")
            print("\n".join(lines))
        return

    if args.cmd == "test" and args.sub == "create":
        steps = _parse_steps_file(args.steps) if args.type == "Manual" else None
        gherkin = args.gherkin.read_text() if args.gherkin else None
        definition = args.definition.read_text() if args.definition else None
        key = test_create(cfg, args.project, args.summary, args.type,
                          steps, gherkin, definition, args.assignee)
        expected_steps = len(steps or []) if args.type == "Manual" else None
        verify = test_get(cfg, key)
        if expected_steps is not None:
            actual = len(verify.get("steps") or [])
            if actual != expected_steps:
                _die(f"created {key} but step count mismatch: expected {expected_steps}, got {actual}", 3)
        linked_note = ""
        if args.link_to:
            test_link_requirement(cfg, key, args.link_to)
            # Verify coverage landed on the story side.
            covering = coverage(cfg, args.link_to)
            keys_on_story = {
                ((t.get("jira") or {}).get("key")) or t.get("key") for t in covering
            }
            if key not in keys_on_story:
                _die(f"created {key} and called addTestsToRequirement({args.link_to}), "
                     f"but {key} is NOT in {args.link_to}'s coverage list after re-fetch. "
                     f"Verify Xray permissions on the story and re-link.", 3)
            linked_note = f"; linked as coverage of {args.link_to}  ✓"
        _out(args, {"key": key, "linked_to": args.link_to} if args.link_to else {"key": key},
             human=f"Created Test {key}  ✓ verified{linked_note}")
        return

    if args.cmd == "test" and args.sub == "add-step":
        before = len(test_get(cfg, args.key).get("steps") or [])
        test_add_step(cfg, args.key, args.action, args.data, args.result)
        after = len(test_get(cfg, args.key).get("steps") or [])
        if after != before + 1:
            _die(f"step count did not increase on {args.key}: {before} → {after}", 3)
        _out(args, {"ok": True, "steps": after},
             human=f"{args.key} now has {after} step(s) ✓")
        return

    if args.cmd == "test" and args.sub == "link-requirement":
        test_link_requirement(cfg, args.test_key, args.req_key)
        _out(args, {"ok": True}, human=f"Linked {args.test_key} → {args.req_key} ✓")
        return

    if args.cmd == "testset" and args.sub == "add":
        testset_add(cfg, args.set_key, args.test_keys)
        _out(args, {"ok": True, "added": args.test_keys},
             human=f"Added {len(args.test_keys)} test(s) to {args.set_key} ✓")
        return

    if args.cmd == "testplan" and args.sub == "add":
        testplan_add(cfg, args.plan_key, args.test_keys)
        _out(args, {"ok": True, "added": args.test_keys},
             human=f"Added {len(args.test_keys)} test(s) to {args.plan_key} ✓")
        return

    if args.cmd == "exec" and args.sub == "create":
        test_keys = [k.strip() for k in args.tests.split(",") if k.strip()]
        key = exec_create(cfg, args.project, args.summary, test_keys, args.plan)
        runs = exec_list_runs(cfg, key)
        if len(runs) != len(test_keys):
            _die(f"exec created {key} but run count != requested tests ({len(runs)} vs {len(test_keys)})", 3)
        _out(args, {"key": key, "runs": len(runs)},
             human=f"Created Test Execution {key} with {len(runs)} run(s) ✓")
        return

    if args.cmd == "exec" and args.sub == "list-runs":
        runs = exec_list_runs(cfg, args.exec_key)
        if getattr(args, "json", False):
            _out(args, runs)
        else:
            for r in runs:
                rid = r.get("id") or r.get("testRunId")
                status = (r.get("status") or {}).get("name") if isinstance(r.get("status"), dict) else r.get("status")
                key = ((r.get("test") or {}).get("jira") or {}).get("key") or r.get("testKey")
                print(f"{rid}  {status:10}  {key}")
        return

    if args.cmd == "run" and args.sub == "status":
        run_set_status(cfg, args.run_id, args.status, args.comment)
        _out(args, {"ok": True}, human=f"Run {args.run_id} → {args.status} ✓")
        return

    if args.cmd == "run" and args.sub == "evidence":
        run_add_evidence(cfg, args.run_id, args.file)
        _out(args, {"ok": True}, human=f"Attached {args.file.name} to {args.run_id} ✓")
        return

    if args.cmd == "import":
        if args.sub == "junit":
            key = import_junit(cfg, args.file, args.project, args.plan, args.env, args.exec)
        elif args.sub == "cucumber":
            key = import_cucumber(cfg, args.file, args.project, args.plan, args.env, args.exec)
        else:  # xray-json
            key = import_xray_json(cfg, args.file)
        runs = exec_list_runs(cfg, key)
        if not runs:
            _die(f"import created {key} but 0 Test Runs — likely mapping failure. "
                 f"Check classname/name-to-Test-key convention.", 3)
        _out(args, {"key": key, "runs": len(runs)},
             human=f"Imported into Test Execution {key}: {len(runs)} run(s) ✓")
        return

    if args.cmd == "coverage":
        tests = coverage(cfg, args.req_key)
        if getattr(args, "json", False):
            _out(args, tests)
        else:
            for t in tests:
                key = ((t.get("jira") or {}).get("key")) or t.get("key")
                summ = ((t.get("jira") or {}).get("summary")) or t.get("summary", "")
                print(f"{key}  {summ}")
        return

    _die(f"unhandled command: {args.cmd}/{getattr(args, 'sub', '')}")


if __name__ == "__main__":
    main()
