import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("memory_reader", pathlib.Path(__file__).parents[1] / "scripts/read-project-memory.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class MemoryReaderTest(unittest.TestCase):
    def simulate(self, change=None):
        self.requests = []
        memory = {"status": {"source": "Codebase Memory MCP", "project": "svoi-lyudi-builder", "access": "public-project-readonly", "fingerprint": "a" * 64}, "sections": [{"heading": "COMPANY DOCUMENT BRANDING", "content": "Original logo required"}]}

        def send(request, timeout):
            packet = json.loads(request.data)
            self.requests.append((packet, request.headers))
            method = packet["method"]
            if method == "notifications/initialized":
                return io.BytesIO(b"")
            result = {"protocolVersion": "2025-06-18"} if method == "initialize" else {"tools": [{"name": "get_project_memory"}]} if method == "tools/list" else {"structuredContent": memory}
            envelope = {"jsonrpc": "2.0", "id": packet["id"], "result": result}
            if change:
                change(packet, envelope)
            return io.BytesIO(json.dumps(envelope).encode())

        with patch.object(reader.urllib.request, "urlopen", side_effect=send):
            return reader.read_memory()

    def test_protocol_discovery_and_read_are_real_rpc_operations(self):
        value = self.simulate()
        self.assertFalse(value["hostNativeToolRegistration"])
        self.assertEqual([p["method"] for p, _ in self.requests], ["initialize", "notifications/initialized", "tools/list", "tools/call"])
        self.assertEqual(self.requests[-1][0]["params"], {"name": "get_project_memory", "arguments": {}})
        self.assertEqual(self.requests[-1][1]["Mcp-protocol-version"], "2025-06-18")

    def test_protocol_and_execution_errors_do_not_look_like_read_memory(self):
        for replacement in [{"error": {"code": -32603}}, {"id": "wrong"}, {"result": {"isError": True}}]:
            with self.subTest(replacement=replacement):
                def change(packet, value):
                    if packet["method"] == "tools/call":
                        value.update(replacement)
                with self.assertRaises(RuntimeError):
                    self.simulate(change)

    def test_missing_tools_or_wrong_project_or_missing_rule_fail_closed(self):
        for mode in ["tool", "identity", "rule"]:
            with self.subTest(mode=mode):
                def change(packet, value):
                    if mode == "tool" and packet["method"] == "tools/list":
                        value["result"]["tools"] = []
                    if packet["method"] == "tools/call":
                        if mode == "identity":
                            value["result"]["structuredContent"]["status"]["project"] = "other"
                        if mode == "rule":
                            value["result"]["structuredContent"]["sections"] = []
                with self.assertRaises(RuntimeError):
                    self.simulate(change)

    def test_response_read_is_bounded(self):
        with patch.object(reader.urllib.request, "urlopen", return_value=io.BytesIO(b"x" * (reader.MAX_RESPONSE_BYTES + 1))):
            with self.assertRaises(RuntimeError):
                reader.read_memory()
