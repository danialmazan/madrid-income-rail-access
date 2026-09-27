import {test,expect} from '@playwright/test';

for(const width of [390,873,1084,1440])test(`article and controls at ${width}px`,async({browser})=>{
  const page=await browser.newPage({viewport:{width,height:900}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#geography')).toHaveValue('city');
  await expect(page.locator('[data-map-layer="bivariate"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#hero-pop')).toContainText('3,477,497');
  await expect(page.locator('#hero-score')).toContainText('2.37');
  await expect(page.locator('#scatter-chart circle.dot')).toHaveCount(2450);
  await expect(page.locator('#decile-chart rect.box')).toHaveCount(10);
  await expect(page.locator('#decile-chart circle.mean-mark')).toHaveCount(10);
  await expect(page.locator('#score-example option')).toHaveCount(3);
  await expect(page.locator('#reverse-chart svg rect[role="button"]')).toHaveCount(50);
  await expect(page.locator('#cdf-legend span')).toHaveCount(5);
  await expect(page.locator('#finding')).toContainText('weak');
  const scatterCopy=await page.locator('#scatter .chapter-copy p:not(.eyebrow)').boundingBox();
  const findingBox=await page.locator('#finding').boundingBox();
  expect((findingBox?.y??0)-((scatterCopy?.y??0)+(scatterCopy?.height??0))).toBeLessThan(80);
  await expect(page.locator('#scatter figcaption')).toContainText('Sources:');
  await expect(page.locator('#scatter figcaption')).not.toContainText('Sources: Sources:');
  await expect(page.locator('#income-bands-note')).toHaveCount(0);
  await expect(page.locator('#distribution')).toHaveCount(0);
  await expect(page.locator('#maps')).toHaveCount(0);
  const caption=await page.locator('#scatter figcaption').boundingBox();
  const chart=await page.locator('#scatter-chart').boundingBox();
  expect(Math.abs((caption?.width??0)-(chart?.width??1))).toBeLessThan(2);
  const defs=await page.locator('.control-definitions p').all();
  expect(defs).toHaveLength(3);
  const boxes=await Promise.all(defs.map(x=>x.boundingBox()));
  expect((boxes[0]?.y??0)<(boxes[1]?.y??0)&&(boxes[1]?.y??0)<(boxes[2]?.y??0)).toBe(true);
  if(width>=873){
    const copy=await page.locator('#scatter .chapter-copy').boundingBox();
    expect(copy?.width).toBeGreaterThan(width*.65);
  }
  await page.locator('#income-metric').selectOption('income_mean_per_person');
  await expect(page.locator('#scatter-chart circle.dot')).toHaveCount(2450);
  await page.locator('#point-method').selectOption('platform');
  await page.locator('#geography').selectOption('region');
  await expect(page.locator('#scatter-chart circle.dot')).toHaveCount(4480);
  await page.locator('#score-example').selectOption('2');
  await expect(page.locator('#example-heading')).toContainText('Repeated access');
  await expect(page.locator('#example-ledger .ledger-total')).toHaveCount(1);
  await page.locator('[data-map-layer="score"]').click();
  await expect(page.locator('#map-legend')).toContainText('0.01');
  await page.locator('[data-map-layer="bivariate"]').click();
  const palette=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('#four-grid .four-cell')).map((cell,i)=>({card:getComputedStyle(cell).borderTopColor,legend:getComputedStyle(document.querySelectorAll<HTMLElement>('#map-legend i')[i]).backgroundColor})));
  expect(palette.every(x=>x.card===x.legend)).toBe(true);
  expect(await page.evaluate(()=>document.body.scrollWidth)).toBeLessThanOrEqual(width);
  expect(errors).toEqual([]);
  await page.close();
});

test('inline map loads building polygons for score and combined views',async({browser})=>{
  const page=await browser.newPage({viewport:{width:1084,height:784}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  page.on('requestfailed',r=>errors.push(`REQUEST ${r.url()} ${r.failure()?.errorText}`));
  await page.goto('/?map=inline');
  await expect(page.locator('#file-map-detail')).toContainText('residential components shown',{timeout:30000});
  await page.locator('[data-map-layer="income"]').click();
  await expect(page.locator('#map svg.file-map-svg path')).toHaveCount(2450,{timeout:20000});
  await page.locator('[data-map-layer="score"]').click();
  await expect.poll(async()=>{const value=await page.locator('#file-map-detail').textContent();if(value?.includes('could not'))throw new Error(errors.join(' | '));return value},{timeout:30000}).toContain('residential components shown');
  const scoreShapes=await page.locator('#map svg.file-map-svg path').count();
  expect(scoreShapes).toBeGreaterThan(2450);
  const scoreColors=await page.locator('#map svg.file-map-svg path').evaluateAll(nodes=>new Set(nodes.map(n=>n.getAttribute('fill'))).size);
  expect(scoreColors).toBeGreaterThan(1);
  await page.locator('[data-map-layer="bivariate"]').click();
  await expect(page.locator('#file-map-detail')).toContainText('residential components shown',{timeout:30000});
  const bothShapes=await page.locator('#map svg.file-map-svg path').count();
  expect(bothShapes).toBeGreaterThan(2450);
  const bothColors=await page.locator('#map svg.file-map-svg path').evaluateAll(nodes=>new Set(nodes.map(n=>n.getAttribute('fill'))).size);
  expect(bothColors).toBeGreaterThan(1);
  const firstBuilding=page.locator('#map svg.file-map-svg path').first();
  await expect(firstBuilding).toHaveAttribute('stroke','none');
  expect(await firstBuilding.evaluate(element=>getComputedStyle(element).stroke)).toBe('none');
  expect(errors).toEqual([]);
  await page.close();
});

test('Spanish language and source disclosure',async({page})=>{
  await page.goto('/?lang=es');
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await expect(page.locator('#hero-pop')).toContainText('3.477.497');
  await expect(page.locator('#finding')).toContainText('débil');
  await expect(page.locator('#cdf-legend span')).toHaveCount(5);
  await page.locator('#geography').selectOption('region');
  await expect(page.locator('#missing-note')).toContainText('6 secciones');
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('#missing-note')).toContainText('6 sections');
});


test('browser score calculation matches three published examples',async({page})=>{
  await page.goto('/?map=inline');
  const result=await page.evaluate(async()=>{
    const model=await import('/src/score-model.ts');
    const [origins,examples]=await Promise.all([fetch('/data/score_origins.json').then(r=>r.json()),fetch('/data/score_examples.json').then(r=>r.json())]);
    return examples.map((example:{x:number;y:number;score:number})=>({published:example.score,recomputed:model.calculateScore(origins.origins,example.x,example.y,'entrance').score}));
  });
  for(const row of result)expect(Math.abs(row.published-row.recomputed)).toBeLessThan(1e-8);
  const projected=await page.evaluate(async()=>{const module=await import('/src/address-score.ts');return module.utm30(-3.6167174754,40.4201339994)});
  expect(Math.abs(projected.x-447681.0664)).toBeLessThan(.1);
  expect(Math.abs(projected.y-4474572.2528)).toBeLessThan(.1);
});

test('address lookup waits for Find and reveals nearby buildings',async({page})=>{
  await page.route('https://photon.komoot.io/api?**',route=>route.fulfill({json:{features:[{type:'Feature',geometry:{type:'Point',coordinates:[-3.61639494,40.42012255]},properties:{name:'Avenida de Guadalajara',housenumber:'1',city:'Madrid',postcode:'28032'}}]}}));
  await page.route('https://tiles.openfreemap.org/**',route=>route.abort());
  await page.goto('/?map=inline');
  await expect(page.locator('.address-service-note,.address-instruction')).toHaveCount(0);
  await page.locator('#address-query').focus();
  expect(await page.locator('#address-query').evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('none');
  await page.locator('#address-query').fill('Avenida de Guadalajara 1');
  await expect(page.locator('#address-suggestions [role="option"]')).toHaveCount(1);
  await expect(page.locator('#address-result')).toBeHidden();
  await page.locator('#address-suggestions [role="option"]').click();
  await expect(page.locator('#address-result')).toBeHidden();
  await page.locator('#address-find').click();
  await expect(page.locator('#address-map-status')).toContainText('residential buildings found',{timeout:30000});
  await expect(page.locator('#address-map canvas')).toHaveCount(1);
  await page.locator('#address-map').scrollIntoViewIfNeeded();
  const canvas=await page.locator('#address-map canvas').boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.move(canvas!.x+canvas!.width*.39,canvas!.y+canvas!.height*.25);
  await expect.poll(()=>page.locator('#address-map canvas').evaluate(element=>element.style.cursor)).toBe('pointer');
  await page.mouse.click(canvas!.x+canvas!.width*.39,canvas!.y+canvas!.height*.25);
  await expect(page.locator('#address-breakdown')).toBeVisible();
  await expect(page.locator('#address-ledger .ledger-total')).toHaveCount(1);
  await expect(page.locator('#address-map-status')).toContainText('stations within 1,000 m');
  await page.locator('#address-clear').click();
  await expect(page.locator('#address-result')).toBeHidden();
  await expect(page.locator('#address-query')).toHaveValue('');
});

test('local address map shows streets, buildings, and station links without map tiles',async({page})=>{
  const tileRequests:string[]=[];
  page.on('request',request=>{if(request.url().startsWith('https://tiles.openfreemap.org/'))tileRequests.push(request.url())});
  await page.route('https://photon.komoot.io/api?**',route=>route.fulfill({json:{features:[{type:'Feature',geometry:{type:'Point',coordinates:[-3.7075578,40.421304]},properties:{name:'Gran Vía',postcode:'28013',city:'Madrid'}}]}}));
  await page.route('https://tiles.openfreemap.org/**',route=>route.abort());
  await page.goto('/?map=inline&address_map=local');
  await page.locator('#address-query').fill('Gran Vía 28013 Madrid');
  await page.locator('#address-suggestions [role="option"]').click();
  await page.locator('#address-find').click();
  await expect(page.locator('#address-map-status')).toContainText('residential buildings found',{timeout:30000});
  await expect(page.locator('#address-map svg.address-local-svg')).toBeVisible();
  await expect.poll(()=>page.locator('#address-map .address-roads-street path').count()).toBeGreaterThan(0);
  await expect.poll(()=>page.locator('#address-map .address-local-buildings path').count()).toBeGreaterThan(0);
  expect(tileRequests).toHaveLength(0);
  await page.locator('#address-map .address-local-buildings path').first().click();
  await expect(page.locator('#address-breakdown')).toBeVisible();
  await expect.poll(()=>page.locator('#address-map .address-local-links line').count()).toBeGreaterThan(0);
  await page.locator('#address-clear').focus();
  expect(await page.locator('#address-clear').evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('none');
  await page.locator('#address-clear').click();
  await expect(page.locator('#address-result')).toBeHidden();
});

test('published entrance and platform building scores match browser calculation',async({page})=>{
  await page.goto('/?map=inline');
  const comparisons=await page.evaluate(async()=>{
    const model=await import('/src/score-model.ts');
    const [index,origins]=await Promise.all([fetch('/data/component_chunks/index.json').then(r=>r.json()),fetch('/data/score_origins.json').then(r=>r.json())]);
    const tile=index.tiles.find((x:{bbox:number[]})=>x.bbox[0]<=-3.616717&&x.bbox[2]>=-3.616717&&x.bbox[1]<=40.42013&&x.bbox[3]>=40.42013);
    const bytes=new Uint8Array(await fetch(`/data/component_chunks/${tile.file}`).then(r=>r.arrayBuffer()));
    const collection=bytes[0]===0x1f&&bytes[1]===0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json()
      : JSON.parse(new TextDecoder().decode(bytes));
    const sample=[collection.features[0],collection.features[Math.floor(collection.features.length/2)],collection.features.at(-1)];
    return sample.flatMap((feature:{properties:{x:number;y:number;entrance_score:number;platform_score:number}})=>
      (['entrance','platform'] as const).map(method=>({
        saved:feature.properties[method==='entrance'?'entrance_score':'platform_score'],
        calculated:model.calculateScore(origins.origins,feature.properties.x,feature.properties.y,method,origins.meta.score).score
      })));
  });
  expect(comparisons).toHaveLength(6);
  for(const row of comparisons)expect(Math.abs(row.saved-row.calculated)).toBeLessThan(.00011);
});
