/** The approved PNG is a static project asset; document exports embed its bytes. */
export const COMPANY_LOGO_URL = "/brand/logo-sl-approved-light.png";
export const COMPANY_NAME = "ООО «СВОИ ЛЮДИ»";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function brandedMarkdown(content: string, origin: string): string {
  const url = new URL(COMPANY_LOGO_URL, origin);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Не удалось определить адрес фирменного логотипа.");
  return `![Логотип СВОИ ЛЮДИ](${url.href})\n\n**${COMPANY_NAME}**\n\n${content}`;
}

export async function loadCompanyLogo(): Promise<string> {
  const response = await fetch(COMPANY_LOGO_URL);
  if (!response.ok) throw new Error("Не удалось загрузить логотип. Повторите выгрузку документа.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 2_000_000 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) throw new Error("Не удалось проверить файл логотипа. Выгрузка остановлена.");
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Export the rendered, edited document rather than a stale model response. */
export function brandedDocumentHtml(content: HTMLElement, logoDataUrl: string, title: string, versionDate: string): string {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(logoDataUrl)) throw new Error("Для документа требуется встроенный фирменный логотип.");
  const clone = content.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".mobile-table-cards").forEach((element) => element.remove());
  const originals = content.querySelectorAll("textarea");
  const copies = clone.querySelectorAll("textarea");
  // Filter the original list too: desktop and mobile controls show the same values.
  const desktopOriginals = [...originals].filter((element) => !element.closest(".mobile-table-cards"));
  copies.forEach((element, index) => {
    const value = clone.ownerDocument.createElement("span");
    value.className = "document-cell";
    value.textContent = desktopOriginals[index]?.value ?? element.value;
    element.replaceWith(value);
  });
  clone.querySelectorAll("script,style,iframe,object,embed,form,button,input,select,link,meta").forEach((element) => element.remove());
  clone.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ["style", "srcdoc", "srcset", "formaction"].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    for (const attribute of ["href", "src"]) {
      const value = element.getAttribute(attribute);
      if (value && !/^(?:https?:\/\/|mailto:|tel:|#)/i.test(value)) element.removeAttribute(attribute);
    }
  });
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)} — СВОИ ЛЮДИ</title>
<style>
*{box-sizing:border-box}body{max-width:1000px;margin:32px auto;padding:0 24px;color:#17221e;background:#fff;font:14px/1.6 Arial,Helvetica,sans-serif}header{text-align:center;margin-bottom:28px;border-bottom:2px solid #176b4b;padding-bottom:18px}header img{width:190px;max-width:100%;height:auto}header h1{font-size:22px;margin:8px 0}header p{margin:4px 0;color:#58665e}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:16px 0}th,td{border:1px solid #cbd7d0;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf4ee}thead{display:table-header-group}.document-cell{white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;height:auto}h2,h3{break-after:avoid}tr{break-inside:avoid}.calculation-summary{padding:12px;background:#eaf4ee}.calculation-incomplete{background:#fff6df}footer{margin-top:28px;border-top:1px solid #cbd7d0;padding-top:12px;color:#58665e;font-size:12px;text-align:center}@page{size:A4;margin:16mm}@media print{body{margin:0;padding:0;max-width:none;font-size:10pt}header img{width:42mm}a{color:inherit;text-decoration:none}}
</style></head><body><header><img src="${logoDataUrl}" alt="Логотип СВОИ ЛЮДИ"><p>${COMPANY_NAME}</p><h1>${escapeHtml(title)}</h1><p>Версия: ${escapeHtml(versionDate)}</p></header><main>${clone.innerHTML}</main><footer>${COMPANY_NAME}. Проверьте исходные данные, цены и условия перед согласованием документа.</footer></body></html>`;
}
