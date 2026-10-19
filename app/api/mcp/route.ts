import { handleMemoryMcp } from "@/lib/server/memory-mcp";

export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleMemoryMcp(request); }
export const GET = POST;
export const DELETE = POST;
