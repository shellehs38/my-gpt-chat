import { getAccessConfig, readSession } from "@/lib/server/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import LeadBoard from "@/components/crm/LeadBoard";

export default async function CrmPage() {
  const config = getAccessConfig();
  const headerBag = await headers();
  const cookie = headerBag.get("cookie") ?? "";
  const request = new Request("https://internal.invalid/crm", { headers: { cookie } });
  if (!config || !readSession(request, config)) redirect("/");
  return <LeadBoard />;
}
