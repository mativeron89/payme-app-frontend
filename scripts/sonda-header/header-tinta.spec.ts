// Sonda de dos motores · ver playwright.config.ts de esta carpeta. No corre en la suite.
import { test } from '@playwright/test';
import { ingresar } from '../../e2e/_app';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
test('sonda · tinta del header', async ({ page, browserName }) => {
  await ingresar(page);
  if (process.env.SONDA_CSS) await page.addStyleTag({ content: process.env.SONDA_CSS });
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
  await page.waitForTimeout(300);
  const data = await page.evaluate(() => {
    const baselineOf = (el: HTMLElement) => { const p = document.createElement('span'); p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;'; el.appendChild(p); const y = p.getBoundingClientRect().y; p.remove(); return y; };
    const ink = (el: HTMLElement, text: string) => { const cs = getComputedStyle(el); const c = document.createElement('canvas').getContext('2d')!; c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const m = c.measureText(text) as TextMetrics & { fontBoundingBoxAscent: number; fontBoundingBoxDescent: number }; return { asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent, fAsc: m.fontBoundingBoxAscent, fDesc: m.fontBoundingBoxDescent }; };
    const user = document.querySelector('.hdr-user') as HTMLElement; const logo = document.querySelector('.hdr-logo') as HTMLElement;
    const rb = (document.querySelector('.hdr-mark svg rect') as Element).getBoundingClientRect();
    const ub = baselineOf(user), lb = baselineOf(logo); const ui = ink(user, user.innerText), liCap = ink(logo, 'PM'), ux = ink(user, 'x'), lx = ink(logo, 'x');
    const ubox = user.getBoundingClientRect(), lbox = logo.getBoundingClientRect();
    return { squareCy: (rb.y + rb.bottom) / 2, user: { box: [ubox.y, ubox.bottom], baseline: ub, inkCy: (ub - ui.asc + ub + ui.desc) / 2, xCy: ub - ux.asc / 2, fontAsc: ui.fAsc, fontDesc: ui.fDesc, transform: getComputedStyle(user).transform, lh: getComputedStyle(user).lineHeight }, logo: { box: [lbox.y, lbox.bottom], baseline: lb, capCy: lb - liCap.asc / 2, xCy: lb - lx.asc / 2, fontAsc: liCap.fAsc, fontDesc: liCap.fDesc }, ua: navigator.userAgent.slice(0, 80) };
  });
  console.log(`TINTA[${browserName}] ` + JSON.stringify(data));
  if (process.env.CAP) await page.screenshot({ path: process.env.CAP.replace(".png", `-${browserName}.png`), clip: { x: 0, y: 12, width: 200, height: 48 } });
});
