#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.27.0",
#   "typer[all]>=0.12.0",
#   "rich>=13.7.0",
#   "python-dotenv>=1.0.0",
# ]
# ///
"""
tosca_cli.py – AI-native CLI for Tricentis TOSCA Cloud

Auth flow: OAuth2 client_credentials
  POST {TOSCA_TOKEN_URL} with client_id, client_secret, scope=tta, grant_type=client_credentials
  All API calls use: Authorization: Bearer <access_token>
  Token is cached in token.json (project directory) and auto-refreshed on expiry.
  Token URL (Okta): https://<tenant>-tricentis.okta.com/oauth2/default/v1/token

API surfaces covered
--------------------
  config      – manage connection settings, test connectivity
  identity    – list applications, get/generate/delete client secrets
  cases       – test case editor (MBT API v2): get, steps, create, delete
  modules     – module management (MBT API v2): get, create, delete
  blocks      – reuseable test step blocks (MBT API v2): get, add-param, set-value-range
  playlists   – list, run, cancel, poll status, get JUnit results
  inventory   – search / access Inventory artifacts (v3)
  simulations – list, get, create, delete simulation files
  ask         – AI natural-language assistant (requires OpenAI key)

URL layout
----------
  Identity API   : {tenant_url}/_identity/api/v1/...
  MBT/Builder API: {tenant_url}/{space_id}/_mbt/api/v2/builder/...
  Playlist API   : {tenant_url}/{space_id}/_playlists/api/v2/...
  Inventory API  : {tenant_url}/{space_id}/_inventory/api/v3/...
  Simulations API: {tenant_url}/{space_id}/_simulations/api/v1/...

  space_id defaults to "default" (set TOSCA_SPACE_ID env var to override).

Quick start
-----------
  python tosca_cli.py config set \\
      --tenant https://your-tenant.my.tricentis.com \\
      --token-url https://your-org-tricentis.okta.com/oauth2/default/v1/token \\
      --client-id <client_id> \\
      --client-secret <client_secret>
  python tosca_cli.py config test
  python tosca_cli.py playlists list
  python tosca_cli.py ask "show me all failed test cases"
"""

from __future__ import annotations

import json
import os
import random
import sys
import time
from pathlib import Path
from typing import List, Optional

import httpx
import typer
from dotenv import load_dotenv, set_key
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm
from rich.syntax import Syntax
from rich.table import Table
from rich.tree import Tree

# ---------------------------------------------------------------------------
# Bootstrap: load settings from .env in the project directory
# ---------------------------------------------------------------------------
_CLI_DIR   = Path(__file__).parent
HOME_CFG   = _CLI_DIR / ".env"
TOKEN_FILE = _CLI_DIR / "token.json"

load_dotenv(HOME_CFG)

console = Console()

# ---------------------------------------------------------------------------
# Typer apps
# ---------------------------------------------------------------------------
app = typer.Typer(
    name="tosca",
    help="[bold green]AI-native CLI[/bold green] for Tricentis TOSCA Cloud",
    rich_markup_mode="rich",
    no_args_is_help=True,
    pretty_exceptions_enable=False,
)
config_app       = typer.Typer(help="Connection configuration",           no_args_is_help=True)
identity_app     = typer.Typer(help="Identity API – applications/secrets",  no_args_is_help=True)
cases_app        = typer.Typer(help="Test case editor (MBT API v2)",        no_args_is_help=True)
modules_app      = typer.Typer(help="Module management (MBT API v2)",       no_args_is_help=True)
playlists_app    = typer.Typer(help="Playlist execution API",               no_args_is_help=True)
inventory_app    = typer.Typer(help="Inventory search API (v3)",            no_args_is_help=True)
simulations_app  = typer.Typer(help="Simulation files API",                 no_args_is_help=True)
blocks_app       = typer.Typer(help="Reuseable test step blocks (MBT API v2)", no_args_is_help=True)

app.add_typer(config_app,      name="config")
app.add_typer(identity_app,    name="identity")
app.add_typer(cases_app,       name="cases")
app.add_typer(modules_app,     name="modules")
app.add_typer(blocks_app,      name="blocks")
app.add_typer(playlists_app,   name="playlists")
app.add_typer(inventory_app,   name="inventory")
app.add_typer(simulations_app, name="simulations")

# ---------------------------------------------------------------------------
# Auth & HTTP client
# ---------------------------------------------------------------------------

class ToscaError(Exception):
    """Raised when the TOSCA Cloud API returns a non-2xx response."""
    def __init__(self, status: int, body: str):
        self.status = status
        self.body   = body
        super().__init__(f"HTTP {status}: {body}")


def _require_env(key: str, hint: str = "") -> str:
    val = os.getenv(key, "").strip()
    if not val:
        msg = f"[bold red]Error:[/bold red] {key} is not configured."
        if hint:
            msg += f"\n{hint}"
        console.print(msg)
        raise typer.Exit(1)
    return val


def _get_access_token() -> str:
    """
    Return a valid Bearer token.
    Caches the token in token.json (project directory) and refreshes when expired.
    Auth flow: OAuth2 client_credentials
      POST {TOSCA_TOKEN_URL}
      Body: client_id=...&client_secret=...&scope=tta&grant_type=client_credentials
    """
    # Check cached token
    if TOKEN_FILE.exists():
        try:
            cached = json.loads(TOKEN_FILE.read_text())
            # Leave a 60-second safety margin before expiry
            if cached.get("expires_at", 0) - time.time() > 60:
                return cached["access_token"]
        except Exception:
            pass

    token_url     = _require_env("TOSCA_TOKEN_URL",
        "Run: tosca config set --token-url <url>")
    client_id     = _require_env("TOSCA_CLIENT_ID",
        "Run: tosca config set --client-id <id>")
    client_secret = _require_env("TOSCA_CLIENT_SECRET",
        "Run: tosca config set --client-secret <secret>")
    scope         = os.getenv("TOSCA_SCOPE", "tta")
    verify_ssl    = os.getenv("TOSCA_VERIFY_SSL", "true").lower() != "false"
    timeout       = float(os.getenv("TOSCA_TIMEOUT", "30"))

    try:
        resp = httpx.post(
            token_url,
            data={
                "client_id":     client_id,
                "client_secret": client_secret,
                "scope":         scope,
                "grant_type":    "client_credentials",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=timeout,
            verify=verify_ssl,
        )
    except Exception as e:
        console.print(f"[bold red]Token request failed:[/bold red] {e}")
        raise typer.Exit(1)

    if resp.status_code >= 400:
        console.print(f"[bold red]Token request failed (HTTP {resp.status_code}):[/bold red]\n{resp.text[:400]}")
        raise typer.Exit(1)

    data         = resp.json()
    access_token = data.get("access_token", "")
    expires_in   = int(data.get("expires_in", 3600))

    TOKEN_FILE.write_text(json.dumps({
        "access_token": access_token,
        "expires_at":   time.time() + expires_in,
    }))
    TOKEN_FILE.chmod(0o600)   # owner-only read

    return access_token


class ToscaClient:
    """
    HTTP client for Tricentis TOSCA Cloud REST APIs.

    URL layout
    ----------
      Identity API   : {tenant_url}/_identity/api/v1/...
      MBT API (v2)   : {tenant_url}/{space_id}/_mbt/api/v2/builder/...
      Playlist API   : {tenant_url}/{space_id}/_playlists/api/v2/...
      Inventory API  : {tenant_url}/{space_id}/_inventory/api/v3/...
      Simulations API: {tenant_url}/{space_id}/_simulations/api/v1/...

      space_id = TOSCA_SPACE_ID env var, defaults to "default".
      The Identity API operates at the tenant level (no space_id prefix).
    """

    def __init__(self):
        self.tenant_url = _require_env(
            "TOSCA_TENANT_URL",
            "Run: tosca config set --tenant https://<tenant>.my.tricentis.com"
        ).rstrip("/")
        # TOSCA_SPACE_ID is the space identifier (often "default").
        # Falls back to TOSCA_WORKSPACE_ID for backwards compatibility.
        self.space_id = (
            os.getenv("TOSCA_SPACE_ID", "").strip()
            or os.getenv("TOSCA_WORKSPACE_ID", "").strip()
            or "default"
        )
        self.timeout    = float(os.getenv("TOSCA_TIMEOUT", "30"))
        self.verify_ssl = os.getenv("TOSCA_VERIFY_SSL", "true").lower() != "false"
        self._token: str | None = None

    def _bearer(self) -> str:
        if not self._token:
            self._token = _get_access_token()
        return self._token

    def _headers(self, accept: str = "application/json") -> dict:
        return {
            "Authorization": f"Bearer {self._bearer()}",
            "Content-Type":  "application/json",
            "Accept":        accept,
        }

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self.timeout, verify=self.verify_ssl)

    def _check(self, resp: httpx.Response) -> dict | list | str:
        if resp.status_code >= 400:
            raise ToscaError(resp.status_code, resp.text[:600])
        if not resp.content:
            return {}
        try:
            return resp.json()
        except Exception:
            return {"raw": resp.text}

    def get(self, url: str, params: dict | None = None) -> dict | list | str:
        with self._client() as c:
            return self._check(c.get(url, headers=self._headers(), params=params))

    def post(self, url: str, body: dict | list | None = None,
             params: dict | None = None) -> dict | list | str:
        with self._client() as c:
            return self._check(c.post(url, headers=self._headers(), json={} if body is None else body,
                                      params=params))

    def patch(self, url: str, body: list | dict) -> dict | list | str:
        with self._client() as c:
            return self._check(c.patch(url, headers=self._headers(), content=json.dumps(body, default=str)))

    def put(self, url: str, body: dict) -> dict | list | str:
        with self._client() as c:
            return self._check(c.put(url, headers=self._headers(), json=body))

    def delete(self, url: str) -> dict | list | str:
        with self._client() as c:
            return self._check(c.delete(url, headers=self._headers()))

    # ------------------------------------------------------------------
    # URL builders
    # ------------------------------------------------------------------

    def identity(self, path: str) -> str:
        """Identity API – no space_id prefix."""
        return f"{self.tenant_url}/_identity/api/v1/{path.lstrip('/')}"

    def mbt(self, path: str) -> str:
        """MBT/Builder API v2."""
        return f"{self.tenant_url}/{self.space_id}/_mbt/api/v2/builder/{path.lstrip('/')}"

    def playlist(self, path: str) -> str:
        """Playlist API v2."""
        return f"{self.tenant_url}/{self.space_id}/_playlists/api/v2/{path.lstrip('/')}"

    def inventory_url(self, path: str) -> str:
        """Inventory API v3."""
        return f"{self.tenant_url}/{self.space_id}/_inventory/api/v3/{path.lstrip('/')}"

    def inventory_v1_url(self, path: str) -> str:
        """Inventory API v1 (undocumented, used by the portal for folder operations)."""
        return f"{self.tenant_url}/{self.space_id}/_inventory/api/v1/{path.lstrip('/')}"

    def simulations_url(self, path: str) -> str:
        """Simulations API v1."""
        return f"{self.tenant_url}/{self.space_id}/_simulations/api/v1/{path.lstrip('/')}"

    def e2g_url(self, path: str) -> str:
        """E2G (Elastic Execution Grid) API – execution units, attachments, agent logs."""
        return f"{self.tenant_url}/{self.space_id}/_e2g/api/{path.lstrip('/')}"

    # ------------------------------------------------------------------
    # Identity API
    # ------------------------------------------------------------------

    def list_applications(self) -> list:
        """GET /_identity/api/v1/applications → ApplicationsViewV1.applications[]"""
        result = self.get(self.identity("applications"))
        if isinstance(result, list):
            return result
        return result.get("applications", [])

    def get_secrets(self, app_id: str) -> list:
        """GET /_identity/api/v1/applications/{id}/secrets → ClientSecretsViewV1.secrets[]"""
        result = self.get(self.identity(f"applications/{app_id}/secrets"))
        if isinstance(result, list):
            return result
        return result.get("secrets", [])

    def create_secret(self, app_id: str) -> dict:
        """POST /_identity/api/v1/applications/{id}/secrets"""
        result = self.post(self.identity(f"applications/{app_id}/secrets"))
        return result if isinstance(result, dict) else {}

    def delete_secret(self, app_id: str, secret_id: str) -> None:
        """DELETE /_identity/api/v1/applications/{id}/secrets/{secretId}"""
        self.delete(self.identity(f"applications/{app_id}/secrets/{secret_id}"))

    def get_secret(self, app_id: str, secret_id: str) -> dict:
        """GET /_identity/api/v1/applications/{id}/secrets/{secretId} → ClientSecretViewV1"""
        result = self.get(self.identity(f"applications/{app_id}/secrets/{secret_id}"))
        return result if isinstance(result, dict) else {}

    # ------------------------------------------------------------------
    # MBT API v2 – Test Cases
    # ------------------------------------------------------------------

    def get_case(self, case_id: str) -> dict:
        """GET /{spaceId}/_mbt/api/v2/builder/testCases/{id} → TestCaseV2"""
        result = self.get(self.mbt(f"testCases/{case_id}"))
        return result if isinstance(result, dict) else {}

    def create_case(self, name: str, description: str = "",
                    work_state: str = "Planned",
                    test_case_items: list | None = None,
                    config_params: list | None = None) -> dict:
        """
        POST /{spaceId}/_mbt/api/v2/builder/testCases
        Body: TestCaseV2 { name, description, workState, testCaseItems, testConfigurationParameters }
        Returns EntityDescriptorV2 { id, name, description, createdBy, createdAt, ... }
        WorkState enum: Planned | InWork | Completed
        """
        body: dict = {
            "name":                        name,
            "description":                 description,
            "workState":                   work_state,
            "testCaseItems":               test_case_items if test_case_items is not None else [],
            "testConfigurationParameters": config_params   if config_params   is not None else [],
        }
        result = self.post(self.mbt("testCases"), body)
        return result if isinstance(result, dict) else {}

    def delete_case(self, case_id: str) -> None:
        """DELETE /{spaceId}/_mbt/api/v2/builder/testCases/{id}  (→ 202)"""
        self.delete(self.mbt(f"testCases/{case_id}"))

    def update_case(self, case_id: str, case_body: dict) -> None:
        """
        PUT /{spaceId}/_mbt/api/v2/builder/testCases/{id}  (→ 204)
        Body: full TestCaseV2 object.
        Automatically strips the read-only 'version' field from the body before sending.
        """
        body = {k: v for k, v in case_body.items() if k != "version"}
        self.put(self.mbt(f"testCases/{case_id}"), body)

    def patch_case(self, case_id: str, operations: list) -> None:
        """
        PATCH /{spaceId}/_mbt/api/v2/builder/testCases/{id}  (→ 204)
        Body: JsonPatchDocument – bare array, lowercase op enum.
        """
        self.patch(self.mbt(f"testCases/{case_id}"), operations)

    # ------------------------------------------------------------------
    # MBT API v2 – Modules
    # ------------------------------------------------------------------

    def get_module(self, module_id: str) -> dict:
        """GET /{spaceId}/_mbt/api/v2/builder/modules/{id} → ModuleV2"""
        result = self.get(self.mbt(f"modules/{module_id}"))
        return result if isinstance(result, dict) else {}

    def create_module(self, name: str, description: str = "",
                      interface_type: str = "Gui") -> dict:
        """
        POST /{spaceId}/_mbt/api/v2/builder/modules
        Body: ModuleV2 { $type, name, description, interfaceType, attributes: [], parameters: [], attachments: [] }
        interfaceType enum: Gui | NonGui
        Returns 201 with empty body or EntityDescriptorV2.
        """
        body: dict = {
            "$type":         "ApiModuleV2",
            "name":          name,
            "description":   description,
            "interfaceType": interface_type,
            "attributes":    [],
            "parameters":    [],
            "attachments":   [],
        }
        result = self.post(self.mbt("modules"), body)
        return result if isinstance(result, dict) else {}

    def update_module(self, module_id: str, body: dict) -> dict:
        """
        PUT /{spaceId}/_mbt/api/v2/builder/modules/{id}
        Full replacement of a module — body must include id, name, attributes[].
        Automatically strips the read-only 'version' field from the body before sending.
        Returns updated ModuleV2.
        """
        cleaned = {k: v for k, v in body.items() if k != "version"}
        result = self.put(self.mbt(f"modules/{module_id}"), cleaned)
        return result if isinstance(result, dict) else {}

    def delete_module(self, module_id: str) -> None:
        """DELETE /{spaceId}/_mbt/api/v2/builder/modules/{id}  (→ 202)"""
        self.delete(self.mbt(f"modules/{module_id}"))

    # ------------------------------------------------------------------
    # MBT API v2 – Reuseable Test Step Blocks
    # ------------------------------------------------------------------

    def get_block(self, block_id: str) -> dict:
        """GET /{spaceId}/_mbt/api/v2/builder/reuseableTestStepBlocks/{id} → ReuseableTestStepBlockV2"""
        result = self.get(self.mbt(f"reuseableTestStepBlocks/{block_id}"))
        return result if isinstance(result, dict) else {}

    def update_block(self, block_id: str, block_body: dict) -> None:
        """
        PUT /{spaceId}/_mbt/api/v2/builder/reuseableTestStepBlocks/{id}  (→ 204)
        Automatically strips the read-only 'version' field from the body before sending.
        """
        body = {k: v for k, v in block_body.items() if k != "version"}
        self.put(self.mbt(f"reuseableTestStepBlocks/{block_id}"), body)

    def add_block_parameter(self, block_id: str, name: str, description: str = "",
                            value_range: list | None = None) -> str:
        """
        Add a new businessParameter to an existing ReuseableTestStepBlock.
        Fetches the block via GET, appends the parameter with a fresh ULID, then PUTs it back.
        Returns the new parameter's ID (ULID string).
        """
        block = self.get_block(block_id)
        params = block.get("businessParameters", [])
        new_id = _generate_ulid()
        new_param: dict = {"id": new_id, "name": name, "description": description}
        if value_range is not None:
            new_param["valueRange"] = value_range
        params.append(new_param)
        block["businessParameters"] = params
        self.update_block(block_id, block)
        return new_id

    def update_block_param_range(self, block_id: str, param_name: str,
                                 value_range: list[str]) -> None:
        """
        Update the valueRange of an existing businessParameter (matched by name).
        Fetches the block, patches the named param's valueRange, then PUTs it back.
        Raises ValueError if the parameter name is not found.
        """
        block = self.get_block(block_id)
        params = block.get("businessParameters", [])
        found = False
        for p in params:
            if p.get("name") == param_name:
                p["valueRange"] = value_range
                found = True
                break
        if not found:
            raise ValueError(f"Parameter '{param_name}' not found in block {block_id}")
        block["businessParameters"] = params
        self.update_block(block_id, block)

    def delete_block(self, block_id: str) -> None:
        """DELETE /{spaceId}/_mbt/api/v2/builder/reuseableTestStepBlocks/{id}  (→ 202/204)"""
        self.delete(self.mbt(f"reuseableTestStepBlocks/{block_id}"))

    # ------------------------------------------------------------------
    # Playlist API v2 – Playlists
    # ------------------------------------------------------------------

    def list_playlists(self, search: str | None = None, limit: int = 50) -> list:
        """
        GET /{spaceId}/_playlists/api/v2/playlists → DocumentSearchResponseV1OfPlaylistV1.items[]
        """
        params: dict = {"itemsPerPage": limit}
        if search:
            params["name"] = search
        result = self.get(self.playlist("playlists"), params=params)
        if isinstance(result, list):
            return result
        return result.get("items", [])

    def get_playlist(self, playlist_id: str) -> dict:
        """GET /{spaceId}/_playlists/api/v2/playlists/{id} → PlaylistV1"""
        result = self.get(self.playlist(f"playlists/{playlist_id}"))
        return result if isinstance(result, dict) else {}

    def create_playlist(self, name: str, description: str = "",
                        run_mode: str = "parallel",
                        items: list | None = None,
                        parameters: list | None = None,
                        characteristics: list | None = None,
                        cron_schedule: str | None = None,
                        upload_recordings: bool | None = None) -> dict:
        """
        POST /{spaceId}/_playlists/api/v2/playlists
        Body: PlaylistCreationInputV1 { name, description, runMode, items, parameters,
              characteristics, cronSchedule, uploadRecordingsOnSuccess }
        RunMode enum: parallel | sequential | sequentialOnSameAgent
        Returns PlaylistV1.
        """
        body: dict = {"name": name, "runMode": run_mode}
        if description:
            body["description"] = description
        if items:
            body["items"] = items
        if parameters:
            body["parameters"] = parameters
        if characteristics:
            body["characteristics"] = characteristics
        if cron_schedule:
            body["cronSchedule"] = cron_schedule
        if upload_recordings is not None:
            body["uploadRecordingsOnSuccess"] = upload_recordings
        result = self.post(self.playlist("playlists"), body)
        return result if isinstance(result, dict) else {}

    def update_playlist(self, playlist_id: str, name: str, description: str = "",
                        run_mode: str = "parallel",
                        items: list | None = None,
                        parameters: list | None = None,
                        characteristics: list | None = None,
                        cron_schedule: str | None = None,
                        upload_recordings: bool | None = None) -> None:
        """
        PUT /{spaceId}/_playlists/api/v2/playlists/{id}  (→ 204)
        Body: same schema as create (PlaylistCreationInputV1).
        """
        body: dict = {"name": name, "runMode": run_mode}
        if description:
            body["description"] = description
        if items:
            body["items"] = items
        if parameters:
            body["parameters"] = parameters
        if characteristics:
            body["characteristics"] = characteristics
        if cron_schedule:
            body["cronSchedule"] = cron_schedule
        if upload_recordings is not None:
            body["uploadRecordingsOnSuccess"] = upload_recordings
        self.put(self.playlist(f"playlists/{playlist_id}"), body)

    def delete_playlist(self, playlist_id: str) -> None:
        """DELETE /{spaceId}/_playlists/api/v2/playlists/{id}  (→ 202)"""
        self.delete(self.playlist(f"playlists/{playlist_id}"))

    # ------------------------------------------------------------------
    # Playlist API v2 – Playlist Runs
    # ------------------------------------------------------------------

    def run_playlist(self, playlist_id: str, private: bool = False,
                     parameter_overrides: list[dict] | None = None) -> dict:
        """
        POST /{spaceId}/_playlists/api/v2/playlistRuns
        Body: PlaylistRunCreationInputV1 { playlistId, private,
              parameterOverrides: [{ name, value? }] }
        Returns: PlaylistRunCreationOutputV1 { id }
        """
        body: dict = {
            "playlistId":         playlist_id,
            "private":            private,
            "parameterOverrides": parameter_overrides or [],
        }
        result = self.post(self.playlist("playlistRuns"), body)
        return result if isinstance(result, dict) else {}

    def get_run_status(self, run_id: str) -> dict:
        """
        GET /{spaceId}/_playlists/api/v2/playlistRuns/{id}
        Returns PlaylistRunV1 { id, playlistId, playlistName, private, createdAt,
                                updatedAt, createdBy, state, executionId }
        RunStateV1 (lowercase): pending | running | canceling | succeeded | failed | canceled | unknown
        """
        result = self.get(self.playlist(f"playlistRuns/{run_id}"))
        return result if isinstance(result, dict) else {}

    def cancel_run(self, run_id: str, reason: str = "", hard_cancel: bool = False) -> None:
        """
        POST /{spaceId}/_playlists/api/v2/playlistRuns/{id}:cancel
        Body: PlaylistRunCancellationRequestV1 { reason, hardCancel }
        """
        body: dict = {"reason": reason, "hardCancel": hard_cancel}
        self.post(self.playlist(f"playlistRuns/{run_id}:cancel"), body)

    def delete_run(self, run_id: str) -> None:
        """DELETE /{spaceId}/_playlists/api/v2/playlistRuns/{id}  (→ 202)"""
        self.delete(self.playlist(f"playlistRuns/{run_id}"))

    def list_runs(self, limit: int = 50) -> dict:
        """
        GET /{spaceId}/_playlists/api/v2/playlistRuns
        Returns DocumentSearchResponseV1OfPlaylistRunV1 with items[], nextPageToken.
        """
        result = self.get(self.playlist("playlistRuns"), params={"itemsPerPage": limit})
        return result if isinstance(result, dict) else {"items": result}

    def get_run_junit(self, run_id: str) -> dict:
        """
        GET /{spaceId}/_playlists/api/v2/playlistRuns/{id}/junit
        Returns TestSuitesV1 as JSON (not XML):
          { tests, failures, errors, disabled, timeInSeconds,
            testSuiteElements: [{ name, tests, failures, errors, testCases: [
              { name, className, status, timeInSeconds, failure, error, skipped }
            ] }] }
        """
        result = self.get(self.playlist(f"playlistRuns/{run_id}/junit"))
        return result if isinstance(result, dict) else {}

    def list_test_case_runs(self, run_id: str, limit: int = 100) -> list:
        """
        GET /{spaceId}/_playlists/api/v2/testCaseRuns?playlistRunId={run_id}
        Returns DocumentSearchResponseV1OfTestCaseRunV1.items[]
        """
        result = self.get(
            self.playlist("testCaseRuns"),
            params={"playlistRunId": run_id, "itemsPerPage": limit},
        )
        if isinstance(result, list):
            return result
        return result.get("items", [])

    # ------------------------------------------------------------------
    # E2G API – execution units, attachments, agent logs
    # ------------------------------------------------------------------

    def get_execution(self, execution_id: str) -> dict:
        """
        GET /{spaceId}/_e2g/api/executions/{executionId}
        Returns ExecutionV1 { id, name, items: [UnitV1{ id, name, runner, state, ... }],
                              executionMode, state, createdAt, ... }.
        executionId comes from PlaylistRunV1.executionId — NOT the playlist run's own id.
        """
        result = self.get(self.e2g_url(f"executions/{execution_id}"))
        return result if isinstance(result, dict) else {}

    def list_unit_attachments(self, execution_id: str, unit_id: str) -> list:
        """
        GET /{spaceId}/_e2g/api/executions/{executionId}/units/{unitId}/attachments
        Returns [{ name, fileExtension, contentDownloadUri, appendUri, ... }].
        contentDownloadUri is a SAS-signed Azure Blob URL (TTL ~30 min, no Authorization header needed).
        Standard names: 'logs' (txt), 'JUnit' (xml), 'TBoxResults' (tas), 'TestSteps' (json),
        'Recording' (mp4 — only when recorded).
        """
        result = self.get(self.e2g_url(f"executions/{execution_id}/units/{unit_id}/attachments"))
        return result if isinstance(result, list) else []

    def download_blob(self, sas_url: str) -> bytes:
        """
        GET <sas_url> with NO Authorization header — the SAS signature is the auth.
        Returns the raw blob content.
        """
        with httpx.Client(timeout=self.timeout, verify=self.verify_ssl) as c:
            resp = c.get(sas_url)
            if resp.status_code >= 400:
                raise ToscaError(resp.status_code, resp.text[:600])
            return resp.content

    # ------------------------------------------------------------------
    # Inventory API v3
    # ------------------------------------------------------------------

    def search_inventory(self, query: str, artifact_type: str | None = None,
                         limit: int = 50, include_ancestors: bool = False,
                         folder_id: str | None = None) -> list:
        """
        POST /{spaceId}/_inventory/api/v3/artifacts[/{type}]/search
        Body: DocumentSearchRequestV1 {
          filter: { items: [{ field, value, operator }], linkOperator },
          sort: [],
          itemsPerPage,
          pageToken
        }
        Returns DocumentSearchResponseV1OfArtifactV3.items[]

        Filter operator/linkOperator: despite the swagger showing PascalCase enum values
        (SearchFilterOperatorV1: "Contains", SearchFilterLinkOperatorV1: "And"), the live API
        only accepts lowercase: "contains", "and" — live-tested, PascalCase returns 0 results.
        includeAncestors: passed as query param, populates ancestors[] on each result.
        """
        if artifact_type:
            url = self.inventory_url(f"artifacts/{artifact_type}/search")
        else:
            url = self.inventory_url("artifacts/search")
        params = {"includeAncestors": "true"} if include_ancestors else None

        body: dict = {
            "filter": {
                "items": [
                    {"field": "name", "value": query, "operator": "contains"}
                ] if query else [],
                "linkOperator": "and",
            },
            "sort":         [],
            "itemsPerPage": limit,
        }
        result = self.post(url, body, params=params)
        items = result if isinstance(result, list) else result.get("items", [])
        if folder_id:
            suffix = f"|{folder_id}"
            items = [i for i in items if str(i.get("folderKey", "")).endswith(suffix)]
        return items

    def get_inventory_artifact(self, artifact_type: str, entity_id: str,
                               include_ancestors: bool = False) -> dict:
        """
        GET /{spaceId}/_inventory/api/v3/artifacts/{type}/{entityId}
        Returns ArtifactV3 { id: {type, entityId, spaceId, section},
                             name, description, createdAt, createdBy, updatedAt,
                             tags, assignees, source, attributes, folderKey, ancestors }
        includeAncestors=True populates the ancestors[] breadcrumb array.
        """
        params = {"includeAncestors": "true"} if include_ancestors else None
        result = self.get(self.inventory_url(f"artifacts/{artifact_type}/{entity_id}"),
                          params=params)
        return result if isinstance(result, dict) else {}

    def move_to_folder(self, artifacts: list[dict], folder_entity_id: str | None) -> None:
        """
        Move one or more inventory artifacts into a folder (or to root if folder_entity_id is None).

        Uses the undocumented v1 folders/artifacts endpoint that the portal uses:
          PUT /{spaceId}/_inventory/api/v1/folders/artifacts
          Body: { "artifacts": [<ArtifactIdV3>, ...], "parentFolderId": "<entityId>" }

        Each artifact is an id object: {"type": ..., "entityId": ..., "spaceId": ..., "section": ...}
        To build one from a search/get result: artifact.get("id")
        """
        body: dict = {"artifacts": artifacts}
        if folder_entity_id is not None:
            body["parentFolderId"] = folder_entity_id
        self.put(self.inventory_v1_url("folders/artifacts"), body)

    def create_folder(self, name: str, parent_folder_id: str | None = None,
                      description: str = "", tags: list | None = None) -> dict:
        """
        POST /{spaceId}/_inventory/api/v1/folders
        Undocumented v1 portal API.  Returns the new folder object (has .key.entityId).
        """
        body: dict = {"name": name, "description": description, "tags": tags or []}
        if parent_folder_id:
            body["parentFolderId"] = parent_folder_id
        result = self.post(self.inventory_v1_url("folders"), body)
        return result if isinstance(result, dict) else {}

    def rename_folder(self, folder_id: str, new_name: str) -> dict:
        """
        PATCH /{spaceId}/_inventory/api/v1/folders/{folderId}
        Undocumented v1 portal API.  Sends a JSON Patch array.
        """
        result = self.patch(
            self.inventory_v1_url(f"folders/{folder_id}"),
            [{"op": "replace", "path": "/name", "value": new_name}],
        )
        return result if isinstance(result, dict) else {}

    def delete_folder(self, folder_id: str, child_behavior: str = "moveToParent") -> None:
        """
        DELETE /{spaceId}/_inventory/api/v1/folders/{folderId}
        Undocumented v1 portal API.
        child_behavior: 'moveToParent' (default, ungroup) | 'deleteRecursively' | 'abort'
        """
        url = self.inventory_v1_url(f"folders/{folder_id}")
        with self._client() as cl:
            self._check(cl.delete(url, headers=self._headers(),
                                  json={"childBehavior": child_behavior}))

    def get_folder_ancestors(self, folder_id: str) -> list:
        """
        GET /{spaceId}/_inventory/api/v1/folders/{folderId}/ancestors
        Undocumented v1 portal API.  Returns an array of ancestor objects.
        """
        url = self.inventory_v1_url(f"folders/{folder_id}/ancestors")
        with self._client() as cl:
            r = cl.get(url, headers=self._headers())
            self._check(r)
            data = r.json()
            return data if isinstance(data, list) else []

    def list_folder_tree(self, folder_ids: list[str] | None = None) -> list:
        """
        POST /{spaceId}/_inventory/api/v1/folders/tree-items
        Undocumented v1 portal API used by the folder picker.
        Body: a bare JSON array of PARENT folder IDs whose children you want.
        Pass [] for the request to succeed — the server returns [] if no matching parents.
        Pass parent IDs to get their direct child folders.
        NB: `body or {}` bug in post() was fixed to `{} if body is None else body`
            so that an empty list [] is sent as-is rather than defaulting to {}.
        Returns a flat list of folder tree items.
        """
        body = folder_ids if folder_ids else []
        result = self.post(self.inventory_v1_url("folders/tree-items"), body)
        return result if isinstance(result, list) else []

    def export_tsu(self, test_case_ids: list[str],
                   module_ids: list[str] | None = None,
                   block_ids: list[str] | None = None) -> bytes:
        """
        POST /{spaceId}/_mbt/api/v2/builder/tsu/exports
        Body: TsuExportRequestV2 {
          testCaseIds: [str],
          moduleIds: [str],
          reusableTestStepBlockIds: [str]   ← correct spelling (no double-e); different from
                                              the API PATH which uses reuseeable (typo)
        }
        Returns the raw bytes of the .tsu file.
        """
        url = self.mbt("tsu/exports")
        body: dict = {"testCaseIds": test_case_ids}
        if module_ids:
            body["moduleIds"] = module_ids
        if block_ids:
            body["reusableTestStepBlockIds"] = block_ids
        with self._client() as cl:
            r = cl.post(url, headers=self._headers(), json=body)
            self._check(r)
            return r.content

    def import_tsu(self, file_path: str) -> None:
        """
        POST /{spaceId}/_mbt/api/v2/builder/tsu/imports
        Undocumented MBT API that imports test cases from a .tsu file.
        Sends the file as multipart/form-data.
        """
        url = self.mbt("tsu/imports")
        hdrs = {k: v for k, v in self._headers().items() if k.lower() != "content-type"}
        with open(file_path, "rb") as f:
            with self._client() as cl:
                r = cl.post(url, headers=hdrs,
                            files={"file": (os.path.basename(file_path), f,
                                            "application/octet-stream")})
                self._check(r)

    def patch_inventory_artifact(self, artifact_type: str, entity_id: str,
                                  folder_key: str | None = None,
                                  tags: list | None = None) -> dict:
        """
        PATCH /{spaceId}/_inventory/api/v3/artifacts/{type}/{entityId}
        Body: JsonPatch wrapper object  {"operations": [PatchOperation]}
        OperationType enum is PascalCase: Add|Remove|Replace|Move|Copy|Test  (per swagger).
        Path is RFC6901 string.  folderKey is read-only — use inventory move to change folder.
        NOTE: newly created MBT artifacts take a few seconds to be indexed by
              Inventory, so this may return 404 if called immediately after creation.
        """
        operations = []
        if folder_key is not None:
            operations.append({"op": "Replace", "path": "/folderKey", "value": folder_key})
        if tags is not None:
            clean_tags = [{"value": t["value"], "style": t.get("style", "simple")}
                          for t in tags if "value" in t]
            operations.append({"op": "Replace", "path": "/tags", "value": clean_tags})
        if not operations:
            return {}
        # Inventory v3 PATCH uses a wrapper object {"operations": [...]}, NOT a bare array.
        # (contrast with MBT builder PATCH which uses a bare array — they are different APIs)
        result = self.patch(
            self.inventory_url(f"artifacts/{artifact_type}/{entity_id}"),
            {"operations": operations},
        )
        return result if isinstance(result, dict) else {}

    # ------------------------------------------------------------------
    # Simulations API v1
    # ------------------------------------------------------------------

    def list_simulation_files(self, file_tags: list[str] | None = None) -> list:
        """
        GET /{spaceId}/_simulations/api/v1/files
        Returns array of FileDetailsV1 { id, name, sizeInKB, createdAt, updatedAt, fileTags, components }
        """
        params: dict = {}
        if file_tags:
            params["fileTags"] = file_tags
        result = self.get(self.simulations_url("files"), params=params)
        # PaginatedFilesV1 uses "files" key (not "items")
        return result if isinstance(result, list) else result.get("files", [])

    def get_simulation_file(self, file_id: str) -> dict:
        """GET /{spaceId}/_simulations/api/v1/files/{id} → FileDetailsV1"""
        result = self.get(self.simulations_url(f"files/{file_id}"))
        return result if isinstance(result, dict) else {}

    def create_simulation_file(self, name: str, content_base64: str,
                               file_tags: list[str] | None = None,
                               components: list[str] | None = None) -> dict:
        """
        POST /{spaceId}/_simulations/api/v1/files
        Body: FileUploadV1 { content: <base64>, name, fileTags?, components? }
        components enum values: Services | Runnables | Connections | Resources | Includes | Templates
        Returns FileDetailsV1.
        """
        body: dict = {"name": name, "content": content_base64}
        if file_tags:
            body["fileTags"] = file_tags
        if components:
            body["components"] = components
        result = self.post(self.simulations_url("files"), body)
        return result if isinstance(result, dict) else {}

    def delete_simulation_file(self, file_id: str) -> None:
        """DELETE /{spaceId}/_simulations/api/v1/files/{id}  (→ 202)"""
        self.delete(self.simulations_url(f"files/{file_id}"))


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def _output_json(data: dict | list) -> None:
    raw = json.dumps(data, indent=2, default=str)
    if sys.stdout.isatty():
        console.print(Syntax(raw, "json", theme="monokai", line_numbers=False))
    else:
        print(raw)


def _table(title: str, columns: list[str], rows: list[list]) -> Table:
    t = Table(title=title, show_header=True, header_style="bold cyan",
              border_style="grey42", show_lines=True)
    for col in columns:
        t.add_column(col)
    for row in rows:
        t.add_row(*[str(c) if c is not None else "" for c in row])
    return t


def _exit_err(msg: str) -> None:
    console.print(f"[bold red]Error:[/bold red] {msg}")
    raise typer.Exit(1)


_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _generate_ulid() -> str:
    """
    Generate a ULID (Universally Unique Lexicographically Sortable Identifier)
    using Crockford base32 encoding.

    Format: 10 timestamp chars + 16 random chars = 26-char string.
    Required by the MBT API when adding new businessParameters or parameterLayerIds.
    """
    ts = int(time.time() * 1000)
    t_chars: list[str] = []
    for _ in range(10):
        t_chars.append(_CROCKFORD[ts & 0x1F])
        ts >>= 5
    t_chars.reverse()
    r_chars = [random.choice(_CROCKFORD) for _ in range(16)]
    return "".join(t_chars + r_chars)


# ---------------------------------------------------------------------------
# Shared mutation helpers
#
# These encode the discipline from CLAUDE.md / SKILL.md:
#
#   * "Auto-confirm every write" — after PUT/PATCH, GET the artifact and assert
#     `version` bumped (and, when we know the expected value, that the field
#     actually changed). MBT PATCH silently accepts and drops unsupported ops;
#     Inventory v3 silently ignores MBT-shape bodies — HTTP 204/"✓" are NOT
#     proof of success.
#   * "Name-based disambiguation" — name-only lookups error with a listing +
#     require `--index N` to resolve when multiple items match, so shortcut
#     commands never silently pick the wrong folder/step/attribute.
#   * "JS dynamic-value lint" — `{`, `"`, `[` at the root of an Execute /
#     Verify JavaScript value silently breaks the step; warn before landing.
#   * "ID policy" — TestStepV2.id and testStepValues[].id are UUIDs (not
#     ULIDs). ULIDs are only correct for block businessParameter.id and
#     parameterLayerId.
# ---------------------------------------------------------------------------

import uuid as _uuid

_JS_ROOT_TRAPS = ("{", '"', "[")


def _fresh_uuid() -> str:
    """UUID4 string for TestStepV2.id / testStepValues[].id (NOT a ULID)."""
    return str(_uuid.uuid4())


def _lint_js_value(value: str, *, abort: bool = False) -> None:
    """
    Warn (or error) when a JS value starts with a char that TBox's dynamic-value
    parser treats as a delimiter: `{`, `"`, `[`. These are silent no-op traps
    documented in CLAUDE.md / standard-modules.md.
    """
    if not isinstance(value, str):
        return
    stripped = value.lstrip()
    if not stripped:
        return
    first = stripped[0]
    if first in _JS_ROOT_TRAPS:
        msg = (
            f"JS value starts with '{first}' — TBox's dynamic-value parser will "
            f"silently treat this as a delimiter and break the step. "
            f"Rewrite with a `var`/ternary form or use single quotes."
        )
        if abort:
            _exit_err(msg)
        console.print(f"[yellow]⚠ JS lint:[/yellow] {msg}")


def _find_by_name(items: list, name: str, *, label: str,
                  index: Optional[int] = None, key: str = "name") -> tuple[int, dict]:
    """
    Locate one entry in `items` whose `[key]` equals `name`.

    * 0 matches → error listing all available names.
    * 1 match → return (idx, item).
    * >1 matches → if `index` provided, return that one; otherwise error with
      enumerated listing.
    """
    matches = [(i, it) for i, it in enumerate(items) if it.get(key) == name]
    if not matches:
        available = [it.get(key, "?") for it in items]
        _exit_err(
            f"No {label} named '{name}'. Available: {available}"
        )
    if len(matches) == 1:
        return matches[0]
    if index is None:
        listing = "\n".join(
            f"  [{i}] {it.get(key)}" + (f"  ($type={it.get('$type')})" if it.get("$type") else "")
            for i, it in matches
        )
        _exit_err(
            f"Multiple {label}s named '{name}' — disambiguate with --{label.replace(' ', '-')}-index N:\n{listing}"
        )
    for i, it in matches:
        if i == index:
            return (i, it)
    _exit_err(
        f"--index {index} does not match any '{name}' {label}. Indices are: "
        f"{[i for i, _ in matches]}"
    )
    return matches[0]  # unreachable


def _confirm_version_bump(fresh: dict, prior_version, *, label: str) -> None:
    """Assert that a follow-up GET shows `version` moved past `prior_version`."""
    now_v = fresh.get("version")
    if prior_version is None:
        console.print(f"[yellow]⚠[/yellow] {label}: no prior version known — cannot confirm bump (fresh version={now_v})")
        return
    if now_v == prior_version:
        _exit_err(
            f"{label}: write did NOT land — version unchanged ({now_v}). "
            f"MBT PATCH may have silently dropped the op; fall back to full PUT."
        )
    console.print(f"[green]✓ confirmed[/green] {label} version {prior_version} → {now_v}")


def _confirm_field(fresh: dict, path: list, expected, *, label: str) -> None:
    """Walk a path of keys/indices into `fresh` and assert the leaf equals `expected`."""
    node = fresh
    trail = []
    for p in path:
        trail.append(str(p))
        try:
            node = node[p]
        except (KeyError, IndexError, TypeError):
            _exit_err(f"{label}: confirm-GET could not resolve path /{'/'.join(trail)} — write may have been dropped.")
    if node != expected:
        _exit_err(
            f"{label}: field at /{'/'.join(trail)} is {node!r} after write (expected {expected!r}) "
            f"— the server did not apply the change."
        )
    console.print(f"[green]✓ confirmed[/green] {label} /{'/'.join(trail)} = {expected!r}")


def _parse_kv_pairs(pairs: Optional[List[str]]) -> dict:
    """Turn a list of 'k=v' strings into a dict (for CLI --param flags)."""
    out: dict = {}
    for raw in pairs or []:
        if "=" not in raw:
            _exit_err(f"Expected key=value pair, got: {raw!r}")
        k, v = raw.split("=", 1)
        out[k.strip()] = v
    return out


# ---------------------------------------------------------------------------
# Tenant-verified standard-module catalog
#
# All GUIDs below were validated on this tenant via
#   GET /packages/<pkg>/modules/<moduleGuid>
# Re-verify (one-off) by running:
#   python -c "import sys;sys.path.insert(0,'.');from tosca_cli import ToscaClient;\
#     c=ToscaClient();import json;print(json.dumps(c.get(c.mbt('packages/Html/modules/<guid>')),indent=2))"
#
# Caveats this catalog encodes so you do NOT rediscover them the hard way:
#   * Wait lives in the Timing package (NOT Html).
#   * OpenUrl / CloseBrowser / Wait run through `engine: Framework`;
#     Execute JS / Verify JS Result run through `engine: Html`.
#   * Verify JS Result's Search Criteria has nested Title/Url/WindowIndex/
#     UseActiveTab sub-attrs in the MODULE schema, but in step JSON they are
#     referenced FLAT at the testStepValues root by their leaf IDs.
#   * CloseBrowser takes a Title *pattern* (wildcards supported) — it does
#     NOT accept the raw window URL.
# ---------------------------------------------------------------------------

_STD_MODULES: dict = {
    "open-url": {
        "display":     "OpenUrl",
        "module_id":   "9f8d14b3-7651-4add-bcfe-341a996662cc",
        "package":     "Html",
        "engine":      "Framework",
        "is_rescan":   False,
        "attrs": {
            "Url":              "39e342b2-960b-2251-d1b9-5b340c12fa19",
            "UseActiveTab":     "39ef3b0d-1ee2-a137-d5d3-976be1b8c766",
            "ForcePageSwitch":  "deaad6b0-32d2-4c60-a682-40e30540e3d9",
            "BrowserArguments": "39f50026-d22f-265c-6c17-b85f8fde68a6",
        },
        "value_ranges": {
            "UseActiveTab":    ["True", "False"],
            "ForcePageSwitch": ["True", "False"],
        },
        "defaults":    {"UseActiveTab": "False", "ForcePageSwitch": "True"},
        "required":    ["Url"],
    },
    "close-browser": {
        "display":     "CloseBrowser",
        "module_id":   "3019e887-48ca-4a7e-8759-79e7762c6152",
        "package":     "Html",
        "engine":      "Framework",
        "is_rescan":   False,
        "attrs":       {"Title": "39e342b2-958e-3e2f-7c85-29871c23f1dc"},
        "defaults":    {},
        "required":    ["Title"],
    },
    "wait": {
        "display":     "TBox Wait",
        "module_id":   "80b7982e-0e10-4bc0-bdf3-6bc04503fd63",
        "package":     "Timing",
        "engine":      "Framework",
        "is_rescan":   False,
        "attrs":       {"Duration": "39e342b2-958e-ba1f-bb58-702e193d6016"},
        "defaults":    {},
        "required":    ["Duration"],
    },
    "execute-js": {
        "display":     "Execute JavaScript",
        "module_id":   "54f432f6-61ed-4c9a-a7dc-9e3970a08323",
        "package":     "Html",
        "engine":      "Html",
        "is_rescan":   False,
        "attrs": {
            "Search Criteria": "3a083bf5-d96f-6330-697e-24f495d04dc2",
            "JavaScript":      "39e342b2-960b-6374-ecab-25712ac9f14d",
        },
        "defaults":    {},
        "required":    ["JavaScript"],
        "lint_js":     ["JavaScript"],
    },
    "verify-js": {
        "display":     "Verify JavaScript Result",
        "module_id":   "a9cc198f-ae01-4665-ac02-5000d6b0c7de",
        "package":     "Html",
        "engine":      "Html",
        "is_rescan":   False,
        "attrs": {
            # Flat shape observed in actual test-case JSON on this tenant.
            # The module schema nests Title/Url/WindowIndex/UseActiveTab under
            # Search Criteria, but the step references them directly by their
            # leaf IDs at the testStepValues root.
            "Title":            "39f104f4-1216-105a-c308-1a054521d1aa",
            "Url":               "3a083bf9-4e50-358e-54f9-b079b72465ed",
            "Window Index":      "3a083bf9-4e50-3217-15f8-4668d92d5278",
            "UseActiveTab":      "d754bb56-4c61-4426-993e-9f0c89df9d9a",
            "JavaScript":        "39f104f4-1216-6d89-dc84-34f8c5248700",
            "Result":            "39f104f4-1216-d3a0-58ed-22b074106709",
        },
        "value_ranges": {"UseActiveTab": ["True", "False"]},
        "data_types":   {"UseActiveTab": "Boolean"},
        "action_modes": {"Result": "Verify"},
        "defaults":     {"UseActiveTab": "True"},
        "required":     ["JavaScript", "Result"],
        "lint_js":      ["JavaScript"],
    },
}


def _build_std_step(
    kind:   str,
    values: dict,
    *,
    name:   Optional[str] = None,
    lint:   bool          = True,
) -> dict:
    """
    Build a fresh TestStepV2 object for a tenant-verified standard module.

    * ``kind`` must be a key in ``_STD_MODULES`` (open-url / close-browser /
      wait / execute-js / verify-js).
    * ``values`` maps attribute names → desired values. Unknown attrs error.
      Missing ``required`` attrs error. ``defaults`` fill in for flags the
      caller did not explicitly set.
    * ``lint`` (default True) runs :func:`_lint_js_value` on each attribute
      listed under the module's ``lint_js`` list.

    The returned dict has fresh UUIDs for the step and every testStepValue
    — it can be inserted into any folder's ``items`` list.
    """
    spec = _STD_MODULES.get(kind)
    if spec is None:
        _exit_err(
            f"Unknown standard step kind {kind!r}. Available: "
            f"{sorted(_STD_MODULES)}"
        )
    # Reject unknown attrs early — catches typos like 'url' vs 'Url'.
    unknown = [k for k in values if k not in spec["attrs"]]
    if unknown:
        _exit_err(
            f"{spec['display']}: unknown attribute(s) {unknown}. "
            f"Available: {sorted(spec['attrs'])}"
        )
    # Merge in defaults only for attrs the caller did not set explicitly.
    merged = dict(spec.get("defaults", {}))
    merged.update(values)
    # Enforce required attrs.
    missing = [r for r in spec.get("required", []) if r not in merged]
    if missing:
        _exit_err(
            f"{spec['display']}: missing required attribute(s) {missing}. "
            f"Pass them in --values."
        )
    if lint:
        for k in spec.get("lint_js", []):
            if k in merged:
                _lint_js_value(str(merged[k]))

    pkg_ref   = {"id": spec["package"], "type": "Standard"}
    tsv_list: list = []
    for attr_name, val in merged.items():
        attr_id   = spec["attrs"][attr_name]
        data_type = spec.get("data_types", {}).get(attr_name, "String")
        action    = spec.get("action_modes", {}).get(attr_name, "Input")
        meta: dict = {"businessType": "", "isUsedAsIdentification": False}
        if attr_name in spec.get("value_ranges", {}):
            meta["valueRange"] = spec["value_ranges"][attr_name]
        tsv_list.append({
            "id":            _fresh_uuid(),
            "name":          attr_name,
            "value":         str(val),
            "actionMode":    action,
            "dataType":      data_type,
            "actionProperty": "",
            "operator":      "Equals",
            "moduleAttributeReference": {
                "id":               attr_id,
                "moduleId":         spec["module_id"],
                "packageReference": pkg_ref,
                "metadata":         meta,
            },
            "subValues":     [],
            "disabled":      False,
        })
    return {
        "$type":            "TestStepV2",
        "id":               _fresh_uuid(),
        "name":             name or spec["display"],
        "disabled":         False,
        "moduleReference": {
            "id":               spec["module_id"],
            "packageReference": pkg_ref,
            "metadata": {
                "isRescanEnabled": spec["is_rescan"],
                "engine":          spec["engine"],
            },
        },
        "testStepValues":   tsv_list,
    }


def _build_std_folder(name: str, items: Optional[list] = None) -> dict:
    """Build a top-level TestStepFolderV2 (the 4-folder pattern's building block)."""
    return {
        "$type":    "TestStepFolderV2",
        "id":       _fresh_uuid(),
        "name":     name,
        "disabled": False,
        "items":    items or [],
    }


def _playlist_items_to_input(raw_items: list) -> list:
    """
    Reshape items returned by `GET /playlists/{id}` (TestCaseV1) into the
    `InputTestCaseV1` shape that the PUT endpoint demands.

    Only `sourceId`, `disabled`, `parameters`, `characteristics` survive —
    everything else is server-managed and must not be echoed back. Matches
    the shape already used by `playlists set-characteristic`.
    """
    out: list = []
    for item in raw_items or []:
        if item.get("$type") not in ("TestCaseV1", "InputTestCaseV1"):
            continue
        entry: dict = {
            "$type":    "InputTestCaseV1",
            "sourceId": item.get("sourceId", ""),
            "disabled": item.get("disabled", False),
        }
        if item.get("parameters"):
            entry["parameters"] = item["parameters"]
        if item.get("characteristics"):
            entry["characteristics"] = item["characteristics"]
        out.append(entry)
    return out


# ---------------------------------------------------------------------------
# config commands
# ---------------------------------------------------------------------------

@config_app.command("set")
def config_set(
    tenant:        Optional[str] = typer.Option(None, "--tenant",        help="Tenant URL, e.g. https://your-tenant.my.tricentis.com"),
    space_id:      Optional[str] = typer.Option(None, "--space-id",      help="Space ID (default: 'default')"),
    token_url:     Optional[str] = typer.Option(None, "--token-url",     help="OAuth2 token endpoint (Okta URL from Identity Swagger > Authorize)"),
    client_id:     Optional[str] = typer.Option(None, "--client-id",     help="OAuth2 client_id"),
    client_secret: Optional[str] = typer.Option(None, "--client-secret", help="OAuth2 client_secret"),
    scope:         Optional[str] = typer.Option(None, "--scope",         help="OAuth2 scope (default: tta)"),
    timeout:       Optional[int] = typer.Option(None, "--timeout",       help="Request timeout in seconds (default: 30)"),
    no_ssl:        bool          = typer.Option(False, "--no-ssl",        help="Disable SSL certificate verification"),
    openai_key:    Optional[str] = typer.Option(None, "--openai-key",    help="OpenAI API key for 'ask' command"),
):
    """Save connection settings to .env in the project directory."""
    HOME_CFG.touch(exist_ok=True)
    if tenant:        set_key(str(HOME_CFG), "TOSCA_TENANT_URL",    tenant)
    if space_id:      set_key(str(HOME_CFG), "TOSCA_SPACE_ID",      space_id)
    if token_url:     set_key(str(HOME_CFG), "TOSCA_TOKEN_URL",     token_url)
    if client_id:     set_key(str(HOME_CFG), "TOSCA_CLIENT_ID",     client_id)
    if client_secret: set_key(str(HOME_CFG), "TOSCA_CLIENT_SECRET", client_secret)
    if scope:         set_key(str(HOME_CFG), "TOSCA_SCOPE",         scope)
    if timeout:       set_key(str(HOME_CFG), "TOSCA_TIMEOUT",       str(timeout))
    if no_ssl:        set_key(str(HOME_CFG), "TOSCA_VERIFY_SSL",    "false")
    if openai_key:    set_key(str(HOME_CFG), "TOSCA_OPENAI_KEY",    openai_key)
    # Invalidate cached token whenever credentials change
    if client_id or client_secret or token_url:
        if TOKEN_FILE.exists():
            TOKEN_FILE.unlink()
    console.print(f"[green]Config saved to[/green] {HOME_CFG}")


@config_app.command("show")
def config_show():
    """Display current connection settings (secrets masked)."""
    def _mask(key: str) -> str:
        v = os.getenv(key, "")
        return "*" * 8 if v else "[dim]<not set>[/dim]"

    space = os.getenv("TOSCA_SPACE_ID", "") or os.getenv("TOSCA_WORKSPACE_ID", "") or "default"
    items = [
        ("TOSCA_TENANT_URL",    os.getenv("TOSCA_TENANT_URL",   "[dim]<not set>[/dim]")),
        ("TOSCA_SPACE_ID",      space),
        ("TOSCA_TOKEN_URL",     os.getenv("TOSCA_TOKEN_URL",    "[dim]<not set>[/dim]")),
        ("TOSCA_CLIENT_ID",     os.getenv("TOSCA_CLIENT_ID",    "[dim]<not set>[/dim]")),
        ("TOSCA_CLIENT_SECRET", _mask("TOSCA_CLIENT_SECRET")),
        ("TOSCA_SCOPE",         os.getenv("TOSCA_SCOPE",        "tta")),
        ("TOSCA_TIMEOUT",       os.getenv("TOSCA_TIMEOUT",      "30")),
        ("TOSCA_VERIFY_SSL",    os.getenv("TOSCA_VERIFY_SSL",   "true")),
        ("TOSCA_OPENAI_KEY",    _mask("TOSCA_OPENAI_KEY")),
        ("Config file",         str(HOME_CFG)),
        ("Token cache",         str(TOKEN_FILE) + (" [green](active)[/green]" if TOKEN_FILE.exists() else " [dim](none)[/dim]")),
    ]
    console.print(_table("Current Configuration", ["Setting", "Value"], items))


@config_app.command("test")
def config_test():
    """Test connectivity: fetch an OAuth2 token and call the Identity API."""
    console.print("Requesting access token …")
    try:
        token = _get_access_token()
    except SystemExit:
        raise
    except Exception as e:
        _exit_err(f"Token fetch failed: {e}")
    console.print("[green]Token obtained successfully.[/green]")

    try:
        client = ToscaClient()
        apps   = client.list_applications()
        console.print(f"[bold green]Identity API reachable.[/bold green] "
                      f"Found [cyan]{len(apps)}[/cyan] application(s).")
    except ToscaError as e:
        _exit_err(f"Identity API error: {e}")
    except Exception as e:
        _exit_err(f"Could not reach Identity API: {e}")


# ---------------------------------------------------------------------------
# identity commands
# ---------------------------------------------------------------------------

@identity_app.command("apps")
def identity_apps(
    as_json: bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """
    List all registered applications (with their clientId).

    Use the application Id from this list when calling [bold]identity secrets[/bold].
    """
    client = ToscaClient()
    try:
        apps = client.list_applications()
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(apps)
        return

    rows = [
        [a.get("id", ""), a.get("name", ""), a.get("clientId", ""), str(a.get("isActive", ""))]
        for a in apps
    ]
    console.print(_table(f"Applications ({len(rows)})",
                         ["Id", "Name", "ClientId", "IsActive"], rows))


@identity_app.command("secrets")
def identity_secrets(
    app_id:  str  = typer.Argument(..., help="Application Id (from 'identity apps')"),
    as_json: bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """List client secrets for an application."""
    client = ToscaClient()
    try:
        secrets = client.get_secrets(app_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(secrets)
        return

    rows = [
        [s.get("id", ""), s.get("secretHash", "[dim]<hashed>[/dim]"),
         str(s.get("isActive", "")), s.get("createdAt", "")]
        for s in secrets
    ]
    console.print(_table(f"Secrets for app {app_id} ({len(rows)})",
                         ["SecretId", "SecretHash", "IsActive", "CreatedAt"], rows))


@identity_app.command("new-secret")
def identity_new_secret(
    app_id:  str  = typer.Argument(..., help="Application Id"),
    as_json: bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Generate a new client secret for an application."""
    client = ToscaClient()
    try:
        result = client.create_secret(app_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(result)
        return

    console.print(Panel(
        f"[bold green]New secret generated[/bold green]\n"
        f"SecretId:     [cyan]{result.get('id', '')}[/cyan]\n"
        f"ClientSecret: [bold yellow]{result.get('clientSecret', '')}[/bold yellow]\n"
        f"[dim]Copy this secret now — it will not be shown again.[/dim]",
        title="New Client Secret",
        border_style="yellow",
    ))


@identity_app.command("delete-secret")
def identity_delete_secret(
    app_id:    str  = typer.Argument(..., help="Application Id"),
    secret_id: str  = typer.Argument(..., help="Secret Id (from 'identity secrets')"),
    force:     bool = typer.Option(False, "--force", "-y", help="Skip confirmation"),
):
    """Delete a client secret."""
    if not force:
        confirmed = Confirm.ask(f"Delete secret [bold red]{secret_id}[/bold red]?")
        if not confirmed:
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.delete_secret(app_id, secret_id)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Secret {secret_id} deleted.[/green]")


@identity_app.command("get-secret")
def identity_get_secret(
    app_id:    str  = typer.Argument(..., help="Application Id"),
    secret_id: str  = typer.Argument(..., help="Secret Id"),
    as_json:   bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Get details of a specific client secret."""
    client = ToscaClient()
    try:
        result = client.get_secret(app_id, secret_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(result)
        return

    console.print(Panel(
        f"[bold]Secret {result.get('id', secret_id)}[/bold]\n"
        f"[dim]Active:[/dim]     {result.get('isActive')}\n"
        f"[dim]CreatedAt:[/dim]  {result.get('createdAt')}\n"
        f"[dim]Hash:[/dim]       [yellow]{result.get('secretHash', '[not shown]')}[/yellow]",
        title="Client Secret",
        border_style="cyan",
    ))


# ---------------------------------------------------------------------------
# cases commands  (MBT API v2)
# ---------------------------------------------------------------------------

@cases_app.command("get")
def cases_get(
    case_id: str  = typer.Argument(..., help="Test case Id"),
    as_json: bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Get full details for a single test case (TestCaseV2)."""
    client = ToscaClient()
    try:
        data = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(data)
        return

    console.print(Panel(
        f"[bold]{data.get('name', case_id)}[/bold]\n"
        f"[dim]Id:[/dim]          {data.get('id', case_id)}\n"
        f"[dim]Description:[/dim] {data.get('description', '')}\n"
        f"[dim]WorkState:[/dim]   {data.get('workState', '')}\n"
        f"[dim]Version:[/dim]     {data.get('version', '')}",
        title="Test Case Details",
        border_style="cyan",
    ))
    items = data.get("testCaseItems", [])
    if items:
        console.print(f"[dim]{len(items)} test step(s) — run 'cases steps {case_id}' for details.[/dim]")


@cases_app.command("steps")
def cases_steps(
    case_id: str  = typer.Argument(..., help="Test case Id"),
    as_json: bool = typer.Option(False, "--json", help="Full raw JSON of testCaseItems"),
):
    """
    Show the full recursive step tree for a test case.

    Displays folders, test steps, all testStepValues (name/value/actionMode/operator),
    module references, and configuration parameters.
    Use --json for the complete machine-readable payload.
    """
    client = ToscaClient()
    try:
        data = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(str(e))

    items = data.get("testCaseItems", [])

    if as_json:
        _output_json({
            "id":                        data.get("id"),
            "name":                      data.get("name"),
            "workState":                 data.get("workState"),
            "version":                   data.get("version"),
            "testConfigurationParameters": data.get("testConfigurationParameters", []),
            "testCaseItems":             items,
        })
        return

    def _add_items(node: Tree, item_list: list) -> None:
        for item in item_list:
            typ  = item.get("$type", "?")
            name = item.get("name", "")
            iid  = item.get("id", "")
            dis  = " [dim](disabled)[/dim]" if item.get("disabled") else ""

            if typ == "TestStepFolderV2":
                branch = node.add(f"[bold yellow]\u25b6 {name}[/bold yellow] [dim]{iid}[/dim]{dis}")
                _add_items(branch, item.get("items", []))

            elif typ == "TestStepV2":
                mod_ref  = item.get("moduleReference", {})
                mod_id   = mod_ref.get("id", "")
                pkg      = (mod_ref.get("packageReference") or {}).get("id", "")
                branch   = node.add(
                    f"[cyan]\u25cf {name}[/cyan] [dim]{iid}[/dim]{dis}\n"
                    f"  [dim]module:[/dim] [magenta]{mod_id}[/magenta]  [dim]package:[/dim] {pkg}"
                )
                for sv in item.get("testStepValues", []):
                    sv_name  = sv.get("explicitName") or sv.get("name", "")
                    sv_val   = sv.get("value", "")
                    sv_mode  = sv.get("actionMode", "")
                    sv_op    = sv.get("operator", "")
                    sv_dtype = sv.get("dataType", "")
                    sv_id    = sv.get("id", "")
                    sv_dis   = " [dim](disabled)[/dim]" if sv.get("disabled") else ""
                    attr_ref = sv.get("moduleAttributeReference", {})
                    attr_id  = attr_ref.get("id", "") if attr_ref else ""
                    branch.add(
                        f"[green]{sv_name}[/green] = [bold white]{sv_val!r}[/bold white]"
                        f"  [dim]mode:[/dim]{sv_mode}  [dim]op:[/dim]{sv_op}  [dim]type:[/dim]{sv_dtype}{sv_dis}\n"
                        f"  [dim]valueId:[/dim]{sv_id}  [dim]attrRef:[/dim]{attr_id}"
                    )

            elif typ == "TestStepFolderReferenceV2":
                ref_id = item.get("referencedTestStepFolderId", "")
                node.add(f"[blue]\u21aa {name}[/blue] [dim](folder-ref → {ref_id})[/dim] {iid}{dis}")

            else:
                # ControlFlowItemV2 or unknown
                node.add(f"[dim][{typ}] {name} {iid}{dis}[/dim]")

    tc_name = data.get("name", case_id)
    root = Tree(
        f"[bold]{tc_name}[/bold]  "
        f"[dim]id:[/dim][cyan]{data.get('id','')}[/cyan]  "
        f"[dim]state:[/dim]{data.get('workState','')}  "
        f"[dim]ver:[/dim]{data.get('version','')}"
    )

    cfg_params = data.get("testConfigurationParameters", [])
    if cfg_params:
        cfg_node = root.add("[bold blue]\u2699 Configuration Parameters[/bold blue]")
        for p in cfg_params:
            cfg_node.add(f"[green]{p.get('name','')}[/green] = [bold white]{p.get('value','')!r}[/bold white]  [dim]{p.get('dataType','')}[/dim]")

    _add_items(root, items)
    console.print(root)


@cases_app.command("clone")
def cases_clone(
    case_id:  str           = typer.Argument(..., help="Source test case Id to clone"),
    new_name: Optional[str] = typer.Option(None, "--name", "-n",
                                           help="Name for the new test case (default: 'AI Copilot – <original name>')"),    as_json:  bool          = typer.Option(False, "--json", help="Print created EntityDescriptor as JSON"),
):
    """
    Clone an existing test case with all steps, values, and configuration parameters.

    Fetches the source test case, strips generated item/value IDs (preserving
    module and attribute references), then POSTs the full payload as a new test case.
    """
    client = ToscaClient()
    try:
        source = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(str(e))

    def _strip_ids(items: list) -> list:
        """Recursively remove generated IDs from testCaseItems tree.
        Keeps moduleReference.id and moduleAttributeReference.id (they point to existing modules)."""
        cleaned = []
        for item in items:
            node = {k: v for k, v in item.items() if k != "id"}
            if "items" in node:
                node["items"] = _strip_ids(node["items"])
            if "testStepValues" in node:
                node["testStepValues"] = [
                    {k: v for k, v in sv.items() if k != "id"}
                    for sv in node["testStepValues"]
                ]
            cleaned.append(node)
        return cleaned

    target_name   = new_name or f"AI Copilot – {source.get('name', case_id)}"
    cleaned_items = _strip_ids(source.get("testCaseItems", []))
    cfg_params    = source.get("testConfigurationParameters", [])

    # Fetch source inventory record to get folder placement + tags
    console.print("Fetching source inventory metadata (folder/tags) …")
    try:
        src_inv = client.get_inventory_artifact("testCase", case_id)
    except ToscaError:
        src_inv = {}
    src_folder_key = src_inv.get("folderKey")
    src_tags       = src_inv.get("tags", [])

    console.print(f"Cloning [bold]{source.get('name')}[/bold] → [cyan]{target_name}[/cyan] "
                  f"({len(cleaned_items)} top-level item(s), {len(cfg_params)} config param(s)) …")
    try:
        result = client.create_case(
            name             = target_name,
            description      = source.get("description", ""),
            work_state       = source.get("workState", "Planned"),
            test_case_items  = cleaned_items,
            config_params    = cfg_params,
        )
    except ToscaError as e:
        _exit_err(str(e))

    new_id = result.get("id", "?")
    console.print(f"[green]✓ Test case created.[/green] Id: [cyan]{new_id}[/cyan]")

    # Patch inventory: copy tags. NOTE: folderKey is read-only in the Inventory
    # API and TestCaseV2 has no parentId field – the MBT builder API always
    # creates test cases at root. Folder placement must be done manually in the UI.
    if src_tags:
        import time
        console.print("Copying tags via Inventory API …")
        patched = False
        for attempt in range(5):
            try:
                client.patch_inventory_artifact(
                    "testCase", new_id,
                    tags = src_tags,
                )
                patched = True
                break
            except ToscaError as e:
                if "404" in str(e) and attempt < 4:
                    console.print(f"  [dim]Inventory not indexed yet, retry {attempt+1}/5 in 3s …[/dim]")
                    time.sleep(3)
                else:
                    console.print(f"[yellow]⚠ Tags patch failed: {e}[/yellow]")
                    break
        if patched:
            console.print(f"[green]✓ Tags applied:[/green] {', '.join(t['value'] for t in src_tags)}")

    if src_folder_key:
        console.print(f"[yellow]⚠ Folder placement:[/yellow] The MBT API always creates test cases at "
                      f"root – folderKey is read-only in the Inventory API.\n"
                      f"  Move manually in the TOSCA Cloud UI to:\n"
                      f"  [dim]{src_folder_key}[/dim]")

    if as_json:
        _output_json(result)
        return

    console.print(f"[dim]Verify:[/dim] python tosca_cli.py cases steps -- {new_id}")


@cases_app.command("create")
def cases_create(
    name:        str           = typer.Option(..., "--name",   "-n", help="Test case name"),
    description: Optional[str] = typer.Option("",   "--desc",   "-d", help="Description"),
    work_state:  Optional[str] = typer.Option("Planned", "--state", "-s",
                                              help="WorkState: Planned | InWork | Completed"),
    as_json:     bool          = typer.Option(False, "--json",        help="Raw JSON output"),
):
    """Create a new test case (TestCaseV2). Returns EntityDescriptorV2 with the new id."""
    client = ToscaClient()
    try:
        result = client.create_case(name, description or "", work_state=work_state or "Planned")
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(result)
        return

    uid = result.get("id", "?")
    console.print(f"[green]✓ Created test case[/green] [bold]{name}[/bold] → Id: [cyan]{uid}[/cyan]")


@cases_app.command("delete")
def cases_delete(
    case_id: str  = typer.Argument(..., help="Test case Id"),
    force:   bool = typer.Option(False, "--force", "-y", help="Skip confirmation"),
):
    """Delete a test case (returns 202 Accepted)."""
    if not force:
        confirmed = Confirm.ask(f"Delete test case [bold red]{case_id}[/bold red]?")
        if not confirmed:
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.delete_case(case_id)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Deletion accepted for test case {case_id}[/green]")


@cases_app.command("update")
def cases_update(
    case_id:   str  = typer.Argument(..., help="Test case Id"),
    json_file: str  = typer.Option(..., "--json-file", "-f",
                                   help="Path to JSON file with full TestCaseV2 body"),
    as_json:   bool = typer.Option(False, "--json", help="Echo back the body sent"),
    skip_confirm: bool = typer.Option(False, "--skip-confirm",
                                      help="Skip the post-PUT GET that verifies version bumped"),
):
    """
    Replace a test case (full PUT – TestCases_Update2).

    Provide a JSON file with the complete TestCaseV2 object.
    Get the current body first with:  tosca cases get <id> --json

    After the PUT, this command issues a confirm-GET and verifies that the
    server-side `version` moved past the prior snapshot — a 204 alone is not
    proof that the write landed.
    """
    src = Path(json_file)
    if not src.exists():
        _exit_err(f"File not found: {json_file}")
    try:
        body = json.loads(src.read_text())
    except json.JSONDecodeError as e:
        _exit_err(f"Invalid JSON in {json_file}: {e}")
    if as_json:
        _output_json(body)
    client = ToscaClient()
    prior_version = None
    if not skip_confirm:
        try:
            prior_version = (client.get_case(case_id) or {}).get("version")
        except ToscaError:
            prior_version = None
    try:
        client.update_case(case_id, body)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Test case {case_id} updated.[/green]")
    if not skip_confirm:
        try:
            fresh = client.get_case(case_id)
        except ToscaError as e:
            _exit_err(f"Confirm-GET failed after PUT: {e}")
        _confirm_version_bump(fresh, prior_version, label=f"testCase {case_id}")


@cases_app.command("patch")
def cases_patch(
    case_id:    str  = typer.Argument(..., help="Test case Id"),
    operations: str  = typer.Option(
        ..., "--operations", "-o",
        help='JSON array of RFC 6902 patch operations, e.g. '
             '\'[{"op":"replace","path":"/workState","value":"Completed"}]\'',
    ),
    as_json:    bool = typer.Option(False, "--json", help="Echo the operations array"),
):
    """Apply JSON Patch operations to a test case (TestCases_Patch2)."""
    try:
        ops = json.loads(operations)
    except json.JSONDecodeError as e:
        _exit_err(f"Invalid JSON for --operations: {e}")
    if not isinstance(ops, list):
        _exit_err("--operations must be a JSON array")
    if as_json:
        _output_json(ops)
    client = ToscaClient()
    try:
        client.patch_case(case_id, ops)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Test case {case_id} patched.[/green]")


@cases_app.command("set-step-value")
def cases_set_step_value(
    case_id:      str = typer.Argument(..., help="Test case Id"),
    folder:       str = typer.Argument(..., help="Name of the top-level folder, e.g. 'Process' / 'Verification'"),
    step:         str = typer.Argument(..., help="Name of the TestStepV2 inside the folder"),
    param:        str = typer.Argument(..., help="Name of the testStepValue (module attribute name) inside the step"),
    to:           str = typer.Option(..., "--to", help="New value to assign"),
    js:           bool = typer.Option(False, "--js",
                                      help="Lint the value as an Execute/Verify JavaScript payload "
                                           "(warns on leading `{`/`\"`/`[` parser traps)"),
    folder_index: Optional[int] = typer.Option(None, "--folder-index",
                                               help="Required when multiple top-level folders share the same name"),
    step_index:   Optional[int] = typer.Option(None, "--step-index",
                                               help="Required when multiple steps in the folder share the same name"),
    param_index:  Optional[int] = typer.Option(None, "--param-index",
                                               help="Required when multiple testStepValues share the same name"),
    skip_confirm: bool = typer.Option(False, "--skip-confirm",
                                      help="Skip the post-PUT confirm-GET"),
):
    """
    Shortcut: set a single testStepValue.value inside a top-level folder.

    This is the GET → mutate → PUT pattern that most agent work reduces to.
    It uses a full PUT (not PATCH) because MBT PATCH silently drops deep
    JSON-pointer ops into nested step trees.

    Scope: top-level folder + direct step only. For nested ControlFlow
    navigation (If/Else/Loop branches), use `cases update --json-file`.

    Ambiguity: if multiple folders / steps / params share the same name,
    the command prints an enumerated listing and asks for the matching
    `--*-index N` flag. It will never silently pick the wrong one.
    """
    if js:
        _lint_js_value(to)

    client = ToscaClient()
    try:
        case = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(f"Could not load test case {case_id}: {e}")

    prior_version = case.get("version")
    items = case.get("testCaseItems") or []
    _, folder_obj = _find_by_name(items, folder, label="folder", index=folder_index)

    sub_items = folder_obj.get("items") or []
    _, step_obj = _find_by_name(sub_items, step, label="step", index=step_index)
    if step_obj.get("$type") and step_obj.get("$type") != "TestStepV2":
        _exit_err(
            f"Step '{step}' is a {step_obj['$type']} (ControlFlow / folder), not a TestStepV2. "
            f"Use `cases update --json-file` for nested edits."
        )

    tsvs = step_obj.get("testStepValues") or []
    _, tsv = _find_by_name(tsvs, param, label="parameter", index=param_index)
    before = tsv.get("value")
    tsv["value"] = to

    console.print(
        f"[cyan]/{folder}/{step}/{param}[/cyan]: {before!r} → [bold]{to!r}[/bold]"
    )

    try:
        client.update_case(case_id, case)
    except ToscaError as e:
        _exit_err(f"PUT failed: {e}")
    console.print(f"[green]✓ Test case {case_id} updated.[/green]")

    if skip_confirm:
        return
    try:
        fresh = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(f"Confirm-GET failed after PUT: {e}")
    _confirm_version_bump(fresh, prior_version, label=f"testCase {case_id}")
    # Resolve the same path in the fresh doc to verify the value landed.
    fresh_items = fresh.get("testCaseItems") or []
    _, ff = _find_by_name(fresh_items, folder, label="folder", index=folder_index)
    fi = (ff.get("items") or [])
    _, fs = _find_by_name(fi, step, label="step", index=step_index)
    ftsvs = fs.get("testStepValues") or []
    _, ftsv = _find_by_name(ftsvs, param, label="parameter", index=param_index)
    if ftsv.get("value") != to:
        _exit_err(
            f"Confirm: /{folder}/{step}/{param} is {ftsv.get('value')!r} after PUT, "
            f"expected {to!r}. The server did not accept the write."
        )
    console.print(f"[green]✓ confirmed[/green] /{folder}/{step}/{param} = {to!r}")


@cases_app.command("insert-step")
def cases_insert_step(
    case_id:      str = typer.Argument(..., help="Test case Id"),
    folder:       str = typer.Argument(..., help="Name of the top-level folder to insert into"),
    json_file:    str = typer.Option(..., "--json-file", "-f",
                                     help="Path to a JSON file containing ONE TestStepV2 object"),
    after:        Optional[str] = typer.Option(None, "--after",
                                               help="Insert immediately after the step with this name"),
    before:       Optional[str] = typer.Option(None, "--before",
                                               help="Insert immediately before the step with this name"),
    at_start:     bool = typer.Option(False, "--at-start",
                                      help="Insert at position 0 in the folder"),
    folder_index: Optional[int] = typer.Option(None, "--folder-index",
                                               help="Disambiguate when multiple folders share the same name"),
    anchor_index: Optional[int] = typer.Option(None, "--anchor-index",
                                               help="Disambiguate --after / --before anchor if non-unique"),
    skip_confirm: bool = typer.Option(False, "--skip-confirm",
                                      help="Skip the post-PUT confirm-GET"),
):
    """
    Shortcut: insert one TestStepV2 into a top-level folder.

    The JSON file should contain a single TestStepV2 object — with or without
    the `id` / `testStepValues[].id` fields. Missing IDs are filled with fresh
    UUIDs automatically (NOT ULIDs — ULIDs are only correct for block
    businessParameter.id / parameterLayerId).

    Position (exactly one required): --after NAME | --before NAME | --at-start
    (default if none of the three is set: append to end).
    """
    anchors = sum(1 for x in (after, before, at_start) if x)
    if anchors > 1:
        _exit_err("Pick exactly one of --after / --before / --at-start (or none to append).")

    src = Path(json_file)
    if not src.exists():
        _exit_err(f"File not found: {json_file}")
    try:
        step_body = json.loads(src.read_text())
    except json.JSONDecodeError as e:
        _exit_err(f"Invalid JSON in {json_file}: {e}")
    if not isinstance(step_body, dict):
        _exit_err("--json-file must contain a single TestStepV2 object, not a list.")

    step_body.setdefault("$type", "TestStepV2")
    if step_body["$type"] != "TestStepV2":
        _exit_err(f"insert-step only supports $type=TestStepV2 (got {step_body['$type']!r}).")
    step_body.setdefault("disabled", False)
    if not step_body.get("id"):
        step_body["id"] = _fresh_uuid()
    for tsv in step_body.get("testStepValues") or []:
        if not tsv.get("id"):
            tsv["id"] = _fresh_uuid()
        tsv.setdefault("disabled", False)
        tsv.setdefault("subValues", [])

    client = ToscaClient()
    try:
        case = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(f"Could not load test case {case_id}: {e}")

    prior_version = case.get("version")
    items = case.get("testCaseItems") or []
    _, folder_obj = _find_by_name(items, folder, label="folder", index=folder_index)
    sub_items = folder_obj.setdefault("items", [])

    # Resolve insertion index.
    if at_start:
        pos = 0
    elif after:
        idx, _ = _find_by_name(sub_items, after, label="step", index=anchor_index)
        pos = idx + 1
    elif before:
        idx, _ = _find_by_name(sub_items, before, label="step", index=anchor_index)
        pos = idx
    else:
        pos = len(sub_items)

    sub_items.insert(pos, step_body)

    try:
        client.update_case(case_id, case)
    except ToscaError as e:
        _exit_err(f"PUT failed: {e}")
    console.print(
        f"[green]✓ Inserted step[/green] [bold]{step_body.get('name', step_body['id'])}[/bold] "
        f"at /{folder}[{pos}]"
    )

    if skip_confirm:
        return
    try:
        fresh = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(f"Confirm-GET failed after PUT: {e}")
    _confirm_version_bump(fresh, prior_version, label=f"testCase {case_id}")
    fresh_items = fresh.get("testCaseItems") or []
    _, ff = _find_by_name(fresh_items, folder, label="folder", index=folder_index)
    sub = ff.get("items") or []
    if pos >= len(sub) or sub[pos].get("id") != step_body["id"]:
        _exit_err(
            f"Confirm: inserted step id {step_body['id']} not at /{folder}[{pos}] — write dropped?"
        )
    console.print(f"[green]✓ confirmed[/green] step {step_body['id']} at /{folder}[{pos}]")


@cases_app.command("scaffold-web")
def cases_scaffold_web(
    case_id:        str           = typer.Argument(..., help="Existing (ideally empty) test case Id to scaffold"),
    url:            str           = typer.Option(..., "--url", "-u", help="URL the OpenUrl precondition will navigate to"),
    title_pattern:  Optional[str] = typer.Option(None, "--title-pattern",
                                                 help="Window title pattern for CloseBrowser / cleanup tab-match. "
                                                      "Default: derived from --url host (e.g. 'https://www.foo.com/' → '*foo*')."),
    title:          Optional[str] = typer.Option(None, "--title",
                                                 help="Optional document.title verification (adds a Verify JS Result step checking `return document.title;`)"),
    open_url_use_active_tab: bool = typer.Option(False, "--open-use-active-tab",
                                                 help="Set OpenUrl.UseActiveTab=True (default False — opens a fresh tab)"),
    open_url_force_page_switch: bool = typer.Option(True, "--open-force-page-switch/--open-no-force-page-switch",
                                                    help="Set OpenUrl.ForcePageSwitch (default True)"),
    overwrite:      bool          = typer.Option(False, "--overwrite",
                                                 help="Overwrite existing testCaseItems (otherwise refuses if any folders already exist)"),
    skip_confirm:   bool          = typer.Option(False, "--skip-confirm",
                                                 help="Skip the post-PUT confirm-GET"),
):
    """
    Scaffold a 4-folder Html test case skeleton into an EXISTING test case.

    Creates Precondition / Process / Verification / Teardown folders with:

        Precondition
          └─ OpenUrl <url>  (Framework-engine, packageReference=Html)
        Process
          (empty — caller adds Html GUI steps via `cases insert-step` /
           `cases set-step-value`)
        Verification
          (optional:  Verify JS Result → document.title == --title)
        Teardown
          └─ CloseBrowser <title-pattern>

    All GUIDs come from ``_STD_MODULES`` (validated on the tenant at build
    time). Uses full PUT — never PATCH — so the edit either lands in one
    trip or fails loud.

    Intended usage:

        python tosca_cli.py cases create --name "My Web Flow"
        # → Id: ABC...
        python tosca_cli.py cases scaffold-web ABC --url https://www.example.com --title "Example Domain"
        # now add your app-specific steps:
        python tosca_cli.py cases insert-step ABC Process --json-file my-click-step.json
    """
    from urllib.parse import urlparse

    def _derive_title_pattern(u: str) -> str:
        try:
            host = urlparse(u).hostname or u
        except Exception:
            host = u
        # Strip common prefixes, grab the core label.
        host = host.lower().removeprefix("www.")
        core = host.split(".")[0] if "." in host else host
        return f"*{core}*"

    tp = title_pattern or _derive_title_pattern(url)

    client = ToscaClient()
    try:
        case = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(f"Could not load test case {case_id}: {e}")

    existing = case.get("testCaseItems") or []
    if existing and not overwrite:
        names = [it.get("name") for it in existing]
        _exit_err(
            f"Test case {case_id} already has testCaseItems {names}. "
            f"Re-run with --overwrite to replace them."
        )

    prior_version = case.get("version")

    # Build the 4 folders with the minimal standard-step payload.
    open_url_step = _build_std_step(
        "open-url",
        values = {
            "Url":             url,
            "UseActiveTab":    "True" if open_url_use_active_tab else "False",
            "ForcePageSwitch": "True" if open_url_force_page_switch else "False",
        },
        name = f"OpenUrl – {url}",
    )

    verification_items: list = []
    if title:
        verification_items.append(
            _build_std_step(
                "verify-js",
                values = {
                    "UseActiveTab": "True",
                    "JavaScript":   "return document.title;",
                    "Result":       title,
                },
                name = f"Verify: document.title = {title}",
            )
        )

    close_browser_step = _build_std_step(
        "close-browser",
        values = {"Title": tp},
        name   = f"CloseBrowser {tp}",
    )

    case["testCaseItems"] = [
        _build_std_folder("Precondition",  [open_url_step]),
        _build_std_folder("Process",       []),
        _build_std_folder("Verification",  verification_items),
        _build_std_folder("Teardown",      [close_browser_step]),
    ]

    try:
        client.update_case(case_id, case)
    except ToscaError as e:
        _exit_err(f"PUT failed: {e}")

    console.print(
        f"[green]✓ Scaffolded[/green] Precondition/Process/Verification/Teardown into "
        f"[cyan]{case_id}[/cyan]"
    )
    console.print(f"  • Precondition:  OpenUrl → [bold]{url}[/bold]")
    console.print(f"  • Process:       [dim](empty — add your steps)[/dim]")
    if title:
        console.print(f"  • Verification:  Verify JS document.title == [bold]{title}[/bold]")
    else:
        console.print(f"  • Verification:  [dim](empty — re-run with --title or use insert-step)[/dim]")
    console.print(f"  • Teardown:      CloseBrowser [bold]{tp}[/bold]")

    if skip_confirm:
        return
    try:
        fresh = client.get_case(case_id)
    except ToscaError as e:
        _exit_err(f"Confirm-GET failed after PUT: {e}")
    _confirm_version_bump(fresh, prior_version, label=f"testCase {case_id}")
    fresh_items = fresh.get("testCaseItems") or []
    fresh_names = [it.get("name") for it in fresh_items]
    expected    = ["Precondition", "Process", "Verification", "Teardown"]
    if fresh_names != expected:
        _exit_err(
            f"Confirm: testCaseItems names are {fresh_names}, expected {expected}."
        )
    console.print(f"[green]✓ confirmed[/green] 4-folder skeleton = {fresh_names}")


@cases_app.command("export-tsu")
def cases_export_tsu(
    case_ids:   str = typer.Option("",          "--ids",        "-i",
                                   help="Comma-separated test case entity IDs"),
    module_ids: str = typer.Option("",          "--module-ids",
                                   help="Comma-separated module entity IDs to include"),
    block_ids:  str = typer.Option("",          "--block-ids",
                                   help="Comma-separated reuseable block entity IDs to include"),
    output:     str = typer.Option("export.tsu", "--output",     "-o",
                                   help="Output file path (default: export.tsu)"),
):
    """
    Export test cases, modules, and/or reuseable blocks to a binary .tsu file.

    Uses the MBT v2 endpoint:
      POST /{spaceId}/_mbt/api/v2/builder/tsu/exports

    At least one of --ids, --module-ids, or --block-ids must be provided.

    Examples:
      tosca cases export-tsu --ids "id1,id2" --output my_cases.tsu
      tosca cases export-tsu --ids "id1" --block-ids "blockId1" --output bundle.tsu
    """
    ids  = [i.strip() for i in case_ids.split(",")   if i.strip()]
    mods = [i.strip() for i in module_ids.split(",") if i.strip()]
    blks = [i.strip() for i in block_ids.split(",")  if i.strip()]
    if not ids and not mods and not blks:
        _exit_err("Provide at least one of --ids, --module-ids, or --block-ids")
    client = ToscaClient()
    try:
        data = client.export_tsu(ids,
                                 module_ids=mods or None,
                                 block_ids=blks or None)
    except ToscaError as e:
        _exit_err(str(e))
    total = len(ids) + len(mods) + len(blks)
    out_path = Path(output)
    out_path.write_bytes(data)
    console.print(f"[green]✓ Exported {total} artifact(s) → {out_path} ({len(data):,} bytes)[/green]")


@cases_app.command("import-tsu")
def cases_import_tsu(
    file: str = typer.Option(..., "--file", "-f", help="Path to the .tsu file to import"),
):
    """
    Import test cases from a .tsu file.

    Uses the undocumented MBT v2 endpoint:
      POST /{spaceId}/_mbt/api/v2/builder/tsu/imports

    Example:
      tosca cases import-tsu --file my_cases.tsu
    """
    file_path = Path(file)
    if not file_path.exists():
        _exit_err(f"File not found: {file_path}")
    client = ToscaClient()
    try:
        client.import_tsu(str(file_path))
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Imported test cases from {file_path}[/green]")


# ---------------------------------------------------------------------------
# modules commands  (MBT API v2)
# ---------------------------------------------------------------------------

@modules_app.command("get")
def modules_get(
    module_id: str  = typer.Argument(..., help="Module Id"),
    as_json:   bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Get module details (ModuleV2)."""
    client = ToscaClient()
    try:
        data = client.get_module(module_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(data)
        return

    console.print(Panel(
        f"[bold]{data.get('name', module_id)}[/bold]\n"
        f"[dim]Id:[/dim]             {data.get('id', module_id)}\n"
        f"[dim]BusinessType:[/dim]   {data.get('businessType', '')}\n"
        f"[dim]InterfaceType:[/dim]  {data.get('interfaceType', '')}\n"
        f"[dim]Description:[/dim]    {data.get('description', '')}\n"
        f"[dim]Version:[/dim]        {data.get('version', '')}",
        title="Module Details",
        border_style="cyan",
    ))
    attrs = data.get("attributes", [])
    if attrs:
        rows = [
            [a.get("name", ""), a.get("businessType", ""),
             a.get("defaultActionMode", ""), a.get("defaultDataType", ""),
             str(a.get("isVisible", ""))]
            for a in attrs
        ]
        console.print(_table(f"Attributes ({len(rows)})",
                             ["Name", "BusinessType", "DefaultAction", "DataType", "Visible"], rows))


@modules_app.command("create")
def modules_create(
    name:           str           = typer.Option(..., "--name",  "-n", help="Module name"),
    description:    Optional[str] = typer.Option("",  "--desc",  "-d", help="Description"),
    interface_type: Optional[str] = typer.Option("Gui", "--iface", "-i",
                                                 help="InterfaceType: Gui | NonGui"),
    as_json:        bool          = typer.Option(False, "--json",       help="Raw JSON output"),
):
    """Create a new module (ModuleV2)."""
    client = ToscaClient()
    try:
        result = client.create_module(name, description or "",
                                      interface_type=interface_type or "Gui")
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(result)
        return

    uid = result.get("id", "?")
    console.print(f"[green]✓ Created module[/green] [bold]{name}[/bold] → Id: [cyan]{uid}[/cyan]")


@modules_app.command("update")
def modules_update(
    module_id:  str  = typer.Argument(..., help="Module Id"),
    json_file:  str  = typer.Option(..., "--json-file", "-f", help="Path to module JSON file (full ModuleV2 body)"),
    as_json:    bool = typer.Option(False, "--json", help="Raw JSON output"),
    skip_confirm: bool = typer.Option(False, "--skip-confirm",
                                      help="Skip the post-PUT GET that verifies version bumped"),
):
    """
    Replace a module with a full PUT body (ModuleV2 JSON file).

    After the PUT, issues a confirm-GET and verifies that the server-side
    `version` moved past the prior snapshot — a 200 alone is not proof
    that the write landed.
    """
    import json as _json
    try:
        body = _json.loads(Path(json_file).read_text())
    except Exception as e:
        _exit_err(f"Could not read {json_file}: {e}")
    client = ToscaClient()
    prior_version = None
    if not skip_confirm:
        try:
            prior_version = (client.get_module(module_id) or {}).get("version")
        except ToscaError:
            prior_version = None
    try:
        result = client.update_module(module_id, body)
    except ToscaError as e:
        _exit_err(str(e))
    if as_json:
        _output_json(result)
    else:
        name = result.get("name", module_id)
        console.print(f"[green]✓ Updated module[/green] [bold]{name}[/bold] [cyan]{module_id}[/cyan]")
    if not skip_confirm:
        try:
            fresh = client.get_module(module_id)
        except ToscaError as e:
            _exit_err(f"Confirm-GET failed after PUT: {e}")
        _confirm_version_bump(fresh, prior_version, label=f"module {module_id}")


@modules_app.command("delete")
def modules_delete(
    module_id: str  = typer.Argument(..., help="Module Id"),
    force:     bool = typer.Option(False, "--force", "-y", help="Skip confirmation"),
):
    """Delete a module (returns 202 Accepted)."""
    if not force:
        confirmed = Confirm.ask(f"Delete module [bold red]{module_id}[/bold red]?")
        if not confirmed:
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.delete_module(module_id)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Deletion accepted for module {module_id}[/green]")


@modules_app.command("add-attr-param")
def modules_add_attr_param(
    module_id:   str  = typer.Argument(..., help="Module Id"),
    attr:        str  = typer.Argument(..., help="Module attribute name (e.g. 'Products')"),
    param_name:  str  = typer.Argument(..., help="Parameter name (e.g. 'ClassName', 'Path', 'Id')"),
    to:          str  = typer.Option(..., "--to", help="Parameter value"),
    param_type:  str  = typer.Option("TechnicalId", "--type",
                                     help="Parameter type (TechnicalId | Setting | Default). Default: TechnicalId."),
    attr_index:  Optional[int] = typer.Option(None, "--attr-index",
                                              help="Required when multiple attributes share the same name"),
    skip_confirm: bool = typer.Option(False, "--skip-confirm",
                                      help="Skip the post-PUT confirm-GET"),
):
    """
    Upsert a module-attribute parameter (e.g. ClassName / Id / Path TechnicalId).

    Keeps the existing ULID `id` when a parameter with the same name is already
    present (required for server-side continuity) — only the `value` is replaced.
    Uses full PUT (modules have no working PATCH surface for this).
    """
    client = ToscaClient()
    try:
        mod = client.get_module(module_id)
    except ToscaError as e:
        _exit_err(f"Could not load module {module_id}: {e}")
    prior_version = mod.get("version")

    attrs = mod.get("attributes") or []
    _, attr_obj = _find_by_name(attrs, attr, label="attribute", index=attr_index)
    params = attr_obj.setdefault("parameters", [])

    existing = next((p for p in params if p.get("name") == param_name), None)
    if existing is not None:
        before_val = existing.get("value")
        existing["value"] = to
        if param_type:
            existing["type"] = param_type
        verb = "updated"
    else:
        params.append({
            "id":    _generate_ulid(),
            "name":  param_name,
            "value": to,
            "type":  param_type,
        })
        before_val = None
        verb = "added"

    console.print(
        f"[cyan]{attr}.{param_name}[/cyan] [{param_type}]: {before_val!r} → [bold]{to!r}[/bold] ({verb})"
    )

    try:
        client.update_module(module_id, mod)
    except ToscaError as e:
        _exit_err(f"PUT failed: {e}")
    console.print(f"[green]✓ Module {module_id} updated.[/green]")

    if skip_confirm:
        return
    try:
        fresh = client.get_module(module_id)
    except ToscaError as e:
        _exit_err(f"Confirm-GET failed after PUT: {e}")
    _confirm_version_bump(fresh, prior_version, label=f"module {module_id}")
    fattrs = fresh.get("attributes") or []
    _, fattr = _find_by_name(fattrs, attr, label="attribute", index=attr_index)
    fparam = next((p for p in (fattr.get("parameters") or []) if p.get("name") == param_name), None)
    if not fparam or fparam.get("value") != to:
        _exit_err(
            f"Confirm: {attr}.{param_name} is "
            f"{(fparam or {}).get('value')!r} after PUT, expected {to!r}."
        )
    console.print(f"[green]✓ confirmed[/green] {attr}.{param_name} = {to!r}")


@modules_app.command("set-param")
def modules_set_param(
    module_id:    str  = typer.Argument(..., help="Module Id"),
    param_name:   str  = typer.Argument(..., help="Module-level parameter name (e.g. a Steering flag)"),
    to:           str  = typer.Option(..., "--to", help="Parameter value"),
    param_type:   str  = typer.Option("Setting", "--type",
                                      help="Parameter type. Default: Setting."),
    skip_confirm: bool = typer.Option(False, "--skip-confirm",
                                      help="Skip the post-PUT confirm-GET"),
):
    """
    Upsert a module-level parameter (e.g. Steering flags).

    Like `add-attr-param`, but operates on the module's own `parameters[]`
    array (not an attribute's). Keeps the existing id on update.
    """
    client = ToscaClient()
    try:
        mod = client.get_module(module_id)
    except ToscaError as e:
        _exit_err(f"Could not load module {module_id}: {e}")
    prior_version = mod.get("version")

    params = mod.setdefault("parameters", [])
    existing = next((p for p in params if p.get("name") == param_name), None)
    if existing is not None:
        before_val = existing.get("value")
        existing["value"] = to
        if param_type:
            existing["type"] = param_type
        verb = "updated"
    else:
        params.append({
            "id":    _generate_ulid(),
            "name":  param_name,
            "value": to,
            "type":  param_type,
        })
        before_val = None
        verb = "added"

    console.print(
        f"[cyan]{param_name}[/cyan] [{param_type}]: {before_val!r} → [bold]{to!r}[/bold] ({verb})"
    )

    try:
        client.update_module(module_id, mod)
    except ToscaError as e:
        _exit_err(f"PUT failed: {e}")
    console.print(f"[green]✓ Module {module_id} updated.[/green]")

    if skip_confirm:
        return
    try:
        fresh = client.get_module(module_id)
    except ToscaError as e:
        _exit_err(f"Confirm-GET failed after PUT: {e}")
    _confirm_version_bump(fresh, prior_version, label=f"module {module_id}")
    fparam = next((p for p in (fresh.get("parameters") or []) if p.get("name") == param_name), None)
    if not fparam or fparam.get("value") != to:
        _exit_err(
            f"Confirm: /parameters/{param_name} is "
            f"{(fparam or {}).get('value')!r} after PUT, expected {to!r}."
        )
    console.print(f"[green]✓ confirmed[/green] /parameters/{param_name} = {to!r}")


# ---------------------------------------------------------------------------
# blocks commands
# ---------------------------------------------------------------------------

@blocks_app.command("get")
def blocks_get(
    block_id: str  = typer.Argument(..., help="Block Id (reuseableTestStepBlock)"),
    as_json:  bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """
    Get a reuseable test step block and list its business parameters.

    Use [cyan]inventory search --type Module[/cyan] to discover block IDs via the
    portal (blocks appear in the Module section of Inventory).
    """
    client = ToscaClient()
    try:
        data = client.get_block(block_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(data)
        return

    console.print(Panel(
        f"[bold]{data.get('name', block_id)}[/bold]\n"
        f"[dim]Id:[/dim]          {data.get('id', block_id)}\n"
        f"[dim]Description:[/dim] {data.get('description', '')}\n"
        f"[dim]Version:[/dim]     {data.get('version', '')}",
        title="Reuseable Test Step Block",
        border_style="cyan",
    ))
    params = data.get("businessParameters", [])
    if params:
        rows = [
            [p.get("id", ""), p.get("name", ""), p.get("description", ""),
             ", ".join(str(v) for v in (p.get("valueRange") or []))]
            for p in params
        ]
        console.print(_table(f"Business Parameters ({len(rows)})",
                             ["Id", "Name", "Description", "ValueRange"], rows))


@blocks_app.command("add-param")
def blocks_add_param(
    block_id:    str           = typer.Argument(..., help="Block Id"),
    name:        str           = typer.Option(...,  "--name", "-n", help="New parameter name"),
    description: Optional[str] = typer.Option("",   "--desc", "-d", help="Parameter description"),
    value_range: Optional[str] = typer.Option(None, "--value-range", "-r",
                                              help="Comma-separated allowed values (e.g. '1,2,3,4')"),
    as_json:     bool          = typer.Option(False, "--json", help="Print result as JSON"),
):
    """
    Add a new business parameter to a reuseable test step block.

    The block is fetched, the parameter is appended with a [bold yellow]fresh ULID[/bold yellow],
    then the block is PUT back. The new parameter ID is printed — use it when
    setting parameter values in a test case's TestStepFolderReferenceV2.

    Example – add a 4th material slot to a block:

    [cyan]tosca blocks add-param <blockId> --name Material4 --value-range '1,2,3,4'[/cyan]
    """
    vr = [v.strip() for v in value_range.split(",")] if value_range else None
    client = ToscaClient()
    try:
        new_id = client.add_block_parameter(block_id, name,
                                            description=description or "",
                                            value_range=vr)
    except (ToscaError, ValueError) as e:
        _exit_err(str(e))

    if as_json:
        _output_json({"parameterId": new_id, "name": name, "blockId": block_id})
        return

    console.print(
        f"[green]✓ Added parameter[/green] [bold]{name}[/bold] "
        f"to block [cyan]{block_id}[/cyan]\n"
        f"[dim]New parameter Id:[/dim] [bold yellow]{new_id}[/bold yellow]\n"
        f"[dim]Use this Id as[/dim] referencedParameterId [dim]when building test case steps.[/dim]"
    )


@blocks_app.command("set-value-range")
def blocks_set_value_range(
    block_id:   str  = typer.Argument(..., help="Block Id"),
    param_name: str  = typer.Argument(..., help="Business parameter name (case-sensitive)"),
    values:     str  = typer.Option(...,  "--values", "-v",
                                    help="Comma-separated values to set (e.g. '1,2,3,4')"),
    as_json:    bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """
    Update the valueRange of an existing business parameter in a block.

    Useful for extending enumeration parameters such as [bold]NumberOfMaterials[/bold]
    from ['1','2','3'] to ['1','2','3','4'] when adding a new data row to a block.

    [cyan]tosca blocks set-value-range <blockId> NumberOfMaterials --values '1,2,3,4'[/cyan]
    """
    vr = [v.strip() for v in values.split(",")]
    client = ToscaClient()
    try:
        client.update_block_param_range(block_id, param_name, vr)
    except (ToscaError, ValueError) as e:
        _exit_err(str(e))

    if as_json:
        _output_json({"blockId": block_id, "paramName": param_name, "valueRange": vr})
        return

    console.print(
        f"[green]✓ Updated valueRange[/green] of [bold]{param_name}[/bold] "
        f"in block [cyan]{block_id}[/cyan]\n"
        f"[dim]New range:[/dim] {vr}"
    )


@blocks_app.command("delete")
def blocks_delete(
    block_id: str  = typer.Argument(..., help="Block Id"),
    force:    bool = typer.Option(False, "--force", "-y", help="Skip confirmation"),
):
    """Delete a reuseable test step block (returns 202 Accepted)."""
    if not force:
        confirmed = Confirm.ask(f"Delete block [bold red]{block_id}[/bold red]?")
        if not confirmed:
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.delete_block(block_id)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Deletion accepted for block {block_id}[/green]")


# ---------------------------------------------------------------------------
# playlists commands
# ---------------------------------------------------------------------------

@playlists_app.command("list")
def playlists_list(
    search:  Optional[str] = typer.Option(None, "--search", "-s", help="Filter by name"),
    limit:   int           = typer.Option(50,   "--limit",  "-n", help="Max results"),
    as_json: bool          = typer.Option(False, "--json",        help="Raw JSON output"),
):
    """List playlists in the space."""
    client = ToscaClient()
    try:
        items = client.list_playlists(search=search, limit=limit)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(items)
        return

    rows = [
        [i.get("id", ""), i.get("name", ""), i.get("runMode", ""),
         i.get("createdBy", ""), (i.get("createdAt") or "")[:10]]
        for i in items
    ]
    console.print(_table(f"Playlists ({len(rows)})",
                         ["Id", "Name", "RunMode", "CreatedBy", "Created"], rows))


@playlists_app.command("get")
def playlists_get(
    playlist_id: str  = typer.Argument(..., help="Playlist Id"),
    as_json:     bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Get full details of a playlist including its test case items."""
    client = ToscaClient()
    try:
        data = client.get_playlist(playlist_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(data)
        return

    console.print(Panel(
        f"[bold]{data.get('name', playlist_id)}[/bold]\n"
        f"[dim]Id:[/dim]          {data.get('id', playlist_id)}\n"
        f"[dim]Description:[/dim] {data.get('description', '')}\n"
        f"[dim]RunMode:[/dim]     {data.get('runMode', '')}\n"
        f"[dim]CreatedBy:[/dim]   {data.get('createdBy', '')}\n"
        f"[dim]CreatedAt:[/dim]   {data.get('createdAt', '')}",
        title="Playlist Details",
        border_style="cyan",
    ))
    items = data.get("items", [])
    if items:
        rows = [[i.get("id", ""), i.get("$type", "")] for i in items]
        console.print(_table(f"Items ({len(rows)})", ["Id", "Type"], rows))


@playlists_app.command("create")
def playlists_create(
    name:     str           = typer.Option(...,     "--name",     "-n", help="Playlist name (1-140 characters)"),
    desc:     Optional[str] = typer.Option(None,    "--desc",     "-d", help="Description (0-300 chars)"),
    run_mode: Optional[str] = typer.Option("parallel", "--run-mode", "-m",
                                           help="Run mode: parallel | sequential | sequentialOnSameAgent"),
    as_json:  bool          = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Create a new playlist."""
    client = ToscaClient()
    try:
        result = client.create_playlist(name, description=desc or "", run_mode=run_mode or "parallel")
    except ToscaError as e:
        _exit_err(str(e))
    if as_json:
        _output_json(result)
        return
    uid = result.get("id", "?")
    console.print(f"[green]\u2713 Created playlist[/green] [bold]{name}[/bold] \u2192 Id: [cyan]{uid}[/cyan]")


@playlists_app.command("update")
def playlists_update(
    playlist_id: str           = typer.Argument(..., help="Playlist Id"),
    name:        str           = typer.Option(...,   "--name", "-n", help="New name"),
    desc:        Optional[str] = typer.Option(None,  "--desc", "-d", help="New description"),
    run_mode:    Optional[str] = typer.Option(None,  "--run-mode", "-m",
                                              help="Run mode: parallel | sequential | sequentialOnSameAgent"),
    skip_confirm: bool         = typer.Option(False, "--skip-confirm",
                                              help="Skip the post-PUT GET that verifies the fields landed"),
):
    """
    Replace a playlist (full PUT).

    After the PUT, issues a confirm-GET and verifies that `name` / `runMode`
    were actually applied server-side — a 2xx alone is not proof.
    """
    client = ToscaClient()
    try:
        client.update_playlist(playlist_id, name, description=desc or "",
                               run_mode=run_mode or "parallel")
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]\u2713 Playlist {playlist_id} updated.[/green]")
    if not skip_confirm:
        try:
            fresh = client.get_playlist(playlist_id)
        except ToscaError as e:
            _exit_err(f"Confirm-GET failed after PUT: {e}")
        _confirm_field(fresh, ["name"], name, label=f"playlist {playlist_id}")
        if run_mode is not None:
            # Server normalizes run-mode casing; compare case-insensitively.
            got = str(fresh.get("runMode", "")).lower()
            want = run_mode.lower()
            if got != want:
                _exit_err(
                    f"playlist {playlist_id}: runMode did not apply — got {got!r}, wanted {want!r}"
                )
            console.print(f"[green]✓ confirmed[/green] playlist {playlist_id} /runMode = {got}")


@playlists_app.command("set-characteristic")
def playlists_set_characteristic(
    playlist_id: str = typer.Argument(..., help="Playlist Id"),
    char_name:   str = typer.Option(..., "--name", "-n", help="Characteristic name (e.g. AgentIdentifier)"),
    char_value:  str = typer.Option(..., "--value", "-v", help="Characteristic value (e.g. Tosca-Team-Agent)"),
    as_json:     bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Add or replace a characteristic on a playlist (GET → merge → PUT)."""
    client = ToscaClient()
    try:
        data = client.get_playlist(playlist_id)
    except ToscaError as e:
        _exit_err(str(e))

    # Merge the characteristic (upsert by name)
    chars: list = data.get("characteristics") or []
    chars = [c for c in chars if c.get("name") != char_name]
    chars.append({"name": char_name, "value": char_value})

    # Transform GET items (TestCaseV1) → PUT items (InputTestCaseV1).
    # The helper preserves the existing shape (sourceId + disabled + parameters +
    # characteristics) while normalizing `$type` and stripping server-managed fields.
    raw_items = data.get("items") or []
    input_items: list = []
    for item in raw_items:
        if item.get("$type") in ("TestCaseV1", "InputTestCaseV1"):
            entry: dict = {
                "$type": "InputTestCaseV1",
                "sourceId": item.get("sourceId", ""),
                "disabled": item.get("disabled", False),
            }
            if item.get("parameters"):
                entry["parameters"] = item["parameters"]
            if item.get("characteristics"):
                entry["characteristics"] = item["characteristics"]
            input_items.append(entry)

    try:
        client.update_playlist(
            playlist_id,
            name=data.get("name", playlist_id),
            description=data.get("description", ""),
            run_mode=data.get("runMode", "parallel"),
            items=input_items or None,
            parameters=data.get("parameters") or None,
            characteristics=chars,
            upload_recordings=data.get("uploadRecordingsOnSuccess"),
        )
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json({"playlistId": playlist_id, "characteristic": {"name": char_name, "value": char_value}})
    else:
        console.print(f"[green]✓ Playlist {playlist_id}:[/green] "
                      f"characteristic [bold]{char_name}[/bold] = [cyan]{char_value}[/cyan]")


@playlists_app.command("attach-case")
def playlists_attach_case(
    playlist_id:  str = typer.Argument(..., help="Playlist Id"),
    case_id:      str = typer.Argument(..., help="Test case Id (Inventory entityId) to attach"),
    param:        Optional[List[str]] = typer.Option(None, "--param", "-p",
                                                     help="Parameter override key=value (repeatable)"),
    skip_confirm: bool = typer.Option(False, "--skip-confirm",
                                      help="Skip the post-PUT confirm-GET"),
):
    """
    Attach a test case to an existing playlist (append to items[]).

    Handles the TestCaseV1 → InputTestCaseV1 reshape that the PUT endpoint
    requires, so you never have to clone existing items by hand.

    Example:
      tosca playlists attach-case <pid> <tcid> -p url=https://… -p user=qa1
    """
    client = ToscaClient()
    try:
        data = client.get_playlist(playlist_id)
    except ToscaError as e:
        _exit_err(f"Could not load playlist {playlist_id}: {e}")

    existing = _playlist_items_to_input(data.get("items") or [])
    if any(it.get("sourceId") == case_id for it in existing):
        console.print(
            f"[yellow]⚠[/yellow] Test case {case_id} is already attached to playlist {playlist_id}. "
            f"Use `playlists update --json-file` to reorder or edit params."
        )
        raise typer.Exit(0)

    params_dict = _parse_kv_pairs(param)
    new_entry: dict = {
        "$type":    "InputTestCaseV1",
        "sourceId": case_id,
        "disabled": False,
    }
    if params_dict:
        new_entry["parameters"] = [{"name": k, "value": v} for k, v in params_dict.items()]
    existing.append(new_entry)

    try:
        client.update_playlist(
            playlist_id,
            name=data.get("name", playlist_id),
            description=data.get("description", ""),
            run_mode=data.get("runMode", "parallel"),
            items=existing,
            parameters=data.get("parameters") or None,
            characteristics=data.get("characteristics") or None,
            upload_recordings=data.get("uploadRecordingsOnSuccess"),
        )
    except ToscaError as e:
        _exit_err(f"PUT failed: {e}")

    console.print(
        f"[green]✓ Attached[/green] test case [cyan]{case_id}[/cyan] to "
        f"playlist [cyan]{playlist_id}[/cyan] (now {len(existing)} items)"
    )

    if skip_confirm:
        return
    try:
        fresh = client.get_playlist(playlist_id)
    except ToscaError as e:
        _exit_err(f"Confirm-GET failed after PUT: {e}")
    fresh_ids = [it.get("sourceId") for it in fresh.get("items") or []]
    if case_id not in fresh_ids:
        _exit_err(
            f"Confirm: test case {case_id} not in playlist.items after PUT. "
            f"Current sourceIds: {fresh_ids}"
        )
    console.print(f"[green]✓ confirmed[/green] playlist {playlist_id} now references {case_id}")


@playlists_app.command("delete")
def playlists_delete(
    playlist_id: str  = typer.Argument(..., help="Playlist Id"),
    force:       bool = typer.Option(False, "--force", "-y", help="Skip confirmation"),
):
    """Delete a playlist (returns 202 Accepted)."""
    if not force:
        confirmed = Confirm.ask(f"Delete playlist [bold red]{playlist_id}[/bold red]?")
        if not confirmed:
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.delete_playlist(playlist_id)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]\u2713 Deletion accepted for playlist {playlist_id}[/green]")


@playlists_app.command("run")
def playlists_run(
    playlist_id:     str           = typer.Argument(..., help="Playlist Id"),
    private:         bool          = typer.Option(False, "--private", help="Personal run (not visible to others)"),
    param_overrides: Optional[str] = typer.Option(None, "--param-overrides",
                                                   help='JSON object of parameter overrides, e.g. \'{"paramName":"value"}\''),
    wait:            bool          = typer.Option(False, "--wait",    help="Poll until run reaches terminal state"),
    poll:            int           = typer.Option(15,    "--poll",    help="Polling interval in seconds (with --wait)"),
    as_json:         bool          = typer.Option(False, "--json",    help="Raw JSON output"),
):
    """
    Trigger a playlist run.

    With [bold]--wait[/bold] the command polls until the run reaches a terminal
    state (succeeded / failed / canceled) then prints JUnit results.
    """
    client = ToscaClient()
    try:
        override_list: list[dict] = []
        if param_overrides:
            try:
                ov = json.loads(param_overrides)
                override_list = [{"name": k, "value": str(v)} for k, v in ov.items()]
            except (json.JSONDecodeError, AttributeError) as e:
                _exit_err(f"Invalid JSON for --param-overrides: {e}")
        result = client.run_playlist(playlist_id, private=private,
                                     parameter_overrides=override_list or None)
    except ToscaError as e:
        _exit_err(str(e))

    # PlaylistRunCreationOutputV1 returns { id }
    run_id = result.get("id", "")

    if as_json and not wait:
        _output_json(result)
        return

    console.print(f"[green]✓ Playlist run triggered[/green] – RunId: [cyan]{run_id}[/cyan]")
    if run_id:
        console.print(f"  Check status:  tosca playlists status {run_id}")
        console.print(f"  Get results:   tosca playlists results {run_id}")

    if not wait or not run_id:
        return

    TERMINAL = {"succeeded", "failed", "canceled"}
    console.print(f"[dim]Polling every {poll}s …[/dim]")
    state = "unknown"
    while True:
        time.sleep(poll)
        try:
            status_data = client.get_run_status(run_id)
        except ToscaError as e:
            _exit_err(str(e))
        state = status_data.get("state", "unknown").lower()
        console.print(f"  State: [yellow]{state}[/yellow]")
        if state in TERMINAL:
            break

    colour = {"succeeded": "green", "failed": "red", "canceled": "yellow"}.get(state, "white")
    console.print(f"\nFinal state: [{colour}]{state.upper()}[/{colour}]")
    if state != "canceled":
        _print_run_results(client, run_id)


@playlists_app.command("status")
def playlists_status(
    run_id:  str  = typer.Argument(..., help="Run Id (returned by 'playlists run')"),
    as_json: bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Get the current status of a playlist run."""
    client = ToscaClient()
    try:
        data = client.get_run_status(run_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(data)
        return

    # RunStateV1 values are lowercase: pending|running|canceling|succeeded|failed|canceled|unknown
    state  = data.get("state", "unknown")
    colour = {"succeeded": "green", "failed": "red", "running": "yellow",
              "pending": "blue", "canceled": "dim", "canceling": "dim"}.get(state, "white")
    console.print(Panel(
        f"RunId:        [cyan]{run_id}[/cyan]\n"
        f"State:        [{colour}]{state}[/{colour}]\n"
        f"PlaylistId:   {data.get('playlistId', '')}\n"
        f"PlaylistName: {data.get('playlistName', '')}\n"
        f"Private:      {data.get('private', '')}\n"
        f"CreatedBy:    {data.get('createdBy', '')}\n"
        f"CreatedAt:    {data.get('createdAt', '')}\n"
        f"UpdatedAt:    {data.get('updatedAt', '')}",
        title="Playlist Run Status",
        border_style=colour,
    ))


@playlists_app.command("cancel")
def playlists_cancel(
    run_id:      str           = typer.Argument(..., help="Run Id"),
    reason:      Optional[str] = typer.Option("",    "--reason", help="Cancellation reason"),
    hard_cancel: bool          = typer.Option(False, "--hard",   help="Hard cancel (immediate stop)"),
    force:       bool          = typer.Option(False, "--force",  "-y", help="Skip confirmation"),
):
    """Cancel a running playlist run."""
    if not force:
        confirmed = Confirm.ask(f"Cancel run [bold red]{run_id}[/bold red]?")
        if not confirmed:
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.cancel_run(run_id, reason=reason or "", hard_cancel=hard_cancel)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Cancel requested for run {run_id}[/green]")


def _print_run_results(client: ToscaClient, run_id: str) -> None:
    """Shared helper: fetch JUnit JSON and print a summary table."""
    try:
        data = client.get_run_junit(run_id)
    except ToscaError as e:
        _exit_err(str(e))

    total    = data.get("tests",    0)
    failures = data.get("failures", 0)
    errors   = data.get("errors",   0)

    rows: list[list] = []
    for suite in data.get("testSuiteElements", []):
        suite_name = suite.get("name", "")
        for tc in suite.get("testCases", []):
            status = tc.get("status", "")
            if not status:
                if tc.get("failure"):
                    status = "failed"
                elif tc.get("error"):
                    status = "error"
                elif tc.get("skipped") is not None:
                    status = "skipped"
                else:
                    status = "passed"
            rows.append([
                suite_name,
                tc.get("name", ""),
                tc.get("className", ""),
                status,
                str(tc.get("timeInSeconds", "")),
            ])

    passed = total - failures - errors
    console.print(Panel(
        f"Total: [bold]{total}[/bold]  "
        f"Passed: [green]{passed}[/green]  "
        f"Failed: [red]{failures}[/red]  "
        f"Errors: [yellow]{errors}[/yellow]",
        title="JUnit Results Summary",
        border_style="cyan",
    ))
    if rows:
        console.print(_table("Test Case Results",
                             ["Suite", "Name", "ClassName", "Status", "Time(s)"], rows))


@playlists_app.command("results")
def playlists_results(
    run_id:  str           = typer.Argument(..., help="Run Id"),
    save:    Optional[str] = typer.Option(None, "--save", help="Save JUnit JSON to this file path"),
    as_json: bool          = typer.Option(False, "--json", help="Print raw JUnit JSON"),
):
    """Fetch and display JUnit results for a completed playlist run."""
    client = ToscaClient()
    try:
        data = client.get_run_junit(run_id)
    except ToscaError as e:
        _exit_err(str(e))

    if save:
        Path(save).write_text(json.dumps(data, indent=2))
        console.print(f"[green]JUnit JSON saved to[/green] {save}")
        return

    if as_json:
        _output_json(data)
        return

    _print_run_results(client, run_id)


def _resolve_execution_id(client: ToscaClient, run_id: str, is_execution_id: bool) -> str:
    """Return an E2G executionId. If is_execution_id is False, look up the playlist run
    and read its `executionId` field — that is the ID E2G keys on (NOT the run's own id)."""
    if is_execution_id:
        return run_id
    try:
        status = client.get_run_status(run_id)
    except ToscaError as e:
        _exit_err(f"Could not look up playlist run {run_id}: {e}")
    exec_id = status.get("executionId", "")
    if not exec_id:
        _exit_err(f"Playlist run {run_id} has no executionId yet (state={status.get('state')}).")
    return exec_id


@playlists_app.command("logs")
def playlists_logs(
    run_id:          str           = typer.Argument(..., help="Playlist run Id (default) or E2G execution Id with -e"),
    is_execution_id: bool          = typer.Option(False, "--execution-id", "-e",
                                                  help="Treat the input as an E2G executionId already"),
    save_dir:        Optional[str] = typer.Option(None, "--save", help="Save all attachments under this directory"),
    quiet:           bool          = typer.Option(False, "--quiet", "-q",
                                                  help="Do not print log content (use with --save)"),
):
    """Download per-unit agent logs (and optionally all attachments) for a playlist run.

    Walks: PlaylistRun.executionId → /_e2g/api/executions/{id} → units[] →
    /units/{unitId}/attachments → SAS-signed Azure Blob downloads (no auth).
    """
    client = ToscaClient()
    exec_id = _resolve_execution_id(client, run_id, is_execution_id)
    try:
        execution = client.get_execution(exec_id)
    except ToscaError as e:
        _exit_err(f"GET /_e2g/api/executions/{exec_id} failed: {e}")

    units = execution.get("items", [])
    if not units:
        console.print(f"[yellow]No units in execution {exec_id}[/yellow]")
        return

    out_root = Path(save_dir) if save_dir else None
    for unit in units:
        uid     = unit.get("id", "")
        uname   = unit.get("name", "")
        ustate  = unit.get("state", "")
        console.print(Panel.fit(f"[bold]{uname}[/bold]\n"
                                f"unit={uid}  state={ustate}  agent={unit.get('assignedAgentId','')}",
                                border_style="cyan"))
        try:
            attachments = client.list_unit_attachments(exec_id, uid)
        except ToscaError as e:
            console.print(f"[red]list attachments failed: {e}[/red]")
            continue

        for att in attachments:
            name = att.get("name", "")
            ext  = att.get("fileExtension", "")
            url  = att.get("contentDownloadUri", "")
            if not url:
                continue
            try:
                blob = client.download_blob(url)
            except ToscaError as e:
                console.print(f"[red]download {name}.{ext} failed: {e}[/red]")
                continue

            if out_root is not None:
                target = out_root / exec_id / uid / f"{name}.{ext}"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(blob)
                console.print(f"  [green]saved[/green] {target}  ({len(blob)} bytes)")

            if not quiet and name == "logs":
                console.print(f"\n[dim]----- {name}.{ext} ({len(blob)} bytes) -----[/dim]")
                try:
                    console.print(blob.decode("utf-8", errors="replace"))
                except Exception:
                    console.print(f"[dim]<binary {len(blob)} bytes>[/dim]")


@playlists_app.command("attachments")
def playlists_attachments(
    run_id:          str  = typer.Argument(..., help="Playlist run Id (default) or E2G execution Id with -e"),
    is_execution_id: bool = typer.Option(False, "--execution-id", "-e",
                                         help="Treat the input as an E2G executionId already"),
    as_json:         bool = typer.Option(False, "--json", help="Raw JSON output (one record per unit)"),
):
    """List attachments (logs.txt, TBoxResults.tas, JUnit.xml, Recording.mp4, …) per unit
    with their SAS-signed download URLs (TTL ~30 min, valid without auth header)."""
    client = ToscaClient()
    exec_id = _resolve_execution_id(client, run_id, is_execution_id)
    try:
        execution = client.get_execution(exec_id)
    except ToscaError as e:
        _exit_err(f"GET /_e2g/api/executions/{exec_id} failed: {e}")

    payload = []
    for unit in execution.get("items", []):
        uid = unit.get("id", "")
        try:
            attachments = client.list_unit_attachments(exec_id, uid)
        except ToscaError as e:
            attachments = [{"error": str(e)}]
        payload.append({
            "unitId":      uid,
            "name":        unit.get("name", ""),
            "state":       unit.get("state", ""),
            "attachments": attachments,
        })

    if as_json:
        _output_json(payload)
        return

    for entry in payload:
        console.print(Panel.fit(f"[bold]{entry['name']}[/bold]\n"
                                f"unit={entry['unitId']}  state={entry['state']}",
                                border_style="cyan"))
        rows = [
            [a.get("name", ""), a.get("fileExtension", ""),
             (a.get("contentDownloadUri", "") or "")[:90] + "…"]
            for a in entry["attachments"]
        ]
        console.print(_table("Attachments", ["Name", "Ext", "SAS URL (truncated)"], rows))


@playlists_app.command("tc-runs")
def playlists_tc_runs(
    run_id:  str  = typer.Argument(..., help="Run Id"),
    limit:   int  = typer.Option(100, "--limit", "-n", help="Max results"),
    as_json: bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """List individual test case run results for a playlist run."""
    client = ToscaClient()
    try:
        items = client.list_test_case_runs(run_id, limit=limit)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(items)
        return

    rows = [
        [i.get("id", ""), i.get("testCaseId", ""), i.get("displayName", ""),
         i.get("state", ""), i.get("updatedAt", "")]
        for i in items
    ]
    console.print(_table(f"Test Case Runs for {run_id} ({len(rows)})",
                         ["Id", "TestCaseId", "Name", "State", "UpdatedAt"], rows))


@playlists_app.command("list-runs")
def playlists_list_runs(
    limit:   int  = typer.Option(50,    "--limit", "-n", help="Max results"),
    as_json: bool = typer.Option(False, "--json",        help="Raw JSON output"),
):
    """List all playlist runs in the space."""
    client = ToscaClient()
    try:
        result = client.list_runs(limit=limit)
    except ToscaError as e:
        _exit_err(str(e))
    items = result.get("items", [])
    if as_json:
        _output_json(items)
        return
    rows = [
        [i.get("id", ""), i.get("playlistName", ""), i.get("state", ""),
         i.get("createdBy", ""), (i.get("createdAt") or "")[:10]]
        for i in items
    ]
    console.print(_table(f"Playlist Runs ({len(rows)})",
                         ["Id", "PlaylistName", "State", "CreatedBy", "Created"], rows))


@playlists_app.command("delete-run")
def playlists_delete_run(
    run_id: str  = typer.Argument(..., help="Run Id"),
    force:  bool = typer.Option(False, "--force", "-y", help="Skip confirmation"),
):
    """Delete a playlist run (returns 202 Accepted)."""
    if not force:
        confirmed = Confirm.ask(f"Delete run [bold red]{run_id}[/bold red]?")
        if not confirmed:
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.delete_run(run_id)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]\u2713 Deletion accepted for run {run_id}[/green]")


# ---------------------------------------------------------------------------
# inventory commands (Inventory API v3)
# ---------------------------------------------------------------------------

@inventory_app.command("move")
def inventory_move(
    artifact_type: str  = typer.Argument(..., help="Artifact type (e.g. testCase, Module, folder)"),
    entity_id:     str  = typer.Argument(..., help="Entity Id of the artifact to move"),
    folder_id:     str  = typer.Option(..., "--folder-id", "-f",
                                       help="Entity Id of the target folder (from the portal URL or "
                                            "'inventory get Folder <id> --include-ancestors')"),
):
    """
    Move an inventory artifact into a folder.

    The folder entity Id is the UUID shown in the portal URL:
      .../inventory/artifacts/<folder-entity-id>

    Example:
      tosca inventory move testCase <testCaseEntityId> --folder-id 00000000-0000-0000-0000-000000000000
    """
    client = ToscaClient()
    try:
        artifact = client.get_inventory_artifact(artifact_type, entity_id)
    except ToscaError as e:
        _exit_err(str(e))
    art_id = artifact.get("id")
    if not art_id:
        _exit_err("Could not resolve artifact id — check type and entityId")
    try:
        client.move_to_folder([art_id], folder_id)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(
        f"[green]\u2713 Moved[/green] [bold]{artifact.get('name', entity_id)}[/bold] "
        f"([cyan]{artifact_type}/{entity_id}[/cyan]) "
        f"\u2192 folder [cyan]{folder_id}[/cyan]"
    )


@inventory_app.command("create-folder")
def inventory_create_folder(
    name:      str           = typer.Option(..., "--name", "-n", help="New folder name"),
    parent_id: Optional[str] = typer.Option(None, "--parent-id", "-p",
                                            help="Entity Id of the parent folder (omit for root)"),
    desc:      str           = typer.Option("", "--desc", "-d", help="Description"),
):
    """
    Create a new inventory folder.

    Uses the undocumented v1 portal API:
      POST /{spaceId}/_inventory/api/v1/folders

    Example:
      tosca inventory create-folder --name "Regression" --parent-id "00000000-0000-0000-0000-000000000000"
    """
    client = ToscaClient()
    try:
        result = client.create_folder(name, parent_folder_id=parent_id, description=desc)
    except ToscaError as e:
        _exit_err(str(e))
    new_id = (result.get("key") or {}).get("entityId", "")
    console.print(f"[green]✓ Folder created[/green]: [bold]{name}[/bold]  id=[cyan]{new_id}[/cyan]")


@inventory_app.command("rename-folder")
def inventory_rename_folder(
    folder_id: str = typer.Argument(..., help="Entity Id of the folder to rename"),
    name:      str = typer.Option(..., "--name", "-n", help="New name"),
):
    """
    Rename an inventory folder.

    Uses the undocumented v1 portal API:
      PATCH /{spaceId}/_inventory/api/v1/folders/{folderId}

    Example:
      tosca inventory rename-folder "00000000-0000-0000-0000-000000000000" --name "New Name"
    """
    client = ToscaClient()
    try:
        client.rename_folder(folder_id, name)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Folder[/green] [cyan]{folder_id}[/cyan] renamed to [bold]{name}[/bold]")


@inventory_app.command("delete-folder")
def inventory_delete_folder(
    folder_id:     str  = typer.Argument(..., help="Entity Id of the folder to delete"),
    delete_children: bool = typer.Option(False,  "--delete-children",
                                         help="Recursively delete contents (default: move to parent)"),
    force:         bool  = typer.Option(False, "--force", "-y",
                                        help="Skip confirmation prompt"),
):
    """
    Delete an inventory folder.

    By default child artifacts are moved to the parent folder (ungroup).
    Pass --delete-children to delete recursively.

    Uses the undocumented v1 portal API:
      DELETE /{spaceId}/_inventory/api/v1/folders/{folderId}

    Example:
      tosca inventory delete-folder "00000000-0000-0000-0000-000000000000"
      tosca inventory delete-folder "019cb7d8-..." --delete-children --force
    """
    behavior = "deleteRecursively" if delete_children else "moveToParent"
    action_label = "delete recursively" if delete_children else "ungroup (move children to parent)"
    if not force:
        if not Confirm.ask(f"[yellow]Delete folder {folder_id} — {action_label}?[/yellow]"):
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.delete_folder(folder_id, child_behavior=behavior)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Folder[/green] [cyan]{folder_id}[/cyan] deleted ({action_label})")


@inventory_app.command("folder-ancestors")
def inventory_folder_ancestors(
    folder_id: str  = typer.Argument(..., help="Entity Id of the folder"),
    as_json:   bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """
    Get the ancestor chain (breadcrumb path) of a folder.

    Uses the undocumented v1 portal API:
      GET /{spaceId}/_inventory/api/v1/folders/{folderId}/ancestors

    Example:
      tosca inventory folder-ancestors "00000000-0000-0000-0000-000000000000"
    """
    client = ToscaClient()
    try:
        ancestors = client.get_folder_ancestors(folder_id)
    except ToscaError as e:
        _exit_err(str(e))
    if as_json:
        _output_json(ancestors)
        return
    if not ancestors:
        console.print("[dim]No ancestors (folder is at root).[/dim]")
        return
    path_str = " > ".join(a.get("name", a.get("id", "?")) for a in ancestors)
    console.print(f"[bold]Path:[/bold] {path_str}")
    rows = [[a.get("id", ""), a.get("name", ""), a.get("type", "")] for a in ancestors]
    console.print(_table(f"Ancestors of {folder_id}", ["Id", "Name", "Type"], rows))


@inventory_app.command("folder-tree")
def inventory_folder_tree(
    folder_ids: str           = typer.Option("", "--folder-ids", "-f",
                                             help="Comma-separated folder Entity Ids to scope the tree "
                                                  "(omit for full tree)"),
    as_json:    bool          = typer.Option(False, "--json", help="Raw JSON output"),
):
    """
    List the folder tree from the inventory.

    Uses the undocumented v1 portal API:
      POST /{spaceId}/_inventory/api/v1/folders/tree-items

    Example:
      tosca inventory folder-tree
      tosca inventory folder-tree --folder-ids "id1,id2"
    """
    ids = [i.strip() for i in folder_ids.split(",") if i.strip()] if folder_ids else None
    client = ToscaClient()
    try:
        items = client.list_folder_tree(folder_ids=ids)
    except ToscaError as e:
        _exit_err(str(e))
    if as_json:
        _output_json(items)
        return
    if not items:
        console.print("[dim]No folders found.[/dim]")
        return
    rows = [
        [i.get("id", ""), i.get("name", ""), i.get("parentId", ""),
         str(i.get("childCount", ""))]
        for i in items
    ]
    console.print(_table(f"Folder Tree ({len(rows)} folders)",
                         ["Id", "Name", "ParentId", "ChildCount"], rows))


@inventory_app.command("search")
def inventory_search(
    query:            str           = typer.Argument(..., help="Name search text (use '' (empty) for all)"),
    artifact_type:    Optional[str] = typer.Option(None,  "--type",             "-t",
                                                   help="Artifact type filter (e.g. TestCase, Module)"),
    folder_id:        Optional[str] = typer.Option(None,  "--folder-id",        "-f",
                                                   help="Scope results to this folder entityId (client-side filter on folderKey)"),
    limit:            int           = typer.Option(50,    "--limit",            "-n", help="Max results"),
    include_ancestors: bool         = typer.Option(False, "--include-ancestors", "-a",
                                                   help="Populate ancestors[] breadcrumb on each result"),
    as_json:          bool          = typer.Option(False, "--json",             help="Raw JSON output"),
):
    """
    Search for artifacts in the Inventory.

    Uses POST /artifacts/search with a DocumentSearchRequestV1 body.
    If --type is provided, searches within that artifact type only.
    Use --folder-id to scope results to a specific folder (filters client-side by folderKey).
    """
    client = ToscaClient()
    try:
        items = client.search_inventory(query, artifact_type=artifact_type, limit=limit,
                                        include_ancestors=include_ancestors,
                                        folder_id=folder_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(items)
        return

    def _fmt_id(i: dict) -> str:
        aid = i.get("id", {})
        if isinstance(aid, dict):
            return f"{aid.get('type', '')}:{aid.get('entityId', '')}"
        return str(aid)

    rows = [
        [_fmt_id(i), i.get("name", ""), i.get("description", ""),
         i.get("createdBy", ""), (i.get("createdAt") or "")[:10]]
        for i in items
    ]
    console.print(_table(f"Inventory search '{query}' – {len(rows)} results",
                         ["Id (type:entityId)", "Name", "Description", "CreatedBy", "Created"], rows))


@inventory_app.command("get")
def inventory_get(
    artifact_type:    str  = typer.Argument(..., help="Artifact type (e.g. TestCase, Module)"),
    entity_id:        str  = typer.Argument(..., help="Entity Id"),
    include_ancestors: bool = typer.Option(False, "--include-ancestors", "-a",
                                           help="Populate ancestors[] breadcrumb"),
    as_json:          bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """
    Get details for a specific Inventory artifact.

    Usage: tosca inventory get TestCase <entity-id>
    """
    client = ToscaClient()
    try:
        data = client.get_inventory_artifact(artifact_type, entity_id,
                                             include_ancestors=include_ancestors)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(data)
        return

    aid = data.get("id", {})
    console.print(Panel(
        f"[bold]{data.get('name', entity_id)}[/bold]\n"
        f"[dim]Type:[/dim]         {aid.get('type', artifact_type) if isinstance(aid, dict) else artifact_type}\n"
        f"[dim]EntityId:[/dim]     {aid.get('entityId', entity_id) if isinstance(aid, dict) else entity_id}\n"
        f"[dim]SpaceId:[/dim]      {aid.get('spaceId', '') if isinstance(aid, dict) else ''}\n"
        f"[dim]Description:[/dim]  {data.get('description', '')}\n"
        f"[dim]CreatedBy:[/dim]    {data.get('createdBy', '')}\n"
        f"[dim]CreatedAt:[/dim]    {data.get('createdAt', '')}\n"
        f"[dim]FolderKey:[/dim]    {data.get('folderKey', '')}\n"
        f"[dim]Tags:[/dim]         {', '.join(t.get('value', '') for t in (data.get('tags') or []))}",
        title="Inventory Artifact",
        border_style="cyan",
    ))
    anc = data.get("ancestors") or []
    if anc:
        console.print("[dim]Path:[/dim] " + " \u203a ".join(a.get("name", "") for a in anc))


# ---------------------------------------------------------------------------
# simulations commands
# ---------------------------------------------------------------------------

@simulations_app.command("list")
def simulations_list(
    tags:    Optional[str] = typer.Option(None, "--tags", "-t",
                                          help="Comma-separated file tags to filter by"),
    as_json: bool          = typer.Option(False, "--json", help="Raw JSON output"),
):
    """List simulation files in the space."""
    client = ToscaClient()
    tag_list = [t.strip() for t in tags.split(",")] if tags else None
    try:
        items = client.list_simulation_files(file_tags=tag_list)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(items)
        return

    rows = [
        [i.get("id", ""), i.get("name", ""), f"{i.get('sizeInKB', '')} KB",
         ", ".join(i.get("fileTags", [])), i.get("updatedAt", "")]
        for i in items
    ]
    console.print(_table(f"Simulation Files ({len(rows)})",
                         ["Id", "Name", "Size", "Tags", "UpdatedAt"], rows))


@simulations_app.command("get")
def simulations_get(
    file_id: str  = typer.Argument(..., help="File Id"),
    as_json: bool = typer.Option(False, "--json", help="Raw JSON output"),
):
    """Get details for a simulation file."""
    client = ToscaClient()
    try:
        data = client.get_simulation_file(file_id)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(data)
        return

    console.print(Panel(
        f"[bold]{data.get('name', file_id)}[/bold]\n"
        f"[dim]Id:[/dim]        {data.get('id', file_id)}\n"
        f"[dim]Size:[/dim]      {data.get('sizeInKB', '')} KB\n"
        f"[dim]Tags:[/dim]      {', '.join(data.get('fileTags', []))}\n"
        f"[dim]CreatedAt:[/dim] {data.get('createdAt', '')}\n"
        f"[dim]UpdatedAt:[/dim] {data.get('updatedAt', '')}",
        title="Simulation File",
        border_style="cyan",
    ))


@simulations_app.command("create")
def simulations_create(
    name:       str           = typer.Option(...,  "--name",       "-n", help="File name"),
    file:       str           = typer.Option(...,  "--file",       "-f", help="Path to file to upload"),
    tags:       Optional[str] = typer.Option(None, "--tags",       "-t", help="Comma-separated tags"),
    components: Optional[str] = typer.Option(
        None, "--components", "-c",
        help="Comma-separated component types to include: "
             "Services,Runnables,Connections,Resources,Includes,Templates",
    ),
    as_json:    bool          = typer.Option(False, "--json",            help="Raw JSON output"),
):
    """Upload a simulation file (content is base64-encoded automatically)."""
    import base64
    src = Path(file)
    if not src.exists():
        _exit_err(f"File not found: {file}")

    content_b64 = base64.b64encode(src.read_bytes()).decode()
    tag_list  = [t.strip() for t in tags.split(",")]       if tags       else None
    comp_list = [c.strip() for c in components.split(",")] if components else None

    client = ToscaClient()
    try:
        result = client.create_simulation_file(name, content_b64, file_tags=tag_list,
                                               components=comp_list)
    except ToscaError as e:
        _exit_err(str(e))

    if as_json:
        _output_json(result)
        return

    uid = result.get("id", "?")
    console.print(f"[green]✓ Uploaded simulation file[/green] [bold]{name}[/bold] → Id: [cyan]{uid}[/cyan]")


@simulations_app.command("delete")
def simulations_delete(
    file_id: str  = typer.Argument(..., help="File Id"),
    force:   bool = typer.Option(False, "--force", "-y", help="Skip confirmation"),
):
    """Delete a simulation file (returns 202 Accepted)."""
    if not force:
        confirmed = Confirm.ask(f"Delete simulation file [bold red]{file_id}[/bold red]?")
        if not confirmed:
            raise typer.Abort()
    client = ToscaClient()
    try:
        client.delete_simulation_file(file_id)
    except ToscaError as e:
        _exit_err(str(e))
    console.print(f"[green]✓ Deletion accepted for simulation file {file_id}[/green]")


# ---------------------------------------------------------------------------
# AI-assisted "ask" command  (requires openai package + TOSCA_OPENAI_KEY)
# ---------------------------------------------------------------------------

@app.command("ask")
def ask_cmd(
    question: str = typer.Argument(..., help="Natural-language question about your TOSCA workspace"),
    dry_run:  bool = typer.Option(False, "--dry-run", "-d",
                                  help="Show the generated command without executing it"),
):
    """
    [bold yellow]AI assistant[/bold yellow] – translate a plain-English question into a TOSCA
    query and execute it automatically.

    Requires:
      • openai package:  pip install openai
      • API key set:     tosca config set  (or env TOSCA_OPENAI_KEY / OPENAI_API_KEY)
    """
    try:
        import openai  # type: ignore
    except ImportError:
        _exit_err("The 'openai' package is required for this command.\n"
                  "Install with:  pip install openai")

    api_key = os.getenv("TOSCA_OPENAI_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        _exit_err("OpenAI API key not found.\n"
                  "Set it with:  tosca config set  (key: TOSCA_OPENAI_KEY)\n"
                  "or export OPENAI_API_KEY=sk-...")

    openai.api_key = api_key

    system_prompt = """You are a Tricentis TOSCA Cloud CLI assistant. The user asks questions
about their TOSCA Cloud workspace. Map each question to a single CLI command from the list
below and return ONLY the exact command string — no explanation, no markdown:

  tosca identity apps
  tosca identity secrets    <appId>
  tosca identity new-secret <appId>
  tosca identity get-secret <appId> <secretId>

  tosca cases  get    <id>
  tosca cases  steps  <id>
  tosca cases  create --name <name> [--desc <desc>] [--state Planned|InWork|Completed]
  tosca cases  update <id> --json-file <path>
  tosca cases  patch  <id> --operations '<json_array>'
  tosca cases  delete <id>

  tosca modules get    <id>
  tosca modules create --name <name> [--desc <desc>] [--iface Gui|NonGui]
  tosca modules delete <id>

  tosca blocks get             <id>
  tosca blocks add-param       <id> --name <name> [--desc <desc>] [--value-range '1,2,3,4']
  tosca blocks set-value-range <id> <paramName> --values '1,2,3,4'
  tosca blocks delete          <id>

  tosca playlists list       [--search <query>] [--limit N]
  tosca playlists get        <id>
  tosca playlists create     --name <name> [--run-mode parallel|sequential|sequentialOnSameAgent]
  tosca playlists update              <id> --name <name>
  tosca playlists set-characteristic  <id> --name <key> --value <val>
  tosca playlists delete              <id>
  tosca playlists run        <playlistId> [--wait] [--private] [--param-overrides '{"p":"v"}']
  tosca playlists status     <runId>
  tosca playlists cancel     <runId>
  tosca playlists results    <runId> [--save <file>]
  tosca playlists tc-runs    <runId>
  tosca playlists list-runs  [--limit N]
  tosca playlists delete-run <runId>

  tosca inventory search <query> [--type <type>] [--limit N] [--include-ancestors]
  tosca inventory get    <type> <entityId> [--include-ancestors]
  tosca inventory move   <type> <entityId> --folder-id <folderEntityId>

  tosca simulations list   [--tags <tag1,tag2>]
  tosca simulations get    <id>
  tosca simulations create --name <name> --file <path> [--tags <tags>] [--components <list>]
  tosca simulations delete <id>

Replace placeholders with real values from the question when provided.
If the request cannot be mapped to a single command, reply with: CANNOT_HANDLE"""

    console.print(f"[dim]Asking AI: {question}[/dim]")
    try:
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": question},
            ],
            temperature=0,
            max_tokens=200,
        )
    except Exception as e:
        _exit_err(f"OpenAI API error: {e}")

    cmd = response.choices[0].message.content.strip()

    if cmd == "CANNOT_HANDLE" or not cmd.startswith("tosca "):
        console.print("[yellow]AI could not map that question to a CLI command.[/yellow]")
        console.print(f"Raw AI response: {cmd}")
        return

    console.print(Panel(f"[bold cyan]{cmd}[/bold cyan]", title="Generated Command"))

    if dry_run:
        console.print("[dim]Dry-run mode – command not executed.[/dim]")
        return

    # Execute the generated command by re-invoking the CLI via subprocess
    import shlex
    import subprocess

    args = shlex.split(cmd)
    # Strip the leading "tosca" token (the script name)
    if args[0] == "tosca":
        args = args[1:]

    console.print("[dim]Executing…[/dim]\n")
    result = subprocess.run(
        [sys.executable, __file__] + args,
        capture_output=False,
    )
    if result.returncode != 0:
        raise typer.Exit(result.returncode)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app()
