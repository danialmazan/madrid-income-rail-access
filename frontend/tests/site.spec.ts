import {test,expect} from '@playwright/test';

for(const width of [390,1440])test(`article and controls at ${width}px`,async({browser})=>{
  const page=await browser.newPage({viewport:{width,height:900}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#scatter-chart circle.dot')).toHaveCount(4474);
  await expect(page.locator('#decile-chart rect.bar')).toHaveCount(10);
  await expect(page.locator('#box-chart rect.box')).toHaveCount(5);
  await expect(page.locator('#finding')).toContainText('Spearman');
  await page.locator('#income-metric').selectOption('income_mean_per_person');
  await expect(page.locator('#scatter-chart circle.dot')).toHaveCount(4480);
  await page.locator('#point-method').selectOption('platform');
  await page.locator('#geography').selectOption('city');
  await expect(page.locator('#scatter-chart circle.dot')).toHaveCount(2450);
  await page.locator('#distribution-groups').selectOption('10');
  await expect(page.locator('#box-chart rect.box')).toHaveCount(10);
  await page.locator('[data-map-layer="score"]').click();
  await expect(page.locator('#map-legend')).toContainText('0.01');
  expect(await page.evaluate(()=>document.body.scrollWidth)).toBeLessThanOrEqual(width);
  expect(errors).toEqual([]);
  await page.close();
});

test('Spanish language and source disclosure',async({page})=>{
  await page.goto('/?lang=es');
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await expect(page.locator('#finding')).toContainText('En 4474 secciones');
  await expect(page.locator('#missing-note')).toContainText('6 secciones');
  await expect(page.locator('#cdf-legend span')).toHaveCount(5);
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('#missing-note')).toContainText('6 sections');
});
