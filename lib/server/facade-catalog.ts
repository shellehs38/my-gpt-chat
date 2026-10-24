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
  systemId?: string; systemKind?: string; grid?: boolean; integratedInsulation?: boolean;
  requiresType?: boolean; mountingMethods?: string[]; subtype?: string; fastenerType?: string;
  fastenerLabel?: string; needsJointGrout?: boolean; groutLabel?: string; needsJointSealant?: boolean; sealantLabel?: string;
  needsCoating?: boolean; adhesiveRequired?: boolean; needsFabrication?: boolean; baseOptions?: string[];
};
export type CatalogFamily = { id: string; name: string; variants: CatalogCard[]; kind?: string; group?: string; description?: string; hints?: string[] };
export type FacadeCatalog = {
  schemaVersion: 1; source: "facade-calculator-catalog"; checkedAt: string;
  calculatorPath: "/facade-calculator/"; fingerprint: string; families: CatalogFamily[]; insulations: CatalogCard[];
  systems?: Array<{ id: string; name: string; kind: string; group: string }>; groups?: Array<{ id: string; name: string }>;
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
    for (const field of ["kind", "group", "description"]) if (family[field] !== undefined && !string(family[field])) throw Error("Invalid facade family metadata.");
    if (family.hints !== undefined && (!Array.isArray(family.hints) || family.hints.some(item => !string(item)))) throw Error("Invalid facade family hints.");
    familyIds.add(family.id); cards.push(...family.variants);
  }
  const cardIds = new Set<string>();
  for (const card of cards) {
    if (!object(card) || !string(card.id, 100) || !card.id || cardIds.has(card.id) || !string(card.manufacturer, 300) || !string(card.name, 300) ||
        !Array.isArray(card.sources) || card.sources.length > 30) throw Error("Invalid facade material card.");
    cardIds.add(card.id);
    for (const field of ["usefulWidth", "fullWidth", "minLength", "maxLength", "suggestedLength", "usefulHeight", "panelArea", "coverWidth", "coverHeight"])
      if (card[field] !== undefined && (!string(card[field], 30) || card[field] !== "" && !/^\d+(\.\d{1,12})?$/.test(String(card[field])))) throw Error("Invalid facade material dimensions.");
    for (const field of ["application", "systemId", "systemKind", "subtype", "fastenerType", "fastenerLabel", "groutLabel", "sealantLabel"])
      if (card[field] !== undefined && !string(card[field])) throw Error("Invalid facade material metadata.");
    for (const field of ["mounting", "accessories", "limitations", "orientations", "layerRoles", "mountingMethods", "baseOptions"])
      if (card[field] !== undefined && (!Array.isArray(card[field]) || (card[field] as unknown[]).length > 50 || (card[field] as unknown[]).some(item => !string(item)))) throw Error("Invalid facade installation evidence.");
    for (const field of ["manual", "restricted", "openJoint", "grid", "integratedInsulation", "requiresType", "needsJointGrout", "needsJointSealant", "needsCoating", "adhesiveRequired", "needsFabrication"]) if (card[field] !== undefined && typeof card[field] !== "boolean") throw Error("Invalid facade catalog flags.");
    for (const source of card.sources) if (!object(source) || !string(source.title) || !string(source.url) || !https(source.url) ||
        !string(source.checked, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(source.checked) || source.pages !== undefined && !string(source.pages)) throw Error("Invalid facade catalog source.");
  }
  for (const field of ["systems", "groups"]) if (value[field] !== undefined) {
    if (!Array.isArray(value[field]) || (value[field] as unknown[]).length > 50) throw Error("Invalid facade system index.");
    const ids = new Set<string>();
    for (const item of value[field] as unknown[]) {
      if (!object(item) || !string(item.id, 100) || !item.id || ids.has(item.id) || !string(item.name, 300)) throw Error("Invalid facade system index.");
      ids.add(item.id);
    }
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
const otherSubject = /фундамент|бетон|котлован|землян|кровл|стропил|перекрыти|перегород|стяжк|водопровод|канализац|электропровод|электроснабж|внутренн.{0,16}отделк|ванн|санузл|кухн|забор|ограждени|столешниц|мебел/iu;
const facadeSubject = /фасад|сайдинг|подсистем|вентфасад|наружн.{0,20}(?:облицов|утеплен)|(?:^|[^\p{L}])нфс(?:$|[^\p{L}])/iu;
const unsupportedFacadeSystem = /сфтк|штукатур|мокр\p{L}*\s+фасад/iu;
const continuation = (value: string) => value.length <= 400 && /^(?:а\s|и\s|тогда\s|теперь\s|продолж|подробнее|что дальше|проверь|уточни|поменя|измени|добав|убери|замени|обнов|пересчитай|верни)|(?:^|[^\p{L}])(?:это|этот|этого|этой|эти|их|него|такой|данного)(?:$|[^\p{L}])|смет|расч[её]т|площад|количеств|материал|стоимост/iu.test(value);
const woodenFinishOnly = (value: string) => /деревян|деревесин|лиственниц|термодерев|из\s+сосн|из\s+кедр/iu.test(value) && !/металл|оцинков|стал[ьиь]/iu.test(value);
const explicitOtherTask = (value: string) => otherSubject.test(value) && /забудь|отложи|отмен[ия]|вместо\s+(?:этого|фасада|сайдинга)/iu.test(value);
const outsideFacade = (value: string) => explicitOtherTask(value) || otherSubject.test(value) && !facadeSubject.test(value);
const systemPatterns: Array<[string, RegExp]> = [
  ["vinyl", /винил|(?:^|[^\p{L}])пвх[\s-]+сайдинг|сайдинг[\s-]+пвх|d[öoе]cke|д[её]ке/iu],
  ["acrylic", /акрил\p{L}*\s+сайдинг|сайдинг\p{L}*\s+акрил|канада\s+плюс\s+премиум|(?:^|[^\p{L}])asa(?:$|[^\p{L}])/iu],
  ["fibercement", /фиброцемент|cedral|кедрал|latonit|латонит/iu],
  ["wood", /деревян\p{L}*\s+(?:сайдинг|планкен|блок[ -]?хаус|облицовк|фасад)|лиственниц|термодерев|thermory|термори|woodneva|лесшоп|вагонк|имитаци\p{L}*\s+бруса|скошенн\p{L}*\s+планкен|прям\p{L}*\s+планкен/iu],
  ["plinth", /цокольн\p{L}*\s+(?:сайдинг|панел)|панел\p{L}*.{0,30}(?:под\s+камень|под\s+кирпич)|альта.{0,20}(?:камень|кирпич)/iu],
  ["thermal", /термопанел|полифасад|фаворит\s+фасад|favoritfasad/iu],
  ["wpc", /(?:^|[^\p{L}])дпк(?:$|[^\p{L}])|древесно[ -]?полимер|savewood|с[еэ]йввуд|sw\s+cedrus/iu],
  ["acp", /(?:^|[^\p{L}])акп(?:$|[^\p{L}])|алюминиев\p{L}*\s+композит|alucobond|алюкобонд/iu],
  ["hpl", /(?:^|[^\p{L}])hpl(?:$|[^\p{L}])|ламинат\p{L}*\s+высокого\s+давления|fundermax|фундермакс|max\s+exterior/iu],
  ["sandwich", /с[еэ]ндвич|сэндвич|teplant|теплант/iu],
  ["stone-lock", /каменн\p{L}*\s+зам(?:ок|к)|зам(?:ок|к)\p{L}*\s+камен/iu],
  ["cassettes", /кассет|инси\s+кф[ -]?[12]/iu],
  ["profiled", /профнастил|профлист|гл[ -]?8/iu],
  ["seam", /фальц|кликфальц|clickfalz|standing\s+seam/iu],
];

function matchedFamilies(text: string): string[] {
  const input = normalize(text);
  if (outsideFacade(input)) return [];
  const systems = systemPatterns.filter(([, pattern]) => pattern.test(input)).map(([id]) => id);
  const thermalOnly = systems.includes("thermal") && !/фиброцемент\p{L}*\s+(?:сайдинг|доск|плит)|cedral|кедрал|latonit|латонит/iu.test(input);
  const metal = familyPatterns.filter(([id, pattern]) => {
    if (id === "woodstock" && /фестивал|музык|концерт|1969/iu.test(input)) return false;
    if (woodenFinishOnly(input)) return false;
    if (id === "planken" && systems.includes("wood") && !/металл/iu.test(input)) return false;
    return pattern.test(input);
  }).map(([id]) => id);
  if (woodenFinishOnly(input) && !systems.includes("wood")) systems.push("wood");
  return [...metal, ...systems.filter(id => !(id === "fibercement" && thermalOnly))];
}
function matchedInsulations(text: string): string[] { return insulationPatterns.filter(([, pattern]) => pattern.test(normalize(text))).map(([id]) => id); }

/** Product aliases select facade evidence; roof, fence, furniture and unrelated tasks retain their own subject. */
export function hasFacadeCatalogSubject(text: string): boolean {
  if (outsideFacade(text)) return false;
  if (matchedFamilies(text).length) return true;
  return !otherSubject.test(text) && /техновент|венти[\s-]*баттс/iu.test(text);
}

function relevantText(request: ChatRequest): string | null {
  const current = request.message.slice(0, 10_000);
  if (outsideFacade(current)) return null;
  if (matchedFamilies(current).length) return current;
  if (otherSubject.test(current)) return null;
  if (unsupportedFacadeSystem.test(current) && !/сравни|металл\p{L}*\s+сайдинг/iu.test(current)) return null;
  const insulation = matchedInsulations(current);
  if (facadeSubject.test(current) || hasFacadeCatalogSubject(current)) return current;
  if (continuation(current) || insulation.length || /двухслойн|два\s+слоя|50\s*[+×x]\s*50/iu.test(current)) {
    for (const previous of (request.history ?? []).filter(entry => entry.role === "user").slice(-3).reverse()) {
      const text = previous.content.slice(-3000);
      if (outsideFacade(text) || unsupportedFacadeSystem.test(text)) break;
      if (matchedFamilies(text).length || facadeSubject.test(text) || hasFacadeCatalogSubject(text)) return text + "\n" + current;
    }
  }
  if (request.mode === "facade" && (insulation.length || /утеплител|двухслойн|два\s+слоя/iu.test(current))) return current;
  return null;
}

const catalogRules = `КАТАЛОГ МЕТАЛЛИЧЕСКОГО САЙДИНГА И ДРУГИХ ФАСАДНЫХ СИСТЕМ, УТЕПЛЕНИЯ.
Ниже сохранённые данные конкретных продуктов. Применяй карточку нужной марки/профиля/завода и способа крепления; неизвестный выбор уточни. Не переноси нормы, зазоры, крепёж или направление между продуктами. В каждой карточке mounting — порядок монтажа; accessories — комплектующие; limitations — границы применимости; sources — проверенные источники. Если полного PDF не удалось прочитать при проверке, сохрани ограничение и не представляй выдержку как полностью проверенную инструкцию. Доступность продукта и применимость зарубежной техкарты для объекта в РФ требуют отдельной проверки.
Калькулятор: /facade-calculator/. Выбирают систему, марку, метод, геометрию и проектные параметры, затем явно применяют комплект: просмотр не заменяет прежний расчёт. По systemKind меняются состав и поля. Эти сведения не дают чату инструмента запуска калькулятора, чтения браузерного проекта, записи файлов или внешних действий; не утверждай, что расчёт/сохранение выполнены приложением без результата.
Общие правила: чистая площадь = стены минус проёмы один раз. Предварительное количество облицовки = чистая площадь / (рабочая ширина × длина формата), плюс явный запас; штуки округляют вверх, потребность после пригодных закреплённых остатков и заказов округляют до упаковок. Размерные строки — метры. Полная ширина не равна полезной. Для открытых швов нужен рабочий модуль с проектным зазором; для листов и кассет — раскладка, стыки и раскрой. Это не оптимизация раскроя. Цена относится к единице строки: панель за штуку конкретного формата; м² сначала явно переводят в цену за штуку. Работы считают по геометрии без запаса и упаковок. Откосы, отливы, углы, старт/финиш и примыкания — отдельно.
Конструкция зависит от типа. Винил/акрил/цоколь: температурные перемещения и крепление в отверстиях по их инструкции. Дерево: профиль, влажность, зазоры, крепёж и покрытие по выбранной доске, металлический планкен не подменяет деревянный. ДПК: крепление конкретного профиля; SAVEWOOD Cedrus по инструкции на саморезах с предварительным сверлением, не универсальные кляммеры. Фиброцемент: Lap внахлёст, Click на кляймерах, листовые плиты — отдельные узлы.
Прямой механический/клеевой способы не получают металлическую подсистему автоматически. Термопанели и сэндвич содержат собственное утепление: сердечник и отдельную вату не удваивают. ФАВОРИТ — механическое крепление непосредственно или на каркасе, клей не универсально обязателен. Полифасад — клеевая система с механическим креплением, эластичная заделка швов и покрытие; не назначай ему цементную клинкерную затирку. Сэндвич — несущий каркас, опорные пролёты, собственные саморезы, уплотнения по замку; заводской уплотнитель повторно не добавляют.
АКП/HPL/кассеты: подсистема по раскладке и проектной норме либо ручной ведомости; прямоугольная сетка не доказывает опоры всех швов. АКП требует отдельного изготовления (раскрой/фрезеровка/гибка) по проекту. Кликфальц для стен: именно стеновая инструкция, гвоздевая полка и подтверждённое основание; не универсальные кляммеры и не перенос кровельного узла. «Каменный замок» без марки и подтверждённого типа: requiresType=true, автоматический комплект запрещён до уточнения; не выдумывай универсальную конструкцию.
Для подходящей grid=true каркасной системы предварительные направляющие поперёк облицовки: на прямоугольную стену (ceil(поперечный размер / проектный шаг) + 1) × продольный размер. Кронштейны = (ceil(длина направляющей / шаг кронштейнов) + 1) × количество направляющих; анкеры по узлу. Проёмы из этой сетки не вычитают, усиления/обрамление и сложные поверхности — отдельно. Рейки с непосредственным креплением не требуют металлокронштейнов автоматически. Расходы клея, крепежа, затирки, покрытия и герметика вводят с источником нормы для выбранного продукта, без выдуманного стандартного расхода.
Каждый отдельный слой утепления имеет марку, роль inner/outer/single, толщину, объём A × толщина_мм / 1000 и упаковку. Два слоя со смещением стыков; 50+50 мм — выбранный вариант, не универсальная требуемая толщина. Внутренняя мягкая плита не заменяет наружную; restricted=true запрещает включение на всю площадь НФС. Роли не доказывают совместимость всей системы; сочетание разных производителей требует проектного источника. Мембрана только по выбранной системе. Цены, нормы и налоги каталогом не назначены. checkedAt/checked — дата проверки источника каталога, не проверка цен/нормативов на сегодня. Не придумывай отсутствующие документы.`;

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
  const manufacturers: string[] = wantedManufacturers.filter(([pattern]) => pattern.test(text)).map(([, manufacturer]) => manufacturer);
  const manufacturerPatterns: Array<[RegExp, RegExp]> = [
    [/d[öoе]cke|д[её]ке/iu, /döcke/iu], [/альта/iu, /альта/iu], [/cedral|кедрал/iu, /cedral/iu],
    [/latonit|латонит/iu, /latonit/iu], [/thermory|термори/iu, /thermory/iu], [/woodneva/iu, /woodneva/iu],
    [/лесшоп/iu, /лесшоп/iu], [/фаворит|favorit/iu, /фаворит/iu], [/полифасад/iu, /полифасад/iu],
    [/savewood|с[еэ]йввуд|sw\s+cedrus/iu, /savewood/iu], [/alucobond|алюкобонд/iu, /alucobond/iu],
    [/fundermax|фундермакс|max\s+exterior/iu, /fundermax/iu], [/teplant|теплант/iu, /teplant/iu], [/инси/iu, /инси/iu],
  ];
  const selectedManufacturerPatterns = manufacturerPatterns.filter(([pattern]) => pattern.test(text)).map(([, pattern]) => pattern);
  let profiles = catalog.families.filter(family => familyIds.includes(family.id)).flatMap(family => family.variants.filter(card =>
    !manufacturers.length && !selectedManufacturerPatterns.length || manufacturers.includes(card.manufacturer) || selectedManufacturerPatterns.some(pattern => pattern.test(card.manufacturer))));
  const cardPatterns: Array<[RegExp, RegExp]> = [
    [/cedral\s+click|кедрал\s+клик/iu, /^cedral-click$/u], [/cedral\s+lap|кедрал\s+лап/iu, /^cedral-lap$/u],
    [/прям\p{L}*\s+планкен/iu, /planken-straight$/u], [/скошенн\p{L}*\s+планкен|ромбическ/iu, /planken-bevel$/u],
    [/имитаци\p{L}*\s+бруса/iu, /timber-imitation$/u], [/американк/iu, /american-lining$/u],
    [/кф[ -]?1/iu, /^insi-kf1$/u], [/кф[ -]?2/iu, /^insi-kf2$/u],
    [/(?:^|[^\p{L}])пир(?:$|[^\p{L}])|(?:^|[^\p{L}])pir(?:$|[^\p{L}])/iu, /-pir$/u],
    [/(?:^|[^\p{L}])мву(?:$|[^\p{L}])/iu, /-mvu$/u],
  ];
  const preferred = cardPatterns.filter(([pattern]) => pattern.test(text)).map(([, pattern]) => pattern);
  if (preferred.length) profiles = [...profiles.filter(card => preferred.some(pattern => pattern.test(card.id))), ...profiles.filter(card => !preferred.some(pattern => pattern.test(card.id)))];
  const insulations = wantInsulation ? insulationIds.length ? catalog.insulations.filter(card => insulationIds.includes(card.id)) : catalog.insulations : [];
  const payload = {
    source: catalog.source, checkedAt: catalog.checkedAt, calculatorPath: catalog.calculatorPath, fingerprint: catalog.fingerprint,
    familyIndex: catalog.families.filter(family => !familyIds.length || familyIds.includes(family.id)).map(family => ({ id: family.id, name: family.name, kind: family.kind ?? "metal", group: family.group ?? "siding", variants: wantInsulation && !familyIds.length ? [] : family.variants.map(card => ({ id: card.id, manufacturer: card.manufacturer, name: card.name, usefulWidth: card.usefulWidth, fullWidth: card.fullWidth, minLength: card.minLength, maxLength: card.maxLength, orientations: card.orientations, manual: card.manual })) })),
    insulationIndex: wantInsulation ? catalog.insulations.map(card => ({ id: card.id, name: card.name, manufacturer: card.manufacturer, layerRoles: card.layerRoles, restricted: card.restricted })) : [],
    profiles: [] as CatalogCard[], insulations: [] as CatalogCard[], omittedCardIds: [] as string[],
  };
  const financialRules = paidEstimate ? "\nВнутренняя финансовая семантика калькулятора для платной сметы: базовая трудовая ставка × 1,40 ровно один раз. Уже клиентские ставки с включённой надбавкой, материалы и прямые внешние затраты не увеличивать. Неизвестный тип ставки или неразбитый комплект сначала классифицируют/уточняют; существующие введённые цены не считать базовыми и не менять автоматически. В клиентской таблице одна колонка «Цена за единицу» с готовой клиентской ставкой, без отдельной строки надбавки и раскрытия внутреннего бюджета 40%. При проверке исходной сметы отмечай её тип ставки и ошибки, не начисляй надбавку повторно и не исправляй цену молча." : "";
  const encode = () => catalogRules + financialRules + "\n" + JSON.stringify(payload);
  if (encode().length > MAX_FACADE_CATALOG_CONTEXT) payload.familyIndex = payload.familyIndex.map(family => ({ ...family, variants: [] }));
  for (const [kind, cards] of [["profiles", profiles], ["insulations", insulations]] as const) {
    for (const card of cards) {
      payload[kind].push(card);
      if (encode().length > MAX_FACADE_CATALOG_CONTEXT - 1000) { payload[kind].pop(); payload.omittedCardIds.push(card.id); }
    }
  }
  const result = encode();
  return result.length <= MAX_FACADE_CATALOG_CONTEXT ? result : catalogRules + "\nЗапросите конкретный профиль/производителя: полный набор превышает ограничение контекста.";
}
