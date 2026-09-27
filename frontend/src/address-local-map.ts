import type {Feature,MultiPolygon,Polygon} from 'geojson';

type Building=Feature<Polygon|MultiPolygon,{component_key:string;x:number;y:number}>;
type Road=['major'|'street'|'path',string|null,number[][][]];
interface RoadTile{key:string;bbox:[number,number,number,number]}
interface RoadIndex{tiles:RoadTile[]}
export interface LocalStation{lon:number;lat:number;label:string}
const SVG_NS='http://www.w3.org/2000/svg';
const make=<K extends keyof SVGElementTagNameMap>(name:K)=>document.createElementNS(SVG_NS,name);
const dataUrl=(path:string)=>new URL(`data/local_roads/${path}`,document.baseURI);

async function readRoads(key:string):Promise<Road[]>{
  const response=await fetch(dataUrl(`${key}.jsonl.gz`));
  if(!response.ok)throw new Error(`Road tile ${response.status}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  const content=bytes[0]===0x1f&&bytes[1]===0x8b
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  return content.trim().split('\n').map(line=>JSON.parse(line) as Road);
}

export class AddressLocalMap{
  private host:HTMLElement;
  private svg:SVGSVGElement;
  private index:RoadIndex|null=null;
  private roadCache=new Map<string,Road[]>();
  private roads:Road[]=[];
  private context:Building[]=[];
  private nearby:Building[]=[];
  private place:{lon:number;lat:number;x:number;y:number}|null=null;
  private stations:LocalStation[]=[];
  private selected='';
  private viewHeight=320;
  private viewX=0;
  private viewY=0;
  private sequence=0;
  constructor(onSelect:(key:string)=>void){
    this.host=document.getElementById('address-map')!;
    this.host.replaceChildren();
    this.svg=make('svg');this.svg.classList.add('address-local-svg');
    this.svg.setAttribute('role','img');
    this.svg.setAttribute('aria-label','Local Madrid street map with selectable residential buildings');
    this.host.append(this.svg);
    const controls=document.createElement('div');controls.className='address-local-controls';
    for(const [label,factor] of [['+',.65],['−',1/.65]] as const){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.setAttribute('aria-label',factor<1?'Zoom in':'Zoom out');
      button.addEventListener('click',()=>{this.viewHeight=Math.max(140,Math.min(3000,this.viewHeight*factor));this.render()});
      controls.append(button);
    }
    this.host.append(controls);
    const credit=document.createElement('div');credit.className='address-local-attribution';
    credit.innerHTML='<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · Geofabrik';
    this.host.append(credit);
    this.svg.addEventListener('wheel',event=>{
      event.preventDefault();this.viewHeight=Math.max(140,Math.min(3000,this.viewHeight*(event.deltaY>0?1.2:.83)));this.render();
    },{passive:false});
    this.onSelect=onSelect;
  }
  private onSelect:(key:string)=>void;
  private point(lon:number,lat:number):[number,number]{
    const place=this.place!;
    return [(lon-place.lon)*111320*Math.cos(place.lat*Math.PI/180),-(lat-place.lat)*111320];
  }
  private path(feature:Building){
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    return polygons.map(polygon=>polygon.map(ring=>ring.map(([lon,lat],i)=>{
      const [x,y]=this.point(lon,lat);return `${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ')+' Z').join(' ')).join(' ');
  }
  private async loadRoads(radiusMeters:number,token:number){
    if(!this.index){
      const response=await fetch(dataUrl('index.json'));
      if(!response.ok)throw new Error(`Road index ${response.status}`);
      this.index=await response.json() as RoadIndex;
    }
    const place=this.place!;
    const latDelta=radiusMeters/111320;
    const lonDelta=radiusMeters/(111320*Math.cos(place.lat*Math.PI/180));
    const tiles=this.index.tiles.filter(tile=>tile.bbox[0]<=place.lon+lonDelta&&tile.bbox[2]>=place.lon-lonDelta
      &&tile.bbox[1]<=place.lat+latDelta&&tile.bbox[3]>=place.lat-latDelta);
    const rows=await Promise.all(tiles.map(async tile=>{
      let roads=this.roadCache.get(tile.key);
      if(!roads){roads=await readRoads(tile.key);this.roadCache.set(tile.key,roads)}
      return roads;
    }));
    if(token!==this.sequence)return;
    this.roads=rows.flat();this.render();
  }
  async show(place:{lon:number;lat:number;x:number;y:number},context:Building[],nearby:Building[]){
    const token=++this.sequence;
    this.place=place;this.context=context.filter(feature=>Math.hypot(feature.properties.x-place.x,
      feature.properties.y-place.y)<800);
    this.nearby=nearby;this.stations=[];this.selected='';this.roads=[];
    this.viewHeight=320;this.viewX=0;this.viewY=0;
    this.render();
    try{await this.loadRoads(450,token)}catch(error){console.error('Local street map:',error)}
  }
  async showConnections(stations:LocalStation[],selected:string,fit:boolean){
    if(!this.place)return;
    this.stations=stations;this.selected=selected;
    if(fit&&stations.length){
      const points=stations.map(station=>this.point(station.lon,station.lat));points.push([0,0]);
      const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
      const width=Math.max(...xs)-Math.min(...xs)+200,height=Math.max(...ys)-Math.min(...ys)+200;
      const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight);
      this.viewHeight=Math.max(320,height,width/aspect);
      this.viewX=(Math.max(...xs)+Math.min(...xs))/2;
      this.viewY=(Math.max(...ys)+Math.min(...ys))/2;
    }
    this.render();
    const token=this.sequence;
    try{await this.loadRoads(Math.max(450,this.viewHeight*1.1),token)}catch(error){console.error('Local street map:',error)}
  }
  clear(){++this.sequence;this.place=null;this.nearby=[];this.context=[];this.roads=[];this.stations=[];this.svg.replaceChildren()}
  private render(){
    if(!this.place)return;
    const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight);
    const width=this.viewHeight*aspect;
    this.svg.setAttribute('viewBox',`${this.viewX-width/2} ${this.viewY-this.viewHeight/2} ${width} ${this.viewHeight}`);
    this.svg.replaceChildren();
    const background=make('rect');background.setAttribute('x',String(this.viewX-width/2));
    background.setAttribute('y',String(this.viewY-this.viewHeight/2));
    background.setAttribute('width',String(width));background.setAttribute('height',String(this.viewHeight));
    background.setAttribute('fill','#ECE8E0');this.svg.append(background);
    for(const category of ['path','street','major'] as const){
      const group=make('g');group.setAttribute('class',`address-roads-${category}`);
      for(const [kind,,lines] of this.roads){
        if(kind!==category)continue;
        for(const line of lines){
          const path=make('path');path.setAttribute('d',line.map(([lon,lat],i)=>{
            const [x,y]=this.point(lon,lat);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' '));group.append(path);
        }
      }
      this.svg.append(group);
    }
    const buildings=make('g');buildings.setAttribute('class','address-local-context');
    const selectable=new Set(this.nearby.map(feature=>feature.properties.component_key));
    for(const feature of this.context){
      if(selectable.has(feature.properties.component_key))continue;
      const path=make('path');path.setAttribute('d',this.path(feature));path.setAttribute('fill-rule','evenodd');buildings.append(path);
    }
    this.svg.append(buildings);
    const radius=make('circle');radius.setAttribute('cx','0');radius.setAttribute('cy','0');
    radius.setAttribute('r','100');radius.setAttribute('class','address-local-radius');this.svg.append(radius);
    const selectedFeature=this.nearby.find(feature=>feature.properties.component_key===this.selected);
    const sourceX=selectedFeature?selectedFeature.properties.x-this.place.x:0;
    const sourceY=selectedFeature?this.place.y-selectedFeature.properties.y:0;
    const links=make('g');links.setAttribute('class','address-local-links');
    for(const station of this.stations){
      const [x,y]=this.point(station.lon,station.lat);
      const line=make('line');line.setAttribute('x1',String(sourceX));line.setAttribute('y1',String(sourceY));
      line.setAttribute('x2',String(x));line.setAttribute('y2',String(y));links.append(line);
    }
    this.svg.append(links);
    const chosen=make('g');chosen.setAttribute('class','address-local-buildings');
    for(const feature of this.nearby){
      const key=feature.properties.component_key;
      const path=make('path');path.setAttribute('d',this.path(feature));path.setAttribute('fill-rule','evenodd');
      path.setAttribute('class',key===this.selected?'selected':'');path.setAttribute('tabindex','0');
      path.setAttribute('role','button');path.setAttribute('aria-label',`Residential component ${key}`);
      path.addEventListener('click',()=>this.onSelect(key));
      path.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.onSelect(key)}});
      chosen.append(path);
    }
    this.svg.append(chosen);
    const point=make('circle');point.setAttribute('cx','0');point.setAttribute('cy','0');point.setAttribute('r','3');
    point.setAttribute('class','address-local-point');this.svg.append(point);
    const stationGroup=make('g');stationGroup.setAttribute('class','address-local-stations');
    const labelBoxes:Array<{left:number;right:number;top:number;bottom:number}>=[];
    for(const station of this.stations){
      const [x,y]=this.point(station.lon,station.lat);
      const dot=make('circle');dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));
      dot.setAttribute('r',String(Math.max(5,this.viewHeight/100)));
      dot.setAttribute('aria-label',station.label);
      const title=make('title');title.textContent=station.label;dot.append(title);
      stationGroup.append(dot);
      const fontSize=this.viewHeight/35,estimatedWidth=station.label.length*fontSize*.48;
      const candidates=[[x+fontSize*.6,y-fontSize*.35],[x+fontSize*.6,y+fontSize*1.1],
        [x-estimatedWidth-fontSize*.6,y-fontSize*.35]];
      for(const [left,baseline] of candidates){
        const box={left,right:left+estimatedWidth,top:baseline-fontSize,bottom:baseline+fontSize*.2};
        if(labelBoxes.some(other=>box.left<other.right&&box.right>other.left&&box.top<other.bottom&&box.bottom>other.top))continue;
        const label=make('text');label.setAttribute('x',String(left));label.setAttribute('y',String(baseline));
        label.setAttribute('font-size',String(fontSize));label.textContent=station.label;stationGroup.append(label);
        labelBoxes.push(box);break;
      }
    }
    this.svg.append(stationGroup);
    if(this.viewHeight>650)return;
    const names=new Set<string>();
    const labels=make('g');labels.setAttribute('class','address-local-road-labels');
    for(const [kind,name,lines] of this.roads){
      if(!name||names.has(name)||kind==='path'||names.size>=35)continue;
      const line=lines[0];if(!line?.length)continue;
      const [x,y]=this.point(...line[Math.floor(line.length/2)] as [number,number]);
      if(Math.abs(x-this.viewX)>width*.45||Math.abs(y-this.viewY)>this.viewHeight*.45)continue;
      const label=make('text');label.setAttribute('x',String(x));label.setAttribute('y',String(y));
      label.setAttribute('font-size',String(this.viewHeight/48));
      label.textContent=name;labels.append(label);names.add(name);
    }
    this.svg.append(labels);
  }
}
