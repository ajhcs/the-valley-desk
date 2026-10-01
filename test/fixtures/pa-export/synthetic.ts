import { readFileSync } from 'node:fs';
import { zipCrc32 } from '../../../src/ingest/watch/bounded-zip';
export const records = ['HB1925','HB1993','SB1113','HB2787'].map(bill => readFileSync(new URL(bill+'.xml',import.meta.url),'utf8'));
/** Synthetic bounded envelope and ZIP; unaltered lexical bill records remain historical. */
export function syntheticXml(body=records.join('\n'), exportDate='September 30, 2026 3:30:06 PM EDT') {
  return `<?xml version="1.0" encoding="UTF-8"?><historyExport exportDate="${exportDate}" totalDocuments="${(body.match(/<bill\b/g)??[]).length}"><session year="2025" session="0">${body}</session></historyExport>`;
}
export function syntheticZip(xml=syntheticXml(), name='PA-Bill-History-2025-RegularSession.xml') {
  const data=new TextEncoder().encode(xml), filename=new TextEncoder().encode(name);
  const bytes=new Uint8Array(30+filename.length+data.length+46+filename.length+22), v=new DataView(bytes.buffer);
  const u16=(at:number,n:number)=>v.setUint16(at,n,true),u32=(at:number,n:number)=>v.setUint32(at,n,true);
  const crc=zipCrc32(data), central=30+filename.length+data.length, end=central+46+filename.length;
  u32(0,0x04034b50);u16(4,20);u32(14,crc);u32(18,data.length);u32(22,data.length);u16(26,filename.length);
  bytes.set(filename,30);bytes.set(data,30+filename.length);
  u32(central,0x02014b50);u16(central+4,20);u16(central+6,20);u32(central+16,crc);u32(central+20,data.length);u32(central+24,data.length);u16(central+28,filename.length);bytes.set(filename,central+46);
  u32(end,0x06054b50);u16(end+8,1);u16(end+10,1);u32(end+12,46+filename.length);u32(end+16,central);
  return bytes;
}
