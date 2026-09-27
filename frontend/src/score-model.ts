import type {Language,Method} from './types';
import {number,t} from './types';

export interface ScoreOrigin{
  origin_id:string;station_id:string;name:string;method:Method;line_id:string;
  x:number;y:number;lon:number;lat:number;
}
export interface ScoreLine{
  line_id:string;first_station:string;first_station_id?:string;first_origin?:ScoreOrigin;
  first_distance_m:number;second_station:string|null;second_station_id?:string|null;
  second_origin?:ScoreOrigin|null;second_distance_m:number|null;
  full_contribution:number;repeat_contribution:number;line_score:number;protected:boolean;
}
export interface ScoreBreakdown{
  score:number;protected_distance_m:number;full_score:number;raw_tail:number;
  tail_cap:number;tail_score:number;lines:ScoreLine[];
}
export interface ScoreParameters{d50_m:number;p:number;duplicate_factor:number;
  protected_line_count:number;protected_distance_floor_m:number;tail_cap_multiplier:number}
const defaults:ScoreParameters={d50_m:600,p:2.5,duplicate_factor:.1,
  protected_line_count:3,protected_distance_floor_m:1000,tail_cap_multiplier:1};
export const decay=(distance:number,half=600,shape=2.5)=>
  Number.isFinite(distance)?1/(1+(distance/half)**shape):0;

export function calculateScore(origins:ScoreOrigin[],x:number,y:number,method:Method,
                               parameters:Partial<ScoreParameters>={}):ScoreBreakdown{
  const settings={...defaults,...parameters};
  const groups=new Map<string,Map<string,{origin:ScoreOrigin;distance:number}>>();
  for(const origin of origins){
    if(origin.method!==method)continue;
    const distance=Math.hypot(origin.x-x,origin.y-y);
    let stations=groups.get(origin.line_id);
    if(!stations){stations=new Map();groups.set(origin.line_id,stations)}
    const previous=stations.get(origin.station_id);
    if(!previous||distance<previous.distance||distance===previous.distance&&origin.origin_id<previous.origin.origin_id)
      stations.set(origin.station_id,{origin,distance});
  }
  const lines:ScoreLine[]=[];
  for(const [line_id,stations] of groups){
    const closest=[...stations.values()].sort((a,b)=>a.distance-b.distance||a.origin.station_id.localeCompare(b.origin.station_id));
    const first=closest[0],second=closest[1];
    const full=decay(first.distance,settings.d50_m,settings.p),
      repeat=second?settings.duplicate_factor*decay(second.distance,settings.d50_m,settings.p):0;
    lines.push({line_id,first_station:first.origin.name,first_station_id:first.origin.station_id,
      first_origin:first.origin,first_distance_m:first.distance,
      second_station:second?.origin.name??null,second_station_id:second?.origin.station_id??null,
      second_origin:second?.origin??null,second_distance_m:second?.distance??null,
      full_contribution:full,repeat_contribution:repeat,line_score:full+repeat,protected:false});
  }
  lines.sort((a,b)=>a.first_distance_m-b.first_distance_m||a.line_id.localeCompare(b.line_id));
  const threshold=Math.max(settings.protected_distance_floor_m,
    lines[Math.min(settings.protected_line_count,lines.length)-1]?.first_distance_m??settings.protected_distance_floor_m);
  let full_score=0,raw_tail=0;
  for(const line of lines){
    line.protected=line.first_distance_m<=threshold;
    if(line.protected)full_score+=line.line_score;else raw_tail+=line.line_score;
  }
  const tail_cap=settings.tail_cap_multiplier*decay(threshold,settings.d50_m,settings.p);
  const tail_score=tail_cap*-Math.expm1(-raw_tail/tail_cap);
  return {score:full_score+tail_score,protected_distance_m:threshold,full_score,
    raw_tail,tail_cap,tail_score,lines};
}

export function renderScoreLedger(host:HTMLElement,score:ScoreBreakdown,language:Language){
  host.replaceChildren();
  const append=(labelText:string,description:string,value:number,kind='')=>{
    const row=document.createElement('div');row.className=`ledger-row ${kind}`;
    const label=document.createElement('strong');label.textContent=labelText;
    const detail=document.createElement('span');detail.textContent=description;
    const amount=document.createElement('b');amount.textContent=number(value,language,3);
    row.append(label,detail,amount);host.append(row);
  };
  for(const line of score.lines.filter(x=>x.protected)){
    const first=`${line.first_station} ${number(line.first_distance_m,language)} m → ${number(line.full_contribution,language,3)}`;
    const second=line.second_station&&line.second_distance_m!==null
      ? ` + ${line.second_station} ${number(line.second_distance_m,language)} m × 0.1 → ${number(line.repeat_contribution,language,3)}`:'';
    append(line.line_id,first+second,line.line_score);
  }
  const tailLines=score.lines.filter(x=>!x.protected).length;
  append(t(language,'Distant lines','Líneas lejanas'),
    t(language,`${tailLines} lines beyond ${number(score.protected_distance_m,language)} m: raw ${number(score.raw_tail,language,3)}, cap ${number(score.tail_cap,language,3)}`,
      `${tailLines} líneas a más de ${number(score.protected_distance_m,language)} m: bruto ${number(score.raw_tail,language,3)}, límite ${number(score.tail_cap,language,3)}`),
    score.tail_score,'ledger-other');
  append(t(language,'Total','Total'),t(language,'Rail Access Score','Puntuación ferroviaria'),
    score.score,'ledger-total');
}
