import * as d3 from 'd3';
import type {Language} from './types';
import {number,t} from './types';
import {renderScoreLedger} from './score-model';
import type {ScoreLine} from './score-model';
interface Station{id:string;station_id:string;name:string;x:number;y:number;distance_m:number;lines:string|string[]}
interface Example{id:string;title_en:string;title_es:string;component_key:string;CUSEC:string;
  population:number;score:number;stations:Station[];lines:ScoreLine[];protected_distance_m:number;
  full_score:number;raw_tail:number;tail_cap:number;tail_score:number}
let examples:Example[]=[];let selected=0;
const el=(id:string)=>document.getElementById(id)!;
export async function initExamples(){
  const response=await fetch(new URL('data/score_examples.json',document.baseURI));
  if(!response.ok)throw new Error('Score examples could not be loaded');
  examples=await response.json() as Example[];
  const select=el('score-example') as HTMLSelectElement;
  select.addEventListener('change',()=>{selected=Number(select.value);renderExamples(document.documentElement.lang==='es'?'es':'en')});
  renderExamples(document.documentElement.lang==='es'?'es':'en');
}
export function renderExamples(language:Language){
  if(!examples.length)return;
  const select=el('score-example') as HTMLSelectElement;
  select.replaceChildren(...examples.map((d,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=language==='es'?d.title_es:d.title_en;return o}));select.value=String(selected);
  const e=examples[selected],heading=language==='es'?e.title_es:e.title_en;
  el('example-heading').textContent=heading;
  el('example-total').textContent=`${t(language,'Rail Access Score','Puntuación ferroviaria')} ${number(e.score,language,2)}`;
  el('example-explanation').textContent=`${t(language,'Residential component','Componente residencial')} ${e.component_key} · ${t(language,'Section','Sección')} ${e.CUSEC} · ${number(e.population,language)} ${t(language,'modelled residents','residentes modelizados')}. ${t(language,'The nearest two different stations on each line set its raw contribution. Distant lines have diminishing returns.','Las dos estaciones diferentes más próximas de cada línea determinan su aportación bruta. Las líneas lejanas tienen rendimientos decrecientes.')}`;
  const host=el('example-diagram');host.replaceChildren();
  const w=Math.max(640,host.clientWidth||900),h=480,cx=w/2,cy=h/2;
  const svg=d3.select(host).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
  const maxRadius=Math.min(w*.37,h*.42), scale=d3.scaleLinear().domain([0,1000]).range([0,maxRadius]);
  for(const r of [600,1000])svg.append('circle').attr('cx',cx).attr('cy',cy).attr('r',scale(r)).attr('class','distance-ring');
  svg.append('text').attr('x',cx+scale(600)+3).attr('y',cy-5).attr('class','ring-label').text('600 m');
  svg.append('text').attr('x',cx+scale(1000)+3).attr('y',cy-5).attr('class','ring-label').text('1,000 m');
  svg.append('circle').attr('cx',cx).attr('cy',cy).attr('r',9).attr('class','home-point');
  svg.append('text').attr('x',cx+13).attr('y',cy-13).attr('class','station-label').text(t(language,'Home','Vivienda'));
  for(const station of e.stations){
    if(station.distance_m>1000)continue;
    const sx=cx+scale(station.x),sy=cy-scale(station.y);
    svg.append('line').attr('x1',cx).attr('y1',cy).attr('x2',sx).attr('y2',sy).attr('class','station-distance');
    svg.append('circle').attr('cx',sx).attr('cy',sy).attr('r',6).attr('class','station-point');
    const lines=Array.isArray(station.lines)?station.lines.join(', '):station.lines;
    svg.append('text').attr('x',sx+9).attr('y',sy-9).attr('class','station-label').text(station.name);
    svg.append('text').attr('x',sx+9).attr('y',sy+7).attr('class','station-sub').text(`${number(station.distance_m,language)} m · ${lines}`);
  }
  host.setAttribute('aria-label',`${heading}. ${e.stations.length} ${t(language,'nearby stations','estaciones cercanas')}.`);
  renderScoreLedger(el('example-ledger') as HTMLElement,e,language);
}
