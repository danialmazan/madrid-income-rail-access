import './project.css';
import type {AnalysisData,IncomeMetric,Language,MapLayer,State} from './types';
import {metricLabels,number,t} from './types';
import {renderCharts} from './charts';
import {RailMap} from './maps';
import {FileRailMap} from './file-map';
import {initExamples,renderExamples} from './examples';
import {AddressScore} from './address-score';

declare global{interface Window{RedMargin?:{init:()=>void;initLanguageSwitch:(options:{onChange:(language:Language)=>void})=>unknown}}}
const byId=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const state:State={language:'en',incomeMetric:'income_median_equivalised',method:'entrance',geography:'city',mapLayer:'bivariate'};
let data:AnalysisData,map:RailMap|FileRailMap,address:AddressScore|undefined;
function labels(){
  const lang=state.language;
  const metrics=byId<HTMLSelectElement>('income-metric');
  for(const option of Array.from(metrics.options))option.textContent=metricLabels[option.value as IncomeMetric][lang];
  const methods=byId<HTMLSelectElement>('point-method');
  methods.options[0].textContent=t(lang,'Entrance · primary','Entrada · principal');
  methods.options[1].textContent=t(lang,'Platform · sensitivity','Andén · sensibilidad');
  byId<HTMLSelectElement>('geography').options[0].textContent=t(lang,'Madrid (city)','Madrid (ciudad)');
  const area=data.sections.filter(s=>state.geography==='region'||s.CUMUN==='28079');
  const pop=area.reduce((n,s)=>n+s.section_population,0);
  const scoreColumn=state.method==='entrance'?'rail_score_entrance':'rail_score_platform';
  const weighted=area.reduce((n,s)=>n+s.section_population*s[scoreColumn],0)/pop;
  const place=state.geography==='city'?t(lang,'Madrid city','la ciudad de Madrid'):t(lang,'the Comunidad de Madrid','la Comunidad de Madrid');
  byId('hero-pop').textContent=number(pop,lang);
  byId('hero-score').textContent=number(weighted,lang,2);
  byId('hero-pop-label').textContent=t(lang,`Residents analysed in ${place}.`,`Residentes analizados en ${place}.`);
  byId('hero-score-label').textContent=t(lang,`Population-weighted Rail Access Score in ${place}.`,`Puntuación ferroviaria ponderada por población en ${place}.`);
  renderExamples(lang);
  byId('scatter-chart').setAttribute('aria-label',t(lang,'Scatter plot of section income and rail access','Gráfico de dispersión de renta y acceso ferroviario por sección'));
  byId('decile-chart').setAttribute('aria-label',t(lang,'Weighted box plots of section Rail Access Score by income decile','Diagramas de caja ponderados de puntuación ferroviaria por decil de renta'));
  byId('cdf-chart').setAttribute('aria-label',t(lang,'Building score distribution by area-income quintile','Distribución de puntuaciones de edificios por quintil de renta'));
  byId('reverse-chart').setAttribute('aria-label',t(lang,'Income quintile mix by building-score decile','Composición de quintiles de renta por decil de puntuación ferroviaria'));
  byId('map').setAttribute('aria-label',t(lang,'Interactive map of Madrid income and rail access','Mapa interactivo de renta y acceso ferroviario de Madrid'));
  const summary=data.summaries.find(x=>x.geography===state.geography&&x.income_metric===state.incomeMetric&&x.method===state.method)!;
  const deciles=data.deciles.filter(x=>x.geography===state.geography&&x.income_metric===state.incomeMetric&&x.method===state.method);
  const gap=deciles.find(x=>x.group===10)!.mean_score-deciles.find(x=>x.group===1)!.mean_score;
  const rho=summary.spearman_rho;
  const strength=Math.abs(rho)<.1?t(lang,'very weak','muy débil'):Math.abs(rho)<.3?t(lang,'weak','débil'):Math.abs(rho)<.5?t(lang,'moderate','moderada'):t(lang,'strong','fuerte');
  byId('finding').textContent=t(lang,
    `The association between section income and rail access is ${rho>=0?'positive':'negative'} but ${strength} in ${state.geography==='city'?'Madrid city':'the Comunidad de Madrid'}. The highest-income decile’s mean score is ${number(Math.abs(gap),lang,2)} ${gap>=0?'above':'below'} the lowest-income decile.`,
    `La asociación entre la renta de las secciones y el acceso ferroviario es ${rho>=0?'positiva':'negativa'} pero ${strength} en ${state.geography==='city'?'la ciudad de Madrid':'la Comunidad de Madrid'}. La puntuación media del decil de mayor renta está ${number(Math.abs(gap),lang,2)} puntos ${gap>=0?'por encima':'por debajo'} de la del decil de menor renta.`);
  const missing=area.filter(x=>x[state.incomeMetric]===null);
  const missingPopulation=missing.reduce((n,x)=>n+x.section_population,0);
  byId('missing-note').textContent=missing.length===0?'':t(lang,
    `${number(missing.length,lang)} sections (${number(missingPopulation,lang)} modelled residents) have missing or suppressed income for this measure. They appear as No data on the income map and are excluded from income comparisons.`,
    `${number(missing.length,lang)} secciones (${number(missingPopulation,lang)} residentes modelizados) carecen de renta publicada para esta medida. Aparecen como «Sin datos» en el mapa de renta y se excluyen de las comparaciones de renta.`);
  document.querySelectorAll<HTMLElement>('.analysis-chapter figure figcaption').forEach(caption=>{
    let note=caption.querySelector<HTMLElement>('.figure-provenance');
    if(!note){note=document.createElement('span');note.className='figure-provenance';caption.append(note)}
    note.textContent=`${t(lang,'Sources: INE ADRH 2023 income · INE 2024 sections · modelled 2025 population · CRTM 2026 rail ·','Fuentes: renta INE ADRH 2023 · secciones INE 2024 · población modelizada 2025 · tren CRTM 2026 ·')} ${state.geography==='city'?t(lang,'Madrid city','Ciudad de Madrid'):t(lang,'Comunidad de Madrid','Comunidad de Madrid')} · ${state.method==='entrance'?t(lang,'entrance score','puntuación desde entradas'):t(lang,'platform score','puntuación desde andenes')}`;
  });
}
function update(){if(!data)return;labels();renderCharts(data,state);map?.update(state);address?.update(state)}
async function init(){
  const response=await fetch(new URL('data/analysis.json',document.baseURI));
  if(!response.ok)throw new Error(`Analysis data request failed: ${response.status}`);
  data=await response.json() as AnalysisData;
  const kit=window.RedMargin;
  kit?.init();
  kit?.initLanguageSwitch({onChange:language=>{state.language=language;update()}});
  if(!kit){state.language=new URL(location.href).searchParams.get('lang')==='es'?'es':'en';document.documentElement.lang=state.language;update()}
  map=location.protocol==='file:'||new URL(location.href).searchParams.get('map')==='inline'?new FileRailMap(data,state):new RailMap(data,state);
  await initExamples();
  address=new AddressScore(state);
  byId<HTMLSelectElement>('income-metric').addEventListener('change',e=>{state.incomeMetric=(e.target as HTMLSelectElement).value as IncomeMetric;update()});
  byId<HTMLSelectElement>('point-method').addEventListener('change',e=>{state.method=(e.target as HTMLSelectElement).value as State['method'];update()});
  byId<HTMLSelectElement>('geography').addEventListener('change',e=>{state.geography=(e.target as HTMLSelectElement).value as State['geography'];update();map.reset()});
  document.querySelectorAll<HTMLButtonElement>('[data-map-layer]').forEach(button=>button.addEventListener('click',()=>{
    state.mapLayer=button.dataset.mapLayer as MapLayer;
    document.querySelectorAll<HTMLButtonElement>('[data-map-layer]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
    map.update(state);
  }));
  byId('map-reset').addEventListener('click',()=>map.reset());
  let timer:number|undefined;
  window.addEventListener('resize',()=>{clearTimeout(timer);timer=window.setTimeout(()=>{renderCharts(data,state);map.resize()},150)});
}
init().catch(error=>{console.error(error);byId('chart-detail').textContent='Analysis data could not be loaded. Check the local data build.'});
