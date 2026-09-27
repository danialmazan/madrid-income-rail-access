import * as d3 from 'd3';
import type {AnalysisData,State} from './types';
import {metricLabels,money,number,t} from './types';
import {quadrantColors} from './palette';
interface Feature{type:'Feature';properties:Record<string,unknown>;geometry:{type:string;coordinates:unknown}}
interface Collection{type:'FeatureCollection';features:Feature[]}
interface Chunk{file:string;bbox:[number,number,number,number];count:number}
interface ChunkIndex{version:number;component_count:number;tiles:Chunk[]}
const incomeColors=['#E9E4DC','#D6BAAC','#BD8F81','#9C625D','#783941','#4C242B'];
const scoreColors=['#EFE8DC','#D1BCAE','#B78C7E','#8B605B','#5B3839','#321F24'];
const grey='#555B5A';
const $=(id:string)=>document.getElementById(id)!;
export class FileRailMap{
  private sections:Collection|null=null;
  private surface:Collection|null=null;
  private index:ChunkIndex|null=null;
  private cache=new Map<string,Collection>();
  private state:State;
  private revision=0;
  private incomeBreaks:number[]=[];
  private svg?:d3.Selection<SVGSVGElement,unknown,null,undefined>;
  private group?:d3.Selection<SVGGElement,unknown,null,undefined>;
  private projection?:d3.GeoProjection;
  private transform=d3.zoomIdentity;
  private zoom?:d3.ZoomBehavior<SVGSVGElement,unknown>;
  private detail?:HTMLElement;
  constructor(private data:AnalysisData,state:State){this.state={...state};void this.load()}
  private async load(){
    try{
      const read=async(name:string)=>{
        const r=await fetch(new URL(`data/${name}`,document.baseURI));
        if(!r.ok)throw new Error(`${name}: ${r.status}`);
        return await r.json();
      };
      const [sections,surface,index]=await Promise.all([read('sections.geojson'),read('surface.geojson'),read('component_chunks/index.json')]);
      this.sections=sections as Collection;this.surface=surface as Collection;this.index=index as ChunkIndex;
      this.update(this.state);
    }catch(error){console.error('Local map:',error);$('map').textContent=t(this.state.language,'Map data could not be loaded.','No se pudieron cargar los datos del mapa.')}
  }
  private activeSummary(){return this.data.summaries.find(x=>x.geography===this.state.geography&&x.income_metric===this.state.incomeMetric&&x.method===this.state.method)!}
  private sectionColor(p:Record<string,unknown>){
    const raw=p[this.state.incomeMetric];if(raw==null)return grey;
    return incomeColors[d3.bisectRight(this.incomeBreaks,Number(raw))];
  }
  private componentColor(p:Record<string,unknown>){
    const score=Number(p[this.state.method==='entrance'?'entrance_score':'platform_score']);
    if(this.state.mapLayer==='score')return scoreColors[d3.bisectRight([.01,.1,.5,1.5,3],score)];
    const income=p[this.state.incomeMetric];if(income==null)return grey;
    const summary=this.activeSummary();
    return quadrantColors[`${Number(income)<=summary.income_threshold?'lower':'higher'}_income_${score<=summary.score_threshold?'lower':'higher'}_access`];
  }
  private surfaceColor(p:Record<string,unknown>){
    if(this.state.mapLayer==='bivariate'){
      const short=this.state.incomeMetric==='income_median_equivalised'?'median':this.state.incomeMetric==='income_mean_equivalised'?'mean_equiv':'mean_person';
      const code=p[`four_${short}_${this.state.method}`];
      return [quadrantColors.lower_income_lower_access,quadrantColors.lower_income_higher_access,
        quadrantColors.higher_income_lower_access,quadrantColors.higher_income_higher_access][Number(code)]??grey;
    }
    const score=Number(p[this.state.method==='entrance'?'entrance_score':'platform_score']);
    return scoreColors[d3.bisectRight([.01,.1,.5,1.5,3],score)];
  }
  update(state:State){
    this.state={...state};if(!this.sections||!this.surface||!this.index)return;
    this.revision++;
    const host=$('map');host.replaceChildren();
    const old=$('file-map-detail');if(old)old.remove();
    this.detail=document.createElement('div');this.detail.id='file-map-detail';this.detail.className='file-map-detail';host.after(this.detail);
    const width=Math.max(480,host.clientWidth),height=Math.max(380,host.clientHeight);
    const boundary=this.sections.features.filter(f=>this.state.geography==='region'||f.properties.CUMUN==='28079');
    const values=this.data.sections.filter(s=>(this.state.geography==='region'||s.CUMUN==='28079')&&s[this.state.incomeMetric]!=null).map(s=>s[this.state.incomeMetric]!).sort((a,b)=>a-b);
    this.incomeBreaks=[.16,.33,.5,.67,.84].map(q=>values[Math.min(values.length-1,Math.floor(q*values.length))]);
    const fc={type:'FeatureCollection',features:boundary} as unknown as d3.ExtendedFeatureCollection;
    this.projection=d3.geoMercator().fitExtent([[18,18],[width-18,height-18]],fc);
    this.svg=d3.select(host).append('svg').attr('class','file-map-svg').attr('viewBox',`0 0 ${width} ${height}`);
    this.group=this.svg.append('g');
    this.zoom=d3.zoom<SVGSVGElement,unknown>().scaleExtent([1,24]).on('zoom',event=>{
      this.transform=event.transform;this.group!.attr('transform',this.transform.toString());
    }).on('end',()=>{if(this.state.mapLayer!=='income')void this.drawComponents()});
    this.svg.call(this.zoom);
    if(this.state.mapLayer==='income'){
      this.transform=d3.zoomIdentity;this.drawFeatures(boundary,p=>this.sectionColor(p));
    }else{
      const point=this.projection([-3.704,40.417])!;
      const zoom=this.state.geography==='city'?10.5:24;
      this.transform=d3.zoomIdentity.translate(width/2,height/2).scale(zoom).translate(-point[0],-point[1]);
      this.svg.call(this.zoom.transform,this.transform);
    }
    this.renderLegend();
    $('map-heading').textContent=this.state.mapLayer==='income'?metricLabels[state.incomeMetric][state.language]:this.state.mapLayer==='score'?t(state.language,'Building Rail Access Score','Puntuación ferroviaria de los edificios'):t(state.language,'Income × building rail access','Renta × acceso ferroviario de los edificios');
  }
  private drawFeatures(features:Feature[],color:(p:Record<string,unknown>)=>string){
    if(!this.group||!this.projection)return;
    const path=d3.geoPath(this.projection);
    this.group.selectAll('path').data(features).join('path')
      .attr('d',f=>path(f as unknown as d3.GeoPermissibleObjects)).attr('fill',f=>color(f.properties))
      .attr('stroke',this.state.mapLayer==='income'?'#F7F1E6':'none').attr('stroke-width',.25).attr('tabindex',0).attr('role','button')
      .on('click',(_,f)=>this.inspect(f)).on('keydown',(event,f)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.inspect(f)}});
  }
  private visibleBbox():[number,number,number,number]{
    const svg=this.svg!.node()!,box=svg.viewBox.baseVal;
    const topLeft=this.projection!.invert!(this.transform.invert([0,0]))!;
    const bottomRight=this.projection!.invert!(this.transform.invert([box.width,box.height]))!;
    return [Math.min(topLeft[0],bottomRight[0]),Math.min(topLeft[1],bottomRight[1]),Math.max(topLeft[0],bottomRight[0]),Math.max(topLeft[1],bottomRight[1])];
  }
  private async readChunk(file:string):Promise<Collection>{
    const cached=this.cache.get(file);if(cached)return cached;
    const url=new URL(`data/component_chunks/${file}`,document.baseURI);
    let response:Response;
    try{response=await fetch(url)}catch(error){throw new Error(`${url.href}: ${String(error)}`)}
    if(!response.ok)throw new Error(`Building chunk ${file}: ${response.status}`);
    const compressed=await response.arrayBuffer();
    const raw=new Uint8Array(compressed);
    const decoded=raw[0]===0x1f&&raw[1]===0x8b
      ? await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).json() as Collection
      : JSON.parse(new TextDecoder().decode(raw)) as Collection;
    this.cache.set(file,decoded);return decoded;
  }
  private async drawComponents(){
    if(!this.index||!this.projection||!this.group||!this.detail)return;
    const revision=++this.revision;
    const bbox=this.visibleBbox();
    const selected=this.index.tiles.filter(tile=>tile.bbox[0]<=bbox[2]&&tile.bbox[2]>=bbox[0]&&tile.bbox[1]<=bbox[3]&&tile.bbox[3]>=bbox[1]);
    if(selected.length>40){
      this.drawFeatures(this.surface!.features.filter(f=>f.properties.geography===this.state.geography),p=>this.surfaceColor(p));
      this.detail.textContent=t(this.state.language,'Building-derived 2 km overview. Zoom in to see individual buildings.','Vista general de 2 km derivada de edificios. Acerca el mapa para ver edificios individuales.');
      return;
    }
    this.detail.textContent=t(this.state.language,'Loading building shapes…','Cargando edificios…');
    try{
      const collections=await Promise.all(selected.map(tile=>this.readChunk(tile.file)));
      if(revision!==this.revision)return;
      const features=collections.flatMap(x=>x.features).filter(f=>this.state.geography==='region'||String(f.properties.CUSEC).startsWith('28079'));
      this.drawFeatures(features,p=>this.componentColor(p));
      this.detail.textContent=t(this.state.language,`${number(features.length,this.state.language)} residential components shown.`,`${number(features.length,this.state.language)} componentes residenciales mostrados.`);
    }catch(error){console.error('Building geometry:',error);this.detail.textContent=t(this.state.language,'Building shapes could not be loaded.','No se pudieron cargar los edificios.')}
  }
  private renderLegend(){
    const host=$('map-legend');host.replaceChildren();const s=this.state;
    const add=(color:string,label:string)=>{const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.setProperty('--swatch',color);item.append(swatch,document.createTextNode(label));host.append(item)};
    if(s.mapLayer==='score'){
      scoreColors.forEach((c,i)=>add(c,['< 0.01','0.01–0.1','0.1–0.5','0.5–1.5','1.5–3','≥ 3'][i]));
      const note=document.createElement('span');note.textContent=t(s.language,'Building shapes at close zoom; 2 km surface in overview','Edificios de cerca; superficie de 2 km en la vista general');host.append(note);
    }else if(s.mapLayer==='income'){
      incomeColors.forEach((c,i)=>add(c,String(i+1)));add(grey,t(s.language,'No data','Sin datos'));
    }else{
      add(quadrantColors.lower_income_lower_access,t(s.language,'Lower income · lower access','Menor renta · menor acceso'));
      add(quadrantColors.lower_income_higher_access,t(s.language,'Lower income · higher access','Menor renta · mayor acceso'));
      add(quadrantColors.higher_income_lower_access,t(s.language,'Higher income · lower access','Mayor renta · menor acceso'));
      add(quadrantColors.higher_income_higher_access,t(s.language,'Higher income · higher access','Mayor renta · mayor acceso'));
      add(grey,t(s.language,'No income data','Sin datos de renta'));
      const note=document.createElement('span');note.textContent=t(s.language,'Building shapes nearby; building-derived 2 km overview farther out','Edificios de cerca; vista general de 2 km derivada de edificios');host.append(note);
    }
  }
  private inspect(feature:Feature){
    if(!this.detail)return;const p=feature.properties,s=this.state;
    if(s.mapLayer==='income')this.detail.textContent=`${String(p.NMUN??'')} · ${String(p.CUSEC??'')} · ${metricLabels[s.incomeMetric][s.language]}: ${p[s.incomeMetric]==null?t(s.language,'No data','Sin datos'):money(Number(p[s.incomeMetric]),s.language)}`;
    else if(p.component_key)this.detail.textContent=`${t(s.language,'Building','Edificio')} ${String(p.component_key)} · ${t(s.language,'Section','Sección')} ${String(p.CUSEC)} · ${metricLabels[s.incomeMetric][s.language]}: ${p[s.incomeMetric]==null?t(s.language,'No data','Sin datos'):money(Number(p[s.incomeMetric]),s.language)} · ${t(s.language,'Rail Access Score','Puntuación ferroviaria')}: ${number(Number(p[s.method==='entrance'?'entrance_score':'platform_score']),s.language,2)}`;
    else this.detail.textContent=`${t(s.language,'2 km surface score','Puntuación en superficie de 2 km')}: ${number(Number(p[s.method==='entrance'?'entrance_score':'platform_score']),s.language,2)}`;
  }
  reset(){this.update(this.state)}
  resize(){this.update(this.state)}
}
