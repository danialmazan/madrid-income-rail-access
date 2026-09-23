export type Language='en'|'es';
export type IncomeMetric='income_median_equivalised'|'income_mean_equivalised'|'income_mean_per_person';
export type Method='entrance'|'platform';
export type Geography='region'|'city';
export type MapLayer='income'|'score'|'bivariate';
export interface State{language:Language;incomeMetric:IncomeMetric;method:Method;geography:Geography;distributionGroups:5|10;mapLayer:MapLayer}
export interface Section{CUSEC:string;CUMUN:string;NMUN:string;district:string;section_population:number;income_median_equivalised:number|null;income_mean_equivalised:number|null;income_mean_per_person:number|null;rail_score_entrance:number;rail_score_platform:number}
export interface Quadrant{quadrant:string;sections:number;population:number;population_share:number}
export interface Summary{geography:Geography;income_metric:IncomeMetric;method:Method;sections:number;population:number;spearman_rho:number;income_threshold:number;score_threshold:number;quadrants:Quadrant[]}
export interface GroupRow{group:number;sections:number;population:number;mean_score:number;p10:number;p25:number;median_score:number;p75:number;p90:number;income_min:number;income_max:number;population_share:number;geography:Geography;income_metric:IncomeMetric;method:Method}
export interface CDFRow{method:Method;geography:Geography;income_metric:IncomeMetric;group:number;score:number;share:number}
export interface SmoothRow{geography:Geography;income_metric:IncomeMetric;method:Method;income:number;score:number}
export interface AnalysisData{meta:{income_year:number;income_section_reference:string;population_reference:string;rail_snapshot:string;distance_type:string;component_count:number;section_count:number};sections:Section[];summaries:Summary[];deciles:GroupRow[];quintiles:GroupRow[];cdfs:CDFRow[];smoothers:SmoothRow[]}
export const metricLabels:Record<IncomeMetric,{en:string;es:string}>={
  income_median_equivalised:{en:'Median equivalised income',es:'Renta mediana por unidad de consumo'},
  income_mean_equivalised:{en:'Mean equivalised income',es:'Renta media por unidad de consumo'},
  income_mean_per_person:{en:'Mean income per person',es:'Renta neta media por persona'}
};
export function t(language:Language,en:string,es:string){return language==='es'?es:en}
export function money(value:number,language:Language){return new Intl.NumberFormat(language==='es'?'es-ES':'en-GB',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value)}
export function number(value:number,language:Language,decimals=0){return new Intl.NumberFormat(language==='es'?'es-ES':'en-GB',{maximumFractionDigits:decimals,minimumFractionDigits:decimals}).format(value)}

