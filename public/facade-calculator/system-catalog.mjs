import {catalogFamilies} from './material-catalog.mjs';
import {sidingSystems} from './systems/siding.mjs';
import {panelSystems} from './systems/panels.mjs';
import {metalSystems} from './systems/metal.mjs';

export const systemGroups=[{id:'siding',name:'Сайдинговые системы'},{id:'panels',name:'Панельные и комбинированные решения'},{id:'metal',name:'Металлические системы'}];
const metalSiding={id:'metal-siding',name:'Металлический сайдинг',group:'siding',kind:'metal',description:'Профили оцинкованной стали с полимерным покрытием. Геометрия и монтаж зависят от производителя и заводского варианта.',hints:['Выберите один из десяти профилей и конкретного производителя. Сохранённые металлические комплекты сохраняют прежний способ расчёта.'],families:catalogFamilies};
const order=['vinyl','acrylic','metal-siding','fibercement','wood','plinth','thermal','wpc','acp','hpl','sandwich','stone-lock','cassettes','profiled','seam'];
export const claddingSystems=[...sidingSystems,metalSiding,...panelSystems,...metalSystems].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));

export function selectSystem(systemId='metal-siding',familyId='',variantId=''){
  const system=claddingSystems.find(s=>s.id===systemId)||metalSiding;
  const families=system.id==='metal-siding'?catalogFamilies:[{id:system.id,name:system.name,variants:system.variants}];
  const family=families.find(f=>f.id===familyId)||families[0];
  const selected=family.variants.find(v=>v.id===variantId)||family.variants[0];
  const metadata=system.id==='metal-siding'?{systemId:system.id}:{systemId:system.id,systemKind:system.kind,grid:system.grid,integratedInsulation:system.integratedInsulation,mountingMethods:system.mountingMethods};
  const variant={...Object.fromEntries(Object.entries(metadata).filter(([,v])=>v!==undefined)),...selected};
  return {system,families,family,variant};
}
