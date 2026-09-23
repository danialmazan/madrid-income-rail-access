import './project.css';
import type {AnalysisData,IncomeMetric,Language,MapLayer,State} from './types';
import {metricLabels,number,t} from './types';
import {renderCharts} from './charts';
import {RailMap} from './maps';

declare global{interface Window{RedMargin?:{init:()=>void;initLanguageSwitch:(options:{onChange:(language:Language)=>void})=>unknown}}}
const byId=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const state:State={language:'en',incomeMetric:'income_median_equivalised',method:'entrance',geography:'region',distributionGroups:5,mapLayer:'income'};
let data:AnalysisData,map:RailMap;
function labels(){
  const lang=state.language;
  const metrics=byId<HTMLSelectElement>('income-metric');
  for(const option of Array.from(metrics.options))option.textContent=metricLabels[option.value as IncomeMetric][lang];
  const methods=byId<HTMLSelectElement>('point-method');
  methods.options[0].textContent=t(lang,'Entrance · primary','Entrada · principal');
  methods.options[1].textContent=t(lang,'Platform · sensitivity','Andén · sensibilidad');
  byId<HTMLSelectElement>('geography').options[1].textContent=t(lang,'Madrid municipality','Municipio de Madrid');
  const groups=byId<HTMLSelectElement>('distribution-groups');
  groups.options[0].textContent=t(lang,'Quintiles','Quintiles');
  groups.options[1].textContent=t(lang,'Deciles','Deciles');
  byId('hero-pop').textContent=number(data.sections.reduce((n,s)=>n+s.section_population,0),lang);
  byId('scatter-chart').setAttribute('aria-label',t(lang,'Scatter plot of section income and rail access','Gráfico de dispersión de renta y acceso ferroviario por sección'));
  byId('decile-chart').setAttribute('aria-label',t(lang,'Access score by area-income decile; select bars for details','Puntuación por decil de renta de la zona; selecciona las barras para ver detalles'));
  byId('box-chart').setAttribute('aria-label',t(lang,'Access score distributions by area-income group; select boxes for details','Distribuciones de acceso por grupo de renta; selecciona las cajas para ver detalles'));
  byId('cdf-chart').setAttribute('aria-label',t(lang,'Resident cumulative score curves; use left and right arrows for details','Curvas acumuladas de puntuación; usa las flechas izquierda y derecha para ver detalles'));
  byId('map').setAttribute('aria-label',t(lang,'Interactive map of Madrid income and rail access','Mapa interactivo de renta y acceso ferroviario de Madrid'));
  const summary=data.summaries.find(x=>x.geography===state.geography&&x.income_metric===state.incomeMetric&&x.method===state.method)!;
  const deciles=data.deciles.filter(x=>x.geography===state.geography&&x.income_metric===state.incomeMetric&&x.method===state.method);
  const gap=deciles.find(x=>x.group===10)!.mean_score-deciles.find(x=>x.group===1)!.mean_score;
  byId('finding').textContent=t(lang,
    `Across ${number(summary.sections,lang)} sections, the income–access association is ${summary.spearman_rho>=0?'positive':'negative'} (Spearman ρ ${number(summary.spearman_rho,lang,2)}). The highest area-income decile's average score is ${number(Math.abs(gap),lang,2)} ${gap>=0?'above':'below'} the lowest.`,
    `En ${number(summary.sections,lang)} secciones, la asociación entre renta y acceso es ${summary.spearman_rho>=0?'positiva':'negativa'} (ρ de Spearman ${number(summary.spearman_rho,lang,2)}). La puntuación media del decil de zonas con mayor renta está ${number(Math.abs(gap),lang,2)} puntos ${gap>=0?'por encima':'por debajo'} de la del decil inferior.`);
  const missing=data.sections.filter(x=>(state.geography==='region'||x.CUMUN==='28079')&&x[state.incomeMetric]===null);
  const missingPopulation=missing.reduce((n,x)=>n+x.section_population,0);
  byId('missing-note').textContent=t(lang,
    `${number(missing.length,lang)} sections (${number(missingPopulation,lang)} modelled residents) have missing or suppressed income for this measure. They appear as No data on the income map and are excluded from income comparisons.`,
    `${number(missing.length,lang)} secciones (${number(missingPopulation,lang)} residentes modelizados) carecen de renta publicada para esta medida. Aparecen como «Sin datos» en el mapa de renta y se excluyen de las comparaciones de renta.`);
  document.querySelectorAll<HTMLElement>('.analysis-chapter figure figcaption').forEach(caption=>{
    let note=caption.querySelector<HTMLElement>('.figure-provenance');
    if(!note){note=document.createElement('span');note.className='figure-provenance';caption.append(note)}
    note.textContent=`${t(lang,'Income: INE ADRH 2023 · rail: CRTM 2026 · population: modelled 2025 ·','Renta: INE ADRH 2023 · tren: CRTM 2026 · población: modelizada 2025 ·')} ${state.geography==='city'?t(lang,'Madrid municipality','Municipio de Madrid'):t(lang,'Comunidad de Madrid','Comunidad de Madrid')} · ${state.method==='entrance'?t(lang,'entrance score','puntuación desde entradas'):t(lang,'platform score','puntuación desde andenes')}`;
  });
}
function update(){if(!data)return;labels();renderCharts(data,state);map?.update(state)}
async function init(){
  const response=await fetch(new URL('data/analysis.json',document.baseURI));
  if(!response.ok)throw new Error(`Analysis data request failed: ${response.status}`);
  data=await response.json() as AnalysisData;
  const kit=window.RedMargin;
  kit?.init();
  kit?.initLanguageSwitch({onChange:language=>{state.language=language;update()}});
  if(!kit){state.language=new URL(location.href).searchParams.get('lang')==='es'?'es':'en';document.documentElement.lang=state.language;update()}
  map=new RailMap(data,state);
  byId<HTMLSelectElement>('income-metric').addEventListener('change',e=>{state.incomeMetric=(e.target as HTMLSelectElement).value as IncomeMetric;update()});
  byId<HTMLSelectElement>('point-method').addEventListener('change',e=>{state.method=(e.target as HTMLSelectElement).value as State['method'];update()});
  byId<HTMLSelectElement>('geography').addEventListener('change',e=>{state.geography=(e.target as HTMLSelectElement).value as State['geography'];update();map.reset()});
  byId<HTMLSelectElement>('distribution-groups').addEventListener('change',e=>{state.distributionGroups=Number((e.target as HTMLSelectElement).value) as 5|10;update()});
  document.querySelectorAll<HTMLButtonElement>('[data-map-layer]').forEach(button=>button.addEventListener('click',()=>{
    state.mapLayer=button.dataset.mapLayer as MapLayer;
    document.querySelectorAll<HTMLButtonElement>('[data-map-layer]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
    map.update(state);
  }));
  byId('map-reset').addEventListener('click',()=>map.reset());
  let timer:number|undefined;
  window.addEventListener('resize',()=>{clearTimeout(timer);timer=window.setTimeout(()=>{renderCharts(data,state);map.map.resize()},150)});
}
init().catch(error=>{console.error(error);const detail=byId('chart-detail');detail.textContent='Analysis data could not be loaded. Check the local data build.'});
