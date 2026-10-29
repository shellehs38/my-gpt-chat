import { createProject, changeAssembly } from './engine.mjs';

// Published numerical facts only. Plans/photos remain on their authors' websites.
export const PROJECTS = [
  { id: 'nalchik-6x6', technology: 'timber', title: 'Нальчик · брус 6×6', url: 'https://brus-teh.ru/projects/dom-iz-brusa-nalchik-66/', checked: '2026-10-29', length: '6', width: '6', publishedArea: '51 м² по карточке',
    note: 'Дом с мансардой и ломаной крышей. В комплектации «под ключ» описаны каркасные фронтоны. Высота потолка не равна высоте наружной стены. Габариты из карточки нужно сверить с контуром и пристройками на плане. Для подсчёта бруса нужны раскладка венцов, выпуски, узлы и спецификация.', gableStructure: 'frame' },
  { id: 'odk-6x8', technology: 'frame', title: 'ОДК 6×8 · каркас', url: 'https://asksl.ru/project/karkasnyj-dom-odk-6x8/', checked: '2026-10-29', length: '8', width: '6', publishedArea: '45,93 м² по карточке',
    note: 'Одноэтажный проект. Размеры 6×8 опубликованы в карточке. В комплектации приведены высота потолка 2,5 м и утепление 150 мм; это не подтверждает высоту стен, чистую площадь ячеек и пригодность комплектации для Иркутска. Наружный прямоугольник 48 м² не подменяет опубликованную площадь.', gableStructure: 'same' },
  { id: 're-103', technology: 'foam', title: 'RE-103 · вариант из пенобетона', url: 'https://realzagdom.ru/katalog/proekt-doma-re-103.php', checked: '2026-10-29', length: '10', width: '8', publishedArea: '103 м² по карточке',
    note: 'Проект 8×10 с балконом и террасой. Варианты наружных стен разделены: пенобетон 375 мм D600 и газобетон 375 мм D500. Выбран именно вариант пенобетона. Наружный прямоугольник не означает сплошной контур обоих этажей: для реального заказа нужны поэтажные обмеры и рабочие чертежи.', gableStructure: 'same' }
];
export function referenceProject(id) {
  const item = PROJECTS.find(p => p.id === id);
  if (!item) throw Error('Проект не найден.');
  const p = changeAssembly(createProject(item.technology), { gableStructure: item.gableStructure });
  p.name = `${item.title} — проверка исходных данных`;
  p.geometry.length = item.length; p.geometry.width = item.width;
  p.reference = { title: item.title, url: item.url, checked: item.checked, publishedArea: item.publishedArea, note: item.note };
  p.sourceDocument = `Публичная карточка: ${item.url}\nПроверена ${item.checked}. Перенесены только габариты карточки, не рабочий проект.`;
  p.assumptions = 'Прямоугольный контур используется только как предварительная геометрическая модель.\nВысоты стен, проёмы, фронтоны, фундамент, перекрытия, кровля, раскрой, запасы и цены требуют ввода по проекту.\nЧужие планы и фотографии не включены в нашу калькуляцию; права остаются у авторов.';
  return p;
}
