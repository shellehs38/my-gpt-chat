import { loadProjectMemory, publicProjectMemory } from "@/lib/server/project-memory";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(publicProjectMemory(loadProjectMemory()), {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch {
    return Response.json({ error: "Project memory is temporarily unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
