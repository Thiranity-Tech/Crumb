let db
const key = 'crumb-local-operational-db'
const blank = () => ({
  products: [],
  ingredients: [],
  recipes: [],
  production_batches: [],
  employees: [],
  attendance: [],
  purchases: [],
  expenses: [],
  sales: [],
  sale_items: [],
  counters: { products: 0, ingredients: 0, recipes: 0, production_batches: 0, employees: 0, attendance: 0, purchases: 0, expenses: 0, sales: 0, sale_items: 0 }
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
  db.recipes = db.recipes || []
  db.production_batches = db.production_batches || []
  db.employees = db.employees || []
  db.attendance = db.attendance || []
  db.purchases = db.purchases || []
  db.expenses = db.expenses || []
  db.sales = db.sales || []
  db.sale_items = db.sale_items || []
  db.counters = db.counters || { products: 0, ingredients: 0, recipes: 0, production_batches: 0, employees: 0, attendance: 0, purchases: 0, expenses: 0, sales: 0, sale_items: 0 }
  if (db.counters.ingredients == null) {
    db.counters.ingredients = db.ingredients.length ? Math.max(...db.ingredients.map(x => Number(x.id) || 0)) : 0
  }
  if (db.counters.recipes == null) {
    db.counters.recipes = db.recipes.length ? Math.max(...db.recipes.map(x => Number(x.id) || 0)) : 0
  }
  if (db.counters.production_batches == null) {
    db.counters.production_batches = db.production_batches.length ? Math.max(...db.production_batches.map(x => Number(x.id) || 0)) : 0
  }
  if (db.counters.employees == null) {
    db.counters.employees = db.employees.length ? Math.max(...db.employees.map(x => Number(x.id) || 0)) : 0
  }
  if (db.counters.attendance == null) {
    db.counters.attendance = db.attendance.length ? Math.max(...db.attendance.map(x => Number(x.id) || 0)) : 0
  }

  const isValidDt = d => d && typeof d === 'string' && !d.includes('Invalid') && !isNaN(new Date(d).getTime())

  const demoPrices = {
    'butter croissant': 95,
    'sourdough loaf': 180,
    'chocolate muffin': 75,
    'paneer puff': 65,
    'cinnamon roll': 120,
    'cold coffee': 140
  }

  // Seed default packed items if completely empty
  if (!db.products || db.products.length === 0) {
    db.products = [
      { id: 1, name: 'Butter Croissant', price: 95, selling_price: 95, quantity: 25 },
      { id: 2, name: 'Sourdough Loaf', price: 180, selling_price: 180, quantity: 15 },
      { id: 3, name: 'Chocolate Muffin', price: 75, selling_price: 75, quantity: 30 },
      { id: 4, name: 'Paneer Puff', price: 65, selling_price: 65, quantity: 20 },
      { id: 5, name: 'Cinnamon Roll', price: 120, selling_price: 120, quantity: 18 },
      { id: 6, name: 'Cold Coffee', price: 140, selling_price: 140, quantity: 25 }
    ]
    db.counters.products = 6
  }

  // Normalize legacy data fields and heal missing prices
  db.products = db.products.map(p => {
    let sp = Number(p.selling_price != null ? p.selling_price : (p.price != null ? p.price : 0))
    const pName = (p.name || 'Product').trim()
    const demo = demoPrices[pName.toLowerCase()]
    if (sp <= 0 && demo) sp = demo
    let qty = Number(p.quantity != null ? p.quantity : (p.stock_quantity != null ? p.stock_quantity : 0))
    if (qty <= 0 && demo) qty = 20
    return {
      ...p,
      id: p.id || Date.now(),
      name: pName,
      selling_price: sp,
      price: sp,
      quantity: qty
    }
  })

  // Normalize purchases and prevent Invalid Date or empty product name
  db.purchases = db.purchases.map(pu => {
    const prod = db.products.find(x => String(x.id) === String(pu.product || pu.product_id))
    let cost = Number(pu.total_cost != null ? pu.total_cost : (pu.cost != null ? pu.cost : 0))
    const rawDt = pu.purchased_at || pu.date
    const dt = isValidDt(rawDt) ? new Date(rawDt).toISOString() : new Date().toISOString()
    let name = (pu.product_name || pu.name || prod?.name || '').trim()
    if (!name) {
      if (String(pu.product || pu.product_id) === '1') name = 'Butter Croissant'
      else name = 'Bakery Supplies'
    }
    if (cost <= 0 && pu.quantity === 18) cost = 810
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

  // Default sample ingredients if empty
  if (!db.ingredients || db.ingredients.length === 0) {
    db.ingredients = [
      { id: 1, name: 'Butter', quantity: 15, unit: 'Kg', total_cost: 6750, last_cost: 450, updated_at: new Date().toISOString() },
      { id: 2, name: 'Flour', quantity: 50, unit: 'Kg', total_cost: 2500, last_cost: 50, updated_at: new Date().toISOString() },
      { id: 3, name: 'Sugar', quantity: 20, unit: 'Kg', total_cost: 900, last_cost: 45, updated_at: new Date().toISOString() },
      { id: 4, name: 'Milk', quantity: 30, unit: 'Litre', total_cost: 1800, last_cost: 60, updated_at: new Date().toISOString() },
      { id: 5, name: 'Coffee Beans', quantity: 10, unit: 'Kg', total_cost: 5000, last_cost: 500, updated_at: new Date().toISOString() }
    ]
    db.counters.ingredients = 5
  }

  // Default sample recipes if empty
  if (!db.recipes || db.recipes.length === 0) {
    db.recipes = [
      {
        id: 1,
        name: 'Butter Croissant',
        ingredients: [
          { name: 'Flour', quantity: 0.5, unit: 'Kg' },
          { name: 'Butter', quantity: 0.25, unit: 'Kg' },
          { name: 'Sugar', quantity: 0.05, unit: 'Kg' }
        ],
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        name: 'Cold Coffee',
        ingredients: [
          { name: 'Coffee Beans', quantity: 0.03, unit: 'Kg' },
          { name: 'Milk', quantity: 0.25, unit: 'Litre' },
          { name: 'Sugar', quantity: 0.02, unit: 'Kg' }
        ],
        created_at: new Date().toISOString()
      }
    ]
    db.counters.recipes = 2
  }

  // Default sample employees if empty
  if (!db.employees || db.employees.length === 0) {
    db.employees = [
      { id: 1, name: 'Rajesh Kumar', job: 'Head Baker', contact: '9876543210' },
      { id: 2, name: 'Anita Sharma', job: 'Cashier & POS Operator', contact: '9876543211' },
      { id: 3, name: 'Vikram Singh', job: 'Kitchen Assistant', contact: '9876543212' }
    ]
    db.counters.employees = 3
  }

  // Default sample attendance if empty
  if (!db.attendance || db.attendance.length === 0) {
    const todayStr = new Date().toISOString().slice(0, 10)
    db.attendance = [
      { id: 1, employee_id: 1, employee_name: 'Rajesh Kumar', date: todayStr, status: 'Full day' },
      { id: 2, employee_id: 2, employee_name: 'Anita Sharma', date: todayStr, status: 'Full day' },
      { id: 3, employee_id: 3, employee_name: 'Vikram Singh', date: todayStr, status: 'Half day' }
    ]
    db.counters.attendance = 3
  }

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
  if (sql.includes('order by date')) {
    rows.sort((a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || '')))
  }
  if (sql.includes('order by purchased_at') || sql.includes('order by expense_at') || sql.includes('order by sold_at') || sql.includes('order by updated_at') || sql.includes('order by started_at') || sql.includes('order by created_at')) {
    rows.sort((a, b) => String(b.started_at || b.created_at || b.purchased_at || b.expense_at || b.sold_at || b.updated_at || '').localeCompare(String(a.started_at || a.created_at || a.purchased_at || a.expense_at || a.sold_at || a.updated_at || '')))
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
    row.quantity = Number(row.quantity || 0)
  } else if (t === 'ingredients') {
    row.quantity = Number(row.quantity || 0)
    row.total_cost = Number(row.total_cost || 0)
    row.last_cost = Number(row.last_cost || row.total_cost || 0)
    row.unit = row.unit || 'Piece'
    row.updated_at = row.updated_at || new Date().toISOString()
  } else if (t === 'recipes') {
    row.created_at = row.created_at || new Date().toISOString()
  } else if (t === 'production_batches') {
    row.status = row.status || 'Preparing'
    row.started_at = row.started_at || new Date().toISOString()
    row.produced_quantity = Number(row.produced_quantity || 0)
  } else if (t === 'employees') {
    row.name = (row.name || '').trim()
    row.job = (row.job || '').trim()
    row.phone = (row.phone || '').trim()
    row.created_at = row.created_at || new Date().toISOString()
  } else if (t === 'attendance') {
    row.created_at = row.created_at || new Date().toISOString()
    row.date = row.date || new Date().toISOString().split('T')[0]
    row.status = row.status || 'Full day'
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
      if (data.quantity != null) {
        updated.quantity = Number(data.quantity)
      }
    } else if (table === 'production_batches') {
      if (data.status != null) updated.status = data.status
      if (data.completed_at != null) updated.completed_at = data.completed_at
      if (data.produced_quantity != null) updated.produced_quantity = Number(data.produced_quantity)
    } else if (table === 'employees') {
      if (data.name != null) updated.name = data.name.trim()
      if (data.job != null) updated.job = data.job.trim()
      if (data.phone != null) updated.phone = data.phone.trim()
      if (data.name && old.name !== updated.name && db.attendance) {
        db.attendance.forEach(att => {
          if (String(att.employee_id) === String(id)) att.employee_name = updated.name
        })
      }
    } else if (table === 'attendance') {
      if (data.employee_id != null) updated.employee_id = data.employee_id
      if (data.employee_name != null) updated.employee_name = data.employee_name
      if (data.date != null) updated.date = data.date
      if (data.status != null) updated.status = data.status
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

export async function startProductionBatch({ recipe_name, recipe_id = null, ingredients = [] }) {
  if (!db) await openLocalDb()
  const cleanName = (recipe_name || 'Production Batch').trim()
  const batchId = ++db.counters.production_batches

  // Deduct consumed ingredients from stock
  for (const item of ingredients) {
    const ingName = (item.name || '').trim().toLowerCase()
    const usedQty = Number(item.quantity || 0)
    if (!ingName || usedQty <= 0) continue
    const targetIng = db.ingredients.find(i => (i.name || '').toLowerCase() === ingName)
    if (targetIng) {
      targetIng.quantity = Math.max(0, Number((Number(targetIng.quantity || 0) - usedQty).toFixed(3)))
      targetIng.updated_at = new Date().toISOString()
    }
  }

  const batch = {
    id: batchId,
    recipe_name: cleanName,
    recipe_id,
    ingredients,
    status: 'Preparing',
    started_at: new Date().toISOString(),
    completed_at: null,
    produced_quantity: 0
  }

  db.production_batches.push(batch)
  await persist()
  return batch
}

export async function completeProductionBatch(batch_id, { produced_quantity, selling_price = 0 }) {
  if (!db) await openLocalDb()
  const batch = db.production_batches.find(b => String(b.id) === String(batch_id))
  if (!batch) return null

  const prodQty = Math.max(1, Number(produced_quantity || 1))
  const sprice = Number(selling_price || 0)

  batch.status = 'Completed'
  batch.completed_at = new Date().toISOString()
  batch.produced_quantity = prodQty

  // Add produced quantity to Packed Items (products)
  const prodName = batch.recipe_name.trim()
  let product = db.products.find(p => (p.name || '').toLowerCase() === prodName.toLowerCase())

  if (product) {
    product.quantity = Number(((Number(product.quantity || 0)) + prodQty).toFixed(2))
    if (sprice > 0) {
      product.selling_price = sprice
      product.price = sprice
    }
  } else {
    product = {
      id: ++db.counters.products,
      name: prodName,
      selling_price: sprice,
      price: sprice,
      quantity: prodQty
    }
    db.products.push(product)
  }

  await persist()
  return { batch, product }
}

export async function cancelProductionBatch(batch_id) {
  if (!db) await openLocalDb()
  const batch = db.production_batches.find(b => String(b.id) === String(batch_id))
  if (!batch || batch.status !== 'Preparing') return null

  // Restore ingredients
  for (const item of (batch.ingredients || [])) {
    const ingName = (item.name || '').trim().toLowerCase()
    const usedQty = Number(item.quantity || 0)
    if (!ingName || usedQty <= 0) continue
    const targetIng = db.ingredients.find(i => (i.name || '').toLowerCase() === ingName)
    if (targetIng) {
      targetIng.quantity = Number(((Number(targetIng.quantity || 0)) + usedQty).toFixed(3))
      targetIng.updated_at = new Date().toISOString()
    }
  }

  batch.status = 'Cancelled'
  await persist()
  return batch
}

export async function saveRecipe({ id, name, ingredients = [] }) {
  if (!db) await openLocalDb()
  const cleanName = (name || '').trim()
  if (!cleanName) return null

  let recipe
  if (id) {
    recipe = db.recipes.find(r => String(r.id) === String(id))
    if (recipe) {
      recipe.name = cleanName
      recipe.ingredients = ingredients
      recipe.updated_at = new Date().toISOString()
    }
  }

  if (!recipe) {
    recipe = {
      id: ++db.counters.recipes,
      name: cleanName,
      ingredients,
      created_at: new Date().toISOString()
    }
    db.recipes.push(recipe)
  }

  await persist()
  return recipe
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
