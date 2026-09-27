import * as maplibregl from 'maplibre-gl';
import {Protocol} from 'pmtiles';
import type {AnalysisData,State} from './types';
import {metricLabels,money,number,t} from './types';
import {quadrantColors} from './palette';

maplibregl.setWorkerUrl(new URL('assets/maplibre-gl-worker.mjs',location.href).href);
const protocol=new Protocol({metadata:true});
maplibregl.addProtocol('pmtiles',protocol.tilev4 as unknown as Parameters<typeof maplibregl.addProtocol>[1]);
const asset=(path:string)=>new URL(path,document.baseURI).href;
const tiles=(name:string)=>`pmtiles://${asset(`tiles/${name}`)}`;
const scoreColors=['#EFE8DC','#D1BCAE','#B78C7E','#8B605B','#5B3839','#321F24'];
const incomeColors=['#E9E4DC','#D6BAAC','#BD8F81','#9C625D','#783941','#4C242B'];

const grey='#555B5A';
const numeric=(name:string)=>['to-number',['coalesce',['get',name],-999999],-999999] as maplibregl.ExpressionSpecification;
function bins(property:string,limits:number[],colors:string[]):maplibregl.ExpressionSpecification{
  return ['case',['==',numeric(property),-999999],grey,['step',numeric(property),colors[0],...limits.flatMap((v,i)=>[v,colors[i+1]])]] as maplibregl.ExpressionSpecification;
}
function bivariate(metric:string,method:State['method'],income:number,access:number,component=false):maplibregl.ExpressionSpecification{
  const inc=numeric(metric),sc=numeric(component?(method==='entrance'?'entrance_score':'platform_score'):(method==='entrance'?'rail_score_entrance':'rail_score_platform'));
  const low=['<=',inc,income],high=['>',inc,income],slow=['<=',sc,access],shigh=['>',sc,access];
  return ['case',['==',inc,-999999],grey,['all',low,slow],quadrantColors.lower_income_lower_access,['all',low,shigh],quadrantColors.lower_income_higher_access,['all',high,slow],quadrantColors.higher_income_lower_access,quadrantColors.higher_income_higher_access] as unknown as maplibregl.ExpressionSpecification;
}
function bivariateSurface(metric:string,method:State['method']):maplibregl.ExpressionSpecification{
  const short=metric==='income_median_equivalised'?'median':metric==='income_mean_equivalised'?'mean_equiv':'mean_person';
  return ['match',numeric(`four_${short}_${method}`),0,quadrantColors.lower_income_lower_access,
    1,quadrantColors.lower_income_higher_access,2,quadrantColors.higher_income_lower_access,
    3,quadrantColors.higher_income_higher_access,grey] as unknown as maplibregl.ExpressionSpecification;
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
  {id:'components',type:'fill',source:'components','source-layer':'components',minzoom:12,layout:{visibility:'none'},paint:{'fill-color':scoreColors[1],'fill-opacity':.96,'fill-outline-color':'#F7F1E655'}},
  {id:'stations',type:'circle',source:'stations','source-layer':'origins',minzoom:9,filter:['==',['get','point_method'],'entrance'],paint:{'circle-radius':['interpolate',['linear'],['zoom'],9,1,14,3],'circle-color':'#262321','circle-opacity':.62}}
]};

export class RailMap{
  map:maplibregl.Map;
  private ready=false;
  private state:State;
  private popup?:maplibregl.Popup;
  constructor(private data:AnalysisData,state:State){
    this.state={...state};
    this.map=new maplibregl.Map({container:'map',style:paper,center:[-3.704,40.417],zoom:11.1,attributionControl:false});
    this.map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    this.map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
    this.map.on('error',e=>console.error('Rail map:',e.error));
    this.map.on('load',()=>{this.ready=true;this.update(this.state);});
    this.map.on('click',e=>this.inspect(e));
    this.map.on('mousemove',e=>{const layer=this.state.mapLayer==='income'?'sections':this.map.getZoom()<12?'surface':'components';this.map.getCanvas().style.cursor=this.map.queryRenderedFeatures(e.point,{layers:[layer]}).length?'pointer':'';});
  }
  update(state:State){
    this.state={...state};if(!this.ready)return;
    const s=this.data.summaries.find(x=>x.geography===state.geography&&x.income_metric===state.incomeMetric&&x.method===state.method)!;
    const values=this.data.sections.filter(x=>(state.geography==='region'||x.CUMUN==='28079')&&x[state.incomeMetric]!==null).map(x=>x[state.incomeMetric]!);
    values.sort((a,b)=>a-b);
    const q=(p:number)=>values[Math.min(values.length-1,Math.floor(p*values.length))];
    const incomeLimits=[.16,.33,.5,.67,.84].map(q);
    const accessLimits=[.01,.1,.5,1.5,3];
    const sectionPaint=bins(state.incomeMetric,incomeLimits,incomeColors);
    this.map.setPaintProperty('sections','fill-color',sectionPaint);
    this.map.setLayoutProperty('sections','visibility',state.mapLayer==='income'?'visible':'none');
    this.map.setLayoutProperty('surface','visibility',state.mapLayer==='income'?'none':'visible');
    this.map.setLayoutProperty('components','visibility',state.mapLayer==='income'?'none':'visible');
    const scorePaint=bins(state.method==='entrance'?'entrance_score':'platform_score',accessLimits,scoreColors);
    this.map.setPaintProperty('surface','fill-color',state.mapLayer==='bivariate'?bivariateSurface(state.incomeMetric,state.method):scorePaint);
    this.map.setPaintProperty('components','fill-color',state.mapLayer==='bivariate'?bivariate(state.incomeMetric,state.method,s.income_threshold,s.score_threshold,true):scorePaint);
    const cityFilter=['==',['get','CUMUN'],'28079'] as maplibregl.FilterSpecification;
    this.map.setFilter('sections',state.geography==='city'?cityFilter:null);
    this.map.setFilter('components',state.geography==='city'?['==',['slice',['get','CUSEC'],0,5],'28079'] as maplibregl.FilterSpecification:null);
    this.map.setFilter('surface',['==',['get','geography'],state.geography]);
    if(state.mapLayer!=='income'&&this.map.getZoom()<12.2)this.reset();
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
      const note=document.createElement('span');note.textContent=t(s.language,'Building polygons from zoom 12 · generalised surface farther out','Polígonos de edificios desde zoom 12 · superficie generalizada más lejos');host.append(note);
    }else if(s.mapLayer==='income'){
      incomeColors.forEach((c,i)=>add(c,`${i+1}`));add(grey,t(s.language,'No data','Sin datos'));
      const note=document.createElement('span');note.textContent=t(s.language,'Six equal-count section colour bands','Seis franjas de color con igual número de secciones');host.append(note);
    }else{
      add(quadrantColors.lower_income_lower_access,t(s.language,'Lower income · lower access','Menor renta · menor acceso'));
      add(quadrantColors.lower_income_higher_access,t(s.language,'Lower income · higher access','Menor renta · mayor acceso'));
      add(quadrantColors.higher_income_lower_access,t(s.language,'Higher income · lower access','Mayor renta · menor acceso'));
      add(quadrantColors.higher_income_higher_access,t(s.language,'Higher income · higher access','Mayor renta · mayor acceso'));
      add(grey,t(s.language,'No income data','Sin datos de renta'));
      const note=document.createElement('span');note.textContent=`${money(income,s.language)} · ${number(access,s.language,2)}`;host.append(note);
      const scale=document.createElement('span');scale.textContent=t(s.language,'Buildings from zoom 12 · building-derived 2 km overview farther out','Edificios desde zoom 12 · vista general de 2 km derivada de edificios');host.append(scale);
    }
  }
  private inspect(event:maplibregl.MapMouseEvent){
    const layer=this.state.mapLayer==='income'?'sections':this.map.getZoom()<12?'surface':'components';
    const feature=this.map.queryRenderedFeatures(event.point,{layers:[layer]})[0];if(!feature)return;
    const p=feature.properties??{},s=this.state;
    const scoreKey=layer==='sections'?(s.method==='entrance'?'rail_score_entrance':'rail_score_platform'):(s.method==='entrance'?'entrance_score':'platform_score');
    const income=p[s.incomeMetric];
    const lines=layer==='sections'?[`${p.NMUN??''} · ${p.CUSEC??''}`,`${metricLabels[s.incomeMetric][s.language]}: ${income==null?t(s.language,'No data','Sin datos'):money(Number(income),s.language)}`,`${t(s.language,'Section Rail Access Score','Puntuación ferroviaria de la sección')}: ${number(Number(p[scoreKey]),s.language,2)}`]:layer==='components'?[`${t(s.language,'Residential component','Componente residencial')} · ${p.component_key??''}`,`${metricLabels[s.incomeMetric][s.language]} (${t(s.language,'section','sección')} ${p.CUSEC??''}): ${income==null?t(s.language,'No data','Sin datos'):money(Number(income),s.language)}`,`${t(s.language,'Building Rail Access Score','Puntuación ferroviaria del edificio')}: ${number(Number(p[scoreKey]),s.language,2)}`]:[t(s.language,'Population-weighted 2 km surface','Superficie de 2 km ponderada por población'),`${t(s.language,'Rail Access Score','Puntuación ferroviaria')}: ${number(Number(p[scoreKey]),s.language,2)}`];
    this.popup?.remove();const box=document.createElement('div');for(const [i,line] of lines.entries()){const el=document.createElement(i===0?'strong':'div');el.textContent=line;box.append(el)}
    this.popup=new maplibregl.Popup({closeButton:true,maxWidth:'340px'}).setLngLat(event.lngLat).setDOMContent(box).addTo(this.map);
  }
  resize(){this.map.resize()}
  reset(){this.map.easeTo({center:this.state.mapLayer==='income'?(this.state.geography==='city'?[-3.704,40.417]:[-3.68,40.50]):[-3.704,40.417],zoom:this.state.mapLayer==='income'?(this.state.geography==='city'?11.1:9.1):14.1,duration:matchMedia('(prefers-reduced-motion:reduce)').matches?0:500});}
}
