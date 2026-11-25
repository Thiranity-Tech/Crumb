import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, configured } from './supabase'
import {
  openLocalDb,
  query,
  execute,
  backup,
  updateRecord,
  deleteRecord,
  startProductionBatch,
  completeProductionBatch,
  cancelProductionBatch,
  saveRecipe
} from './local-db'
import { printBill, saveBillPdf } from './printService'
import logoImg from './assets/logo.jpg'
import './styles.css'

const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = d => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
const Empty = ({ children }) => <div className="empty">{children}</div>

function Login() {
  const [e, setE] = useState('')
  const [p, setP] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  async function go(x) {
    x.preventDefault()
    setLoading(true)
    setNote('')
    const cleanEmail = e.trim().toLowerCase()
    let { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: p })
    if (error) setNote(error.message)
    setLoading(false)
  }

  return (
    <main className="auth">
      <div className="authbox">
        <img src={logoImg} alt="Crumb ERP Logo" className="authLogo" />
        <h1>Crumb & Co. ERP</h1>
        <p>Internet is needed only to verify your assigned login and access period. All ERP data stays on this computer.</p>
        <form onSubmit={go}>
          <input
            type="email"
            value={e}
            onChange={x => setE(x.target.value)}
            placeholder="Email address"
            required
          />
          <input
            type="password"
            value={p}
            onChange={x => setP(x.target.value)}
            placeholder="Password"
            required
          />
          <button disabled={loading}>{loading ? 'Verifying access…' : 'Sign in'}</button>
        </form>
        {note && <small style={{ color: '#e85968', display: 'block', marginTop: '10px' }}>{note}</small>}
      </div>
    </main>
  )
}

function Table({ headers, rows }) {
  return (
    <section className="tablecard">
      <table>
        <thead>
          <tr>{headers.map(x => <th key={x}>{x}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((x, j) => <td key={j}>{x}</td>)}
              </tr>
            ))
          ) : (
            <tr><td colSpan={headers.length}><Empty>No records yet.</Empty></td></tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function Admin() {
  const [bs, setBs] = useState([])
  const [w, setW] = useState({ businessName: '', email: '', password: '', accessDays: '30' })
  const [durations, setDurations] = useState({})
  const [customDates, setCustomDates] = useState({})
  const [note, setNote] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  const isDesktop = typeof window !== 'undefined' && window.location.protocol === 'file:'
  const [apiBaseUrl, setApiBaseUrl] = useState(() => {
    return (import.meta.env.VITE_API_BASE_URL || localStorage.getItem('crumb-api-base-url') || '').trim()
  })

  function getApiEndpoint(path) {
    const base = (apiBaseUrl || '').trim().replace(/\/+$/, '')
    if (base) return `${base}${path}`
    return path
  }

  async function load() {
    let { data, error } = await supabase.rpc('get_platform_businesses')
    if (error) setNote(error.message)
    else setBs(data || [])
  }

  useEffect(() => { load() }, [])

  async function send(e) {
    e.preventDefault()
    setNote('')
    const endpoint = getApiEndpoint('/api/create-user')

    if (isDesktop && !apiBaseUrl.trim() && endpoint.startsWith('/')) {
      setNote('Please enter your deployed Vercel URL below so the desktop app can connect to your workspace creation API.')
      return
    }

    try {
      let { data: { session } } = await supabase.auth.getSession()
      let r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          ...w,
          email: w.email.trim().toLowerCase(),
          role: 'owner',
          action: 'workspace'
        })
      })
      let out = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(out.error || `Server responded with status ${r.status}`)
      }
      setNote(out.message || 'Workspace created successfully!')
      setW({ businessName: '', email: '', password: '', accessDays: '30' })
      load()
    } catch (err) {
      setNote(`Creation failed: ${err.message}`)
    }
  }

  async function handleUpdateAccess(b) {
    const sel = durations[b.business_id] || '30'
    const custom = customDates[b.business_id]
    setUpdatingId(b.business_id)
    setNote('')

    let newEndsAt
    if (sel === 'custom') {
      if (!custom) {
        setNote('Please select a custom expiration date.')
        setUpdatingId(null)
        return
      }
      newEndsAt = new Date(custom + 'T23:59:59').toISOString()
    } else {
      const days = Number(sel)
      const base = b.access_ends_at && new Date(b.access_ends_at) > new Date()
        ? new Date(b.access_ends_at).getTime()
        : Date.now()
      newEndsAt = new Date(base + days * 86400000).toISOString()
    }

    try {
      let { error: rpcErr } = await supabase.rpc('update_workspace_access', {
        target_business_id: b.business_id,
        new_access_ends_at: newEndsAt
      })

      if (rpcErr) {
        let { error: directErr } = await supabase
          .from('businesses')
          .update({ access_ends_at: newEndsAt })
          .eq('id', b.business_id)

        if (directErr) {
          const endpoint = getApiEndpoint('/api/create-user')
          const { data: { session } } = await supabase.auth.getSession()
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({
              action: 'update-access',
              businessId: b.business_id,
              accessEndsAt: newEndsAt
            })
          })
          const out = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(out.error || 'Failed to update access duration')
        }
      }

      setNote(`Access for "${b.business_name}" updated until ${fmt(newEndsAt)}.`)
      await load()
    } catch (err) {
      setNote(err.message || 'Error updating access.')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <main>
      <div className="heading">
        <div>
          <h1>Platform administrator</h1>
          <p>Login, workspace and duration control only. Client operational data is local.</p>
        </div>
        <button className="adminSignout" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>

      {isDesktop && (
        <section className="formcard" style={{ marginBottom: '16px', background: '#f5f3ff', borderColor: '#c4b5fd' }}>
          <h2 style={{ color: '#4c1d95', fontSize: '14px', marginBottom: '4px' }}>🔗 Vercel Backend API URL</h2>
          <p style={{ color: '#6d28d9', fontSize: '12px', margin: '0 0 10px' }}>
            Enter your deployed Vercel URL (e.g. <code>https://crumb-erp.vercel.app</code>) to allow this desktop EXE to provision workspaces.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              placeholder="https://your-project.vercel.app"
              value={apiBaseUrl}
              onChange={e => {
                const val = e.target.value.trim()
                setApiBaseUrl(val)
                localStorage.setItem('crumb-api-base-url', val)
              }}
              style={{ background: '#fff' }}
            />
          </div>
        </section>
      )}

      <section className="formcard">
        <h2>Create new restaurant workspace</h2>
        <form className="formgrid" onSubmit={send}>
          <input
            placeholder="Restaurant / bakery name"
            value={w.businessName}
            onChange={e => setW({ ...w, businessName: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder="Owner email"
            value={w.email}
            onChange={e => setW({ ...w, email: e.target.value })}
            required
          />
          <input
            type="password"
            minLength="6"
            placeholder="Owner temporary password"
            value={w.password}
            onChange={e => setW({ ...w, password: e.target.value })}
            required
          />
          <select value={w.accessDays} onChange={e => setW({ ...w, accessDays: e.target.value })}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">6 months</option>
            <option value="365">1 year</option>
          </select>
          <button>Create workspace & owner</button>
        </form>
        {note && <p className="note" style={{ marginTop: '10px' }}>{note}</p>}
      </section>

      <section className="tablecard">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Current Access</th>
              <th>Update Access in Workspace</th>
            </tr>
          </thead>
          <tbody>
            {bs.length ? (
              bs.map(x => {
                const isExpired = x.access_ends_at && new Date(x.access_ends_at) <= new Date()
                const sel = durations[x.business_id] || '30'
                return (
                  <tr key={x.business_id}>
                    <td><b>{x.business_name}</b></td>
                    <td>
                      {x.access_ends_at ? (
                        isExpired ? (
                          <span style={{ color: '#e85968', fontWeight: 600 }}>Expired ({fmt(x.access_ends_at)})</span>
                        ) : (
                          <span style={{ color: '#17a971', fontWeight: 600 }}>Active until {fmt(x.access_ends_at)}</span>
                        )
                      ) : (
                        <span style={{ color: '#718097' }}>No limit</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <select
                          value={sel}
                          onChange={e => setDurations({ ...durations, [x.business_id]: e.target.value })}
                        >
                          <option value="7">+7 days</option>
                          <option value="30">+30 days</option>
                          <option value="90">+90 days</option>
                          <option value="180">+6 months</option>
                          <option value="365">+1 year</option>
                          <option value="custom">Pick date…</option>
                        </select>
                        {sel === 'custom' && (
                          <input
                            type="date"
                            value={customDates[x.business_id] || ''}
                            onChange={e => setCustomDates({ ...customDates, [x.business_id]: e.target.value })}
                            required
                          />
                        )}
                        <button
                          className="tableActionBtn"
                          disabled={updatingId === x.business_id}
                          onClick={() => handleUpdateAccess(x)}
                        >
                          {updatingId === x.business_id ? 'Updating…' : (isExpired ? 'Renew access' : 'Extend access')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr><td colSpan={3}><Empty>No records yet.</Empty></td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}

function Restaurant({ business }) {
  const [data, setData] = useState({
    products: [],
    ingredients: [],
    recipes: [],
    production_batches: [],
    purchases: [],
    expenses: [],
    sales: [],
    items: []
  })
  const [view, setView] = useState('Dashboard')
  const [cart, setCart] = useState([])
  const [pass, setPass] = useState('')
  const [note, setNote] = useState('')

  const [inventoryTab, setInventoryTab] = useState('packed')
  const [editProd, setEditProd] = useState(null)
  const [editIng, setEditIng] = useState(null)
  const [editPurchase, setEditPurchase] = useState(null)
  const [editExpense, setEditExpense] = useState(null)
  const [receiptModal, setReceiptModal] = useState(null)
  const [autoPrint, setAutoPrint] = useState(false)

  // Production / Recipe state
  const [prodModal, setProdModal] = useState(null)
  const [recipeName, setRecipeName] = useState('')
  const [recipeIngredients, setRecipeIngredients] = useState([{ name: '', quantity: 1, unit: 'Kg' }])

  async function load() {
    let [products, ingredients, recipes, production_batches, purchases, expenses, sales, items] = await Promise.all([
      query('select * from products order by name'),
      query('select * from ingredients order by name'),
      query('select * from recipes order by name'),
      query('select * from production_batches order by started_at desc'),
      query('select * from purchases order by purchased_at desc'),
      query('select * from expenses order by expense_at desc'),
      query('select * from sales order by sold_at desc'),
      query('select * from sale_items')
    ])
    setData({ products, ingredients, recipes, production_batches, purchases, expenses, sales, items })
    setCart(prev => prev.filter(c => products.some(p => String(p.id) === String(c.id))))
  }

  useEffect(() => {
    openLocalDb().then(load)
  }, [])

  async function addProduct(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    await execute('insert into products(name,selling_price,quantity) values(?,?,?)', [
      f.get('name')?.toString().trim(),
      Number(f.get('price')) || 0,
      Number(f.get('quantity')) || 0
    ])
    e.target.reset()
    await load()
  }

  async function saveProductEdit(id) {
    if (!editProd || !editProd.name.trim()) return
    await updateRecord('products', id, {
      name: editProd.name.trim(),
      selling_price: Number(editProd.price) || 0,
      price: Number(editProd.price) || 0,
      quantity: Number(editProd.quantity) || 0
    })
    setEditProd(null)
    await load()
  }

  async function deleteProduct(id) {
    if (!window.confirm('Delete this product from inventory? It will also be removed from the billing menu.')) return
    await deleteRecord('products', id)
    setCart(prev => prev.filter(c => String(c.id) !== String(id)))
    if (editProd?.id === id) setEditProd(null)
    await load()
  }

  async function handleStartBatch(e) {
    if (e) e.preventDefault()
    const cleanName = recipeName.trim()
    if (!cleanName) {
      alert('Please enter a recipe / product name')
      return
    }
    const cleanIngredients = recipeIngredients.filter(i => (i.name || '').trim() && Number(i.quantity) > 0)
    if (!cleanIngredients.length) {
      alert('Please select at least one ingredient with a valid quantity.')
      return
    }

    await startProductionBatch({
      recipe_name: cleanName,
      ingredients: cleanIngredients
    })

    setRecipeName('')
    setRecipeIngredients([{ name: '', quantity: 1, unit: 'Kg' }])
    await load()
    setNote(`Batch "${cleanName}" started and marked as Preparing! Ingredients were consumed from stock.`)
  }

  async function handleSaveRecipeTemplate() {
    const cleanName = recipeName.trim()
    if (!cleanName) {
      alert('Please enter a recipe name to save.')
      return
    }
    const cleanIngredients = recipeIngredients.filter(i => (i.name || '').trim() && Number(i.quantity) > 0)
    await saveRecipe({
      name: cleanName,
      ingredients: cleanIngredients
    })
    await load()
    setNote(`Recipe template "${cleanName}" saved successfully.`)
  }

  async function handleCompleteBatch() {
    if (!prodModal) return
    const qty = Math.max(1, Number(prodModal.quantity) || 1)
    const price = Number(prodModal.price) || 0

    await completeProductionBatch(prodModal.batch.id, {
      produced_quantity: qty,
      selling_price: price
    })

    const name = prodModal.batch.recipe_name
    setProdModal(null)
    await load()
    setNote(`✓ Finished batch: "${name}" (+${qty} pieces) added to Packed Items and available in Billing!`)
  }

  async function handleCancelBatch(batchId) {
    if (!window.confirm('Cancel this preparation batch? The consumed ingredients will be restored back to stock.')) return
    await cancelProductionBatch(batchId)
    await load()
    setNote('Preparation batch cancelled. Consumed ingredients restored.')
  }

  async function addIngredient(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    const cost = Number(f.get('cost')) || 0
    await execute('insert into ingredients(name,quantity,unit,total_cost,updated_at) values(?,?,?,?,?)', [
      f.get('name')?.toString().trim(),
      Number(f.get('quantity')) || 0,
      f.get('unit') || 'Piece',
      cost,
      new Date().toISOString()
    ])
    e.target.reset()
    await load()
  }

  async function saveIngredientEdit(id) {
    if (!editIng || !editIng.name.trim()) return
    await updateRecord('ingredients', id, {
      name: editIng.name.trim(),
      quantity: Number(editIng.quantity) || 0,
      unit: editIng.unit || 'Piece',
      total_cost: Number(editIng.cost) || 0
    })
    setEditIng(null)
    await load()
  }

  async function deleteIngredient(id) {
    if (!window.confirm('Delete this ingredient from inventory?')) return
    await deleteRecord('ingredients', id)
    if (editIng?.id === id) setEditIng(null)
    await load()
  }

  async function addPurchase(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    await execute('insert into purchases(product_name,quantity,unit,total_cost,purchased_at) values(?,?,?,?,?)', [
      f.get('name')?.toString().trim(),
      Number(f.get('quantity')) || 1,
      f.get('unit') || 'Piece',
      Number(f.get('cost')) || 0,
      new Date().toISOString()
    ])
    e.target.reset()
    await load()
  }

  async function savePurchaseEdit(id) {
    if (!editPurchase || !editPurchase.product_name.trim()) return
    await updateRecord('purchases', id, {
      product_name: editPurchase.product_name.trim(),
      name: editPurchase.product_name.trim(),
      quantity: Number(editPurchase.quantity) || 1,
      unit: editPurchase.unit,
      total_cost: Number(editPurchase.cost) || 0,
      cost: Number(editPurchase.cost) || 0
    })
    setEditPurchase(null)
    await load()
  }

  async function deletePurchase(id) {
    if (!window.confirm('Delete this purchase record? Dashboard profit/loss and ingredient stock will update automatically.')) return
    await deleteRecord('purchases', id)
    if (editPurchase?.id === id) setEditPurchase(null)
    await load()
  }

  async function addExpense(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    await execute('insert into expenses(description,amount,expense_at) values(?,?,?)', [
      f.get('description')?.toString().trim(),
      Number(f.get('amount')) || 0,
      new Date().toISOString()
    ])
    e.target.reset()
    await load()
  }

  async function saveExpenseEdit(id) {
    if (!editExpense || !editExpense.description.trim()) return
    await updateRecord('expenses', id, {
      description: editExpense.description.trim(),
      amount: Number(editExpense.amount) || 0
    })
    setEditExpense(null)
    await load()
  }

  async function deleteExpense(id) {
    if (!window.confirm('Delete this expense record? Dashboard profit/loss will update automatically.')) return
    await deleteRecord('expenses', id)
    if (editExpense?.id === id) setEditExpense(null)
    await load()
  }

  const add = p => {
    const sp = Number(p.selling_price != null ? p.selling_price : (p.price != null ? p.price : 0))
    let x = cart.find(i => String(i.id) === String(p.id))
    setCart(x
      ? cart.map(i => String(i.id) === String(p.id) ? { ...i, quantity: i.quantity + 1, selling_price: sp, price: sp } : i)
      : [...cart, { ...p, selling_price: sp, price: sp, quantity: 1 }]
    )
  }

  async function bill() {
    if (!cart.length) return
    const custEl = document.querySelector('#customer')
    const phoneEl = document.querySelector('#phone')
    const payEl = document.querySelector('#pay')
    const custName = custEl?.value?.trim() || ''
    const custPhone = phoneEl?.value?.trim() || ''
    const payMethod = payEl?.value || 'Cash'
    const total = cart.reduce((a, x) => a + x.quantity * (x.selling_price ?? x.price ?? 0), 0)
    const saleDate = new Date().toISOString()
    await execute('insert into sales(customer_name,customer_phone,payment_method,subtotal,total,sold_at) values(?,?,?,?,?,?)', [
      custName,
      custPhone,
      payMethod,
      total,
      total,
      saleDate
    ])
    const s = (await query('select last_insert_rowid() as id'))[0]
    const billItems = []
    for (let x of cart) {
      const uPrice = x.selling_price ?? x.price ?? 0
      await execute('insert into sale_items(sale_id,product_name,unit_price,quantity) values(?,?,?,?)', [
        s.id,
        x.name,
        uPrice,
        x.quantity
      ])
      billItems.push({
        name: x.name,
        quantity: x.quantity,
        price: uPrice,
        total: x.quantity * uPrice
      })
      // Deduct sold quantity from Packed Item stock
      const prod = data.products.find(p => String(p.id) === String(x.id))
      if (prod) {
        const remaining = Math.max(0, (Number(prod.quantity) || 0) - x.quantity)
        await updateRecord('products', prod.id, { quantity: remaining })
      }
    }

    const completedInvoice = {
      id: s.id,
      customer_name: custName,
      customer_phone: custPhone,
      payment_method: payMethod,
      subtotal: total,
      total: total,
      sold_at: saleDate,
      items: billItems
    }

    setCart([])
    if (custEl) custEl.value = ''
    if (phoneEl) phoneEl.value = ''
    await load()

    if (autoPrint) {
      await printBill(completedInvoice, { name: business.name })
    }
    setReceiptModal(completedInvoice)
  }

  async function change(e) {
    e.preventDefault()
    let { error } = await supabase.auth.updateUser({ password: pass })
    setNote(error?.message || 'Password updated.')
    if (!error) setPass('')
  }

  async function doBackup() {
    let result = await backup()
    setNote(result ? `Backup saved: ${result}` : 'Backups are available in the Windows desktop app.')
  }

  let revenue = data.sales.reduce((a, x) => a + Number(x.total || 0), 0)
  let expense = data.expenses.reduce((a, x) => a + Number(x.amount || 0), 0)
  let purchase = data.purchases.reduce((a, x) => a + Number(x.total_cost != null ? x.total_cost : (x.cost != null ? x.cost : 0)), 0)
  let profitLoss = revenue - purchase - expense
  let sold = data.items.reduce((a, x) => a + Number(x.quantity || 0), 0)

  let Layout = ({ title, children }) => (
    <>
      <div className="heading">
        <div>
          <h1>{title}</h1>
          <p>{business.name} · {fmt(new Date())}</p>
        </div>
      </div>
      {children}
    </>
  )

  let Form = ({ title, children, onSubmit }) => (
    <section className="formcard">
      <h2>{title}</h2>
      <form className="formgrid" onSubmit={onSubmit}>
        {children}
        <button>Save</button>
      </form>
    </section>
  )

  const pages = {
    Dashboard: () => (
      <Layout title="Dashboard">
        <div className="metrics">
          <div className="metric">
            <small>PRODUCTS SOLD</small>
            <strong>{sold}</strong>
            <span>items in completed bills</span>
          </div>
          <div className="metric">
            <small>SALES REVENUE</small>
            <strong>{money(revenue)}</strong>
            <span>sum of completed bills</span>
          </div>
          <div className="metric">
            <small>PROFIT / LOSS</small>
            <strong style={{ color: profitLoss >= 0 ? '#1ba471' : '#e85968' }}>
              {profitLoss >= 0 ? money(profitLoss) : `− ${money(Math.abs(profitLoss))}`}
            </strong>
            <span style={{ color: profitLoss >= 0 ? '#1ba471' : '#e85968' }}>
              sales revenue − purchases − expenses
            </span>
          </div>
          <div className="metric">
            <small>EXPENSES</small>
            <strong>{money(expense)}</strong>
            <span>from expense records</span>
          </div>
        </div>
        <div className="two">
          <section>
            <h2>Menu products</h2>
            {data.products.slice(0, 5).map(x => (
              <div className="row" key={x.id}>
                <b>{x.name}</b>
                <span>{money(x.selling_price ?? x.price)}</span>
              </div>
            ))}
            {!data.products.length && <Empty>No products yet.</Empty>}
          </section>
          <section>
            <h2>Recent sales</h2>
            {data.sales.slice(0, 5).map(x => (
              <div className="row" key={x.id}>
                <b>Bill #{x.id}</b>
                <span>{money(x.total)}</span>
              </div>
            ))}
            {!data.sales.length && <Empty>No bills yet.</Empty>}
          </section>
        </div>
      </Layout>
    ),
    'Billing / POS': () => {
      let total = cart.reduce((a, x) => a + x.quantity * (x.selling_price ?? x.price ?? 0), 0)
      return (
        <Layout title="Billing / POS">
          <div className="pos">
            <section>
              <div className="products">
                {data.products.map(p => (
                  <button className="prod" onClick={() => add(p)} key={p.id}>
                    <b>{p.name}</b>
                    <small>Menu item</small>
                    <span className={`prodStock ${Number(p.quantity || 0) > 0 ? 'in' : 'out'}`}>
                      {Number(p.quantity || 0) > 0 ? `${p.quantity} in stock` : '0 in stock'}
                    </span>
                    <strong>{money(p.selling_price ?? p.price)}</strong>
                  </button>
                ))}
                {!data.products.length && <Empty>Add products in Inventory to start billing.</Empty>}
              </div>
            </section>
            <section className="cart">
              <h2>Cart ({cart.reduce((a, x) => a + x.quantity, 0)} items)</h2>
              {cart.map(x => (
                <div className="cartrow" key={x.id}>
                  <div>
                    <b>{x.name}</b>
                    <small>{money(x.selling_price ?? x.price)} each</small>
                  </div>
                  <div>
                    <button onClick={() => setCart(cart.map(i => i.id === x.id ? { ...i, quantity: i.quantity - 1 } : i).filter(i => i.quantity))}>−</button>
                    {x.quantity}
                    <button onClick={() => add(x)}>+</button>
                    <b>{money(x.quantity * (x.selling_price ?? x.price ?? 0))}</b>
                  </div>
                </div>
              ))}
              {!cart.length && <Empty>Click products to add to cart.</Empty>}
              <div className="formgrid" style={{ marginTop: '12px' }}>
                <input id="customer" placeholder="Customer (optional)" />
                <input id="phone" placeholder="Phone (optional)" />
                <select id="pay">
                  <option>Cash</option>
                  <option>UPI</option>
                  <option>Card</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#718097', marginTop: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoPrint}
                  onChange={e => setAutoPrint(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Auto-print bill receipt
              </label>
              <div className="total">
                <span>Total</span>
                <b>{money(total)}</b>
              </div>
              <button onClick={bill} disabled={!cart.length}>Complete sale · {money(total)}</button>
            </section>
          </div>
        </Layout>
      )
    },
    Inventory: () => (
      <Layout title="Inventory">
        <div className="inventoryTabs">
          <button
            type="button"
            className={`inventoryTabBtn ${inventoryTab === 'packed' ? 'active' : ''}`}
            onClick={() => setInventoryTab('packed')}
          >
            📦 Packed Items ({data.products.length})
          </button>
          <button
            type="button"
            className={`inventoryTabBtn ${inventoryTab === 'ingredients' ? 'active' : ''}`}
            onClick={() => setInventoryTab('ingredients')}
          >
            🌾 Ingredients & Raw Materials ({data.ingredients.length})
          </button>
        </div>

        {inventoryTab === 'packed' ? (
          <>
            <Form title="Add packed item (Menu)" onSubmit={addProduct}>
              <input name="name" placeholder="Item name (e.g. Butter Croissant)" required />
              <input name="quantity" type="number" min="0" step="1" placeholder="Initial stock quantity (default 0)" />
              <input name="price" type="number" min="0" step="any" placeholder="Selling price ₹" required />
            </Form>
            <section className="tablecard">
              <table>
                <thead>
                  <tr>
                    <th>Packed Item (Menu)</th>
                    <th>In-Stock Quantity</th>
                    <th>Selling price</th>
                    <th style={{ width: '180px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.length ? (
                    data.products.map(p => {
                      const isEditing = editProd?.id === p.id
                      return (
                        <tr key={p.id}>
                          <td>
                            {isEditing ? (
                              <input
                                value={editProd.name}
                                onChange={e => setEditProd({ ...editProd, name: e.target.value })}
                                placeholder="Item name"
                                required
                              />
                            ) : (
                              <b>{p.name}</b>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={editProd.quantity ?? 0}
                                onChange={e => setEditProd({ ...editProd, quantity: e.target.value })}
                                style={{ width: '80px' }}
                              />
                            ) : (
                              <span className={Number(p.quantity || 0) <= 0 ? 'stockOut' : 'stockIn'}>
                                {p.quantity || 0} Pieces
                              </span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={editProd.price}
                                onChange={e => setEditProd({ ...editProd, price: e.target.value })}
                                placeholder="Selling price ₹"
                                style={{ width: '110px' }}
                                required
                              />
                            ) : (
                              money(p.selling_price ?? p.price)
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <>
                                <button className="btnSave" onClick={() => saveProductEdit(p.id)}>Save</button>
                                <button className="btnCancel" onClick={() => setEditProd(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btnEdit"
                                  onClick={() => setEditProd({
                                    id: p.id,
                                    name: p.name,
                                    price: p.selling_price ?? p.price ?? 0,
                                    quantity: p.quantity || 0
                                  })}
                                >
                                  Edit
                                </button>
                                <button className="btnDelete" onClick={() => deleteProduct(p.id)}>Delete</button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr><td colSpan={4}><Empty>No packed items yet. Add sellable menu products above.</Empty></td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        ) : (
          <>
            <div className="inventoryInfoBanner">
              <span>💡</span>
              <div>
                <b>Automated Sync with Product Purchase:</b> All items purchased under <b>Product Purchase</b> are automatically stored and stock-updated here. You can also manually add or adjust ingredient stock below.
              </div>
            </div>
            <Form title="Add ingredient / raw material" onSubmit={addIngredient}>
              <input name="name" placeholder="Ingredient name (e.g. Flour, Butter, Yeast)" required />
              <input name="quantity" type="number" min="0" step="any" placeholder="Initial stock quantity" required />
              <select name="unit">
                <option>Piece</option>
                <option>Kg</option>
                <option>Gram</option>
                <option>Litre</option>
                <option>Box</option>
                <option>Pack</option>
              </select>
              <input name="cost" type="number" min="0" step="any" placeholder="Estimated / total cost ₹" />
            </Form>
            <section className="tablecard">
              <table>
                <thead>
                  <tr>
                    <th>Ingredient / Raw Material</th>
                    <th>In-Stock Quantity</th>
                    <th>Unit</th>
                    <th>Total Value / Cost</th>
                    <th>Last Updated</th>
                    <th style={{ width: '180px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ingredients.length ? (
                    data.ingredients.map(ing => {
                      const isEditing = editIng?.id === ing.id
                      const qty = Number(ing.quantity || 0)
                      return (
                        <tr key={ing.id}>
                          <td>
                            {isEditing ? (
                              <input
                                value={editIng.name}
                                onChange={e => setEditIng({ ...editIng, name: e.target.value })}
                                placeholder="Ingredient name"
                                required
                              />
                            ) : (
                              <b>{ing.name}</b>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={editIng.quantity}
                                onChange={e => setEditIng({ ...editIng, quantity: e.target.value })}
                                style={{ width: '90px' }}
                                required
                              />
                            ) : (
                              <span className={qty <= 0 ? 'stockOut' : (qty < 5 ? 'stockLow' : 'stockIn')}>
                                {qty}
                              </span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <select
                                value={editIng.unit}
                                onChange={e => setEditIng({ ...editIng, unit: e.target.value })}
                                style={{ width: '100px' }}
                              >
                                <option>Piece</option>
                                <option>Kg</option>
                                <option>Gram</option>
                                <option>Litre</option>
                                <option>Box</option>
                                <option>Pack</option>
                              </select>
                            ) : (
                              <span className="unitBadge">{ing.unit || 'Piece'}</span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={editIng.cost}
                                onChange={e => setEditIng({ ...editIng, cost: e.target.value })}
                                style={{ width: '110px' }}
                              />
                            ) : (
                              money(ing.total_cost || 0)
                            )}
                          </td>
                          <td>{fmt(ing.updated_at)}</td>
                          <td>
                            {isEditing ? (
                              <>
                                <button className="btnSave" onClick={() => saveIngredientEdit(ing.id)}>Save</button>
                                <button className="btnCancel" onClick={() => setEditIng(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btnEdit"
                                  onClick={() => setEditIng({
                                    id: ing.id,
                                    name: ing.name,
                                    quantity: ing.quantity,
                                    unit: ing.unit || 'Piece',
                                    cost: ing.total_cost || 0
                                  })}
                                >
                                  Edit
                                </button>
                                <button className="btnDelete" onClick={() => deleteIngredient(ing.id)}>Delete</button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr><td colSpan={6}><Empty>No ingredients recorded yet. Purchases in "Product Purchase" will automatically appear here.</Empty></td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </Layout>
    ),
    'Kitchen / Production': () => {
      const activeBatches = data.production_batches.filter(b => b.status === 'Preparing')
      const completedBatches = data.production_batches.filter(b => b.status !== 'Preparing')

      return (
        <Layout title="Kitchen / Production">
          {/* Section 1: Active Batches being prepared */}
          <section style={{ marginBottom: '20px' }}>
            <h2>🍳 Active Batches (Currently Preparing)</h2>
            <p style={{ color: '#718097', fontSize: '13px', margin: '-8px 0 16px' }}>
              Batches in oven / kitchen. When finished baking or preparing, click <b>Mark as Done</b> to specify produced units and transfer to Packed Items for Billing.
            </p>
            {activeBatches.length ? (
              <div className="batchGrid">
                {activeBatches.map(b => (
                  <div className="batchCard" key={b.id}>
                    <div className="batchHeader">
                      <div>
                        <h3 className="batchTitle">{b.recipe_name}</h3>
                        <span className="batchTime">Started: {fmt(b.started_at)}</span>
                      </div>
                      <span className="statusPreparing">⏳ Preparing</span>
                    </div>

                    <div className="batchIngredients">
                      <small>Ingredients Consumed:</small>
                      {b.ingredients && b.ingredients.length ? (
                        b.ingredients.map((ing, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>• {ing.name}</span>
                            <b>{ing.quantity} {ing.unit || ''}</b>
                          </div>
                        ))
                      ) : (
                        <span>No ingredients specified</span>
                      )}
                    </div>

                    <div className="batchActions">
                      <button
                        className="btnDoneBatch"
                        onClick={() => {
                          const existing = data.products.find(p => (p.name || '').toLowerCase() === (b.recipe_name || '').toLowerCase())
                          setProdModal({
                            batch: b,
                            quantity: 1,
                            price: existing ? (existing.selling_price ?? existing.price ?? '') : ''
                          })
                        }}
                      >
                        ✓ Mark as Done
                      </button>
                      <button
                        className="btnCancelBatch"
                        onClick={() => handleCancelBatch(b.id)}
                        title="Cancel batch and restore ingredients"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No active batches currently preparing. Build a recipe process below to start cooking.</Empty>
            )}
          </section>

          {/* Section 2: Recipe / Process Builder */}
          <section className="formcard" style={{ maxWidth: '100%', marginBottom: '20px' }}>
            <h2>📝 Recipe & Process Builder</h2>
            <p style={{ color: '#718097', fontSize: '13px', margin: '-8px 0 16px' }}>
              Select raw ingredients from Inventory, specify quantities, and start preparation. The consumed ingredients will be automatically deducted from your stock.
            </p>

            {data.recipes.length > 0 && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Load Saved Recipe Template:</span>
                <select
                  style={{ width: 'auto', flex: 1, maxWidth: '280px' }}
                  onChange={e => {
                    const r = data.recipes.find(x => String(x.id) === e.target.value)
                    if (r) {
                      setRecipeName(r.name)
                      if (r.ingredients && r.ingredients.length) {
                        setRecipeIngredients(r.ingredients.map(i => ({ ...i })))
                      }
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>-- Select a saved recipe --</option>
                  {data.recipes.map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.ingredients?.length || 0} ingredients)</option>
                  ))}
                </select>
              </div>
            )}

            <form onSubmit={handleStartBatch}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  Product / Recipe Name:
                </label>
                <input
                  value={recipeName}
                  onChange={e => setRecipeName(e.target.value)}
                  placeholder="e.g. Butter Croissant, Sourdough Loaf, Chocolate Muffin"
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                  Ingredients from Inventory:
                </label>
                {recipeIngredients.map((row, index) => {
                  return (
                    <div className="recipeRow" key={index}>
                      <select
                        value={row.name}
                        onChange={e => {
                          const val = e.target.value
                          const targetIng = data.ingredients.find(i => i.name === val)
                          const updated = [...recipeIngredients]
                          updated[index] = {
                            ...updated[index],
                            name: val,
                            unit: targetIng?.unit || updated[index].unit
                          }
                          setRecipeIngredients(updated)
                        }}
                        required
                        style={{ flex: 2 }}
                      >
                        <option value="" disabled>-- Choose ingredient --</option>
                        {data.ingredients.map(ing => (
                          <option key={ing.id} value={ing.name}>
                            {ing.name} ({ing.quantity} {ing.unit || 'Piece'} in stock)
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        placeholder="Quantity"
                        value={row.quantity}
                        onChange={e => {
                          const updated = [...recipeIngredients]
                          updated[index] = { ...updated[index], quantity: e.target.value }
                          setRecipeIngredients(updated)
                        }}
                        style={{ width: '100px' }}
                        required
                      />

                      <select
                        value={row.unit}
                        onChange={e => {
                          const updated = [...recipeIngredients]
                          updated[index] = { ...updated[index], unit: e.target.value }
                          setRecipeIngredients(updated)
                        }}
                        style={{ width: '100px' }}
                      >
                        <option>Piece</option>
                        <option>Kg</option>
                        <option>Gram</option>
                        <option>Litre</option>
                        <option>Box</option>
                        <option>Pack</option>
                      </select>

                      {recipeIngredients.length > 1 && (
                        <button
                          type="button"
                          className="btnDelete"
                          onClick={() => setRecipeIngredients(recipeIngredients.filter((_, i) => i !== index))}
                          style={{ padding: '8px 12px' }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )
                })}

                <button
                  type="button"
                  onClick={() => setRecipeIngredients([...recipeIngredients, { name: '', quantity: 1, unit: 'Kg' }])}
                  style={{
                    background: '#f1f5f9',
                    color: '#475569',
                    border: '1px dashed #cbd5e1',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: '6px'
                  }}
                >
                  + Add Ingredient
                </button>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button
                  type="submit"
                  style={{ background: '#6856d8', color: '#fff', border: 0, padding: '12px 20px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                >
                  🍳 Start Preparing (Mark Batch as Preparing)
                </button>
                <button
                  type="button"
                  onClick={handleSaveRecipeTemplate}
                  style={{ background: '#f8fafc', border: '1px solid #dce2eb', color: '#475569', padding: '12px 16px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                >
                  💾 Save as Recipe Template
                </button>
              </div>
            </form>
          </section>

          {/* Section 3: Completed Production Batches */}
          <section className="tablecard">
            <h2 style={{ padding: '16px 18px 0', margin: 0, fontSize: '16px' }}>📋 Production History</h2>
            <table>
              <thead>
                <tr>
                  <th>Completed Date</th>
                  <th>Product</th>
                  <th>Produced Quantity</th>
                  <th>Ingredients Used</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {completedBatches.length ? (
                  completedBatches.map(b => (
                    <tr key={b.id}>
                      <td>{fmt(b.completed_at || b.started_at)}</td>
                      <td><b>{b.recipe_name}</b></td>
                      <td>
                        <b style={{ color: '#15803d' }}>+{b.produced_quantity || 0} Pieces</b>
                      </td>
                      <td>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          {(b.ingredients || []).map(i => `${i.quantity} ${i.unit || ''} ${i.name}`).join(', ') || '—'}
                        </span>
                      </td>
                      <td>
                        <span className={b.status === 'Completed' ? 'statusCompleted' : 'statusCancelled'}>
                          {b.status === 'Completed' ? '✓ Added to Packed Items' : 'Cancelled'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5}><Empty>No completed production batches yet.</Empty></td></tr>
                )}
              </tbody>
            </table>
          </section>
        </Layout>
      )
    },
    'Product Purchase': () => (
      <Layout title="Product Purchase">
        <Form title="Record product purchase (Stores in Ingredients)" onSubmit={addPurchase}>
          <input
            name="name"
            list="ingredient-suggestions"
            placeholder="Purchased product / ingredient name"
            required
          />
          <datalist id="ingredient-suggestions">
            {data.ingredients.map(ing => (
              <option key={ing.id} value={ing.name} />
            ))}
          </datalist>
          <input name="quantity" type="number" min="0.001" step="any" placeholder="Quantity" required />
          <select name="unit">
            <option>Piece</option>
            <option>Kg</option>
            <option>Gram</option>
            <option>Litre</option>
            <option>Box</option>
            <option>Pack</option>
          </select>
          <input name="cost" type="number" min="0" step="any" placeholder="Total cost ₹" required />
        </Form>
        <section className="tablecard">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Product / Ingredient</th>
                <th>Quantity</th>
                <th>Cost</th>
                <th style={{ width: '180px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.purchases.length ? (
                data.purchases.map(pu => {
                  const isEditing = editPurchase?.id === pu.id
                  return (
                    <tr key={pu.id}>
                      <td>{fmt(pu.purchased_at || pu.date)}</td>
                      <td>
                        {isEditing ? (
                          <input
                            value={editPurchase.product_name}
                            onChange={e => setEditPurchase({ ...editPurchase, product_name: e.target.value })}
                            placeholder="Product name"
                            required
                          />
                        ) : (
                          pu.product_name || pu.name || '—'
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input
                              type="number"
                              min="0.001"
                              step="any"
                              value={editPurchase.quantity}
                              onChange={e => setEditPurchase({ ...editPurchase, quantity: e.target.value })}
                              style={{ width: '80px' }}
                              required
                            />
                            <select
                              value={editPurchase.unit}
                              onChange={e => setEditPurchase({ ...editPurchase, unit: e.target.value })}
                            >
                              <option>Piece</option>
                              <option>Kg</option>
                              <option>Gram</option>
                              <option>Litre</option>
                              <option>Box</option>
                              <option>Pack</option>
                            </select>
                          </div>
                        ) : (
                          `${pu.quantity || 1} ${pu.unit || 'Piece'}`
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editPurchase.cost}
                            onChange={e => setEditPurchase({ ...editPurchase, cost: e.target.value })}
                            style={{ width: '110px' }}
                            required
                          />
                        ) : (
                          money(pu.total_cost ?? pu.cost ?? 0)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <>
                            <button className="btnSave" onClick={() => savePurchaseEdit(pu.id)}>Save</button>
                            <button className="btnCancel" onClick={() => setEditPurchase(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btnEdit"
                              onClick={() => setEditPurchase({
                                id: pu.id,
                                product_name: pu.product_name || pu.name || '',
                                quantity: pu.quantity || 1,
                                unit: pu.unit || 'Piece',
                                cost: pu.total_cost ?? pu.cost ?? 0
                              })}
                            >
                              Edit
                            </button>
                            <button className="btnDelete" onClick={() => deletePurchase(pu.id)}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={5}><Empty>No purchase records yet.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </section>
      </Layout>
    ),
    Expenses: () => (
      <Layout title="Expenses">
        <Form title="Add expense" onSubmit={addExpense}>
          <input name="description" placeholder="Expense description" required />
          <input name="amount" type="number" min="0" step="any" placeholder="Amount ₹" required />
        </Form>
        <section className="tablecard">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Expense</th>
                <th>Amount</th>
                <th style={{ width: '180px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.length ? (
                data.expenses.map(ex => {
                  const isEditing = editExpense?.id === ex.id
                  return (
                    <tr key={ex.id}>
                      <td>{fmt(ex.expense_at || ex.date)}</td>
                      <td>
                        {isEditing ? (
                          <input
                            value={editExpense.description}
                            onChange={e => setEditExpense({ ...editExpense, description: e.target.value })}
                            placeholder="Expense description"
                            required
                          />
                        ) : (
                          ex.description || '—'
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editExpense.amount}
                            onChange={e => setEditExpense({ ...editExpense, amount: e.target.value })}
                            style={{ width: '110px' }}
                            required
                          />
                        ) : (
                          money(ex.amount)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <>
                            <button className="btnSave" onClick={() => saveExpenseEdit(ex.id)}>Save</button>
                            <button className="btnCancel" onClick={() => setEditExpense(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btnEdit"
                              onClick={() => setEditExpense({
                                id: ex.id,
                                description: ex.description || '',
                                amount: ex.amount || 0
                              })}
                            >
                              Edit
                            </button>
                            <button className="btnDelete" onClick={() => deleteExpense(ex.id)}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={4}><Empty>No expenses recorded yet.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </section>
      </Layout>
    ),
    'Sales & Customers': () => {
      return (
        <Layout title="Sales & Customers">
          <section className="tablecard">
            <table>
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th style={{ width: '160px' }}>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.length ? (
                  data.sales.map(x => {
                    const saleItems = data.items
                      .filter(i => String(i.sale_id) === String(x.id))
                      .map(i => ({
                        name: i.product_name,
                        quantity: Number(i.quantity) || 1,
                        price: Number(i.unit_price) || 0,
                        total: (Number(i.quantity) || 1) * (Number(i.unit_price) || 0)
                      }))
                    const invObj = {
                      id: x.id,
                      customer_name: x.customer_name,
                      customer_phone: x.customer_phone,
                      payment_method: x.payment_method,
                      subtotal: x.subtotal || x.total,
                      total: x.total,
                      sold_at: x.sold_at,
                      items: saleItems
                    }
                    const totalQty = saleItems.reduce((a, i) => a + i.quantity, 0)
                    return (
                      <tr key={x.id}>
                        <td><b>#{x.id}</b></td>
                        <td>{fmt(x.sold_at)}</td>
                        <td>{x.customer_name || 'Walk-in'}</td>
                        <td>{totalQty}</td>
                        <td>{x.payment_method || 'Cash'}</td>
                        <td><b>{money(x.total)}</b></td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="btnPrint"
                              onClick={() => printBill(invObj, { name: business.name })}
                              title="Print thermal bill"
                            >
                              🖨️ Print
                            </button>
                            <button
                              className="btnPdf"
                              onClick={async () => {
                                const saved = await saveBillPdf(invObj, { name: business.name })
                                if (saved && saved !== 'printed') setNote(`Bill PDF saved: ${saved}`)
                              }}
                              title="Download PDF"
                            >
                              📄 PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr><td colSpan={7}><Empty>No bills yet.</Empty></td></tr>
                )}
              </tbody>
            </table>
          </section>
        </Layout>
      )
    },
    'Change Password': () => (
      <Layout title="Change Password">
        <section className="formcard">
          <h2>Set a new password</h2>
          <form className="formgrid" onSubmit={change}>
            <input
              type="password"
              minLength="6"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="New password"
              required
            />
            <button>Update password</button>
          </form>
          {note && <p className="note" style={{ marginTop: '10px' }}>{note}</p>}
        </section>
      </Layout>
    )
  }

  let Page = pages[view]
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <img src={logoImg} alt="Crumb ERP Logo" className="brandLogo" />
          <b>{business.name}</b>
        </div>
        {Object.keys(pages).map(x => (
          <button key={x} className={view === x ? 'active' : ''} onClick={() => setView(x)}>
            {x}
          </button>
        ))}
        <div className="sidebarBottom">
          <button onClick={doBackup}>Backup data</button>
          <button className="logout" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main>
        <Page />
        {receiptModal && (
          <div className="receiptModal" onClick={() => setReceiptModal(null)}>
            <div className="receiptBox" onClick={e => e.stopPropagation()}>
              <h2><span>🧾</span> Bill #{receiptModal.id} Completed</h2>
              <p style={{ color: '#718097', margin: '4px 0 12px' }}>
                {business.name} · {fmt(receiptModal.sold_at)}
              </p>

              <div className="receiptSummaryCard">
                <div className="receiptSummaryRow">
                  <span>Customer:</span>
                  <b>{receiptModal.customer_name || 'Walk-in'}</b>
                </div>
                {receiptModal.customer_phone && (
                  <div className="receiptSummaryRow">
                    <span>Phone:</span>
                    <span>{receiptModal.customer_phone}</span>
                  </div>
                )}
                <div className="receiptSummaryRow">
                  <span>Payment:</span>
                  <b>{receiptModal.payment_method}</b>
                </div>
                <div style={{ borderTop: '1px dashed #cfd7e6', margin: '8px 0' }} />
                {receiptModal.items.map((it, idx) => (
                  <div className="receiptSummaryRow" key={idx}>
                    <span>{it.quantity}x {it.name}</span>
                    <span>{money(it.total)}</span>
                  </div>
                ))}
                <div className="receiptSummaryTotal">
                  <span>Net Amount</span>
                  <span>{money(receiptModal.total)}</span>
                </div>
              </div>

              <div className="receiptActions">
                <button
                  className="printBtn"
                  onClick={() => printBill(receiptModal, { name: business.name })}
                >
                  🖨️ Print Bill
                </button>
                <button
                  className="pdfBtn"
                  onClick={async () => {
                    const saved = await saveBillPdf(receiptModal, { name: business.name })
                    if (saved && saved !== 'printed') setNote(`Bill PDF saved: ${saved}`)
                  }}
                >
                  📄 Save PDF
                </button>
                <button
                  className="newBillBtn"
                  onClick={() => setReceiptModal(null)}
                >
                  ➕ Next Bill
                </button>
              </div>
            </div>
          </div>
        )}
        {prodModal && (
          <div className="receiptModal" onClick={() => setProdModal(null)}>
            <div className="receiptBox" onClick={e => e.stopPropagation()}>
              <h2><span>🥐</span> Batch Ready: {prodModal.batch.recipe_name}</h2>
              <p style={{ color: '#718097', margin: '4px 0 16px', fontSize: '13px' }}>
                Cooking / baking is finished! Specify how many finished units were produced to add to <b>Packed Items</b> for <b>Billing / POS</b>.
              </p>

              <div style={{ display: 'grid', gap: '12px', marginBottom: '18px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                    How many finished quantity were produced? *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={prodModal.quantity}
                    onChange={e => setProdModal({ ...prodModal, quantity: e.target.value })}
                    placeholder="e.g. 24"
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                    Selling price ₹ (per unit):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={prodModal.price}
                    onChange={e => setProdModal({ ...prodModal, price: e.target.value })}
                    placeholder="e.g. 120"
                    required
                  />
                </div>
              </div>

              <div className="receiptActions">
                <button
                  className="printBtn"
                  style={{ background: '#16a34a' }}
                  onClick={handleCompleteBatch}
                >
                  ✓ Confirm & Add to Packed Items
                </button>
                <button
                  className="newBillBtn"
                  onClick={() => setProdModal(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Portal() {
  const [s, setS] = useState(null)
  const [m, setM] = useState()
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setS(data?.session || null))
    let { data: { subscription } } = supabase.auth.onAuthStateChange((_e, n) => setS(n))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function route() {
      if (!s) {
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        let a = await supabase.rpc('is_platform_administrator')
        if (a.data) {
          setM({ platform: true })
          setLoading(false)
          return
        }

        let r = await supabase.from('business_members').select('business_id').eq('user_id', s.user.id).limit(1).maybeSingle()
        if (r.error) {
          setMsg(`Failed to check workspace membership: ${r.error.message}`)
          setM(null)
          setLoading(false)
          return
        }

        if (!r.data) {
          setMsg(`Your account (${s.user.email}) is not assigned to any workspace in Supabase.`)
          setM(null)
          setLoading(false)
          return
        }

        let b = await supabase.from('businesses').select('id,name,access_ends_at').eq('id', r.data.business_id).maybeSingle()
        if (b.error) {
          setMsg(`Failed to load workspace data: ${b.error.message}`)
          setM(null)
        } else if (!b.data) {
          setMsg('Workspace record was not found or access was restricted by database security rules.')
          setM(null)
        } else if (b.data.access_ends_at && new Date(b.data.access_ends_at) <= new Date()) {
          setMsg(`Workspace "${b.data.name}" access ended on ${fmt(b.data.access_ends_at)}. Please contact your administrator.`)
          setM(null)
        } else {
          setM({ business: b.data })
        }
      } catch (err) {
        setMsg(`Access check error: ${err.message}`)
        setM(null)
      } finally {
        setLoading(false)
      }
    }
    route()
  }, [s])

  if (!configured) return <div className="loader">Supabase configuration missing in .env</div>
  if (loading) return <div className="loader">Checking access…</div>
  if (!s) return <Login />
  if (m?.platform) return <Admin />
  if (m?.business) return <Restaurant business={m.business} />
  return (
    <main className="auth">
      <div className="authbox">
        <h1>Access unavailable</h1>
        <p>{msg}</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<Portal />)
