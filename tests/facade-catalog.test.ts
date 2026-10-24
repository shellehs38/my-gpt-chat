import test from "node:test";
import assert from "node:assert/strict";
import { buildInstructions, isFacadeRequest } from "../lib/server/chat";
import { facadeCatalogContext, hasFacadeCatalogSubject, loadFacadeCatalog, MAX_FACADE_CATALOG_CONTEXT, validateFacadeCatalog, type CatalogCard } from "../lib/server/facade-catalog";
import { POST as chat } from "../app/api/chat/route";
import { createSessionToken, getAccessConfig, SESSION_COOKIE } from "../lib/server/auth";
import { resetRateLimitsForTests } from "../lib/server/rate-limit";

function payload(context: string): { familyIndex: Array<{ id: string }>; profiles: CatalogCard[]; insulations: CatalogCard[]; omittedCardIds: string[] } {
  const start = context.lastIndexOf("\n{");
  assert.ok(start >= 0, "the selected catalog remains one complete JSON value");
  return JSON.parse(context.slice(start + 1));
}

test("runtime catalog retains manufacturer-specific useful dimensions and original source evidence", () => {
  const catalog = loadFacadeCatalog();
  assert.equal(catalog.families.length, 24); assert.equal(catalog.systems?.length, 15); assert.equal(catalog.insulations.length, 6);
  const shipboard = catalog.families.find(family => family.id === "shipboard")!;
  assert.equal(shipboard.variants.find(card => card.id === "gl-shipboard-240")?.usefulWidth, "0.240");
  assert.equal(shipboard.variants.find(card => card.id === "st-shipboard")?.usefulWidth, "0.230");
  const context = facadeCatalogContext({ mode: "engineering", message: "Как монтируется сайдинг Евробрус STYNERGY?" });
  const selected = payload(context);
  assert.deepEqual(selected.familyIndex.map(family => family.id), ["eurobrus"]);
  assert.equal(selected.profiles.length, 1);
  const card = selected.profiles[0];
  assert.equal(card.id, "st-eurobrus"); assert.equal(card.usefulWidth, "0.345"); assert.equal(card.fullWidth, "0.367");
  assert.ok(card.mounting?.some(line => /сверху вниз/iu.test(line)));
  assert.ok(card.sources.every(source => source.checked === "2026-10-24" && source.url.startsWith("https://")));
  assert.deepEqual(card, catalog.families.find(family => family.id === "eurobrus")!.variants.find(item => item.id === card.id));
  assert.match(context, /не представл[яе]й выдержку как полностью проверенную инструкцию/iu);
});

test("all named profiles are recognized without confusing L-брус XL with L-брус", () => {
  for (const name of ["Корабельная доска", "Блок-хаус", "Евробрус", "ЭкоБрус", "L-брус", "L-брус XL", "Квадро Брус", "Металлический планкен", "Сайдинг Вертикаль", "Woodstock"])
    assert.equal(isFacadeRequest({ mode: "estimate", message: `Посчитай количество ${name}` }), true, name);
  const xl = payload(facadeCatalogContext({ mode: "general", message: "Какая полезная ширина L-брус XL Металл Профиль?" }));
  assert.deepEqual(xl.familyIndex.map(family => family.id), ["lbrus-xl"]);
  assert.equal(xl.profiles[0].usefulWidth, "0.335");
  assert.equal(hasFacadeCatalogSubject("Сколько бруса нужно на стропила?"), false);
  assert.equal(hasFacadeCatalogSubject("Что такое вертикаль в геометрии?"), false);
  assert.equal(hasFacadeCatalogSubject("Расскажи про музыкальный фестиваль Woodstock 1969"), false);
  assert.equal(hasFacadeCatalogSubject("Монтаж деревянного планкена из лиственницы"), true);
  for (const message of ["Посчитай деревянный блок-хаус из сосны для фасада", "Посчитай деревянный планкен из лиственницы для фасада"]) {
    const selected = payload(facadeCatalogContext({ mode: "facade", message }));
    assert.deepEqual(selected.familyIndex.map(family => family.id), ["wood"]);
    assert.ok(selected.profiles.length > 0);
    assert.ok(selected.profiles.every(card => card.systemKind === "wood"));
    assert.ok(!selected.profiles.some(card => card.id === "bajkom-planken-project"));
  }
  assert.match(facadeCatalogContext({ mode: "facade", message: "Сравни деревянный блок-хаус из сосны с металлическим блок-хаусом" }), /КАТАЛОГ МЕТАЛЛИЧЕСКОГО САЙДИНГА/);
});

test("short follow-ups use recent user context, while current concrete tasks and profile changes win", () => {
  const history = [{ role: "user" as const, content: "Обсуждаем металлический сайдинг Евробрус STYNERGY на фасаде." }, { role: "assistant" as const, content: "Кровля и бетон — другие задачи." }];
  const inherited = payload(facadeCatalogContext({ mode: "general", message: "А какие комплектующие нужны?", history }));
  assert.equal(inherited.profiles[0].id, "st-eurobrus");
  const current = payload(facadeCatalogContext({ mode: "estimate", message: "Теперь сравни ЭкоБрус Grand Line", history }));
  assert.deepEqual(current.familyIndex.map(family => family.id), ["ecobrus"]);
  assert.ok(current.profiles.every(card => card.manufacturer === "Grand Line"));
  for (const request of [
    { mode: "facade" as const, message: "Рассчитай фундамент и объём бетона", history },
    { mode: "estimate" as const, message: "Сколько XPS для утепления фундамента?", history },
    { mode: "general" as const, message: "Привет! Сколько будет два плюс два?", history },
    { mode: "business" as const, message: "Как ответить клиенту на возражение о высокой цене?", history },
    { mode: "documents" as const, message: "Напиши поздравление с днём рождения", history },
    { mode: "engineering" as const, message: "Узлы штукатурного фасада СФТК с клинкером", history },
    { mode: "engineering" as const, message: "Забудь Евробрус, теперь рассчитай кровлю", history },
    { mode: "general" as const, message: "Продолжи", history: [{ role: "assistant" as const, content: "Евробрус на фасаде" }] },
    { mode: "estimate" as const, message: "Пересчитай", history: [...history, { role: "user" as const, content: "Теперь считаем кровлю" }] },
  ]) assert.equal(facadeCatalogContext(request), "", request.message);
});

test("insulation context keeps inner/outer roles and blocks XPS facade substitution", () => {
  const selected = payload(facadeCatalogContext({ mode: "facade", message: "Два слоя утепления: ТЕХНОВЕНТ Н и ТЕХНОВЕНТ СТАНДАРТ. Как монтировать?" }));
  const inner = selected.insulations.find(card => card.id === "tn-technovent-n")!, outer = selected.insulations.find(card => card.id === "tn-technovent-standard")!;
  assert.deepEqual(inner.layerRoles, ["inner"]); assert.deepEqual(outer.layerRoles, ["outer", "single"]);
  const restricted = payload(facadeCatalogContext({ mode: "facade", message: "Можно ли XPS CARBON ECO под металлический сайдинг на фасаде?" })).insulations.find(card => card.id === "tn-carbon-eco-local")!;
  assert.equal(restricted.restricted, true); assert.deepEqual(restricted.layerRoles, []);
  const text = facadeCatalogContext({ mode: "facade", message: "Два слоя утепления фасада 50+50 мм" });
  assert.match(text, /Роли не доказывают совместимость всей системы/);
  assert.match(text, /не универсальная требуемая толщина/);
});

test("broad catalog context is bounded and omits whole cards rather than cutting instructions", () => {
  const names = loadFacadeCatalog().families.map(family => `«${family.name}»`).join(", ");
  const context = facadeCatalogContext({ mode: "facade", message: `Сравни все профили металлического сайдинга: ${names}, утеплители и монтаж` });
  assert.ok(context.length <= MAX_FACADE_CATALOG_CONTEXT);
  const selected = payload(context); assert.equal(selected.familyIndex.length, 24); assert.ok(selected.omittedCardIds.length > 0);
  const all = [...loadFacadeCatalog().families.flatMap(family => family.variants), ...loadFacadeCatalog().insulations];
  for (const card of [...selected.profiles, ...selected.insulations]) assert.deepEqual(card, all.find(item => item.id === card.id));
  assert.match(context, /checkedAt\/checked — дата проверки источника каталога/);
});

test("website instructions receive real catalog cards and preserve the calculator capability boundary", () => {
  const request = { mode: "estimate" as const, message: "Составь смету сайдинга Евробрус STYNERGY с утеплением" };
  const instructions = buildInstructions(request);
  assert.match(instructions, /КАТАЛОГ МЕТАЛЛИЧЕСКОГО САЙДИНГА/); assert.match(instructions, /0\.345/);
  assert.match(instructions, /\/facade-calculator\//); assert.match(instructions, /не дают чату инструмента запуска калькулятора/);
  assert.match(instructions, /базовая трудовая ставка × 1,40 ровно один раз/);
  assert.match(instructions, /существующие введённые цены не считать базовыми/);
  assert.match(instructions, /одна колонка «Цена за единицу»/);
  const technical = buildInstructions({ mode: "engineering", message: "Как крепить Евробрус STYNERGY?" });
  assert.match(technical, /КАТАЛОГ МЕТАЛЛИЧЕСКОГО САЙДИНГА/); assert.doesNotMatch(technical, /Внутренняя финансовая семантика калькулятора/);
  assert.doesNotMatch(buildInstructions({ mode: "estimate", message: "Рассчитай объём бетона для фундамента" }), /КАТАЛОГ МЕТАЛЛИЧЕСКОГО САЙДИНГА/);
});

test("catalog loader rejects unsafe sources and malformed source geometry instead of trusting declarations", () => {
  const catalog = loadFacadeCatalog();
  const bad = () => structuredClone(catalog);
  let value = bad(); value.families[0].variants[0].sources[0].url = "javascript:alert(1)";
  assert.throws(() => validateFacadeCatalog(value), /source/);
  value = bad(); value.families[0].variants[0].sources[0].url = "https://user:password@example.org/manual";
  assert.throws(() => validateFacadeCatalog(value), /source/);
  value = bad(); value.families[0].variants[0].usefulWidth = "assumed 0.24";
  assert.throws(() => validateFacadeCatalog(value), /dimensions/);
  value = bad(); value.families[1].id = value.families[0].id;
  assert.throws(() => validateFacadeCatalog(value), /family/);
  value = bad(); value.families[0].variants[0].usefulWidth = "0.999";
  assert.throws(() => validateFacadeCatalog(value), /fingerprint/);
});

test("new facade categories select their own installation evidence and calculation structure", () => {
  const cases: Array<[string, string, string]> = [
    ["Виниловый сайдинг DÖCKE", "vinyl", "linear"],
    ["Акриловый сайдинг Альта", "acrylic", "linear"],
    ["Cedral Click фиброцементный сайдинг", "fibercement", "linear"],
    ["Монтаж прямого планкена Thermory", "wood", "wood"],
    ["Цокольные панели Альта Камень", "plinth", "panel"],
    ["Клинкерные термопанели ФАВОРИТ ФАСАД", "thermal", "thermal"],
    ["Фасад из ДПК SAVEWOOD Cedrus", "wpc", "panel"],
    ["Монтаж АКП ALUCOBOND", "acp", "panel"],
    ["HPL Fundermax Max Exterior на фасаде", "hpl", "panel"],
    ["Стеновые сэндвич-панели Teplant ПИР", "sandwich", "sandwich"],
    ["Фасадные панели с каменным замком", "stone-lock", "unknown"],
    ["Фасадные кассеты ИНСИ КФ-2", "cassettes", "panel"],
    ["Профнастил Grand Line ГЛ-8 на стенах фасада", "profiled", "linear"],
    ["Кликфальц Grand Line на фасаде Барнхаус", "seam", "seam"],
  ];
  const catalog = loadFacadeCatalog();
  for (const [message, id, kind] of cases) {
    assert.equal(hasFacadeCatalogSubject(message), true, message);
    const context = facadeCatalogContext({ mode: "engineering", message });
    assert.ok(context.length <= MAX_FACADE_CATALOG_CONTEXT);
    const selected = payload(context);
    assert.ok(selected.familyIndex.some(family => family.id === id), message);
    assert.ok(selected.profiles.some(card => card.systemId === id && card.systemKind === kind), message);
    for (const card of selected.profiles) assert.deepEqual(card, catalog.families.find(family => family.id === id)?.variants.find(item => item.id === card.id));
  }
  const integrated = payload(facadeCatalogContext({ mode: "engineering", message: "Фиброцементные термопанели и расход материалов" }));
  assert.deepEqual(integrated.familyIndex.map(family => family.id), ["thermal"]);
  assert.ok(integrated.profiles.every(card => card.integratedInsulation));
  const polifasad = payload(facadeCatalogContext({ mode: "engineering", message: "Монтаж термопанелей Полифасад" })).profiles[0];
  assert.equal(polifasad.id, "polifasad-fibrothermal");
  assert.equal(polifasad.needsJointGrout, false); assert.equal(polifasad.needsJointSealant, true);
  assert.match(polifasad.sealantLabel!, /эластич/iu);
  const unknown = payload(facadeCatalogContext({ mode: "facade", message: "Панели с каменным замком" })).profiles[0];
  assert.equal(unknown.requiresType, true); assert.deepEqual(unknown.sources, []);
  const sandwich = payload(facadeCatalogContext({ mode: "estimate", message: "Teplant стеновые сэндвич-панели ПИР" })).profiles[0];
  assert.equal(sandwich.id, "teplant-wall-pir"); assert.equal(sandwich.integratedInsulation, true); assert.equal(sandwich.grid, false);
  const click = payload(facadeCatalogContext({ mode: "engineering", message: "Монтаж Cedral Click" })).profiles[0];
  assert.equal(click.id, "cedral-click");
});

test("roof, fence and furniture requests do not inherit facade mounting from shared material names", () => {
  for (const message of ["Профнастил для забора", "Монтаж кликфальца на кровлю", "Сэндвич-панели для кровли", "HPL для кухонной столешницы", "Забудь фасад, рассчитай кровлю из профлиста"]) {
    assert.equal(hasFacadeCatalogSubject(message), false, message);
    assert.equal(facadeCatalogContext({ mode: "estimate", message, history: [{ role: "user", content: "Рассчитай профлист на фасаде" }] }), "", message);
  }
  assert.equal(hasFacadeCatalogSubject("Монтаж профнастила на фасаде"), true);
});

test("authenticated chat passes selected product evidence to the actual model request", async () => {
  const keys = ["ASSISTANT_ACCESS_PASSWORD", "ASSISTANT_SESSION_SECRET", "ASSISTANT_PUBLIC_ORIGIN", "OPENAI_API_KEY"] as const;
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]])), originalFetch = globalThis.fetch;
  process.env.ASSISTANT_ACCESS_PASSWORD = "catalog-unit-test-password";
  process.env.ASSISTANT_SESSION_SECRET = "catalog-unit-test-session-secret-with-more-than-32-bytes";
  process.env.OPENAI_API_KEY = "unit-test-model-is-mocked"; delete process.env.ASSISTANT_PUBLIC_ORIGIN;
  resetRateLimitsForTests(); let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses"); calls++;
    const body = JSON.parse(String(init?.body));
    assert.match(body.instructions, /КАТАЛОГ МЕТАЛЛИЧЕСКОГО САЙДИНГА/);
    if (calls === 1) {
      assert.ok(body.instructions.includes('"id":"st-eurobrus"'));
      assert.ok(body.instructions.includes('"usefulWidth":"0.345"'));
      assert.ok(body.instructions.includes("stynergy.ru"));
    } else {
      assert.ok(body.instructions.includes('"id":"fundermax-max-exterior-exposed"'));
      assert.ok(body.instructions.includes('"systemKind":"panel"'));
      assert.ok(body.instructions.includes('"grid":false'));
      assert.ok(body.instructions.includes("fundermax"));
    }
    assert.doesNotMatch(body.instructions, /Внутренняя финансовая семантика калькулятора/);
    return new Response(JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text: "Для Евробруса STYNERGY порядок монтажа сверху вниз. Уточните систему и узлы." }] }] }), { status: 200 });
  };
  try {
    const origin = "http://localhost:3000", cookie = `${SESSION_COOKIE}=${createSessionToken(getAccessConfig()!)}`;
    const result = await chat(new Request(origin + "/api/chat", { method: "POST", headers: { origin, cookie, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "engineering", message: "Как монтируется Евробрус STYNERGY?" }) }));
    assert.equal(result.status, 200); assert.equal((await result.json()).calculation, "none"); assert.equal(calls, 1);
    const panelResult = await chat(new Request(origin + "/api/chat", { method: "POST", headers: { origin, cookie, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "engineering", message: "Как монтируется HPL Fundermax Max Exterior на фасаде?" }) }));
    assert.equal(panelResult.status, 200); assert.equal((await panelResult.json()).calculation, "none"); assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch; resetRateLimitsForTests();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
  }
});
