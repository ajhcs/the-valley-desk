#!/usr/bin/env python3
"""Refresh bounded source receipts for a small manually selected CDC catalog."""
import datetime, json, time, urllib.request, urllib.parse
from pathlib import Path
BASE=Path(__file__).parent
UA={'User-Agent':'valley-desk-research/1.0','Accept':'application/json'}
ITEMS=[('swc5-untb','county',"locationid='42101'"),('cwsq-ngmh','census tract',"countyfips='42101'"),('eav7-hnsx','place',"stateabbr='PA' AND locationname='Philadelphia'"),('p56q-jrxg','county',"county='Philadelphia County'"),('kn79-hsxy','county',"county_fips_code='42101'")]
def fetch(u):
 for attempt in range(3):
  try:
   with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=25) as r:
    data=r.read(1500000); return json.loads(data),r.status,r.headers.get('Content-Type')
  except Exception:
   if attempt==2: raise
   time.sleep(2**attempt)
records=[]; evidence={}; errors={}; day=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
for ident, geography, where in ITEMS:
 metadata='https://data.cdc.gov/api/views/'+ident+'.json'
 query='https://data.cdc.gov/resource/'+ident+'.json?'+urllib.parse.urlencode({'$where':where,'$limit':1})
 try:
  m,_,_=fetch(metadata); rows,status,ctype=fetch(query)
  if not isinstance(rows,list) or not rows: raise ValueError('No local rows returned')
  desc=m.get('description','').strip()
  if not desc: raise ValueError('Missing description')
  identifier='regional:cdc-'+ident.replace('-','-')
  page='https://data.cdc.gov/d/'+ident
  r={'id':identifier,'title':m['name'],'summary':desc.split('.')[0]+'.','publisher':m['attribution'],'portal':'CDC Data','url':page,'topic':'Public health','counties':['Philadelphia'], 'granularity':geography,'time_span':None,'update_cadence':None,'access':'open','license':m.get('license',{}).get('name'),'formats':['JSON'],'api':{'url':'https://data.cdc.gov/resource/'+ident+'.json','type':'Socrata'},'how_to_use':{'step':'Run the bounded Philadelphia query to inspect a sample record.','url':query,'caveats':['Review the source documentation and limitations before interpreting estimates.'],'citation':m['attribution']+'. '+m['name']+'.'},'added':day,'checked':day}
  records.append(r)
  evidence[identifier]={'fields':{k:[metadata] for k in ['title','summary','publisher','granularity','license']} | {'counties':[query], 'formats':[query], 'api':[query], 'access':[query], 'url':[metadata], 'portal':[metadata]},'query':{'url':query,'fetched_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'http_status':status,'content_type':ctype,'result_description':'Nonempty JSON array; one Philadelphia row returned'},'freshness':{'url':metadata,'format':'json','path':'/rowsUpdatedAt','observed':m.get('rowsUpdatedAt')} if m.get('rowsUpdatedAt') else None}
 except Exception as e: errors[ident]=str(e)
(BASE/'seed.json').write_text(json.dumps(records,indent=2,ensure_ascii=False)+'\n')
(BASE/'evidence.json').write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n')
(BASE/'source-failures.json').write_text(json.dumps(errors,indent=2)+'\n')
print('records',len(records),'failures',errors)
