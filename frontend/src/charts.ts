import * as d3 from 'd3';
import type {AnalysisData,DistributionRow,GroupRow,Section,State,Summary} from './types';
import {incomeQuintileColors,quadrantColors} from './palette';
import {metricLabels,money,number,t} from './types';

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
  const {g,innerW,innerH}=canvas('#scatter-chart',450,95,70);
  const x=d3.scaleLinear().domain(d3.extent(r,d=>d[state.incomeMetric]!) as [number,number]).nice().range([0,innerW]);
  const y=d3.scaleLinear().domain([0,d3.max(r,d=>score(d,state))??1]).nice().range([innerH,0]);
  axes(g,x,y,innerW,innerH,v=>number(v/1000,state.language,0)+'k',v=>number(v,state.language,1));
  g.append('text').attr('class','axis-title').attr('x',innerW/2).attr('y',innerH+55).attr('text-anchor','middle').text(`${metricLabels[state.incomeMetric][state.language]} (€)`);
  g.append('text').attr('class','axis-title').attr('transform',`translate(${-70},${innerH/2}) rotate(-90)`).attr('text-anchor','middle').text(t(state.language,'Rail Access Score','Puntuación ferroviaria'));
  const smooth=data.smoothers.filter(d=>d.geography===state.geography&&d.income_metric===state.incomeMetric&&d.method===state.method&&Number.isFinite(d.score));
  g.append('path').datum(smooth).attr('class','smooth').attr('d',d3.line<typeof smooth[number]>().x(d=>x(d.income)).y(d=>y(d.score)));
  const dots=g.selectAll<SVGCircleElement,Section>('circle.dot').data(r,d=>d.CUSEC).join('circle').attr('class','dot').attr('cx',d=>x(d[state.incomeMetric]!)).attr('cy',d=>y(score(d,state))).attr('r',3.1);
  const describe=(d:Section)=>`${d.CUSEC} · ${d.NMUN} · ${t(state.language,'District','Distrito')} ${d.district}\n${metricLabels[state.incomeMetric][state.language]}: ${money(d[state.incomeMetric]!,state.language)}\n${t(state.language,'Rail Access Score','Puntuación de acceso')}: ${number(score(d,state),state.language,2)}\n${t(state.language,'Residents','Residentes')}: ${number(d.section_population,state.language)}`;
  dots.on('pointermove',(event,d)=>show(event,describe(d))).on('pointerleave',hide).on('click',(_,d)=>{detail.textContent=describe(d).replaceAll('\n',' · ')});
  let keyboardIndex=0;
  select('#scatter-chart').onkeydown=(event:Event)=>{const e=event as KeyboardEvent;if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();keyboardIndex=Math.max(0,Math.min(r.length-1,keyboardIndex+(e.key==='ArrowRight'?1:-1)));const d=r[keyboardIndex];dots.classed('active',x=>x.CUSEC===d.CUSEC);detail.textContent=describe(d).replaceAll('\n',' · ')};
  detail.textContent='';
  select('#scatter-rho').textContent=`ρ = ${number(current.spearman_rho,state.language,2)} · ${t(state.language,'section Spearman','Spearman por sección')}`;
  select('#scatter-heading').textContent=`${metricLabels[state.incomeMetric][state.language]} × ${t(state.language,'Rail Access Score','puntuación de acceso')}`;
}

function groupData(data:AnalysisData,state:State,groups:5|10){return (groups===5?data.quintiles:data.deciles).filter(d=>d.geography===state.geography&&d.income_metric===state.incomeMetric&&d.method===state.method).sort((a,b)=>a.group-b.group)}
export function renderBoxes(data:AnalysisData,state:State){
  const r=groupData(data,state,10),{g,innerW,innerH}=canvas('#decile-chart',390,60,50);
  const x=d3.scaleBand<number>().domain(r.map(d=>d.group)).range([0,innerW]).padding(.33);
  const y=d3.scaleLinear().domain([0,d3.max(r,d=>Math.max(d.p90,d.mean_score))??1]).nice().range([innerH,0]);
  g.append('g').attr('class','grid').call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(()=>'')).select('.domain').remove();
  g.append('g').attr('class','axis').call(d3.axisLeft(y).ticks(5).tickFormat(v=>number(Number(v),state.language,1)));
  g.append('g').attr('class','axis').attr('transform',`translate(0,${innerH})`).call(d3.axisBottom(x));
  g.selectAll<SVGLineElement,GroupRow>('line.whisker').data(r).join('line').attr('class','whisker').attr('x1',d=>x(d.group)!+x.bandwidth()/2).attr('x2',d=>x(d.group)!+x.bandwidth()/2).attr('y1',d=>y(d.p10)).attr('y2',d=>y(d.p90));
  const describe=(d:GroupRow)=>`${t(state.language,'Income decile','Decil de renta')} ${d.group} · ${t(state.language,'Mean','Media')} ${number(d.mean_score,state.language,2)} · ${t(state.language,'Median','Mediana')} ${number(d.median_score,state.language,2)} · P25–P75 ${number(d.p25,state.language,2)}–${number(d.p75,state.language,2)} · P10–P90 ${number(d.p10,state.language,2)}–${number(d.p90,state.language,2)} · ${number(d.population_share*100,state.language,1)}% ${t(state.language,'of residents','de residentes')}`;
  g.selectAll<SVGRectElement,GroupRow>('rect.box').data(r).join('rect').attr('class','box').attr('x',d=>x(d.group)!).attr('y',d=>y(d.p75)).attr('width',x.bandwidth()).attr('height',d=>y(d.p25)-y(d.p75)).attr('tabindex',0).attr('role','button').attr('aria-label',describe).on('pointermove',(event,d)=>show(event,describe(d))).on('pointerleave',hide).on('click',(_,d)=>{select('#decile-detail').textContent=describe(d)}).on('keydown',(event,d)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select('#decile-detail').textContent=describe(d)}});
  g.selectAll<SVGLineElement,GroupRow>('line.median').data(r).join('line').attr('class','median').attr('x1',d=>x(d.group)!).attr('x2',d=>x(d.group)!+x.bandwidth()).attr('y1',d=>y(d.median_score)).attr('y2',d=>y(d.median_score));
  g.selectAll<SVGCircleElement,GroupRow>('circle.mean-mark').data(r).join('circle').attr('class','mean-mark').attr('cx',d=>x(d.group)!+x.bandwidth()/2).attr('cy',d=>y(d.mean_score)).attr('r',4.3);
}

function incomeLegend(id:string,state:State){
  const legend=select(id);legend.innerHTML='';
  for(let group=1;group<=5;group++){
    const item=document.createElement('span'),mark=document.createElement('i');mark.style.setProperty('--line-color',incomeQuintileColors[group-1]);
    item.append(mark,document.createTextNode(`${t(state.language,'Income quintile','Quintil de renta')} ${group}`));legend.append(item);
  }
}
export function renderDistribution(data:AnalysisData,state:State){
  const r=data.distributions.filter(d=>d.geography===state.geography&&d.income_metric===state.incomeMetric&&d.method===state.method);
  const {g,innerW,innerH}=canvas('#cdf-chart',395,65,55);
  const transform=(v:number)=>Math.asinh(v/.05),inverse=(v:number)=>Math.sinh(v)*.05;
  const x=d3.scaleLinear().domain([0,transform(d3.max(r,d=>d.score_upper)??1)]).range([0,innerW]);
  const ymax=d3.max(r,d=>d.share)??1;
  const y=d3.scaleLinear().domain([0,ymax*1.06]).nice().range([innerH,0]);
  axes(g,x,y,innerW,innerH,v=>number(inverse(v),state.language,1),v=>number(v*100,state.language,0)+'%');
  for(let group=1;group<=5;group++){
    const values=r.filter(d=>d.group===group).sort((a,b)=>a.bin-b.bin);
    g.append('path').datum(values).attr('fill','none').attr('stroke',incomeQuintileColors[group-1]).attr('stroke-width',2.8)
      .attr('d',d3.line<DistributionRow>().curve(d3.curveMonotoneX).x(d=>x((transform(d.score_lower)+transform(d.score_upper))/2)).y(d=>y(d.share)));
  }
  incomeLegend('#cdf-legend',state);
  const describe=(value:number)=>{
    const bin=r.find(d=>d.group===1&&value>=d.score_lower&&value<=d.score_upper)??r.filter(d=>d.group===1).at(-1);
    if(!bin)return '';
    return `${t(state.language,'Building score','Puntuación del edificio')} ${number(bin.score_lower,state.language,2)}–${number(bin.score_upper,state.language,2)} · `+
      Array.from({length:5},(_,i)=>`Q${i+1}: ${number((r.find(d=>d.group===i+1&&d.bin===bin.bin)?.share??0)*100,state.language,1)}%`).join(' · ');
  };
  const focus=g.append('line').attr('y1',0).attr('y2',innerH).attr('stroke','#262321').attr('stroke-dasharray','3 3').style('display','none');
  const inspect=(v:number)=>{focus.attr('x1',x(v)).attr('x2',x(v)).style('display',null);select('#cdf-detail').textContent=describe(inverse(v))};
  g.append('rect').attr('width',innerW).attr('height',innerH).attr('fill','transparent').on('pointermove',event=>{const v=x.invert(d3.pointer(event)[0]);inspect(v);show(event,describe(inverse(v)))}).on('pointerleave',()=>{focus.style('display','none');hide()});
  let value=0;select('#cdf-chart').onkeydown=(event:Event)=>{const e=event as KeyboardEvent;if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();value=Math.max(0,Math.min(x.domain()[1],value+(e.key==='ArrowRight'?1:-1)*x.domain()[1]/24));inspect(value)};
}
export function renderReverse(data:AnalysisData,state:State){
  const r=data.reverse_groups.filter(d=>d.geography===state.geography&&d.income_metric===state.incomeMetric&&d.method===state.method);
  const {g,innerW,innerH}=canvas('#reverse-chart',370,58,48);
  const x=d3.scaleBand<number>().domain(d3.range(1,11)).range([0,innerW]).padding(.12);
  const y=d3.scaleLinear().domain([0,1]).range([innerH,0]);
  g.append('g').attr('class','grid').call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(()=>'')).select('.domain').remove();
  g.append('g').attr('class','axis').call(d3.axisLeft(y).ticks(4).tickFormat(v=>`${Number(v)*100}%`));
  g.append('g').attr('class','axis').attr('transform',`translate(0,${innerH})`).call(d3.axisBottom(x));
  const describe=(decile:number)=>{
    const v=r.filter(d=>d.score_decile===decile).sort((a,b)=>a.income_quintile-b.income_quintile);
    return `${t(state.language,'Building-score decile','Decil de puntuación del edificio')} ${decile} · ${number(v[0]?.score_min??0,state.language,2)}–${number(v[0]?.score_max??0,state.language,2)} · ${v.map(d=>`Q${d.income_quintile} ${number(d.share*100,state.language,1)}%`).join(' · ')}`;
  };
  for(let decile=1;decile<=10;decile++){
    let acc=0;for(const d of r.filter(x=>x.score_decile===decile).sort((a,b)=>a.income_quintile-b.income_quintile)){
      const height=d.share;g.append('rect').attr('x',x(decile)!).attr('y',y(acc+height)).attr('width',x.bandwidth()).attr('height',Math.max(0,y(acc)-y(acc+height)))
        .attr('fill',incomeQuintileColors[d.income_quintile-1]).attr('tabindex',0).attr('role','button').attr('aria-label',describe(decile))
        .on('pointermove',event=>show(event,describe(decile))).on('pointerleave',hide).on('click',()=>select('#reverse-detail').textContent=describe(decile))
        .on('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select('#reverse-detail').textContent=describe(decile)}});
      acc+=height;
    }
  }
  incomeLegend('#reverse-legend',state);
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
    const row=s.quadrants.find(x=>x.quadrant===key),cell=document.createElement('article');cell.className='four-cell';cell.dataset.quadrant=key;cell.style.setProperty('--quadrant-color',quadrantColors[key]);
    const label=document.createElement('span');label.className='quadrant-label';label.textContent=labels[key][state.language==='es'?1:0];
    const value=document.createElement('strong');value.textContent=number((row?.population_share??0)*100,state.language,1)+'%';
    const count=document.createElement('small');count.textContent=`${number(row?.population??0,state.language)} ${t(state.language,'residents','residentes')} · ${number(row?.components??0,state.language)} ${t(state.language,'buildings','edificios')}`;
    cell.append(label,value,count);host.append(cell);
  }
  select('#four-thresholds').textContent=`${t(state.language,'Income threshold','Umbral de renta')}: ${money(s.income_threshold,state.language)} · ${t(state.language,'Rail score threshold','Umbral de puntuación ferroviaria')}: ${number(s.score_threshold,state.language,2)}`;
}

export function renderCharts(data:AnalysisData,state:State){renderScatter(data,state);renderBoxes(data,state);renderReverse(data,state);renderDistribution(data,state);renderFour(data,state)}
