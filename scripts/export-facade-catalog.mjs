import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalogFamilies,insulationCatalog,catalogChecked} from '../public/facade-calculator/material-catalog.mjs';
import {claddingSystems,systemGroups,selectSystem} from '../public/facade-calculator/system-catalog.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(catalogFamilies.length!==10||claddingSystems.length!==15||!/^\d{4}-\d{2}-\d{2}$/.test(catalogChecked))throw Error('Invalid facade catalog source.');
const families=[...catalogFamilies,...claddingSystems.filter(s=>s.id!=='metal-siding').map(({variants,...system})=>({...system,systemId:system.id,variants:variants.map(v=>selectSystem(system.id,system.id,v.id).variant)}))];
const systems=claddingSystems.map(({variants,families,...metadata})=>metadata);
const ids=new Set();
for(const card of [...families.flatMap(f=>f.variants),...insulationCatalog]){
  if(!card.id||ids.has(card.id)||!card.manufacturer||!card.name||!Array.isArray(card.sources))throw Error('Invalid or duplicate material card.');
  ids.add(card.id);
  for(const s of card.sources){const u=new URL(s.url);if(u.protocol!=='https:'||u.username||u.password||!/^\d{4}-\d{2}-\d{2}$/.test(s.checked))throw Error('Invalid material source URL or review date.');}
}
const checkedAt=[catalogChecked,...families.flatMap(f=>f.variants).flatMap(v=>v.sources.map(s=>s.checked)),...insulationCatalog.flatMap(v=>v.sources.map(s=>s.checked))].sort().at(-1);
const payload={families,insulations:insulationCatalog};
const snapshot={schemaVersion:1,source:'facade-calculator-catalog',checkedAt,calculatorPath:'/facade-calculator/',fingerprint:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),...payload,systems,groups:systemGroups};
const json=JSON.stringify(snapshot,null,2)+'\n';
await mkdir(join(root,'data'),{recursive:true});
await writeFile(join(root,'data/facade-material-catalog.json'),json);
await writeFile(join(root,'public/facade-calculator/catalog.json'),json);
const methods={frame:'На каркасе',direct:'Непосредственное механическое крепление',bonded:'Клеевое / комбинированное крепление'};
const kinds={metal:'Металлический сайдинг',linear:'Линейные профили',panel:'Листы и модульные панели',wood:'Деревянная облицовка',thermal:'Термопанели с собственным утеплением',sandwich:'Сэндвич-панели с заводским сердечником',seam:'Фальцевая облицовка',unknown:'Тип конструкции и способ монтажа требуют уточнения'};
const lines=['![Подлинный логотип СВОИ ЛЮДИ](brand/logo-sl-approved-light.png)','','# Материалы фасадного калькулятора «СВОИ ЛЮДИ»','',`Последняя дата проверки источников набора: ${checkedAt}. Дата каждой карточки приведена отдельно; она не подтверждает неизменность документа на день нового заказа.`, '',
  'Каталог и справочник создаются из исходных material-catalog.mjs и system-catalog.mjs с карточками соответствующих групп. Название материала не задаёт универсальную конструкцию: производитель, конкретный продукт, тип основания и метод крепления выбираются отдельно. Параметры заказа сверяйте с паспортом и проектом.', '',
  '## Как различаются расчёты','',
  '- Для всех видов: чистая площадь = площадь стен − площадь проёмов. Готовая чистая площадь не уменьшается повторно. Откосы, отливы, углы, старт/финиш и примыкания считаются отдельно по замерам.',
  '- Линейный сайдинг и деревянные доски: количество по чистой площади и рабочему модулю (полезная ширина или шаг с согласованным швом × длина). Направление, зазоры и крепёж берутся из инструкции конкретного материала; правила металлического сайдинга не переносятся на винил, акрил, дерево или ДПК.',
  '- Листовые панели, фиброцемент, АКП, HPL, кассеты и цокольные панели: предварительная потребность по полезной площади выбранного формата. Нужны раскладка, ориентация, размеры модулей, швы, стыки и раскрой; площадь не является оптимизацией раскроя. Скрытый/видимый крепёж, кляммеры, заклёпки и состав подсистемы задаются по выбранной системе.',
  '- Клеевой способ не включает металлическую подсистему автоматически. Подготовка основания, клей/пена, механическое крепление и затирка учитываются только если предусмотрены конкретным продуктом. Их расход вводится по техкарте, а не по общему названию панели.',
  '- Термопанели и сэндвич-панели содержат собственный утепляющий слой / сердечник. Дополнительные слои утепления, мембрана или облицовка не добавляются повторно по умолчанию. Для сэндвич-панелей отдельно определяют несущий каркас, опорные пролёты, крепёж, герметизацию и фасонные элементы; это не обычная сетка лёгкого сайдинга.',
  '- Фальцевая облицовка: рабочая ширина картины, длина и основание — по фасадной системе. Для представленного Кликфальца предусмотрена гвоздевая полка; универсальные кляммеры не подставляются. Кровельная инструкция не доказывает применимость на фасаде; объём и состав крепления не переносятся между применениями.',
  '- «Каменный замок» и другие неоднозначные торговые названия: сначала уточните тип панели, состав, конкретную марку и способ крепления. Без этих сведений нельзя назначать универсальный каркас, клей, утепление или способ расчёта.',
  '- Предварительная сетка направляющих применима только к выбранной каркасной системе и известным прямоугольным стенам: округление вверх(поперечный размер / проектный шаг) + 1, затем × продольный размер. Кронштейны на направляющей: округление вверх(длина / проектный шаг) + 1; анкеры — по подтверждённому узлу. Проёмы из этой сетки не вычитаются; обрамление, усиления, стыки и сложные поверхности уточняются отдельно. Система может требовать иной расчёт; шаги и сечения не назначаются автоматически.',
  '- Каждый отдельно выбранный слой утеплителя: чистая площадь × толщина слоя в мм / 1000. Запас и упаковка — отдельно. Два слоя укладываются со смещением стыков; марки выбираются по допустимой роли слоя и документам всей системы. Для материала со встроенным утеплением сначала проверьте необходимость отдельного слоя.',
  '- Крепёж и расходные материалы по норме: площадь × подтверждённый расход из документа выбранной системы. Для стыков, кляммеров или кромок может требоваться отдельная база длины/количества. Нормы не подменяют друг друга.',
  '- Запас, пригодные закреплённые остатки, подтверждённые открытые заказы и упаковки учитываются в единице строки. Цена должна соответствовать этой единице: м², штука выбранного формата, погонный метр или иной указанный вариант. Для прежних строк металлического сайдинга цена панели задаётся за штуку указанной длины. Запас и упаковка материалов не увеличивают объём труда.',
  '- Старый проект не заменяется просмотром каталога. Комплект применяется явно; новую систему для заполненной вручную сметы создают отдельным объектом по тем же замерам.',
  '- JSON проекта сохраняет выбранный состав и карточки источников. Автосохранение калькулятора — в браузере на данном устройстве; Google Drive диалога помощника не переносит проекты калькулятора автоматически.',
  '- Пустые цены и параметры остаются неизвестными. Количественный расчёт не подтверждает несущую способность, пожарные решения, применимость марки или требуемую теплотехническую толщину.', ''];
function addCard(card,level=4){
  lines.push(`${'#'.repeat(level)} ${card.manufacturer} · ${card.name}`,'');
  if(card.systemKind)lines.push(`Тип расчёта: ${kinds[card.systemKind]||card.systemKind}.`,'');
  const dimensions=[['usefulWidth','Полезная ширина, м'],['fullWidth','Полная ширина, м'],['usefulHeight','Полезная высота, м'],['coverWidth','Рабочая ширина модуля, м'],['coverHeight','Рабочая высота модуля, м'],['panelArea','Полезная площадь панели, м²'],['minLength','Минимальная длина, м'],['maxLength','Максимальная длина, м']].filter(([key])=>card[key]!==undefined);
  if(dimensions.length)lines.push(...dimensions.map(([key,name])=>`${name}: ${card[key]||'по документу / заказу'}.`),'');
  if(card.orientations?.length)lines.push(`Направление: ${card.orientations.join(', ')}.`,'');
  if(card.mountingMethods?.length)lines.push(`Способы монтажа: ${card.mountingMethods.map(m=>methods[m]||m).join('; ')}. Выберите применимый способ по карточке и проекту.`,'');
  if(card.integratedInsulation)lines.push('Есть встроенный утепляющий слой / сердечник: не добавляйте отдельное утепление повторно без проектного основания.','');
  if(card.requiresType)lines.push('Тип продукта и конструкцию необходимо уточнить до применения автоматического комплекта.','');
  if(card.needsJointGrout)lines.push(`${card.groutLabel||'Затирка швов'}: геометрия шва и расход по выбранной системе.`, '');
  if(card.needsJointSealant)lines.push(`${card.sealantLabel||'Герметизация швов'}: материал и расход по выбранной системе.`, '');
  if(card.fastenerLabel)lines.push(`Крепление: ${card.fastenerLabel}. Норма и узел подтверждаются проектом / инструкцией.`, '');
  if(card.needsFabrication)lines.push('Изготовление / обработка облицовки учитываются отдельно по проектной раскладке и технологической карте.', '');
  if(card.needsCoating)lines.push('Отделка / защитное покрытие и его расход определяются документацией продукта.','');
  if(card.application)lines.push(card.application,'');
  if(card.layerRoles)lines.push(`Допустимые роли утеплителя по источникам: ${card.layerRoles.join(', ')||'автоматический подбор запрещён'}.`,'');
  for(const[key,title]of[['mounting','Конструктив и монтаж'],['accessories','Комплектующие'],['limitations','Ограничения']])if(card[key]?.length){lines.push(`**${title}**`,'',...card[key].map(x=>`- ${x}`),'');}
  lines.push('**Источники**','',...(card.sources.length?card.sources.map(s=>`- [${s.title}](${s.url})${s.pages?`; страницы: ${s.pages}`:''}; проверено ${s.checked}.`):['- Документация конкретного продукта не приложена: размеры, конструкцию и применимость требуется подтвердить.']), '');
}
for(const group of systemGroups){
  lines.push(`## ${group.name}`,'');
  for(const system of claddingSystems.filter(s=>s.group===group.id)){
    lines.push(`### ${system.name}`,'');if(system.description)lines.push(system.description,'');if(system.hints?.length)lines.push(...system.hints.map(x=>`- ${x}`),'');
    if(system.id==='metal-siding')for(const family of catalogFamilies){lines.push(`#### ${family.name}`,'');for(const card of family.variants)addCard(card,5);}
    else for(const card of families.find(f=>f.id===system.id).variants)addCard(card);
  }
}
lines.push('## Отдельные утеплители','');for(const card of insulationCatalog)addCard(card,3);
await writeFile(join(root,'public/facade-calculator/materials-guide.md'),lines.join('\n'));
console.log(`Facade catalog: ${systems.length} systems, ${families.length} families, ${ids.size} cards, ${snapshot.fingerprint.slice(0,12)}.`);
