import profile from "../data/company-profile.json";

/** Owner-confirmed company card; accounts stay strings, including the leading zero in BIC. */
export const COMPANY_PROFILE = Object.freeze({
  ...profile, bank: Object.freeze(profile.bank), director: Object.freeze(profile.director),
});

const fields: Readonly<Record<string, string>> = Object.freeze({
  shortName: profile.shortName, fullName: profile.fullName, legalAddress: profile.legalAddress,
  inn: profile.inn, kpp: profile.kpp, ogrn: profile.ogrn, settlementAccount: profile.settlementAccount,
  "bank.name": profile.bank.name, "bank.inn": profile.bank.inn, "bank.bic": profile.bank.bic,
  "bank.correspondentAccount": profile.bank.correspondentAccount, "bank.legalAddress": profile.bank.legalAddress,
  "director.fullName": profile.director.fullName, "director.position": profile.director.position,
});

/** Fill only explicitly named company slots; existing values and other parties remain verbatim. */
export function fillCompanyDetails(text: string, formatValue: (value: string) => string = value => value): string {
  return text.replace(/\{\{\s*company\.([A-Za-z][A-Za-z0-9.]*)\s*\}\}/g, (slot, key: string) =>
    Object.hasOwn(fields, key) ? formatValue(fields[key]) : slot);
}

export function companyProfileContext(): string {
  return "ПОСТОЯННЫЕ РЕКВИЗИТЫ ООО «СВОИ ЛЮДИ», подтверждённые владельцем. " +
    "Когда для сметы, договора, акта, счёта, КП или другого документа нужны реквизиты компании либо подпись её руководителя, " +
    "сразу используй эту карточку и не запрашивай эти данные повторно. Генеральный директор — Касинич Сергей Юрьевич; " +
    "фамилия исправлена владельцем и должна сохраняться точно. Указывай реквизиты только в нужных по задаче полях и разделах. " +
    "Не подставляй их за заказчика или другую организацию; прямо заданные пользователем иные реквизиты конкретного документа сохраняй. " +
    "Не придумывай налоговый режим, НДС, телефон, email, основание полномочий или фактическую подпись. " +
    "Для явных полей шаблона поддерживаются {{company.inn}}, {{company.settlementAccount}}, {{company.director.fullName}} " +
    "и остальные строковые поля карточки; при обычном составлении документа пиши сами значения.\n" + JSON.stringify(COMPANY_PROFILE);
}
