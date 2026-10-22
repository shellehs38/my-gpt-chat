import { getConnectorMetadata } from "@vercel/connect";

// Use the deployment's own workload identity, not a management token or Google secret.
// A failed check prevents promoting a build with an invalid project/connector link.
const connector = process.env.GOOGLE_DRIVE_CONNECTOR_UID?.trim();
if (connector && process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
  try {
    const metadata = await getConnectorMetadata(connector);
    const matches = connector.startsWith("scl_") ? metadata.id === connector : metadata.uid === connector;
    if (!matches) throw new Error("Connector mismatch");
    console.log("Google Drive connector metadata and production project access verified. Owner consent and Drive file access still require a runtime check.");
  } catch {
    // SDK exceptions can include vendor bodies or authorization details.
    console.error("Google Drive connector verification failed. Check GOOGLE_DRIVE_CONNECTOR_UID and this project's Production link in Vercel Connect. No provider tokens were requested.");
    process.exitCode = 1;
  }
}
