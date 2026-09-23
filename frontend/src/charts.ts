import * as d3 from 'd3';
import type {AnalysisData,CDFRow,GroupRow,Section,State,Summary} from './types';
import {metricLabels,money,number,t} from './types';

const colors=['#6D4651','#C48569','#AAA49B','#6F8B91','#262321'];
const tooltip=document.querySelector<HTMLElement>('#tooltip')!;
const detail=document.querySelector<HTMLElement>('#chart-detail')!;
const select=<T extends Element=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const active=(d:AnalysisData,s:State):Summary=>d.summaries.find(x=>x.geography===s.geography&&x.income_metric===s.incomeMetric&&x.method===s.method)!;
const rows=(d:AnalysisData,s:State):Section[]=>d.sections.filter(x=>(s.geography==='region'||x.CUMUN==='28079')&&x[s.incomeMetric]!==null&&x.section_population>0);
const score=(r:Section,s:State)=>r[s.method==='entrance'?'rail_score_entrance':'rail_score_platform'];
const show=(event:PointerEvent,message:string)=>{tooltip.textContent=message;tooltip.hidden=false;tooltip.style.left=`${Math.min(innerWidth-340,event.clientX+16)}px`;tooltip.style.top=`${Math.min(innerHeight-100,event.clientY+14)}px`;};
const hide=()=>{tooltip.hidden=true};

function canvas(id:string,height=400,left=68,bottom=52){
  const el=select<HTMLElement>(id);el.innerHTML='';
  const width=Math.max(360,el.clientWidth||850),m={top:20,right:24,bottom,left};
  const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${width} ${height}`);
  const g=svg.append('g').attr('transform',`translate(${m.left},${m.top})`);
  return {el,svg,g,width,height,innerW:width-m.left-m.right,innerH:height-m.top-m.bottom,m};
}
function axes(g:d3.Selection<SVGGElement,unknown,null,undefined>,x:d3.ScaleLinear<number,number>,y:d3.ScaleLinear<number,number>,w:number,h:number,xformat:(x:number)=>string,yformat:(y:number)=>string){
  g.append('g').attr('class','grid').call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(()=>'')).select('.domain').remove();
  g.append('g').attr('class','axis').attr('transform',`translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickFormat(v=>xformat(Number(v))));
  g.append('g').attr('class','axis').call(d3.axisLeft(y).ticks(5).tickFormat(v=>yformat(Number(v))));
}

export function renderScatter(data:AnalysisData,state:State){
  const current=active(data,state),r=rows(data,state).sort((a,b)=>(a[state.incomeMetric]??0)-(b[state.incomeMetric]??0));
  const {g,innerW,innerH}=canvas('#scatter-chart',430,77,56);
  const x=d3.scaleLinear().domain(d3.extent(r,d=>d[state.incomeMetric]!) as [number,number]).nice().range([0,innerW]);
  const y=d3.scaleLinear().domain([0,d3.max(r,d=>score(d,state))??1]).nice().range([innerH,0]);
  axes(g,x,y,innerW,innerH,v=>number(v/1000,state.language,0)+'k',v=>number(v,state.language,1));
  const smooth=data.smoothers.filter(d=>d.geography===state.geography&&d.income_metric===state.incomeMetric&&d.method===state.method&&Number.isFinite(d.score));
  g.append('path').datum(smooth).attr('class','smooth').attr('d',d3.line<typeof smooth[number]>().x(d=>x(d.income)).y(d=>y(d.score)));
  const dots=g.selectAll<SVGCircleElement,Section>('circle.dot').data(r,d=>d.CUSEC).join('circle').attr('class','dot').attr('cx',d=>x(d[state.incomeMetric]!)).attr('cy',d=>y(score(d,state))).attr('r',3.1);
  const describe=(d:Section)=>`${d.CUSEC} · ${d.NMUN} · ${t(state.language,'District','Distrito')} ${d.district}\n${metricLabels[state.incomeMetric][state.language]}: ${money(d[state.incomeMetric]!,state.language)}\n${t(state.language,'Rail Access Score','Puntuación de acceso')}: ${number(score(d,state),state.language,2)}\n${t(state.language,'Residents','Residentes')}: ${number(d.section_population,state.language)}`;
  dots.on('pointermove',(event,d)=>show(event,describe(d))).on('pointerleave',hide).on('click',(_,d)=>{detail.textContent=describe(d).replaceAll('\n',' · ')});
  let keyboardIndex=0;
  select('#scatter-chart').onkeydown=(event:Event)=>{const e=event as KeyboardEvent;if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();keyboardIndex=Math.max(0,Math.min(r.length-1,keyboardIndex+(e.key==='ArrowRight'?1:-1)));const d=r[keyboardIndex];dots.classed('active',x=>x.CUSEC===d.CUSEC);detail.textContent=describe(d).replaceAll('\n',' · ')};
  detail.textContent=t(state.language,`${number(current.sections,state.language)} sections. Focus the chart and use arrow keys to inspect.`,`${number(current.sections,state.language)} secciones. Enfoca el gráfico y usa las flechas para consultar.`);
  select('#scatter-rho').textContent=`ρ = ${number(current.spearman_rho,state.language,2)} · ${t(state.language,'section Spearman','Spearman por sección')}`;
  select('#scatter-heading').textContent=`${metricLabels[state.incomeMetric][state.language]} × ${t(state.language,'Rail Access Score','puntuación de acceso')}`;
}

function groupData(data:AnalysisData,state:State,groups:5|10){return (groups===5?data.quintiles:data.deciles).filter(d=>d.geography===state.geography&&d.income_metric===state.incomeMetric&&d.method===state.method).sort((a,b)=>a.group-b.group)}
export function renderDeciles(data:AnalysisData,state:State){
  const r=groupData(data,state,10),{g,innerW,innerH}=canvas('#decile-chart',370,58,48);
  const x=d3.scaleBand<number>().domain(r.map(d=>d.group)).range([0,innerW]).padding(.26);
  const y=d3.scaleLinear().domain([0,d3.max(r,d=>Math.max(d.p75,d.mean_score))??1]).nice().range([innerH,0]);
  g.append('g').attr('class','grid').call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(()=>'')).select('.domain').remove();
  g.append('g').attr('class','axis').call(d3.axisLeft(y).ticks(5).tickFormat(v=>number(Number(v),state.language,1)));
  g.append('g').attr('class','axis').attr('transform',`translate(0,${innerH})`).call(d3.axisBottom(x).tickFormat(v=>String(v)));
  const describe=(d:GroupRow)=>`${t(state.language,'Decile','Decil')} ${d.group} · ${t(state.language,'Mean score','Puntuación media')}: ${number(d.mean_score,state.language,2)} · ${t(state.language,'Residents','Residentes')}: ${number(d.population,state.language)} (${number(d.population_share*100,state.language,1)}%)`;
  g.selectAll<SVGRectElement,GroupRow>('rect.bar').data(r).join('rect').attr('class','bar').attr('x',d=>x(d.group)!).attr('y',d=>y(d.mean_score)).attr('width',x.bandwidth()).attr('height',d=>innerH-y(d.mean_score)).attr('tabindex',0).attr('role','button').attr('aria-label',describe).on('pointermove',(event,d)=>show(event,describe(d))).on('pointerleave',hide).on('click',(_,d)=>{select('#decile-detail').textContent=describe(d)}).on('keydown',(event,d)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select('#decile-detail').textContent=describe(d)}});
  g.selectAll<SVGLineElement,GroupRow>('line.whisker').data(r).join('line').attr('class','whisker').attr('x1',d=>x(d.group)!+x.bandwidth()/2).attr('x2',d=>x(d.group)!+x.bandwidth()/2).attr('y1',d=>y(d.p25)).attr('y2',d=>y(d.p75));
}

export function renderBoxes(data:AnalysisData,state:State){
  const r=groupData(data,state,state.distributionGroups),{g,innerW,innerH}=canvas('#box-chart',370,58,48);
  const x=d3.scaleBand<number>().domain(r.map(d=>d.group)).range([0,innerW]).padding(.35);
  const y=d3.scaleLinear().domain([0,d3.max(r,d=>d.p90)??1]).nice().range([innerH,0]);
  g.append('g').attr('class','grid').call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(()=>'')).select('.domain').remove();
  g.append('g').attr('class','axis').call(d3.axisLeft(y).ticks(5).tickFormat(v=>number(Number(v),state.language,1)));
  g.append('g').attr('class','axis').attr('transform',`translate(0,${innerH})`).call(d3.axisBottom(x));
  g.selectAll<SVGLineElement,GroupRow>('line.whisker').data(r).join('line').attr('class','whisker').attr('x1',d=>x(d.group)!+x.bandwidth()/2).attr('x2',d=>x(d.group)!+x.bandwidth()/2).attr('y1',d=>y(d.p10)).attr('y2',d=>y(d.p90));
  const describe=(d:GroupRow)=>`${t(state.language,'Group','Grupo')} ${d.group} · P10–P90: ${number(d.p10,state.language,2)}–${number(d.p90,state.language,2)} · ${t(state.language,'Median','Mediana')}: ${number(d.median_score,state.language,2)}`;
  g.selectAll<SVGRectElement,GroupRow>('rect.box').data(r).join('rect').attr('class','box').attr('x',d=>x(d.group)!).attr('y',d=>y(d.p75)).attr('width',x.bandwidth()).attr('height',d=>y(d.p25)-y(d.p75)).attr('tabindex',0).attr('role','button').attr('aria-label',describe).on('pointermove',(event,d)=>show(event,describe(d))).on('pointerleave',hide).on('click',(_,d)=>{select('#box-detail').textContent=describe(d)}).on('keydown',(event,d)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select('#box-detail').textContent=describe(d)}});
  g.selectAll<SVGLineElement,GroupRow>('line.median').data(r).join('line').attr('class','median').attr('x1',d=>x(d.group)!).attr('x2',d=>x(d.group)!+x.bandwidth()).attr('y1',d=>y(d.median_score)).attr('y2',d=>y(d.median_score));
}

export function renderCDF(data:AnalysisData,state:State){
  const r=data.cdfs.filter(d=>d.geography===state.geography&&d.income_metric===state.incomeMetric&&d.method===state.method);
  const {g,innerW,innerH}=canvas('#cdf-chart',395,62,55);
  const x=d3.scaleLinear().domain([0,d3.max(r,d=>d.score)??1]).range([0,innerW]);
  const y=d3.scaleLinear().domain([0,1]).range([innerH,0]);
  axes(g,x,y,innerW,innerH,v=>number(v,state.language,1),v=>number(v*100,state.language)+'%');
  for(let group=1;group<=5;group++){
    const values=r.filter(d=>d.group===group);
    g.append('path').datum(values).attr('fill','none').attr('stroke',colors[group-1]).attr('stroke-width',group===1||group===5?3:2).attr('d',d3.line<CDFRow>().x(d=>x(d.score)).y(d=>y(d.share)));
  }
  const legend=select('#cdf-legend');legend.innerHTML='';
  for(let group=1;group<=5;group++){
    const item=document.createElement('span');const mark=document.createElement('i');mark.style.setProperty('--line-color',colors[group-1]);item.append(mark,document.createTextNode(`${t(state.language,'Income quintile','Quintil de renta')} ${group}`));legend.append(item);
  }
  const focus=g.append('line').attr('y1',0).attr('y2',innerH).attr('stroke','#A82D31').attr('stroke-dasharray','3 3').style('display','none');
  const describe=(value:number)=>{const lines=Array.from({length:5},(_,i)=>{const series=r.filter(d=>d.group===i+1);const row=d3.least(series,d=>Math.abs(d.score-value));return `Q${i+1}: ${number((row?.share??0)*100,state.language,1)}%`});return `${t(state.language,'Score','Puntuación')} ${number(value,state.language,2)} · ${lines.join(' · ')}`};
  const inspect=(value:number)=>{focus.attr('x1',x(value)).attr('x2',x(value)).style('display',null);select('#cdf-detail').textContent=describe(value)};
  g.append('rect').attr('width',innerW).attr('height',innerH).attr('fill','transparent').on('pointermove',event=>{const value=x.invert(d3.pointer(event)[0]);inspect(value);show(event,describe(value))}).on('pointerleave',()=>{focus.style('display','none');hide()});
  let keyboardValue=0;
  select('#cdf-chart').onkeydown=(event:Event)=>{const e=event as KeyboardEvent;if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();keyboardValue=Math.max(0,Math.min(x.domain()[1],keyboardValue+(e.key==='ArrowRight'?1:-1)*x.domain()[1]/20));inspect(keyboardValue)};
}

export function renderFour(data:AnalysisData,state:State){
  const s=active(data,state),labels:Record<string,[string,string]>={
    lower_income_lower_access:['Lower income / lower access','Menor renta / menor acceso'],
    lower_income_higher_access:['Lower income / higher access','Menor renta / mayor acceso'],
    higher_income_lower_access:['Higher income / lower access','Mayor renta / menor acceso'],
    higher_income_higher_access:['Higher income / higher access','Mayor renta / mayor acceso']
  };
  const host=select('#four-grid');host.innerHTML='';
  for(const key of Object.keys(labels)){
    const row=s.quadrants.find(x=>x.quadrant===key),cell=document.createElement('article');cell.className='four-cell';cell.dataset.quadrant=key;
    const label=document.createElement('span');label.className='quadrant-label';label.textContent=labels[key][state.language==='es'?1:0];
    const value=document.createElement('strong');value.textContent=number((row?.population_share??0)*100,state.language,1)+'%';
    const count=document.createElement('small');count.textContent=`${number(row?.population??0,state.language)} ${t(state.language,'residents','residentes')} · ${number(row?.sections??0,state.language)} ${t(state.language,'sections','secciones')}`;
    cell.append(label,value,count);host.append(cell);
  }
  select('#four-thresholds').textContent=`${t(state.language,'Income threshold','Umbral de renta')}: ${money(s.income_threshold,state.language)} · ${t(state.language,'Access threshold','Umbral de acceso')}: ${number(s.score_threshold,state.language,2)}`;
}

export function renderCharts(data:AnalysisData,state:State){renderScatter(data,state);renderDeciles(data,state);renderBoxes(data,state);renderCDF(data,state);renderFour(data,state)}
