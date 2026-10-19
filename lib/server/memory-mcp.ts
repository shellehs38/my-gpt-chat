import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { loadProjectMemory, memoryStatus, searchCodeMemory, type ProjectMemory } from "./project-memory";
import { BodyError, readJsonBody } from "./http";

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const result = (data: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data });

export function createMemoryMcp(memory: ProjectMemory) {
  const server = new McpServer({ name: "svoi-lyudi-codebase-memory", version: "1.0.0" }, { instructions: "Read-only published Codebase Memory snapshot for the construction assistant. Call get_project_memory for company/project rules, search_codebase for symbols, get_file_outline for locations, get_memory_status for freshness. No client data, conversation storage, code execution or writes. State the snapshot revision when discussing code; missing symbols do not prove absence." });
  server.registerTool("get_project_memory", { description: "Общие правила, архитектурные решения и правило логотипа ООО СВОИ ЛЮДИ из Codebase Memory. Прочитайте перед работой с проектом.", inputSchema: {}, annotations }, async () => result({ status: memoryStatus(memory), sections: memory.sections }));
  server.registerTool("get_memory_status", { description: "Источник, версия, ревизия, отпечаток и ограничения общего снимка Codebase Memory.", inputSchema: {}, annotations }, async () => result(memoryStatus(memory)));
  server.registerTool("search_codebase", { description: "Поиск имён функций, классов и типов в опубликованном индексе Codebase Memory; возвращает пути и строки, без исходного кода.", inputSchema: { query: z.string().trim().min(2).max(200), limit: z.number().int().min(1).max(20).default(10) }, annotations }, async ({ query, limit }) => result({ status: memoryStatus(memory), matches: searchCodeMemory(memory, query, limit) }));
  server.registerTool("get_file_outline", { description: "Функции и типы в конкретном файле опубликованного индекса. Читает только экспортированный снимок, не файловую систему.", inputSchema: { path: z.string().min(1).max(200).regex(/^(?:app|components|lib|scripts|tests)\/[\w./-]+\.(?:ts|tsx|mjs)$/), offset: z.number().int().min(0).max(10000).default(0) }, annotations }, async ({ path, offset }) => {
    const all = memory.symbols.filter((symbol) => symbol.file === path);
    return result({ status: memoryStatus(memory), symbols: all.slice(offset, offset + 100), total: all.length, hasMore: offset + 100 < all.length });
  });
  return server;
}

export async function handleMemoryMcp(request: Request, memory?: ProjectMemory): Promise<Response> {
  // This public endpoint exposes only a sanitized export of an already-public repository.
  const origin = request.headers.get("origin");
  if (origin && ![new URL(request.url).origin, "https://chatgpt.com", "https://chat.openai.com"].includes(origin)) return new Response("Origin not allowed", { status: 403 });
  if (request.method !== "POST") return new Response("Use MCP Streamable HTTP POST", { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  let server: McpServer | undefined;
  try {
    const body = await readJsonBody(request, 16 * 1024);
    server = createMemoryMcp(memory ?? loadProjectMemory());
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: body });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof BodyError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Project memory MCP request failed");
    return Response.json({ error: "Project memory unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally { await server?.close(); }
}
