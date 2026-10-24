import {number,uid} from './engine.mjs';
export function parseTakeoff(text){
  const lines=String(text).split(/\r?\n/).filter(x=>x.trim());
  if(lines.length>201)throw Error('В ведомости может быть не более 200 поверхностей.');
  const walls=[];
  for(const [i,line] of lines.entries()){
    const cells=line.split(/[;\t]/).map(x=>x.trim());
    if(i===0&&/ширина/i.test(cells[1]||'')&&/высота/i.test(cells[2]||''))continue;
    if(cells.length!==3||!cells[0]||cells[0].length>200||!(number(cells[1])>0)||!(number(cells[2])>0))throw Error(`Строка ${i+1}: нужны название; ширина в метрах; высота в метрах. Размеры должны быть больше нуля.`);
    walls.push({id:uid(),name:cells[0],shape:'rect',width:cells[1],height:cells[2],topWidth:''});
  }
  if(!walls.length)throw Error('Добавьте хотя бы одну поверхность с размерами.');
  return walls;
}
