#!/usr/bin/env python3
"""Read the public project memory over MCP when host-native tools are unavailable."""
import json
import re
import urllib.error
import urllib.request

ENDPOINT = "https://my-gpt-chat-theta.vercel.app/api/mcp"
MAX_RESPONSE_BYTES = 1024 * 1024


def read_memory(endpoint=ENDPOINT):
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}

    def rpc(method, params, identifier=None):
        packet = {"jsonrpc": "2.0", "method": method, "params": params}
        if identifier is not None:
            packet["id"] = identifier
        request = urllib.request.Request(endpoint, data=json.dumps(packet).encode(), headers=headers, method="POST")
        # urllib preserves inherited proxy and OS CA trust. Never disable TLS verification.
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise RuntimeError("MCP response exceeded the bounded read limit")
        if identifier is None:
            return None
        envelope = json.loads(body)
        if envelope.get("id") != identifier or envelope.get("error"):
            raise RuntimeError("MCP returned a protocol error")
        result = envelope["result"]
        if result.get("isError"):
            raise RuntimeError("MCP tool returned an execution error")
        return result

    initialized = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "svoi-lyudi-cloud-memory-reader", "version": "1.0.0"}}, 1)
    version = initialized.get("protocolVersion", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", version):
        raise RuntimeError("MCP did not negotiate a protocol version")
    headers["MCP-Protocol-Version"] = version
    rpc("notifications/initialized", {})
    tools = rpc("tools/list", {}, 2)
    if not any(tool.get("name") == "get_project_memory" for tool in tools.get("tools", [])):
        raise RuntimeError("The server did not advertise get_project_memory")
    response = rpc("tools/call", {"name": "get_project_memory", "arguments": {}}, 3)
    memory = response.get("structuredContent")
    if not isinstance(memory, dict):
        raise RuntimeError("MCP did not return structured project memory")
    status = memory.get("status", {})
    if status.get("source") != "Codebase Memory MCP" or status.get("project") != "svoi-lyudi-builder" or status.get("access") != "public-project-readonly" or not re.fullmatch(r"[a-f0-9]{64}", status.get("fingerprint", "")):
        raise RuntimeError("Unexpected project memory identity")
    if not any(section.get("heading") == "COMPANY DOCUMENT BRANDING" for section in memory.get("sections", [])):
        raise RuntimeError("The document branding rule is missing")
    return {"transport": "direct-mcp-from-cloud", "hostNativeToolRegistration": False, "memory": memory}


if __name__ == "__main__":
    try:
        print(json.dumps(read_memory(), ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        raise SystemExit(f"Project memory could not be read: {type(error).__name__}: {error}")
