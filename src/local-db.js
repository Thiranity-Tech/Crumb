let db
const key = 'crumb-local-operational-db'
const blank = () => ({
  products: [],
  purchases: [],
  expenses: [],
  sales: [],
  sale_items: [],
  counters: { products: 0, purchases: 0, expenses: 0, sales: 0, sale_items: 0 }
})

export async function openLocalDb() {
  try {
    if (window.crumbDesktop && window.crumbDesktop.readDb) {
      const b64 = await window.crumbDesktop.readDb()
      if (b64) db = JSON.parse(decodeURIComponent(escape(atob(b64))))
    }
  } catch (err) {
    console.warn('Failed reading desktop DB:', err)
  }

  if (!db) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) db = JSON.parse(raw)
    } catch {
      db = null
    }
  }

  if (!db) db = blank()

  // Ensure all arrays and counters exist
  db.products = db.products || []
  db.purchases = db.purchases || []
  db.expenses = db.expenses || []
  db.sales = db.sales || []
  db.sale_items = db.sale_items || []
  db.counters = db.counters || { products: 0, purchases: 0, expenses: 0, sales: 0, sale_items: 0 }

  // Normalize legacy data fields (fix zero prices, invalid dates, and mismatched property names)
  db.products = db.products.map(p => {
    const sp = Number(p.selling_price != null ? p.selling_price : (p.price != null ? p.price : 0))
    return {
      ...p,
      id: p.id || Date.now(),
      name: p.name || 'Product',
      selling_price: sp,
      price: sp
    }
  })

  db.purchases = db.purchases.map(pu => {
    const prod = db.products.find(x => String(x.id) === String(pu.product || pu.product_id))
    const cost = Number(pu.total_cost != null ? pu.total_cost : (pu.cost != null ? pu.cost : 0))
    const dt = pu.purchased_at || pu.date || new Date().toISOString()
    const name = pu.product_name || pu.name || prod?.name || 'Item'
    return {
      ...pu,
      id: pu.id || Date.now(),
      product_name: name,
      name: name,
      quantity: Number(pu.quantity || 1),
      unit: pu.unit || 'Piece',
      total_cost: cost,
      cost: cost,
      purchased_at: dt,
      date: dt
    }
  })

  db.expenses = db.expenses.map(ex => {
    const amt = Number(ex.amount != null ? ex.amount : 0)
    const dt = ex.expense_at || ex.date || new Date().toISOString()
    return {
      ...ex,
      id: ex.id || Date.now(),
      description: ex.description || 'Expense',
      amount: amt,
      expense_at: dt,
      date: dt
    }
  })

  await persist()
}

async function persist() {
  if (!db) return
  try {
    const json = JSON.stringify(db)
    localStorage.setItem(key, json)
    if (window.crumbDesktop && window.crumbDesktop.writeDb) {
      await window.crumbDesktop.writeDb(btoa(unescape(encodeURIComponent(json))))
    }
  } catch (err) {
    console.error('Failed to persist DB:', err)
  }
}

const getTable = sql => sql?.match(/(?:from|into)\s+(\w+)/i)?.[1]

export async function query(sql) {
  if (!db) await openLocalDb()
  const t = getTable(sql)
  if (sql.includes('last_insert_rowid')) return [{ id: db.lastId }]
  let rows = [...(db[t] || [])]
  if (sql.includes('order by name')) {
    rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }
  if (sql.includes('order by purchased_at') || sql.includes('order by expense_at') || sql.includes('order by sold_at')) {
    rows.sort((a, b) => String(b.purchased_at || b.expense_at || b.sold_at || '').localeCompare(String(a.purchased_at || a.expense_at || a.sold_at || '')))
  }
  return rows
}

export async function execute(sql, params = []) {
  if (!db) await openLocalDb()
  const t = getTable(sql)
  if (!t) return
  const cols = (sql.match(/\(([^)]+)\)\s*values/i)?.[1] || '').split(',').map(x => x.trim())
  const row = Object.fromEntries(cols.map((c, i) => [c, params[i]]))
  row.id = ++db.counters[t]

  if (t === 'products') {
    row.selling_price = Number(row.selling_price || row.price || 0)
    row.price = row.selling_price
  } else if (t === 'purchases') {
    row.total_cost = Number(row.total_cost || row.cost || 0)
    row.cost = row.total_cost
    row.purchased_at = row.purchased_at || new Date().toISOString()
    row.date = row.purchased_at
  } else if (t === 'expenses') {
    row.amount = Number(row.amount || 0)
    row.expense_at = row.expense_at || new Date().toISOString()
    row.date = row.expense_at
  }

  db.lastId = row.id
  db[t].push(row)
  await persist()
  return row
}

export async function updateRecord(table, id, data) {
  if (!db) await openLocalDb()
  const list = db[table] || []
  const idx = list.findIndex(x => String(x.id) === String(id))
  if (idx !== -1) {
    const updated = { ...list[idx], ...data }
    if (table === 'products') {
      if (data.selling_price != null || data.price != null) {
        const p = Number(data.selling_price != null ? data.selling_price : data.price)
        updated.selling_price = p
        updated.price = p
      }
    } else if (table === 'purchases') {
      if (data.total_cost != null || data.cost != null) {
        const c = Number(data.total_cost != null ? data.total_cost : data.cost)
        updated.total_cost = c
        updated.cost = c
      }
      if (data.quantity != null) updated.quantity = Number(data.quantity)
    } else if (table === 'expenses') {
      if (data.amount != null) updated.amount = Number(data.amount)
    }
    list[idx] = updated
    await persist()
    return updated
  }
  return null
}

export async function deleteRecord(table, id) {
  if (!db) await openLocalDb()
  if (db[table]) {
    db[table] = db[table].filter(x => String(x.id) !== String(id))
    await persist()
    return true
  }
  return false
}

export async function backup() {
  if (!window.crumbDesktop || !window.crumbDesktop.backup) return null
  await persist()
  return window.crumbDesktop.backup()
}
