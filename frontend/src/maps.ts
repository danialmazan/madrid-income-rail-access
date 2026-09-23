import * as maplibregl from 'maplibre-gl';
import {Protocol} from 'pmtiles';
import type {AnalysisData,State} from './types';
import {metricLabels,money,number,t} from './types';

maplibregl.setWorkerUrl(new URL('assets/maplibre-gl-worker.mjs',location.href).href);
const protocol=new Protocol({metadata:true});
maplibregl.addProtocol('pmtiles',protocol.tilev4 as unknown as Parameters<typeof maplibregl.addProtocol>[1]);
const asset=(path:string)=>new URL(path,document.baseURI).href;
const tiles=(name:string)=>`pmtiles://${asset(`tiles/${name}`)}`;
const scoreColors=['#EFE8DC','#D1BCAE','#B78C7E','#8B605B','#5B3839','#321F24'];
const incomeColors=['#E9E4DC','#D6BAAC','#BD8F81','#9C625D','#783941','#4C242B'];
const bothColors=['#DEE1DE','#9DBFC0','#4D8B91','#E0BEA4','#BD8478','#A82D31','#B1A19B','#886F75','#4D3A45'];
const grey='#A9A49D';
const numeric=(name:string)=>['to-number',['coalesce',['get',name],-999999],-999999] as maplibregl.ExpressionSpecification;
function bins(property:string,limits:number[],colors:string[]):maplibregl.ExpressionSpecification{
  return ['case',['==',numeric(property),-999999],grey,['step',numeric(property),colors[0],...limits.flatMap((v,i)=>[v,colors[i+1]])]] as maplibregl.ExpressionSpecification;
}
function bivariate(metric:string,method:State['method'],income:number,access:number):maplibregl.ExpressionSpecification{
  const inc=numeric(metric),sc=numeric(method==='entrance'?'rail_score_entrance':'rail_score_platform');
  const low=['<=',inc,income],high=['>',inc,income],slow=['<=',sc,access],shigh=['>',sc,access];
  return ['case',['==',inc,-999999],grey,['all',low,slow],bothColors[0],['all',low,shigh],bothColors[2],['all',high,slow],bothColors[6],bothColors[8]] as unknown as maplibregl.ExpressionSpecification;
}
const paper:maplibregl.StyleSpecification={version:8,sources:{
  sections:{type:'geojson',data:asset('data/sections.geojson')},
  components:{type:'vector',url:tiles('components.pmtiles')},
  surface:{type:'vector',url:tiles('surface.pmtiles')},
  stations:{type:'vector',url:tiles('stations.pmtiles')}
},layers:[
  {id:'paper',type:'background',paint:{'background-color':'#EEE8DD'}},
  {id:'sections',type:'fill',source:'sections',paint:{'fill-color':grey,'fill-opacity':.84,'fill-outline-color':'#F7F1E6'}},
  {id:'surface',type:'fill',source:'surface','source-layer':'surface',minzoom:5,maxzoom:12,layout:{visibility:'none'},paint:{'fill-color':scoreColors[1],'fill-opacity':.85}},
  {id:'components',type:'fill',source:'components','source-layer':'components',minzoom:12,layout:{visibility:'none'},paint:{'fill-color':scoreColors[1],'fill-opacity':.9,'fill-outline-color':'#F7F1E655'}},
  {id:'stations',type:'circle',source:'stations','source-layer':'origins',minzoom:9,filter:['==',['get','point_method'],'entrance'],paint:{'circle-radius':['interpolate',['linear'],['zoom'],9,1,14,3],'circle-color':'#262321','circle-opacity':.62}}
]};

export class RailMap{
  map:maplibregl.Map;
  private ready=false;
  private state:State;
  private popup?:maplibregl.Popup;
  constructor(private data:AnalysisData,state:State){
    this.state={...state};
    this.map=new maplibregl.Map({container:'map',style:paper,center:[-3.68,40.50],zoom:9.1,attributionControl:false});
    this.map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    this.map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
    this.map.on('error',e=>console.error('Rail map:',e.error));
    this.map.on('load',()=>{this.ready=true;this.update(this.state);});
    this.map.on('click',e=>this.inspect(e));
    this.map.on('mousemove',e=>{this.map.getCanvas().style.cursor=this.map.queryRenderedFeatures(e.point,{layers:this.state.mapLayer==='score'?[this.map.getZoom()>=12?'components':'surface']:['sections']}).length?'pointer':'';});
  }
  update(state:State){
    this.state={...state};if(!this.ready)return;
    const s=this.data.summaries.find(x=>x.geography===state.geography&&x.income_metric===state.incomeMetric&&x.method===state.method)!;
    const values=this.data.sections.filter(x=>(state.geography==='region'||x.CUMUN==='28079')&&x[state.incomeMetric]!==null).map(x=>x[state.incomeMetric]!);
    values.sort((a,b)=>a-b);
    const q=(p:number)=>values[Math.min(values.length-1,Math.floor(p*values.length))];
    const incomeLimits=[.16,.33,.5,.67,.84].map(q);
    const accessLimits=[.01,.1,.5,1.5,3];
    const scoreProperty=state.method==='entrance'?'rail_score_entrance':'rail_score_platform';
    const sectionPaint=state.mapLayer==='bivariate'?bivariate(state.incomeMetric,state.method,s.income_threshold,s.score_threshold):bins(state.incomeMetric,incomeLimits,incomeColors);
    this.map.setPaintProperty('sections','fill-color',sectionPaint);
    this.map.setLayoutProperty('sections','visibility',state.mapLayer==='score'?'none':'visible');
    for(const id of ['surface','components'])this.map.setLayoutProperty(id,'visibility',state.mapLayer==='score'?'visible':'none');
    const scorePaint=bins(state.method==='entrance'?'entrance_score':'platform_score',accessLimits,scoreColors);
    this.map.setPaintProperty('surface','fill-color',scorePaint);this.map.setPaintProperty('components','fill-color',scorePaint);
    const cityFilter=['==',['get','CUMUN'],'28079'] as maplibregl.FilterSpecification;
    this.map.setFilter('sections',state.geography==='city'?cityFilter:null);
    this.map.setFilter('components',state.geography==='city'?['==',['slice',['get','CUSEC'],0,5],'28079'] as maplibregl.FilterSpecification:null);
    this.map.setFilter('surface',['==',['get','geography'],state.geography]);
    this.renderLegend(s.income_threshold,s.score_threshold);
    document.querySelector<HTMLElement>('#map-heading')!.textContent=state.mapLayer==='income'?metricLabels[state.incomeMetric][state.language]:state.mapLayer==='score'?t(state.language,'Building Rail Access Score','Puntuación ferroviaria del edificio'):t(state.language,'Income × rail access','Renta × acceso ferroviario');
  }
  private renderLegend(income:number,access:number){
    const host=document.querySelector<HTMLElement>('#map-legend')!,s=this.state;
    host.replaceChildren();
    const add=(color:string,label:string)=>{const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.setProperty('--swatch',color);item.append(swatch,document.createTextNode(label));host.append(item);};
    if(s.mapLayer==='score'){
      const scoreLabels=['< 0.01','0.01–0.1','0.1–0.5','0.5–1.5','1.5–3','≥ 3'];
      scoreColors.forEach((c,i)=>add(c,scoreLabels[i]));
      const note=document.createElement('span');note.textContent=t(s.language,'Surface below zoom 12 · components above','Superficie hasta zoom 12 · componentes después');host.append(note);
    }else if(s.mapLayer==='income'){
      incomeColors.forEach((c,i)=>add(c,`${i+1}`));add(grey,t(s.language,'No data','Sin datos'));
      const note=document.createElement('span');note.textContent=t(s.language,'Six equal-count section colour bands','Seis franjas de color con igual número de secciones');host.append(note);
    }else{
      add(bothColors[0],t(s.language,'Lower income · lower access','Menor renta · menor acceso'));
      add(bothColors[2],t(s.language,'Lower income · higher access','Menor renta · mayor acceso'));
      add(bothColors[6],t(s.language,'Higher income · lower access','Mayor renta · menor acceso'));
      add(bothColors[8],t(s.language,'Higher income · higher access','Mayor renta · mayor acceso'));
      add(grey,t(s.language,'No income data','Sin datos de renta'));
      const note=document.createElement('span');note.textContent=`${money(income,s.language)} · ${number(access,s.language,2)}`;host.append(note);
    }
  }
  private inspect(event:maplibregl.MapMouseEvent){
    const layer=this.state.mapLayer==='score'?(this.map.getZoom()>=12?'components':'surface'):'sections';
    const feature=this.map.queryRenderedFeatures(event.point,{layers:[layer]})[0];if(!feature)return;
    const p=feature.properties??{},s=this.state;
    const scoreKey=layer==='sections'?(s.method==='entrance'?'rail_score_entrance':'rail_score_platform'):(s.method==='entrance'?'entrance_score':'platform_score');
    const income=p[s.incomeMetric];
    const lines=layer==='sections'?[`${p.NMUN??''} · ${p.CUSEC??''}`,`${metricLabels[s.incomeMetric][s.language]}: ${income==null?t(s.language,'No data','Sin datos'):money(Number(income),s.language)}`,`${t(s.language,'Rail Access Score','Puntuación de acceso')}: ${number(Number(p[scoreKey]),s.language,2)}`]:[`${layer==='components'?t(s.language,'Residential component','Componente residencial'):t(s.language,'Population-weighted 2 km surface','Superficie de 2 km ponderada por población')}`,`${t(s.language,'Rail Access Score','Puntuación de acceso')}: ${number(Number(p[scoreKey]),s.language,2)}`];
    this.popup?.remove();const box=document.createElement('div');for(const [i,line] of lines.entries()){const el=document.createElement(i===0?'strong':'div');el.textContent=line;box.append(el)}
    this.popup=new maplibregl.Popup({closeButton:true,maxWidth:'340px'}).setLngLat(event.lngLat).setDOMContent(box).addTo(this.map);
  }
  reset(){this.map.easeTo({center:this.state.geography==='city'?[-3.704,40.417]:[-3.68,40.50],zoom:this.state.geography==='city'?11.1:9.1,duration:matchMedia('(prefers-reduced-motion:reduce)').matches?0:500});}
}
