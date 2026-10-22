import { createDriveConnectHandlers } from "@/lib/server/drive-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const handlers = createDriveConnectHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
