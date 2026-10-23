import { createDriveWorkspaceHandler } from "@/lib/server/drive-workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = createDriveWorkspaceHandler();
