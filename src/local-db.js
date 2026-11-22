let db
const key='crumb-local-operational-db'
const blank=()=>({products:[],purchases:[],expenses:[],sales:[],sale_items:[],counters:{products:0,purchases:0,expenses:0,sales:0,sale_items:0}})
export async function openLocalDb(){try{db=JSON.parse(localStorage.getItem(key)||'')}catch{db=null}if(!db)db=blank();await persist()}
async function persist(){localStorage.setItem(key,JSON.stringify(db));if(window.crumbDesktop)await window.crumbDesktop.writeDb(btoa(unescape(encodeURIComponent(JSON.stringify(db)))))}
const table=sql.match(/(?:from|into)\s+(\w+)/i)?.[1]
export async function query(sql){let t=table;if(sql.includes('last_insert_rowid'))return[{id:db.lastId}];let rows=[...(db[t]||[])];if(sql.includes('order by name'))rows.sort((a,b)=>a.name.localeCompare(b.name));if(sql.includes('order by purchased_at')||sql.includes('order by expense_at')||sql.includes('order by sold_at'))rows.sort((a,b)=>String(b.purchased_at||b.expense_at||b.sold_at).localeCompare(String(a.purchased_at||a.expense_at||a.sold_at)));return rows}
export async function execute(sql,params=[]){let t=table;if(!t)return;let cols=(sql.match(/\(([^)]+)\)\s*values/i)?.[1]||'').split(',').map(x=>x.trim());let row=Object.fromEntries(cols.map((c,i)=>[c,params[i]]));row.id=++db.counters[t];db.lastId=row.id;db[t].push(row);await persist()}
export async function backup(){if(!window.crumbDesktop)return null;await window.crumbDesktop.writeDb(btoa(unescape(encodeURIComponent(JSON.stringify(db))))) ;return window.crumbDesktop.backup()}
