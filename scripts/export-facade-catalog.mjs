import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalogFamilies,insulationCatalog,catalogChecked} from '../public/facade-calculator/material-catalog.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(catalogFamilies.length!==10||!/^\d{4}-\d{2}-\d{2}$/.test(catalogChecked))throw Error('Invalid facade catalog source.');
const ids=new Set();
for(const card of [...catalogFamilies.flatMap(f=>f.variants),...insulationCatalog]){
  if(!card.id||ids.has(card.id)||!card.manufacturer||!card.name)throw Error('Invalid or duplicate material card.');
  ids.add(card.id);
  for(const s of card.sources){const u=new URL(s.url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Invalid material source URL.');}
}
const payload={families:catalogFamilies,insulations:insulationCatalog};
const snapshot={schemaVersion:1,source:'facade-calculator-catalog',checkedAt:catalogChecked,calculatorPath:'/facade-calculator/',fingerprint:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),...payload};
const json=JSON.stringify(snapshot,null,2)+'\n';
await mkdir(join(root,'data'),{recursive:true});
await writeFile(join(root,'data/facade-material-catalog.json'),json);
await writeFile(join(root,'public/facade-calculator/catalog.json'),json);
const lines=['![Подлинный логотип СВОИ ЛЮДИ](brand/logo-sl-approved-light.png)','','# Материалы фасадного калькулятора «СВОИ ЛЮДИ»','',`Дата проверки источников: ${catalogChecked}. Дата не подтверждает неизменность документа на день нового заказа.`, '',
  'Каталог и этот справочник создаются из одного исходника material-catalog.mjs. Профиль, производитель и заводской вариант выбираются отдельно. Приведённые размеры и способы монтажа относятся только к указанному варианту. Параметры конкретного заказа сверяйте с паспортом и проектом.', '',
  '## Как считает калькулятор','',
  '- Чистая площадь = площадь стен − площадь проёмов. Готовая чистая площадь не уменьшается повторно.',
  '- Панели: чистая площадь / (полезная ширина × длина заказной панели), затем введённый запас, остатки, закреплённый заказ и округление до упаковки. Это предварительный расчёт по площади до раскладки и раскроя; цена в строке панелей задаётся за штуку указанной длины.',
  '- Открытый планкен: рабочий модуль с проектным зазором задаётся отдельно от физической ширины рейки.',
  '- Для прямоугольной стены направляющие располагаются поперёк панелей: округление вверх(поперечный размер / проектный шаг) + 1. Их длина = число направляющих × продольный размер. Это предварительная сетка по габариту, без вычета проёмов; усиления, стыки и обрамление добавляются по проектной раскладке.',
  '- Кронштейны на направляющей: округление вверх(длина / проектный шаг кронштейнов) + 1. Анкеры: количество кронштейнов × подтверждённое число анкеров. Шаги и нормы калькулятор не назначает.',
  '- Каждый слой утеплителя: чистая площадь × толщина слоя в мм / 1000. Запас и упаковка — отдельно. Два слоя укладываются со смещением стыков; марки выбираются по допустимой роли слоя и документам всей системы.',
  '- Крепёж по норме: чистая площадь × подтверждённый расход из документа выбранной системы. Крепёж утепления не умножается на число слоёв автоматически.',
  '- Запас и упаковка материалов не увеличивают объём труда. Отливы, откосы, углы, старт и финиш считаются по своим замерам; м² не заменяют погонные метры.',
  '- Старый проект не заменяется просмотром каталога. Комплект применяется явно; новую систему для заполненной вручную сметы создают отдельным объектом по тем же замерам.',
  '- JSON проекта содержит оба варианта и сохраняет прикреплённые карточки источников. Автосохранение этого калькулятора — в браузере на данном устройстве; Google Drive диалога помощника не переносит проекты калькулятора автоматически.',
  '- Пустые цены и параметры остаются неизвестными. Расчёт не подтверждает несущую способность, пожарные решения, применимость марки или теплотехническую толщину.',
  ''];
function addCard(card){
  lines.push(`### ${card.manufacturer} · ${card.name}`,'');
  if('usefulWidth'in card)lines.push(`Полезная / полная ширина: ${card.usefulWidth||'по документу'} / ${card.fullWidth||'по документу'} м. Длина: ${card.minLength||'по заказу'}–${card.maxLength||'по заказу'} м. Направление: ${(card.orientations||[]).join(', ')}.`,'');
  if(card.application)lines.push(card.application,'');
  if(card.layerRoles)lines.push(`Допустимые роли по источникам: ${card.layerRoles.join(', ')||'автоматический подбор запрещён'}.`,'');
  for(const[key,title]of[['mounting','Конструктив и монтаж'],['accessories','Комплектующие'],['limitations','Ограничения']])if(card[key]?.length){lines.push(`**${title}**`,'',...card[key].map(x=>`- ${x}`),'');}
  lines.push('**Источники**','',...(card.sources.length?card.sources.map(s=>`- [${s.title}](${s.url})${s.pages?`; страницы: ${s.pages}`:''}; проверено ${s.checked}.`):['- Документация конкретного продукта не приложена: размеры и применимость должен подтвердить пользователь.']), '');
}
for(const f of catalogFamilies){lines.push(`## ${f.name}`,'');for(const v of f.variants)addCard(v);}
lines.push('## Утеплители','');for(const c of insulationCatalog)addCard(c);
await writeFile(join(root,'public/facade-calculator/materials-guide.md'),lines.join('\n'));
console.log(`Facade catalog: ${catalogFamilies.length} families, ${ids.size} cards, ${snapshot.fingerprint.slice(0,12)}.`);
