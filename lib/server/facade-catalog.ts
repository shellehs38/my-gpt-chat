// Server-only: published product evidence is selected for the current task, not every tab.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ChatRequest } from "@/lib/chat-contract";

export type CatalogSource = { title: string; url: string; checked: string; pages?: string };
export type CatalogCard = {
  id: string; manufacturer: string; name: string; usefulWidth?: string; fullWidth?: string;
  minLength?: string; maxLength?: string; orientations?: string[]; mounting?: string[];
  accessories?: string[]; limitations?: string[]; sources: CatalogSource[]; manual?: boolean;
  application?: string; restricted?: boolean; layerRoles?: string[]; openJoint?: boolean;
};
export type CatalogFamily = { id: string; name: string; variants: CatalogCard[] };
export type FacadeCatalog = {
  schemaVersion: 1; source: "facade-calculator-catalog"; checkedAt: string;
  calculatorPath: "/facade-calculator/"; fingerprint: string; families: CatalogFamily[]; insulations: CatalogCard[];
};
export const MAX_FACADE_CATALOG_CONTEXT = 16_000;
let snapshot: FacadeCatalog | undefined;
const normalize = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, length = 5000): value is string => typeof value === "string" && value.length <= length;
const https = (value: unknown) => { try { const url = new URL(String(value)); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } };

export function validateFacadeCatalog(value: unknown): FacadeCatalog {
  if (!object(value) || value.schemaVersion !== 1 || value.source !== "facade-calculator-catalog" ||
      value.calculatorPath !== "/facade-calculator/" || !string(value.checkedAt, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value.checkedAt) ||
      !Array.isArray(value.families) || !value.families.length || value.families.length > 50 ||
      !Array.isArray(value.insulations) || value.insulations.length > 50) throw Error("Invalid facade material catalog.");
  const cards: unknown[] = [...value.insulations];
  const familyIds = new Set<string>();
  for (const family of value.families) {
    if (!object(family) || !string(family.id, 100) || !family.id || familyIds.has(family.id) || !string(family.name, 300) ||
        !Array.isArray(family.variants) || !family.variants.length || family.variants.length > 20) throw Error("Invalid facade catalog family.");
    familyIds.add(family.id); cards.push(...family.variants);
  }
  const cardIds = new Set<string>();
  for (const card of cards) {
    if (!object(card) || !string(card.id, 100) || !card.id || cardIds.has(card.id) || !string(card.manufacturer, 300) || !string(card.name, 300) ||
        !Array.isArray(card.sources) || card.sources.length > 30) throw Error("Invalid facade material card.");
    cardIds.add(card.id);
    for (const field of ["usefulWidth", "fullWidth", "minLength", "maxLength"])
      if (card[field] !== undefined && (!string(card[field], 30) || card[field] !== "" && !/^\d+(\.\d{1,12})?$/.test(String(card[field])))) throw Error("Invalid facade material dimensions.");
    if (card.application !== undefined && !string(card.application)) throw Error("Invalid insulation application.");
    for (const field of ["mounting", "accessories", "limitations", "orientations", "layerRoles"])
      if (card[field] !== undefined && (!Array.isArray(card[field]) || (card[field] as unknown[]).length > 50 || (card[field] as unknown[]).some(item => !string(item)))) throw Error("Invalid facade installation evidence.");
    for (const field of ["manual", "restricted", "openJoint"]) if (card[field] !== undefined && typeof card[field] !== "boolean") throw Error("Invalid facade catalog flags.");
    for (const source of card.sources) if (!object(source) || !string(source.title) || !string(source.url) || !https(source.url) ||
        !string(source.checked, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(source.checked) || source.pages !== undefined && !string(source.pages)) throw Error("Invalid facade catalog source.");
  }
  if (!string(value.fingerprint, 64) || !/^[a-f0-9]{64}$/.test(value.fingerprint) || value.fingerprint !== createHash("sha256").update(JSON.stringify({ families: value.families, insulations: value.insulations })).digest("hex")) throw Error("Invalid facade material catalog fingerprint.");
  return value as unknown as FacadeCatalog;
}

export function loadFacadeCatalog(): FacadeCatalog {
  if (!snapshot) {
    const source = readFileSync(join(process.cwd(), "data/facade-material-catalog.json"), "utf8");
    if (Buffer.byteLength(source) > 512 * 1024) throw Error("Facade material catalog exceeds its limit.");
    snapshot = validateFacadeCatalog(JSON.parse(source));
  }
  return snapshot;
}

const familyPatterns: Array<[string, RegExp]> = [
  ["shipboard", /корабельн\p{L}*\s+доск\p{L}*|shipboard/iu],
  ["blockhouse", /блок[\s-]?хаус|block[\s-]?house/iu],
  ["eurobrus", /евро[\s-]?брус|eurobrus/iu],
  ["ecobrus", /эко[\s-]?брус|eco[\s-]?brus/iu],
  ["lbrus-xl", /(?:^|[^\p{L}])[lл][\s-]?брус[\s-]*(?:xl|хл)|lbrus[\s-]*xl/iu],
  ["lbrus", /(?:^|[^\p{L}])[lл][\s-]?брус(?![\s-]*(?:xl|хл))|lbrus(?![\s-]*xl)/iu],
  ["quadro", /квадро[\s-]?брус|quadro[\s-]?(?:brus|брус)/iu],
  ["planken", /планкен|planken/iu],
  ["vertical", /(?:сайдинг|профиль|металл|панел)\p{L}*.{0,25}вертикаль|[«"“]вертикаль[»"”]|grand\s*line.{0,15}вертикаль/iu],
  ["woodstock", /woodstock|вудсток/iu],
];
const insulationPatterns: Array<[string, RegExp]> = [
  ["tn-technovent-standard", /техновент[\s-]+стандарт/iu],
  ["tn-technovent-n", /техновент[\s-]+[нn](?:$|[^\p{L}])/iu],
  ["rwl-venti-batts-n", /венти[\s-]*баттс[\s-]+[нn](?:$|[^\p{L}])/iu],
  ["rwl-venti-batts", /венти[\s-]*баттс(?![\s-]+[нn](?:$|[^\p{L}]))/iu],
  ["tn-walls-roofs-prof", /стены\s+и\s+крыши\s+проф/iu],
  ["tn-carbon-eco-local", /carbon\s*eco|карбон[\s-]*эко|(?:^|[^\p{L}])xps(?:$|[^\p{L}])|экструдир\p{L}*\s+пенополистирол/iu],
];
const otherSubject = /фундамент|бетон|котлован|землян|кровл|стропил|перекрыти|перегород|стяжк|водопровод|канализац|электропровод|электроснабж|внутренн.{0,16}отделк|ванн|санузл|кухн/iu;
const facadeSubject = /фасад|сайдинг|подсистем|вентфасад|наружн.{0,20}(?:облицов|утеплен)|(?:^|[^\p{L}])нфс(?:$|[^\p{L}])/iu;
const anotherFacadeSystem = /сфтк|клинкер|штукатур|мокр\p{L}*\s+фасад|фиброцемент|(?:^|[^\p{L}])hpl(?:$|[^\p{L}])/iu;
const continuation = (value: string) => value.length <= 400 && /^(?:а\s|и\s|тогда\s|теперь\s|продолж|подробнее|что дальше|проверь|уточни|поменя|измени|добав|убери|замени|обнов|пересчитай|верни)|(?:^|[^\p{L}])(?:это|этот|этого|этой|эти|их|него|такой|данного)(?:$|[^\p{L}])|смет|расч[её]т|площад|количеств|материал|стоимост/iu.test(value);
const woodenFinishOnly = (value: string) => /деревян|деревесин|лиственниц|термодерев|из\s+сосн|из\s+кедр/iu.test(value) && !/металл|оцинков|стал[ьиь]/iu.test(value);
const explicitOtherTask = (value: string) => otherSubject.test(value) && /забудь|отложи|отмен[ия]|вместо\s+(?:этого|фасада|сайдинга)/iu.test(value);

function matchedFamilies(text: string): string[] {
  const input = normalize(text);
  if (woodenFinishOnly(input) || explicitOtherTask(input)) return [];
  return familyPatterns.filter(([id, pattern]) => {
    if (id === "woodstock" && /фестивал|музык|концерт|1969/iu.test(input)) return false;
    if (id === "planken" && /деревян|лиственниц|термодерев/iu.test(input) && !/металл/iu.test(input)) return false;
    return pattern.test(input);
  }).map(([id]) => id);
}
function matchedInsulations(text: string): string[] { return insulationPatterns.filter(([, pattern]) => pattern.test(normalize(text))).map(([id]) => id); }

/** Branded profile aliases are subjects; generic "брус" and geometry's "вертикаль" are not. */
export function hasFacadeCatalogSubject(text: string): boolean {
  if (woodenFinishOnly(text) || explicitOtherTask(text)) return false;
  const families = matchedFamilies(text);
  if (families.length) return true;
  // XPS/roof wool alone does not turn a foundation or roof task into a facade.
  return !otherSubject.test(text) && /техновент|венти[\s-]*баттс/iu.test(text);
}

function relevantText(request: ChatRequest): string | null {
  const current = request.message.slice(0, 10_000);
  if (woodenFinishOnly(current) || explicitOtherTask(current)) return null;
  if (matchedFamilies(current).length) return current;
  if (otherSubject.test(current)) return null;
  if (anotherFacadeSystem.test(current) && !/металл\p{L}*\s+сайдинг/iu.test(current)) return null;
  const insulation = matchedInsulations(current);
  if (facadeSubject.test(current) || hasFacadeCatalogSubject(current)) return current;
  if (continuation(current) || insulation.length || /двухслойн|два\s+слоя|50\s*[+×x]\s*50/iu.test(current)) {
    for (const previous of (request.history ?? []).filter(entry => entry.role === "user").slice(-3).reverse()) {
      const text = previous.content.slice(-3000);
      if (otherSubject.test(text) && !matchedFamilies(text).length || anotherFacadeSystem.test(text)) break;
      if (matchedFamilies(text).length || facadeSubject.test(text) || hasFacadeCatalogSubject(text)) return text + "\n" + current;
    }
  }
  // Explicit facade insulation questions in its own tab may use the application catalog.
  if (request.mode === "facade" && (insulation.length || /утеплител|двухслойн|два\s+слоя/iu.test(current))) return current;
  return null;
}

const catalogRules = `КАТАЛОГ МЕТАЛЛИЧЕСКОГО САЙДИНГА И ФАСАДНОГО УТЕПЛЕНИЯ.
Ниже — сохранённые данные конкретных продуктов, а не общий стандарт для любых производителей. Применяй только карточки нужной марки/профиля/завода; если выбор неизвестен, перечисли варианты и уточни его. Полезная и полная ширина различаются; размерные строки каталога — метры. Не переноси направление монтажа, зазоры и крепёж одного профиля на другой. Для ручного профиля и открытого планкена нужны размеры/рабочий шаг с проектным зазором из заказа; пустые параметры не выдумывай. Если полного PDF не удалось прочитать при проверке, сохрани указанное в карточке ограничение и не представляй выдержку как полностью проверенную инструкцию.
Калькулятор доступен по относительной ссылке /facade-calculator/. Пользователь выбирает комплект, задаёт геометрию и проектные параметры, затем применяет его; прежний расчёт не заменяется одним просмотром каталога. Можешь дать эту ссылку и объяснить заполнение. Эти сведения не дают чату инструмента запуска калькулятора, чтения браузерного проекта, записи файлов или внешних действий; не утверждай, что расчёт/сохранение выполнены приложением, если фактического результата нет.
Правила расчёта: чистая площадь = площади стен минус проёмы один раз. Панели предварительно по чистой площади / (полезная ширина × заказная длина); запас задаётся отдельно, штуки округляются вверх, после доступных закреплённых остатков/заказов недостающее округляется до упаковок. Цена панели — за одну целую панель указанной длины; цену за м² сначала явно преобразуют в цену за штуку. Это не раскрой. Направляющие поперёк панелей: для каждой прямоугольной стены ceil(поперечный размер / проектный шаг) + 1, умножить на продольный размер. Кронштейны на направляющей = ceil(длина / проектный шаг кронштейнов) + 1; анкеры = кронштейны × подтверждённое число на кронштейн. Сетка по габариту без вычета проёмов, предварительная; усиления/обрамление, стыки и сложные поверхности — отдельно по раскладке. Шаги, сечения, крепёж и нормы неизвестны без проекта; наличие ширины панели их не определяет.
Каждый слой утепления — отдельная марка, роль inner/outer/single, толщина, объём A × толщина_мм / 1000 и упаковка. Для двух слоёв смещение стыков; 50+50 мм — только явный выбранный вариант, не универсальная требуемая толщина. Внутренняя мягкая плита не подменяет наружную; restricted=true запрещает автоматическое включение на всю площадь этого НФС. Роли не доказывают совместимость всей системы; для сочетания разных производителей нужен подтверждённый проектный источник. Мембрану включают только по системе. Работы по каждому слою считаются от геометрии без запаса/округления упаковок. Откосы окон и дверей, отливы, углы, старт/финиш отдельны. Новые проёмы требуют актуального состава строк. Цены, нормы и налоговый режим не назначены каталогом. checkedAt/checked — дата проверки источника каталога, а не проверка цен или всех действующих нормативов на сегодня. Ссылки sources — реальные источники соответствующей карточки; отсутствующие документы не придумывай.`;

/** Complete cards are kept or omitted as a whole; no instruction fragments are spliced. */
export function facadeCatalogContext(request: ChatRequest, paidEstimate = false): string {
  const text = relevantText(request);
  if (!text) return "";
  const catalog = loadFacadeCatalog(), familyIds = matchedFamilies(text), insulationIds = matchedInsulations(text);
  const wantInsulation = insulationIds.length > 0 || /утепл|два\s+слоя|двухслойн|50\s*[+×x]\s*50/iu.test(text);
  const wantedManufacturers = [
    [/grand\s*line|гранд\s*лайн/iu, "Grand Line"], [/металл\s*профиль|metallprofil/iu, "Металл Профиль"],
    [/stynergy|стинержи/iu, "STYNERGY"], [/байком|bajkom/iu, "БАЙКОМ"],
  ] as const;
  const manufacturers = wantedManufacturers.filter(([pattern]) => pattern.test(text)).map(([, manufacturer]) => manufacturer as string);
  const profiles = catalog.families.filter(family => familyIds.includes(family.id)).flatMap(family => family.variants.filter(card => !manufacturers.length || manufacturers.includes(card.manufacturer)));
  const insulations = wantInsulation ? insulationIds.length ? catalog.insulations.filter(card => insulationIds.includes(card.id)) : catalog.insulations : [];
  const payload = {
    source: catalog.source, checkedAt: catalog.checkedAt, calculatorPath: catalog.calculatorPath, fingerprint: catalog.fingerprint,
    familyIndex: catalog.families.filter(family => !familyIds.length || familyIds.includes(family.id)).map(family => ({ id: family.id, name: family.name, variants: wantInsulation && !familyIds.length ? [] : family.variants.map(card => ({ id: card.id, manufacturer: card.manufacturer, name: card.name, usefulWidth: card.usefulWidth, fullWidth: card.fullWidth, minLength: card.minLength, maxLength: card.maxLength, orientations: card.orientations, manual: card.manual })) })),
    insulationIndex: wantInsulation ? catalog.insulations.map(card => ({ id: card.id, name: card.name, manufacturer: card.manufacturer, layerRoles: card.layerRoles, restricted: card.restricted })) : [],
    profiles: [] as CatalogCard[], insulations: [] as CatalogCard[], omittedCardIds: [] as string[],
  };
  const financialRules = paidEstimate ? "\nВнутренняя финансовая семантика калькулятора для платной сметы: базовая трудовая ставка × 1,40 ровно один раз. Уже клиентские ставки с включённой надбавкой, материалы и прямые внешние затраты не увеличивать. Неизвестный тип ставки или неразбитый комплект сначала классифицируют/уточняют; существующие введённые цены не считать базовыми и не менять автоматически. В клиентской таблице одна колонка «Цена за единицу» с готовой клиентской ставкой, без отдельной строки надбавки и раскрытия внутреннего бюджета 40%. При проверке исходной сметы отмечай её тип ставки и ошибки, не начисляй надбавку повторно и не исправляй цену молча." : "";
  const encode = () => catalogRules + financialRules + "\n" + JSON.stringify(payload);
  if (encode().length > MAX_FACADE_CATALOG_CONTEXT) payload.familyIndex = catalog.families.map(family => ({ id: family.id, name: family.name, variants: [] }));
  for (const [kind, cards] of [["profiles", profiles], ["insulations", insulations]] as const) {
    for (const card of cards) {
      payload[kind].push(card);
      if (encode().length > MAX_FACADE_CATALOG_CONTEXT - 1000) { payload[kind].pop(); payload.omittedCardIds.push(card.id); }
    }
  }
  const result = encode();
  return result.length <= MAX_FACADE_CATALOG_CONTEXT ? result : catalogRules + "\nЗапросите конкретный профиль/производителя: полный набор превышает ограничение контекста.";
}
