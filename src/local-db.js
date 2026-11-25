let db
const key = 'crumb-local-operational-db'
const blank = () => ({
  products: [],
  ingredients: [],
  purchases: [],
  expenses: [],
  sales: [],
  sale_items: [],
  counters: { products: 0, ingredients: 0, purchases: 0, expenses: 0, sales: 0, sale_items: 0 }
})

function syncIngredientFromPurchase(pu) {
  if (!db.ingredients) db.ingredients = []
  const name = (pu.product_name || pu.name || '').trim()
  if (!name) return

  const qty = Number(pu.quantity || 1)
  const cost = Number(pu.total_cost != null ? pu.total_cost : (pu.cost != null ? pu.cost : 0))
  const unit = pu.unit || 'Piece'
  const dt = pu.purchased_at || pu.date || new Date().toISOString()

  const existing = db.ingredients.find(i => (i.name || '').toLowerCase() === name.toLowerCase())
  if (existing) {
    existing.quantity = Number((Number(existing.quantity || 0) + qty).toFixed(3))
    existing.total_cost = Number((Number(existing.total_cost || 0) + cost).toFixed(2))
    existing.last_cost = cost
    existing.unit = unit
    existing.updated_at = dt
  } else {
    db.counters.ingredients = (db.counters.ingredients || 0) + 1
    db.ingredients.push({
      id: db.counters.ingredients,
      name,
      quantity: Number(qty.toFixed(3)),
      unit,
      total_cost: cost,
      last_cost: cost,
      updated_at: dt
    })
  }
}

function adjustIngredientFromPurchaseDelete(pu) {
  if (!db.ingredients) return
  const name = (pu.product_name || pu.name || '').trim().toLowerCase()
  if (!name) return
  const ing = db.ingredients.find(i => (i.name || '').toLowerCase() === name)
  if (ing) {
    const qty = Number(pu.quantity || 1)
    const cost = Number(pu.total_cost != null ? pu.total_cost : (pu.cost != null ? pu.cost : 0))
    ing.quantity = Math.max(0, Number((Number(ing.quantity || 0) - qty).toFixed(3)))
    ing.total_cost = Math.max(0, Number((Number(ing.total_cost || 0) - cost).toFixed(2)))
    ing.updated_at = new Date().toISOString()
  }
}

function adjustIngredientFromPurchaseEdit(oldPu, newPu) {
  if (!db.ingredients) return
  const oldName = (oldPu.product_name || oldPu.name || '').trim().toLowerCase()
  const newName = (newPu.product_name || newPu.name || '').trim().toLowerCase()

  const oldQty = Number(oldPu.quantity || 1)
  const oldCost = Number(oldPu.total_cost != null ? oldPu.total_cost : (oldPu.cost != null ? oldPu.cost : 0))

  const newQty = Number(newPu.quantity || 1)
  const newCost = Number(newPu.total_cost != null ? newPu.total_cost : (newPu.cost != null ? newPu.cost : 0))

  if (oldName === newName) {
    const ing = db.ingredients.find(i => (i.name || '').toLowerCase() === newName)
    if (ing) {
      const deltaQty = newQty - oldQty
      const deltaCost = newCost - oldCost
      ing.quantity = Math.max(0, Number((Number(ing.quantity || 0) + deltaQty).toFixed(3)))
      ing.total_cost = Math.max(0, Number((Number(ing.total_cost || 0) + deltaCost).toFixed(2)))
      ing.last_cost = newCost
      ing.unit = newPu.unit || ing.unit
      ing.updated_at = new Date().toISOString()
    }
  } else {
    adjustIngredientFromPurchaseDelete(oldPu)
    syncIngredientFromPurchase(newPu)
  }
}

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
  db.ingredients = db.ingredients || []
  db.purchases = db.purchases || []
  db.expenses = db.expenses || []
  db.sales = db.sales || []
  db.sale_items = db.sale_items || []
  db.counters = db.counters || { products: 0, ingredients: 0, purchases: 0, expenses: 0, sales: 0, sale_items: 0 }
  if (db.counters.ingredients == null) {
    db.counters.ingredients = db.ingredients.length ? Math.max(...db.ingredients.map(x => Number(x.id) || 0)) : 0
  }

  const isValidDt = d => d && typeof d === 'string' && !d.includes('Invalid') && !isNaN(new Date(d).getTime())

  // Normalize legacy data fields
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
    const rawDt = pu.purchased_at || pu.date
    const dt = isValidDt(rawDt) ? new Date(rawDt).toISOString() : new Date().toISOString()
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
    const rawDt = ex.expense_at || ex.date
    const dt = isValidDt(rawDt) ? new Date(rawDt).toISOString() : new Date().toISOString()
    return {
      ...ex,
      id: ex.id || Date.now(),
      description: ex.description || 'Expense',
      amount: amt,
      expense_at: dt,
      date: dt
    }
  })

  // Auto-seed ingredients from existing purchases if ingredients table is empty
  if (db.ingredients.length === 0 && db.purchases.length > 0) {
    for (const pu of db.purchases) {
      syncIngredientFromPurchase(pu)
    }
  }

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
  if (sql.includes('order by purchased_at') || sql.includes('order by expense_at') || sql.includes('order by sold_at') || sql.includes('order by updated_at')) {
    rows.sort((a, b) => String(b.purchased_at || b.expense_at || b.sold_at || b.updated_at || '').localeCompare(String(a.purchased_at || a.expense_at || a.sold_at || a.updated_at || '')))
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
  } else if (t === 'ingredients') {
    row.quantity = Number(row.quantity || 0)
    row.total_cost = Number(row.total_cost || 0)
    row.last_cost = Number(row.last_cost || row.total_cost || 0)
    row.unit = row.unit || 'Piece'
    row.updated_at = row.updated_at || new Date().toISOString()
  } else if (t === 'purchases') {
    row.total_cost = Number(row.total_cost || row.cost || 0)
    row.cost = row.total_cost
    row.purchased_at = row.purchased_at || new Date().toISOString()
    row.date = row.purchased_at
    syncIngredientFromPurchase(row)
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
    const old = { ...list[idx] }
    const updated = { ...list[idx], ...data }
    if (table === 'products') {
      if (data.selling_price != null || data.price != null) {
        const p = Number(data.selling_price != null ? data.selling_price : data.price)
        updated.selling_price = p
        updated.price = p
      }
    } else if (table === 'ingredients') {
      if (data.quantity != null) updated.quantity = Number(data.quantity)
      if (data.total_cost != null) updated.total_cost = Number(data.total_cost)
      if (data.last_cost != null) updated.last_cost = Number(data.last_cost)
      updated.updated_at = new Date().toISOString()
    } else if (table === 'purchases') {
      if (data.total_cost != null || data.cost != null) {
        const c = Number(data.total_cost != null ? data.total_cost : data.cost)
        updated.total_cost = c
        updated.cost = c
      }
      if (data.quantity != null) updated.quantity = Number(data.quantity)
      adjustIngredientFromPurchaseEdit(old, updated)
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
    const item = db[table].find(x => String(x.id) === String(id))
    if (table === 'purchases' && item) {
      adjustIngredientFromPurchaseDelete(item)
    }
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
