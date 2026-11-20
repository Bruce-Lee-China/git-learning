import { readFile, mkdir, writeFile } from 'node:fs/promises';

const source = 'https://typhoon.slt.zj.gov.cn/';
const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date());
async function request(path) {
  const response = await fetch(new URL('Api/' + path, source), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
  return response.json();
}

function point(raw) {
  const lon = Number(raw.lng);
  const lat = Number(raw.lat);
  if (!raw.lng || !raw.lat || !Number.isFinite(lon) || !Number.isFinite(lat) ||
      Math.abs(lon) > 180 || Math.abs(lat) > 90 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw.time)) {
    throw new Error('Invalid track point');
  }
  return { lon, lat, time: raw.time };
}

function largestRadius(value) {
  const radii = String(value ?? '').split('|').map(Number).filter(radius => Number.isFinite(radius) && radius > 0);
  return radii.length ? Math.max(...radii) : null;
}

const list = await request('TyphoonList/' + year);
if (!Array.isArray(list) || list.some(row => !/^\d{6,8}$/.test(row?.tfid) ||
    !['0', '1'].includes(String(row.isactive)))) {
  throw new Error('Unexpected Zhejiang typhoon list');
}

const active = list.filter(row => String(row.isactive) === '1');
const latest = list.filter(row => row.endtime).sort((a, b) => b.endtime.localeCompare(a.endtime))[0];
const selected = active.length ? active : latest ? [latest] : [];
const storms = [];
for (const row of selected) {
  const detail = await request('TyphoonInfo/' + row.tfid);
  if (String(detail?.tfid) !== String(row.tfid) || !Array.isArray(detail.points) || !detail.points.length) {
    throw new Error('Invalid track for ' + row.tfid);
  }
  const observed = [...detail.points].sort((a, b) => a.time.localeCompare(b.time));
  const last = observed.at(-1);
  const forecast = last.forecast?.find(item => item.tm === '中国' && item.forecastpoints?.length) ??
    last.forecast?.find(item => item.forecastpoints?.length);
  const predicted = (forecast?.forecastpoints ?? []).map(point).filter(p => p.time > last.time)
    .sort((a, b) => a.time.localeCompare(b.time));
  storms.push({
    id: String(row.tfid), name: detail.name || row.name,
    active: String(row.isactive) === '1', observed: observed.map(point), predicted,
    agency: predicted.length ? forecast.tm : null, direction: last.movedirection,
    movement: last.movespeed, power: last.power, wind: last.speed,
    pressure: last.pressure, radius7: largestRadius(last.radius7), radius10: largestRadius(last.radius10)
  });
}

const snapshot = JSON.stringify({ source, synced: new Date().toISOString(), storms }).replaceAll('<', '\\u003c');
const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const marker = '<script type="application/json" id="snapshot">null</script>';
if (!template.includes(marker)) throw new Error('Missing snapshot placeholder');
const html = template.replace(marker, () => marker.replace('>null<', '>' + snapshot + '<'));
const dist = new URL('../dist/', import.meta.url);
await mkdir(dist, { recursive: true });
await writeFile(new URL('index.html', dist), html);
console.log('Fetched ' + list.length + ' entries and ' + storms.length + ' detailed tracks.');
