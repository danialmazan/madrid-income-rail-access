import * as maplibregl from 'maplibre-gl';
import type {Feature,FeatureCollection,Geometry,Polygon,MultiPolygon,Point,LineString} from 'geojson';
import type {Language,State} from './types';
import {number,t} from './types';
import {calculateScore,renderScoreLedger} from './score-model';
import type {ScoreOrigin,ScoreParameters} from './score-model';
import {AddressLocalMap} from './address-local-map';
import libertyStyle from './openfreemap-liberty.json';

type Building=Feature<Polygon|MultiPolygon,{component_key:string;CUSEC:string;x:number;y:number;pop:number;entrance_score:number;platform_score:number}>;
interface Chunk{file:string;bbox:[number,number,number,number];count:number}
interface ChunkIndex{tiles:Chunk[]}
interface Place{lon:number;lat:number;label:string}
interface PhotonFeature{geometry:{coordinates:[number,number]};properties:Record<string,string|number|undefined>}
const empty=<T extends Geometry,P extends Record<string,unknown>>():FeatureCollection<T,P>=>({type:'FeatureCollection',features:[]});
const id=(name:string)=>document.getElementById(name)!;
const url=(path:string)=>new URL(`data/${path}`,document.baseURI);

export function utm30(lon:number,lat:number){
  const a=6378137,f=1/298.257223563,e2=f*(2-f),e4=e2*e2,e6=e4*e2,ep2=e2/(1-e2),k0=.9996;
  const phi=lat*Math.PI/180,lambda=(lon+3)*Math.PI/180;
  const sin=Math.sin(phi),cos=Math.cos(phi),tan=Math.tan(phi);
  const n=a/Math.sqrt(1-e2*sin*sin),tanSq=tan*tan,c=ep2*cos*cos,A=cos*lambda;
  const m=a*((1-e2/4-3*e4/64-5*e6/256)*phi-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*phi)
    +(15*e4/256+45*e6/1024)*Math.sin(4*phi)-(35*e6/3072)*Math.sin(6*phi));
  return {x:500000+k0*n*(A+(1-tanSq+c)*A**3/6+(5-18*tanSq+tanSq*tanSq+72*c-58*ep2)*A**5/120),
    y:k0*(m+n*tan*(A*A/2+(5-tanSq+9*c+4*c*c)*A**4/24+(61-58*tanSq+tanSq*tanSq+600*c-330*ep2)*A**6/720))};
}
function buildingCenter(feature:Building):[number,number]{
  const ring=feature.geometry.type==='Polygon'?feature.geometry.coordinates[0]:feature.geometry.coordinates[0][0];
  const unique=ring.length>1?ring.slice(0,-1):ring;
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(const [lon,lat] of unique){west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat)}
  return [(west+east)/2,(south+north)/2];
}
function radiusPolygon(lon:number,lat:number,meters:number):Feature<Polygon>{
  const ring:Array<[number,number]>=[];
  for(let i=0;i<=64;i++){const angle=i*2*Math.PI/64;ring.push([lon+meters*Math.cos(angle)/(111320*Math.cos(lat*Math.PI/180)),lat+meters*Math.sin(angle)/111320])}
  return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}};
}
function placeLabel(feature:PhotonFeature){
  const p=feature.properties;
  const street=[p.street??p.name,p.housenumber].filter(Boolean).join(' ');
  return [street,p.postcode,p.city??p.county].filter(Boolean).join(', ');
}
async function readChunk(file:string):Promise<FeatureCollection<Polygon|MultiPolygon,Building['properties']>>{
  const response=await fetch(url(`component_chunks/${file}`));
  if(!response.ok)throw new Error(`Building data ${response.status}`);
  const raw=new Uint8Array(await response.arrayBuffer());
  return raw[0]===0x1f&&raw[1]===0x8b
    ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).json()
    : JSON.parse(new TextDecoder().decode(raw));
}

export class AddressScore{
  private readonly localMode=location.protocol==='file:'||new URL(location.href).searchParams.get('address_map')==='local';
  private state:State;
  private selectedPlace:Place|null=null;
  private suggestions:Place[]=[];
  private selectedBuilding:Building|null=null;
  private buildings:Building[]=[];
  private map:maplibregl.Map|null=null;
  private localMap:AddressLocalMap|null=null;
  private mapReady:Promise<void>|null=null;
  private stationMarkers:maplibregl.Marker[]=[];
  private index:ChunkIndex|null=null;
  private origins:ScoreOrigin[]|null=null;
  private scoreParameters:ScoreParameters|null=null;
  private indexReady:Promise<void>|null=null;
  private originsReady:Promise<void>|null=null;
  private cache=new Map<string,FeatureCollection<Polygon|MultiPolygon,Building['properties']>>();
  private searchCache=new Map<string,Place[]>();
  private searchTimer=0;
  private searchAbort:AbortController|null=null;
  private sequence=0;
  constructor(state:State){
    this.state={...state};
    const input=id('address-query') as HTMLInputElement;
    input.addEventListener('input',()=>{
      this.selectedPlace=null;this.suggestions=[];this.drawSuggestions();
      clearTimeout(this.searchTimer);
      if(input.value.trim().length<4)return;
      this.searchTimer=window.setTimeout(()=>void this.suggest(input.value.trim()),500);
    });
    input.addEventListener('keydown',event=>{
      if(event.key==='Escape'){this.suggestions=[];this.drawSuggestions()}
      if(event.key==='ArrowDown'&&this.suggestions.length){event.preventDefault();(id('address-suggestions').querySelector('button') as HTMLButtonElement)?.focus()}
    });
    id('address-form').addEventListener('submit',event=>{event.preventDefault();void this.find()});
    id('address-clear').addEventListener('click',()=>this.clear());
    this.update(state);
  }
  update(state:State){
    this.state={...state};
    (id('address-query') as HTMLInputElement).placeholder=t(state.language,'Street and number, municipality','Calle y número, municipio');
    if(this.localMode)(document.querySelector('.address-attribution span') as HTMLElement).textContent=t(state.language,
      'Address search: Photon / OpenStreetMap. Local streets: OpenStreetMap contributors via Geofabrik. Distances are straight lines from the modelled residential component, not walking routes.',
      'Búsqueda de direcciones: Photon / OpenStreetMap. Calles locales: colaboradores de OpenStreetMap a través de Geofabrik. Las distancias son líneas rectas desde el componente residencial modelizado, no rutas a pie.');
    this.drawSuggestions();
    if(this.selectedPlace)id('address-selected').textContent=this.selectedPlace.label;
    if(this.selectedBuilding)void this.choose(this.selectedBuilding,false);
  }
  private async search(query:string):Promise<Place[]>{
    const key=query.toLocaleLowerCase();const cached=this.searchCache.get(key);if(cached)return cached;
    this.searchAbort?.abort();this.searchAbort=new AbortController();
    const params=new URLSearchParams({q:query,limit:'6',bbox:'-4.65,39.85,-3.0,41.25',countrycode:'ES',
      lon:'-3.70',lat:'40.42',lang:this.state.language==='es'?'default':'en'});
    const response=await fetch(`https://photon.komoot.io/api?${params}`,{signal:this.searchAbort.signal});
    if(!response.ok)throw new Error(`Photon ${response.status}`);
    const payload=await response.json() as {features:PhotonFeature[]};
    const places=payload.features.filter(x=>x.geometry?.coordinates?.length===2).map(x=>({
      lon:x.geometry.coordinates[0],lat:x.geometry.coordinates[1],label:placeLabel(x)}));
    this.searchCache.set(key,places);return places;
  }
  private async suggest(query:string){
    try{
      const places=await this.search(query);
      if((id('address-query') as HTMLInputElement).value.trim()!==query)return;
      this.suggestions=places;this.drawSuggestions();
    }catch(error){if((error as Error).name!=='AbortError')this.status(t(this.state.language,'Address suggestions are unavailable. You can still try Find my score.','No hay sugerencias disponibles. Puedes probar «Buscar mi puntuación».'))}
  }
  private drawSuggestions(){
    const host=id('address-suggestions'),input=id('address-query');host.replaceChildren();
    host.hidden=this.suggestions.length===0;input.setAttribute('aria-expanded',String(!host.hidden));
    this.suggestions.forEach((place,i)=>{
      const button=document.createElement('button');button.type='button';button.role='option';button.id=`address-option-${i}`;
      button.textContent=place.label;button.addEventListener('click',()=>this.selectSuggestion(place));
      button.addEventListener('keydown',event=>{
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();const next=host.querySelectorAll<HTMLButtonElement>('button')[(i+(event.key==='ArrowDown'?1:-1)+this.suggestions.length)%this.suggestions.length];next?.focus();
        }
        if(event.key==='Escape'){this.suggestions=[];this.drawSuggestions();input.focus()}
      });host.append(button);
    });
  }
  private selectSuggestion(place:Place){
    this.selectedPlace=place;(id('address-query') as HTMLInputElement).value=place.label;
    this.suggestions=[];this.drawSuggestions();id('address-find').focus();
  }
  private status(message:string){id('address-search-status').textContent=message}
  private mapStatus(message:string){id('address-map-status').textContent=message}
  private loadIndex(){
    if(!this.indexReady)this.indexReady=fetch(url('component_chunks/index.json')).then(response=>{
      if(!response.ok)throw new Error(`Building index ${response.status}`);
      return response.json();
    }).then(index=>{this.index=index as ChunkIndex}).catch(error=>{this.indexReady=null;throw error});
    return this.indexReady;
  }
  private loadOrigins(){
    if(!this.originsReady)this.originsReady=fetch(url('score_origins.json.gz')).then(async response=>{
      if(!response.ok)throw new Error(`Score origins ${response.status}`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      return bytes[0]===0x1f&&bytes[1]===0x8b
        ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json()
        : JSON.parse(new TextDecoder().decode(bytes));
    }).then((published:{origins:ScoreOrigin[];meta:{score:ScoreParameters}})=>{
      this.origins=published.origins;this.scoreParameters=published.meta.score;
    }).catch(error=>{this.originsReady=null;throw error});
    return this.originsReady;
  }
  private async ensureMap(place:Place){
    if(this.mapReady)return this.mapReady;
    this.mapReady=new Promise<void>((resolve,reject)=>{
      this.map=new maplibregl.Map({container:'address-map',style:libertyStyle as maplibregl.StyleSpecification,
        center:[place.lon,place.lat],zoom:17.4,attributionControl:false});
      this.map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
      this.map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
      this.map.once('style.load',()=>{
        const map=this.map!;
        map.addSource('search-radius',{type:'geojson',data:empty<Polygon,Record<string,unknown>>()});
        map.addSource('search-buildings',{type:'geojson',data:empty<Polygon|MultiPolygon,Building['properties']>()});
        map.addSource('search-links',{type:'geojson',data:empty<LineString,Record<string,unknown>>()});
        map.addSource('search-stations',{type:'geojson',data:empty<Point,Record<string,unknown>>()});
        map.addLayer({id:'search-radius',type:'line',source:'search-radius',paint:{'line-color':'#8B605B','line-width':1.5,'line-dasharray':[3,3]}});
        map.addLayer({id:'search-buildings',type:'fill',source:'search-buildings',paint:{'fill-color':'#743C48','fill-opacity':.72}});
        map.addLayer({id:'search-buildings-outline',type:'line',source:'search-buildings',paint:{'line-color':'#552B3A','line-width':1}});
        map.addLayer({id:'search-selected',type:'line',source:'search-buildings',filter:['==',['get','component_key'],''],paint:{'line-color':'#B42E37','line-width':3}});
        map.addLayer({id:'search-links',type:'line',source:'search-links',paint:{'line-color':'#B42E37','line-width':1.8,'line-opacity':.7}});
        map.addLayer({id:'search-stations',type:'circle',source:'search-stations',paint:{'circle-color':'#262321','circle-radius':5,'circle-stroke-color':'#F7F1E6','circle-stroke-width':2}});
        map.on('click','search-buildings',event=>{
          const key=String(event.features?.[0]?.properties?.component_key??'');
          const feature=this.buildings.find(x=>x.properties.component_key===key);
          if(feature)void this.choose(feature,true);
        });
        map.on('mouseenter','search-buildings',()=>{map.getCanvas().style.cursor='pointer'});
        map.on('mouseleave','search-buildings',()=>{map.getCanvas().style.cursor=''});
        resolve();
      });
      this.map.once('error',event=>{if(!this.map?.isStyleLoaded())reject(event.error)});
    });
    return this.mapReady;
  }
  private setSource(name:string,data:FeatureCollection|Feature){
    (this.map!.getSource(name) as maplibregl.GeoJSONSource).setData(data as GeoJSON.GeoJSON);
  }
  private async find(){
    const query=(id('address-query') as HTMLInputElement).value.trim();
    if(query.length<4){this.status(t(this.state.language,'Enter a street and number first.','Escribe primero una calle y un número.'));return}
    const token=++this.sequence;
    this.status(t(this.state.language,'Finding the address…','Buscando la dirección…'));
    try{
      const place=this.selectedPlace??(await this.search(query))[0];
      if(!place){this.status(t(this.state.language,'No matching Madrid address found.','No se encontró una dirección de Madrid.'));return}
      if(token!==this.sequence)return;
      this.selectedPlace=place;this.selectedBuilding=null;
      id('address-result').hidden=false;id('address-breakdown').hidden=true;
      id('address-selected').textContent=place.label;
      this.suggestions=[];this.drawSuggestions();this.status('');
      this.mapStatus(t(this.state.language,'Loading residential buildings within 100 m…','Cargando edificios residenciales a menos de 100 m…'));
      await Promise.all([this.loadIndex(),this.localMode?Promise.resolve():this.ensureMap(place)]);
      if(token!==this.sequence)return;
      if(!this.localMode){this.map!.resize();this.map!.jumpTo({center:[place.lon,place.lat],zoom:17.4})}
      void this.loadOrigins().catch(error=>console.error('Score-origin preload:',error));
      const point=utm30(place.lon,place.lat);
      const latRadius=120/111320,lonRadius=120/(111320*Math.cos(place.lat*Math.PI/180));
      const tiles=this.index!.tiles.filter(x=>x.bbox[0]<=place.lon+lonRadius&&x.bbox[2]>=place.lon-lonRadius&&x.bbox[1]<=place.lat+latRadius&&x.bbox[3]>=place.lat-latRadius);
      const collections=await Promise.all(tiles.map(async tile=>{
        const cached=this.cache.get(tile.file);if(cached)return cached;
        const result=await readChunk(tile.file);this.cache.set(tile.file,result);return result;
      }));
      if(token!==this.sequence)return;
      this.buildings=collections.flatMap(x=>x.features as Building[]).filter(x=>
        Math.hypot(Number(x.properties.x)-point.x,Number(x.properties.y)-point.y)<=100);
      if(this.localMode){
        if(!this.localMap)this.localMap=new AddressLocalMap(key=>{
          const feature=this.buildings.find(x=>x.properties.component_key===key);
          if(feature)void this.choose(feature,true);
        });
        const context=[...new Map(collections.flatMap(x=>x.features as Building[])
          .map(feature=>[feature.properties.component_key,feature] as const)).values()];
        await this.localMap.show({...place,...point},context,this.buildings);
      }else{
        this.setSource('search-radius',radiusPolygon(place.lon,place.lat,100));
        this.setSource('search-buildings',{type:'FeatureCollection',features:this.buildings});
        this.setSource('search-links',empty<LineString,Record<string,unknown>>());
        this.setSource('search-stations',empty<Point,Record<string,unknown>>());
        this.stationMarkers.forEach(marker=>marker.remove());this.stationMarkers=[];
        this.map!.setFilter('search-selected',['==',['get','component_key'],'']);
      }
      this.mapStatus(this.buildings.length
        ? t(this.state.language,`${number(this.buildings.length,this.state.language)} residential buildings found. Click one to reveal its score and station links.`,
            `${number(this.buildings.length,this.state.language)} edificios residenciales encontrados. Haz clic en uno para ver su puntuación y los enlaces a estaciones.`)
        : t(this.state.language,'No modelled residential buildings were found within 100 m. Try a nearby address.','No hay edificios residenciales modelizados a menos de 100 m. Prueba otra dirección cercana.'));
    }catch(error){
      console.error('Address score:',error);
      if(this.map&&!this.map.isStyleLoaded()){this.map.remove();this.map=null;this.mapReady=null}
      this.status(t(this.state.language,'The address or map could not be loaded. Check your connection and try again.','No se pudo cargar la dirección o el mapa. Comprueba la conexión e inténtalo de nuevo.'));
      this.mapStatus('');
    }
  }
  private async choose(feature:Building,fit:boolean){
    this.selectedBuilding=feature;
    const token=this.sequence;
    this.mapStatus(t(this.state.language,'Calculating the selected building’s score…','Calculando la puntuación del edificio seleccionado…'));
    try{await this.loadOrigins()}catch(error){
      console.error('Address score origins:',error);
      this.mapStatus(t(this.state.language,'Score details could not be loaded. Select the building again to retry.','No se pudo cargar el detalle de la puntuación. Vuelve a seleccionar el edificio para reintentar.'));
      return;
    }
    if(token!==this.sequence||this.selectedBuilding!==feature)return;
    const breakdown=calculateScore(this.origins!,Number(feature.properties.x),Number(feature.properties.y),
      this.state.method,this.scoreParameters!);
    const stored=Number(feature.properties[this.state.method==='entrance'?'entrance_score':'platform_score']);
    if(Math.abs(stored-breakdown.score)>.00011)console.error('Address score does not match published building score',feature.properties.component_key,stored,breakdown.score);
    const center=buildingCenter(feature);
    if(!this.localMode)this.map!.setFilter('search-selected',['==',['get','component_key'],feature.properties.component_key]);
    const linked=new Map<string,{origin:ScoreOrigin;lines:Set<string>;distance:number}>();
    for(const line of breakdown.lines)for(const entry of [
      {origin:line.first_origin,distance:line.first_distance_m},
      {origin:line.second_origin,distance:line.second_distance_m}]){
      if(!entry.origin||entry.distance===null||entry.distance>1000)continue;
      const old=linked.get(entry.origin.station_id);
      if(!old||entry.distance<old.distance)linked.set(entry.origin.station_id,{origin:entry.origin,lines:new Set(old?.lines??[]),distance:entry.distance});
      linked.get(entry.origin.station_id)!.lines.add(line.line_id);
    }
    const stations:Feature<Point>[]=[];const links:Feature<LineString>[]=[];
    for(const value of linked.values()){
      const station:[number,number]=[value.origin.lon,value.origin.lat];
      stations.push({type:'Feature',properties:{label:`${value.origin.name} · ${[...value.lines].sort().join(', ')}`},geometry:{type:'Point',coordinates:station}});
      links.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[center,station]}});
    }
    if(this.localMode){
      void this.localMap!.showConnections([...linked.values()].map(value=>({
        lon:value.origin.lon,lat:value.origin.lat,
        label:`${value.origin.name} · ${[...value.lines].sort().join(', ')}`})),feature.properties.component_key,fit);
    }else{
      this.setSource('search-stations',{type:'FeatureCollection',features:stations});
      this.setSource('search-links',{type:'FeatureCollection',features:links});
      this.stationMarkers.forEach(marker=>marker.remove());this.stationMarkers=[];
      for(const station of stations){
        const label=document.createElement('span');label.className='address-station-label';
        label.textContent=String(station.properties?.label??'');
        this.stationMarkers.push(new maplibregl.Marker({element:label,anchor:'left',offset:[8,0]})
          .setLngLat(station.geometry.coordinates as [number,number]).addTo(this.map!));
      }
      if(fit){
        const bounds=new maplibregl.LngLatBounds(center,center);
        for(const value of linked.values())bounds.extend([value.origin.lon,value.origin.lat]);
        this.map!.fitBounds(bounds,{padding:45,maxZoom:16,duration:500});
      }
    }
    id('address-breakdown').hidden=false;
    id('address-total').textContent=number(breakdown.score,this.state.language,2);
    id('address-building').textContent=t(this.state.language,
      `Residential component ${feature.properties.component_key} · section ${feature.properties.CUSEC} · ${number(Number(feature.properties.pop),this.state.language)} modelled residents`,
      `Componente residencial ${feature.properties.component_key} · sección ${feature.properties.CUSEC} · ${number(Number(feature.properties.pop),this.state.language)} residentes modelizados`);
    renderScoreLedger(id('address-ledger') as HTMLElement,breakdown,this.state.language);
    this.mapStatus(t(this.state.language,`${linked.size} contributing stations within 1,000 m are connected to the selected building.`,`Hay ${linked.size} estaciones que contribuyen a menos de 1.000 m, conectadas con el edificio seleccionado.`));
  }
  private clear(){
    ++this.sequence;this.searchAbort?.abort();clearTimeout(this.searchTimer);
    (id('address-query') as HTMLInputElement).value='';this.selectedPlace=null;this.selectedBuilding=null;
    this.suggestions=[];this.drawSuggestions();this.buildings=[];
    this.stationMarkers.forEach(marker=>marker.remove());this.stationMarkers=[];
    id('address-result').hidden=true;id('address-breakdown').hidden=true;
    this.status('');this.mapStatus('');
    this.localMap?.clear();
    if(this.map?.isStyleLoaded()){
      this.setSource('search-radius',empty<Polygon,Record<string,unknown>>());
      this.setSource('search-buildings',empty<Polygon|MultiPolygon,Building['properties']>());
      this.setSource('search-links',empty<LineString,Record<string,unknown>>());
      this.setSource('search-stations',empty<Point,Record<string,unknown>>());
    }
    (id('address-query') as HTMLInputElement).focus();
  }
}
